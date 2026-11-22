-- M7/M8 第 3 批 A（G11 庫存位置與料件設定）：C1 位置料件可修改／停用／批次新增、C2 停用與移除的保護、C3 有交易後鎖定類型／門市／代碼。
-- 內容（只新增函式與觸發器，不改任何資料表、資料或舊版函式）：
--   1. 內部輔助函式（不開放給前端直接呼叫）：位置是否已有交易或餘額、位置的連帶影響筆數、位置料件設定的庫存與進行中調撥。
--   2. ga_ws_inv_location_impact：停用／刪除前顯示「庫存幾項、進行中調撥幾張、料件設定幾筆」。
--   3. ga_ws_inv_location_counts：位置清單每列的料件設定數／庫存項數／進行中調撥數（精確筆數，一次查整頁）。
--   4. ga_ws_inv_save_location：新增或修改位置（版本檢查、預設位置衝突確認、停用保護、有交易後鎖定）。
--   5. ga_ws_inv_delete_location：刪除位置（原因必填；有進行中調撥或庫存一律擋）。
--   6. ga_ws_inv_add_location_parts／update／remove：位置料件設定的批次新增（全成或全不變）、修改與停用／啟用、移除（有庫存或進行中調撥擋）。
--   7. 觸發器 ga_inventory_locations_guard：任何路徑（含舊版畫面直接更新）都不能在有交易後改位置類型／門市／代碼，也不能在有進行中調撥時停用或刪除位置。
--   8. 觸發器 ga_parts_block_deactivate_with_stock：料件在任何位置仍有庫存時不能停用（C2；軟刪除另有 ga_ws_delete_part 的檢查）。
-- 權限語意：一律 has_permission(auth.uid(), …)（與正式區相同，不檢查 roles.is_active，資料庫沒有 admin 放行）。
-- 還原：20261111100000_m7m8_b3_inventory_rules.rollback.sql。可重複執行。

DO $$
BEGIN
  IF to_regclass('public.ga_inventory_locations') IS NULL OR to_regclass('public.ga_inventory_location_parts') IS NULL
     OR to_regclass('public.ga_inventory_balances') IS NULL OR to_regclass('public.ga_inventory_transactions') IS NULL
     OR to_regclass('public.ga_inventory_transfers') IS NULL OR to_regclass('public.ga_inventory_transfer_items') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: 總務庫存資料表（ga_inventory_*）';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'has_permission')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_normalize_optional_text')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_inventory_location_is_visible') THEN
    RAISE EXCEPTION 'Missing prerequisite function (has_permission / ga_normalize_optional_text / ga_inventory_location_is_visible)';
  END IF;
END $$;

-- ---------------------------------------------------------------- 1. 內部輔助函式
-- 位置是否已有「交易紀錄或餘額列」（C3 鎖定依據）。
CREATE OR REPLACE FUNCTION public.ga_inv_location_has_history(p_location_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.ga_inventory_transactions WHERE location_id = p_location_id)
      OR EXISTS (SELECT 1 FROM public.ga_inventory_balances WHERE location_id = p_location_id);
$$;

