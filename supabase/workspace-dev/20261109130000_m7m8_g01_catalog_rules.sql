-- M7/M8 第 1 批（G02-G05）：分類、料件、型號與架型、適用料件對照的「全成或全不變」資料庫函式。
-- 對應決議：Q4（分類停用／刪除要查精確筆數）、Q6（料件刪除須無庫存、無未結單；有庫存或交易後單位欄位鎖定）、
--          Q7（用中的型號／架型只能停用，沒人用才能刪；既有設備歸戶前後值比對）、G05（適用料件整批取代，被他人同時修改時提示重新載入）。
-- 設計：全部以 SECURITY DEFINER 執行、函式內用 has_permission(auth.uid(), ...) 自己檢查權限（與舊版 ga_soft_delete_* 相同做法），
--       必須以「使用者登入身分」呼叫（auth.uid() 不可為空）。不修改任何既有資料表、觸發器或舊版函式，所以舊版 /api/general-affairs 行為不變。
-- 正式區：此檔內容也放在 docs/vue-workspace/parity-plan/m7m8-sql/10-g01-catalog-rules.sql（只寫不執行，須使用者核可後才套用）。
-- 可重複執行。還原：20261109130000_m7m8_g01_catalog_rules.rollback.sql

DO $$
BEGIN
  IF to_regclass('public.ga_parts') IS NULL OR to_regclass('public.ga_part_target_compatibilities') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.ga_parts / public.ga_part_target_compatibilities';
  END IF;
END $$;

-- 分類使用情形：直接子分類與所有後代下的項目，精確筆數（不受前 100 筆限制）。
CREATE OR REPLACE FUNCTION public.ga_ws_category_usage(p_kind public.ga_category_kind, p_category_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_table text;
  v_view text;
  v_manage text;
  v_ids uuid[];
  v_children_total integer := 0;
  v_children_active integer := 0;
  v_items_total integer := 0;
  v_items_active integer := 0;
  v_a integer;
  v_b integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入');
  END IF;
  v_table := ga_category_table_name(p_kind);
  v_view := CASE p_kind WHEN 'equipment' THEN 'general_affairs.equipment_category.view'
                        WHEN 'facility' THEN 'general_affairs.facility_category.view'
                        ELSE 'general_affairs.part_category.view' END;
  v_manage := replace(v_view, '.view', '.manage');
  IF NOT (has_permission(v_uid, v_view) OR has_permission(v_uid, v_manage)) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有分類查看權限');
  END IF;

  EXECUTE format('SELECT count(*)::integer FROM %I WHERE id = $1 AND deleted_at IS NULL', v_table)
    INTO v_a USING p_category_id;
  IF v_a = 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到分類');
  END IF;

  EXECUTE format('SELECT count(*)::integer FROM %I WHERE parent_id = $1 AND deleted_at IS NULL', v_table)
    INTO v_children_total USING p_category_id;
  EXECUTE format($q$
    WITH RECURSIVE d AS (
      SELECT id, is_active FROM %1$I WHERE parent_id = $1 AND deleted_at IS NULL
      UNION ALL
      SELECT c.id, c.is_active FROM %1$I c JOIN d ON c.parent_id = d.id WHERE c.deleted_at IS NULL
    ) SELECT count(*) FILTER (WHERE is_active)::integer, COALESCE(array_agg(id), ARRAY[]::uuid[]) FROM d
  $q$, v_table) INTO v_children_active, v_ids USING p_category_id;
  v_ids := array_append(v_ids, p_category_id);

  IF p_kind = 'part' THEN
    SELECT count(*)::integer, count(*) FILTER (WHERE is_active)::integer INTO v_a, v_b
      FROM ga_parts WHERE category_id = ANY(v_ids) AND deleted_at IS NULL;
    v_items_total := v_a; v_items_active := v_b;
  ELSIF p_kind = 'equipment' THEN
    SELECT count(*)::integer INTO v_a FROM ga_equipment WHERE category_id = ANY(v_ids) AND deleted_at IS NULL;
    SELECT count(*)::integer, count(*) FILTER (WHERE is_active)::integer INTO v_b, v_items_active
      FROM ga_equipment_templates WHERE category_id = ANY(v_ids) AND deleted_at IS NULL;
    v_items_total := v_a + v_b; v_items_active := v_a + v_items_active;
  ELSE
    SELECT count(*)::integer INTO v_a FROM ga_facilities WHERE category_id = ANY(v_ids) AND deleted_at IS NULL;
    SELECT count(*)::integer, count(*) FILTER (WHERE is_active)::integer INTO v_b, v_items_active
      FROM ga_facility_templates WHERE category_id = ANY(v_ids) AND deleted_at IS NULL;
    v_items_total := v_a + v_b; v_items_active := v_a + v_items_active;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'children_total', v_children_total,
    'children_active', v_children_active,
    'items_total', v_items_total,
    'items_active', v_items_active));
