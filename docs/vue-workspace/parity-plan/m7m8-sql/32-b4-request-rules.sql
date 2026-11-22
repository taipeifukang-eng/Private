-- 32-b4-request-rules.sql
-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/20261112100000_m7m8_b4_request_rules.sql 相同。
-- 第 4 批 A（需求單與處理單規則：資料結構與 G14 至 G17 規則函式）（2026-11-12 第 4 批問卷 D1 至 D21）。
-- 性質：會寫入。新增 2 張表（流程設定、設定變更紀錄）、10 個可為空或有預設值的欄位（處理單待交付時間、單據作廢 3 欄、留言原文、事件代按標記、需求單取消原因、重新開啟次數、待門市確認起算時間、報價作廢標記）、2 個觸發器（需求單進入待門市確認時記錄起算時間、處理單達需求量時記錄待交付時間）、13 個 ga_ws_req_*／ga_ws_ful_* 函式（受理與 D4 擋、合法流轉、門市動作與總務代按標記、留言改刪保留原文、逾期天數設定、庫存出庫守衛、採購評估、處理單決定／異常／作廢／送門市確認）與內部輔助函式；
--   採購單連結處理單的同步觸發器（有採購單表才會裝）。注意：32 內的庫存出庫（ga_ws_req_stock_issue）、採購評估「進入採購」（ga_ws_req_purchase_review）與採購連結同步會呼叫 33 才建立的 ga_po_fmt、ga_ws_po_from_review、ga_po_request_requested_base，所以 32 與 33 必須連續套用（中間不要讓使用者操作；只套 32 時這兩個功能會失敗並整筆回復）。不改任何既有資料；舊版畫面與舊版 API 不受影響，只有一處行為改變（見下）。
-- 行為改變（要使用者核可）：以 CREATE OR REPLACE 覆蓋第 3 批 ga_inv_tr_sync_fulfillment——調撥單全數收貨後，料件處理單維持「調撥」狀態並成為「待交付」，要總務按「送門市確認」處理單與需求單才一起往下（原本收貨後處理單會自動跳到等門市確認，需求單卻停在處理中，兩邊不同步）。
-- 設定表預設值：採購核准啟用、核准門檻 5000 元（含稅總額大於才需核准）、稅率 0.05、需求單待門市確認逾期天數 7、歷史價筆數 5。登入者不能直接讀寫設定表，只有函式（SECURITY DEFINER）與 service_role 能存取。
-- 先決條件：需求單、處理單、單據、留言、事件、採購評估報價、profiles、maintenance_requests 資料表已存在，第 3 批 28（ga_ws_inv_post、調撥同步）已套用（先跑 31 確認）。採購評估選「進入採購」要 33 的 ga_ws_po_from_review（沒套 33 時該決策會失敗，其餘功能不受影響）。
-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：32-b4-request-rules-rollback.sql。套用前先跑 31-b4-preview-before-apply.sql，備份後經使用者核可才執行。
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.ga_service_requests') IS NULL OR to_regclass('public.ga_service_request_comments') IS NULL
     OR to_regclass('public.ga_service_request_events') IS NULL OR to_regclass('public.ga_part_fulfillments') IS NULL
     OR to_regclass('public.ga_part_fulfillment_documents') IS NULL OR to_regclass('public.ga_purchase_review_quotes') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: 需求單／處理單／採購評估相關資料表';
  END IF;
END $$;

-- ---------------------------------------------------------------- 1. 設定表
CREATE TABLE IF NOT EXISTS public.ga_workflow_settings (
  key text PRIMARY KEY,
  value_num numeric,
  value_text text,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_workflow_settings_key_format CHECK (key ~ '^[a-z][a-z0-9_]{0,59}$')
);
INSERT INTO public.ga_workflow_settings (key, value_num) VALUES
  ('po_approval_enabled', 1),
  ('po_approval_threshold', 5000),
  ('po_tax_rate', 0.05),
  ('request_overdue_confirm_days', 7),
  ('po_price_history_limit', 5)
ON CONFLICT (key) DO NOTHING;
ALTER TABLE public.ga_workflow_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ga_workflow_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ga_workflow_settings TO service_role;

-- ---------------------------------------------------------------- 2. 設定變更紀錄
CREATE TABLE IF NOT EXISTS public.ga_workflow_setting_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text NOT NULL,
  old_value_num numeric,
  new_value_num numeric,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ga_workflow_setting_events_key ON public.ga_workflow_setting_events (setting_key, created_at DESC);
ALTER TABLE public.ga_workflow_setting_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ga_workflow_setting_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.ga_workflow_setting_events TO service_role;

-- ---------------------------------------------------------------- 3. 處理單與單據
ALTER TABLE public.ga_part_fulfillments ADD COLUMN IF NOT EXISTS ready_to_deliver_at timestamptz;
ALTER TABLE public.ga_part_fulfillment_documents
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------- 4. 留言與事件
ALTER TABLE public.ga_service_request_comments ADD COLUMN IF NOT EXISTS original_body text;
ALTER TABLE public.ga_service_request_events ADD COLUMN IF NOT EXISTS proxy_for_store boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------- 5. 需求單
ALTER TABLE public.ga_service_requests
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS reopened_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.ga_service_requests DROP CONSTRAINT IF EXISTS ga_service_requests_reopened_count_check;
ALTER TABLE public.ga_service_requests ADD CONSTRAINT ga_service_requests_reopened_count_check CHECK (reopened_count >= 0);

-- ---------------------------------------------------------------- 6. 報價歷史
ALTER TABLE public.ga_purchase_review_quotes ADD COLUMN IF NOT EXISTS superseded_at timestamptz;