-- 位置的連帶影響（停用、刪除前顯示；進行中調撥 = 待處理、已交出、運送中，來源或目的是這個位置）。
CREATE OR REPLACE FUNCTION public.ga_inv_location_impact_json(p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_stock integer;
  v_tx integer;
  v_open integer;
  v_nos jsonb;
  v_parts integer;
BEGIN
  SELECT count(*)::integer INTO v_stock FROM public.ga_inventory_balances WHERE location_id = p_location_id AND quantity_base <> 0;
  SELECT count(*)::integer INTO v_tx FROM public.ga_inventory_transactions WHERE location_id = p_location_id;
  SELECT COALESCE(jsonb_agg(transfer_no ORDER BY created_at), '[]'::jsonb) INTO v_nos
    FROM (SELECT transfer_no, created_at FROM public.ga_inventory_transfers
           WHERE deleted_at IS NULL AND status IN ('REQUESTED', 'SOURCE_CONFIRMED', 'IN_TRANSIT')
             AND (source_location_id = p_location_id OR destination_location_id = p_location_id)
           ORDER BY created_at LIMIT 5) t;
  SELECT count(*)::integer INTO v_open FROM public.ga_inventory_transfers
   WHERE deleted_at IS NULL AND status IN ('REQUESTED', 'SOURCE_CONFIRMED', 'IN_TRANSIT')
     AND (source_location_id = p_location_id OR destination_location_id = p_location_id);
  SELECT count(*)::integer INTO v_parts FROM public.ga_inventory_location_parts WHERE location_id = p_location_id AND deleted_at IS NULL;
  RETURN jsonb_build_object(
    'stock_items', v_stock,
    'transactions', v_tx,
    'open_transfers', v_open,
    'open_transfer_nos', v_nos,
    'location_parts', v_parts,
    'has_history', (v_tx > 0 OR public.ga_inv_location_has_history(p_location_id))
  );
END;
$$;

-- 單一位置料件設定的庫存與進行中調撥（移除、停用前檢查）。
CREATE OR REPLACE FUNCTION public.ga_inv_setting_impact_json(p_location_id uuid, p_part_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_qty numeric;
  v_open integer;
  v_nos jsonb;
BEGIN
  SELECT COALESCE(sum(quantity_base), 0) INTO v_qty FROM public.ga_inventory_balances WHERE location_id = p_location_id AND part_id = p_part_id;
  SELECT count(DISTINCT t.id)::integer, COALESCE(jsonb_agg(DISTINCT t.transfer_no), '[]'::jsonb)
    INTO v_open, v_nos
    FROM public.ga_inventory_transfer_items i
    JOIN public.ga_inventory_transfers t ON t.id = i.transfer_id
   WHERE i.part_id = p_part_id AND t.deleted_at IS NULL AND t.status IN ('REQUESTED', 'SOURCE_CONFIRMED', 'IN_TRANSIT')
     AND (t.source_location_id = p_location_id OR t.destination_location_id = p_location_id);
  RETURN jsonb_build_object('stock_qty', v_qty, 'has_stock', v_qty <> 0, 'open_transfers', v_open, 'open_transfer_nos', v_nos);
END;
$$;

REVOKE ALL ON FUNCTION public.ga_inv_location_has_history(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_inv_location_impact_json(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_inv_setting_impact_json(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- 2. 位置影響預覽
CREATE OR REPLACE FUNCTION public.ga_ws_inv_location_impact(p_location_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.inventory_location.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有庫存位置管理權限');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ga_inventory_locations WHERE id = p_location_id AND deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到庫存位置');
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', public.ga_inv_location_impact_json(p_location_id));
END;
$$;

-- ---------------------------------------------------------------- 3. 清單每列的精確筆數
CREATE OR REPLACE FUNCTION public.ga_ws_inv_location_counts(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_priv boolean;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN RETURN jsonb_build_object('ok', true, 'status', 200, 'data', '[]'::jsonb); END IF;
  IF array_length(p_ids, 1) > 200 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '一次最多查 200 個位置'); END IF;
  v_priv := has_permission(v_uid, 'general_affairs.inventory_location.view') OR has_permission(v_uid, 'general_affairs.inventory_location.manage');
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', l.id,
      'parts', (SELECT count(*)::integer FROM public.ga_inventory_location_parts lp WHERE lp.location_id = l.id AND lp.deleted_at IS NULL),
      'stock_items', CASE WHEN v_priv THEN (SELECT count(*)::integer FROM public.ga_inventory_balances b WHERE b.location_id = l.id AND b.quantity_base <> 0) END,
      'open_transfers', CASE WHEN v_priv THEN (SELECT count(*)::integer FROM public.ga_inventory_transfers t
                                               WHERE t.deleted_at IS NULL AND t.status IN ('REQUESTED', 'SOURCE_CONFIRMED', 'IN_TRANSIT')
                                                 AND (t.source_location_id = l.id OR t.destination_location_id = l.id)) END,
      'has_history', CASE WHEN v_priv THEN public.ga_inv_location_has_history(l.id) END
    )), '[]'::jsonb)
    INTO v_out
    FROM public.ga_inventory_locations l
   WHERE l.id = ANY (p_ids) AND l.deleted_at IS NULL AND public.ga_inventory_location_is_visible(l.id);
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', v_out);
END;
$$;

-- ---------------------------------------------------------------- 4. 新增／修改位置
-- p_location_id 為 NULL = 新增。p_patch 只收白名單欄位。p_options：{confirm_stock: 停用有庫存時的確認, replace_default: 預設位置衝突時改由這個位置接手}。
-- 回傳：ok=false 時 status/code 說明原因（STALE、DEFAULT_CONFLICT、NEEDS_CONFIRM_STOCK、OPEN_TRANSFERS、LOCKED_BY_HISTORY、DUPLICATE_CODE）。
CREATE OR REPLACE FUNCTION public.ga_ws_inv_save_location(p_location_id uuid, p_patch jsonb, p_expected_updated_at timestamptz, p_options jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed text[] := ARRAY['code', 'name', 'location_type', 'store_id', 'description', 'is_active', 'allow_negative_stock', 'is_default'];
  v_key text;
  v_cur public.ga_inventory_locations%ROWTYPE;
  v_row jsonb;
  v_sets text := '';
  v_confirm_stock boolean := COALESCE((p_options->>'confirm_stock')::boolean, false);
  v_replace_default boolean := COALESCE((p_options->>'replace_default')::boolean, false);
  v_e_type text;
  v_e_store uuid;
  v_e_active boolean;
  v_e_default boolean;
  v_e_code text;
  v_other public.ga_inventory_locations%ROWTYPE;
  v_impact jsonb;
  v_constraint text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.inventory_location.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有庫存位置管理權限');
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '送出的內容格式錯誤');
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF NOT (v_key = ANY (v_allowed)) THEN
      RETURN jsonb_build_object('ok', false, 'status', 400, 'error', format('不支援的欄位：%s', v_key));
    END IF;
  END LOOP;

  BEGIN
    IF p_location_id IS NULL THEN
      -- 新增
      v_e_type := upper(btrim(COALESCE(p_patch->>'location_type', '')));
      v_e_store := NULLIF(p_patch->>'store_id', '')::uuid;
      v_e_active := COALESCE((p_patch->>'is_active')::boolean, true);
      v_e_default := COALESCE((p_patch->>'is_default')::boolean, false) AND v_e_active;
      IF v_e_default THEN
        SELECT * INTO v_other FROM public.ga_inventory_locations
         WHERE deleted_at IS NULL AND is_active = true AND is_default = true
           AND ((v_e_type = 'CENTRAL_WAREHOUSE' AND location_type = 'CENTRAL_WAREHOUSE') OR (v_e_type = 'STORE' AND location_type = 'STORE' AND store_id = v_e_store))
         LIMIT 1;
        IF FOUND THEN
          IF NOT v_replace_default THEN
            RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'DEFAULT_CONFLICT',
              'error', format('已有預設位置「%s」；確認後會改由這個位置成為預設', v_other.name),
              'existing', jsonb_build_object('id', v_other.id, 'name', v_other.name, 'code', v_other.code));
          END IF;
          UPDATE public.ga_inventory_locations SET is_default = false, updated_by = v_uid WHERE id = v_other.id;
        END IF;
      END IF;
      INSERT INTO public.ga_inventory_locations (code, name, location_type, store_id, description, is_active, allow_negative_stock, is_default)
      VALUES (NULLIF(btrim(p_patch->>'code'), ''), p_patch->>'name', p_patch->>'location_type', v_e_store, p_patch->>'description',
              v_e_active, COALESCE((p_patch->>'allow_negative_stock')::boolean, false), v_e_default)
      RETURNING to_jsonb(public.ga_inventory_locations.*) INTO v_row;
      RETURN jsonb_build_object('ok', true, 'status', 201, 'data', v_row);
    END IF;

    -- 修改
    SELECT * INTO v_cur FROM public.ga_inventory_locations WHERE id = p_location_id AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到庫存位置'); END IF;
    IF p_expected_updated_at IS NOT NULL AND v_cur.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '這個位置已被其他人修改，請重新載入後再儲存');
    END IF;
    IF ga_inv_jsonb_key_count(p_patch) = 0 THEN
      RETURN jsonb_build_object('ok', true, 'status', 200, 'data', to_jsonb(v_cur));
    END IF;
    v_e_type := CASE WHEN p_patch ? 'location_type' THEN upper(btrim(COALESCE(p_patch->>'location_type', ''))) ELSE v_cur.location_type END;
    v_e_store := CASE WHEN p_patch ? 'store_id' THEN NULLIF(p_patch->>'store_id', '')::uuid ELSE v_cur.store_id END;
    v_e_code := CASE WHEN p_patch ? 'code' THEN upper(NULLIF(btrim(p_patch->>'code'), '')) ELSE v_cur.code END;
    v_e_active := CASE WHEN p_patch ? 'is_active' THEN COALESCE((p_patch->>'is_active')::boolean, true) ELSE v_cur.is_active END;
    v_e_default := CASE WHEN p_patch ? 'is_default' THEN COALESCE((p_patch->>'is_default')::boolean, false) ELSE v_cur.is_default END;
    IF NOT v_e_active THEN v_e_default := false; END IF;

    v_impact := public.ga_inv_location_impact_json(p_location_id);
    -- C3：有庫存或交易後，位置類型、所屬門市、代碼鎖定
    IF (v_e_type IS DISTINCT FROM v_cur.location_type OR v_e_store IS DISTINCT FROM v_cur.store_id OR v_e_code IS DISTINCT FROM upper(v_cur.code))
       AND (v_impact->>'has_history')::boolean THEN
      RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'LOCKED_BY_HISTORY',
        'error', '這個位置已有庫存或交易紀錄，位置類型、所屬門市與代碼不能再修改；要換店請新增位置，再用調撥搬移庫存', 'impact', v_impact);
    END IF;
    -- C2：停用保護
    IF v_cur.is_active AND NOT v_e_active THEN
      IF (v_impact->>'open_transfers')::integer > 0 THEN
        RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'OPEN_TRANSFERS',
          'error', format('有 %s 張進行中的調撥單使用這個位置（%s），請先完成或取消調撥單再停用', v_impact->>'open_transfers', (SELECT string_agg(x, '、') FROM jsonb_array_elements_text(v_impact->'open_transfer_nos') x)),
          'impact', v_impact);
      END IF;
      IF (v_impact->>'stock_items')::integer > 0 AND NOT v_confirm_stock THEN
        RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'NEEDS_CONFIRM_STOCK',
          'error', format('這個位置還有 %s 項庫存；停用後庫存仍保留，但不能再過帳或調撥。確認要停用嗎？', v_impact->>'stock_items'), 'impact', v_impact);
      END IF;
    END IF;
    -- 預設位置：同門市（或全公司總倉）只能有一個啟用的預設
    IF v_e_default AND v_e_active AND v_e_type IN ('CENTRAL_WAREHOUSE', 'STORE') THEN
      SELECT * INTO v_other FROM public.ga_inventory_locations
       WHERE deleted_at IS NULL AND is_active = true AND is_default = true AND id <> p_location_id
         AND ((v_e_type = 'CENTRAL_WAREHOUSE' AND location_type = 'CENTRAL_WAREHOUSE') OR (v_e_type = 'STORE' AND location_type = 'STORE' AND store_id = v_e_store))
       LIMIT 1;
      IF FOUND THEN
        IF NOT v_replace_default THEN
          RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'DEFAULT_CONFLICT',
            'error', format('已有預設位置「%s」；確認後會改由這個位置成為預設', v_other.name),
            'existing', jsonb_build_object('id', v_other.id, 'name', v_other.name, 'code', v_other.code));
        END IF;
        UPDATE public.ga_inventory_locations SET is_default = false, updated_by = v_uid WHERE id = v_other.id;
      END IF;
    END IF;

    FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
      v_sets := v_sets || CASE WHEN v_sets = '' THEN '' ELSE ', ' END || format('%I = r.%I', v_key, v_key);
    END LOOP;
    EXECUTE format('UPDATE public.ga_inventory_locations l SET %s, updated_by = $2 FROM jsonb_populate_record(NULL::public.ga_inventory_locations, $1) r WHERE l.id = $3', v_sets)
      USING p_patch, v_uid, p_location_id;
    SELECT to_jsonb(l) INTO v_row FROM public.ga_inventory_locations l WHERE l.id = p_location_id;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', v_row);
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
      IF v_constraint LIKE '%code%' THEN
        RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'DUPLICATE_CODE', 'error', '這個代碼已被使用（不分大小寫，已停用的位置也算）');
      END IF;
      RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'DEFAULT_CONFLICT', 'error', '這個門市（或總倉）已有預設位置');
    WHEN raise_exception THEN
      RETURN jsonb_build_object('ok', false, 'status', 400, 'error', regexp_replace(SQLERRM, '^[A-Z0-9_]+:\s*', ''));
    WHEN invalid_text_representation OR datatype_mismatch OR invalid_parameter_value OR not_null_violation OR check_violation OR foreign_key_violation THEN
      RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '資料格式錯誤，請檢查欄位');
  END;