END;
$$;

-- 停用或重新啟用分類：停用時，底下還有啟用中的子分類或項目就擋下（Q4）。
CREATE OR REPLACE FUNCTION public.ga_ws_set_category_active(
  p_kind public.ga_category_kind, p_category_id uuid, p_active boolean, p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_table text := ga_category_table_name(p_kind);
  v_manage text;
  v_cur_active boolean;
  v_cur_updated timestamptz;
  v_usage jsonb;
  v_row jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  v_manage := CASE p_kind WHEN 'equipment' THEN 'general_affairs.equipment_category.manage'
                          WHEN 'facility' THEN 'general_affairs.facility_category.manage'
                          ELSE 'general_affairs.part_category.manage' END;
  IF NOT has_permission(v_uid, v_manage) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有分類管理權限');
  END IF;
  EXECUTE format('SELECT is_active, updated_at FROM %I WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', v_table)
    INTO v_cur_active, v_cur_updated USING p_category_id;
  IF v_cur_active IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到分類');
  END IF;
  IF p_expected_updated_at IS NOT NULL AND v_cur_updated IS DISTINCT FROM p_expected_updated_at THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '此分類已被其他人修改，請重新載入後再操作', 'code', 'STALE');
  END IF;
  IF p_active = false AND v_cur_active THEN
    v_usage := (ga_ws_category_usage(p_kind, p_category_id))->'data';
    IF (v_usage->>'children_active')::integer > 0 OR (v_usage->>'items_active')::integer > 0 THEN
      RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'IN_USE', 'usage', v_usage,
        'error', format('底下還有 %s 個啟用中的子分類、%s 個啟用中的項目，不能停用；請先停用或搬走它們',
                        v_usage->>'children_active', v_usage->>'items_active'));
    END IF;
  END IF;
  EXECUTE format('UPDATE %I SET is_active = $2, updated_by = $3 WHERE id = $1 AND deleted_at IS NULL RETURNING to_jsonb(%I.*)', v_table, v_table)
    INTO v_row USING p_category_id, p_active, v_uid;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', v_row);
END;
$$;

-- 刪除分類（Q4 新增）：限完全沒有子分類、也沒有任何項目（含停用、已歸戶的型號）的分類。
CREATE OR REPLACE FUNCTION public.ga_ws_delete_category(p_kind public.ga_category_kind, p_category_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_table text := ga_category_table_name(p_kind);
  v_manage text;
  v_exists integer;
  v_usage jsonb;
  v_now timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  v_manage := CASE p_kind WHEN 'equipment' THEN 'general_affairs.equipment_category.manage'
                          WHEN 'facility' THEN 'general_affairs.facility_category.manage'
                          ELSE 'general_affairs.part_category.manage' END;
  IF NOT has_permission(v_uid, v_manage) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有分類管理權限');
  END IF;
  EXECUTE format('SELECT count(*)::integer FROM (SELECT 1 FROM %I WHERE id = $1 AND deleted_at IS NULL FOR UPDATE) s', v_table)
    INTO v_exists USING p_category_id;
  IF v_exists = 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到可刪除的分類');
  END IF;
  v_usage := (ga_ws_category_usage(p_kind, p_category_id))->'data';
  IF (v_usage->>'children_total')::integer > 0 OR (v_usage->>'items_total')::integer > 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'IN_USE', 'usage', v_usage,
      'error', format('底下還有 %s 個子分類、%s 個項目，不能刪除', v_usage->>'children_total', v_usage->>'items_total'));
  END IF;
  EXECUTE format('UPDATE %I SET is_active = false, deleted_at = $2, deleted_by = $3, updated_by = $3 WHERE id = $1 AND deleted_at IS NULL', v_table)
    USING p_category_id, v_now, v_uid;
  RETURN jsonb_build_object('ok', true, 'status', 200,
    'data', jsonb_build_object('id', p_category_id, 'deleted_at', v_now, 'deleted_by', v_uid));