-- ================================================================ 第二段（G14 至 G17）：需求單與處理單的規則函式
-- 7. 內部輔助：白話錯誤（與採購單同樣的 {ok,status,code,error} 格式；在函式內丟出帶狀態碼的錯誤，外層轉回，同一子交易的寫入一併回復）。
CREATE OR REPLACE FUNCTION public.ga_rq_err(p_status integer, p_code text, p_message text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT jsonb_build_object('ok', false, 'status', p_status, 'code', p_code, 'error', p_message) || COALESCE(p_extra, '{}'::jsonb); $$;

CREATE OR REPLACE FUNCTION public.ga_rq_raise(p_status integer, p_code text, p_message text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $$ BEGIN RAISE EXCEPTION '%', public.ga_rq_err(p_status, p_code, p_message, p_extra)::text USING ERRCODE = 'GA001'; END; $$;

CREATE OR REPLACE FUNCTION public.ga_rq_catch(p_message text, p_sqlstate text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_sqlstate = 'GA001' THEN RETURN p_message::jsonb; END IF;
  IF p_sqlstate IN ('40001', '40P01') THEN RETURN public.ga_rq_err(409, 'BUSY', '系統忙碌中，請稍後重試'); END IF;
  IF p_sqlstate = '23505' THEN RETURN public.ga_rq_err(409, 'DUPLICATE', '資料重複，請重新整理畫面後再試'); END IF;
  IF p_sqlstate = '23503' THEN RETURN public.ga_rq_err(409, 'REFERENCE_INVALID', '關聯的資料已不存在，請重新整理畫面後再試'); END IF;
  IF p_sqlstate = '23514' THEN RETURN public.ga_rq_err(400, 'CHECK_FAILED', '資料不符合規則，請檢查欄位'); END IF;
  RETURN public.ga_rq_err(500, 'UNKNOWN_ERROR', '操作失敗，請稍後重試');
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_rq_event(p_request_id uuid, p_type text, p_old text, p_new text, p_visibility text, p_title text, p_desc text, p_meta jsonb, p_uid uuid, p_proxy boolean DEFAULT false)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ INSERT INTO public.ga_service_request_events (request_id, event_type, old_status, new_status, visibility, title, description, metadata, created_by, created_by_name, proxy_for_store)
      VALUES (p_request_id, p_type, p_old, p_new, p_visibility, p_title, p_desc, COALESCE(p_meta, '{}'::jsonb), p_uid, (SELECT full_name FROM public.profiles WHERE id = p_uid), COALESCE(p_proxy, false)); $$;

CREATE OR REPLACE FUNCTION public.ga_rq_is_store_member(p_uid uuid, p_store_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT EXISTS (SELECT 1 FROM public.store_managers WHERE user_id = p_uid AND store_id = p_store_id); $$;

-- 需求單目前有效的單據與工單（Q17、D4 的前置檢查用）。採購單表是第 33 才有，所以用動態 SQL（沒有採購單表時當作 0）。
CREATE OR REPLACE FUNCTION public.ga_rq_docs(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_po integer := 0;
  v_po_received integer := 0;
  v_po_nos text;
  v_issued numeric := 0;
  v_transfer integer := 0;
  v_wo boolean := false;
  v_wo_no text;
BEGIN
  IF to_regclass('public.ga_purchase_orders') IS NOT NULL THEN
    EXECUTE 'SELECT count(*), count(*) FILTER (WHERE status IN (''PARTIALLY_RECEIVED'', ''RECEIVED'', ''CLOSED'') OR EXISTS (SELECT 1 FROM public.ga_purchase_order_items i WHERE i.po_id = o.id AND i.received_qty > 0)), string_agg(po_no, ''、'' ORDER BY po_no) FROM public.ga_purchase_orders o WHERE o.status <> ''CANCELED'' AND (o.source_request_id = $1 OR EXISTS (SELECT 1 FROM public.ga_purchase_order_items i2 WHERE i2.po_id = o.id AND i2.request_id = $1))'
      INTO v_po, v_po_received, v_po_nos USING p_request_id;
  END IF;
  SELECT COALESCE(sum(d.quantity), 0), count(*) FILTER (WHERE d.document_type = 'TRANSFER')
    INTO v_issued, v_transfer
    FROM public.ga_part_fulfillment_documents d JOIN public.ga_part_fulfillments f ON f.id = d.fulfillment_id
   WHERE f.request_id = p_request_id AND d.voided_at IS NULL AND COALESCE(d.status, '') <> 'CANCELED'
     AND d.document_type IN ('STOCK_ISSUE', 'TRANSFER');
  -- v_issued 含調撥數量；分開算出庫量。
  SELECT COALESCE(sum(d.quantity), 0) INTO v_issued
    FROM public.ga_part_fulfillment_documents d JOIN public.ga_part_fulfillments f ON f.id = d.fulfillment_id
   WHERE f.request_id = p_request_id AND d.voided_at IS NULL AND COALESCE(d.status, '') <> 'CANCELED' AND d.document_type = 'STOCK_ISSUE';
  SELECT (m.id IS NOT NULL AND m.status <> 'COMPLETED'), m.id::text INTO v_wo, v_wo_no
    FROM public.ga_service_requests r LEFT JOIN public.maintenance_requests m ON m.id = r.maintenance_request_id WHERE r.id = p_request_id;
  RETURN jsonb_build_object('po_count', COALESCE(v_po, 0), 'po_received', COALESCE(v_po_received, 0), 'po_nos', v_po_nos, 'issued', v_issued,
    'transfer_active', v_transfer, 'work_order_open', COALESCE(v_wo, false));
END;
$$;

-- ---------------------------------------------------------------- 8. 待門市確認起算時間（D5 逾期標示）與處理單待交付時間（Q18）
ALTER TABLE public.ga_service_requests ADD COLUMN IF NOT EXISTS waiting_confirm_since timestamptz;
UPDATE public.ga_service_requests SET waiting_confirm_since = COALESCE(updated_at, created_at) WHERE main_status = 'WAITING_STORE_CONFIRMATION' AND waiting_confirm_since IS NULL;
CREATE INDEX IF NOT EXISTS idx_ga_service_requests_waiting_confirm ON public.ga_service_requests (waiting_confirm_since) WHERE main_status = 'WAITING_STORE_CONFIRMATION' AND deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.ga_rq_waiting_trg() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.main_status = 'WAITING_STORE_CONFIRMATION' THEN
    IF TG_OP = 'INSERT' OR OLD.main_status IS DISTINCT FROM 'WAITING_STORE_CONFIRMATION' OR NEW.waiting_confirm_since IS NULL THEN NEW.waiting_confirm_since := now(); END IF;
  ELSE
    NEW.waiting_confirm_since := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ga_service_requests_waiting ON public.ga_service_requests;
CREATE TRIGGER trg_ga_service_requests_waiting BEFORE INSERT OR UPDATE OF main_status ON public.ga_service_requests FOR EACH ROW EXECUTE FUNCTION public.ga_rq_waiting_trg();

-- 處理單：已處理量達需求量且還沒送門市確認 = 「待交付」，記下達標時間；量退回（單據作廢）或進入異常就清掉。
CREATE OR REPLACE FUNCTION public.ga_ful_ready_trg() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status IN ('WAITING_STORE_CONFIRMATION', 'COMPLETED', 'CANCELED') THEN
    RETURN NEW;
  ELSIF COALESCE(NEW.requested_quantity, 0) > 0 AND COALESCE(NEW.fulfilled_quantity, 0) >= NEW.requested_quantity AND NEW.status NOT IN ('EXCEPTION', 'PENDING_DECISION') THEN
    NEW.ready_to_deliver_at := COALESCE(NEW.ready_to_deliver_at, now());
  ELSE
    NEW.ready_to_deliver_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ga_part_fulfillments_ready ON public.ga_part_fulfillments;
CREATE TRIGGER trg_ga_part_fulfillments_ready BEFORE INSERT OR UPDATE ON public.ga_part_fulfillments FOR EACH ROW EXECUTE FUNCTION public.ga_ful_ready_trg();
UPDATE public.ga_part_fulfillments SET ready_to_deliver_at = COALESCE(updated_at, now())
 WHERE ready_to_deliver_at IS NULL AND deleted_at IS NULL AND status IN ('STOCK_ISSUE', 'TRANSFER', 'PURCHASING', 'WAITING_ARRIVAL') AND COALESCE(requested_quantity, 0) > 0 AND fulfilled_quantity >= requested_quantity;

-- 調撥收貨同步處理單（覆蓋第 3 批 ga_inv_tr_sync_fulfillment）：Q18——調撥全數收貨後不再自動跳到「等門市確認」，
-- 維持「調撥」狀態並成為「待交付」，由總務按「送門市確認」處理單與需求單才一起往下。其餘邏輯與第 3 批相同。
CREATE OR REPLACE FUNCTION public.ga_inv_tr_sync_fulfillment(p_transfer_id uuid, p_status text, p_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_doc record;
  v_ful record;
  v_recv numeric;
  v_req numeric;
  v_state text;
  v_step text;
BEGIN
  SELECT d.id, d.fulfillment_id INTO v_doc FROM public.ga_part_fulfillment_documents d WHERE d.document_type = 'TRANSFER' AND d.document_id = p_transfer_id;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.ga_part_fulfillment_documents SET status = p_status WHERE id = v_doc.id;
  SELECT * INTO v_ful FROM public.ga_part_fulfillments WHERE id = v_doc.fulfillment_id FOR UPDATE;
  IF NOT FOUND OR v_ful.status NOT IN ('PENDING_DECISION', 'TRANSFER', 'EXCEPTION') THEN RETURN; END IF;
  SELECT COALESCE(sum(quantity), 0) INTO v_recv FROM public.ga_part_fulfillment_documents
   WHERE fulfillment_id = v_doc.fulfillment_id AND document_type = 'TRANSFER' AND status = 'RECEIVED' AND voided_at IS NULL;
  v_req := COALESCE(v_ful.requested_quantity, 0);
  IF p_status = 'RECEIVED' THEN
    IF v_req > 0 AND v_recv >= v_req THEN v_state := 'TRANSFER'; v_step := '調撥已全數收貨，待交付（請按「送門市確認」）';
    ELSE v_state := 'TRANSFER'; v_step := '已調撥收貨 ' || v_recv::text || ' / ' || v_req::text || '，繼續處理剩餘數量'; END IF;
  ELSIF p_status = 'CANCELED' THEN
    IF EXISTS (SELECT 1 FROM public.ga_part_fulfillment_documents d2
                WHERE d2.fulfillment_id = v_doc.fulfillment_id AND d2.document_type = 'TRANSFER' AND d2.id <> v_doc.id AND d2.voided_at IS NULL
                  AND COALESCE(d2.status, '') NOT IN ('CANCELED', 'RECEIVED')) THEN
      v_state := 'TRANSFER'; v_step := '有一張調撥已取消，其他調撥單仍在進行中';
    ELSE
      v_state := 'EXCEPTION'; v_step := '調撥已取消，請重新決定處理方式';
    END IF;
  ELSIF p_status = 'IN_TRANSIT' THEN v_state := 'TRANSFER'; v_step := '調撥運送中';
  ELSIF p_status = 'SOURCE_CONFIRMED' THEN v_state := 'TRANSFER'; v_step := '來源已交出，等待運送';
  ELSE v_state := 'TRANSFER'; v_step := '等待來源確認'; END IF;
  UPDATE public.ga_part_fulfillments
     SET status = v_state, current_step = v_step, updated_by = p_uid,
         fulfilled_quantity = CASE WHEN p_status = 'RECEIVED' THEN v_recv ELSE fulfilled_quantity END
   WHERE id = v_doc.fulfillment_id;
END;
$$;

-- 重算處理單已處理量（單據作廢、採購到貨後呼叫）：出庫單 + 已收貨調撥 + 連到這張需求單的採購單品項已驗入量（品項單位）。
CREATE OR REPLACE FUNCTION public.ga_ful_recompute(p_ful_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_ful public.ga_part_fulfillments%ROWTYPE;
  v_total numeric := 0;
  v_po numeric := 0;
  v_conv numeric := 1;
BEGIN
  SELECT * INTO v_ful FROM public.ga_part_fulfillments WHERE id = p_ful_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  SELECT COALESCE(sum(d.quantity), 0) INTO v_total FROM public.ga_part_fulfillment_documents d
   WHERE d.fulfillment_id = p_ful_id AND d.voided_at IS NULL AND COALESCE(d.status, '') <> 'CANCELED'
     AND ((d.document_type = 'STOCK_ISSUE') OR (d.document_type = 'TRANSFER' AND d.status = 'RECEIVED'));
  IF to_regclass('public.ga_purchase_orders') IS NOT NULL THEN
    -- 採購進貨量先換成基本單位，再換成需求單的單位（與出庫、調撥同單位才能相加）；需求單沒有數量或換算不出來時維持 1。
    EXECUTE 'SELECT COALESCE(sum(i.received_qty * i.quantity_base / i.quantity), 0) FROM public.ga_purchase_order_items i JOIN public.ga_purchase_orders o ON o.id = i.po_id WHERE i.request_id = $1 AND o.status <> ''CANCELED'''
      INTO v_po USING v_ful.request_id;
    EXECUTE 'SELECT COALESCE(public.ga_po_request_requested_base($1) / NULLIF((SELECT desired_quantity FROM public.ga_service_requests WHERE id = $1), 0), 1)' INTO v_conv USING v_ful.request_id;
    IF v_conv IS NULL OR v_conv <= 0 THEN v_conv := 1; END IF;
    v_po := round(v_po / v_conv, 4);
  END IF;
  v_total := v_total + COALESCE(v_po, 0);
  IF v_total IS DISTINCT FROM v_ful.fulfilled_quantity THEN
    UPDATE public.ga_part_fulfillments SET fulfilled_quantity = v_total WHERE id = p_ful_id;
  END IF;
  RETURN v_total;
END;
$$;

-- 採購單連結到處理單（D2：一張處理單可有多張採購單，以 PURCHASE 類型單據連結）並同步處理單進度。由採購單的觸發器呼叫。
CREATE OR REPLACE FUNCTION public.ga_ful_sync_po(p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_req public.ga_service_requests%ROWTYPE;
  v_ful public.ga_part_fulfillments%ROWTYPE;
  v_po record;
  v_qty numeric;
  v_unordered integer := 0;
  v_open integer := 0;
  v_total integer := 0;
  v_state text;
  v_step text;
  v_got numeric;
  v_linked uuid[] := ARRAY[]::uuid[];
BEGIN
  IF p_request_id IS NULL OR to_regclass('public.ga_purchase_orders') IS NULL THEN RETURN; END IF;
  SELECT * INTO v_req FROM public.ga_service_requests WHERE id = p_request_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO v_ful FROM public.ga_part_fulfillments WHERE request_id = p_request_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    -- 只有料件需求單才建立料件處理單；設備添購等非料件需求不進料件處理中心。
    IF COALESCE(v_req.resource_type, '') <> 'PART' THEN RETURN; END IF;
    INSERT INTO public.ga_part_fulfillments (request_id, status, requested_quantity, unit, current_step, created_by, updated_by)
    VALUES (p_request_id, 'PURCHASING', v_req.desired_quantity, v_req.desired_unit, '已產生採購單，請確認供應商與單價後下訂', COALESCE(auth.uid(), v_req.created_by), COALESCE(auth.uid(), v_req.created_by))
    RETURNING * INTO v_ful;
  END IF;
  FOR v_po IN EXECUTE 'SELECT o.id, o.po_no, o.status FROM public.ga_purchase_orders o WHERE o.source_request_id = $1 OR EXISTS (SELECT 1 FROM public.ga_purchase_order_items i WHERE i.po_id = o.id AND i.request_id = $1)' USING p_request_id LOOP
    EXECUTE 'SELECT COALESCE(sum(quantity), 0) FROM public.ga_purchase_order_items WHERE po_id = $1 AND (request_id = $2 OR (request_id IS NULL AND EXISTS (SELECT 1 FROM public.ga_purchase_orders WHERE id = $1 AND source_request_id = $2)))' INTO v_qty USING v_po.id, p_request_id;
    v_linked := array_append(v_linked, v_po.id);
    INSERT INTO public.ga_part_fulfillment_documents (fulfillment_id, document_type, document_id, document_no, quantity, status, created_by)
    VALUES (v_ful.id, 'PURCHASE', v_po.id, v_po.po_no, v_qty, v_po.status, COALESCE(auth.uid(), v_req.created_by))
    ON CONFLICT (fulfillment_id, document_type, document_id) DO UPDATE SET quantity = EXCLUDED.quantity, status = EXCLUDED.status;
    v_total := v_total + CASE WHEN v_po.status = 'CANCELED' THEN 0 ELSE 1 END;
    IF v_po.status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED') THEN v_unordered := v_unordered + 1;
    ELSIF v_po.status IN ('ORDERED', 'PARTIALLY_RECEIVED') THEN v_open := v_open + 1; END IF;
  END LOOP;
  -- 草稿被改掉、不再連到這張需求單的採購單：移除過時的單據列（已下訂的單品項鎖定，不會走到這裡）。
  DELETE FROM public.ga_part_fulfillment_documents d
   WHERE d.fulfillment_id = v_ful.id AND d.document_type = 'PURCHASE' AND NOT (d.document_id = ANY (v_linked));
  v_got := public.ga_ful_recompute(v_ful.id);
  IF v_ful.status IN ('PENDING_DECISION', 'PURCHASING', 'WAITING_ARRIVAL') AND v_total > 0 THEN
    IF v_unordered > 0 THEN v_state := 'PURCHASING'; v_step := '採購單尚未下訂（草稿、待核准或已核准待下訂）';
    ELSIF v_open > 0 THEN v_state := 'WAITING_ARRIVAL'; v_step := '已下訂，等待到貨（已到貨 ' || public.ga_po_fmt(v_got) || ' / ' || public.ga_po_fmt(COALESCE(v_ful.requested_quantity, 0)) || '）';
    ELSE v_state := 'WAITING_ARRIVAL'; v_step := '採購已到貨 ' || public.ga_po_fmt(v_got) || ' / ' || public.ga_po_fmt(COALESCE(v_ful.requested_quantity, 0)) || CASE WHEN COALESCE(v_ful.requested_quantity, 0) > 0 AND v_got >= v_ful.requested_quantity THEN '，待交付（請按「送門市確認」）' ELSE '' END; END IF;
    UPDATE public.ga_part_fulfillments SET status = v_state, current_step = v_step WHERE id = v_ful.id AND (status IS DISTINCT FROM v_state OR current_step IS DISTINCT FROM v_step);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ful_po_trg() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_req uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_req := OLD.request_id;
  ELSIF TG_TABLE_NAME = 'ga_purchase_orders' THEN v_req := NEW.source_request_id; ELSE v_req := NEW.request_id; END IF;
  IF v_req IS NOT NULL THEN PERFORM public.ga_ful_sync_po(v_req); END IF;
  -- 品項改連到別張需求單：原本那張的處理單也要同步。
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'ga_purchase_order_items' THEN
    IF OLD.request_id IS NOT NULL AND OLD.request_id IS DISTINCT FROM NEW.request_id THEN PERFORM public.ga_ful_sync_po(OLD.request_id); END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- 採購單表在第 33 才存在：兩邊都做同一段（先套 32 再套 33，或先有採購單表再套 32，都會裝好觸發器）。
-- 注意：本檔的庫存出庫、採購評估與採購連結同步會呼叫 33 才建立的函式（ga_po_fmt、ga_ws_po_from_review、ga_po_request_requested_base），32 與 33 必須連續套用。
DO $$
BEGIN
  IF to_regclass('public.ga_purchase_orders') IS NOT NULL AND to_regclass('public.ga_purchase_order_items') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_ga_purchase_orders_ful_sync ON public.ga_purchase_orders;
    CREATE TRIGGER trg_ga_purchase_orders_ful_sync AFTER INSERT OR UPDATE OF status, source_request_id ON public.ga_purchase_orders FOR EACH ROW EXECUTE FUNCTION public.ga_ful_po_trg();
    DROP TRIGGER IF EXISTS trg_ga_purchase_order_items_ful_sync ON public.ga_purchase_order_items;
    CREATE TRIGGER trg_ga_purchase_order_items_ful_sync AFTER INSERT OR UPDATE OF received_qty, quantity, request_id OR DELETE ON public.ga_purchase_order_items FOR EACH ROW EXECUTE FUNCTION public.ga_ful_po_trg();
  END IF;
END $$;

-- 內部輔助不開放給前端直接呼叫。
REVOKE ALL ON FUNCTION public.ga_rq_err(integer, text, text, jsonb), public.ga_rq_raise(integer, text, text, jsonb), public.ga_rq_catch(text, text),
  public.ga_rq_event(uuid, text, text, text, text, text, text, jsonb, uuid, boolean), public.ga_rq_is_store_member(uuid, uuid), public.ga_rq_docs(uuid),
  public.ga_ful_recompute(uuid), public.ga_ful_sync_po(uuid), public.ga_ful_po_trg() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- 9. 建立需求單（G14）
-- p_payload：欄位已由伺服端驗證過；這裡再檢查權限與門市範圍。需求單建立權限；替別的門市建立需「需求單管理」、門市管理或員工管理權限（與舊版相同）。
CREATE OR REPLACE FUNCTION public.ga_ws_req_create(p_payload jsonb, p_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_store uuid;
  v_any boolean;
  v_id uuid;
  v_no text;
  v_key text := ga_normalize_optional_text(p_key);
  v_exist public.ga_service_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.request.create') THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有建立總務需求單權限'); END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RETURN public.ga_rq_err(400, 'PAYLOAD_INVALID', '送出的內容格式錯誤'); END IF;
  BEGIN
    v_store := (p_payload->>'store_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_err(400, 'STORE_REQUIRED', '請選擇門市');
  END;
  IF v_store IS NULL OR NOT EXISTS (SELECT 1 FROM public.stores WHERE id = v_store) THEN RETURN public.ga_rq_err(400, 'STORE_REQUIRED', '請選擇門市'); END IF;
  v_any := has_permission(v_uid, 'general_affairs.request.manage') OR has_permission(v_uid, 'store.manage') OR has_permission(v_uid, 'employee.manage');
  IF NOT v_any AND NOT public.ga_rq_is_store_member(v_uid, v_store) THEN RETURN public.ga_rq_err(403, 'STORE_SCOPE', '只能替自己管理的門市建立需求單'); END IF;
  BEGIN
    -- 同一個固定識別 30 分鐘內只建一張（防連點重複送出）。
    IF v_key IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('ga_req_create:' || v_uid::text || ':' || v_key, 0));
      SELECT * INTO v_exist FROM public.ga_service_requests r
       WHERE r.created_by = v_uid AND r.created_at > now() - interval '30 minutes' AND r.deleted_at IS NULL
         AND EXISTS (SELECT 1 FROM public.ga_service_request_events e WHERE e.request_id = r.id AND e.event_type = 'REQUEST_CREATED' AND e.metadata->>'idempotency_key' = v_key)
       LIMIT 1;
      IF FOUND THEN RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', true, 'data', jsonb_build_object('id', v_exist.id, 'request_no', v_exist.request_no, 'main_status', v_exist.main_status)); END IF;
    END IF;
    INSERT INTO public.ga_service_requests (store_id, created_by, created_by_name, request_type, title, description, resource_type, equipment_id, facility_id, part_id,
      desired_quantity, desired_unit, desired_spec, impact_description, temporary_workaround, contact_name, contact_phone, main_status, public_progress)
    VALUES (v_store, v_uid, (SELECT full_name FROM public.profiles WHERE id = v_uid), p_payload->>'request_type', p_payload->>'title', p_payload->>'description',
      NULLIF(p_payload->>'resource_type', ''), NULLIF(p_payload->>'equipment_id', '')::uuid, NULLIF(p_payload->>'facility_id', '')::uuid, NULLIF(p_payload->>'part_id', '')::uuid,
      NULLIF(p_payload->>'desired_quantity', '')::numeric, NULLIF(p_payload->>'desired_unit', ''), NULLIF(p_payload->>'desired_spec', ''),
      NULLIF(p_payload->>'impact_description', ''), NULLIF(p_payload->>'temporary_workaround', ''), NULLIF(p_payload->>'contact_name', ''), NULLIF(p_payload->>'contact_phone', ''),
      'PENDING_INTAKE', '門市已送出需求，等待總務受理。')
    RETURNING id, request_no INTO v_id, v_no;
    IF v_key IS NOT NULL THEN
      UPDATE public.ga_service_request_events SET metadata = metadata || jsonb_build_object('idempotency_key', v_key) WHERE request_id = v_id AND event_type = 'REQUEST_CREATED';
    END IF;
    RETURN jsonb_build_object('ok', true, 'status', 201, 'data', jsonb_build_object('id', v_id, 'request_no', v_no, 'main_status', 'PENDING_INTAKE'));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- ---------------------------------------------------------------- 10. 受理（Q17、D4）
CREATE OR REPLACE FUNCTION public.ga_ws_req_accept(p_id uuid, p_expected_updated_at timestamptz, p_route text, p_role text, p_assignee_user uuid, p_assignee_name text, p_internal_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.ga_service_requests%ROWTYPE;
  v_route text := upper(COALESCE(ga_normalize_optional_text(p_route), ''));
  v_role text := upper(COALESCE(ga_normalize_optional_text(p_role), ''));
  v_name text := (SELECT full_name FROM public.profiles WHERE id = v_uid);
  v_wo uuid;
  v_route_label text;
  v_role_label text;
  v_progress text;
  v_desc text;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.request.manage') THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有總務需求單管理權限'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  IF v_route NOT IN ('REPAIR_DISPATCH', 'PURCHASE_REVIEW', 'STOCK_ISSUE', 'TRANSFER', 'ASSET_TASK') THEN RETURN public.ga_rq_err(400, 'ROUTE_REQUIRED', '受理時必須選擇後續處理方式'); END IF;
  IF v_role NOT IN ('GENERAL_AFFAIRS', 'WORKS') THEN RETURN public.ga_rq_err(400, 'ROLE_REQUIRED', '受理時必須選擇總務或工務角色'); END IF;
  BEGIN
    SELECT * INTO v_req FROM public.ga_service_requests WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到需求單'); END IF;
    IF v_req.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張需求單剛被其他人更新，請重新載入後再操作'); END IF;
    IF v_req.main_status NOT IN ('PENDING_INTAKE', 'WAITING_GA_REVIEW') THEN
      RETURN public.ga_rq_err(409, 'INVALID_STATE', '目前狀態不可受理（已受理、已完成、已駁回或已取消的單不能再受理；已完成或已駁回請用「重新開啟」）');
    END IF;
    IF v_route = 'PURCHASE_REVIEW' AND v_req.request_type = 'REPAIR' THEN RETURN public.ga_rq_err(422, 'REPAIR_NOT_PURCHASE', '維修單不能走採購評估，請選「維修派工」'); END IF;
    IF v_route = 'STOCK_ISSUE' AND COALESCE(v_req.resource_type, '') <> 'PART' THEN RETURN public.ga_rq_err(422, 'NOT_PART_STOCK', '只有料件需求可以走庫存出庫，這張需求不是料件'); END IF;
    IF v_route = 'REPAIR_DISPATCH' AND v_req.request_type <> 'REPAIR' THEN RETURN public.ga_rq_err(422, 'NOT_REPAIR', '只有維修需求可以分流為維修派工'); END IF;
    v_route_label := CASE v_route WHEN 'REPAIR_DISPATCH' THEN '維修派工' WHEN 'PURCHASE_REVIEW' THEN '添購/採購評估' WHEN 'STOCK_ISSUE' THEN '庫存出庫' WHEN 'TRANSFER' THEN '調撥處理' ELSE '資產異動/門市配合' END;
    v_role_label := CASE v_role WHEN 'GENERAL_AFFAIRS' THEN '總務' ELSE '工務' END;
    v_progress := '總務已受理，承辦角色：' || v_role_label || '，後續處理方式：' || v_route_label || '。';
    v_wo := v_req.maintenance_request_id;
    IF v_route = 'REPAIR_DISPATCH' AND v_wo IS NULL THEN
      INSERT INTO public.maintenance_requests (store_id, title, description, reported_by, reporter_name, reported_at, priority, status, resource_type, issue_type, contact_name, contact_phone,
        progress_stage, assignee_name, accepted_at, accepted_by, ga_service_request_id)
      VALUES (v_req.store_id, v_req.title,
        concat_ws(E'\n\n', v_req.description, CASE WHEN v_req.impact_description IS NOT NULL THEN '營運影響：' || v_req.impact_description END,
          CASE WHEN v_req.temporary_workaround IS NOT NULL THEN '暫時處理方式：' || v_req.temporary_workaround END, '來源總務需求單：' || v_req.request_no),
        v_req.created_by, COALESCE(v_req.created_by_name, v_name, 'Unknown'), COALESCE(v_req.created_at, now()), 'normal', 'ACCEPTED',
        CASE v_req.resource_type WHEN 'EQUIPMENT' THEN 'equipment' WHEN 'FACILITY' THEN 'facility' ELSE NULL END, v_req.resource_type, v_req.contact_name, v_req.contact_phone,
        'INITIAL_REVIEW', COALESCE(ga_normalize_optional_text(p_assignee_name), v_name), now(), v_uid, v_req.id)
      RETURNING id INTO v_wo;
      INSERT INTO public.maintenance_ticket_events (ticket_id, event_type, previous_status, new_status, previous_progress_stage, new_progress_stage, description, visibility, created_by, metadata)
      VALUES (v_wo, 'ACCEPT', NULL, 'ACCEPTED', NULL, 'INITIAL_REVIEW', '由總務需求單 ' || v_req.request_no || ' 受理後建立維修工單。', 'PUBLIC', v_uid,
        jsonb_build_object('ga_service_request_id', v_req.id, 'ga_service_request_no', v_req.request_no));
      v_progress := v_progress || ' 已建立維修工單，後續由工單中心追蹤派工與處理進度。';
    END IF;
    UPDATE public.ga_service_requests SET main_status = 'ACCEPTED', intake_route = v_route, assignee_role = v_role, assignee_user_id = p_assignee_user,
      assignee_name = ga_normalize_optional_text(p_assignee_name), internal_note = ga_normalize_optional_text(p_internal_note), public_progress = v_progress, maintenance_request_id = v_wo
     WHERE id = p_id RETURNING * INTO v_req;
    v_desc := '承辦角色：' || v_role_label || '；後續處理方式：' || v_route_label;
    PERFORM public.ga_rq_event(p_id, 'REQUEST_ACCEPTED', 'PENDING_INTAKE', 'ACCEPTED', 'PUBLIC', '總務受理需求', v_desc,
      jsonb_build_object('action', 'accept', 'maintenance_request_id', v_wo), v_uid);
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', v_req.id, 'request_no', v_req.request_no, 'main_status', v_req.main_status,
      'intake_route', v_req.intake_route, 'maintenance_request_id', v_req.maintenance_request_id, 'updated_at', v_req.updated_at));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- ---------------------------------------------------------------- 11. 其他狀態流轉（Q17）：reject、request_supplement、update_progress、request_store_confirmation、assign、cancel、reopen、withdraw
CREATE OR REPLACE FUNCTION public.ga_ws_req_transition(p_id uuid, p_action text, p_expected_updated_at timestamptz, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.ga_service_requests%ROWTYPE;
  v_a text := lower(COALESCE(p_action, ''));
  v_p jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_manage boolean;
  v_docs jsonb;
  v_note text;
  v_new text;
  v_progress text;
  v_title text;
  v_desc text;
  v_type text;
  v_vis text := 'PUBLIC';
  v_reason text;
  v_why text;
  v_wo public.maintenance_requests%ROWTYPE;
  v_ful uuid;
  v_label text;
  v_rlabel text;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF v_a NOT IN ('reject', 'request_supplement', 'update_progress', 'request_store_confirmation', 'assign', 'cancel', 'reopen', 'withdraw') THEN
    RETURN public.ga_rq_err(400, 'INVALID_ACTION', '需求單處理動作錯誤');
  END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  v_manage := has_permission(v_uid, 'general_affairs.request.manage');
  BEGIN
    SELECT * INTO v_req FROM public.ga_service_requests WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到需求單'); END IF;
    IF v_a = 'withdraw' THEN
      IF NOT (v_req.created_by = v_uid OR public.ga_rq_is_store_member(v_uid, v_req.store_id)) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '只有提出需求的人或該門市店長可以撤回'); END IF;
    ELSIF NOT v_manage THEN
      RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有總務需求單管理權限');
    END IF;
    IF v_req.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張需求單剛被其他人更新，請重新載入後再操作'); END IF;
    v_docs := public.ga_rq_docs(p_id);
    v_note := ga_normalize_optional_text(v_p->>'note');
    v_reason := ga_normalize_optional_text(v_p->>'reason');

    IF v_a = 'withdraw' THEN
      IF v_req.main_status <> 'PENDING_INTAKE' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '總務已受理或已處理，不能撤回；請改用留言聯絡總務'); END IF;
      v_new := 'CANCELED'; v_progress := '門市已撤回需求。'; v_title := '門市撤回需求'; v_desc := COALESCE(v_reason, '門市撤回需求'); v_type := 'REQUEST_WITHDRAWN';
      UPDATE public.ga_service_requests SET main_status = v_new, public_progress = v_progress, cancel_reason = COALESCE(v_reason, '門市撤回') WHERE id = p_id;
    ELSIF v_a = 'cancel' THEN
      IF v_req.main_status NOT IN ('PENDING_INTAKE', 'WAITING_STORE_SUPPLEMENT', 'WAITING_GA_REVIEW', 'ACCEPTED', 'IN_PROGRESS') THEN
        RETURN public.ga_rq_err(409, 'INVALID_STATE', '目前狀態不可取消（等門市確認、已完成、已駁回、已取消的單不能取消）');
      END IF;
      IF v_reason IS NULL THEN RETURN public.ga_rq_err(400, 'REASON_REQUIRED', '取消需求單必須填寫原因'); END IF;
      IF (v_docs->>'issued')::numeric > 0 THEN RETURN public.ga_rq_err(409, 'HAS_DOCUMENTS', '這張需求單已經出庫，不能取消；請先在料件處理中心作廢單據或改用庫存調整'); END IF;
      IF (v_docs->>'po_count')::integer > 0 THEN RETURN public.ga_rq_err(409, 'HAS_DOCUMENTS', '這張需求單已有採購單（' || COALESCE(v_docs->>'po_nos', '') || '），不能取消；請先取消採購單'); END IF;
      IF (v_docs->>'transfer_active')::integer > 0 THEN RETURN public.ga_rq_err(409, 'HAS_DOCUMENTS', '這張需求單已有調撥單，不能取消；請先在料件處理中心作廢單據'); END IF;
      IF (v_docs->>'work_order_open')::boolean THEN RETURN public.ga_rq_err(409, 'HAS_WORK_ORDER', '這張需求單有進行中的維修工單，不能取消；請先在工單中心處理工單'); END IF;
      v_new := 'CANCELED'; v_progress := '總務已取消需求：' || v_reason; v_title := '總務取消需求'; v_desc := v_reason; v_type := 'REQUEST_CANCELED';
      UPDATE public.ga_service_requests SET main_status = v_new, public_progress = v_progress, cancel_reason = v_reason, internal_note = COALESCE(ga_normalize_optional_text(v_p->>'internal_note'), internal_note) WHERE id = p_id;
      UPDATE public.ga_part_fulfillments SET status = 'CANCELED', current_step = '需求單已取消', updated_by = v_uid WHERE request_id = p_id AND deleted_at IS NULL AND status NOT IN ('COMPLETED', 'CANCELED');
    ELSIF v_a = 'reject' THEN
      IF v_req.main_status NOT IN ('PENDING_INTAKE', 'WAITING_GA_REVIEW', 'ACCEPTED') THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '目前狀態不可駁回（只有待受理、待總務複核與已受理的單可以駁回）'); END IF;
      v_why := upper(COALESCE(ga_normalize_optional_text(v_p->>'rejection_reason'), ''));
      v_note := ga_normalize_optional_text(v_p->>'rejection_note');
      IF v_why NOT IN ('OUT_OF_SCOPE', 'INSUFFICIENT_DATA_RECREATE', 'DUPLICATE_REQUEST', 'NOT_ELIGIBLE', 'ALTERNATIVE_AVAILABLE', 'OTHER') THEN RETURN public.ga_rq_err(400, 'REASON_TYPE_INVALID', '駁回原因類型錯誤'); END IF;
      IF v_note IS NULL THEN RETURN public.ga_rq_err(400, 'REASON_REQUIRED', '駁回時必須填寫原因說明'); END IF;
      IF (v_docs->>'work_order_open')::boolean OR (v_docs->>'po_count')::integer > 0 OR (v_docs->>'issued')::numeric > 0 OR (v_docs->>'transfer_active')::integer > 0 THEN
        RETURN public.ga_rq_err(409, 'HAS_DOCUMENTS', '這張需求單已有進行中的工單或有效單據（採購單、出庫、調撥），不能駁回；請先作廢單據或取消採購單');
      END IF;
      v_rlabel := CASE v_why WHEN 'OUT_OF_SCOPE' THEN '不屬於總務/工務處理範圍' WHEN 'INSUFFICIENT_DATA_RECREATE' THEN '資料不足，請重新提出' WHEN 'DUPLICATE_REQUEST' THEN '重複申請'
                    WHEN 'NOT_ELIGIBLE' THEN '不符合採購/維修條件' WHEN 'ALTERNATIVE_AVAILABLE' THEN '已有替代處理方式' ELSE '其他' END;
      v_new := 'REJECTED'; v_progress := '總務已駁回：' || v_rlabel || '。' || v_note; v_title := '總務駁回需求'; v_desc := v_rlabel || '：' || v_note; v_type := 'REQUEST_REJECTED';
      UPDATE public.ga_service_requests SET main_status = v_new, rejection_reason = v_why, rejection_note = v_note, public_progress = v_progress, internal_note = COALESCE(ga_normalize_optional_text(v_p->>'internal_note'), internal_note) WHERE id = p_id;
    ELSIF v_a = 'request_supplement' THEN
      IF v_req.main_status NOT IN ('PENDING_INTAKE', 'WAITING_GA_REVIEW', 'ACCEPTED', 'IN_PROGRESS') THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '目前狀態不可要求補資料'); END IF;
      IF (v_docs->>'po_count')::integer > 0 THEN RETURN public.ga_rq_err(409, 'HAS_DOCUMENTS', '這張需求單已有採購單（' || COALESCE(v_docs->>'po_nos', '') || '，含草稿），不能請門市補資料；請改用留言，或先取消草稿採購單'); END IF;
      IF (v_docs->>'issued')::numeric > 0 THEN RETURN public.ga_rq_err(409, 'HAS_DOCUMENTS', '這張需求單已經出庫，不能請門市補資料；請改用留言'); END IF;
      v_why := upper(COALESCE(ga_normalize_optional_text(v_p->>'supplement_type'), ''));
      v_note := ga_normalize_optional_text(v_p->>'supplement_note');
      IF v_why NOT IN ('PHOTO_UNCLEAR', 'MISSING_PHOTO', 'DESCRIPTION_INSUFFICIENT', 'RESOURCE_SELECTION_WRONG', 'QUANTITY_OR_SPEC_INSUFFICIENT', 'OTHER') THEN RETURN public.ga_rq_err(400, 'REASON_TYPE_INVALID', '補資料類型錯誤'); END IF;
      IF v_note IS NULL THEN RETURN public.ga_rq_err(400, 'REASON_REQUIRED', '要求補資料時必須填寫說明'); END IF;
      v_rlabel := CASE v_why WHEN 'PHOTO_UNCLEAR' THEN '照片不清楚' WHEN 'MISSING_PHOTO' THEN '缺少必要照片' WHEN 'DESCRIPTION_INSUFFICIENT' THEN '問題描述不足'
                    WHEN 'RESOURCE_SELECTION_WRONG' THEN '設備/設施選擇錯誤' WHEN 'QUANTITY_OR_SPEC_INSUFFICIENT' THEN '數量/規格說明不足' ELSE '其他' END;
      v_new := 'WAITING_STORE_SUPPLEMENT'; v_progress := '總務要求補資料：' || v_rlabel || '。' || v_note; v_title := '總務要求門市補資料'; v_desc := v_rlabel || '：' || v_note; v_type := 'SUPPLEMENT_REQUESTED';
      UPDATE public.ga_service_requests SET main_status = v_new, supplement_type = v_why, supplement_note = v_note, public_progress = v_progress, internal_note = COALESCE(ga_normalize_optional_text(v_p->>'internal_note'), internal_note) WHERE id = p_id;
    ELSIF v_a = 'update_progress' THEN
      IF v_req.main_status NOT IN ('ACCEPTED', 'IN_PROGRESS') THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '目前狀態不可更新處理進度（需先受理）'); END IF;
      v_new := 'IN_PROGRESS';
      v_progress := CASE v_req.intake_route WHEN 'REPAIR_DISPATCH' THEN '維修需求已受理，目前由總務 / 工務處理中。' WHEN 'PURCHASE_REVIEW' THEN '添購需求已受理，目前由總務評估採購處理中。'
                    WHEN 'STOCK_ISSUE' THEN '需求已受理，目前由總務評估庫存出庫處理中。' WHEN 'TRANSFER' THEN '需求已受理，目前由總務評估調撥處理中。'
                    WHEN 'ASSET_TASK' THEN '需求已受理，目前由總務安排資產異動處理中。' ELSE '需求已受理，目前由總務處理中。' END;
      v_note := ga_normalize_optional_text(v_p->>'internal_note');
      v_title := '總務更新處理紀錄'; v_desc := COALESCE(v_note, v_progress); v_type := 'REQUEST_PROGRESS_UPDATED'; v_vis := CASE WHEN v_note IS NOT NULL THEN 'INTERNAL' ELSE 'PUBLIC' END;
      UPDATE public.ga_service_requests SET main_status = v_new, public_progress = v_progress, internal_note = COALESCE(v_note, internal_note) WHERE id = p_id;
    ELSIF v_a = 'request_store_confirmation' THEN
      IF v_req.main_status <> 'IN_PROGRESS' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '只有處理中的單可以送門市確認'); END IF;
      SELECT id INTO v_ful FROM public.ga_part_fulfillments WHERE request_id = p_id AND deleted_at IS NULL AND status NOT IN ('CANCELED');
      IF FOUND THEN RETURN public.ga_rq_err(409, 'USE_FULFILLMENT', '這張需求單有料件處理單，請到「料件處理中心」按「送門市確認」，需求單與處理單才會一起往下'); END IF;
      v_new := 'WAITING_STORE_CONFIRMATION'; v_progress := '總務已標記處理完成，等待門市確認結果。'; v_title := '總務送門市確認'; v_desc := v_progress; v_type := 'STORE_CONFIRMATION_REQUESTED';
      IF v_req.maintenance_request_id IS NOT NULL THEN
        SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = v_req.maintenance_request_id FOR UPDATE;
        IF FOUND THEN
          UPDATE public.maintenance_requests SET status = 'PROCESSING', progress_stage = 'WAITING_STORE_CONFIRMATION', completion_requested_at = now(), completion_requested_by = v_uid WHERE id = v_wo.id;
          INSERT INTO public.maintenance_updates (request_id, status, progress_stage, visibility, notes, updated_by, updated_by_name)
          VALUES (v_wo.id, 'PROCESSING', 'WAITING_STORE_CONFIRMATION', 'PUBLIC', v_progress, v_uid, COALESCE((SELECT full_name FROM public.profiles WHERE id = v_uid), 'Unknown'));
          INSERT INTO public.maintenance_ticket_events (ticket_id, event_type, previous_status, new_status, previous_progress_stage, new_progress_stage, description, visibility, created_by, metadata)
          VALUES (v_wo.id, 'REQUEST_COMPLETION', v_wo.status, 'PROCESSING', v_wo.progress_stage, 'WAITING_STORE_CONFIRMATION', v_progress, 'PUBLIC', v_uid, jsonb_build_object('source', 'ga_service_request_workspace'));
        END IF;
      END IF;
      UPDATE public.ga_service_requests SET main_status = v_new, public_progress = v_progress, internal_note = COALESCE(ga_normalize_optional_text(v_p->>'internal_note'), internal_note) WHERE id = p_id;
    ELSIF v_a = 'assign' THEN
      IF v_req.main_status IN ('COMPLETED', 'REJECTED', 'CANCELED') THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '已結案的單不能轉派'); END IF;
      v_why := upper(COALESCE(ga_normalize_optional_text(v_p->>'assignee_role'), ''));
      IF v_why NOT IN ('GENERAL_AFFAIRS', 'WORKS') THEN RETURN public.ga_rq_err(400, 'ROLE_REQUIRED', '轉派時必須選擇總務或工務角色'); END IF;
      v_label := CASE v_why WHEN 'GENERAL_AFFAIRS' THEN '總務' ELSE '工務' END;
      v_new := v_req.main_status; v_progress := '需求已轉由' || v_label || '評估。'; v_title := '總務轉派承辦角色'; v_desc := '承辦角色：' || v_label; v_type := 'REQUEST_ASSIGNED';
      UPDATE public.ga_service_requests SET assignee_role = v_why, assignee_user_id = NULLIF(v_p->>'assignee_user_id', '')::uuid, assignee_name = ga_normalize_optional_text(v_p->>'assignee_name'),
        public_progress = v_progress, internal_note = COALESCE(ga_normalize_optional_text(v_p->>'internal_note'), internal_note) WHERE id = p_id;
    ELSE -- reopen
      IF v_req.main_status NOT IN ('COMPLETED', 'REJECTED') THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '只有已完成或已駁回的單可以重新開啟'); END IF;
      IF v_reason IS NULL THEN RETURN public.ga_rq_err(400, 'REASON_REQUIRED', '重新開啟必須填寫原因'); END IF;
      v_new := CASE v_req.main_status WHEN 'COMPLETED' THEN 'IN_PROGRESS' ELSE 'PENDING_INTAKE' END;
      v_progress := '總務已重新開啟需求：' || v_reason; v_title := '總務重新開啟需求'; v_desc := v_reason; v_type := 'REQUEST_REOPENED';
      UPDATE public.ga_service_requests SET main_status = v_new, public_progress = v_progress, reopened_count = reopened_count + 1, completed_at = NULL, confirmed_at = NULL WHERE id = p_id;
      UPDATE public.ga_part_fulfillments SET status = 'EXCEPTION', current_step = '需求單已重新開啟，請重新決定處理方式', updated_by = v_uid
       WHERE request_id = p_id AND deleted_at IS NULL AND status = 'COMPLETED';
      IF v_req.main_status = 'COMPLETED' AND v_req.maintenance_request_id IS NOT NULL THEN
        SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = v_req.maintenance_request_id FOR UPDATE;
        IF FOUND AND v_wo.status = 'COMPLETED' THEN
          UPDATE public.maintenance_requests SET status = 'PROCESSING', progress_stage = 'REOPENED' WHERE id = v_wo.id;
          INSERT INTO public.maintenance_updates (request_id, status, progress_stage, visibility, notes, updated_by, updated_by_name)
          VALUES (v_wo.id, 'PROCESSING', 'REOPENED', 'PUBLIC', v_progress, v_uid, COALESCE((SELECT full_name FROM public.profiles WHERE id = v_uid), 'Unknown'));
        END IF;
      END IF;
    END IF;
    PERFORM public.ga_rq_event(p_id, v_type, v_req.main_status, v_new, v_vis, v_title, v_desc, jsonb_build_object('action', v_a, 'reason', v_reason), v_uid);
    SELECT * INTO v_req FROM public.ga_service_requests WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', v_req.id, 'request_no', v_req.request_no, 'main_status', v_req.main_status, 'public_progress', v_req.public_progress, 'updated_at', v_req.updated_at));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- ---------------------------------------------------------------- 12. 門市動作（補資料、確認完成、回報有問題；Q16 總務代按須說明並標記）
