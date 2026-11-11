-- M7/M8 第 3 批 C（G13 總務庫存調撥）：C8 目的位置缺設定不能建單、C9「未收」只註記、C10 店長回報問題、C11 逾期天數、Q12 取消可退回來源庫存、Q15 防重複扣帳固定識別。
-- 內容：
--   1. 資料表新增欄位（全部可為空或有預設值，舊單免回填，舊畫面照常讀寫）：
--      ga_inventory_transfers：exception_type、unreceived_*（C9 註記）、store_report_*（C10 回報）、create_key（建單固定識別）。
--      ga_inventory_transfer_items：return_transaction_id（取消退回來源庫存時的流水）。
--   2. 新資料表：ga_inventory_transfer_events（時間軸：誰、何時、備註、固定識別）、ga_inventory_transfer_settings（逾期天數，單列）。
--   3. 函式（都以登入者身分 auth.uid() 判斷，與正式區相同用 has_permission，不檢查 admin 放行）：
--      ga_ws_inv_transfer_create：建單（鎖定、驗位置與料件與單位、目的位置須有設定 C8、驗需求單與剩餘量、不覆蓋進行中處理單、台北日期單號、固定識別）。
--      ga_ws_inv_transfer_action：確認交出／運送中／收貨／取消（可退回來源庫存、結構化異常類型）／未收註記；鎖列＋以目前狀態為條件＋版本檢查＋固定識別；
--                                  交出與收貨過帳、取消退回庫存、同步處理單與單據都在同一個交易，任何一步失敗整張回復。
--      ga_ws_inv_transfer_store_report：目的門市店長回報問題（只寫標記與時間軸，不動庫存與狀態）。
--      ga_ws_inv_transfer_set_overdue_days：總務設定逾期天數（版本檢查）。
--      ga_inv_tr_sync_fulfillment：（內部）同步料件處理中心，只在處理單處於調撥相關狀態時才更新，不覆蓋進行中的其他處理方式。
-- 過帳核心 ga_post_inventory_transaction 與 G12 的 ga_ws_inv_post 都不改，這裡只呼叫。
-- 還原：20261111120000_m7m8_b3_inventory_transfers.rollback.sql。可重複執行。

