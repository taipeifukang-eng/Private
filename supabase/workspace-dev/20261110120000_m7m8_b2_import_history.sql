-- M7/M8 第 2 批（G06-G10）C：Excel 整批匯入設備與設施（Q29）、維修紀錄改讀需求單與工單（Q11）。
-- 內容：
--   1. ga_asset_import_batches：匯入批次紀錄（含防重複送出的識別碼）。
--   2. ga_ws_import_assets：整批預檢＋整批寫入。預檢與正式寫入走同一段程式（預檢也真的嘗試寫入再撤回），所以資料庫觸發器的所有規則（分類必填欄位、保固規則、編號唯一…）
--      都會在預檢就回報；任何一列有錯，整批不寫入；全部通過才一次寫入並登錄批次。
--   3. ga_ws_asset_maintenance_history / ga_ws_asset_repair_summary：維修紀錄（逐筆、與每台設備／設施修過幾次），讀新版需求單與其工單，分頁、門市範圍由函式判斷。
-- 不修改既有資料表欄位、觸發器或舊版函式。還原：20261110120000_m7m8_b2_import_history.rollback.sql
-- 可重複執行。

DO $$
BEGIN
  IF to_regclass('public.ga_equipment') IS NULL OR to_regclass('public.ga_facilities') IS NULL OR to_regclass('public.ga_service_requests') IS NULL
     OR to_regclass('public.maintenance_requests') IS NULL OR to_regclass('public.stores') IS NULL OR to_regclass('public.store_managers') IS NULL
     OR to_regclass('public.ga_equipment_categories') IS NULL OR to_regclass('public.ga_facility_categories') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_facilities' AND column_name = 'onboarding_status') THEN
    RAISE EXCEPTION 'Missing prerequisite column: ga_facilities.onboarding_status (apply 20261110110000_m7m8_b2_onboarding first)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_ws_actor_name') THEN
    RAISE EXCEPTION 'Missing prerequisite function ga_ws_actor_name (apply 20261110100000_m7m8_b2_asset_events_transfers first)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ga_asset_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL,
  file_name text,
  total_rows integer NOT NULL,
  equipment_count integer NOT NULL DEFAULT 0,
  facility_count integer NOT NULL DEFAULT 0,
  store_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_asset_import_batches_key UNIQUE (idempotency_key)
);
ALTER TABLE public.ga_asset_import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ga_asset_import_batches_read ON public.ga_asset_import_batches;
CREATE POLICY ga_asset_import_batches_read ON public.ga_asset_import_batches FOR SELECT USING (
  public.current_user_has_permission('general_affairs.equipment.manage') OR public.current_user_has_permission('general_affairs.facility.manage'));
REVOKE ALL ON public.ga_asset_import_batches FROM PUBLIC, anon;
GRANT SELECT ON public.ga_asset_import_batches TO authenticated;