END;
$$;

-- 料件使用情形：有庫存、有庫存交易、未結單（需求單、調撥單、料件處理單）的精確筆數。
CREATE OR REPLACE FUNCTION public.ga_ws_part_usage(p_part_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_stock integer;
  v_tx integer;
  v_req integer;
  v_transfer integer;
  v_ful integer;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF NOT (has_permission(v_uid, 'general_affairs.part.view') OR has_permission(v_uid, 'general_affairs.part.manage')) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有料件查看權限');
  END IF;
  SELECT count(*)::integer INTO v_stock FROM ga_inventory_balances WHERE part_id = p_part_id AND quantity_base <> 0;
  SELECT count(*)::integer INTO v_tx FROM ga_inventory_transactions WHERE part_id = p_part_id;
  SELECT count(*)::integer INTO v_req FROM ga_service_requests
    WHERE part_id = p_part_id AND deleted_at IS NULL AND main_status NOT IN ('COMPLETED', 'REJECTED', 'CANCELED');
  SELECT count(DISTINCT t.id)::integer INTO v_transfer FROM ga_inventory_transfer_items i
    JOIN ga_inventory_transfers t ON t.id = i.transfer_id
    WHERE i.part_id = p_part_id AND t.deleted_at IS NULL AND t.status IN ('REQUESTED', 'SOURCE_CONFIRMED', 'IN_TRANSIT');
  SELECT count(*)::integer INTO v_ful FROM ga_part_fulfillments f
    JOIN ga_service_requests r ON r.id = f.request_id
    WHERE r.part_id = p_part_id AND f.deleted_at IS NULL AND f.status NOT IN ('COMPLETED', 'CANCELED');
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'stock_locations', v_stock,
    'transactions', v_tx,
    'open_requests', v_req,
    'open_transfers', v_transfer,
    'open_fulfillments', v_ful,
    'unit_locked', (v_stock > 0 OR v_tx > 0)));
END;
$$;

