-- 40-b5-work-order-rls.sql
-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/20261117120000_m7m8_b5_work_order_rls.sql 相同。
-- 第 5 批 D（Q20／Q21 RLS 收緊；名單確認前不得套用）（2026-11-16 第 5 批問卷 W1 至 W9）。
-- 性質：改 3 條 RLS 政策（影響舊 Next 工單頁與直連 API；新版函式是 SECURITY DEFINER，不受影響）：
--   p1e_maintenance_requests_update：移除「只有查看全部」（maintenance_request.view_all、work_order.view_all、cross_dept.maintenance.view_all）；
--   p1e_maintenance_requests_delete：移除 view_all 三碼與「回報人本人無條件可刪」，改為只有「未受理且沒連需求單」的單可以刪（回報人本人，或有更新／管理權限）；
--   p1e_maintenance_updates_write：移除 view_all 三碼（本人署名與更新／管理權限維持）。
-- 重要（未經使用者確認 36 號第 6、7 區名單與補授權前，不得套用）：套用後，名單上「只有查看全部、沒有更新或管理權限」的角色與人，在舊版工單頁不能再改、不能再刪；
--   請先替他們補授權（工單更新或工單管理），再套用。profiles.role = admin 但沒有更新角色的管理員（第 7 區）新版也只能看。
-- 先決條件：先套 37、38、39 並完成驗收；撤回檔把三條政策還原成 20260727021000 的原定義。
-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：40-b5-work-order-rls-rollback.sql。套用前先跑 36-b5-preview-before-apply.sql，備份後經使用者核可才執行。
BEGIN;

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

COMMIT;

-- 核對
SELECT policyname, cmd, (qual LIKE '%view_all%' OR with_check LIKE '%view_all%') AS still_has_view_all FROM pg_policies WHERE schemaname = 'public' AND policyname IN ('p1e_maintenance_requests_update', 'p1e_maintenance_requests_delete', 'p1e_maintenance_updates_write') ORDER BY 1;
-- 核對：三條都應存在，still_has_view_all 都應是 false
