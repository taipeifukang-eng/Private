-- M7/M8 第 2 批（G06-G10）B：設備與設施的建檔貼標流程（Q29）。
-- 對應決議：Q29（設施也要貼標待辦與標籤列印，流程比照設備：待上傳照片 → 待上傳貼標照 → 待總務複核 → 完成；退回須填原因且兩項照片都要求）、
--          上線貼標進度頁（每店完成率與卡在哪一步）。
-- 內容：
--   1. ga_facilities 新增 6 個貼標欄位（status、複核備註／時間／人、兩個「需重拍」旗標），欄位名與規則同 ga_equipment（狀態值沿用同一組，方便合併統計）。
--   2. 設施版的狀態計算／同步函式與附件觸發器（舊版設備的函式、觸發器完全不動）。
--   3. 擴充 ga_resource_attachment_can_manage：店長可替自己門市、在「待上傳」階段的設施上傳貼標照（比照設備既有規則）；其他資源類型的內容與 DEV 原狀逐字相同。
--   4. ga_ws_* 函式：待辦清單（分頁）、店長上傳照片（全成或全不變）、總務複核、上線貼標進度。
-- 還原：20261110110000_m7m8_b2_onboarding.rollback.sql
-- 可重複執行。

DO $$
BEGIN
  IF to_regclass('public.ga_equipment') IS NULL OR to_regclass('public.ga_facilities') IS NULL OR to_regclass('public.ga_resource_attachments') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: ga_equipment / ga_facilities / ga_resource_attachments';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_equipment' AND column_name = 'onboarding_requires_label_photo') THEN
    RAISE EXCEPTION 'Missing prerequisite column: ga_equipment.onboarding_requires_label_photo (equipment onboarding migrations not applied)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_sync_equipment_onboarding_status')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'ga_resource_attachment_can_manage')
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'has_permission') THEN
    RAISE EXCEPTION 'Missing prerequisite function (ga_sync_equipment_onboarding_status / ga_resource_attachment_can_manage / has_permission)';
  END IF;
END $$;

-- 1. 設施貼標欄位
ALTER TABLE public.ga_facilities
  ADD COLUMN IF NOT EXISTS onboarding_status text NOT NULL DEFAULT 'NEEDS_EQUIPMENT_PHOTO',
  ADD COLUMN IF NOT EXISTS onboarding_review_note text,
  ADD COLUMN IF NOT EXISTS onboarding_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS onboarding_requires_primary_photo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_requires_label_photo boolean NOT NULL DEFAULT false;
ALTER TABLE public.ga_facilities DROP CONSTRAINT IF EXISTS ga_facilities_onboarding_status_check;
ALTER TABLE public.ga_facilities ADD CONSTRAINT ga_facilities_onboarding_status_check
  CHECK (onboarding_status IN ('NEEDS_EQUIPMENT_PHOTO', 'NEEDS_LABEL_PHOTO', 'PENDING_GA_REVIEW', 'COMPLETED'));
CREATE INDEX IF NOT EXISTS idx_ga_facilities_onboarding_status ON public.ga_facilities (onboarding_status, deleted_at);
COMMENT ON COLUMN public.ga_facilities.onboarding_status IS '設施建檔貼標進度（狀態值與 ga_equipment.onboarding_status 相同）：NEEDS_EQUIPMENT_PHOTO=待上傳設施照片、NEEDS_LABEL_PHOTO=待上傳貼標位置照片、PENDING_GA_REVIEW=待總務複核、COMPLETED=完成。';