-- 刪除料件（Q6）：須填原因；有庫存或有未結單就擋下；成功時一併軟刪除其庫存位置設定與舊式相容性。
CREATE OR REPLACE FUNCTION public.ga_ws_delete_part(p_part_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := ga_normalize_optional_text(p_reason);
  v_now timestamptz := now();
  v_usage jsonb;
  v_n integer;
  v_loc integer := 0;
  v_compat integer := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.part.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有料件管理權限');
  END IF;
  IF v_reason IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入刪除原因'); END IF;
  IF length(v_reason) > 200 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '刪除原因不可超過 200 字'); END IF;
  SELECT count(*)::integer INTO v_n FROM (SELECT 1 FROM ga_parts WHERE id = p_part_id FOR UPDATE) s;
  IF v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到料件'); END IF;
  IF EXISTS (SELECT 1 FROM ga_parts WHERE id = p_part_id AND deleted_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '此料件已被刪除');
  END IF;
  v_usage := (ga_ws_part_usage(p_part_id))->'data';
  IF (v_usage->>'stock_locations')::integer > 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'HAS_STOCK', 'usage', v_usage,
      'error', format('此料件在 %s 個位置仍有庫存，不能刪除；請先調整庫存為 0，或改用停用', v_usage->>'stock_locations'));
  END IF;
  IF (v_usage->>'open_requests')::integer + (v_usage->>'open_transfers')::integer + (v_usage->>'open_fulfillments')::integer > 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'HAS_OPEN_ORDERS', 'usage', v_usage,
      'error', format('此料件還有未結單（需求單 %s、調撥單 %s、料件處理單 %s），不能刪除；請先結案或取消，或改用停用',
                      v_usage->>'open_requests', v_usage->>'open_transfers', v_usage->>'open_fulfillments'));
  END IF;

  PERFORM set_config('app.ga_soft_delete_inventory_location_part', 'true', true);
  UPDATE ga_inventory_location_parts
     SET is_active = false, deleted_at = v_now, deleted_by = v_uid,
         deletion_reason = '父料件刪除衍生：' || v_reason, updated_by = v_uid
   WHERE part_id = p_part_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_loc = ROW_COUNT;

  PERFORM set_config('app.ga_soft_delete_part_compatibility', 'true', true);
  UPDATE ga_part_compatibilities
     SET deleted_at = v_now, deleted_by = v_uid, deletion_reason = '父料件刪除衍生：' || v_reason, updated_by = v_uid
   WHERE part_id = p_part_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_compat = ROW_COUNT;

  PERFORM set_config('app.ga_soft_delete_part', 'true', true);
  UPDATE ga_parts
     SET is_active = false, deleted_at = v_now, deleted_by = v_uid, deletion_reason = v_reason, updated_by = v_uid
   WHERE id = p_part_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION '料件刪除失敗，交易已中止'; END IF;

  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'id', p_part_id, 'deleted_at', v_now, 'deleted_by', v_uid, 'deletion_reason', v_reason,
    'deleted_location_settings', v_loc, 'deleted_compatibilities', v_compat));
END;
$$;

-- 適用料件版本碼：同一對象目前有效對照的指紋，用來偵測「載入後被別人改過」。
CREATE OR REPLACE FUNCTION public.ga_ws_target_compat_version(p_target_type text, p_target_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT md5(COALESCE(string_agg(c.part_id::text || '@' || c.updated_at::text, ',' ORDER BY c.part_id), ''))
    FROM ga_part_target_compatibilities c
   WHERE c.target_type = p_target_type AND c.target_id = p_target_id AND c.deleted_at IS NULL
$$;

-- 整批取代某對象的適用料件（G05）：失敗全部回復；p_expected_version 不符（被他人改過）回 409。
CREATE OR REPLACE FUNCTION public.ga_ws_replace_target_compat(
  p_target_type text, p_target_id uuid, p_part_ids uuid[], p_expected_version text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ids uuid[] := COALESCE((SELECT array_agg(DISTINCT x) FROM unnest(p_part_ids) x), ARRAY[]::uuid[]);
  v_removed integer := 0;
  v_added integer := 0;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.part.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有料件管理權限');
  END IF;
  IF p_target_type NOT IN ('EQUIPMENT', 'EQUIPMENT_TEMPLATE', 'FACILITY', 'FACILITY_TEMPLATE') THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '相容性對象類型錯誤');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ga_ws_compat:' || p_target_type || ':' || p_target_id::text));
  IF p_expected_version IS NOT NULL AND ga_ws_target_compat_version(p_target_type, p_target_id) IS DISTINCT FROM p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '適用料件已被其他人修改，請重新載入後再儲存');
  END IF;
  UPDATE ga_part_target_compatibilities
     SET deleted_at = now(), deleted_by = v_uid, deletion_reason = 'REPLACED_BY_COMPATIBILITY_MANAGEMENT', updated_by = v_uid
   WHERE target_type = p_target_type AND target_id = p_target_id AND deleted_at IS NULL AND NOT (part_id = ANY(v_ids));
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  INSERT INTO ga_part_target_compatibilities (target_type, target_id, part_id, created_by, updated_by)
    SELECT p_target_type, p_target_id, x, v_uid, v_uid FROM unnest(v_ids) x
     WHERE NOT EXISTS (SELECT 1 FROM ga_part_target_compatibilities c
                        WHERE c.target_type = p_target_type AND c.target_id = p_target_id AND c.part_id = x AND c.deleted_at IS NULL);
  GET DIAGNOSTICS v_added = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'added', v_added, 'removed', v_removed, 'part_ids', to_jsonb(v_ids),
    'version', ga_ws_target_compat_version(p_target_type, p_target_id)));