END;
$$;

-- jsonb 物件鍵數量（plpgsql 沒有內建函式）。
CREATE OR REPLACE FUNCTION public.ga_inv_jsonb_key_count(p_obj jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT count(*)::integer FROM jsonb_object_keys(p_obj);
$$;
REVOKE ALL ON FUNCTION public.ga_inv_jsonb_key_count(jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- 5. 刪除位置
CREATE OR REPLACE FUNCTION public.ga_ws_inv_delete_location(p_location_id uuid, p_reason text, p_expected_updated_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := ga_normalize_optional_text(p_reason);
  v_cur public.ga_inventory_locations%ROWTYPE;
  v_impact jsonb;
  v_now timestamptz := now();
  v_children integer := 0;
  v_n integer;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.inventory_location.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有庫存位置管理權限');
  END IF;
  IF v_reason IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入刪除原因'); END IF;
  IF length(v_reason) > 200 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '刪除原因不可超過 200 字'); END IF;
  SELECT * INTO v_cur FROM public.ga_inventory_locations WHERE id = p_location_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到庫存位置，或已被刪除'); END IF;
  IF p_expected_updated_at IS NOT NULL AND v_cur.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '這個位置已被其他人修改，請重新載入後再處理');
  END IF;
  v_impact := public.ga_inv_location_impact_json(p_location_id);
  IF (v_impact->>'open_transfers')::integer > 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'OPEN_TRANSFERS', 'impact', v_impact,
      'error', format('有 %s 張進行中的調撥單使用這個位置（%s），不能刪除；請先完成或取消調撥單，或改用停用', v_impact->>'open_transfers', (SELECT string_agg(x, '、') FROM jsonb_array_elements_text(v_impact->'open_transfer_nos') x)));
  END IF;
  IF (v_impact->>'stock_items')::integer > 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'HAS_STOCK', 'impact', v_impact,
      'error', format('這個位置還有 %s 項庫存，不能刪除；請先出庫或調整庫存為 0，或改用停用', v_impact->>'stock_items'));
  END IF;

  PERFORM set_config('app.ga_soft_delete_inventory_location_part', 'true', true);
  UPDATE public.ga_inventory_location_parts
     SET is_active = false, deleted_at = v_now, deleted_by = v_uid, deletion_reason = '位置刪除衍生：' || v_reason, updated_by = v_uid
   WHERE location_id = p_location_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_children = ROW_COUNT;
  PERFORM set_config('app.ga_soft_delete_inventory_location', 'true', true);
  UPDATE public.ga_inventory_locations
     SET is_active = false, is_default = false, deleted_at = v_now, deleted_by = v_uid, deletion_reason = v_reason, updated_by = v_uid
   WHERE id = p_location_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION '庫存位置刪除失敗，交易已中止'; END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'id', p_location_id, 'deleted_at', v_now, 'deleted_by', v_uid, 'deletion_reason', v_reason, 'deleted_location_parts', v_children));
