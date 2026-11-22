-- M7/M8 第 4 批 D（G27 資產移轉，單子跟著走 B6）：D20、D21。
-- 內容：
--   1. 新表 ga_asset_transfer_moved_requests：記錄每次「轉移確認收到」或「更正所屬門市」搬走的需求單與工單，以及沒搬、只列清單的舊式工單（沒連到需求單的舊工單，D20）。登入者不能直接讀寫，一律走函式。
--   2. ga_ws_asset_move_open_requests（內部）：同一交易內只搬 request_type = 'REPAIR' 且 main_status 不是 COMPLETED／REJECTED／CANCELED 的需求單與其工單（含待門市確認、待門市補資料），
--      鎖列、換 store_id（updated_at 隨之更新，所以其他人畫面上的舊版本會得到 409 STALE）、在需求單與工單時間軸各寫一筆公開事件「因設備轉移，由 A 店轉到 B 店」（D21，不發通知）；
--      添購等其他類型不搬；沒連到需求單的舊式工單不搬，只記進清單。
--   3. 重新定義第 2 批兩個函式（簽章不變，只在原版後面多呼叫搬單函式）：ga_ws_transfer_confirm_receive（轉移收到）、ga_ws_correct_asset_store（更正所屬門市）。原版備份在 rollback 檔。
--   4. ga_ws_asset_move_preview（確認視窗預覽：會搬幾張、不搬幾張、舊式工單清單）、ga_ws_asset_moved_list（轉移單／資產「搬走了哪些單」明細）。
-- 「舊式工單」的判斷：維修工單表沒有連到設備或設施的欄位，所以沒連到需求單（ga_service_request_id 為空）的舊工單只能憑「同一門市、未完成、資源類型相符、標題或說明提到該資產的資產編號或名稱」找出疑似，
--   只列清單請總務人工處理，不搬、不改。
-- 權限語意：與第 2 批相同（has_permission、店長身分以 store_managers 為準，DB 沒有 admin 放行）。
-- 先決：先套 20261112100000（需求單規則與事件函式 ga_rq_event）與第 2 批轉移資料表。還原：20261112130000_m7m8_b4_asset_transfer_follow.rollback.sql。可重複執行。