END;
$$;

-- 儲存設備型號／設施架型，並（可選）同一個交易內取代適用料件（G04 + G05 合併成一次請求）。
-- p_kind: 'equipment' | 'facility'；p_id 為空代表新增；p_data 為完整可編輯欄位；p_part_ids 為 NULL 代表不動適用料件。
CREATE OR REPLACE FUNCTION public.ga_ws_save_template(
  p_kind text, p_id uuid, p_data jsonb, p_part_ids uuid[] DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL, p_expected_compat_version text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := p_id;
  v_cur timestamptz;
  v_row jsonb;
  v_compat jsonb;
  v_target text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF p_kind = 'equipment' THEN
    IF NOT has_permission(v_uid, 'general_affairs.equipment_template.manage') THEN
      RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有設備型號管理權限');
    END IF;
    v_target := 'EQUIPMENT_TEMPLATE';
  ELSIF p_kind = 'facility' THEN
    IF NOT has_permission(v_uid, 'general_affairs.facility.manage') THEN
      RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有設施管理權限');
    END IF;
    v_target := 'FACILITY_TEMPLATE';
  ELSE
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '型號類型錯誤');
  END IF;
  IF p_part_ids IS NOT NULL AND NOT has_permission(v_uid, 'general_affairs.part.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有料件管理權限，不能設定適用料件');
  END IF;

  IF v_id IS NULL THEN
    IF p_kind = 'equipment' THEN
      INSERT INTO ga_equipment_templates (category_id, name, brand, model, description, specs, default_fields, default_warranty_months, image_path, is_active, created_by, updated_by)
      VALUES ((p_data->>'category_id')::uuid, p_data->>'name', p_data->>'brand', p_data->>'model', p_data->>'description',
              COALESCE(p_data->'specs', '{}'::jsonb), COALESCE(p_data->'default_fields', '{}'::jsonb),
              NULLIF(p_data->>'default_warranty_months', '')::integer, p_data->>'image_path',
              COALESCE((p_data->>'is_active')::boolean, true), v_uid, v_uid)
      RETURNING id INTO v_id;
    ELSE
      INSERT INTO ga_facility_templates (code, name, category_id, brand, model, width_cm, height_cm, depth_cm, description, is_active, created_by, updated_by)
      VALUES (upper(p_data->>'code'), p_data->>'name', NULLIF(p_data->>'category_id', '')::uuid, p_data->>'brand', p_data->>'model',
              NULLIF(p_data->>'width_cm', '')::numeric, NULLIF(p_data->>'height_cm', '')::numeric, NULLIF(p_data->>'depth_cm', '')::numeric,
              p_data->>'description', COALESCE((p_data->>'is_active')::boolean, true), v_uid, v_uid)
      RETURNING id INTO v_id;
    END IF;
  ELSE
    IF p_kind = 'equipment' THEN
      SELECT updated_at INTO v_cur FROM ga_equipment_templates WHERE id = v_id AND deleted_at IS NULL FOR UPDATE;
    ELSE
      SELECT updated_at INTO v_cur FROM ga_facility_templates WHERE id = v_id AND deleted_at IS NULL FOR UPDATE;
    END IF;
    IF v_cur IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到型號或架型'); END IF;
    IF p_expected_updated_at IS NOT NULL AND v_cur IS DISTINCT FROM p_expected_updated_at THEN
      RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '這筆資料已被其他人修改，請重新載入後再儲存');
    END IF;
    IF p_kind = 'equipment' THEN
      UPDATE ga_equipment_templates SET
        category_id = (p_data->>'category_id')::uuid, name = p_data->>'name', brand = p_data->>'brand', model = p_data->>'model',
        description = p_data->>'description', specs = COALESCE(p_data->'specs', '{}'::jsonb),
        default_fields = COALESCE(p_data->'default_fields', '{}'::jsonb),
        default_warranty_months = NULLIF(p_data->>'default_warranty_months', '')::integer, image_path = p_data->>'image_path',
        is_active = COALESCE((p_data->>'is_active')::boolean, true), updated_by = v_uid
      WHERE id = v_id;
    ELSE
      UPDATE ga_facility_templates SET
        code = upper(p_data->>'code'), name = p_data->>'name', category_id = NULLIF(p_data->>'category_id', '')::uuid,
        brand = p_data->>'brand', model = p_data->>'model',
        width_cm = NULLIF(p_data->>'width_cm', '')::numeric, height_cm = NULLIF(p_data->>'height_cm', '')::numeric,
        depth_cm = NULLIF(p_data->>'depth_cm', '')::numeric, description = p_data->>'description',
        is_active = COALESCE((p_data->>'is_active')::boolean, true), updated_by = v_uid
      WHERE id = v_id;
    END IF;
  END IF;

  IF p_part_ids IS NOT NULL THEN
    v_compat := ga_ws_replace_target_compat(v_target, v_id, p_part_ids, p_expected_compat_version);
    IF NOT (v_compat->>'ok')::boolean THEN
      RAISE EXCEPTION '%', v_compat->>'error' USING ERRCODE = 'P0409';
    END IF;
  END IF;

  IF p_kind = 'equipment' THEN
    SELECT to_jsonb(t.*) INTO v_row FROM ga_equipment_templates t WHERE id = v_id;
  ELSE
    SELECT to_jsonb(t.*) INTO v_row FROM ga_facility_templates t WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN p_id IS NULL THEN 201 ELSE 200 END, 'data', v_row, 'compat', v_compat);