END;
$$;

-- ---------------------------------------------------------------- 6. 位置料件設定
-- 批次新增（C1）：p_items 為陣列，每筆 {part_id, safety_stock_qty, reorder_point_qty, maximum_stock_qty, preferred_issue_unit_type, notes, is_active}；
-- 全成或全不變；錯誤訊息帶「第 N 筆（料件名稱）」。需要位置管理＋料件查看（或管理）。
CREATE OR REPLACE FUNCTION public.ga_ws_inv_add_location_parts(p_location_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_loc public.ga_inventory_locations%ROWTYPE;
  v_item jsonb;
  v_idx integer := 0;
  v_part_name text := '';
  v_out jsonb := '[]'::jsonb;
  v_row jsonb;
  v_part_id uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.inventory_location.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有庫存位置管理權限');
  END IF;
  IF NOT (has_permission(v_uid, 'general_affairs.part.view') OR has_permission(v_uid, 'general_affairs.part.manage')) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '缺少料件查看權限，因此無法新增位置料件設定');
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請選擇要加入的料件');
  END IF;
  IF jsonb_array_length(p_items) > 100 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '一次最多加入 100 個料件'); END IF;
  SELECT * INTO v_loc FROM public.ga_inventory_locations WHERE id = p_location_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到庫存位置'); END IF;
  IF NOT v_loc.is_active THEN RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '這個位置已停用，不能新增料件設定'); END IF;

  BEGIN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_idx := v_idx + 1;
      v_part_name := '';
      IF jsonb_typeof(v_item) <> 'object' THEN RAISE EXCEPTION '資料格式錯誤'; END IF;
      v_part_id := NULLIF(v_item->>'part_id', '')::uuid;
      IF v_part_id IS NULL THEN RAISE EXCEPTION '缺少料件'; END IF;
      SELECT name INTO v_part_name FROM public.ga_parts WHERE id = v_part_id;
      IF NOT FOUND THEN RAISE EXCEPTION '料件不存在'; END IF;
      INSERT INTO public.ga_inventory_location_parts (location_id, part_id, is_active, safety_stock_qty, reorder_point_qty, maximum_stock_qty, preferred_issue_unit_type, notes)
      VALUES (p_location_id, v_part_id, COALESCE((v_item->>'is_active')::boolean, true),
              NULLIF(v_item->>'safety_stock_qty', '')::numeric, NULLIF(v_item->>'reorder_point_qty', '')::numeric, NULLIF(v_item->>'maximum_stock_qty', '')::numeric,
              NULLIF(btrim(COALESCE(v_item->>'preferred_issue_unit_type', '')), ''), v_item->>'notes')
      RETURNING to_jsonb(public.ga_inventory_location_parts.*) INTO v_row;
      v_out := v_out || jsonb_build_array(v_row);
    END LOOP;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'DUPLICATE_PART', 'error', format('第 %s 筆（%s）：這個位置已經設定過這個料件', v_idx, v_part_name));
    WHEN raise_exception THEN
      RETURN jsonb_build_object('ok', false, 'status', 400, 'error', format('第 %s 筆%s：%s', v_idx, CASE WHEN v_part_name <> '' THEN '（' || v_part_name || '）' ELSE '' END, regexp_replace(SQLERRM, '^[A-Z0-9_]+:\s*', '')));
    WHEN invalid_text_representation OR datatype_mismatch OR invalid_parameter_value OR not_null_violation OR check_violation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('ok', false, 'status', 400, 'error', format('第 %s 筆%s：資料格式錯誤，請檢查數字與單位', v_idx, CASE WHEN v_part_name <> '' THEN '（' || v_part_name || '）' ELSE '' END));
  END;
  RETURN jsonb_build_object('ok', true, 'status', 201, 'data', v_out);