DO $$
BEGIN
  IF to_regclass('public.ga_asset_transfers') IS NULL OR to_regclass('public.ga_asset_events') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: ga_asset_transfers／ga_asset_events（請先套第 2 批轉移資料表）';
  END IF;
  IF to_regclass('public.ga_service_requests') IS NULL OR to_regclass('public.maintenance_requests') IS NULL OR to_regclass('public.maintenance_ticket_events') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: 需求單／維修工單相關資料表';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_rq_event') THEN
    RAISE EXCEPTION 'Missing prerequisite function ga_rq_event（請先套 20261112100000_m7m8_b4_request_rules）';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname IN ('ga_ws_transfer_confirm_receive')) THEN
    RAISE EXCEPTION 'Missing prerequisite function ga_ws_transfer_confirm_receive';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ga_asset_transfer_moved_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid REFERENCES public.ga_asset_transfers(id) ON DELETE CASCADE,
  asset_event_id uuid REFERENCES public.ga_asset_events(id) ON DELETE CASCADE,
  asset_type text NOT NULL CHECK (asset_type IN ('EQUIPMENT', 'FACILITY')),
  asset_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('REQUEST', 'WORK_ORDER', 'UNLINKED_WORK_ORDER')),
  request_id uuid REFERENCES public.ga_service_requests(id) ON DELETE CASCADE,
  work_order_id uuid REFERENCES public.maintenance_requests(id) ON DELETE SET NULL,
  from_store_id uuid NOT NULL REFERENCES public.stores(id),
  to_store_id uuid NOT NULL REFERENCES public.stores(id),
  moved boolean NOT NULL DEFAULT true,
  -- 搬走當下的單據摘要（讓清單不用再去查，也不會因為單子後來改標題而變）
  doc_no text,
  doc_title text,
  doc_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_asset_transfer_moved_kind_ref CHECK (
    (kind = 'REQUEST' AND request_id IS NOT NULL AND moved)
    OR (kind = 'WORK_ORDER' AND work_order_id IS NOT NULL AND moved)
    OR (kind = 'UNLINKED_WORK_ORDER' AND work_order_id IS NOT NULL AND NOT moved)),
  CONSTRAINT ga_asset_transfer_moved_has_origin CHECK (transfer_id IS NOT NULL OR asset_event_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_ga_atm_transfer ON public.ga_asset_transfer_moved_requests (transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ga_atm_event ON public.ga_asset_transfer_moved_requests (asset_event_id) WHERE asset_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ga_atm_asset ON public.ga_asset_transfer_moved_requests (asset_type, asset_id, created_at DESC);
ALTER TABLE public.ga_asset_transfer_moved_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ga_asset_transfer_moved_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ga_asset_transfer_moved_requests TO service_role;

-- 沒連到需求單、仍未完成的舊式工單（疑似屬於這項資產）。回傳 jsonb 陣列，每筆含 work_order_id、title、status。
CREATE OR REPLACE FUNCTION public.ga_ws_asset_unlinked_work_orders(p_type text, p_asset_id uuid, p_store_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH a AS (
    SELECT CASE WHEN p_type = 'EQUIPMENT' THEN (SELECT jsonb_build_object('code', asset_code, 'name', name) FROM public.ga_equipment WHERE id = p_asset_id)
                ELSE (SELECT jsonb_build_object('code', facility_code, 'name', name) FROM public.ga_facilities WHERE id = p_asset_id) END AS j
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('work_order_id', mr.id, 'title', mr.title, 'status', mr.status, 'reported_at', mr.reported_at) ORDER BY mr.reported_at, mr.id), '[]'::jsonb)
    FROM public.maintenance_requests mr, a
   WHERE mr.ga_service_request_id IS NULL
     AND mr.store_id = p_store_id
     AND mr.status <> 'COMPLETED'
     AND (mr.resource_type IS NULL OR lower(mr.resource_type) = lower(p_type))
     AND (
       (char_length(COALESCE(a.j->>'code', '')) >= 3 AND position(lower(a.j->>'code') IN lower(COALESCE(mr.title, '') || ' ' || COALESCE(mr.description, ''))) > 0)
       OR (char_length(COALESCE(a.j->>'name', '')) >= 2 AND position(lower(a.j->>'name') IN lower(COALESCE(mr.title, '') || ' ' || COALESCE(mr.description, ''))) > 0)
     )
$$;

-- 搬單（內部函式，只給轉移收到、更正所屬門市在同一交易內呼叫）。
-- 只搬：維修類（request_type = 'REPAIR'）、未結案（main_status 不是 COMPLETED／REJECTED／CANCELED）、目前在轉出門市的需求單，連同它的工單。
-- 回傳 { moved_request_count, moved_work_order_count, unlinked_work_order_count }。
CREATE OR REPLACE FUNCTION public.ga_ws_asset_move_open_requests(
  p_type text, p_asset_id uuid, p_from uuid, p_to uuid, p_transfer_id uuid, p_event_id uuid, p_actor uuid, p_mode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_from_name text;
  v_to_name text;
  v_title text;
  v_desc text;
  v_req record;
  v_wo record;
  v_nreq integer := 0;
  v_nwo integer := 0;
  v_nun integer := 0;
  v_tr_no text;
BEGIN
  SELECT COALESCE(NULLIF(btrim(short_name), ''), store_name) INTO v_from_name FROM public.stores WHERE id = p_from;
  SELECT COALESCE(NULLIF(btrim(short_name), ''), store_name) INTO v_to_name FROM public.stores WHERE id = p_to;
  IF p_transfer_id IS NOT NULL THEN SELECT transfer_no INTO v_tr_no FROM public.ga_asset_transfers WHERE id = p_transfer_id; END IF;
  v_title := CASE WHEN p_mode = 'CORRECTION' THEN '因設備所屬門市更正，由 ' || COALESCE(v_from_name, '原門市') || ' 轉到 ' || COALESCE(v_to_name, '新門市')
                  ELSE '因設備轉移，由 ' || COALESCE(v_from_name, 'A 店') || ' 轉到 ' || COALESCE(v_to_name, 'B 店') END;
  v_desc := CASE WHEN p_mode = 'CORRECTION' THEN '總務更正設備所屬門市，進行中的維修單一併轉到新門市，由新門市店長接手。'
                 ELSE '設備轉移' || COALESCE('（轉移單 ' || v_tr_no || '）', '') || '完成，進行中的維修單一併轉到新門市，由新門市店長接手。' END;

  FOR v_req IN
    SELECT sr.id, sr.request_no, sr.title, sr.main_status, sr.maintenance_request_id
      FROM public.ga_service_requests sr
     WHERE sr.deleted_at IS NULL
       AND sr.request_type = 'REPAIR'
       AND sr.main_status NOT IN ('COMPLETED', 'REJECTED', 'CANCELED')
       AND sr.store_id = p_from
       AND ((p_type = 'EQUIPMENT' AND sr.equipment_id = p_asset_id) OR (p_type = 'FACILITY' AND sr.facility_id = p_asset_id))
     ORDER BY sr.created_at, sr.id
       FOR UPDATE
  LOOP
    UPDATE public.ga_service_requests SET store_id = p_to WHERE id = v_req.id;
    INSERT INTO public.ga_asset_transfer_moved_requests (transfer_id, asset_event_id, asset_type, asset_id, kind, request_id, from_store_id, to_store_id, moved, doc_no, doc_title, doc_status)
    VALUES (p_transfer_id, p_event_id, p_type, p_asset_id, 'REQUEST', v_req.id, p_from, p_to, true, v_req.request_no, v_req.title, v_req.main_status);
    PERFORM public.ga_rq_event(v_req.id, 'ASSET_STORE_MOVED', v_req.main_status, v_req.main_status, 'PUBLIC', v_title, v_desc,
      jsonb_build_object('from_store_id', p_from, 'to_store_id', p_to, 'transfer_id', p_transfer_id, 'asset_event_id', p_event_id, 'mode', p_mode), p_actor, false);
    v_nreq := v_nreq + 1;
    IF v_req.maintenance_request_id IS NOT NULL THEN
      SELECT mr.id, mr.title, mr.status INTO v_wo FROM public.maintenance_requests mr WHERE mr.id = v_req.maintenance_request_id FOR UPDATE;
      IF FOUND THEN
        UPDATE public.maintenance_requests SET store_id = p_to WHERE id = v_wo.id;
        INSERT INTO public.ga_asset_transfer_moved_requests (transfer_id, asset_event_id, asset_type, asset_id, kind, request_id, work_order_id, from_store_id, to_store_id, moved, doc_no, doc_title, doc_status)
        VALUES (p_transfer_id, p_event_id, p_type, p_asset_id, 'WORK_ORDER', v_req.id, v_wo.id, p_from, p_to, true, v_req.request_no, v_wo.title, v_wo.status);
        INSERT INTO public.maintenance_ticket_events (ticket_id, event_type, previous_status, new_status, description, visibility, created_by, metadata)
        VALUES (v_wo.id, 'STORE_MOVED', v_wo.status, v_wo.status, v_title, 'PUBLIC', p_actor,
          jsonb_build_object('from_store_id', p_from, 'to_store_id', p_to, 'transfer_id', p_transfer_id, 'ga_service_request_id', v_req.id));
        v_nwo := v_nwo + 1;
      END IF;
    END IF;
  END LOOP;

  -- 沒連到需求單的舊式工單：不搬，只列清單請總務人工處理
  INSERT INTO public.ga_asset_transfer_moved_requests (transfer_id, asset_event_id, asset_type, asset_id, kind, work_order_id, from_store_id, to_store_id, moved, doc_title, doc_status)
  SELECT p_transfer_id, p_event_id, p_type, p_asset_id, 'UNLINKED_WORK_ORDER', (e->>'work_order_id')::uuid, p_from, p_to, false, e->>'title', e->>'status'
    FROM jsonb_array_elements(public.ga_ws_asset_unlinked_work_orders(p_type, p_asset_id, p_from)) e;
  GET DIAGNOSTICS v_nun = ROW_COUNT;

  RETURN jsonb_build_object('moved_request_count', v_nreq, 'moved_work_order_count', v_nwo, 'unlinked_work_order_count', v_nun);
END;
$$;

-- 預覽：這項資產若換店，會搬走哪些單、哪些單留在原門市、哪些舊式工單要人工處理（確認視窗用）。
CREATE OR REPLACE FUNCTION public.ga_ws_asset_move_preview(p_type text, p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_store uuid;
  v_moving jsonb;
  v_staying jsonb;
  v_unlinked jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF p_type NOT IN ('EQUIPMENT', 'FACILITY') THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '資產類型錯誤'); END IF;
  IF NOT (has_permission(v_uid, ga_ws_asset_manage_code(p_type)) OR has_permission(v_uid, ga_ws_asset_view_code(p_type))) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有查看權限');
  END IF;
  IF p_type = 'EQUIPMENT' THEN SELECT store_id INTO v_store FROM public.ga_equipment WHERE id = p_id AND deleted_at IS NULL;
  ELSE SELECT store_id INTO v_store FROM public.ga_facilities WHERE id = p_id AND deleted_at IS NULL; END IF;
  IF v_store IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到資料'); END IF;
  WITH o AS (
    SELECT sr.id, sr.request_no, sr.title, sr.main_status, sr.request_type, sr.maintenance_request_id
      FROM public.ga_service_requests sr
     WHERE sr.deleted_at IS NULL AND sr.main_status NOT IN ('COMPLETED', 'REJECTED', 'CANCELED') AND sr.store_id = v_store
       AND ((p_type = 'EQUIPMENT' AND sr.equipment_id = p_id) OR (p_type = 'FACILITY' AND sr.facility_id = p_id))
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('request_id', id, 'request_no', request_no, 'title', title, 'main_status', main_status, 'has_work_order', maintenance_request_id IS NOT NULL) ORDER BY request_no) FILTER (WHERE request_type = 'REPAIR'), '[]'::jsonb),
         COALESCE(jsonb_agg(jsonb_build_object('request_id', id, 'request_no', request_no, 'title', title, 'main_status', main_status, 'request_type', request_type) ORDER BY request_no) FILTER (WHERE request_type <> 'REPAIR'), '[]'::jsonb)
    INTO v_moving, v_staying FROM o;
  v_unlinked := public.ga_ws_asset_unlinked_work_orders(p_type, p_id, v_store);
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'moving', v_moving, 'moving_count', jsonb_array_length(v_moving),
    'staying', v_staying, 'staying_count', jsonb_array_length(v_staying),
    'unlinked_work_orders', v_unlinked, 'unlinked_count', jsonb_array_length(v_unlinked)));