-- 匯入：p_rows 為陣列，每列 {row_no, kind('EQUIPMENT'|'FACILITY'), store_code, category_code, name, brand, model, serial_number, asset_code, facility_code,
--   status, criticality, area, location_detail, installed_at, purchased_at, purchase_amount, has_warranty, warranty_end_date, quantity, unit, notes}。
--   欄位代碼（status 等）要已是資料庫值（中文標籤由前端轉換）。最多 500 列。
-- p_dry_run = true：預檢（不留下任何資料，回傳每列結果與預計資產編號，編號正式寫入時可能不同）；false：全部通過才寫入。
CREATE OR REPLACE FUNCTION public.ga_ws_import_assets(p_rows jsonb, p_file_name text, p_idempotency_key text, p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_n integer;
  v_need_eq boolean;
  v_need_fac boolean;
  v_batch uuid := gen_random_uuid();
  v_existing record;
  r jsonb;
  v_idx integer := 0;
  v_row_no integer;
  v_kind text;
  v_store uuid;
  v_cat uuid;
  v_new_id uuid;
  v_new_code text;
  v_warranty boolean;
  v_specs jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_eq integer := 0;
  v_fac integer := 0;
  v_stores integer := 0;
  v_msg text;
  v_committed boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '匯入內容格式錯誤'); END IF;
  v_n := jsonb_array_length(p_rows);
  IF v_n = 0 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '沒有可匯入的資料列'); END IF;
  IF v_n > 500 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '單次最多匯入 500 列，請分檔'); END IF;
  SELECT bool_or(upper(btrim(COALESCE(x->>'kind', ''))) = 'EQUIPMENT'), bool_or(upper(btrim(COALESCE(x->>'kind', ''))) = 'FACILITY')
    INTO v_need_eq, v_need_fac FROM jsonb_array_elements(p_rows) x;
  IF COALESCE(v_need_eq, false) AND NOT has_permission(v_uid, 'general_affairs.equipment.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有設備管理權限，不能匯入設備');
  END IF;
  IF COALESCE(v_need_fac, false) AND NOT has_permission(v_uid, 'general_affairs.facility.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有設施管理權限，不能匯入設施');
  END IF;
  IF NOT COALESCE(p_dry_run, true) THEN
    IF v_key IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '缺少防重複識別碼'); END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('ga_import:' || v_key, 0));
    SELECT * INTO v_existing FROM ga_asset_import_batches WHERE idempotency_key = v_key;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
        'dry_run', false, 'committed', true, 'already_imported', true, 'batch_id', v_existing.id, 'total', v_existing.total_rows,
        'equipment_count', v_existing.equipment_count, 'facility_count', v_existing.facility_count, 'store_count', v_existing.store_count,
        'errors', '[]'::jsonb, 'rows', '[]'::jsonb));
    END IF;
  END IF;

  BEGIN  -- 外層：有任何錯誤或只是預檢，就整段撤回
    FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
      v_idx := v_idx + 1;
      v_row_no := COALESCE(NULLIF(r->>'row_no', '')::integer, v_idx);
      BEGIN  -- 每列各自一個子交易，錯誤只記錄不中斷（最後整批撤回）
        v_kind := upper(btrim(COALESCE(r->>'kind', '')));
        IF v_kind NOT IN ('EQUIPMENT', 'FACILITY') THEN RAISE EXCEPTION '類型必須是設備或設施'; END IF;
        SELECT id INTO v_store FROM stores WHERE upper(store_code) = upper(btrim(COALESCE(r->>'store_code', ''))) AND is_active;
        IF v_store IS NULL THEN RAISE EXCEPTION '找不到門市代碼「%」，或該門市已停用', COALESCE(r->>'store_code', ''); END IF;
        IF v_kind = 'EQUIPMENT' THEN
          SELECT id INTO v_cat FROM ga_equipment_categories WHERE upper(code) = upper(btrim(COALESCE(r->>'category_code', ''))) AND deleted_at IS NULL AND is_active;
        ELSE
          SELECT id INTO v_cat FROM ga_facility_categories WHERE upper(code) = upper(btrim(COALESCE(r->>'category_code', ''))) AND deleted_at IS NULL AND is_active;
        END IF;
        IF v_cat IS NULL THEN RAISE EXCEPTION '找不到分類代碼「%」（須為啟用中的%分類）', COALESCE(r->>'category_code', ''), CASE v_kind WHEN 'EQUIPMENT' THEN '設備' ELSE '設施' END; END IF;
        v_warranty := lower(btrim(COALESCE(r->>'has_warranty', ''))) IN ('true', '1', 'y', 'yes', '是');
        v_specs := jsonb_build_object('import_batch_id', v_batch);
        IF v_kind = 'EQUIPMENT' THEN
          INSERT INTO ga_equipment (store_id, category_id, name, brand, model, serial_number, asset_code, status, criticality, area, location_detail,
                                    installed_at, purchased_at, purchase_amount, has_warranty, warranty_end_date, notes, specs)
          VALUES (v_store, v_cat, COALESCE(r->>'name', ''), NULLIF(r->>'brand', ''), NULLIF(r->>'model', ''), NULLIF(r->>'serial_number', ''),
                  NULLIF(btrim(COALESCE(r->>'asset_code', '')), ''), COALESCE(NULLIF(r->>'status', ''), 'ACTIVE'), COALESCE(NULLIF(r->>'criticality', ''), 'NORMAL'),
                  NULLIF(r->>'area', ''), NULLIF(r->>'location_detail', ''), NULLIF(r->>'installed_at', '')::date, NULLIF(r->>'purchased_at', '')::date,
                  NULLIF(r->>'purchase_amount', '')::numeric, v_warranty, CASE WHEN v_warranty THEN NULLIF(r->>'warranty_end_date', '')::date END,
                  NULLIF(r->>'notes', ''), v_specs)
          RETURNING id, asset_code INTO v_new_id, v_new_code;
          v_eq := v_eq + 1;
        ELSE
          IF v_warranty THEN
            v_specs := v_specs || jsonb_build_object('facility_has_warranty', true);
            IF NULLIF(r->>'warranty_end_date', '') IS NOT NULL THEN
              v_specs := v_specs || jsonb_build_object('facility_warranty_end_date', (NULLIF(r->>'warranty_end_date', '')::date)::text);
            END IF;
          END IF;
          INSERT INTO ga_facilities (store_id, category_id, name, facility_code, status, criticality, area, location_detail, installed_at, purchased_at,
                                     purchase_amount, quantity, unit, notes, specs)
          VALUES (v_store, v_cat, COALESCE(r->>'name', ''), NULLIF(btrim(COALESCE(r->>'facility_code', '')), ''), COALESCE(NULLIF(r->>'status', ''), 'ACTIVE'),
                  COALESCE(NULLIF(r->>'criticality', ''), 'NORMAL'), NULLIF(r->>'area', ''), NULLIF(r->>'location_detail', ''),
                  NULLIF(r->>'installed_at', '')::date, NULLIF(r->>'purchased_at', '')::date, NULLIF(r->>'purchase_amount', '')::numeric,
                  NULLIF(r->>'quantity', '')::numeric, NULLIF(r->>'unit', ''), NULLIF(r->>'notes', ''), v_specs)
          RETURNING id, facility_code INTO v_new_id, v_new_code;
          v_fac := v_fac + 1;
        END IF;
        v_results := v_results || jsonb_build_object('row_no', v_row_no, 'asset_type', v_kind, 'id', v_new_id, 'code', v_new_code, 'store_id', v_store);
      EXCEPTION WHEN OTHERS THEN
        v_msg := CASE
          WHEN SQLSTATE = '23505' THEN '編號重複：資產編號或設施代碼已存在，或檔案內有重複'
          WHEN SQLSTATE IN ('22007', '22008') THEN '日期格式錯誤（請用 YYYY-MM-DD）'
          WHEN SQLSTATE IN ('22P02', '22003') THEN '數字或欄位值格式錯誤'
          WHEN SQLSTATE = '23514' AND SQLERRM !~ '[一-鿿]' THEN '欄位值不在允許的範圍（狀態、重要程度、數量與單位、金額等）'
          WHEN SQLERRM ~ '[一-鿿]' THEN regexp_replace(SQLERRM, '^[A-Z0-9_]+:\s*', '')
          ELSE '資料不符合規則' END;
        v_errors := v_errors || jsonb_build_object('row_no', v_row_no, 'error', v_msg);
      END;
    END LOOP;

    SELECT count(DISTINCT x->>'store_id')::integer INTO v_stores FROM jsonb_array_elements(v_results) x;
    IF COALESCE(p_dry_run, true) OR jsonb_array_length(v_errors) > 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'P0A01', MESSAGE = 'ga_import_rollback';
    END IF;
    INSERT INTO ga_asset_import_batches (id, idempotency_key, file_name, total_rows, equipment_count, facility_count, store_count, created_by, created_by_name)
    VALUES (v_batch, v_key, left(COALESCE(p_file_name, ''), 200), v_n, v_eq, v_fac, v_stores, v_uid, ga_ws_actor_name(v_uid));
    v_committed := true;
  EXCEPTION WHEN SQLSTATE 'P0A01' THEN
    v_committed := false;
  END;

  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'dry_run', COALESCE(p_dry_run, true), 'committed', v_committed, 'already_imported', false,
    'batch_id', CASE WHEN v_committed THEN v_batch END, 'total', v_n, 'equipment_count', v_eq, 'facility_count', v_fac, 'store_count', v_stores,
    'errors', v_errors,
    -- 預檢（已撤回）不回傳資產 id，只回預計編號
    'rows', CASE WHEN v_committed THEN v_results ELSE (SELECT COALESCE(jsonb_agg(x - 'id'), '[]'::jsonb) FROM jsonb_array_elements(v_results) x) END));