END;
$$;

-- 修改（C1）：數量、偏好領用單位、備註、啟用／停用。料件與位置不可更換（要換請移除後重新加入）。停用有庫存或進行中調撥時擋下（C2）。
CREATE OR REPLACE FUNCTION public.ga_ws_inv_update_location_part(p_location_part_id uuid, p_patch jsonb, p_expected_updated_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_allowed text[] := ARRAY['safety_stock_qty', 'reorder_point_qty', 'maximum_stock_qty', 'preferred_issue_unit_type', 'notes', 'is_active'];
  v_key text;
  v_cur public.ga_inventory_location_parts%ROWTYPE;
  v_sets text := '';
  v_row jsonb;
  v_impact jsonb;
  v_new_active boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.inventory_location.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有庫存位置管理權限');
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '送出的內容格式錯誤'); END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key IN ('part_id', 'location_id') THEN
      RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '不能更換料件或位置；要換請先移除這筆設定，再重新加入');
    END IF;
    IF NOT (v_key = ANY (v_allowed)) THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', format('不支援的欄位：%s', v_key)); END IF;
  END LOOP;
  SELECT * INTO v_cur FROM public.ga_inventory_location_parts WHERE id = p_location_part_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到位置料件設定'); END IF;
  IF p_expected_updated_at IS NOT NULL AND v_cur.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '這筆設定已被其他人修改，請重新載入後再儲存');
  END IF;
  IF ga_inv_jsonb_key_count(p_patch) = 0 THEN RETURN jsonb_build_object('ok', true, 'status', 200, 'data', to_jsonb(v_cur)); END IF;
  v_new_active := CASE WHEN p_patch ? 'is_active' THEN COALESCE((p_patch->>'is_active')::boolean, true) ELSE v_cur.is_active END;
  IF v_cur.is_active AND NOT v_new_active THEN
    v_impact := public.ga_inv_setting_impact_json(v_cur.location_id, v_cur.part_id);
    IF (v_impact->>'has_stock')::boolean THEN
      RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'HAS_STOCK', 'impact', v_impact,
        'error', format('這個位置還有此料件的庫存（%s），不能停用設定；請先出庫或調整庫存為 0', v_impact->>'stock_qty'));
    END IF;
    IF (v_impact->>'open_transfers')::integer > 0 THEN
      RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'OPEN_TRANSFERS', 'impact', v_impact,
        'error', format('有 %s 張進行中的調撥單使用此料件與位置（%s），不能停用設定', v_impact->>'open_transfers', (SELECT string_agg(x, '、') FROM jsonb_array_elements_text(v_impact->'open_transfer_nos') x)));
    END IF;
  END IF;
  BEGIN
    FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
      v_sets := v_sets || CASE WHEN v_sets = '' THEN '' ELSE ', ' END || format('%I = r.%I', v_key, v_key);
    END LOOP;
    EXECUTE format('UPDATE public.ga_inventory_location_parts p SET %s, updated_by = $2 FROM jsonb_populate_record(NULL::public.ga_inventory_location_parts, $1) r WHERE p.id = $3', v_sets)
      USING p_patch, v_uid, p_location_part_id;
  EXCEPTION
    WHEN raise_exception THEN
      RETURN jsonb_build_object('ok', false, 'status', 400, 'error', regexp_replace(SQLERRM, '^[A-Z0-9_]+:\s*', ''));
    WHEN invalid_text_representation OR datatype_mismatch OR invalid_parameter_value OR not_null_violation OR check_violation OR numeric_value_out_of_range THEN
      RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '資料格式錯誤，請檢查數字與單位');
  END;
  SELECT to_jsonb(p) INTO v_row FROM public.ga_inventory_location_parts p WHERE p.id = p_location_part_id;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', v_row);