END;
$$;

-- 刪除設備型號／設施架型（Q7）：須填原因；仍有設備或設施在用就擋下（只能停用）。
CREATE OR REPLACE FUNCTION public.ga_ws_delete_template(p_kind text, p_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := ga_normalize_optional_text(p_reason);
  v_now timestamptz := now();
  v_n integer;
  v_inuse integer;
  v_active boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF p_kind = 'equipment' THEN
    IF NOT has_permission(v_uid, 'general_affairs.equipment_template.manage') THEN
      RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有設備型號管理權限');
    END IF;
  ELSIF p_kind = 'facility' THEN
    IF NOT has_permission(v_uid, 'general_affairs.facility.manage') THEN
      RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有設施管理權限');
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '型號類型錯誤');
  END IF;
  IF v_reason IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入刪除原因'); END IF;
  IF length(v_reason) > 200 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '刪除原因不可超過 200 字'); END IF;

  IF p_kind = 'equipment' THEN
    SELECT is_active INTO v_active FROM ga_equipment_templates WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  ELSE
    SELECT is_active INTO v_active FROM ga_facility_templates WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  END IF;
  IF v_active IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到可刪除的型號或架型'); END IF;

  IF p_kind = 'equipment' THEN
    SELECT count(*)::integer INTO v_inuse FROM ga_equipment WHERE template_id = p_id AND deleted_at IS NULL;
  ELSE
    SELECT count(*)::integer INTO v_inuse FROM ga_facilities WHERE facility_template_id = p_id AND deleted_at IS NULL;
  END IF;
  IF v_inuse > 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'IN_USE', 'in_use_count', v_inuse,
      'error', format('已有 %s 筆%s在使用，不能刪除；請改用停用', v_inuse, CASE p_kind WHEN 'equipment' THEN '設備' ELSE '設施' END));
  END IF;

  IF p_kind = 'equipment' THEN
    UPDATE ga_equipment_templates SET is_active = false, deleted_at = v_now, deleted_by = v_uid, deletion_reason = v_reason, updated_by = v_uid
     WHERE id = p_id AND deleted_at IS NULL;
  ELSE
    UPDATE ga_facility_templates SET is_active = false, deleted_at = v_now, deleted_by = v_uid, deletion_reason = v_reason, updated_by = v_uid
     WHERE id = p_id AND deleted_at IS NULL;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION '刪除失敗，交易已中止'; END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200,
    'data', jsonb_build_object('id', p_id, 'deleted_at', v_now, 'deleted_by', v_uid, 'deletion_reason', v_reason));
