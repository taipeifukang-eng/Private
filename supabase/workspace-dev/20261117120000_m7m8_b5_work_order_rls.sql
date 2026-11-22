-- M7/M8 第 5 批 D（Q20／Q21 的 RLS 收緊）：舊 Next 工單頁與直連 API 仍走這些政策；新版工單函式是 SECURITY DEFINER，不受影響。
-- 收緊三條政策（其餘讀取與新增政策不動）：
--   1. maintenance_requests UPDATE：移除「只有查看全部」（maintenance_request.view_all、work_order.view_all、cross_dept.maintenance.view_all）；修改要有更新或管理權限。
--   2. maintenance_requests DELETE：移除 view_all 三碼與「回報人本人無條件可刪」；改為只有「未受理且沒連需求單」的單可以刪（W4／Q21），
--      刪的人是回報人本人，或有更新／管理權限（maintenance_request.update、work_order.manage、cross_dept.maintenance.update）。
--   3. maintenance_updates 寫入：移除 view_all 三碼（本人 updated_by = auth.uid() 與更新／管理權限維持）。
-- 影響：只有查看全部、沒有更新權限的角色，在舊頁不能再改或刪工單（正式區要先用 36 號預覽出名單、經使用者確認補授權後才套 40 號）。
-- 還原：20261117120000_m7m8_b5_work_order_rls.rollback.sql（還原成原政策）。可重複執行。

DROP POLICY IF EXISTS p1e_maintenance_requests_update ON public.maintenance_requests;
CREATE POLICY p1e_maintenance_requests_update ON public.maintenance_requests
FOR UPDATE TO authenticated
USING (
  public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
)
WITH CHECK (
  public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
);

DROP POLICY IF EXISTS p1e_maintenance_requests_delete ON public.maintenance_requests;
CREATE POLICY p1e_maintenance_requests_delete ON public.maintenance_requests
FOR DELETE TO authenticated
USING (
  status = 'UNACCEPTED'
  AND ga_service_request_id IS NULL
  AND (
    public.current_user_has_permission('general_affairs.maintenance_request.update')
    OR public.current_user_has_permission('general_affairs.work_order.manage')
    OR public.current_user_has_permission('cross_dept.maintenance.update')
    OR reported_by = auth.uid()
  )
);

DROP POLICY IF EXISTS p1e_maintenance_updates_write ON public.maintenance_updates;
CREATE POLICY p1e_maintenance_updates_write ON public.maintenance_updates
TO authenticated
USING (
  updated_by = auth.uid()
  OR public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
)
WITH CHECK (
  updated_by = auth.uid()
  OR public.current_user_has_permission('general_affairs.maintenance_request.update')
  OR public.current_user_has_permission('general_affairs.work_order.update')
  OR public.current_user_has_permission('general_affairs.work_order.manage')
  OR public.current_user_has_permission('cross_dept.maintenance.update')
);

NOTIFY pgrst, 'reload schema';
