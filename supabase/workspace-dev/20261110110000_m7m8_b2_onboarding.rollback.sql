-- 還原 20261110110000_m7m8_b2_onboarding.sql：移除設施貼標函式與觸發器、把附件管理判斷函式還原成套用前的內容、移除 ga_facilities 的 6 個貼標欄位。
-- 注意：會刪除設施的貼標進度與複核紀錄欄位（正式區執行前請先備份 ga_facilities 的 onboarding_* 欄位）。附件資料本身不動。
DROP FUNCTION IF EXISTS public.ga_ws_onboarding_progress(uuid, boolean);
DROP FUNCTION IF EXISTS public.ga_ws_review_onboarding(text, uuid, text, text);
DROP FUNCTION IF EXISTS public.ga_ws_submit_onboarding_photo(text, uuid, text, text, text, text, bigint);
DROP FUNCTION IF EXISTS public.ga_ws_onboarding_list(text[], text, uuid, text, integer, integer);
DROP TRIGGER IF EXISTS trg_ga_resource_attachments_facility_onboarding_sync ON public.ga_resource_attachments;
DROP FUNCTION IF EXISTS public.ga_resource_attachment_sync_facility_onboarding();
DROP FUNCTION IF EXISTS public.ga_sync_facility_onboarding_status(uuid);
DROP FUNCTION IF EXISTS public.ga_calculate_facility_onboarding_status(uuid);
-- 附件管理判斷：還原成第 2 批套用前（設施只有「設施管理」權限者可管理附件）
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
ALTER TABLE public.ga_facilities DROP CONSTRAINT IF EXISTS ga_facilities_onboarding_status_check;
DROP INDEX IF EXISTS public.idx_ga_facilities_onboarding_status;
ALTER TABLE public.ga_facilities
  DROP COLUMN IF EXISTS onboarding_requires_label_photo,
  DROP COLUMN IF EXISTS onboarding_requires_primary_photo,
  DROP COLUMN IF EXISTS onboarding_reviewed_by,
  DROP COLUMN IF EXISTS onboarding_reviewed_at,
  DROP COLUMN IF EXISTS onboarding_review_note,
  DROP COLUMN IF EXISTS onboarding_status;
NOTIFY pgrst, 'reload schema';