END;
$$;

-- 既有設備歸戶到設備型號（Q7）：全部成功或全部不變；任何一台自預覽後被改過、已歸戶或已刪除，整批回 409 並列出是哪幾台。
-- p_items: [{"id": "...", "updated_at": "預覽時看到的 updated_at"}]
CREATE OR REPLACE FUNCTION public.ga_ws_link_equipment_to_template(p_template_id uuid, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t ga_equipment_templates%ROWTYPE;
  v_bad jsonb;
  v_count integer;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF NOT (has_permission(v_uid, 'general_affairs.equipment_template.manage') AND has_permission(v_uid, 'general_affairs.equipment.manage')) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '需要公司設備型號與據點設備管理權限');
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請至少選擇一台既有設備');
  END IF;
  IF jsonb_array_length(p_items) > 100 THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '單次最多整理 100 台設備');
  END IF;
  SELECT * INTO v_t FROM ga_equipment_templates WHERE id = p_template_id AND deleted_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到公司設備型號'); END IF;
  IF NOT v_t.is_active THEN RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '停用的公司設備型號不可用於設備歸戶'); END IF;

  PERFORM 1 FROM ga_equipment e WHERE e.id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_items) x) FOR UPDATE;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'reason',
           CASE WHEN e.id IS NULL THEN '已刪除或不存在' WHEN e.template_id IS NOT NULL THEN '已被歸戶'
                ELSE '預覽後已被修改' END)), '[]'::jsonb)
    INTO v_bad
    FROM (SELECT (x->>'id')::uuid AS id, (x->>'updated_at')::timestamptz AS ts FROM jsonb_array_elements(p_items) x) x
    LEFT JOIN ga_equipment e ON e.id = x.id AND e.deleted_at IS NULL
   WHERE e.id IS NULL OR e.template_id IS NOT NULL OR e.updated_at IS DISTINCT FROM x.ts;
  IF jsonb_array_length(v_bad) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'stale', v_bad,
      'error', format('有 %s 台設備自預覽後已被改動或歸戶，整批沒有變更，請重新預覽', jsonb_array_length(v_bad)));
  END IF;

  UPDATE ga_equipment
     SET template_id = v_t.id, category_id = v_t.category_id, name = v_t.name, brand = v_t.brand, model = v_t.model, updated_by = v_uid
   WHERE id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_items) x);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('linked_count', v_count, 'template_name', v_t.name));
END;
$$;

REVOKE ALL ON FUNCTION public.ga_ws_category_usage(public.ga_category_kind, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_set_category_active(public.ga_category_kind, uuid, boolean, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_delete_category(public.ga_category_kind, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_part_usage(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_delete_part(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_target_compat_version(text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_replace_target_compat(text, uuid, uuid[], text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_save_template(text, uuid, jsonb, uuid[], timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_delete_template(text, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_link_equipment_to_template(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_category_usage(public.ga_category_kind, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_set_category_active(public.ga_category_kind, uuid, boolean, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_delete_category(public.ga_category_kind, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_part_usage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_delete_part(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_target_compat_version(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_replace_target_compat(text, uuid, uuid[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_save_template(text, uuid, jsonb, uuid[], timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_delete_template(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_link_equipment_to_template(uuid, jsonb) TO authenticated;
NOTIFY pgrst, 'reload schema';