CREATE OR REPLACE FUNCTION public.ga_ws_req_store_action(p_id uuid, p_action text, p_note text, p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.ga_service_requests%ROWTYPE;
  v_a text := lower(COALESCE(p_action, ''));
  v_note text := ga_normalize_optional_text(p_note);
  v_manage boolean;
  v_member boolean;
  v_proxy boolean := false;
  v_allowed boolean;
  v_need text;
  v_new text;
  v_progress text;
  v_title text;
  v_type text;
  v_body text;
  v_wo public.maintenance_requests%ROWTYPE;
  v_ful public.ga_part_fulfillments%ROWTYPE;
  v_stage text;
  v_mstatus text;
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF v_a NOT IN ('submit_supplement', 'confirm_complete', 'report_problem') THEN RETURN public.ga_rq_err(400, 'INVALID_ACTION', '門市回覆動作錯誤'); END IF;
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN RETURN public.ga_rq_err(400, 'NOTE_TOO_LONG', '說明不可超過 2000 字'); END IF;
  IF v_a = 'submit_supplement' AND v_note IS NULL THEN RETURN public.ga_rq_err(400, 'NOTE_REQUIRED', '補充資料必須填寫回覆說明'); END IF;
  IF v_a = 'report_problem' AND v_note IS NULL THEN RETURN public.ga_rq_err(400, 'NOTE_REQUIRED', '回報有問題必須填寫問題原因'); END IF;
  BEGIN
    SELECT * INTO v_req FROM public.ga_service_requests WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到需求單'); END IF;
    v_manage := has_permission(v_uid, 'general_affairs.request.manage');
    v_member := public.ga_rq_is_store_member(v_uid, v_req.store_id);
    v_allowed := CASE WHEN v_a = 'submit_supplement' THEN v_manage OR (has_permission(v_uid, 'general_affairs.request.comment_own_store') AND v_member)
                      ELSE v_manage OR (has_permission(v_uid, 'general_affairs.request.confirm_own_store') AND v_member) END;
    IF NOT v_allowed THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有門市回覆此需求單的權限'); END IF;
    -- 總務代門市操作：操作人是需求單管理者、又不是該門市名單上的人。
    v_proxy := v_manage AND NOT v_member;
    IF p_expected_updated_at IS NOT NULL AND v_req.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張需求單剛被其他人更新，請重新載入後再操作'); END IF;
    v_need := CASE WHEN v_a = 'submit_supplement' THEN 'WAITING_STORE_SUPPLEMENT' ELSE 'WAITING_STORE_CONFIRMATION' END;
    IF v_req.main_status <> v_need THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '目前狀態不可執行此動作，需求單狀態為 ' || v_req.main_status); END IF;
    IF v_proxy AND v_note IS NULL THEN RETURN public.ga_rq_err(400, 'PROXY_NOTE_REQUIRED', '總務代門市操作必須填寫說明（例如：店長電話確認收到）'); END IF;
    IF v_a = 'submit_supplement' THEN
      v_new := 'WAITING_GA_REVIEW'; v_progress := '門市已補充資料，等待總務複核。'; v_title := '門市補充資料'; v_type := 'STORE_SUPPLEMENT_SUBMITTED'; v_body := v_note;
      UPDATE public.ga_service_requests SET main_status = v_new, public_progress = v_progress WHERE id = p_id;
    ELSIF v_a = 'confirm_complete' THEN
      v_new := 'COMPLETED'; v_progress := CASE WHEN v_proxy THEN '總務代門市確認完成。' ELSE '門市已確認完成。' END; v_title := CASE WHEN v_proxy THEN '總務代門市確認完成' ELSE '門市確認完成' END;
      v_type := 'STORE_COMPLETION_CONFIRMED'; v_body := COALESCE(v_note, '門市確認完成。');
      UPDATE public.ga_service_requests SET main_status = v_new, public_progress = v_progress, completed_at = v_now, confirmed_at = v_now WHERE id = p_id;
    ELSE
      v_new := 'IN_PROGRESS'; v_progress := CASE WHEN v_proxy THEN '總務代門市回報完成結果仍有問題，已退回處理。' ELSE '門市回報完成結果仍有問題，已退回總務處理。' END || v_note;
      v_title := CASE WHEN v_proxy THEN '總務代門市回報仍有問題' ELSE '門市回報仍有問題' END; v_type := 'STORE_COMPLETION_REPORTED_PROBLEM'; v_body := v_note;
      UPDATE public.ga_service_requests SET main_status = v_new, public_progress = v_progress WHERE id = p_id;
    END IF;
    IF v_proxy THEN v_body := '【總務代門市操作】' || COALESCE(v_body, ''); END IF;
    -- 同步連結的維修工單（沿用舊版）。
    IF v_a <> 'submit_supplement' AND v_req.maintenance_request_id IS NOT NULL THEN
      SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = v_req.maintenance_request_id FOR UPDATE;
      IF FOUND THEN
        v_mstatus := CASE WHEN v_a = 'confirm_complete' THEN 'COMPLETED' ELSE 'PROCESSING' END;
        v_stage := CASE WHEN v_a = 'confirm_complete' THEN COALESCE(v_wo.progress_stage, 'WAITING_STORE_CONFIRMATION') ELSE 'REOPENED' END;
        IF v_a = 'confirm_complete' THEN
          UPDATE public.maintenance_requests SET status = v_mstatus, progress_stage = v_stage, completed_at = v_now, completed_by = v_uid, completion_method = 'STORE_CONFIRMED' WHERE id = v_wo.id;
        ELSE
          UPDATE public.maintenance_requests SET status = v_mstatus, progress_stage = v_stage, unresolved_reason = v_note WHERE id = v_wo.id;
        END IF;
        INSERT INTO public.maintenance_updates (request_id, status, progress_stage, visibility, notes, updated_by, updated_by_name)
        VALUES (v_wo.id, v_mstatus, v_stage, 'PUBLIC', v_body, v_uid, COALESCE((SELECT full_name FROM public.profiles WHERE id = v_uid), 'Unknown'));
        INSERT INTO public.maintenance_ticket_events (ticket_id, event_type, previous_status, new_status, previous_progress_stage, new_progress_stage, description, visibility, created_by, metadata)
        VALUES (v_wo.id, CASE WHEN v_a = 'confirm_complete' THEN 'STORE_CONFIRM_COMPLETE' ELSE 'REPORT_UNRESOLVED' END, v_wo.status, v_mstatus, v_wo.progress_stage, v_stage, v_body, 'PUBLIC', v_uid,
          jsonb_build_object('source', 'ga_service_request_store_action', 'proxy_for_store', v_proxy));
      END IF;
    END IF;
    -- 同步料件處理單。
    SELECT * INTO v_ful FROM public.ga_part_fulfillments WHERE request_id = p_id AND deleted_at IS NULL FOR UPDATE;
    IF FOUND THEN
      IF v_a = 'confirm_complete' THEN
        UPDATE public.ga_part_fulfillments SET status = 'COMPLETED', current_step = '門市已確認收貨，處理完成', updated_by = v_uid WHERE id = v_ful.id;
      ELSIF v_a = 'report_problem' THEN
        UPDATE public.ga_part_fulfillments SET status = 'EXCEPTION', current_step = '門市回報異常，等待總務處理', updated_by = v_uid WHERE id = v_ful.id;
      END IF;
      INSERT INTO public.ga_part_fulfillment_events (fulfillment_id, event_type, title, description, metadata, created_by)
      VALUES (v_ful.id, CASE v_a WHEN 'confirm_complete' THEN 'STORE_CONFIRMED' WHEN 'report_problem' THEN 'STORE_REPORTED_PROBLEM' ELSE 'STORE_SUPPLEMENT_SUBMITTED' END,
        CASE v_a WHEN 'confirm_complete' THEN CASE WHEN v_proxy THEN '總務代門市確認收貨' ELSE '門市已確認收貨' END WHEN 'report_problem' THEN '門市回報收貨異常' ELSE '門市補充資料' END,
        v_body, jsonb_build_object('source', 'ga_service_request_store_action', 'action', v_a, 'previous_status', v_ful.status, 'proxy_for_store', v_proxy), v_uid);
    END IF;
    INSERT INTO public.ga_service_request_comments (request_id, visibility, body, created_by, created_by_name)
    VALUES (p_id, 'PUBLIC', v_body, v_uid, (SELECT full_name FROM public.profiles WHERE id = v_uid));
    PERFORM public.ga_rq_event(p_id, v_type, v_req.main_status, v_new, 'PUBLIC', v_title, v_body, jsonb_build_object('action', v_a, 'maintenance_request_id', v_req.maintenance_request_id, 'proxy_for_store', v_proxy), v_uid, v_proxy);
    SELECT * INTO v_req FROM public.ga_service_requests WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', v_req.id, 'request_no', v_req.request_no, 'main_status', v_req.main_status,
      'public_progress', v_req.public_progress, 'proxy_for_store', v_proxy, 'updated_at', v_req.updated_at));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- ---------------------------------------------------------------- 13. 留言（新增、編輯、刪除、總務標記已讀；Q16）