END;
$$;

-- 移除（軟刪除；C2：有庫存或進行中調撥就擋）。
CREATE OR REPLACE FUNCTION public.ga_ws_inv_remove_location_part(p_location_part_id uuid, p_reason text, p_expected_updated_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := ga_normalize_optional_text(p_reason);
  v_cur public.ga_inventory_location_parts%ROWTYPE;
  v_impact jsonb;
  v_now timestamptz := now();
  v_n integer;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.inventory_location.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有庫存位置管理權限');
  END IF;
  IF v_reason IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入移除原因'); END IF;
  IF length(v_reason) > 200 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '移除原因不可超過 200 字'); END IF;
  SELECT * INTO v_cur FROM public.ga_inventory_location_parts WHERE id = p_location_part_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到位置料件設定，或已被移除'); END IF;
  IF p_expected_updated_at IS NOT NULL AND v_cur.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '這筆設定已被其他人修改，請重新載入後再處理');
  END IF;
  v_impact := public.ga_inv_setting_impact_json(v_cur.location_id, v_cur.part_id);
  IF (v_impact->>'has_stock')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'HAS_STOCK', 'impact', v_impact,
      'error', format('這個位置還有此料件的庫存（%s），不能移除設定；請先出庫或調整庫存為 0', v_impact->>'stock_qty'));
  END IF;
  IF (v_impact->>'open_transfers')::integer > 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'OPEN_TRANSFERS', 'impact', v_impact,
      'error', format('有 %s 張進行中的調撥單使用此料件與位置（%s），不能移除設定', v_impact->>'open_transfers', (SELECT string_agg(x, '、') FROM jsonb_array_elements_text(v_impact->'open_transfer_nos') x)));
  END IF;
  PERFORM set_config('app.ga_soft_delete_inventory_location_part', 'true', true);
  UPDATE public.ga_inventory_location_parts
     SET is_active = false, deleted_at = v_now, deleted_by = v_uid, deletion_reason = v_reason, updated_by = v_uid
   WHERE id = p_location_part_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION '位置料件設定移除失敗，交易已中止'; END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('id', p_location_part_id, 'deleted_at', v_now, 'deletion_reason', v_reason));