-- 2. 設施版狀態計算與同步（邏輯與設備版相同）
CREATE OR REPLACE FUNCTION public.ga_calculate_facility_onboarding_status(p_facility_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_current text;
  v_req_primary boolean;
  v_req_label boolean;
  v_has_primary boolean;
  v_has_label boolean;
BEGIN
  SELECT onboarding_status, COALESCE(onboarding_requires_primary_photo, false), COALESCE(onboarding_requires_label_photo, false)
    INTO v_current, v_req_primary, v_req_label
    FROM ga_facilities WHERE id = p_facility_id AND deleted_at IS NULL;
  IF v_current IS NULL THEN RETURN NULL; END IF;
  IF v_current = 'COMPLETED' THEN RETURN 'COMPLETED'; END IF;
  IF v_req_primary THEN RETURN 'NEEDS_EQUIPMENT_PHOTO'; END IF;
  IF v_req_label THEN RETURN 'NEEDS_LABEL_PHOTO'; END IF;
  SELECT EXISTS (SELECT 1 FROM ga_resource_attachments WHERE resource_type = 'FACILITY' AND resource_id = p_facility_id
                   AND purpose = 'PRIMARY_IMAGE' AND content_type LIKE 'image/%' AND deleted_at IS NULL) INTO v_has_primary;
  SELECT EXISTS (SELECT 1 FROM ga_resource_attachments WHERE resource_type = 'FACILITY' AND resource_id = p_facility_id
                   AND purpose = 'LABEL_POSITION_IMAGE' AND content_type LIKE 'image/%' AND deleted_at IS NULL) INTO v_has_label;
  IF NOT v_has_primary THEN RETURN 'NEEDS_EQUIPMENT_PHOTO'; END IF;
  IF NOT v_has_label THEN RETURN 'NEEDS_LABEL_PHOTO'; END IF;
  RETURN 'PENDING_GA_REVIEW';
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_sync_facility_onboarding_status(p_facility_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_next text := ga_calculate_facility_onboarding_status(p_facility_id);
BEGIN
  IF v_next IS NULL THEN RETURN; END IF;
  UPDATE ga_facilities SET onboarding_status = v_next
   WHERE id = p_facility_id AND deleted_at IS NULL AND onboarding_status IS DISTINCT FROM v_next;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_resource_attachment_sync_facility_onboarding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_type text;
  v_id uuid;
  v_purpose text;
BEGIN
  IF TG_OP = 'DELETE' THEN v_type := OLD.resource_type; v_id := OLD.resource_id; v_purpose := OLD.purpose;
  ELSE v_type := NEW.resource_type; v_id := NEW.resource_id; v_purpose := NEW.purpose; END IF;
  IF v_type = 'FACILITY' AND v_purpose IN ('PRIMARY_IMAGE', 'LABEL_POSITION_IMAGE') THEN
    PERFORM ga_sync_facility_onboarding_status(v_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_ga_resource_attachments_facility_onboarding_sync ON public.ga_resource_attachments;
CREATE TRIGGER trg_ga_resource_attachments_facility_onboarding_sync
AFTER INSERT OR UPDATE OF resource_type, resource_id, purpose, content_type, deleted_at OR DELETE ON public.ga_resource_attachments
FOR EACH ROW EXECUTE FUNCTION public.ga_resource_attachment_sync_facility_onboarding();

-- 既有設施依現有照片回填進度（不改 updated_at／updated_by：暫時停用驗證觸發器，與設備當年的回填做法相同）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.ga_facilities'::regclass AND tgname = 'trg_ga_facilities_before_write' AND NOT tgisinternal) THEN
    ALTER TABLE public.ga_facilities DISABLE TRIGGER trg_ga_facilities_before_write;
  END IF;
END $$;
UPDATE public.ga_facilities f
   SET onboarding_status = ga_calculate_facility_onboarding_status(f.id)
 WHERE f.deleted_at IS NULL
   AND ga_calculate_facility_onboarding_status(f.id) IS NOT NULL
   AND f.onboarding_status IS DISTINCT FROM ga_calculate_facility_onboarding_status(f.id);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.ga_facilities'::regclass AND tgname = 'trg_ga_facilities_before_write' AND NOT tgisinternal) THEN
    ALTER TABLE public.ga_facilities ENABLE TRIGGER trg_ga_facilities_before_write;
  END IF;
END $$;

-- 3. 附件管理判斷：設施增加店長（自己門市、待上傳階段）
CREATE OR REPLACE FUNCTION public.ga_resource_attachment_can_manage(p_resource_type text, p_resource_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF p_resource_type = 'EQUIPMENT' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.ga_equipment e
      WHERE e.id = p_resource_id
        AND e.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.equipment.manage')
          OR (
            e.onboarding_status IN ('NEEDS_EQUIPMENT_PHOTO', 'NEEDS_LABEL_PHOTO')
            AND EXISTS (
              SELECT 1
              FROM public.store_managers sm
              WHERE sm.store_id = e.store_id
                AND sm.user_id = auth.uid()
            )
          )
        )
    );
  END IF;

  IF p_resource_type = 'FACILITY' THEN
    -- 第 2 批新增：與設備相同，店長可替自己門市、還在「待上傳照片」階段的設施上傳貼標照片。
    RETURN EXISTS (
      SELECT 1 FROM public.ga_facilities f
      WHERE f.id = p_resource_id
        AND f.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.facility.manage')
          OR (
            f.onboarding_status IN ('NEEDS_EQUIPMENT_PHOTO', 'NEEDS_LABEL_PHOTO')
            AND EXISTS (
              SELECT 1 FROM public.store_managers sm
              WHERE sm.store_id = f.store_id
                AND sm.user_id = auth.uid()
            )
          )
        )
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

  IF p_resource_type = 'SERVICE_REQUEST' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.ga_service_requests sr
      WHERE sr.id = p_resource_id
        AND sr.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.request.manage')
          OR sr.created_by = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.store_managers sm
            WHERE sm.store_id = sr.store_id
              AND sm.user_id = auth.uid()
          )
        )
    );
  END IF;

  IF p_resource_type = 'SERVICE_REQUEST_COMMENT' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.ga_service_request_comments comment
      JOIN public.ga_service_requests request ON request.id = comment.request_id
      WHERE comment.id = p_resource_id
        AND comment.deleted_at IS NULL
        AND request.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.request.comment_all')
          OR public.current_user_has_permission('general_affairs.request.manage')
          OR (
            comment.visibility = 'PUBLIC'
            AND comment.created_by = auth.uid()
          )
        )
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.ga_calculate_facility_onboarding_status(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_sync_facility_onboarding_status(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_resource_attachment_sync_facility_onboarding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_calculate_facility_onboarding_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_sync_facility_onboarding_status(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.ga_resource_attachment_can_manage(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_resource_attachment_can_manage(text, uuid) TO authenticated;

-- 4. 前端函式 -------------------------------------------------------------------------------

-- 待辦／複核清單（設備與設施合併、分頁）。範圍：持有該類設備／設施查看或管理、需求單管理／全部、門市管理權限者看全部門市（沿用舊版 store-onboarding-tasks 規則）；
-- 其餘人只看自己有名單身分（store_managers）的門市。
CREATE OR REPLACE FUNCTION public.ga_ws_onboarding_list(
  p_statuses text[], p_asset_type text DEFAULT NULL, p_store_id uuid DEFAULT NULL, p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_full_eq boolean;
  v_full_fac boolean;
  v_mine uuid[];
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_offset integer := GREATEST(COALESCE(p_offset, 0), 0);
  v_q text := NULLIF(lower(btrim(COALESCE(p_search, ''))), '');
  v_rows jsonb;
  v_total integer;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF p_asset_type IS NOT NULL AND p_asset_type NOT IN ('EQUIPMENT', 'FACILITY') THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '資產類型錯誤');
  END IF;
  IF p_statuses IS NULL OR array_length(p_statuses, 1) IS NULL
     OR EXISTS (SELECT 1 FROM unnest(p_statuses) s WHERE s NOT IN ('NEEDS_EQUIPMENT_PHOTO', 'NEEDS_LABEL_PHOTO', 'PENDING_GA_REVIEW', 'COMPLETED')) THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '狀態參數錯誤');
  END IF;
  v_full_eq := has_permission(v_uid, 'general_affairs.equipment.manage') OR has_permission(v_uid, 'general_affairs.equipment.view')
            OR has_permission(v_uid, 'general_affairs.request.manage') OR has_permission(v_uid, 'general_affairs.request.view_all') OR has_permission(v_uid, 'store.manage');
  v_full_fac := has_permission(v_uid, 'general_affairs.facility.manage') OR has_permission(v_uid, 'general_affairs.facility.view')
            OR has_permission(v_uid, 'general_affairs.request.manage') OR has_permission(v_uid, 'general_affairs.request.view_all') OR has_permission(v_uid, 'store.manage');
  SELECT COALESCE(array_agg(DISTINCT store_id), ARRAY[]::uuid[]) INTO v_mine FROM store_managers WHERE user_id = v_uid;

  WITH base AS (
    SELECT 'EQUIPMENT'::text AS asset_type, e.id, e.store_id, e.name, e.asset_code AS code, e.area, e.location_detail, e.onboarding_status,
           e.onboarding_requires_primary_photo AS req_primary, e.onboarding_requires_label_photo AS req_label, e.onboarding_review_note AS review_note, e.updated_at
      FROM ga_equipment e
     WHERE e.deleted_at IS NULL AND e.status <> 'SCRAPPED' AND e.onboarding_status = ANY(p_statuses)
       AND (p_asset_type IS NULL OR p_asset_type = 'EQUIPMENT')
       AND (v_full_eq OR e.store_id = ANY(v_mine))
       AND (p_store_id IS NULL OR e.store_id = p_store_id)
       AND (v_q IS NULL OR position(v_q IN lower(e.name || ' ' || COALESCE(e.asset_code, ''))) > 0)
    UNION ALL
    SELECT 'FACILITY', f.id, f.store_id, f.name, f.facility_code, f.area, f.location_detail, f.onboarding_status,
           f.onboarding_requires_primary_photo, f.onboarding_requires_label_photo, f.onboarding_review_note, f.updated_at
      FROM ga_facilities f
     WHERE f.deleted_at IS NULL AND f.status <> 'RETIRED' AND f.onboarding_status = ANY(p_statuses)
       AND (p_asset_type IS NULL OR p_asset_type = 'FACILITY')
       AND (v_full_fac OR f.store_id = ANY(v_mine))
       AND (p_store_id IS NULL OR f.store_id = p_store_id)
       AND (v_q IS NULL OR position(v_q IN lower(f.name || ' ' || COALESCE(f.facility_code, ''))) > 0)
  ), counted AS (SELECT count(*)::integer AS n FROM base),
  paged AS (SELECT * FROM base ORDER BY updated_at DESC, id LIMIT v_limit OFFSET v_offset)
  SELECT (SELECT n FROM counted),
         COALESCE(jsonb_agg(jsonb_build_object(
           'asset_type', p.asset_type, 'id', p.id, 'store_id', p.store_id, 'store_code', s.store_code, 'store_name', COALESCE(s.short_name, s.store_name),
           'name', p.name, 'code', p.code, 'area', p.area, 'location_detail', p.location_detail, 'onboarding_status', p.onboarding_status,
           'requires_primary_photo', p.req_primary, 'requires_label_photo', p.req_label, 'review_note', p.review_note, 'updated_at', p.updated_at)
           ORDER BY p.updated_at DESC, p.id), '[]'::jsonb)
    INTO v_total, v_rows
    FROM paged p LEFT JOIN stores s ON s.id = p.store_id;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_limit, 'offset', v_offset));
END;
$$;

-- 店長（或總務）上傳貼標流程的照片：登錄附件、清除「需重拍」旗標、同步狀態，全部同一個交易。
-- 實體檔案由伺服端先傳到儲存空間；這個函式失敗時伺服端要把剛傳的檔案移除。
CREATE OR REPLACE FUNCTION public.ga_ws_submit_onboarding_photo(
  p_type text, p_id uuid, p_purpose text, p_path text, p_file_name text, p_content_type text, p_size_bytes bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_store uuid;
  v_status text;
  v_manage boolean;
  v_member boolean;
  v_new text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF p_type NOT IN ('EQUIPMENT', 'FACILITY') THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '資產類型錯誤'); END IF;
  IF p_purpose NOT IN ('PRIMARY_IMAGE', 'LABEL_POSITION_IMAGE') THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '照片用途錯誤'); END IF;
  IF p_content_type IS NULL OR p_content_type NOT LIKE 'image/%' THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '僅支援圖片'); END IF;
  IF p_type = 'EQUIPMENT' THEN
    SELECT store_id, onboarding_status INTO v_store, v_status FROM ga_equipment WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  ELSE
    SELECT store_id, onboarding_status INTO v_store, v_status FROM ga_facilities WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  END IF;
  IF v_store IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到資料'); END IF;
  v_manage := has_permission(v_uid, CASE p_type WHEN 'EQUIPMENT' THEN 'general_affairs.equipment.manage' ELSE 'general_affairs.facility.manage' END);
  v_member := EXISTS (SELECT 1 FROM store_managers WHERE user_id = v_uid AND store_id = v_store);
  IF NOT (v_manage OR v_member) THEN RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '只能處理自己管理門市的照片任務'); END IF;
  IF p_path IS NULL OR left(p_path, length(lower(p_type) || '/' || p_id::text || '/' || lower(p_purpose) || '/')) <> lower(p_type) || '/' || p_id::text || '/' || lower(p_purpose) || '/' THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '檔案路徑不屬於這項資產');
  END IF;
  IF p_purpose = 'PRIMARY_IMAGE' AND v_status <> 'NEEDS_EQUIPMENT_PHOTO' THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '目前不需要補設備／設施照片，請重新載入');
  END IF;
  IF p_purpose = 'LABEL_POSITION_IMAGE' AND v_status <> 'NEEDS_LABEL_PHOTO' THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '目前不需要補貼標位置照片，請重新載入');
  END IF;
  IF p_purpose = 'PRIMARY_IMAGE' THEN
    -- 重新上傳：舊的主圖降為一般圖（同一資源同用途只能有一張主圖），舊檔不刪
    UPDATE ga_resource_attachments SET is_primary = false
     WHERE resource_type = p_type AND resource_id = p_id AND purpose = 'PRIMARY_IMAGE' AND is_primary AND deleted_at IS NULL;
  END IF;
  INSERT INTO ga_resource_attachments (resource_type, resource_id, purpose, storage_bucket, storage_path, file_name, content_type, size_bytes, is_primary, metadata)
  VALUES (p_type, p_id, p_purpose, 'general-affairs-attachments', p_path, left(COALESCE(NULLIF(btrim(p_file_name), ''), 'photo'), 200),
          lower(p_content_type), p_size_bytes, p_purpose = 'PRIMARY_IMAGE', jsonb_build_object('source', 'onboarding_task'));
  IF p_type = 'EQUIPMENT' THEN
    UPDATE ga_equipment SET onboarding_requires_primary_photo = CASE WHEN p_purpose = 'PRIMARY_IMAGE' THEN false ELSE onboarding_requires_primary_photo END,
                            onboarding_requires_label_photo = CASE WHEN p_purpose = 'LABEL_POSITION_IMAGE' THEN false ELSE onboarding_requires_label_photo END
     WHERE id = p_id;
    PERFORM ga_sync_equipment_onboarding_status(p_id);
    SELECT onboarding_status INTO v_new FROM ga_equipment WHERE id = p_id;
  ELSE
    UPDATE ga_facilities SET onboarding_requires_primary_photo = CASE WHEN p_purpose = 'PRIMARY_IMAGE' THEN false ELSE onboarding_requires_primary_photo END,
                             onboarding_requires_label_photo = CASE WHEN p_purpose = 'LABEL_POSITION_IMAGE' THEN false ELSE onboarding_requires_label_photo END
     WHERE id = p_id;
    PERFORM ga_sync_facility_onboarding_status(p_id);
    SELECT onboarding_status INTO v_new FROM ga_facilities WHERE id = p_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', 201, 'data', jsonb_build_object('onboarding_status', v_new));
