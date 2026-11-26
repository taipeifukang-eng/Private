-- 還原 09_legacy_inventory_maintenance_attachment.sql：把 4 個函式與庫存序號、函式授權還原成「2026-11-25 正式區唯讀查到的現況」（原文由 pg_get_functiondef 取得；換行字元統一成 LF，內容相同）。
-- 還原後：刪除庫存位置的下層明細原因會再帶「父庫存位置刪除衍生：」前綴；庫存過帳的 ON CONFLICT 回到會報 ambiguous 的舊寫法；
--   anon、authenticated 重新能對庫存交易序號取號與直接執行取號函式、anon 重新能執行過帳函式；附件管理判斷回到 20260826004500 版。
-- 注意：附件管理判斷只有在內容仍是 09 建立的版本（md5 = 41a29efc4e62b01a7ce8f7d0fce9eead）時才還原；後面的步驟（總務第 2 批設施上線貼標、第 6 批水電帳單、第 4.5 批附件類型）
--   已改過它的話，會中止並提示，請先還原那些步驟（還原順序與套用順序相反），不然會把它們的分支一起拿掉。
-- 過帳函式只有在含新寫法時才還原。可重複執行。
BEGIN;

DO $m09$
BEGIN
  EXECUTE replace($def$
CREATE OR REPLACE FUNCTION public.ga_soft_delete_inventory_location(p_location_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT := ga_normalize_optional_text(p_reason);
  v_deleted_at TIMESTAMPTZ := NOW();
  v_updated_count INTEGER := 0;
  v_child_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入');
  END IF;

  IF NOT current_user_has_permission('general_affairs.inventory_location.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有庫存位置管理權限');
  END IF;

  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入刪除原因');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ga_inventory_locations WHERE id = p_location_id) THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到庫存位置');
  END IF;

  IF EXISTS (SELECT 1 FROM public.ga_inventory_locations WHERE id = p_location_id AND deleted_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '此庫存位置已被刪除');
  END IF;

  -- 後續建立交易表後，若位置已有任何交易紀錄，這裡必須拒絕 soft delete，改以 is_active=false 停用。
  PERFORM set_config('app.ga_soft_delete_inventory_location_part', 'true', true);
  UPDATE public.ga_inventory_location_parts
  SET
    is_active = false,
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = '父庫存位置刪除衍生：' || v_reason,
    updated_by = v_user_id
  WHERE location_id = p_location_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_child_count = ROW_COUNT;

  PERFORM set_config('app.ga_soft_delete_inventory_location', 'true', true);
  UPDATE public.ga_inventory_locations
  SET
    is_active = false,
    is_default = false,
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = v_reason,
    updated_by = v_user_id
  WHERE id = p_location_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RAISE EXCEPTION '庫存位置 soft delete 失敗，交易已中止';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'data', jsonb_build_object(
      'id', p_location_id,
      'is_active', false,
      'is_default', false,
      'deleted_at', v_deleted_at,
      'deleted_by', v_user_id,
      'deletion_reason', v_reason,
      'deleted_location_parts', v_child_count
    )
  );
END;
$function$
$def$, chr(13), '');
END
$m09$;