END;
$$;

-- ---------------------------------------------------------------- 7. 位置守衛觸發器（任何路徑都適用）
CREATE OR REPLACE FUNCTION public.ga_inventory_locations_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_open integer;
  v_nos text;
BEGIN
  IF NEW.location_type IS DISTINCT FROM OLD.location_type OR NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.code IS DISTINCT FROM OLD.code THEN
    IF public.ga_inv_location_has_history(OLD.id) THEN
      RAISE EXCEPTION 'LOCKED_BY_HISTORY: 這個位置已有庫存或交易紀錄，位置類型、所屬門市與代碼不能再修改；要換店請新增位置，再用調撥搬移庫存';
    END IF;
    -- 審查補強：進行中調撥（尚無流水的待處理單）使用的位置也不能換類型、門市、代碼，否則單據的目的門市會跟著變。
    SELECT count(*)::integer, string_agg(transfer_no, '、') INTO v_open, v_nos FROM public.ga_inventory_transfers
     WHERE deleted_at IS NULL AND status IN ('REQUESTED', 'SOURCE_CONFIRMED', 'IN_TRANSIT')
       AND (source_location_id = OLD.id OR destination_location_id = OLD.id);
    IF v_open > 0 THEN
      RAISE EXCEPTION 'OPEN_TRANSFERS: 有 % 張進行中的調撥單使用這個位置（%），位置類型、所屬門市與代碼先不能修改，請先完成或取消調撥單', v_open, v_nos;
    END IF;
  END IF;
  IF (OLD.is_active AND NOT NEW.is_active) OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    SELECT count(*)::integer, string_agg(transfer_no, '、') INTO v_open, v_nos FROM public.ga_inventory_transfers
     WHERE deleted_at IS NULL AND status IN ('REQUESTED', 'SOURCE_CONFIRMED', 'IN_TRANSIT')
       AND (source_location_id = OLD.id OR destination_location_id = OLD.id);
    IF v_open > 0 THEN
      RAISE EXCEPTION 'OPEN_TRANSFERS: 有 % 張進行中的調撥單使用這個位置（%），請先完成或取消調撥單再停用或刪除', v_open, v_nos;
    END IF;
  END IF;
  -- 審查補強：刪除位置（軟刪除）時，任何路徑（含舊版畫面）都不能在仍有庫存時刪除；停用仍可（停用後庫存保留）。
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.ga_inventory_balances WHERE location_id = OLD.id AND quantity_base <> 0) THEN
      RAISE EXCEPTION 'HAS_STOCK: 這個位置還有庫存，不能刪除；請先出庫或調整庫存為 0，或改用停用';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ga_inventory_locations_guard ON public.ga_inventory_locations;