-- 編輯或刪除門市留言：保留原文（只給總務看）、留言本身顯示「已編輯／已刪除」。總務自己的留言與內部備註只有總務能改刪。
CREATE OR REPLACE FUNCTION public.ga_ws_req_comment(p_id uuid, p_op text, p_comment_id uuid DEFAULT NULL, p_body text DEFAULT NULL, p_visibility text DEFAULT 'PUBLIC', p_source text DEFAULT 'GA_WORKBENCH')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_op text := lower(COALESCE(p_op, ''));
  v_req public.ga_service_requests%ROWTYPE;
  v_c public.ga_service_request_comments%ROWTYPE;
  v_body text := ga_normalize_optional_text(p_body);
  v_vis text := CASE WHEN upper(COALESCE(p_visibility, '')) = 'INTERNAL' THEN 'INTERNAL' ELSE 'PUBLIC' END;
  v_src text := CASE WHEN upper(COALESCE(p_source, '')) = 'STORE_TRACKING' THEN 'STORE_TRACKING' ELSE 'GA_WORKBENCH' END;
  v_manage boolean;
  v_member boolean;
  v_can_store boolean;
  v_srcctx text;
  v_can boolean;
  v_new_id uuid;
  v_read timestamptz;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF v_op NOT IN ('add', 'edit', 'delete', 'read') THEN RETURN public.ga_rq_err(400, 'INVALID_ACTION', '留言動作錯誤'); END IF;
  IF v_op IN ('add', 'edit') AND v_body IS NULL THEN RETURN public.ga_rq_err(400, 'BODY_REQUIRED', '請填寫留言內容'); END IF;
  IF v_body IS NOT NULL AND length(v_body) > 2000 THEN RETURN public.ga_rq_err(400, 'BODY_TOO_LONG', '留言不可超過 2000 字'); END IF;
  BEGIN
    SELECT * INTO v_req FROM public.ga_service_requests WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到需求單'); END IF;
    v_manage := has_permission(v_uid, 'general_affairs.request.manage');
    v_member := public.ga_rq_is_store_member(v_uid, v_req.store_id);
    v_can_store := has_permission(v_uid, 'general_affairs.request.comment_own_store') AND v_member;
    IF v_op = 'add' THEN
      IF NOT (v_manage OR (v_vis = 'PUBLIC' AND v_can_store)) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有留言此需求單的權限'); END IF;
      IF NOT v_manage AND v_vis = 'INTERNAL' THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '門市留言只能設為公開'); END IF;
      INSERT INTO public.ga_service_request_comments (request_id, visibility, body, created_by, created_by_name)
      VALUES (p_id, v_vis, v_body, v_uid, (SELECT full_name FROM public.profiles WHERE id = v_uid)) RETURNING id INTO v_new_id;
      PERFORM public.ga_rq_event(p_id, CASE WHEN v_vis = 'INTERNAL' THEN 'INTERNAL_COMMENT_ADDED' ELSE 'PUBLIC_COMMENT_ADDED' END, v_req.main_status, v_req.main_status, v_vis,
        CASE WHEN v_vis = 'INTERNAL' THEN '總務新增內部備註' ELSE '新增公開留言' END, v_body, jsonb_build_object('comment_id', v_new_id, 'source_context', v_src), v_uid);
      RETURN jsonb_build_object('ok', true, 'status', 201, 'data', jsonb_build_object('id', v_new_id));
    END IF;
    SELECT * INTO v_c FROM public.ga_service_request_comments WHERE id = p_comment_id AND request_id = p_id FOR UPDATE;
    IF NOT FOUND OR v_c.deleted_at IS NOT NULL THEN RETURN public.ga_rq_err(404, 'COMMENT_NOT_FOUND', '找不到留言'); END IF;
    SELECT COALESCE((SELECT e.metadata->>'source_context' FROM public.ga_service_request_events e WHERE e.request_id = p_id AND e.event_type = 'PUBLIC_COMMENT_ADDED' AND e.metadata->>'comment_id' = p_comment_id::text LIMIT 1),
                    CASE WHEN v_c.created_by = v_req.created_by THEN 'STORE_TRACKING' ELSE 'UNKNOWN' END) INTO v_srcctx;
    IF v_op = 'read' THEN
      IF NOT v_manage THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有總務需求單管理權限'); END IF;
      IF v_c.visibility <> 'PUBLIC' OR v_srcctx <> 'STORE_TRACKING' THEN RETURN public.ga_rq_err(404, 'COMMENT_NOT_FOUND', '找不到指定的門市留言'); END IF;
      IF EXISTS (SELECT 1 FROM public.ga_service_request_events e WHERE e.request_id = p_id AND e.event_type = 'STORE_COMMENT_READ' AND e.metadata->>'comment_id' = p_comment_id::text) THEN
        RETURN jsonb_build_object('ok', true, 'status', 200, 'already_read', true, 'data', jsonb_build_object('id', p_comment_id));
      END IF;
      PERFORM public.ga_rq_event(p_id, 'STORE_COMMENT_READ', v_req.main_status, v_req.main_status, 'PUBLIC', '已閱讀門市留言',
        COALESCE((SELECT full_name FROM public.profiles WHERE id = v_uid) || ' 已閱讀門市留言。', '總務人員已閱讀門市留言。'), jsonb_build_object('comment_id', p_comment_id, 'read_at', now()), v_uid);
      RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', p_comment_id));
    END IF;
    v_can := (v_c.created_by = v_uid AND v_c.visibility = 'PUBLIC' AND v_can_store) OR (v_srcctx <> 'STORE_TRACKING' AND v_manage);
    IF NOT v_can THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', CASE WHEN v_op = 'edit' THEN '沒有編輯此留言的權限' ELSE '沒有刪除此留言的權限' END); END IF;
    IF v_op = 'edit' THEN
      UPDATE public.ga_service_request_comments SET original_body = COALESCE(original_body, v_c.body), body = v_body, edited_at = now() WHERE id = v_c.id;
      PERFORM public.ga_rq_event(p_id, CASE WHEN v_c.visibility = 'INTERNAL' THEN 'INTERNAL_COMMENT_EDITED' ELSE 'PUBLIC_COMMENT_EDITED' END, v_req.main_status, v_req.main_status, v_c.visibility,
        CASE WHEN v_c.visibility = 'INTERNAL' THEN '總務編輯內部備註' ELSE '留言已編輯' END, v_body, jsonb_build_object('comment_id', v_c.id, 'previous_body', v_c.body), v_uid);
    ELSE
      UPDATE public.ga_service_request_comments SET original_body = COALESCE(original_body, v_c.body), deleted_at = now() WHERE id = v_c.id;
      PERFORM public.ga_rq_event(p_id, CASE WHEN v_c.visibility = 'INTERNAL' THEN 'INTERNAL_COMMENT_DELETED' ELSE 'PUBLIC_COMMENT_DELETED' END, v_req.main_status, v_req.main_status, v_c.visibility,
        CASE WHEN v_c.visibility = 'INTERNAL' THEN '總務刪除內部備註' ELSE '留言已刪除' END, v_c.body, jsonb_build_object('comment_id', v_c.id, 'deleted_at', now()), v_uid);
    END IF;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', v_c.id));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- ---------------------------------------------------------------- 14. 逾期未確認天數設定（D5）
