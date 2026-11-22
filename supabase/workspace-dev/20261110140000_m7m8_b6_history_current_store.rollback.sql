-- 還原 20261110140000_m7m8_b6_history_current_store.sql：兩個維修紀錄函式回到只依「報修單當時門市」判斷範圍的版本（與 20261110120000 相同）。
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

REVOKE ALL ON FUNCTION public.ga_ws_asset_maintenance_history(text, uuid, uuid, text, text, date, date, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_asset_repair_summary(text, uuid, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_asset_maintenance_history(text, uuid, uuid, text, text, date, date, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_asset_repair_summary(text, uuid, text, integer, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