END;
$$;

-- 維修紀錄範圍：持有設備／設施查看或管理、需求單查看全部或管理、維修單或工單查看全部者看全部；其餘只看自己有名單身分（store_managers）的門市。
CREATE OR REPLACE FUNCTION public.ga_ws_history_scope(p_uid uuid, p_type text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT has_permission(p_uid, 'general_affairs.equipment.view') OR has_permission(p_uid, 'general_affairs.equipment.manage')
      OR has_permission(p_uid, 'general_affairs.facility.view') OR has_permission(p_uid, 'general_affairs.facility.manage')
      OR has_permission(p_uid, 'general_affairs.request.view_all') OR has_permission(p_uid, 'general_affairs.request.manage')
      OR has_permission(p_uid, 'general_affairs.maintenance_request.view_all') OR has_permission(p_uid, 'general_affairs.work_order.view_all')
$$;

-- 維修紀錄逐筆（報修單 + 其工單）。p_status：OPEN=未結案、CLOSED=已結案（完成／退回／取消）、或需求單主狀態原值。
CREATE OR REPLACE FUNCTION public.ga_ws_asset_maintenance_history(
  p_type text DEFAULT NULL, p_asset_id uuid DEFAULT NULL, p_store_id uuid DEFAULT NULL, p_status text DEFAULT NULL, p_search text DEFAULT NULL,
  p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_full boolean;
  v_mine uuid[];
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_q text := NULLIF(lower(btrim(COALESCE(p_search, ''))), '');
  v_total integer;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF p_type IS NOT NULL AND p_type NOT IN ('EQUIPMENT', 'FACILITY') THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '資產類型錯誤'); END IF;
  v_full := ga_ws_history_scope(v_uid, p_type);
  SELECT COALESCE(array_agg(DISTINCT store_id), ARRAY[]::uuid[]) INTO v_mine FROM store_managers WHERE user_id = v_uid;
  IF NOT v_full AND array_length(v_mine, 1) IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有查看維修紀錄的權限'); END IF;

  WITH base AS (
    SELECT sr.id, sr.request_no, sr.title, sr.main_status, sr.public_progress, sr.created_at, sr.completed_at, sr.store_id,
           CASE WHEN sr.equipment_id IS NOT NULL THEN 'EQUIPMENT' ELSE 'FACILITY' END AS asset_type,
           COALESCE(sr.equipment_id, sr.facility_id) AS asset_id,
           COALESCE(e.name, f.name) AS asset_name, COALESCE(e.asset_code, f.facility_code) AS asset_code,
           mr.id AS wo_id, mr.status AS wo_status, mr.progress_stage AS wo_stage, mr.assignee_name AS wo_assignee
      FROM ga_service_requests sr
      LEFT JOIN ga_equipment e ON e.id = sr.equipment_id
      LEFT JOIN ga_facilities f ON f.id = sr.facility_id
      LEFT JOIN maintenance_requests mr ON mr.id = sr.maintenance_request_id
     WHERE sr.deleted_at IS NULL AND sr.request_type = 'REPAIR' AND (sr.equipment_id IS NOT NULL OR sr.facility_id IS NOT NULL)
       AND (p_type IS NULL OR (p_type = 'EQUIPMENT' AND sr.equipment_id IS NOT NULL) OR (p_type = 'FACILITY' AND sr.facility_id IS NOT NULL))
       AND (p_asset_id IS NULL OR COALESCE(sr.equipment_id, sr.facility_id) = p_asset_id)
       AND (p_store_id IS NULL OR sr.store_id = p_store_id)
       AND (v_full OR sr.store_id = ANY(v_mine))
       AND (p_status IS NULL OR p_status = ''
            OR (p_status = 'OPEN' AND sr.main_status NOT IN ('COMPLETED', 'REJECTED', 'CANCELED'))
            OR (p_status = 'CLOSED' AND sr.main_status IN ('COMPLETED', 'REJECTED', 'CANCELED'))
            OR sr.main_status = p_status)
       AND (p_from IS NULL OR (sr.created_at AT TIME ZONE 'Asia/Taipei')::date >= p_from)
       AND (p_to IS NULL OR (sr.created_at AT TIME ZONE 'Asia/Taipei')::date <= p_to)
       AND (v_q IS NULL OR position(v_q IN lower(sr.request_no || ' ' || sr.title || ' ' || COALESCE(e.name, f.name, '') || ' ' || COALESCE(e.asset_code, f.facility_code, ''))) > 0)
  ), counted AS (SELECT count(*)::integer AS n FROM base),
  paged AS (SELECT * FROM base ORDER BY created_at DESC, id LIMIT v_limit OFFSET v_offset)
  SELECT (SELECT n FROM counted),
         COALESCE(jsonb_agg(jsonb_build_object(
           'id', p.id, 'request_no', p.request_no, 'title', p.title, 'main_status', p.main_status, 'public_progress', p.public_progress,
           'created_at', p.created_at, 'completed_at', p.completed_at, 'asset_type', p.asset_type, 'asset_id', p.asset_id,
           'asset_name', p.asset_name, 'asset_code', p.asset_code, 'store_id', p.store_id, 'store_code', s.store_code, 'store_name', COALESCE(s.short_name, s.store_name),
           'work_order', CASE WHEN p.wo_id IS NULL THEN NULL ELSE jsonb_build_object('id', p.wo_id, 'status', p.wo_status, 'progress_stage', p.wo_stage,
                                                                                     'assignee_name', CASE WHEN v_full THEN p.wo_assignee END) END)
           ORDER BY p.created_at DESC, p.id), '[]'::jsonb)
    INTO v_total, v_rows
    FROM paged p LEFT JOIN stores s ON s.id = p.store_id;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset));