CREATE OR REPLACE FUNCTION public.ga_ws_req_settings_set(p_days integer, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.ga_workflow_settings%ROWTYPE;
  v_new public.ga_workflow_settings%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.request.manage') THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有總務需求單管理權限，不能修改逾期天數'); END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 90 THEN RETURN public.ga_rq_err(400, 'DAYS_INVALID', '逾期天數必須是 1 到 90 的整數'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  BEGIN
    SELECT * INTO v_row FROM public.ga_workflow_settings WHERE key = 'request_overdue_confirm_days' FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到設定'); END IF;
    IF v_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '設定剛被其他人修改，請重新載入後再操作'); END IF;
    IF v_row.value_num = p_days THEN RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('overdue_days', p_days, 'updated_at', v_row.updated_at)); END IF;
    UPDATE public.ga_workflow_settings SET value_num = p_days, updated_by = v_uid, updated_at = clock_timestamp() WHERE key = 'request_overdue_confirm_days' RETURNING * INTO v_new;
    INSERT INTO public.ga_workflow_setting_events (setting_key, old_value_num, new_value_num, actor_id, note) VALUES ('request_overdue_confirm_days', v_row.value_num, p_days, v_uid, '需求單逾期未確認天數');
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('overdue_days', p_days, 'updated_at', v_new.updated_at));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- ---------------------------------------------------------------- 15. 需求單庫存出庫（Q18：不得超過需求量、料件須與需求相同，替代料須原因）
-- 數量以「需求單的單位」換算後與剩餘需求量比較；出庫單位 BASE（基本單位）或 PURCHASE（採購單位）。
CREATE OR REPLACE FUNCTION public.ga_ws_req_stock_issue(p_id uuid, p_location_id uuid, p_part_id uuid, p_quantity numeric, p_input_unit_type text, p_reason text, p_notes text, p_substitute_reason text, p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.ga_service_requests%ROWTYPE;
  v_part public.ga_parts%ROWTYPE;
  v_rpart public.ga_parts%ROWTYPE;
  v_ful public.ga_part_fulfillments%ROWTYPE;
  v_unit text := upper(COALESCE(ga_normalize_optional_text(p_input_unit_type), 'BASE'));
  v_sub text := ga_normalize_optional_text(p_substitute_reason);
  v_reason text;
  v_base numeric;
  v_in_req_unit numeric;
  v_conv numeric := 1;
  v_committed numeric;
  v_remaining numeric;
  v_res jsonb;
  v_tx jsonb;
  v_issued numeric;
  v_old_status text;
  v_replay boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.part_fulfillment.manage') THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有料件處理管理權限'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.inventory_transaction.manage') THEN RETURN public.ga_rq_err(403, 'TRANSACTION_PERMISSION_REQUIRED', '沒有庫存交易管理權限'); END IF;
  IF NOT (has_permission(v_uid, 'general_affairs.part.view') OR has_permission(v_uid, 'general_affairs.part.manage')) THEN RETURN public.ga_rq_err(403, 'PART_VIEW_REQUIRED', '缺少料件查看權限，無法建立需求單出庫'); END IF;
  IF p_location_id IS NULL OR p_part_id IS NULL THEN RETURN public.ga_rq_err(400, 'FIELDS_REQUIRED', '請選擇出庫位置與料件'); END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RETURN public.ga_rq_err(400, 'QUANTITY_INVALID', '數量必須大於 0'); END IF;
  IF v_unit NOT IN ('BASE', 'PURCHASE') THEN RETURN public.ga_rq_err(400, 'UNIT_INVALID', '單位類型錯誤'); END IF;
  IF ga_normalize_optional_text(p_key) IS NULL THEN RETURN public.ga_rq_err(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少防重複識別碼，請重新整理畫面後再送出'); END IF;
  BEGIN
    SELECT * INTO v_req FROM public.ga_service_requests WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到需求單'); END IF;
    -- 同一個固定識別重送（流水已存在）：不看目前狀態、不重算剩餘量、不重寫事件，直接回原結果。
    SELECT EXISTS (SELECT 1 FROM public.ga_inventory_transactions WHERE idempotency_key = p_key AND reference_type = 'GA_SERVICE_REQUEST' AND reference_id = p_id) INTO v_replay;
    IF v_req.intake_route IS DISTINCT FROM 'STOCK_ISSUE' AND NOT v_replay THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '此需求單尚未分流為庫存出庫，請先受理並選擇庫存出庫'); END IF;
    IF v_req.main_status NOT IN ('ACCEPTED', 'IN_PROGRESS') AND NOT v_replay THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '此需求單狀態目前不可執行庫存出庫'); END IF;
    IF COALESCE(v_req.resource_type, '') <> 'PART' OR v_req.part_id IS NULL THEN RETURN public.ga_rq_err(422, 'NOT_PART_STOCK', '只有料件需求可以走庫存出庫'); END IF;
    SELECT * INTO v_part FROM public.ga_parts WHERE id = p_part_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'PART_NOT_FOUND', '找不到料件'); END IF;
    IF p_part_id <> v_req.part_id AND v_sub IS NULL THEN
      RETURN public.ga_rq_err(422, 'SUBSTITUTE_REASON_REQUIRED', '出庫的料件和需求單的料件不同；若是替代料請填寫替代原因', jsonb_build_object('requested_part_id', v_req.part_id));
    END IF;
    -- 換算：出庫量（基本單位）→ 需求單的單位。
    IF v_unit = 'PURCHASE' THEN
      IF v_part.purchase_unit IS NULL OR COALESCE(v_part.purchase_to_base_rate, 0) <= 0 THEN RETURN public.ga_rq_err(400, 'UNIT_INVALID', '這個料件沒有設定採購單位'); END IF;
      v_base := p_quantity * v_part.purchase_to_base_rate;
    ELSE
      v_base := p_quantity;
    END IF;
    v_in_req_unit := v_base;
    IF p_part_id = v_req.part_id AND v_req.desired_unit IS NOT NULL AND v_part.purchase_unit IS NOT NULL AND v_req.desired_unit = v_part.purchase_unit
       AND v_req.desired_unit <> v_part.base_unit AND COALESCE(v_part.purchase_to_base_rate, 0) > 0 THEN
      v_conv := v_part.purchase_to_base_rate;
      v_in_req_unit := v_base / v_conv;
    END IF;
    SELECT * INTO v_ful FROM public.ga_part_fulfillments WHERE request_id = p_id AND deleted_at IS NULL FOR UPDATE;
    IF v_req.desired_quantity IS NOT NULL AND NOT v_replay THEN
      SELECT COALESCE(sum(d.quantity), 0) INTO v_committed FROM public.ga_part_fulfillment_documents d
       WHERE d.fulfillment_id = v_ful.id AND d.voided_at IS NULL AND COALESCE(d.status, '') <> 'CANCELED' AND d.document_type IN ('STOCK_ISSUE', 'TRANSFER');
      v_committed := COALESCE(v_committed, 0);
      v_remaining := GREATEST(0, v_req.desired_quantity - v_committed);
      IF v_in_req_unit > v_remaining + 0.00005 THEN
        RETURN public.ga_rq_err(409, 'OVER_REQUEST', '出庫數量不可超過剩餘需求量 ' || public.ga_po_fmt(v_remaining) || ' ' || COALESCE(v_req.desired_unit, ''), jsonb_build_object('remaining', v_remaining));
      END IF;
    END IF;
    v_reason := '需求單出庫 ' || v_req.request_no || COALESCE('｜' || ga_normalize_optional_text(p_reason), '') || CASE WHEN v_sub IS NOT NULL THEN '｜替代料：' || v_sub ELSE '' END;
    PERFORM set_config('app.ga_inv_internal_post', 'true', true);
    v_res := public.ga_ws_inv_post('ISSUE', p_location_id, p_part_id, p_quantity, v_unit, v_reason, ga_normalize_optional_text(p_notes), p_key, NULL, 'GA_SERVICE_REQUEST', p_id,
      jsonb_build_object('source', 'ga_service_request_stock_issue', 'service_request_id', p_id, 'service_request_no', v_req.request_no, 'requested_store_id', v_req.store_id,
        'requested_quantity', v_req.desired_quantity, 'requested_unit', v_req.desired_unit, 'substitute_reason', v_sub));
    IF COALESCE((v_res->>'ok')::boolean, false) IS NOT TRUE THEN
      PERFORM public.ga_rq_raise(COALESCE((v_res->>'status')::integer, 500), COALESCE(v_res->>'code', 'POST_FAILED'), COALESCE(v_res->>'error', '庫存出庫失敗'), (v_res - 'ok' - 'status' - 'code' - 'error'));
    END IF;
    v_tx := v_res->'data';
    IF v_replay THEN
      RETURN jsonb_build_object('ok', true, 'status', 200, 'idempotent_replay', true,
        'data', jsonb_build_object('request_id', p_id, 'main_status', v_req.main_status, 'fulfillment_id', v_ful.id, 'issued', COALESCE(v_ful.fulfilled_quantity, 0), 'transaction', v_tx));
    END IF;
    v_old_status := v_req.main_status;
    UPDATE public.ga_service_requests SET main_status = 'IN_PROGRESS', public_progress = '總務已完成需求單庫存出庫，後續等待配送、領用或門市確認結果。' WHERE id = p_id;
    PERFORM public.ga_rq_event(p_id, 'STOCK_ISSUED', v_old_status, 'IN_PROGRESS', 'PUBLIC', '需求單庫存出庫', '總務已完成需求單庫存出庫，後續等待配送、領用或門市確認結果。',
      jsonb_build_object('action', 'stock_issue', 'transaction_id', v_tx->>'transaction_id', 'transaction_no', v_tx->>'transaction_no', 'location_id', p_location_id, 'part_id', p_part_id,
        'quantity', p_quantity, 'input_unit_type', v_unit, 'substitute_reason', v_sub, 'reason', v_reason), v_uid);
    IF v_ful.id IS NULL THEN
      INSERT INTO public.ga_part_fulfillments (request_id, status, requested_quantity, unit, current_step, created_by, updated_by)
      VALUES (p_id, 'STOCK_ISSUE', v_req.desired_quantity, v_req.desired_unit, '已建立出庫單', v_uid, v_uid) RETURNING * INTO v_ful;
    END IF;
    INSERT INTO public.ga_part_fulfillment_documents (fulfillment_id, document_type, document_id, document_no, quantity, status, created_by)
    VALUES (v_ful.id, 'STOCK_ISSUE', (v_tx->>'transaction_id')::uuid, v_tx->>'transaction_no', v_in_req_unit, 'POSTED', v_uid)
    ON CONFLICT (fulfillment_id, document_type, document_id) DO NOTHING;
    v_issued := public.ga_ful_recompute(v_ful.id);
    UPDATE public.ga_part_fulfillments SET status = CASE WHEN status IN ('COMPLETED', 'CANCELED', 'WAITING_STORE_CONFIRMATION') THEN status ELSE 'STOCK_ISSUE' END,
      current_step = CASE WHEN COALESCE(v_req.desired_quantity, 0) > v_issued THEN '已出庫 ' || public.ga_po_fmt(v_issued) || ' / ' || public.ga_po_fmt(v_req.desired_quantity) || ' ' || COALESCE(v_req.desired_unit, '') || '，可繼續處理剩餘數量'
                          ELSE '已完成出庫，待交付（請按「送門市確認」）' END,
      updated_by = v_uid WHERE id = v_ful.id;
    INSERT INTO public.ga_part_fulfillment_events (fulfillment_id, event_type, title, description, metadata, created_by)
    VALUES (v_ful.id, 'STOCK_ISSUED', '需求單庫存出庫', v_reason, jsonb_build_object('transaction_no', v_tx->>'transaction_no', 'quantity', p_quantity, 'substitute_reason', v_sub), v_uid);
    RETURN jsonb_build_object('ok', true, 'status', COALESCE((v_res->>'status')::integer, 201), 'data', jsonb_build_object('request_id', p_id, 'main_status', 'IN_PROGRESS', 'fulfillment_id', v_ful.id, 'issued', v_issued, 'transaction', v_tx));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- ---------------------------------------------------------------- 16. 採購評估（D1：選「進入採購」時同交易產生草稿採購單；Q18：改決策時舊採購單標取消、報價保留歷史）