END;
$$;

-- 總務複核：通過 → 完成；退回 → 須填原因，設備／設施照片與貼標照片兩項都要重新上傳（回到「待上傳設備／設施照片」）。
CREATE OR REPLACE FUNCTION public.ga_ws_review_onboarding(p_type text, p_id uuid, p_action text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_status text;
  v_next text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  IF p_type NOT IN ('EQUIPMENT', 'FACILITY') THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '資產類型錯誤'); END IF;
  IF NOT has_permission(v_uid, CASE p_type WHEN 'EQUIPMENT' THEN 'general_affairs.equipment.manage' ELSE 'general_affairs.facility.manage' END) THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', CASE p_type WHEN 'EQUIPMENT' THEN '沒有設備管理權限' ELSE '沒有設施管理權限' END);
  END IF;
  IF p_action NOT IN ('approve', 'reject') THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '複核動作錯誤'); END IF;
  IF p_action = 'reject' AND v_note IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '退回重拍時必須填寫原因'); END IF;
  IF char_length(COALESCE(v_note, '')) > 500 THEN RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '複核說明不可超過 500 字'); END IF;
  IF p_type = 'EQUIPMENT' THEN
    SELECT onboarding_status INTO v_status FROM ga_equipment WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  ELSE
    SELECT onboarding_status INTO v_status FROM ga_facilities WHERE id = p_id AND deleted_at IS NULL FOR UPDATE;
  END IF;
  IF v_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到資料'); END IF;
  IF v_status <> 'PENDING_GA_REVIEW' THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'code', 'STALE', 'error', '目前不是待總務複核狀態，請重新載入');
  END IF;
  v_next := CASE p_action WHEN 'approve' THEN 'COMPLETED' ELSE 'NEEDS_EQUIPMENT_PHOTO' END;
  IF p_type = 'EQUIPMENT' THEN
    UPDATE ga_equipment SET onboarding_status = v_next,
           onboarding_requires_primary_photo = (p_action = 'reject'), onboarding_requires_label_photo = (p_action = 'reject'),
           onboarding_review_note = CASE p_action WHEN 'approve' THEN COALESCE(v_note, '照片正確，完成建檔。') ELSE v_note END,
           onboarding_reviewed_at = now(), onboarding_reviewed_by = v_uid WHERE id = p_id;
  ELSE
    UPDATE ga_facilities SET onboarding_status = v_next,
           onboarding_requires_primary_photo = (p_action = 'reject'), onboarding_requires_label_photo = (p_action = 'reject'),
           onboarding_review_note = CASE p_action WHEN 'approve' THEN COALESCE(v_note, '照片正確，完成建檔。') ELSE v_note END,
           onboarding_reviewed_at = now(), onboarding_reviewed_by = v_uid WHERE id = p_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('onboarding_status', v_next));