END;
$$;

-- 每台設備／設施修過幾次（只列有報修紀錄的資產）
CREATE OR REPLACE FUNCTION public.ga_ws_asset_repair_summary(
  p_type text, p_store_id uuid DEFAULT NULL, p_search text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_full boolean;
  v_mine uuid[];
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_q text := NULLIF(lower(btrim(COALESCE(p_search, ''))), '');
  v_total integer;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF p_type NOT IN ('EQUIPMENT', 'FACILITY') THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '資產類型錯誤'); END IF;
  v_full := ga_ws_history_scope(v_uid, p_type);
  SELECT COALESCE(array_agg(DISTINCT store_id), ARRAY[]::uuid[]) INTO v_mine FROM store_managers WHERE user_id = v_uid;
  IF NOT v_full AND array_length(v_mine, 1) IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有查看維修紀錄的權限'); END IF;

  WITH agg AS (
    SELECT COALESCE(sr.equipment_id, sr.facility_id) AS asset_id,
           count(*)::integer AS repair_count,
           count(*) FILTER (WHERE sr.main_status NOT IN ('COMPLETED', 'REJECTED', 'CANCELED'))::integer AS open_count,
           max(sr.created_at) AS last_reported_at
      FROM ga_service_requests sr
     WHERE sr.deleted_at IS NULL AND sr.request_type = 'REPAIR'
       AND ((p_type = 'EQUIPMENT' AND sr.equipment_id IS NOT NULL) OR (p_type = 'FACILITY' AND sr.facility_id IS NOT NULL))
       AND (v_full OR sr.store_id = ANY(v_mine))
     GROUP BY COALESCE(sr.equipment_id, sr.facility_id)
  ), base AS (
    SELECT g.asset_id, g.repair_count, g.open_count, g.last_reported_at,
           COALESCE(e.name, f.name) AS asset_name, COALESCE(e.asset_code, f.facility_code) AS asset_code, COALESCE(e.store_id, f.store_id) AS store_id
      FROM agg g LEFT JOIN ga_equipment e ON e.id = g.asset_id AND p_type = 'EQUIPMENT'
                 LEFT JOIN ga_facilities f ON f.id = g.asset_id AND p_type = 'FACILITY'
     WHERE (p_store_id IS NULL OR COALESCE(e.store_id, f.store_id) = p_store_id)
       AND (v_q IS NULL OR position(v_q IN lower(COALESCE(e.name, f.name, '') || ' ' || COALESCE(e.asset_code, f.facility_code, ''))) > 0)
  ), counted AS (SELECT count(*)::integer AS n FROM base),
  paged AS (SELECT * FROM base ORDER BY repair_count DESC, last_reported_at DESC, asset_id LIMIT v_limit OFFSET v_offset)
  SELECT (SELECT n FROM counted),
         COALESCE(jsonb_agg(jsonb_build_object(
           'asset_id', p.asset_id, 'asset_name', p.asset_name, 'asset_code', p.asset_code, 'store_id', p.store_id,
           'store_code', s.store_code, 'store_name', COALESCE(s.short_name, s.store_name),
           'repair_count', p.repair_count, 'open_count', p.open_count, 'last_reported_at', p.last_reported_at)
           ORDER BY p.repair_count DESC, p.last_reported_at DESC, p.asset_id), '[]'::jsonb)
    INTO v_total, v_rows
    FROM paged p LEFT JOIN stores s ON s.id = p.store_id;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset));
END;
$$;

REVOKE ALL ON FUNCTION public.ga_ws_history_scope(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_import_assets(jsonb, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_asset_maintenance_history(text, uuid, uuid, text, text, date, date, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_asset_repair_summary(text, uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_import_assets(jsonb, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_asset_maintenance_history(text, uuid, uuid, text, text, date, date, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_asset_repair_summary(text, uuid, text, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
