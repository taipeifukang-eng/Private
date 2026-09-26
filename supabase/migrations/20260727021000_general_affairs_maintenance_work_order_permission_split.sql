-- ============================================================
-- GA-RBAC-1 - General Affairs maintenance/work-order permission split
--
-- This forward migration introduces General Affairs-specific permission
-- codes for maintenance requests and work orders. The legacy maintenance
-- tables remain shared with the cross-department maintenance surface, so
-- RLS accepts both permission families while UI/navigation/GA role seeds
-- can stop granting cross_dept.maintenance.* to General Affairs roles.
--
-- Does not create or modify business tables, indexes, RPCs, or API contracts.
-- ============================================================

DO $$
DECLARE
  v_missing TEXT[];
BEGIN
  SELECT array_remove(ARRAY[
    CASE WHEN to_regclass('public.permissions') IS NULL THEN 'table public.permissions' END,
    CASE WHEN to_regclass('public.maintenance_categories') IS NULL THEN 'table public.maintenance_categories' END,
    CASE WHEN to_regclass('public.maintenance_progress_stages') IS NULL THEN 'table public.maintenance_progress_stages' END,
    CASE WHEN to_regclass('public.maintenance_requests') IS NULL THEN 'table public.maintenance_requests' END,
    CASE WHEN to_regclass('public.maintenance_photos') IS NULL THEN 'table public.maintenance_photos' END,
    CASE WHEN to_regclass('public.maintenance_updates') IS NULL THEN 'table public.maintenance_updates' END,
    CASE WHEN to_regclass('public.maintenance_update_photos') IS NULL THEN 'table public.maintenance_update_photos' END,
    CASE WHEN to_regclass('public.maintenance_ticket_events') IS NULL THEN 'table public.maintenance_ticket_events' END,
    CASE WHEN to_regclass('public.store_managers') IS NULL THEN 'table public.store_managers' END,
    CASE WHEN to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN 'function public.current_user_has_permission(varchar)' END
  ], NULL)
  INTO v_missing;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'GA-RBAC-1 prerequisites missing: %', array_to_string(v_missing, ', ');
  END IF;
END $$;

INSERT INTO public.permissions (module, feature, code, action, description, is_active) VALUES
  ('general_affairs', 'maintenance_request', 'general_affairs.maintenance_request.create', 'create', '建立總務維修回報與臨時料件申請', true),
  ('general_affairs', 'maintenance_request', 'general_affairs.maintenance_request.view_own_store', 'view_own_store', '查看自己門市總務維修回報', true),
  ('general_affairs', 'maintenance_request', 'general_affairs.maintenance_request.view_all', 'view_all', '查看全部總務維修回報', true),
  ('general_affairs', 'maintenance_request', 'general_affairs.maintenance_request.update', 'update', '更新總務維修回報', true),
  ('general_affairs', 'work_order', 'general_affairs.work_order.view_own_store', 'view_own_store', '查看自己門市總務工單', true),
  ('general_affairs', 'work_order', 'general_affairs.work_order.view_all', 'view_all', '查看全部總務工單', true),
  ('general_affairs', 'work_order', 'general_affairs.work_order.update', 'update', '更新總務工單進度', true),
  ('general_affairs', 'work_order', 'general_affairs.work_order.manage', 'manage', '管理總務工單', true)
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = true;

DROP POLICY IF EXISTS p1e_maintenance_categories_read ON public.maintenance_categories;
CREATE POLICY p1e_maintenance_categories_read ON public.maintenance_categories
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('general_affairs.maintenance_request.create')
  OR public.current_user_has_permission('general_affairs.maintenance_request.view_own_store')
  OR public.current_user_has_permission('general_affairs.maintenance_request.view_all')
  OR public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.view_own_store')
  OR public.current_user_has_permission('general_affairs.work_order.view_all')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.submit')
  OR public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
  OR public.current_user_has_permission('cross_dept.maintenance.category.edit')
);

DROP POLICY IF EXISTS p1e_maintenance_progress_stages_read ON public.maintenance_progress_stages;
CREATE POLICY p1e_maintenance_progress_stages_read ON public.maintenance_progress_stages
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('general_affairs.maintenance_request.create')
  OR public.current_user_has_permission('general_affairs.maintenance_request.view_own_store')
  OR public.current_user_has_permission('general_affairs.maintenance_request.view_all')
  OR public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.view_own_store')
  OR public.current_user_has_permission('general_affairs.work_order.view_all')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.submit')
  OR public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
  OR public.current_user_has_permission('cross_dept.maintenance.category.edit')
);

DROP POLICY IF EXISTS p1e_maintenance_requests_read ON public.maintenance_requests;
CREATE POLICY p1e_maintenance_requests_read ON public.maintenance_requests
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('general_affairs.maintenance_request.view_all')
  OR public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.view_all')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
  OR reported_by = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.store_managers sm
    WHERE sm.store_id = maintenance_requests.store_id
      AND sm.user_id = auth.uid()
      AND (
        public.current_user_has_permission('general_affairs.maintenance_request.create')
        OR public.current_user_has_permission('general_affairs.maintenance_request.view_own_store')
        OR public.current_user_has_permission('general_affairs.work_order.view_own_store')
        OR public.current_user_has_permission('cross_dept.maintenance.submit')
      )
  )
);

