-- ============================================================
-- General Affairs Resource Attachments: allow PART resources
-- Scope:
--   - Extend shared attachment resource type whitelist to PART.
--   - Extend read/manage helper functions for ga_parts.
--   - Keep existing storage, table, RLS policies and grants unchanged.
-- Not in scope:
--   - Direct storage grants to anon/authenticated.
--   - Hard delete policy.
--   - Rewriting already-applied attachment foundation migration.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.ga_resource_attachments') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.ga_resource_attachments';
  END IF;

  IF to_regclass('public.ga_parts') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.ga_parts';
  END IF;

  IF to_regclass('public.store_managers') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.store_managers';
  END IF;

  IF to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.current_user_has_permission(character varying)';
  END IF;
END $$;

ALTER TABLE public.ga_resource_attachments
  DROP CONSTRAINT IF EXISTS ga_resource_attachments_resource_type_check;

ALTER TABLE public.ga_resource_attachments
  ADD CONSTRAINT ga_resource_attachments_resource_type_check
  CHECK (resource_type IN ('EQUIPMENT', 'FACILITY', 'PART', 'MAINTENANCE_REQUEST', 'MAINTENANCE_UPDATE'));

CREATE OR REPLACE FUNCTION public.ga_resource_attachment_can_read(
  p_resource_type TEXT,
  p_resource_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_resource_type = 'EQUIPMENT' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.ga_equipment e
      WHERE e.id = p_resource_id
        AND e.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.equipment.view')
          OR public.current_user_has_permission('general_affairs.equipment.manage')
          OR EXISTS (
            SELECT 1 FROM public.store_managers sm
            WHERE sm.store_id = e.store_id
              AND sm.user_id = auth.uid()
          )
        )
    );
  END IF;

  IF p_resource_type = 'FACILITY' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.ga_facilities f
      WHERE f.id = p_resource_id
        AND f.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.facility.view')
          OR public.current_user_has_permission('general_affairs.facility.manage')
          OR EXISTS (
            SELECT 1 FROM public.store_managers sm
            WHERE sm.store_id = f.store_id
              AND sm.user_id = auth.uid()
          )
        )
    );
  END IF;

  IF p_resource_type = 'PART' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.ga_parts p
      WHERE p.id = p_resource_id
        AND p.deleted_at IS NULL
        AND (
          public.current_user_has_permission('general_affairs.part.view')
          OR public.current_user_has_permission('general_affairs.part.manage')
          OR (
            p.is_active = true
            AND EXISTS (
              SELECT 1
              FROM public.store_managers sm
              WHERE sm.user_id = auth.uid()
            )
          )
        )
    );
  END IF;

  IF p_resource_type = 'MAINTENANCE_REQUEST' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.maintenance_requests mr
      WHERE mr.id = p_resource_id
        AND (
          public.current_user_has_permission('general_affairs.maintenance_request.view_all')
          OR public.current_user_has_permission('general_affairs.maintenance_request.update')
          OR public.current_user_has_permission('general_affairs.work_order.view_all')
          OR public.current_user_has_permission('general_affairs.work_order.update')
          OR public.current_user_has_permission('general_affairs.work_order.manage')
          OR public.current_user_has_permission('cross_dept.maintenance.view_all')
          OR public.current_user_has_permission('cross_dept.maintenance.update')
          OR mr.reported_by = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.store_managers sm
            WHERE sm.store_id = mr.store_id
              AND sm.user_id = auth.uid()
              AND (
                public.current_user_has_permission('general_affairs.maintenance_request.create')
                OR public.current_user_has_permission('general_affairs.maintenance_request.view_own_store')
                OR public.current_user_has_permission('general_affairs.work_order.view_own_store')
                OR public.current_user_has_permission('cross_dept.maintenance.submit')
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
          COALESCE(mu.visibility, 'PUBLIC') = 'PUBLIC'
          OR public.current_user_has_permission('general_affairs.maintenance_request.view_all')
          OR public.current_user_has_permission('general_affairs.maintenance_request.update')
          OR public.current_user_has_permission('general_affairs.work_order.view_all')
          OR public.current_user_has_permission('general_affairs.work_order.update')
          OR public.current_user_has_permission('general_affairs.work_order.manage')
          OR public.current_user_has_permission('cross_dept.maintenance.view_all')
          OR public.current_user_has_permission('cross_dept.maintenance.update')
        )
    );
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_resource_attachment_can_manage(
  p_resource_type TEXT,
  p_resource_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
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
$$;

REVOKE ALL ON FUNCTION public.ga_resource_attachment_can_read(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_resource_attachment_can_read(TEXT, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.ga_resource_attachment_can_manage(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_resource_attachment_can_manage(TEXT, UUID) TO authenticated;
