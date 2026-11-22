-- 58-b45-receipt-void.sql
-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/20261119170000_m7m8_b45_receipt_void.sql 相同。
-- 第 4.5 批 I（作廢進貨；P6）（2026-11-19 第 4.5 批問卷 P1 至 P10）。
-- 性質：會寫入（新增 1 個欄位、1 個唯一索引、1 個函式，並以文字替換改 2 個第 4 批函式）。ga_purchase_receipts 新增 void_key（作廢的固定識別）；新增 ga_ws_po_receipt_void(採購單, 進貨單, 原因, 固定識別, 版本)：
--   單一交易沖回庫存（反向庫存交易）、扣回採購單品項已驗入數量、重算採購單狀態、進貨標記 voided_*、寫採購單事件與原因（必填）；權限同到貨（採購評估管理 + 庫存交易管理 + 料件查看）。
--   擋下：已被有效請款單引用（白話指出請款單號）、已配發成設備、直接建立設備的品項、連結有效發票、採購單已結案或已取消、沖回後庫存為負、已作廢。
--   另以文字替換讓 ga_ws_po_receipts_get（累計驗入庫存與可配發量）與 ga_ws_po_dispatch（可配發量）排除已作廢進貨（已替換過就略過，形狀不符就中止，50 第 8 區先檢查）。
-- 先決條件：先套 51（voided_* 欄位）、56（ga_pay_lock_po 等）與第 4 批 33、34。
-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：58-b45-receipt-void-rollback.sql。套用前先跑 50-b45-preview-before-apply.sql，備份後經使用者核可才執行。
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_purchase_receipts' AND column_name = 'voided_at') THEN
    RAISE EXCEPTION 'Missing prerequisite columns: 請先套用 20261119100000_m7m8_b45_receipt_voucher';
  END IF;
  IF to_regprocedure('public.ga_po_err(integer,text,text,jsonb)') IS NULL OR to_regprocedure('public.ga_po_perm_error(uuid)') IS NULL OR to_regprocedure('public.ga_po_event(uuid,text,text,text,uuid,text,jsonb)') IS NULL
     OR to_regprocedure('public.ga_po_receipt_data(uuid)') IS NULL OR to_regprocedure('public.ga_po_data(uuid)') IS NULL OR to_regprocedure('public.ga_pay_lock_po(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 請先套用第 4 批 20261112110000／120000 與 20261119150000';
  END IF;
END $$;

ALTER TABLE public.ga_purchase_receipts ADD COLUMN IF NOT EXISTS void_key text;
CREATE UNIQUE INDEX IF NOT EXISTS ga_purchase_receipts_void_key_uidx ON public.ga_purchase_receipts (void_key) WHERE void_key IS NOT NULL;

-- ================================================================ 1. 作廢進貨
CREATE OR REPLACE FUNCTION public.ga_ws_po_receipt_void(p_po_id uuid, p_receipt_id uuid, p_reason text, p_key text, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_perm jsonb;
  v_key text := nullif(btrim(COALESCE(p_key, '')), '');
  v_reason text := nullif(btrim(COALESCE(p_reason, '')), '');
  v_po public.ga_purchase_orders%ROWTYPE;
  r public.ga_purchase_receipts%ROWTYPE;
  v_ri record;
  v_codes text;
  v_bal numeric;
  v_res jsonb;
  v_new_status text;
  v_summary jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_po_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  v_perm := public.ga_po_perm_error(v_uid);
  IF v_perm IS NOT NULL THEN RETURN v_perm; END IF;
  IF v_key IS NULL OR length(v_key) > 64 THEN RETURN public.ga_po_err(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少防重複識別碼（最長 64 字），請重新整理畫面後再送出'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_po_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  IF v_reason IS NULL THEN RETURN public.ga_po_err(400, 'REASON_REQUIRED', '作廢進貨必須填寫原因'); END IF;
  IF char_length(v_reason) > 200 THEN RETURN public.ga_po_err(400, 'REASON_TOO_LONG', '原因不可超過 200 字'); END IF;
  BEGIN
    PERFORM public.ga_pay_lock_po(p_po_id);
    SELECT * INTO v_po FROM public.ga_purchase_orders WHERE id = p_po_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_po_err(404, 'NOT_FOUND', '找不到這張採購單'); END IF;
    SELECT * INTO r FROM public.ga_purchase_receipts WHERE id = p_receipt_id AND po_id = p_po_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_po_err(404, 'RECEIPT_NOT_FOUND', '找不到這張進貨單，或它不屬於這張採購單'); END IF;
    -- 重送（同識別）：回上次的結果。
    IF r.void_key IS NOT NULL AND r.void_key = v_key THEN
      -- 同一識別、原因也相同才算重送；原因不同代表這是另一個操作，不能回上次的結果（與作廢發票一致）
      IF r.void_reason IS DISTINCT FROM v_reason THEN RETURN public.ga_po_err(409, 'IDEMPOTENCY_CONFLICT', '這個送出識別碼已被另一個不同內容的作廢使用，請重新整理畫面後再送出'); END IF;
      RETURN jsonb_build_object('ok', true, 'status', 200, 'idempotent_replay', true, 'data', public.ga_po_receipt_data(r.id), 'po', public.ga_po_data(p_po_id));
    END IF;
    IF r.voided_at IS NOT NULL THEN RETURN public.ga_po_err(409, 'ALREADY_VOIDED', '這張進貨單已經作廢了'); END IF;
    IF r.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_po_err(409, 'STALE', '這張進貨單剛被其他人修改，請重新載入後再操作'); END IF;
    IF v_po.status IN ('CLOSED', 'CANCELED') THEN
      RETURN public.ga_po_err(409, 'INVALID_STATE', CASE v_po.status WHEN 'CLOSED' THEN '這張採購單已結案，不能作廢進貨；要更正請先請總務處理' ELSE '這張採購單已取消，不能作廢進貨' END, jsonb_build_object('current_status', v_po.status));
    END IF;
    IF v_po.status NOT IN ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED') THEN
      RETURN public.ga_po_err(409, 'INVALID_STATE', '目前狀態是「' || public.ga_po_status_label(v_po.status) || '」，沒有可作廢的進貨', jsonb_build_object('current_status', v_po.status));
    END IF;
    -- 被有效請款單引用
    SELECT string_agg(DISTINCT q.pr_no, '、') INTO v_codes
      FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.receipt_id = r.id AND q.status <> 'VOID';
    IF v_codes IS NOT NULL THEN
      RETURN public.ga_po_err(409, 'RECEIPT_CLAIMED', '這筆進貨已被請款單 ' || v_codes || ' 使用，請先作廢或退回該請款單', jsonb_build_object('payment_request_nos', v_codes));
    END IF;
    -- 連結有效發票
    SELECT string_agg(DISTINCT COALESCE(NULLIF(btrim(i.invoice_no), ''), '（無號碼）'), '、') INTO v_codes
      FROM public.ga_purchase_invoice_receipts ir JOIN public.ga_purchase_invoices i ON i.id = ir.invoice_id WHERE ir.receipt_id = r.id AND i.status = 'ACTIVE';
    IF v_codes IS NOT NULL THEN
      RETURN public.ga_po_err(409, 'RECEIPT_HAS_INVOICE', '這筆進貨連結了發票 ' || v_codes || '，請先到發票頁作廢該發票或解除連結', jsonb_build_object('invoice_nos', v_codes));
    END IF;
    -- 已配發成設備、直接建立設備、沖回後庫存不可為負（即使這個位置允許負庫存）
    FOR v_ri IN SELECT ri.*, i.item_name, i.fulfil_mode FROM public.ga_purchase_receipt_items ri JOIN public.ga_purchase_order_items i ON i.id = ri.po_item_id WHERE ri.receipt_id = r.id ORDER BY i.line_no, ri.id LOOP
      IF v_ri.dispatched_qty > 0 THEN
        RETURN public.ga_po_err(409, 'RECEIPT_DISPATCHED', '「' || v_ri.item_name || '」已配發成設備，這筆進貨不能作廢，請走設備報廢', jsonb_build_object('po_item_id', v_ri.po_item_id));
      END IF;
      IF v_ri.fulfil_mode = 'DIRECT_ASSET' AND v_ri.accepted_qty > 0 THEN
        RETURN public.ga_po_err(409, 'RECEIPT_ASSET_CREATED', '「' || v_ri.item_name || '」在驗入時已直接建立設備，這筆進貨不能作廢，請走設備報廢', jsonb_build_object('po_item_id', v_ri.po_item_id));
      END IF;
      IF v_ri.inventory_transaction_id IS NOT NULL AND v_ri.accepted_base > 0 THEN
        -- 先鎖庫存列再檢查，檢查到沖回之間不會有人同時出庫把餘額用掉
        SELECT COALESCE(sum(b.q), 0) INTO v_bal FROM (SELECT x.quantity_base AS q FROM public.ga_inventory_balances x WHERE x.location_id = v_ri.location_id AND x.part_id = v_ri.received_part_id FOR UPDATE) b;
        IF v_bal < v_ri.accepted_base THEN
          RETURN public.ga_po_err(409, 'STOCK_INSUFFICIENT', '「' || v_ri.item_name || '」這筆進貨入的庫存已被其他單據用掉一部分（目前庫存 ' || public.ga_po_fmt(v_bal) || '、要沖回 ' || public.ga_po_fmt(v_ri.accepted_base)
            || '），沖回會變成負庫存，不能作廢', jsonb_build_object('po_item_id', v_ri.po_item_id, 'balance', v_bal, 'needed', v_ri.accepted_base));
        END IF;
      END IF;
    END LOOP;

    -- 效果：沖回庫存（反向庫存交易）、扣回驗入量
    PERFORM set_config('app.ga_inv_internal_post', 'true', true);
    FOR v_ri IN SELECT ri.*, i.item_name FROM public.ga_purchase_receipt_items ri JOIN public.ga_purchase_order_items i ON i.id = ri.po_item_id WHERE ri.receipt_id = r.id ORDER BY i.line_no, ri.id LOOP
      IF v_ri.inventory_transaction_id IS NOT NULL AND v_ri.accepted_base > 0 THEN
        v_res := public.ga_ws_inv_post('ISSUE', v_ri.location_id, v_ri.received_part_id, v_ri.accepted_base, 'BASE', '作廢進貨沖回：' || r.receipt_no || '（' || v_reason || '）', v_reason,
          v_key || ':VOID:' || v_ri.id::text, NULL, 'GA_PURCHASE_ORDER', p_po_id,
          jsonb_build_object('po_no', v_po.po_no, 'receipt_no', r.receipt_no, 'po_item_id', v_ri.po_item_id, 'receipt_item_id', v_ri.id, 'void', true));
        IF (v_res->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION '%', v_res::text USING ERRCODE = 'GA001'; END IF;
      END IF;
      UPDATE public.ga_purchase_order_items SET received_qty = received_qty - v_ri.accepted_qty WHERE id = v_ri.po_item_id;
      v_summary := v_summary || jsonb_build_array(jsonb_build_object('po_item_id', v_ri.po_item_id, 'item_name', v_ri.item_name, 'accepted_qty', v_ri.accepted_qty, 'accepted_base', v_ri.accepted_base));
    END LOOP;
    PERFORM set_config('app.ga_inv_internal_post', 'false', true);

    -- 重算採購單狀態（沒有任何驗入 → ORDERED；有品項還沒收滿 → PARTIALLY_RECEIVED；全收滿 → RECEIVED）
    IF NOT EXISTS (SELECT 1 FROM public.ga_purchase_order_items WHERE po_id = p_po_id AND received_qty > 0) THEN v_new_status := 'ORDERED';
    ELSIF EXISTS (SELECT 1 FROM public.ga_purchase_order_items WHERE po_id = p_po_id AND received_qty < quantity) THEN v_new_status := 'PARTIALLY_RECEIVED';
    ELSE v_new_status := 'RECEIVED'; END IF;
    UPDATE public.ga_purchase_orders SET status = v_new_status, updated_by = v_uid WHERE id = p_po_id;
    UPDATE public.ga_purchase_receipts SET voided_at = now(), voided_by = v_uid, void_reason = v_reason, void_key = v_key, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = r.id;
    PERFORM public.ga_po_event(p_po_id, 'receipt_void', v_po.status, v_new_status, v_uid, v_reason,
      jsonb_build_object('receipt_id', r.id, 'receipt_no', r.receipt_no, 'lines', v_summary));
    RETURN jsonb_build_object('ok', true, 'status', 200, 'idempotent_replay', false, 'data', public.ga_po_receipt_data(r.id), 'po', public.ga_po_data(p_po_id));
  EXCEPTION WHEN OTHERS THEN
    RETURN public.ga_po_catch(SQLERRM, SQLSTATE);
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.ga_ws_po_receipt_void(uuid, uuid, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_po_receipt_void(uuid, uuid, text, text, timestamptz) TO authenticated, service_role;

-- ================================================================ 2. 進貨讀取排除已作廢進貨（文字替換）
DO $$
DECLARE
  v_sig text;
  v_def text;
  v_new text;
  v_n integer := 0;
  c_old constant text := 'ri.inventory_transaction_id IS NOT NULL';
  c_new constant text := 'ri.inventory_transaction_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ga_purchase_receipts vr WHERE vr.id = ri.receipt_id AND vr.voided_at IS NOT NULL)';
BEGIN
  FOR v_sig IN SELECT p.oid::regprocedure::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('ga_ws_po_receipts_get', 'ga_ws_po_dispatch') LOOP
    v_n := v_n + 1;
    v_def := pg_get_functiondef(v_sig::regprocedure);
    IF position('vr.voided_at' IN v_def) > 0 THEN CONTINUE; END IF;
    IF position(c_old IN v_def) = 0 THEN RAISE EXCEPTION '函式 % 的形狀與預期不符（找不到進貨明細的庫存交易條件），請人工處理', v_sig; END IF;
    v_new := replace(v_def, c_old, c_new);
    IF position('vr.voided_at' IN v_new) = 0 THEN RAISE EXCEPTION '函式 % 文字替換失敗', v_sig; END IF;
    EXECUTE v_new;
  END LOOP;
  IF v_n <> 2 THEN RAISE EXCEPTION '找不到 ga_ws_po_receipts_get 或 ga_ws_po_dispatch，請先套用第 4 批 20261112120000'; END IF;
END $$;

-- ================================================================ 3. 進貨單回傳不含內部欄位 void_key（文字替換，已替換過就略過，形狀不符就中止）
DO $$
DECLARE
  v_def text;
  c_old constant text := '(to_jsonb(v_r) - ''idempotency_key'' - ''payload_hash'')';
  c_new constant text := '(to_jsonb(v_r) - ''idempotency_key'' - ''payload_hash'' - ''void_key'')';
  v_pos integer;
BEGIN
  v_def := pg_get_functiondef('public.ga_po_receipt_data(uuid)'::regprocedure);
  IF position(c_new IN v_def) > 0 THEN RETURN; END IF;
  IF position(c_old IN v_def) = 0 THEN RAISE EXCEPTION '函式 ga_po_receipt_data 的形狀與預期不符（找不到內部欄位排除），請人工處理'; END IF;
  EXECUTE replace(v_def, c_old, c_new);
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 核對
SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_purchase_receipts' AND column_name = 'void_key';
-- 核對：應列出 void_key
SELECT to_regprocedure('public.ga_ws_po_receipt_void(uuid,uuid,text,text,timestamp with time zone)') AS fn;
-- 核對：不是空的
SELECT proname, position('vr.voided_at' in prosrc) > 0 AS excludes_voided FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('ga_ws_po_receipts_get', 'ga_ws_po_dispatch') ORDER BY 1;
-- 核對：excludes_voided 都是 true
