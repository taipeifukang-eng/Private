-- 39-b5-work-order-parts.sql
-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/20261117110000_m7m8_b5_work_order_parts.sql 相同。
-- 第 5 批 C（W2 工單內領用料件）（2026-11-16 第 5 批問卷 W1 至 W9）。
-- 性質：只新增 1 個函式 ga_ws_wo_issue_part，不改表。同一交易呼叫第 3 批 ga_ws_inv_post 扣庫存（先設內部旗標 app.ga_inv_internal_post，用畢設回 false，做法同第 4 批 ga_ws_req_stock_issue），
--   庫存流水 reference_type = MAINTENANCE_REQUEST、reference_id = 工單 id、原因帶工單編號；工單用料紀錄寫成內部事件 PART_ISSUED（數量以庫存流水為準）。
-- 規則：需要「工單更新」＋「庫存交易管理」＋「料件查看或料件管理」，缺哪個講清楚；工單需為已受理或處理中且不在待門市確認；不可超過庫存（位置不允許負庫存）；防重複識別必填，同識別重送回原結果。
-- 不動第 4 批需求單規則（維修單仍不能走需求單的採購評估與需求單出庫）。36 第 10 區確認流水 reference_type 與事件類型沒有值域 CHECK。
-- 先決條件：先套 37；第 3 批 ga_ws_inv_post 已套用。
-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：39-b5-work-order-parts-rollback.sql。套用前先跑 36-b5-preview-before-apply.sql，備份後經使用者核可才執行。
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.ga_wo_log(uuid,text,text,text,text,uuid,date)') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite function: 請先套用 20261117100000_m7m8_b5_work_order_rules'; END IF;
  IF to_regprocedure('public.ga_ws_inv_post(text,uuid,uuid,numeric,text,text,text,text,timestamptz,text,uuid,jsonb)') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite function: 第 3 批 ga_ws_inv_post'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ga_ws_wo_issue_part(p_id uuid, p_location_id uuid, p_part_id uuid, p_quantity numeric, p_input_unit_type text, p_reason text, p_notes text, p_key text, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_wo public.maintenance_requests%ROWTYPE;
  v_req public.ga_service_requests%ROWTYPE;
  v_rid uuid;
  v_part public.ga_parts%ROWTYPE;
  v_loc public.ga_inventory_locations%ROWTYPE;
  v_unit text := upper(COALESCE(ga_normalize_optional_text(p_input_unit_type), 'BASE'));
  v_reason text;
  v_user_reason text := ga_normalize_optional_text(p_reason);
  v_res jsonb;
  v_tx jsonb;
  v_replay boolean := false;
  v_upd boolean;
  v_txn boolean;
  v_pv boolean;
  v_missing text[];
  v_unit_label text;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  v_upd := public.ga_wo_can_update(v_uid);
  v_txn := has_permission(v_uid, 'general_affairs.inventory_transaction.manage');
  v_pv := has_permission(v_uid, 'general_affairs.part.view') OR has_permission(v_uid, 'general_affairs.part.manage');
  v_missing := array_remove(ARRAY[CASE WHEN NOT v_upd THEN '工單更新' END, CASE WHEN NOT v_txn THEN '庫存交易管理' END, CASE WHEN NOT v_pv THEN '料件查看' END], NULL);
  IF array_length(v_missing, 1) > 0 THEN
    RETURN public.ga_rq_err(403, CASE WHEN NOT v_upd THEN 'PERMISSION_DENIED' WHEN NOT v_txn THEN 'TRANSACTION_PERMISSION_REQUIRED' ELSE 'PART_VIEW_REQUIRED' END,
      '工單領用料件需要「工單更新」、「庫存交易管理」與「料件查看」三個權限，您缺少：' || array_to_string(v_missing, '、'), jsonb_build_object('missing', to_jsonb(v_missing)));
  END IF;
  IF p_location_id IS NULL OR p_part_id IS NULL THEN RETURN public.ga_rq_err(400, 'FIELDS_REQUIRED', '請選擇領用位置與料件'); END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RETURN public.ga_rq_err(400, 'QUANTITY_INVALID', '數量必須大於 0'); END IF;
  IF v_unit NOT IN ('BASE', 'PURCHASE') THEN RETURN public.ga_rq_err(400, 'UNIT_INVALID', '單位類型錯誤'); END IF;
  IF ga_normalize_optional_text(p_key) IS NULL THEN RETURN public.ga_rq_err(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少防重複識別碼，請重新整理畫面後再送出'); END IF;
  IF v_user_reason IS NOT NULL AND length(v_user_reason) > 500 THEN RETURN public.ga_rq_err(400, 'NOTES_TOO_LONG', '領用原因不可超過 500 字'); END IF;
  BEGIN
    SELECT ga_service_request_id INTO v_rid FROM public.maintenance_requests WHERE id = p_id;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張工單'); END IF;
    IF v_rid IS NOT NULL THEN SELECT * INTO v_req FROM public.ga_service_requests WHERE id = v_rid AND deleted_at IS NULL FOR UPDATE; END IF;
    SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張工單'); END IF;
    -- 同一個固定識別重送（流水已存在）：不看目前狀態與版本，直接回原結果（不重寫事件）。
    SELECT EXISTS (SELECT 1 FROM public.ga_inventory_transactions WHERE idempotency_key = p_key AND reference_type = 'MAINTENANCE_REQUEST' AND reference_id = p_id) INTO v_replay;
    IF NOT v_replay THEN
      IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
      IF v_wo.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張工單剛被其他人更新，請重新載入後再操作'); END IF;
      IF v_wo.status NOT IN ('ACCEPTED', 'PROCESSING') THEN
        RETURN public.ga_rq_err(409, 'INVALID_STATE', CASE WHEN v_wo.status = 'COMPLETED' THEN '工單已完成，不能領用料件' ELSE '工單還沒受理，請先存進度再領用料件' END);
      END IF;
      IF v_wo.progress_stage IS NOT DISTINCT FROM 'WAITING_STORE_CONFIRMATION' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '已送門市確認，不能再領用料件'); END IF;
    END IF;
    SELECT * INTO v_part FROM public.ga_parts WHERE id = p_part_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'PART_NOT_FOUND', '找不到料件'); END IF;
    SELECT * INTO v_loc FROM public.ga_inventory_locations WHERE id = p_location_id;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'LOCATION_NOT_FOUND', '找不到庫存位置'); END IF;
    v_reason := '維修工單領用 ' || public.ga_wo_no(p_id) || COALESCE('｜' || v_user_reason, '');
    PERFORM set_config('app.ga_inv_internal_post', 'true', true);
    v_res := public.ga_ws_inv_post('ISSUE', p_location_id, p_part_id, p_quantity, v_unit, v_reason, ga_normalize_optional_text(p_notes), p_key, NULL, 'MAINTENANCE_REQUEST', p_id,
      jsonb_build_object('source', 'maintenance_work_order_part_issue', 'work_order_id', p_id, 'work_order_no', public.ga_wo_no(p_id), 'store_id', v_wo.store_id, 'ga_service_request_id', v_wo.ga_service_request_id));
    PERFORM set_config('app.ga_inv_internal_post', 'false', true);
    IF COALESCE((v_res->>'ok')::boolean, false) IS NOT TRUE THEN
      PERFORM public.ga_rq_raise(COALESCE((v_res->>'status')::integer, 500), COALESCE(v_res->>'code', 'POST_FAILED'), COALESCE(v_res->>'error', '領用料件失敗'), (v_res - 'ok' - 'status' - 'code' - 'error'));
    END IF;
    v_tx := v_res->'data';
    IF v_replay THEN
      RETURN jsonb_build_object('ok', true, 'status', 200, 'idempotent_replay', true, 'data', jsonb_build_object('work_order_id', p_id, 'wo_no', public.ga_wo_no(p_id), 'transaction', v_tx, 'updated_at', v_wo.updated_at));
    END IF;
    v_unit_label := CASE WHEN v_unit = 'PURCHASE' THEN COALESCE(v_part.purchase_unit, v_part.base_unit) ELSE v_part.base_unit END;
    PERFORM public.ga_wo_event(p_id, 'PART_ISSUED', v_wo.status, v_wo.status, v_wo.progress_stage, v_wo.progress_stage,
      '領用料件：' || v_part.name || ' × ' || public.ga_po_fmt(p_quantity) || COALESCE(' ' || v_unit_label, ''), 'INTERNAL', v_uid,
      jsonb_build_object('transaction_id', v_tx->>'transaction_id', 'transaction_no', v_tx->>'transaction_no', 'part_id', p_part_id, 'part_code', v_part.part_code, 'part_name', v_part.name,
        'location_id', p_location_id, 'location_name', v_loc.name, 'quantity', p_quantity, 'unit', v_unit_label, 'input_unit_type', v_unit, 'reason', v_user_reason));
    UPDATE public.maintenance_requests SET progress_stage = progress_stage WHERE id = p_id; -- 觸發 updated_at，讓其他人看到版本已變
    SELECT * INTO v_wo FROM public.maintenance_requests WHERE id = p_id;
    RETURN jsonb_build_object('ok', true, 'status', 201, 'data', jsonb_build_object('work_order_id', p_id, 'wo_no', public.ga_wo_no(p_id), 'transaction', v_tx, 'updated_at', v_wo.updated_at));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.ga_ws_wo_issue_part(uuid, uuid, uuid, numeric, text, text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_wo_issue_part(uuid, uuid, uuid, numeric, text, text, text, text, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 核對
SELECT proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND proname = 'ga_ws_wo_issue_part';
-- 核對：應列出 1 個函式