-- p_payload（snake_case）：decision、vendor_id、vendor_name、approved_quantity、approved_unit、estimated_amount、quoted_amount、negotiated_amount、final_amount、expected_delivery_date、
--   delivery_method、receiving_location_id、substitute_description、decision_note、public_note、quote_lead_time_days、quote_notes
CREATE OR REPLACE FUNCTION public.ga_ws_req_purchase_review(p_id uuid, p_payload jsonb, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_req public.ga_service_requests%ROWTYPE;
  v_rev public.ga_purchase_reviews%ROWTYPE;
  v_old_decision text;
  v_dec text := upper(COALESCE(v_p->>'decision', ''));
  v_label text;
  v_pub text;
  v_note text;
  v_new_status text;
  v_route text;
  v_progress text;
  v_po record;
  v_pr jsonb;
  v_po_res jsonb;
  v_docs jsonb;
  v_ful_id uuid;
  v_vendor uuid := NULLIF(v_p->>'vendor_id', '')::uuid;
  v_n integer := 0;
  v_cancel jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.purchase_review.manage') THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有採購評估管理權限'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  IF v_dec NOT IN ('REJECT', 'STOCK_ISSUE', 'TRANSFER', 'PURCHASE', 'SUBSTITUTE') THEN RETURN public.ga_rq_err(400, 'DECISION_INVALID', '請選擇採購評估結果'); END IF;
  v_note := ga_normalize_optional_text(v_p->>'decision_note');
  IF v_note IS NULL THEN RETURN public.ga_rq_err(400, 'NOTE_REQUIRED', '請填寫評估說明'); END IF;
  BEGIN
    SELECT * INTO v_req FROM public.ga_service_requests WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到需求單'); END IF;
    IF v_req.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張需求單剛被其他人更新，請重新載入後再操作'); END IF;
    IF v_req.intake_route IS DISTINCT FROM 'PURCHASE_REVIEW' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '此需求單尚未分流為添購 / 採購評估'); END IF;
    IF v_req.main_status NOT IN ('ACCEPTED', 'IN_PROGRESS', 'WAITING_GA_REVIEW') THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '此需求單狀態目前不可執行採購評估'); END IF;
    IF v_req.request_type = 'REPAIR' THEN RETURN public.ga_rq_err(422, 'REPAIR_NOT_PURCHASE', '維修單不能走採購評估'); END IF;
    IF v_dec = 'PURCHASE' AND NULLIF(v_p->>'approved_quantity', '')::numeric IS NULL THEN RETURN public.ga_rq_err(400, 'QUANTITY_REQUIRED', '進入採購時請填寫核准數量'); END IF;
    IF v_dec = 'SUBSTITUTE' AND ga_normalize_optional_text(v_p->>'substitute_description') IS NULL THEN RETURN public.ga_rq_err(400, 'SUBSTITUTE_REQUIRED', '改用替代品時請填寫替代品說明'); END IF;
    IF v_dec = 'REJECT' AND ga_normalize_optional_text(v_p->>'public_note') IS NULL THEN RETURN public.ga_rq_err(400, 'PUBLIC_NOTE_REQUIRED', '駁回時請填寫門市可見說明'); END IF;
    IF v_vendor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ga_vendors WHERE id = v_vendor) THEN RETURN public.ga_rq_err(400, 'VENDOR_INVALID', '找不到指定的供應商'); END IF;
    SELECT * INTO v_rev FROM public.ga_purchase_reviews WHERE request_id = p_id AND deleted_at IS NULL FOR UPDATE;
    v_old_decision := CASE WHEN FOUND THEN v_rev.decision ELSE NULL END;

    -- 改決策：舊的採購單標已取消（已到貨者擋）。
    IF v_old_decision = 'PURCHASE' AND v_dec <> 'PURCHASE' AND to_regclass('public.ga_purchase_orders') IS NOT NULL THEN
      v_docs := public.ga_rq_docs(p_id);
      IF (v_docs->>'po_received')::integer > 0 THEN
        RETURN public.ga_rq_err(409, 'PO_ALREADY_RECEIVED', '這張需求單已有採購單到貨（' || COALESCE(v_docs->>'po_nos', '') || '），不能改變採購決策');
      END IF;
      FOR v_po IN EXECUTE 'SELECT o.id, o.po_no, o.status, o.updated_at FROM public.ga_purchase_orders o WHERE o.status NOT IN (''CANCELED'', ''CLOSED'') AND (o.purchase_review_id = $1 OR o.source_request_id = $2)' USING v_rev.id, p_id LOOP
        v_cancel := public.ga_ws_po_action(v_po.id, 'cancel', v_po.updated_at, '採購評估改為「' || CASE v_dec WHEN 'REJECT' THEN '駁回' WHEN 'STOCK_ISSUE' THEN '庫存出庫' WHEN 'TRANSFER' THEN '調撥' ELSE '替代品' END || '」，採購單一併取消');
        IF COALESCE((v_cancel->>'ok')::boolean, false) IS NOT TRUE THEN
          PERFORM public.ga_rq_raise(COALESCE((v_cancel->>'status')::integer, 409), COALESCE(v_cancel->>'code', 'PO_CANCEL_FAILED'), '採購單 ' || v_po.po_no || ' 無法取消：' || COALESCE(v_cancel->>'error', ''), '{}'::jsonb);
        END IF;
        v_n := v_n + 1;
      END LOOP;
    END IF;

    IF v_rev.id IS NULL THEN
      INSERT INTO public.ga_purchase_reviews (request_id, decision, created_by, updated_by) VALUES (p_id, v_dec, v_uid, v_uid) RETURNING * INTO v_rev;
    END IF;
    UPDATE public.ga_purchase_reviews SET decision = v_dec, vendor_id = v_vendor, vendor_name = ga_normalize_optional_text(v_p->>'vendor_name'),
      approved_quantity = NULLIF(v_p->>'approved_quantity', '')::numeric, approved_unit = ga_normalize_optional_text(v_p->>'approved_unit'),
      estimated_amount = NULLIF(v_p->>'estimated_amount', '')::numeric, quoted_amount = NULLIF(v_p->>'quoted_amount', '')::numeric,
      negotiated_amount = NULLIF(v_p->>'negotiated_amount', '')::numeric, final_amount = NULLIF(v_p->>'final_amount', '')::numeric,
      expected_delivery_date = NULLIF(v_p->>'expected_delivery_date', '')::date, delivery_method = ga_normalize_optional_text(v_p->>'delivery_method'),
      receiving_location_id = NULLIF(v_p->>'receiving_location_id', '')::uuid, substitute_description = ga_normalize_optional_text(v_p->>'substitute_description'),
      decision_note = v_note, public_note = ga_normalize_optional_text(v_p->>'public_note'), updated_by = v_uid, deleted_at = NULL
     WHERE id = v_rev.id RETURNING * INTO v_rev;
    -- 報價保留歷史：舊的標記已取代（不刪除），再寫新的一筆。
    IF v_dec = 'PURCHASE' AND (v_vendor IS NOT NULL OR ga_normalize_optional_text(v_p->>'vendor_name') IS NOT NULL OR NULLIF(v_p->>'quoted_amount', '') IS NOT NULL OR NULLIF(v_p->>'negotiated_amount', '') IS NOT NULL OR NULLIF(v_p->>'final_amount', '') IS NOT NULL OR ga_normalize_optional_text(v_p->>'quote_notes') IS NOT NULL) THEN
      UPDATE public.ga_purchase_review_quotes SET superseded_at = now(), is_selected = false, updated_by = v_uid WHERE purchase_review_id = v_rev.id AND deleted_at IS NULL AND superseded_at IS NULL;
      INSERT INTO public.ga_purchase_review_quotes (purchase_review_id, vendor_id, vendor_name, quote_amount, negotiated_amount, lead_time_days, is_selected, notes, created_by, updated_by)
      VALUES (v_rev.id, v_vendor, ga_normalize_optional_text(v_p->>'vendor_name'), NULLIF(v_p->>'quoted_amount', '')::numeric, NULLIF(v_p->>'negotiated_amount', '')::numeric,
        NULLIF(v_p->>'quote_lead_time_days', '')::integer, true, ga_normalize_optional_text(v_p->>'quote_notes'), v_uid, v_uid);
    END IF;

    v_label := CASE v_dec WHEN 'REJECT' THEN '駁回' WHEN 'STOCK_ISSUE' THEN '改由庫存出庫' WHEN 'TRANSFER' THEN '改由調撥' WHEN 'PURCHASE' THEN '進入採購' ELSE '改用替代品' END;
    v_pub := COALESCE(ga_normalize_optional_text(v_p->>'public_note'), v_note);
    IF v_dec = 'REJECT' THEN
      v_docs := public.ga_rq_docs(p_id);
      IF (v_docs->>'work_order_open')::boolean OR (v_docs->>'po_count')::integer > 0 OR (v_docs->>'issued')::numeric > 0 OR (v_docs->>'transfer_active')::integer > 0 THEN
        PERFORM public.ga_rq_raise(409, 'HAS_DOCUMENTS', '這張需求單已有進行中的工單或有效單據，不能駁回；請先作廢單據或取消採購單');
      END IF;
      v_new_status := 'REJECTED'; v_progress := '總務採購評估結果：' || v_label || '。' || v_pub;
      UPDATE public.ga_service_requests SET main_status = 'REJECTED', rejection_reason = 'NOT_ELIGIBLE', rejection_note = v_pub, public_progress = v_progress WHERE id = p_id;
    ELSIF v_dec IN ('STOCK_ISSUE', 'TRANSFER') THEN
      IF v_dec = 'STOCK_ISSUE' AND COALESCE(v_req.resource_type, '') <> 'PART' THEN PERFORM public.ga_rq_raise(422, 'NOT_PART_STOCK', '只有料件需求可以改由庫存出庫'); END IF;
      v_new_status := 'ACCEPTED'; v_route := v_dec;
      v_progress := '總務採購評估結果：' || v_label || '。後續改由' || CASE v_dec WHEN 'STOCK_ISSUE' THEN '庫存出庫' ELSE '調撥' END || '處理。' || v_pub;
      UPDATE public.ga_service_requests SET main_status = 'ACCEPTED', intake_route = v_route, public_progress = v_progress WHERE id = p_id;
    ELSIF v_dec = 'SUBSTITUTE' THEN
      v_new_status := 'IN_PROGRESS'; v_progress := '總務採購評估結果：' || v_label || '。' || COALESCE(v_rev.substitute_description, '') || ' ' || v_pub;
      UPDATE public.ga_service_requests SET main_status = 'IN_PROGRESS', public_progress = v_progress WHERE id = p_id;
    ELSE
      v_new_status := 'IN_PROGRESS'; v_progress := '總務採購評估結果：' || v_label || '。已產生草稿採購單，確認供應商與單價後才會下訂。' || v_pub;
      UPDATE public.ga_service_requests SET main_status = 'IN_PROGRESS', public_progress = v_progress WHERE id = p_id;
      v_po_res := public.ga_ws_po_from_review(v_rev.id);
      IF COALESCE((v_po_res->>'ok')::boolean, false) IS NOT TRUE THEN
        PERFORM public.ga_rq_raise(COALESCE((v_po_res->>'status')::integer, 409), COALESCE(v_po_res->>'code', 'PO_CREATE_FAILED'), COALESCE(v_po_res->>'error', '產生採購單失敗'), (v_po_res - 'ok' - 'status' - 'code' - 'error'));
      END IF;
    END IF;
    PERFORM public.ga_rq_event(p_id, 'PURCHASE_REVIEW_DECIDED', v_req.main_status, v_new_status, 'PUBLIC', '添購 / 採購評估', '評估結果：' || v_label || '。' || v_pub,
      jsonb_build_object('action', 'purchase_review', 'review_id', v_rev.id, 'decision', v_dec, 'vendor_id', v_vendor, 'approved_quantity', v_rev.approved_quantity,
        'canceled_purchase_orders', v_n, 'purchase_order_id', v_po_res->'data'->>'id'), v_uid);
    IF v_dec = 'PURCHASE' THEN
      SELECT id INTO v_ful_id FROM public.ga_part_fulfillments WHERE request_id = p_id AND deleted_at IS NULL;
      IF v_ful_id IS NULL THEN
        INSERT INTO public.ga_part_fulfillments (request_id, status, requested_quantity, unit, current_step, created_by, updated_by)
        VALUES (p_id, 'PURCHASING', v_req.desired_quantity, v_req.desired_unit, '已產生草稿採購單，請確認供應商與單價後下訂', v_uid, v_uid) RETURNING id INTO v_ful_id;
      END IF;
      PERFORM public.ga_ful_sync_po(p_id);
    END IF;
    RETURN jsonb_build_object('ok', true, 'status', 201, 'data', jsonb_build_object('review_id', v_rev.id, 'decision', v_dec, 'request_id', p_id, 'main_status', v_new_status,
      'purchase_order', v_po_res->'data', 'canceled_purchase_orders', v_n));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- ---------------------------------------------------------------- 17. 料件處理單：建立、決定處理方式、登記異常、作廢單據、送門市確認（Q18）