END;
$$;

-- 上線貼標進度：每家門市的設備與設施各階段筆數與完成率。排除已刪除、設備已報廢、設施已退役（QR 已作廢，不需貼標）。
-- 完成率 = 完成 / 總數；總數為 0 的門市回 null（尚無資產，不算 100%）。範圍：持有設備或設施查看／管理者看全部門市，店長只看自己門市。
CREATE OR REPLACE FUNCTION public.ga_ws_onboarding_progress(p_store_id uuid DEFAULT NULL, p_include_empty boolean DEFAULT true)
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
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入'); END IF;
  v_full := has_permission(v_uid, 'general_affairs.equipment.manage') OR has_permission(v_uid, 'general_affairs.equipment.view')
         OR has_permission(v_uid, 'general_affairs.facility.manage') OR has_permission(v_uid, 'general_affairs.facility.view');
  SELECT COALESCE(array_agg(DISTINCT store_id), ARRAY[]::uuid[]) INTO v_mine FROM store_managers WHERE user_id = v_uid;
  IF NOT v_full AND array_length(v_mine, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有查看上線貼標進度的權限');
  END IF;

  WITH a AS (
    SELECT 'EQUIPMENT'::text AS t, store_id, onboarding_status AS st, updated_at FROM ga_equipment WHERE deleted_at IS NULL AND status <> 'SCRAPPED'
    UNION ALL
    SELECT 'FACILITY', store_id, onboarding_status, updated_at FROM ga_facilities WHERE deleted_at IS NULL AND status <> 'RETIRED'
  ), agg AS (
    SELECT store_id,
      count(*) FILTER (WHERE t = 'EQUIPMENT') AS eq_total,
      count(*) FILTER (WHERE t = 'EQUIPMENT' AND st = 'NEEDS_EQUIPMENT_PHOTO') AS eq_needs_photo,
      count(*) FILTER (WHERE t = 'EQUIPMENT' AND st = 'NEEDS_LABEL_PHOTO') AS eq_needs_label,
      count(*) FILTER (WHERE t = 'EQUIPMENT' AND st = 'PENDING_GA_REVIEW') AS eq_pending_review,
      count(*) FILTER (WHERE t = 'EQUIPMENT' AND st = 'COMPLETED') AS eq_completed,
      count(*) FILTER (WHERE t = 'FACILITY') AS fac_total,
      count(*) FILTER (WHERE t = 'FACILITY' AND st = 'NEEDS_EQUIPMENT_PHOTO') AS fac_needs_photo,
      count(*) FILTER (WHERE t = 'FACILITY' AND st = 'NEEDS_LABEL_PHOTO') AS fac_needs_label,
      count(*) FILTER (WHERE t = 'FACILITY' AND st = 'PENDING_GA_REVIEW') AS fac_pending_review,
      count(*) FILTER (WHERE t = 'FACILITY' AND st = 'COMPLETED') AS fac_completed,
      min(updated_at) FILTER (WHERE st <> 'COMPLETED') AS oldest_open_at
    FROM a GROUP BY store_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'store_id', s.id, 'store_code', s.store_code, 'store_name', COALESCE(s.short_name, s.store_name),
      'equipment', jsonb_build_object('total', COALESCE(g.eq_total, 0), 'needs_photo', COALESCE(g.eq_needs_photo, 0), 'needs_label', COALESCE(g.eq_needs_label, 0),
                                      'pending_review', COALESCE(g.eq_pending_review, 0), 'completed', COALESCE(g.eq_completed, 0)),
      'facility', jsonb_build_object('total', COALESCE(g.fac_total, 0), 'needs_photo', COALESCE(g.fac_needs_photo, 0), 'needs_label', COALESCE(g.fac_needs_label, 0),
                                     'pending_review', COALESCE(g.fac_pending_review, 0), 'completed', COALESCE(g.fac_completed, 0)),
      'total', COALESCE(g.eq_total, 0) + COALESCE(g.fac_total, 0),
      'completed', COALESCE(g.eq_completed, 0) + COALESCE(g.fac_completed, 0),
      'completion_rate', CASE WHEN COALESCE(g.eq_total, 0) + COALESCE(g.fac_total, 0) = 0 THEN NULL
                              ELSE round(100.0 * (COALESCE(g.eq_completed, 0) + COALESCE(g.fac_completed, 0)) / (COALESCE(g.eq_total, 0) + COALESCE(g.fac_total, 0)), 1) END,
      'oldest_open_at', g.oldest_open_at) ORDER BY s.store_code), '[]'::jsonb)
    INTO v_rows
    FROM stores s LEFT JOIN agg g ON g.store_id = s.id
   WHERE s.is_active
     AND (v_full OR s.id = ANY(v_mine))
     AND (p_store_id IS NULL OR s.id = p_store_id)
     AND (COALESCE(p_include_empty, true) OR g.store_id IS NOT NULL);
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('stores', v_rows));
END;
$$;

REVOKE ALL ON FUNCTION public.ga_ws_onboarding_list(text[], text, uuid, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_submit_onboarding_photo(text, uuid, text, text, text, text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_review_onboarding(text, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_ws_onboarding_progress(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_onboarding_list(text[], text, uuid, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_submit_onboarding_photo(text, uuid, text, text, text, text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_review_onboarding(text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_ws_onboarding_progress(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