DO $m09$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.ga_post_inventory_transaction(text, uuid, uuid, numeric, text, text, text, text, uuid, text, timestamp with time zone, jsonb)'::regprocedure);
  IF position('ON CONFLICT ON CONSTRAINT ga_inventory_balances_location_part_unique DO NOTHING;' IN v_def) = 0 THEN
    RAISE NOTICE 'ga_post_inventory_transaction 已不是新寫法，略過';
  ELSE
    EXECUTE replace($def$
CREATE OR REPLACE FUNCTION public.ga_post_inventory_transaction(p_transaction_type text, p_location_id uuid, p_part_id uuid, p_quantity numeric, p_input_unit_type text, p_reason text, p_notes text DEFAULT NULL::text, p_reference_type text DEFAULT NULL::text, p_reference_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text, p_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(transaction_id uuid, transaction_no text, transaction_type text, location_id uuid, part_id uuid, quantity_input numeric, input_unit_type text, unit_conversion_rate numeric, quantity_base numeric, balance_before numeric, balance_after numeric, occurred_at timestamp with time zone, created_at timestamp with time zone, created_by uuid, balance_id uuid, balance_quantity_base numeric, balance_version bigint, idempotent_replay boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_transaction_type TEXT := upper(btrim(COALESCE(p_transaction_type, '')));
  v_input_unit_type TEXT := upper(btrim(COALESCE(p_input_unit_type, '')));
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
  v_notes TEXT := ga_normalize_optional_text(p_notes);
  v_reference_type TEXT := upper(ga_normalize_optional_text(p_reference_type));
  v_idempotency_key TEXT := ga_normalize_optional_text(p_idempotency_key);
  v_metadata JSONB := COALESCE(p_metadata, '{}'::jsonb);
  v_quantity_input NUMERIC := p_quantity;
  v_location public.ga_inventory_locations%ROWTYPE;
  v_part public.ga_parts%ROWTYPE;
  v_balance public.ga_inventory_balances%ROWTYPE;
  v_existing public.ga_inventory_transactions%ROWTYPE;
  v_rate NUMERIC(18,6);
  v_abs_base_unrounded NUMERIC;
  v_abs_base NUMERIC(18,4);
  v_signed_base NUMERIC(18,4);
  v_before NUMERIC(18,4);
  v_after NUMERIC(18,4);
  v_payload JSONB;
  v_payload_hash TEXT;
  v_transaction_no TEXT;
  v_transaction_id UUID;
  v_occurred_at TIMESTAMPTZ := COALESCE(p_occurred_at, NOW());
  v_created_at TIMESTAMPTZ := NOW();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: 請先登入';
  END IF;

  IF NOT current_user_has_permission('general_affairs.inventory_transaction.manage') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: 沒有庫存交易管理權限';
  END IF;

  IF NOT (
    current_user_has_permission('general_affairs.part.view')
    OR current_user_has_permission('general_affairs.part.manage')
  ) THEN
    RAISE EXCEPTION 'PART_VIEW_REQUIRED: 缺少 general_affairs.part.view，因此無法建立庫存交易';
  END IF;

  IF v_transaction_type NOT IN ('RECEIPT', 'ISSUE', 'ADJUST_IN', 'ADJUST_OUT') THEN
    RAISE EXCEPTION 'INVALID_TRANSACTION_TYPE: 庫存交易類型錯誤';
  END IF;

  IF v_input_unit_type NOT IN ('BASE', 'PURCHASE') THEN
    RAISE EXCEPTION 'INVALID_UNIT_TYPE: 庫存交易單位類型錯誤';
  END IF;

  IF v_quantity_input IS NULL OR v_quantity_input <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: 庫存交易數量必須大於 0';
  END IF;

  IF v_reason = '' THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: 請輸入庫存交易原因';
  END IF;

  IF jsonb_typeof(v_metadata) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: 庫存交易 metadata 必須是 JSON object';
  END IF;

  IF p_reference_id IS NOT NULL AND (v_reference_type IS NULL OR v_reference_type = '') THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: reference_id 有值時必須提供 reference_type';
  END IF;

  SELECT *
  INTO v_location
  FROM public.ga_inventory_locations
  WHERE id = p_location_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LOCATION_NOT_FOUND: 找不到庫存位置';
  END IF;

  IF v_location.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'LOCATION_NOT_FOUND: 此庫存位置已被刪除';
  END IF;

  IF v_location.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'LOCATION_INACTIVE: 此庫存位置已停用';
  END IF;

  SELECT *
  INTO v_part
  FROM public.ga_parts
  WHERE id = p_part_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PART_NOT_FOUND: 找不到料件';
  END IF;

  IF v_part.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'PART_NOT_FOUND: 此料件已被刪除';
  END IF;

  IF v_part.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PART_INACTIVE: 此料件已停用';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.ga_inventory_location_parts lp
    WHERE lp.location_id = p_location_id
      AND lp.part_id = p_part_id
      AND lp.is_active = true
      AND lp.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'LOCATION_PART_NOT_CONFIGURED: 此庫存位置尚未啟用此料件設定';
  END IF;

  IF v_input_unit_type = 'BASE' THEN
    v_rate := 1;
  ELSE
    IF v_part.purchase_unit IS NULL OR v_part.purchase_to_base_rate IS NULL OR v_part.purchase_to_base_rate <= 0 THEN
      RAISE EXCEPTION 'INVALID_PURCHASE_UNIT: 此料件未設定有效採購單位換算率';
    END IF;
    v_rate := v_part.purchase_to_base_rate;
  END IF;

  v_abs_base_unrounded := v_quantity_input * v_rate;
  v_abs_base := round(v_abs_base_unrounded, 4);

  IF v_abs_base <> v_abs_base_unrounded THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: 換算後 base quantity 超過 4 位小數';
  END IF;

  IF v_abs_base <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: 換算後 base quantity 必須大於 0';
  END IF;

  IF v_part.allow_fractional_issue IS DISTINCT FROM true AND v_abs_base <> trunc(v_abs_base) THEN
    RAISE EXCEPTION 'FRACTIONAL_NOT_ALLOWED: 此料件不允許小數領用';
  END IF;

  IF v_transaction_type IN ('ISSUE', 'ADJUST_OUT') THEN
    IF v_part.minimum_issue_qty IS NOT NULL AND v_abs_base < v_part.minimum_issue_qty THEN
      RAISE EXCEPTION 'MINIMUM_ISSUE_NOT_MET: 低於最小領用量';
    END IF;

    IF v_part.allow_unpacking IS DISTINCT FROM true
      AND v_part.purchase_unit IS NOT NULL
      AND v_part.purchase_to_base_rate IS NOT NULL
      AND v_part.purchase_to_base_rate > 0
      AND mod(v_abs_base, v_part.purchase_to_base_rate) <> 0 THEN
      RAISE EXCEPTION 'UNPACKING_NOT_ALLOWED: 此料件不允許拆包領用';
    END IF;
  END IF;

  IF v_transaction_type IN ('RECEIPT', 'ADJUST_IN') THEN
    v_signed_base := v_abs_base;
  ELSE
    v_signed_base := -v_abs_base;
  END IF;

  v_payload := jsonb_build_object(
    'transaction_type', v_transaction_type,
    'location_id', p_location_id,
    'part_id', p_part_id,
    'quantity', v_quantity_input,
    'input_unit_type', v_input_unit_type,
    'reason', v_reason,
    'notes', v_notes,
    'reference_type', v_reference_type,
    'reference_id', p_reference_id,
    'occurred_at', p_occurred_at,
    'metadata', v_metadata
  );

  IF v_idempotency_key IS NOT NULL THEN
    v_payload_hash := md5(v_payload::TEXT);

    -- Advisory locks serialize same actor/key retries and same location/part stock movement.
    -- Hash collisions are theoretically possible; unique constraints and row locks remain the final correctness guard.
    PERFORM pg_advisory_xact_lock(hashtextextended('ga_inventory_idempotency:' || v_user_id::TEXT || ':' || v_idempotency_key, 0));
  ELSE
    v_payload_hash := NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ga_inventory_location_part:' || p_location_id::TEXT || ':' || p_part_id::TEXT, 0));

  IF v_idempotency_key IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.ga_inventory_transactions t
    WHERE t.created_by = v_user_id
      AND t.idempotency_key = v_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      IF v_existing.idempotency_payload_hash = v_payload_hash THEN
        SELECT *
        INTO v_balance
        FROM public.ga_inventory_balances b
        WHERE b.location_id = v_existing.location_id
          AND b.part_id = v_existing.part_id;

        RETURN QUERY
        SELECT
          v_existing.id,
          v_existing.transaction_no,
          v_existing.transaction_type,
          v_existing.location_id,
          v_existing.part_id,
          v_existing.quantity_input,
          v_existing.input_unit_type,
          v_existing.unit_conversion_rate,
          v_existing.quantity_base,
          v_existing.balance_before,
          v_existing.balance_after,
          v_existing.occurred_at,
          v_existing.created_at,
          v_existing.created_by,
          v_balance.id,
          v_balance.quantity_base,
          v_balance.version,
          true;
        RETURN;
      END IF;

      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: idempotency_key 已被不同請求使用';
    END IF;
  END IF;

  INSERT INTO public.ga_inventory_balances (
    location_id,
    part_id,
    quantity_base,
    version,
    created_at,
    created_by,
    updated_at,
    updated_by
  )
  VALUES (
    p_location_id,
    p_part_id,
    0,
    0,
    v_created_at,
    v_user_id,
    v_created_at,
    v_user_id
  )
  ON CONFLICT (location_id, part_id) DO NOTHING;

  SELECT *
  INTO v_balance
  FROM public.ga_inventory_balances b
  WHERE b.location_id = p_location_id
    AND b.part_id = p_part_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LOCATION_PART_NOT_CONFIGURED: 無法建立或鎖定庫存餘額';
  END IF;

  v_before := v_balance.quantity_base;
  v_after := v_before + v_signed_base;

  IF v_location.allow_negative_stock IS DISTINCT FROM true AND v_after < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: 庫存不足';
  END IF;

  v_transaction_id := gen_random_uuid();
  v_transaction_no := public.ga_next_inventory_transaction_no();

  INSERT INTO public.ga_inventory_transactions (
    id,
    transaction_no,
    transaction_type,
    location_id,
    part_id,
    quantity_input,
    input_unit_type,
    unit_conversion_rate,
    quantity_base,
    balance_before,
    balance_after,
    reference_type,
    reference_id,
    idempotency_key,
    idempotency_payload_hash,
    reason,
    notes,
    metadata,
    occurred_at,
    created_at,
    created_by
  )
  VALUES (
    v_transaction_id,
    v_transaction_no,
    v_transaction_type,
    p_location_id,
    p_part_id,
    v_quantity_input,
    v_input_unit_type,
    v_rate,
    v_signed_base,
    v_before,
    v_after,
    v_reference_type,
    p_reference_id,
    v_idempotency_key,
    v_payload_hash,
    v_reason,
    v_notes,
    v_metadata,
    v_occurred_at,
    v_created_at,
    v_user_id
  );

  UPDATE public.ga_inventory_balances
  SET
    quantity_base = v_after,
    last_transaction_id = v_transaction_id,
    last_transaction_at = v_occurred_at,
    version = version + 1,
    updated_at = v_created_at,
    updated_by = v_user_id
  WHERE id = v_balance.id
  RETURNING *
  INTO v_balance;

  RETURN QUERY
  SELECT
    v_transaction_id,
    v_transaction_no,
    v_transaction_type,
    p_location_id,
    p_part_id,
    v_quantity_input,
    v_input_unit_type,
    v_rate,
    v_signed_base,
    v_before,
    v_after,
    v_occurred_at,
    v_created_at,
    v_user_id,
    v_balance.id,
    v_balance.quantity_base,
    v_balance.version,
    false;
END;
$function$
$def$, chr(13), '');
  END IF;
END
$m09$;

DO $m09$
DECLARE
  v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef('public.ga_resource_attachment_can_manage(text,uuid)'::regprocedure));
  IF v_md5 = '41a29efc4e62b01a7ce8f7d0fce9eead' THEN
    EXECUTE replace($def$
CREATE OR REPLACE FUNCTION public.ga_resource_attachment_can_manage(p_resource_type text, p_resource_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_resource_type = 'SERVICE_REQUEST_COMMENT' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.ga_service_request_comments comment
      JOIN public.ga_service_requests request ON request.id = comment.request_id
      WHERE comment.id = p_resource_id
        AND comment.deleted_at IS NULL
        AND request.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.request.manage')
          OR public.current_user_has_permission('general_affairs.request.comment_all')
          OR (
            comment.visibility = 'PUBLIC'
            AND comment.created_by = auth.uid()
            AND public.current_user_has_permission('general_affairs.request.comment_own_store')
            AND EXISTS (
              SELECT 1
              FROM public.store_managers sm
              WHERE sm.store_id = request.store_id
                AND sm.user_id = auth.uid()
            )
          )
        )
    );
  END IF;

  IF p_resource_type = 'SERVICE_REQUEST' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.ga_service_requests request
      WHERE request.id = p_resource_id
        AND request.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.request.manage')
          OR (
            public.current_user_has_permission('general_affairs.request.create')
            AND request.created_by = auth.uid()
            AND EXISTS (
              SELECT 1
              FROM public.store_managers sm
              WHERE sm.store_id = request.store_id
                AND sm.user_id = auth.uid()
            )
          )
        )
    );
  END IF;

  IF p_resource_type = 'EQUIPMENT' THEN
    RETURN public.current_user_has_permission('general_affairs.equipment.manage')
      AND EXISTS (
        SELECT 1 FROM public.ga_equipment e
        WHERE e.id = p_resource_id
          AND e.deleted_at IS NULL
      );
  END IF;

  IF p_resource_type = 'FACILITY' THEN
    RETURN public.current_user_has_permission('general_affairs.facility.manage')
      AND EXISTS (
        SELECT 1 FROM public.ga_facilities f
        WHERE f.id = p_resource_id
          AND f.deleted_at IS NULL
      );
  END IF;

  IF p_resource_type = 'PART' THEN
    RETURN public.current_user_has_permission('general_affairs.part.manage')
      AND EXISTS (
        SELECT 1 FROM public.ga_parts p
        WHERE p.id = p_resource_id
          AND p.deleted_at IS NULL
      );
  END IF;

  IF p_resource_type = 'MAINTENANCE_REQUEST' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.maintenance_requests mr
      WHERE mr.id = p_resource_id
        AND (
          public.current_user_has_permission('general_affairs.maintenance_request.update')
          OR public.current_user_has_permission('general_affairs.work_order.update')
          OR public.current_user_has_permission('general_affairs.work_order.manage')
          OR public.current_user_has_permission('cross_dept.maintenance.update')
          OR mr.reported_by = auth.uid()
          OR (
            (
              public.current_user_has_permission('general_affairs.maintenance_request.create')
              OR public.current_user_has_permission('cross_dept.maintenance.submit')
            )
            AND EXISTS (
              SELECT 1
              FROM public.store_managers sm
              WHERE sm.store_id = mr.store_id
                AND sm.user_id = auth.uid()
            )
          )
        )
    );
  END IF;

  IF p_resource_type = 'MAINTENANCE_UPDATE' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.maintenance_updates mu
      WHERE mu.id = p_resource_id
        AND (
          public.current_user_has_permission('general_affairs.maintenance_request.update')
          OR public.current_user_has_permission('general_affairs.work_order.update')
          OR public.current_user_has_permission('general_affairs.work_order.manage')
          OR public.current_user_has_permission('cross_dept.maintenance.update')
          OR mu.updated_by = auth.uid()
        )
    );
  END IF;

  RETURN false;
END;
$function$
$def$, chr(13), '');
  ELSIF position('e.onboarding_status IN (''NEEDS_EQUIPMENT_PHOTO''' IN pg_get_functiondef('public.ga_resource_attachment_can_manage(text,uuid)'::regprocedure)) = 0 THEN
    RAISE NOTICE 'ga_resource_attachment_can_manage 已不含設備待貼標分支（已是還原後的版本），略過';
  ELSE
    RAISE EXCEPTION 'ga_resource_attachment_can_manage 已被後面的步驟改過（md5 = %），請先還原那些步驟再還原 09', v_md5;
  END IF;
END
$m09$;

-- 授權還原成正式區原狀（序列：anon、authenticated 皆有全部權限；兩個函式：anon、authenticated 皆可執行）
GRANT ALL ON SEQUENCE public.ga_inventory_transaction_no_seq TO anon;
GRANT ALL ON SEQUENCE public.ga_inventory_transaction_no_seq TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_next_inventory_transaction_no() TO anon;
GRANT EXECUTE ON FUNCTION public.ga_next_inventory_transaction_no() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_post_inventory_transaction(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB) TO anon;
GRANT EXECUTE ON FUNCTION public.ga_post_inventory_transaction(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