CREATE OR REPLACE FUNCTION public.ga_ws_ful_create(p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_req public.ga_service_requests%ROWTYPE;
  v_ful public.ga_part_fulfillments%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.part_fulfillment.manage') THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有料件處理管理權限'); END IF;
  BEGIN
    SELECT * INTO v_req FROM public.ga_service_requests WHERE id = p_request_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到需求單'); END IF;
    IF COALESCE(v_req.resource_type, '') <> 'PART' THEN RETURN public.ga_rq_err(400, 'NOT_PART', '只有料件需求可建立料件處理單'); END IF;
    IF v_req.main_status IN ('COMPLETED', 'REJECTED', 'CANCELED') THEN RETURN public.ga_rq_err(409, 'REQUEST_CLOSED', '這張需求單已結案、駁回或取消'); END IF;
    SELECT * INTO v_ful FROM public.ga_part_fulfillments WHERE request_id = p_request_id AND deleted_at IS NULL;
    IF FOUND THEN RETURN jsonb_build_object('ok', true, 'status', 200, 'existing', true, 'data', jsonb_build_object('id', v_ful.id, 'status', v_ful.status, 'updated_at', v_ful.updated_at)); END IF;
    INSERT INTO public.ga_part_fulfillments (request_id, requested_quantity, unit, current_step, created_by, updated_by)
    VALUES (p_request_id, v_req.desired_quantity, v_req.desired_unit, '等待確認取得方式', v_uid, v_uid) RETURNING * INTO v_ful;
    RETURN jsonb_build_object('ok', true, 'status', 201, 'data', jsonb_build_object('id', v_ful.id, 'status', v_ful.status, 'updated_at', v_ful.updated_at));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ws_ful_decision(p_id uuid, p_decision text, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ful public.ga_part_fulfillments%ROWTYPE;
  v_dec text := upper(COALESCE(ga_normalize_optional_text(p_decision), ''));
  v_status text;
  v_route text;
  v_step text;
  v_label text;
  v_docs jsonb;
  v_po record;
  v_cancel jsonb;
  v_n integer := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.part_fulfillment.manage') THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有料件處理管理權限'); END IF;
  IF v_dec NOT IN ('STOCK_ISSUE', 'TRANSFER', 'PURCHASE') THEN RETURN public.ga_rq_err(400, 'DECISION_INVALID', '請選擇出庫、調撥或採購'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  BEGIN
    SELECT * INTO v_ful FROM public.ga_part_fulfillments WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到料件處理單'); END IF;
    IF v_ful.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張處理單剛被其他人更新，請重新載入後再操作'); END IF;
    IF v_ful.status IN ('WAITING_STORE_CONFIRMATION', 'COMPLETED', 'CANCELED') THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '此處理單已送門市確認或結案，無法重新選擇處理方式'); END IF;
    v_status := CASE v_dec WHEN 'STOCK_ISSUE' THEN 'STOCK_ISSUE' WHEN 'TRANSFER' THEN 'TRANSFER' ELSE 'PURCHASING' END;
    v_route := CASE v_dec WHEN 'PURCHASE' THEN 'PURCHASE_REVIEW' ELSE v_dec END;
    v_step := CASE v_dec WHEN 'STOCK_ISSUE' THEN '等待建立出庫單' WHEN 'TRANSFER' THEN '等待建立調撥單' ELSE '等待建立採購單' END;
    v_label := CASE v_dec WHEN 'STOCK_ISSUE' THEN '出庫' WHEN 'TRANSFER' THEN '調撥' ELSE '採購' END;
    -- 改離採購：舊採購單標已取消（已到貨者擋）。
    IF v_dec <> 'PURCHASE' AND to_regclass('public.ga_purchase_orders') IS NOT NULL THEN
      v_docs := public.ga_rq_docs(v_ful.request_id);
      IF (v_docs->>'po_received')::integer > 0 THEN RETURN public.ga_rq_err(409, 'PO_ALREADY_RECEIVED', '這張需求單已有採購單到貨（' || COALESCE(v_docs->>'po_nos', '') || '），不能改變處理方式'); END IF;
      FOR v_po IN EXECUTE 'SELECT o.id, o.po_no, o.updated_at FROM public.ga_purchase_orders o WHERE o.status NOT IN (''CANCELED'', ''CLOSED'') AND (o.source_request_id = $1 OR EXISTS (SELECT 1 FROM public.ga_purchase_order_items i WHERE i.po_id = o.id AND i.request_id = $1))' USING v_ful.request_id LOOP
        v_cancel := public.ga_ws_po_action(v_po.id, 'cancel', v_po.updated_at, '處理方式改為' || v_label || '，採購單一併取消');
        IF COALESCE((v_cancel->>'ok')::boolean, false) IS NOT TRUE THEN
          PERFORM public.ga_rq_raise(COALESCE((v_cancel->>'status')::integer, 409), COALESCE(v_cancel->>'code', 'PO_CANCEL_FAILED'), '採購單 ' || v_po.po_no || ' 無法取消：' || COALESCE(v_cancel->>'error', ''), '{}'::jsonb);
        END IF;
        v_n := v_n + 1;
      END LOOP;
    END IF;
    UPDATE public.ga_part_fulfillments SET status = v_status, current_step = v_step, updated_by = v_uid WHERE id = v_ful.id;
    UPDATE public.ga_service_requests SET intake_route = v_route, main_status = 'IN_PROGRESS',
      public_progress = CASE v_dec WHEN 'STOCK_ISSUE' THEN '總務正在準備庫存出庫。' WHEN 'TRANSFER' THEN '總務正在安排調撥。' ELSE '總務已進入採購處理。' END
     WHERE id = v_ful.request_id AND deleted_at IS NULL AND main_status NOT IN ('COMPLETED', 'REJECTED', 'CANCELED');
    INSERT INTO public.ga_part_fulfillment_events (fulfillment_id, event_type, title, description, metadata, created_by)
    VALUES (v_ful.id, CASE WHEN v_ful.status = 'EXCEPTION' THEN 'EXCEPTION_RECOVERY_SELECTED' ELSE 'FULFILLMENT_DECISION_SELECTED' END,
      CASE WHEN v_ful.status = 'EXCEPTION' THEN '異常改用' || v_label || '處理' ELSE '選擇' || v_label END, v_step,
      jsonb_build_object('previous_status', v_ful.status, 'next_status', v_status, 'decision', v_dec, 'canceled_purchase_orders', v_n), v_uid);
    IF v_dec = 'PURCHASE' THEN PERFORM public.ga_ful_sync_po(v_ful.request_id); END IF;
    SELECT * INTO v_ful FROM public.ga_part_fulfillments WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', v_ful.id, 'status', v_ful.status, 'current_step', v_ful.current_step, 'updated_at', v_ful.updated_at, 'canceled_purchase_orders', v_n));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_ws_ful_exception(p_id uuid, p_type text, p_note text, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ful public.ga_part_fulfillments%ROWTYPE;
  v_type text := ga_normalize_optional_text(p_type);
  v_note text := ga_normalize_optional_text(p_note);
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.part_fulfillment.manage') THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有料件處理管理權限'); END IF;
  IF v_type IS NULL OR v_type NOT IN ('少收', '未收', '破損', '收錯', '取消') THEN RETURN public.ga_rq_err(400, 'TYPE_INVALID', '請選擇異常類型'); END IF;
  IF v_note IS NULL THEN RETURN public.ga_rq_err(400, 'NOTE_REQUIRED', '請說明實際狀況'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  BEGIN
    SELECT * INTO v_ful FROM public.ga_part_fulfillments WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到料件處理單'); END IF;
    IF v_ful.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張處理單剛被其他人更新，請重新載入後再操作'); END IF;
    IF v_ful.status IN ('COMPLETED', 'CANCELED') THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '此處理單已結案，不能登記異常'); END IF;
    UPDATE public.ga_part_fulfillments SET status = 'EXCEPTION', current_step = '異常：' || v_type, notes = v_note, updated_by = v_uid WHERE id = p_id;
    INSERT INTO public.ga_part_fulfillment_events (fulfillment_id, event_type, title, description, metadata, created_by)
    VALUES (p_id, 'EXCEPTION_REPORTED', v_type, v_note, jsonb_build_object('previous_status', v_ful.status), v_uid);
    UPDATE public.ga_service_requests SET main_status = 'IN_PROGRESS', public_progress = '料件處理發生異常（' || v_type || '），總務正在處理。'
     WHERE id = v_ful.request_id AND deleted_at IS NULL AND main_status NOT IN ('COMPLETED', 'REJECTED', 'CANCELED');
    SELECT * INTO v_ful FROM public.ga_part_fulfillments WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', v_ful.id, 'status', v_ful.status, 'current_step', v_ful.current_step, 'updated_at', v_ful.updated_at));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- 逐筆作廢單據（異常時才能作廢）：釋放已承諾量；出庫單不沖回庫存（庫存沖回仍走庫存調整）；採購單走採購單取消（已到貨者擋）；調撥單須已取消或已收貨。
