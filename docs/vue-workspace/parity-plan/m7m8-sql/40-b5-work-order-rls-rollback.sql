-- 40-b5-work-order-rls-rollback.sql
-- 撤回 40：把 3 條政策還原成 20260727021000 的原定義（view_all 可改、可刪、回報人本人無條件可刪）。
-- 撤回前不需要備份（只有政策；原定義在撤回檔內）。
BEGIN;

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
NOTIFY pgrst, 'reload schema';

COMMIT;