CREATE TRIGGER trg_ga_inventory_locations_guard
  BEFORE UPDATE OF location_type, store_id, code, is_active, deleted_at ON public.ga_inventory_locations
  FOR EACH ROW EXECUTE FUNCTION public.ga_inventory_locations_guard();

-- ---------------------------------------------------------------- 8. 料件停用保護
CREATE OR REPLACE FUNCTION public.ga_parts_block_deactivate_with_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_locations integer;
  v_open integer;
  v_nos text;
BEGIN
  -- 審查補強：停用或軟刪除都檢查；除了「仍有庫存」，還要沒有進行中調撥——
  -- 調撥交出後來源餘額是 0，但單子還在途中，此時停用料件會讓收貨與退回都失敗（PART_INACTIVE），單子卡死。
  IF (OLD.is_active AND NOT NEW.is_active) OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    SELECT count(*)::integer INTO v_locations FROM public.ga_inventory_balances WHERE part_id = OLD.id AND quantity_base <> 0;
    IF v_locations > 0 THEN
      RAISE EXCEPTION 'HAS_STOCK: 這個料件在 % 個位置仍有庫存，不能停用或刪除；請先出庫或調整庫存為 0', v_locations;
    END IF;
    SELECT count(DISTINCT t.id)::integer, string_agg(DISTINCT t.transfer_no, '、') INTO v_open, v_nos
      FROM public.ga_inventory_transfer_items i JOIN public.ga_inventory_transfers t ON t.id = i.transfer_id
     WHERE i.part_id = OLD.id AND t.deleted_at IS NULL AND t.status IN ('REQUESTED', 'SOURCE_CONFIRMED', 'IN_TRANSIT');
    IF v_open > 0 THEN
      RAISE EXCEPTION 'OPEN_TRANSFERS: 這個料件有 % 張進行中的調撥單（%），不能停用或刪除；請先完成或取消調撥單', v_open, v_nos;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ga_parts_block_deactivate_with_stock ON public.ga_parts;
CREATE TRIGGER trg_ga_parts_block_deactivate_with_stock
  BEFORE UPDATE OF is_active, deleted_at ON public.ga_parts
  FOR EACH ROW EXECUTE FUNCTION public.ga_parts_block_deactivate_with_stock();

-- ---------------------------------------------------------------- 8b. 位置料件設定守衛（審查補強）
-- 位置有守衛觸發器，位置料件設定也要有：任何路徑（含舊版畫面直接更新）停用或刪除設定時，該位置該料件仍有庫存或有進行中調撥就擋。
-- 否則收貨會回 LOCATION_PART_NOT_CONFIGURED、調撥單卡死，餘額列也會變成沒有設定的庫存。
CREATE OR REPLACE FUNCTION public.ga_inventory_location_parts_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_impact jsonb;
BEGIN
  IF (OLD.is_active AND NOT NEW.is_active) OR (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
    v_impact := public.ga_inv_setting_impact_json(OLD.location_id, OLD.part_id);
    IF (v_impact->>'has_stock')::boolean THEN
      RAISE EXCEPTION 'HAS_STOCK: 這個位置還有此料件的庫存（%），不能停用或移除設定；請先出庫或調整庫存為 0', v_impact->>'stock_qty';
    END IF;
    IF (v_impact->>'open_transfers')::integer > 0 THEN
      RAISE EXCEPTION 'OPEN_TRANSFERS: 有 % 張進行中的調撥單使用此料件與位置（%），不能停用或移除設定',
        v_impact->>'open_transfers', (SELECT string_agg(x, '、') FROM jsonb_array_elements_text(v_impact->'open_transfer_nos') x);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ga_inventory_location_parts_guard ON public.ga_inventory_location_parts;
CREATE TRIGGER trg_ga_inventory_location_parts_guard
  BEFORE UPDATE OF is_active, deleted_at ON public.ga_inventory_location_parts
  FOR EACH ROW EXECUTE FUNCTION public.ga_inventory_location_parts_guard();

-- ---------------------------------------------------------------- 授權
REVOKE ALL ON FUNCTION public.ga_inventory_locations_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_parts_block_deactivate_with_stock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_inventory_location_parts_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_inv_location_impact(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_inv_location_counts(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_inv_save_location(uuid, jsonb, timestamptz, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_inv_delete_location(uuid, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_inv_add_location_parts(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_inv_update_location_part(uuid, jsonb, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_inv_remove_location_part(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_inv_location_impact(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_inv_location_counts(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_inv_save_location(uuid, jsonb, timestamptz, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_inv_delete_location(uuid, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_inv_add_location_parts(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_inv_update_location_part(uuid, jsonb, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_inv_remove_location_part(uuid, text, timestamptz) TO authenticated;

NOTIFY pgrst, 'reload schema';