CREATE OR REPLACE FUNCTION public.ga_ws_ful_void_document(p_doc_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_doc public.ga_part_fulfillment_documents%ROWTYPE;
  v_ful public.ga_part_fulfillments%ROWTYPE;
  v_reason text := ga_normalize_optional_text(p_reason);
  v_tstatus text;
  v_po_updated timestamptz;
  v_cancel jsonb;
  v_total numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.part_fulfillment.manage') THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有料件處理管理權限'); END IF;
  IF v_reason IS NULL THEN RETURN public.ga_rq_err(400, 'REASON_REQUIRED', '作廢單據必須填寫原因'); END IF;
  IF length(v_reason) > 500 THEN RETURN public.ga_rq_err(400, 'REASON_TOO_LONG', '原因不可超過 500 字'); END IF;
  BEGIN
    SELECT * INTO v_doc FROM public.ga_part_fulfillment_documents WHERE id = p_doc_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到單據'); END IF;
    SELECT * INTO v_ful FROM public.ga_part_fulfillments WHERE id = v_doc.fulfillment_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到料件處理單'); END IF;
    IF v_doc.voided_at IS NOT NULL THEN RETURN public.ga_rq_err(409, 'ALREADY_VOIDED', '這張單據已經作廢'); END IF;
    IF v_ful.status <> 'EXCEPTION' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '要先登記異常，才能作廢單據並重新選擇處理方式'); END IF;
    IF v_doc.document_type = 'PURCHASE' THEN
      IF to_regclass('public.ga_purchase_orders') IS NULL THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '找不到採購單'); END IF;
      EXECUTE 'SELECT updated_at FROM public.ga_purchase_orders WHERE id = $1' INTO v_po_updated USING v_doc.document_id;
      IF v_po_updated IS NOT NULL AND COALESCE(v_doc.status, '') <> 'CANCELED' THEN
        v_cancel := public.ga_ws_po_action(v_doc.document_id, 'cancel', v_po_updated, '料件處理單作廢：' || v_reason);
        IF COALESCE((v_cancel->>'ok')::boolean, false) IS NOT TRUE THEN
          PERFORM public.ga_rq_raise(COALESCE((v_cancel->>'status')::integer, 409), COALESCE(v_cancel->>'code', 'PO_CANCEL_FAILED'), '採購單 ' || v_doc.document_no || ' 無法取消：' || COALESCE(v_cancel->>'error', ''), '{}'::jsonb);
        END IF;
      END IF;
    ELSIF v_doc.document_type = 'TRANSFER' THEN
      SELECT status INTO v_tstatus FROM public.ga_inventory_transfers WHERE id = v_doc.document_id;
      IF v_tstatus IS NOT NULL AND v_tstatus NOT IN ('CANCELED', 'RECEIVED') THEN
        RETURN public.ga_rq_err(409, 'TRANSFER_ACTIVE', '調撥單 ' || v_doc.document_no || ' 還在進行中，請先到調撥單取消，才能作廢這筆單據');
      END IF;
    END IF;
    UPDATE public.ga_part_fulfillment_documents SET voided_at = now(), voided_by = v_uid, void_reason = v_reason, status = 'CANCELED' WHERE id = v_doc.id;
    v_total := public.ga_ful_recompute(v_ful.id);
    INSERT INTO public.ga_part_fulfillment_events (fulfillment_id, event_type, title, description, metadata, created_by)
    VALUES (v_ful.id, 'DOCUMENT_VOIDED', '作廢單據 ' || v_doc.document_no, v_reason,
      jsonb_build_object('document_type', v_doc.document_type, 'document_id', v_doc.document_id, 'document_no', v_doc.document_no, 'quantity', v_doc.quantity, 'fulfilled_after', v_total,
        'stock_reversed', false), v_uid);
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', v_doc.id, 'fulfilled_quantity', v_total, 'fulfillment_id', v_ful.id));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- 送門市確認：處理單與需求單一起往下（Q18）。需要已處理量達需求量（待交付）。
CREATE OR REPLACE FUNCTION public.ga_ws_ful_deliver(p_id uuid, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ful public.ga_part_fulfillments%ROWTYPE;
  v_req public.ga_service_requests%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.part_fulfillment.manage') THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有料件處理管理權限'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  BEGIN
    SELECT * INTO v_ful FROM public.ga_part_fulfillments WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到料件處理單'); END IF;
    IF v_ful.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張處理單剛被其他人更新，請重新載入後再操作'); END IF;
    IF v_ful.status IN ('WAITING_STORE_CONFIRMATION', 'COMPLETED', 'CANCELED', 'EXCEPTION', 'PENDING_DECISION') THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '目前狀態不可送門市確認'); END IF;
    PERFORM public.ga_ful_recompute(v_ful.id);
    SELECT * INTO v_ful FROM public.ga_part_fulfillments WHERE id = p_id;
    IF COALESCE(v_ful.fulfilled_quantity, 0) <= 0 THEN RETURN public.ga_rq_err(409, 'NOT_READY', '尚未有料件可送門市確認'); END IF;
    IF COALESCE(v_ful.requested_quantity, 0) > COALESCE(v_ful.fulfilled_quantity, 0) THEN
      RETURN public.ga_rq_err(409, 'NOT_READY', '尚未完成需求數量，目前已處理 ' || public.ga_po_fmt(v_ful.fulfilled_quantity) || ' / ' || public.ga_po_fmt(v_ful.requested_quantity));
    END IF;
    SELECT * INTO v_req FROM public.ga_service_requests WHERE id = v_ful.request_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR v_req.main_status NOT IN ('ACCEPTED', 'IN_PROGRESS') THEN RETURN public.ga_rq_err(409, 'REQUEST_STATE', '需求單目前狀態不能送門市確認（需為已受理或處理中）'); END IF;
    UPDATE public.ga_part_fulfillments SET status = 'WAITING_STORE_CONFIRMATION', current_step = '已交付料件，等待門市確認', updated_by = v_uid WHERE id = p_id;
    UPDATE public.ga_service_requests SET main_status = 'WAITING_STORE_CONFIRMATION', public_progress = '總務已交付料件，請門市確認收貨並回報結果。' WHERE id = v_req.id;
    INSERT INTO public.ga_part_fulfillment_events (fulfillment_id, event_type, title, description, metadata, created_by)
    VALUES (p_id, 'SENT_TO_STORE_CONFIRMATION', '送門市確認', '已交付料件，等待門市確認收貨', jsonb_build_object('fulfilled', v_ful.fulfilled_quantity), v_uid);
    PERFORM public.ga_rq_event(v_req.id, 'STORE_CONFIRMATION_REQUESTED', v_req.main_status, 'WAITING_STORE_CONFIRMATION', 'PUBLIC', '總務送門市確認', '總務已交付料件，請門市確認收貨並回報結果。',
      jsonb_build_object('action', 'fulfillment_deliver', 'fulfillment_id', p_id), v_uid);
    SELECT * INTO v_ful FROM public.ga_part_fulfillments WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', v_ful.id, 'status', v_ful.status, 'current_step', v_ful.current_step, 'request_id', v_req.id, 'updated_at', v_ful.updated_at));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

-- ---------------------------------------------------------------- 授權
REVOKE ALL ON FUNCTION public.ga_ws_req_create(jsonb, text), public.ga_ws_req_accept(uuid, timestamptz, text, text, uuid, text, text),
  public.ga_ws_req_transition(uuid, text, timestamptz, jsonb), public.ga_ws_req_store_action(uuid, text, text, timestamptz),
  public.ga_ws_req_comment(uuid, text, uuid, text, text, text), public.ga_ws_req_settings_set(integer, timestamptz),
  public.ga_ws_req_stock_issue(uuid, uuid, uuid, numeric, text, text, text, text, text), public.ga_ws_req_purchase_review(uuid, jsonb, timestamptz),
  public.ga_ws_ful_create(uuid), public.ga_ws_ful_decision(uuid, text, timestamptz), public.ga_ws_ful_exception(uuid, text, text, timestamptz),
  public.ga_ws_ful_void_document(uuid, text), public.ga_ws_ful_deliver(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_req_create(jsonb, text), public.ga_ws_req_accept(uuid, timestamptz, text, text, uuid, text, text),
  public.ga_ws_req_transition(uuid, text, timestamptz, jsonb), public.ga_ws_req_store_action(uuid, text, text, timestamptz),
  public.ga_ws_req_comment(uuid, text, uuid, text, text, text), public.ga_ws_req_settings_set(integer, timestamptz),
  public.ga_ws_req_stock_issue(uuid, uuid, uuid, numeric, text, text, text, text, text), public.ga_ws_req_purchase_review(uuid, jsonb, timestamptz),
  public.ga_ws_ful_create(uuid), public.ga_ws_ful_decision(uuid, text, timestamptz), public.ga_ws_ful_exception(uuid, text, text, timestamptz),
  public.ga_ws_ful_void_document(uuid, text), public.ga_ws_ful_deliver(uuid, timestamptz) TO authenticated;


-- 伺服端（service_role）讀需求單單據摘要用：判斷動作能不能按（資料庫函式自己會再驗一次）。
GRANT EXECUTE ON FUNCTION public.ga_rq_docs(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 核對
SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND (table_name, column_name) IN (('ga_part_fulfillments', 'ready_to_deliver_at'), ('ga_part_fulfillment_documents', 'voided_at'), ('ga_part_fulfillment_documents', 'void_reason'), ('ga_part_fulfillment_documents', 'voided_by'), ('ga_service_request_comments', 'original_body'), ('ga_service_request_events', 'proxy_for_store'), ('ga_service_requests', 'cancel_reason'), ('ga_service_requests', 'reopened_count'), ('ga_service_requests', 'waiting_confirm_since'), ('ga_purchase_review_quotes', 'superseded_at')) ORDER BY 1, 2;
-- 核對：應列出 10 個欄位；設定表應有 5 列
SELECT key, value_num FROM public.ga_workflow_settings ORDER BY key;
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND (proname LIKE 'ga_ws_req_%' OR proname LIKE 'ga_ws_ful_%') ORDER BY 1;
-- 核對：應列出 13 個函式