DROP POLICY IF EXISTS p1e_maintenance_requests_insert ON public.maintenance_requests;
CREATE POLICY p1e_maintenance_requests_insert ON public.maintenance_requests
FOR INSERT TO authenticated
WITH CHECK (
  reported_by = auth.uid()
  AND (
    public.current_user_has_permission('general_affairs.maintenance_request.view_all')
    OR public.current_user_has_permission('general_affairs.maintenance_request.update')
    OR public.current_user_has_permission('cross_dept.maintenance.view_all')
    OR (
      (
        public.current_user_has_permission('general_affairs.maintenance_request.create')
        OR public.current_user_has_permission('cross_dept.maintenance.submit')
      )
      AND EXISTS (
        SELECT 1
        FROM public.store_managers sm
        WHERE sm.store_id = maintenance_requests.store_id
          AND sm.user_id = auth.uid()
      )
    )
  )
);

DROP POLICY IF EXISTS p1e_maintenance_requests_update ON public.maintenance_requests;
CREATE POLICY p1e_maintenance_requests_update ON public.maintenance_requests
FOR UPDATE TO authenticated
USING (
  public.current_user_has_permission('general_affairs.maintenance_request.view_all')
  OR public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.view_all')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
)
WITH CHECK (
  public.current_user_has_permission('general_affairs.maintenance_request.view_all')
  OR public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.view_all')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
);

DROP POLICY IF EXISTS p1e_maintenance_requests_delete ON public.maintenance_requests;
CREATE POLICY p1e_maintenance_requests_delete ON public.maintenance_requests
FOR DELETE TO authenticated
USING (
  public.current_user_has_permission('general_affairs.maintenance_request.view_all')
  OR public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
  OR reported_by = auth.uid()
);

DROP POLICY IF EXISTS p1e_maintenance_photos_read ON public.maintenance_photos;
CREATE POLICY p1e_maintenance_photos_read ON public.maintenance_photos
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.maintenance_requests mr
    WHERE mr.id = maintenance_photos.request_id
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
          SELECT 1 FROM public.store_managers sm
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
  )
);

DROP POLICY IF EXISTS p1e_maintenance_photos_write ON public.maintenance_photos;
CREATE POLICY p1e_maintenance_photos_write ON public.maintenance_photos
TO authenticated
USING (
  uploaded_by = auth.uid()
  OR public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
)
WITH CHECK (
  uploaded_by = auth.uid()
  OR public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
);

DROP POLICY IF EXISTS p1e_maintenance_updates_read ON public.maintenance_updates;
CREATE POLICY p1e_maintenance_updates_read ON public.maintenance_updates
FOR SELECT TO authenticated
USING (
  visibility = 'PUBLIC'
  OR public.current_user_has_permission('general_affairs.maintenance_request.view_all')
  OR public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.view_all')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
);

DROP POLICY IF EXISTS p1e_maintenance_updates_write ON public.maintenance_updates;
CREATE POLICY p1e_maintenance_updates_write ON public.maintenance_updates
TO authenticated
USING (
  updated_by = auth.uid()
  OR public.current_user_has_permission('general_affairs.maintenance_request.view_all')
  OR public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.view_all')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
)
WITH CHECK (
  updated_by = auth.uid()
  OR public.current_user_has_permission('general_affairs.maintenance_request.view_all')
  OR public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.view_all')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
);

DROP POLICY IF EXISTS p1e_maintenance_update_photos_read ON public.maintenance_update_photos;
CREATE POLICY p1e_maintenance_update_photos_read ON public.maintenance_update_photos
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.maintenance_updates mu
    WHERE mu.id = maintenance_update_photos.update_id
      AND (
        mu.visibility = 'PUBLIC'
        OR public.current_user_has_permission('general_affairs.maintenance_request.view_all')
        OR public.current_user_has_permission('general_affairs.maintenance_request.update')
        OR public.current_user_has_permission('general_affairs.work_order.view_all')
        OR public.current_user_has_permission('general_affairs.work_order.update')
        OR public.current_user_has_permission('general_affairs.work_order.manage')
        OR public.current_user_has_permission('cross_dept.maintenance.view_all')
        OR public.current_user_has_permission('cross_dept.maintenance.update')
      )
  )
);

DROP POLICY IF EXISTS p1e_maintenance_update_photos_write ON public.maintenance_update_photos;
CREATE POLICY p1e_maintenance_update_photos_write ON public.maintenance_update_photos
TO authenticated
USING (
  uploaded_by = auth.uid()
  OR public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
)
WITH CHECK (
  uploaded_by = auth.uid()
  OR public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
);

DROP POLICY IF EXISTS p1e_maintenance_ticket_events_read ON public.maintenance_ticket_events;
CREATE POLICY p1e_maintenance_ticket_events_read ON public.maintenance_ticket_events
FOR SELECT TO authenticated
USING (
  visibility = 'PUBLIC'
  OR public.current_user_has_permission('general_affairs.maintenance_request.view_all')
  OR public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.view_all')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.view_all')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
);

DROP POLICY IF EXISTS p1e_maintenance_ticket_events_write ON public.maintenance_ticket_events;
CREATE POLICY p1e_maintenance_ticket_events_write ON public.maintenance_ticket_events
TO authenticated
USING (
  created_by = auth.uid()
  OR public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
)
WITH CHECK (
  created_by = auth.uid()
  OR public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
);