DO $$
BEGIN
  IF to_regclass('public.ga_inventory_transfers') IS NULL OR to_regclass('public.ga_inventory_transfer_items') IS NULL
     OR to_regclass('public.ga_inventory_locations') IS NULL OR to_regclass('public.ga_inventory_location_parts') IS NULL
     OR to_regclass('public.ga_part_fulfillments') IS NULL OR to_regclass('public.ga_part_fulfillment_documents') IS NULL
     OR to_regclass('public.ga_service_requests') IS NULL OR to_regclass('public.store_managers') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: 調撥單、調撥明細、位置、位置料件、處理單、需求單或 store_managers';
  END IF;
  IF to_regprocedure('public.ga_ws_inv_post(text,uuid,uuid,numeric,text,text,text,text,timestamptz,text,uuid,jsonb)') IS NULL
     OR to_regprocedure('public.ga_inv_map_error(text,text)') IS NULL
     OR to_regprocedure('public.ga_inventory_transfer_is_visible(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 請先套用 20261111110000_m7m8_b3_inventory_post.sql（ga_ws_inv_post）與舊版調撥表（ga_inventory_transfer_is_visible）';
  END IF;
END $$;

-- ---------------------------------------------------------------- 1. 新欄位
ALTER TABLE public.ga_inventory_transfers
  ADD COLUMN IF NOT EXISTS exception_type text,
  ADD COLUMN IF NOT EXISTS unreceived_note text,
  ADD COLUMN IF NOT EXISTS unreceived_marked_at timestamptz,
  ADD COLUMN IF NOT EXISTS unreceived_marked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS store_report_type text,
  ADD COLUMN IF NOT EXISTS store_report_note text,
  ADD COLUMN IF NOT EXISTS store_reported_at timestamptz,
  ADD COLUMN IF NOT EXISTS store_reported_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS create_key text;

ALTER TABLE public.ga_inventory_transfers DROP CONSTRAINT IF EXISTS ga_inventory_transfers_exception_type_check;
ALTER TABLE public.ga_inventory_transfers ADD CONSTRAINT ga_inventory_transfers_exception_type_check
  CHECK (exception_type IS NULL OR exception_type IN ('SHORT_RECEIVED', 'DAMAGED', 'WRONG_ITEM', 'LOST', 'OTHER'));
ALTER TABLE public.ga_inventory_transfers DROP CONSTRAINT IF EXISTS ga_inventory_transfers_store_report_type_check;
ALTER TABLE public.ga_inventory_transfers ADD CONSTRAINT ga_inventory_transfers_store_report_type_check
  CHECK (store_report_type IS NULL OR store_report_type IN ('NOT_ARRIVED', 'DAMAGED', 'WRONG_ITEM', 'SHORT_QUANTITY', 'OTHER'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_inventory_transfers_create_key
  ON public.ga_inventory_transfers (created_by, create_key) WHERE create_key IS NOT NULL;

ALTER TABLE public.ga_inventory_transfer_items
  ADD COLUMN IF NOT EXISTS return_transaction_id uuid REFERENCES public.ga_inventory_transactions(id);

-- ---------------------------------------------------------------- 2. 時間軸與設定
CREATE TABLE IF NOT EXISTS public.ga_inventory_transfer_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES public.ga_inventory_transfers(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_status text,
  to_status text,
  note text,
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_inventory_transfer_events_metadata_object CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_ga_inventory_transfer_events_transfer ON public.ga_inventory_transfer_events (transfer_id, created_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_inventory_transfer_events_key
  ON public.ga_inventory_transfer_events (transfer_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE public.ga_inventory_transfer_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ga_inventory_transfer_events_read ON public.ga_inventory_transfer_events;
CREATE POLICY ga_inventory_transfer_events_read ON public.ga_inventory_transfer_events
  FOR SELECT TO authenticated USING (public.ga_inventory_transfer_is_visible(transfer_id));
REVOKE ALL ON TABLE public.ga_inventory_transfer_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ga_inventory_transfer_events TO authenticated;
GRANT ALL ON TABLE public.ga_inventory_transfer_events TO service_role;

CREATE TABLE IF NOT EXISTS public.ga_inventory_transfer_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  overdue_days integer NOT NULL DEFAULT 3 CHECK (overdue_days BETWEEN 1 AND 90),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
INSERT INTO public.ga_inventory_transfer_settings (id, overdue_days) VALUES (true, 3) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.ga_inventory_transfer_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ga_inventory_transfer_settings_read ON public.ga_inventory_transfer_settings;
CREATE POLICY ga_inventory_transfer_settings_read ON public.ga_inventory_transfer_settings FOR SELECT TO authenticated USING (true);
REVOKE ALL ON TABLE public.ga_inventory_transfer_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ga_inventory_transfer_settings TO authenticated;
GRANT ALL ON TABLE public.ga_inventory_transfer_settings TO service_role;

-- ---------------------------------------------------------------- 3. 內部輔助
CREATE OR REPLACE FUNCTION public.ga_inv_tr_err(p_status integer, p_code text, p_message text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT jsonb_build_object('ok', false, 'status', p_status, 'code', p_code, 'error', p_message) || COALESCE(p_extra, '{}'::jsonb); $$;

-- 調撥需要的三個權限：缺哪個講清楚（Q13）。回傳 NULL 代表三個都有。
CREATE OR REPLACE FUNCTION public.ga_inv_tr_perm_error(p_uid uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_transfer boolean := has_permission(p_uid, 'general_affairs.inventory_transfer.manage');
  v_txn boolean := has_permission(p_uid, 'general_affairs.inventory_transaction.manage');
  v_part boolean := has_permission(p_uid, 'general_affairs.part.view') OR has_permission(p_uid, 'general_affairs.part.manage');
  v_missing text[] := ARRAY[]::text[];
BEGIN
  IF v_transfer AND v_txn AND v_part THEN RETURN NULL; END IF;
  IF NOT v_transfer THEN v_missing := array_append(v_missing, '調撥管理'::text); END IF;
  IF NOT v_txn THEN v_missing := array_append(v_missing, '庫存交易管理'::text); END IF;
  IF NOT v_part THEN v_missing := array_append(v_missing, '料件查看'::text); END IF;
  RETURN public.ga_inv_tr_err(403, CASE WHEN NOT v_transfer THEN 'PERMISSION_DENIED' WHEN NOT v_txn THEN 'TRANSACTION_PERMISSION_REQUIRED' ELSE 'PART_VIEW_REQUIRED' END,
    '調撥需要「調撥管理」、「庫存交易管理」與「料件查看」三個權限，您缺少：' || array_to_string(v_missing, '、'),
    jsonb_build_object('missing', to_jsonb(v_missing)));
END;
$$;

-- 同步料件處理中心（與舊版相同的狀態對應，但只在處理單處於「待決定／調撥／異常」時才改，不覆蓋進行中的領用、採購、等待確認）。
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
   WHERE fulfillment_id = v_doc.fulfillment_id AND document_type = 'TRANSFER' AND status = 'RECEIVED';
  v_req := COALESCE(v_ful.requested_quantity, 0);
  IF p_status = 'RECEIVED' THEN
    IF v_req > 0 AND v_recv >= v_req THEN v_state := 'WAITING_STORE_CONFIRMATION'; v_step := '調撥已全數收貨，等待門市確認';
    ELSE v_state := 'TRANSFER'; v_step := '已調撥收貨 ' || v_recv::text || ' / ' || v_req::text || '，繼續處理剩餘數量'; END IF;
  ELSIF p_status = 'CANCELED' THEN v_state := 'EXCEPTION'; v_step := '調撥已取消，請重新決定處理方式';
  ELSIF p_status = 'IN_TRANSIT' THEN v_state := 'TRANSFER'; v_step := '調撥運送中';
  ELSIF p_status = 'SOURCE_CONFIRMED' THEN v_state := 'TRANSFER'; v_step := '來源已交出，等待運送';
  ELSE v_state := 'TRANSFER'; v_step := '等待來源確認'; END IF;
  UPDATE public.ga_part_fulfillments
     SET status = v_state, current_step = v_step, updated_by = p_uid,
         fulfilled_quantity = CASE WHEN p_status = 'RECEIVED' THEN v_recv ELSE fulfilled_quantity END
   WHERE id = v_doc.fulfillment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_inv_tr_data(p_transfer_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object('id', t.id, 'transfer_no', t.transfer_no, 'status', t.status, 'updated_at', t.updated_at, 'exception_type', t.exception_type,
    'cancel_reason', t.cancel_reason, 'shipping_method', t.shipping_method, 'store_report_type', t.store_report_type, 'store_reported_at', t.store_reported_at,
    'unreceived_marked_at', t.unreceived_marked_at)
  FROM public.ga_inventory_transfers t WHERE t.id = p_transfer_id;
$$;

-- ---------------------------------------------------------------- 4. 建單
CREATE OR REPLACE FUNCTION public.ga_ws_inv_transfer_create(
  p_source_location_id uuid, p_destination_location_id uuid, p_part_id uuid, p_quantity numeric, p_input_unit_type text,
  p_reason text, p_notes text, p_shipping_method text, p_request_id uuid, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_perm jsonb;
  v_key text := ga_normalize_optional_text(p_idempotency_key);
  v_reason text := ga_normalize_optional_text(p_reason);
  v_notes text := ga_normalize_optional_text(p_notes);
  v_ship text := ga_normalize_optional_text(p_shipping_method);
  v_unit text := upper(COALESCE(ga_normalize_optional_text(p_input_unit_type), 'BASE'));
  v_src public.ga_inventory_locations%ROWTYPE;
  v_dst public.ga_inventory_locations%ROWTYPE;
  v_part public.ga_parts%ROWTYPE;
  v_t public.ga_inventory_transfers%ROWTYPE;
  v_item public.ga_inventory_transfer_items%ROWTYPE;
  v_req public.ga_service_requests%ROWTYPE;
  v_ful public.ga_part_fulfillments%ROWTYPE;
  v_bal numeric;
  v_base numeric;
  v_no text;
  v_committed numeric;
  v_remaining numeric;
  v_qty_req_unit numeric;
  v_requested numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_inv_tr_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  v_perm := public.ga_inv_tr_perm_error(v_uid);
  IF v_perm IS NOT NULL THEN RETURN v_perm; END IF;
  IF v_key IS NULL OR length(v_key) > 60 THEN RETURN public.ga_inv_tr_err(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少防重複識別碼，請重新整理畫面後再送出'); END IF;
  IF v_reason IS NULL THEN RETURN public.ga_inv_tr_err(400, 'REASON_REQUIRED', '請輸入調撥原因'); END IF;
  IF length(v_reason) > 200 THEN RETURN public.ga_inv_tr_err(400, 'REASON_TOO_LONG', '調撥原因不可超過 200 字'); END IF;
  IF v_notes IS NOT NULL AND length(v_notes) > 500 THEN RETURN public.ga_inv_tr_err(400, 'NOTES_TOO_LONG', '備註不可超過 500 字'); END IF;
  IF v_ship IS NOT NULL AND v_ship NOT IN ('總務配送', '門市人員帶回', '物流寄送', '廠商直送') THEN RETURN public.ga_inv_tr_err(400, 'INVALID_SHIPPING_METHOD', '運送方式錯誤'); END IF;
  IF v_unit NOT IN ('BASE', 'PURCHASE') THEN RETURN public.ga_inv_tr_err(400, 'INVALID_UNIT_TYPE', '單位類型錯誤'); END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 OR p_quantity > 999999999 OR round(p_quantity, 4) <> p_quantity THEN
    RETURN public.ga_inv_tr_err(400, 'INVALID_QUANTITY', '數量必須大於 0，且最多 4 位小數');
  END IF;
  IF p_source_location_id IS NULL OR p_destination_location_id IS NULL OR p_part_id IS NULL THEN RETURN public.ga_inv_tr_err(400, 'MISSING_FIELDS', '請選擇來源位置、目的位置與料件'); END IF;
  IF p_source_location_id = p_destination_location_id THEN RETURN public.ga_inv_tr_err(400, 'SAME_LOCATION', '來源位置與目的位置不可相同'); END IF;

  -- 同一個送出識別碼同時進來只處理一次（連點、重送）。
  PERFORM pg_advisory_xact_lock(hashtextextended('ga_tr_create:' || v_uid::text || ':' || v_key, 0));
  SELECT * INTO v_t FROM public.ga_inventory_transfers WHERE created_by = v_uid AND create_key = v_key AND deleted_at IS NULL;
  IF FOUND THEN
    SELECT * INTO v_item FROM public.ga_inventory_transfer_items WHERE transfer_id = v_t.id ORDER BY created_at LIMIT 1;
    IF v_t.source_location_id <> p_source_location_id OR v_t.destination_location_id <> p_destination_location_id
       OR v_item.part_id <> p_part_id OR v_item.quantity_input <> p_quantity THEN
      RETURN public.ga_inv_tr_err(409, 'IDEMPOTENCY_CONFLICT', '這個送出識別碼已被另一張不同內容的調撥單使用，請重新整理畫面後再送出');
    END IF;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', true, 'data', public.ga_inv_tr_data(v_t.id));
  END IF;

  SELECT * INTO v_src FROM public.ga_inventory_locations WHERE id = p_source_location_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN public.ga_inv_tr_err(404, 'LOCATION_NOT_FOUND', '找不到來源位置（可能已被刪除）'); END IF;
  IF NOT v_src.is_active THEN RETURN public.ga_inv_tr_err(409, 'LOCATION_INACTIVE', '來源位置已停用，不能建立調撥單'); END IF;
  SELECT * INTO v_dst FROM public.ga_inventory_locations WHERE id = p_destination_location_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN public.ga_inv_tr_err(404, 'LOCATION_NOT_FOUND', '找不到目的位置（可能已被刪除）'); END IF;
  IF NOT v_dst.is_active THEN RETURN public.ga_inv_tr_err(409, 'LOCATION_INACTIVE', '目的位置已停用，不能建立調撥單'); END IF;
  SELECT * INTO v_part FROM public.ga_parts WHERE id = p_part_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN public.ga_inv_tr_err(404, 'PART_NOT_FOUND', '找不到這個料件（可能已被刪除）'); END IF;
  IF NOT v_part.is_active THEN RETURN public.ga_inv_tr_err(409, 'PART_INACTIVE', '這個料件已停用，不能建立調撥單'); END IF;
  IF v_unit = 'PURCHASE' AND (v_part.purchase_unit IS NULL OR v_part.purchase_to_base_rate IS NULL OR v_part.purchase_to_base_rate <= 0) THEN
    RETURN public.ga_inv_tr_err(422, 'INVALID_PURCHASE_UNIT', '這個料件沒有設定有效的採購單位換算率，請改用基本單位');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ga_inventory_location_parts WHERE location_id = p_source_location_id AND part_id = p_part_id AND is_active AND deleted_at IS NULL) THEN
    RETURN public.ga_inv_tr_err(422, 'SOURCE_PART_NOT_CONFIGURED', '來源位置還沒有設定（或已停用）這個料件，請先到「庫存位置」加入料件設定',
      jsonb_build_object('shortcut', 'locations', 'location_id', p_source_location_id));
  END IF;
  -- C8：目的位置沒設定這個料件，收貨一定失敗，所以建單時就擋，並附前往位置設定的捷徑。
  IF NOT EXISTS (SELECT 1 FROM public.ga_inventory_location_parts WHERE location_id = p_destination_location_id AND part_id = p_part_id AND is_active AND deleted_at IS NULL) THEN
    RETURN public.ga_inv_tr_err(422, 'DESTINATION_PART_NOT_CONFIGURED', '目的位置還沒有設定（或已停用）這個料件，收貨時會失敗，請先到「庫存位置」為目的位置加入這個料件',
      jsonb_build_object('shortcut', 'locations', 'location_id', p_destination_location_id));
  END IF;
  v_base := CASE WHEN v_unit = 'PURCHASE' THEN p_quantity * v_part.purchase_to_base_rate ELSE p_quantity END;
  SELECT quantity_base INTO v_bal FROM public.ga_inventory_balances WHERE location_id = p_source_location_id AND part_id = p_part_id;
  v_bal := COALESCE(v_bal, 0);

  -- 連結需求單：驗證需求單存在、剩餘需求量，不覆蓋進行中的其他處理方式。
  IF p_request_id IS NOT NULL THEN
    SELECT * INTO v_req FROM public.ga_service_requests WHERE id = p_request_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RETURN public.ga_inv_tr_err(404, 'REQUEST_NOT_FOUND', '找不到來源需求單（可能已被刪除）'); END IF;
    IF v_req.main_status IN ('COMPLETED', 'REJECTED', 'CANCELED') THEN RETURN public.ga_inv_tr_err(409, 'REQUEST_CLOSED', '這張需求單已結案、退回或取消，不能再建立調撥單'); END IF;
    IF v_req.part_id IS NOT NULL AND v_req.part_id <> p_part_id THEN RETURN public.ga_inv_tr_err(422, 'REQUEST_PART_MISMATCH', '調撥的料件和需求單指定的料件不同'); END IF;
    -- 需求量的單位以需求單的單位為準：調撥單位不同時換算成需求單位後再比較，單據也以需求單位記錄數量（與預填換算一致）。
    v_qty_req_unit := p_quantity;
    IF v_req.desired_unit IS NOT NULL AND v_part.purchase_unit IS NOT NULL AND v_part.purchase_to_base_rate > 0 THEN
      IF v_req.desired_unit = v_part.purchase_unit AND v_req.desired_unit <> v_part.base_unit AND v_unit = 'BASE' THEN v_qty_req_unit := round(p_quantity / v_part.purchase_to_base_rate, 4);
      ELSIF v_req.desired_unit = v_part.base_unit AND v_req.desired_unit <> v_part.purchase_unit AND v_unit = 'PURCHASE' THEN v_qty_req_unit := round(p_quantity * v_part.purchase_to_base_rate, 4); END IF;
    END IF;
    SELECT * INTO v_ful FROM public.ga_part_fulfillments WHERE request_id = p_request_id FOR UPDATE;
    IF FOUND AND v_ful.deleted_at IS NULL AND v_ful.status IN ('COMPLETED', 'CANCELED') THEN
      RETURN public.ga_inv_tr_err(409, 'REQUEST_CLOSED', '這張需求單的料件處理已結案或取消，不能再建立調撥單');
    END IF;
    v_requested := COALESCE(CASE WHEN FOUND AND v_ful.deleted_at IS NULL THEN v_ful.requested_quantity END, v_req.desired_quantity, 0);
    v_committed := 0;
    IF v_ful.id IS NOT NULL AND v_ful.deleted_at IS NULL THEN
      SELECT COALESCE(sum(quantity), 0) INTO v_committed FROM public.ga_part_fulfillment_documents WHERE fulfillment_id = v_ful.id AND COALESCE(status, '') <> 'CANCELED';
    END IF;
    v_remaining := GREATEST(0, v_requested - v_committed);
    IF v_requested > 0 AND v_qty_req_unit > v_remaining + 0.00005 THEN
      RETURN public.ga_inv_tr_err(422, 'EXCEEDS_REMAINING_REQUEST', '調撥數量不可超過需求單剩餘需求量 ' || trim(trailing '.' FROM trim(trailing '0' FROM round(v_remaining, 4)::text)) || COALESCE(v_req.desired_unit, ''),
        jsonb_build_object('remaining', v_remaining));
    END IF;
  END IF;

  v_no := 'GAT-' || to_char(now() AT TIME ZONE 'Asia/Taipei', 'YYYYMMDD') || '-' || lpad(nextval('public.ga_inventory_transfer_no_seq')::text, 5, '0');
  INSERT INTO public.ga_inventory_transfers (transfer_no, source_location_id, destination_location_id, reason, notes, shipping_method, created_by, updated_by, create_key)
  VALUES (v_no, p_source_location_id, p_destination_location_id, v_reason, v_notes, v_ship, v_uid, v_uid, v_key) RETURNING * INTO v_t;
  INSERT INTO public.ga_inventory_transfer_items (transfer_id, part_id, quantity_input, input_unit_type, created_by, updated_by)
  VALUES (v_t.id, p_part_id, p_quantity, v_unit, v_uid, v_uid);
  INSERT INTO public.ga_inventory_transfer_events (transfer_id, action, from_status, to_status, note, idempotency_key, created_by, metadata)
  VALUES (v_t.id, 'create', NULL, 'REQUESTED', v_notes, 'create', v_uid, jsonb_build_object('request_id', p_request_id));

  IF p_request_id IS NOT NULL THEN
    IF v_ful.id IS NULL THEN
      INSERT INTO public.ga_part_fulfillments (request_id, status, requested_quantity, unit, current_step, created_by, updated_by)
      VALUES (p_request_id, 'TRANSFER', v_req.desired_quantity, v_req.desired_unit, '已建立調撥單，等待來源確認', v_uid, v_uid) RETURNING * INTO v_ful;
    ELSE
      -- 已有處理單：只在「待決定／調撥／異常」時改成調撥；進行中的其他處理方式（領用、採購、等待）不覆蓋，只加上單據連結。
      IF v_ful.deleted_at IS NOT NULL THEN
        UPDATE public.ga_part_fulfillments SET deleted_at = NULL, status = 'TRANSFER', requested_quantity = v_req.desired_quantity, unit = v_req.desired_unit,
               current_step = '已建立調撥單，等待來源確認', updated_by = v_uid WHERE id = v_ful.id;
      ELSIF v_ful.status IN ('PENDING_DECISION', 'TRANSFER', 'EXCEPTION') THEN
        UPDATE public.ga_part_fulfillments SET status = 'TRANSFER', current_step = '已建立調撥單，等待來源確認', updated_by = v_uid WHERE id = v_ful.id;
      END IF;
    END IF;
    INSERT INTO public.ga_part_fulfillment_documents (fulfillment_id, document_type, document_id, document_no, quantity, status, created_by)
    VALUES (v_ful.id, 'TRANSFER', v_t.id, v_t.transfer_no, v_qty_req_unit, 'REQUESTED', v_uid);
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 201, 'replay', false, 'data', public.ga_inv_tr_data(v_t.id),
    'warnings', CASE WHEN v_bal < v_base THEN jsonb_build_array(jsonb_build_object('code', 'LOW_STOCK', 'balance', v_bal, 'need', v_base,
      'message', '來源位置目前庫存不足（庫存 ' || trim(trailing '.' FROM trim(trailing '0' FROM round(v_bal, 4)::text)) || '，需要 ' || trim(trailing '.' FROM trim(trailing '0' FROM round(v_base, 4)::text)) || '），交出時可能失敗')) ELSE '[]'::jsonb END);
END;
$$;

-- ---------------------------------------------------------------- 5. 動作
CREATE OR REPLACE FUNCTION public.ga_ws_inv_transfer_action(
  p_transfer_id uuid, p_action text, p_expected_updated_at timestamptz, p_idempotency_key text,
  p_note text DEFAULT NULL, p_shipping_method text DEFAULT NULL, p_return_stock boolean DEFAULT false, p_exception_type text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_perm jsonb;
  v_action text := lower(btrim(COALESCE(p_action, '')));
  v_key text := ga_normalize_optional_text(p_idempotency_key);
  v_note text := ga_normalize_optional_text(p_note);
  v_ship text := ga_normalize_optional_text(p_shipping_method);
  v_exc text := upper(ga_normalize_optional_text(p_exception_type));
  v_t public.ga_inventory_transfers%ROWTYPE;
  v_ev public.ga_inventory_transfer_events%ROWTYPE;
  v_src public.ga_inventory_locations%ROWTYPE;
  v_dst public.ga_inventory_locations%ROWTYPE;
  v_item record;
  v_res jsonb;
  v_to text;
  v_label text;
  v_cancel_reason text;
  v_returned integer := 0;
  v_issued boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_inv_tr_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF v_action NOT IN ('confirm_source', 'ship', 'receive', 'cancel', 'mark_unreceived') THEN RETURN public.ga_inv_tr_err(400, 'INVALID_ACTION', '調撥動作錯誤'); END IF;
  v_perm := public.ga_inv_tr_perm_error(v_uid);
  IF v_perm IS NOT NULL THEN RETURN v_perm; END IF;
  IF v_key IS NULL OR length(v_key) > 60 THEN RETURN public.ga_inv_tr_err(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少防重複識別碼，請重新整理畫面後再送出'); END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN RETURN public.ga_inv_tr_err(400, 'NOTES_TOO_LONG', '備註不可超過 500 字'); END IF;
  IF v_ship IS NOT NULL AND v_ship NOT IN ('總務配送', '門市人員帶回', '物流寄送', '廠商直送') THEN RETURN public.ga_inv_tr_err(400, 'INVALID_SHIPPING_METHOD', '運送方式錯誤'); END IF;
  IF v_exc IS NOT NULL AND v_exc NOT IN ('SHORT_RECEIVED', 'DAMAGED', 'WRONG_ITEM', 'LOST', 'OTHER') THEN RETURN public.ga_inv_tr_err(400, 'INVALID_EXCEPTION_TYPE', '異常類型錯誤'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_inv_tr_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;

  SELECT * INTO v_t FROM public.ga_inventory_transfers WHERE id = p_transfer_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN public.ga_inv_tr_err(404, 'TRANSFER_NOT_FOUND', '找不到這張調撥單（可能已被刪除）'); END IF;

  -- 固定識別：同一個動作重送（連點、網路重試）直接回目前結果，不再扣帳。
  SELECT * INTO v_ev FROM public.ga_inventory_transfer_events WHERE transfer_id = p_transfer_id AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_ev.action <> v_action THEN RETURN public.ga_inv_tr_err(409, 'IDEMPOTENCY_CONFLICT', '這個送出識別碼已被另一個不同的動作使用，請重新整理畫面後再處理'); END IF;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', true, 'data', public.ga_inv_tr_data(p_transfer_id));
  END IF;
  IF v_t.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN public.ga_inv_tr_err(409, 'STALE', '這張調撥單已被其他人處理過，請重新載入後再確認', jsonb_build_object('current_status', v_t.status));
  END IF;

  -- 狀態條件
  IF v_action = 'confirm_source' AND v_t.status <> 'REQUESTED' THEN RETURN public.ga_inv_tr_err(409, 'INVALID_STATE', '只有待來源確認的調撥單可以確認交出'); END IF;
  IF v_action = 'ship' AND v_t.status <> 'SOURCE_CONFIRMED' THEN RETURN public.ga_inv_tr_err(409, 'INVALID_STATE', '只有已確認交出的調撥單可以標記運送中'); END IF;
  IF v_action = 'receive' AND v_t.status NOT IN ('SOURCE_CONFIRMED', 'IN_TRANSIT') THEN RETURN public.ga_inv_tr_err(409, 'INVALID_STATE', '只有已交出或運送中的調撥單可以收貨'); END IF;
  IF v_action = 'mark_unreceived' AND v_t.status NOT IN ('SOURCE_CONFIRMED', 'IN_TRANSIT') THEN RETURN public.ga_inv_tr_err(409, 'INVALID_STATE', '只有已交出或運送中的調撥單可以註記未收'); END IF;
  IF v_action = 'cancel' AND v_t.status IN ('RECEIVED', 'CANCELED') THEN RETURN public.ga_inv_tr_err(409, 'INVALID_STATE', '已收貨或已取消的調撥單不可取消'); END IF;
  IF v_action = 'cancel' AND v_exc IS NULL AND v_note IS NULL THEN RETURN public.ga_inv_tr_err(400, 'CANCEL_REASON_REQUIRED', '取消調撥必須填寫原因'); END IF;
  IF v_action = 'cancel' AND v_exc = 'OTHER' AND v_note IS NULL THEN RETURN public.ga_inv_tr_err(400, 'CANCEL_REASON_REQUIRED', '異常類型選「其他」時必須填寫說明'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ga_inventory_transfer_items WHERE transfer_id = v_t.id) THEN RETURN public.ga_inv_tr_err(409, 'NO_ITEMS', '調撥單沒有料件明細'); END IF;

  SELECT * INTO v_src FROM public.ga_inventory_locations WHERE id = v_t.source_location_id;
  SELECT * INTO v_dst FROM public.ga_inventory_locations WHERE id = v_t.destination_location_id;

  BEGIN
    IF v_action = 'confirm_source' THEN
      IF v_src.deleted_at IS NOT NULL OR NOT v_src.is_active THEN RAISE EXCEPTION USING ERRCODE = 'P0A13', MESSAGE = public.ga_inv_tr_err(409, 'LOCATION_INACTIVE', '來源位置已停用，不能確認交出')::text; END IF;
      FOR v_item IN SELECT * FROM public.ga_inventory_transfer_items WHERE transfer_id = v_t.id AND source_transaction_id IS NULL ORDER BY id LOOP
        v_res := public.ga_ws_inv_post('ISSUE', v_t.source_location_id, v_item.part_id, v_item.quantity_input, v_item.input_unit_type, '調撥交出：' || v_t.transfer_no, v_note,
          v_key || ':ISSUE:' || v_item.id::text, NULL, 'INVENTORY_TRANSFER', v_t.id,
          jsonb_build_object('transfer_no', v_t.transfer_no, 'transfer_item_id', v_item.id, 'action', 'confirm_source'));
        IF (v_res->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE = 'P0A13', MESSAGE = v_res::text; END IF;
        UPDATE public.ga_inventory_transfer_items SET source_transaction_id = (v_res->'data'->>'transaction_id')::uuid, updated_by = v_uid WHERE id = v_item.id;
      END LOOP;
      UPDATE public.ga_inventory_transfers SET status = 'SOURCE_CONFIRMED', source_confirmed_at = now(), source_confirmed_by = v_uid,
             shipping_method = COALESCE(v_ship, shipping_method), updated_by = v_uid WHERE id = v_t.id;
      v_to := 'SOURCE_CONFIRMED';

    ELSIF v_action = 'ship' THEN
      UPDATE public.ga_inventory_transfers SET status = 'IN_TRANSIT', shipped_at = now(), shipping_method = COALESCE(v_ship, shipping_method), updated_by = v_uid WHERE id = v_t.id;
      v_to := 'IN_TRANSIT';

    ELSIF v_action = 'receive' THEN
      IF v_dst.deleted_at IS NOT NULL OR NOT v_dst.is_active THEN RAISE EXCEPTION USING ERRCODE = 'P0A13', MESSAGE = public.ga_inv_tr_err(409, 'LOCATION_INACTIVE', '目的位置已停用，不能收貨')::text; END IF;
      FOR v_item IN SELECT * FROM public.ga_inventory_transfer_items WHERE transfer_id = v_t.id AND receipt_transaction_id IS NULL ORDER BY id LOOP
        IF v_item.source_transaction_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = 'P0A13', MESSAGE = public.ga_inv_tr_err(409, 'INVALID_STATE', '尚未完成來源交出，不可收貨')::text; END IF;
        v_res := public.ga_ws_inv_post('RECEIPT', v_t.destination_location_id, v_item.part_id, v_item.quantity_input, v_item.input_unit_type, '調撥收貨：' || v_t.transfer_no, v_note,
          v_key || ':RECEIPT:' || v_item.id::text, NULL, 'INVENTORY_TRANSFER', v_t.id,
          jsonb_build_object('transfer_no', v_t.transfer_no, 'transfer_item_id', v_item.id, 'action', 'receive'));
        IF (v_res->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE = 'P0A13', MESSAGE = v_res::text; END IF;
        UPDATE public.ga_inventory_transfer_items SET receipt_transaction_id = (v_res->'data'->>'transaction_id')::uuid, updated_by = v_uid WHERE id = v_item.id;
      END LOOP;
      UPDATE public.ga_inventory_transfers SET status = 'RECEIVED', received_at = now(), received_by = v_uid, updated_by = v_uid WHERE id = v_t.id;
      v_to := 'RECEIVED';

    ELSIF v_action = 'cancel' THEN
      v_issued := EXISTS (SELECT 1 FROM public.ga_inventory_transfer_items WHERE transfer_id = v_t.id AND source_transaction_id IS NOT NULL AND receipt_transaction_id IS NULL);
      IF COALESCE(p_return_stock, false) THEN
        IF NOT v_issued THEN RAISE EXCEPTION USING ERRCODE = 'P0A13', MESSAGE = public.ga_inv_tr_err(422, 'NOTHING_TO_RETURN', '這張單還沒有交出（來源庫存沒有被扣），沒有庫存可以退回')::text; END IF;
        FOR v_item IN SELECT * FROM public.ga_inventory_transfer_items WHERE transfer_id = v_t.id AND source_transaction_id IS NOT NULL AND receipt_transaction_id IS NULL AND return_transaction_id IS NULL ORDER BY id LOOP
          v_res := public.ga_ws_inv_post('RECEIPT', v_t.source_location_id, v_item.part_id, v_item.quantity_input, v_item.input_unit_type, '調撥取消退回來源：' || v_t.transfer_no, v_note,
            v_key || ':RETURN:' || v_item.id::text, NULL, 'INVENTORY_TRANSFER', v_t.id,
            jsonb_build_object('transfer_no', v_t.transfer_no, 'transfer_item_id', v_item.id, 'action', 'return_stock'));
          IF (v_res->>'ok')::boolean IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE = 'P0A13', MESSAGE = v_res::text; END IF;
          UPDATE public.ga_inventory_transfer_items SET return_transaction_id = (v_res->'data'->>'transaction_id')::uuid, updated_by = v_uid WHERE id = v_item.id;
          v_returned := v_returned + 1;
        END LOOP;
      END IF;
      v_label := CASE v_exc WHEN 'SHORT_RECEIVED' THEN '少收' WHEN 'DAMAGED' THEN '損壞' WHEN 'WRONG_ITEM' THEN '品項錯誤' WHEN 'LOST' THEN '遺失' WHEN 'OTHER' THEN '其他' END;
      v_cancel_reason := CASE WHEN v_exc IS NOT NULL THEN '調撥異常：' || v_label || COALESCE('｜' || v_note, '') ELSE v_note END;
      UPDATE public.ga_inventory_transfers SET status = 'CANCELED', canceled_at = now(), canceled_by = v_uid, cancel_reason = v_cancel_reason,
             exception_type = v_exc, updated_by = v_uid WHERE id = v_t.id;
      v_to := 'CANCELED';

    ELSE -- mark_unreceived（C9）：只註記，單子仍待收貨
      UPDATE public.ga_inventory_transfers SET unreceived_note = COALESCE(v_note, '目的位置回報尚未收到'), unreceived_marked_at = now(), unreceived_marked_by = v_uid, updated_by = v_uid WHERE id = v_t.id;
      v_to := v_t.status;
    END IF;

    INSERT INTO public.ga_inventory_transfer_events (transfer_id, action, from_status, to_status, note, idempotency_key, created_by, metadata)
    VALUES (v_t.id, v_action, v_t.status, v_to, v_note, v_key, v_uid,
            jsonb_build_object('return_stock', COALESCE(p_return_stock, false) AND v_returned > 0, 'exception_type', v_exc, 'shipping_method', v_ship));
    IF v_action <> 'mark_unreceived' THEN PERFORM public.ga_inv_tr_sync_fulfillment(v_t.id, v_to, v_uid); END IF;
  EXCEPTION
    WHEN SQLSTATE 'P0A13' THEN
      RETURN SQLERRM::jsonb;
    WHEN OTHERS THEN
      RETURN public.ga_inv_map_error(SQLERRM, SQLSTATE);
  END;

  RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', false, 'data', public.ga_inv_tr_data(v_t.id) || jsonb_build_object('returned_items', v_returned));
END;
$$;

-- ---------------------------------------------------------------- 6. 店長回報（C10）
CREATE OR REPLACE FUNCTION public.ga_ws_inv_transfer_store_report(
  p_transfer_id uuid, p_type text, p_note text, p_expected_updated_at timestamptz, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_type text := upper(ga_normalize_optional_text(p_type));
  v_note text := ga_normalize_optional_text(p_note);
  v_key text := ga_normalize_optional_text(p_idempotency_key);
  v_t public.ga_inventory_transfers%ROWTYPE;
  v_ev public.ga_inventory_transfer_events%ROWTYPE;
  v_dst public.ga_inventory_locations%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_inv_tr_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF v_type IS NULL OR v_type NOT IN ('NOT_ARRIVED', 'DAMAGED', 'WRONG_ITEM', 'SHORT_QUANTITY', 'OTHER') THEN RETURN public.ga_inv_tr_err(400, 'INVALID_REPORT_TYPE', '請選擇問題類型'); END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN RETURN public.ga_inv_tr_err(400, 'NOTES_TOO_LONG', '說明不可超過 500 字'); END IF;
  IF v_type = 'OTHER' AND v_note IS NULL THEN RETURN public.ga_inv_tr_err(400, 'NOTE_REQUIRED', '問題類型選「其他」時必須填寫說明'); END IF;
  IF v_key IS NULL OR length(v_key) > 60 THEN RETURN public.ga_inv_tr_err(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少防重複識別碼，請重新整理畫面後再送出'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_inv_tr_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  SELECT * INTO v_t FROM public.ga_inventory_transfers WHERE id = p_transfer_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN public.ga_inv_tr_err(404, 'TRANSFER_NOT_FOUND', '找不到這張調撥單'); END IF;
  SELECT * INTO v_dst FROM public.ga_inventory_locations WHERE id = v_t.destination_location_id;
  -- 只有目的門市（STORE 位置）名單上、身分為店長（role_type = store_manager）的人可以回報；督導與區經理只能唯讀。
  IF v_dst.location_type <> 'STORE' OR v_dst.store_id IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.store_managers sm WHERE sm.user_id = v_uid AND sm.store_id = v_dst.store_id AND sm.role_type = 'store_manager') THEN
    RETURN public.ga_inv_tr_err(403, 'ONLY_DESTINATION_STORE_MANAGER', '只有目的門市的店長可以回報這張調撥單的問題');
  END IF;
  SELECT * INTO v_ev FROM public.ga_inventory_transfer_events WHERE transfer_id = p_transfer_id AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_ev.action <> 'store_report' THEN RETURN public.ga_inv_tr_err(409, 'IDEMPOTENCY_CONFLICT', '這個送出識別碼已被另一個不同的動作使用，請重新整理畫面後再處理'); END IF;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', true, 'data', public.ga_inv_tr_data(p_transfer_id));
  END IF;
  IF v_t.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN public.ga_inv_tr_err(409, 'STALE', '這張調撥單已被其他人處理過，請重新載入後再回報', jsonb_build_object('current_status', v_t.status));
  END IF;
  IF v_t.status NOT IN ('SOURCE_CONFIRMED', 'IN_TRANSIT', 'RECEIVED') THEN RETURN public.ga_inv_tr_err(409, 'INVALID_STATE', '調撥單還沒交出或已取消，現在不能回報收貨問題'); END IF;
  UPDATE public.ga_inventory_transfers SET store_report_type = v_type, store_report_note = v_note, store_reported_at = now(), store_reported_by = v_uid, updated_by = v_uid WHERE id = v_t.id;
  INSERT INTO public.ga_inventory_transfer_events (transfer_id, action, from_status, to_status, note, idempotency_key, created_by, metadata)
  VALUES (v_t.id, 'store_report', v_t.status, v_t.status, v_note, v_key, v_uid, jsonb_build_object('report_type', v_type));
  RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', false, 'data', public.ga_inv_tr_data(v_t.id));
END;
$$;

-- ---------------------------------------------------------------- 7. 逾期天數（C11）
CREATE OR REPLACE FUNCTION public.ga_ws_inv_transfer_set_overdue_days(p_days integer, p_expected_updated_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cur public.ga_inventory_transfer_settings%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_inv_tr_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.inventory_transfer.manage') THEN RETURN public.ga_inv_tr_err(403, 'PERMISSION_DENIED', '沒有調撥管理權限，不能修改逾期天數'); END IF;
  IF p_days IS NULL OR p_days < 1 OR p_days > 90 THEN RETURN public.ga_inv_tr_err(400, 'INVALID_DAYS', '逾期天數必須是 1 到 90 的整數'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_inv_tr_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入畫面'); END IF;
  SELECT * INTO v_cur FROM public.ga_inventory_transfer_settings WHERE id FOR UPDATE;
  IF v_cur.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_inv_tr_err(409, 'STALE', '逾期天數已被其他人修改過，請重新載入後再處理'); END IF;
  UPDATE public.ga_inventory_transfer_settings SET overdue_days = p_days, updated_at = clock_timestamp(), updated_by = v_uid WHERE id RETURNING * INTO v_cur;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('overdue_days', v_cur.overdue_days, 'updated_at', v_cur.updated_at));
END;
$$;

-- ---------------------------------------------------------------- 授權
REVOKE ALL ON FUNCTION public.ga_inv_tr_err(integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_inv_tr_perm_error(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_inv_tr_sync_fulfillment(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_inv_tr_data(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_inv_transfer_create(uuid, uuid, uuid, numeric, text, text, text, text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_inv_transfer_action(uuid, text, timestamptz, text, text, text, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_inv_transfer_store_report(uuid, text, text, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_inv_transfer_set_overdue_days(integer, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_inv_transfer_create(uuid, uuid, uuid, numeric, text, text, text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_inv_transfer_action(uuid, text, timestamptz, text, text, text, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_inv_transfer_store_report(uuid, text, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_inv_transfer_set_overdue_days(integer, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