END;
$$;

-- 搬走了哪些單：依轉移單，或依資產（更正所屬門市的紀錄也在裡面）。轉移單雙方店長、設備／設施查看或管理權限者可看。
CREATE OR REPLACE FUNCTION public.ga_ws_asset_moved_list(p_transfer_id uuid DEFAULT NULL, p_type text DEFAULT NULL, p_asset_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_type text := p_type;
  v_ok boolean := false;
  t public.ga_asset_transfers%ROWTYPE;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF p_transfer_id IS NOT NULL THEN
    SELECT * INTO t FROM public.ga_asset_transfers WHERE id = p_transfer_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到轉移單'); END IF;
    v_type := t.asset_type;
    v_ok := EXISTS (SELECT 1 FROM public.store_managers WHERE user_id = v_uid AND role_type = 'store_manager' AND store_id IN (t.from_store_id, t.to_store_id));
  ELSE
    IF v_type IS NULL OR v_type NOT IN ('EQUIPMENT', 'FACILITY') OR p_asset_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請指定轉移單或資產'); END IF;
  END IF;
  IF NOT v_ok THEN
    v_ok := has_permission(v_uid, ga_ws_asset_manage_code(v_type)) OR has_permission(v_uid, ga_ws_asset_view_code(v_type));
  END IF;
  IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有查看權限'); END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', m.id, 'kind', m.kind, 'moved', m.moved, 'request_id', m.request_id, 'work_order_id', m.work_order_id,
           'doc_no', m.doc_no, 'doc_title', m.doc_title, 'doc_status', m.doc_status,
           'from_store_id', m.from_store_id, 'to_store_id', m.to_store_id, 'transfer_id', m.transfer_id, 'asset_event_id', m.asset_event_id, 'created_at', m.created_at)
         ORDER BY m.created_at, m.kind, m.id), '[]'::jsonb)
    INTO v_rows
    FROM public.ga_asset_transfer_moved_requests m
   WHERE (p_transfer_id IS NOT NULL AND m.transfer_id = p_transfer_id)
      OR (p_transfer_id IS NULL AND m.asset_type = v_type AND m.asset_id = p_asset_id);
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', v_rows);
END;
$$;

-- 第 2 批兩個函式（以套用前 DEV 的 pg_get_functiondef 為底，只在「換店之後」多呼叫搬單；簽章不變）
