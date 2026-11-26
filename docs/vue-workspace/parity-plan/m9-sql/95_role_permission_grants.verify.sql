-- M9 95 角色權限授權 verify（只有 SELECT）
-- 來源：新權限勾選頁（survey/m9-permissions，送出時間 2026-11-24T14:17:43.674Z）
-- 授權配對數：33
-- ok = true 代表該角色目前確實持有該權限（is_allowed = true）。
SELECT v.role_code AS role, v.permission_code AS code,
  EXISTS (
    SELECT 1
    FROM public.roles r
    JOIN public.permissions p ON p.code = v.permission_code
    JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.permission_id = p.id
    WHERE r.code = v.role_code AND rp.is_allowed
  ) AS ok
FROM (
  VALUES
    ('admin', 'cross_dept.maintenance.update'),
    ('admin', 'employee.store_transfer.confirm'),
    ('admin', 'general_affairs.maintenance_request.view_own_store'),
    ('admin', 'general_affairs.purchase_order.approve'),
    ('admin', 'general_affairs.purchase_payment.manage'),
    ('admin', 'general_affairs.purchase_payment.view'),
    ('admin', 'general_affairs.request.view_own_store'),
    ('admin', 'general_affairs.service_center.access'),
    ('admin', 'general_affairs.work_order.view_own_store'),
    ('admin', 'inventory.result_analysis.delete'),
    ('admin', 'inventory.result_analysis.import'),
    ('admin', 'inventory.result_analysis.view_own'),
    ('admin', 'supervisor.management_log.create'),
    ('admin', 'supervisor.management_log.follow_up'),
    ('admin', 'supervisor.management_log.manage'),
    ('admin', 'supervisor.management_log.update_own'),
    ('admin', 'supervisor.management_log.view_own'),
    ('admin', 'supervisor.management_log.view_team'),
    ('business_supervisor', 'inventory.result_analysis.import'),
    ('business_supervisor', 'inventory.result_analysis.view_own'),
    ('business_supervisor', 'task.manage'),
    ('general_affairs', 'task.view_archived'),
    ('inventory_team', 'inventory.result_analysis.delete'),
    ('inventory_team', 'inventory.result_analysis.import'),
    ('merchandise_assistant', 'task.view_archived'),
    ('store_manager_role', 'inventory.result_analysis.view_own'),
    ('supervisor_role', 'employee.store_transfer.confirm'),
    ('supervisor_role', 'inventory.result_analysis.view_own'),
    ('supervisor_role', 'supervisor.management_log.create'),
    ('supervisor_role', 'supervisor.management_log.follow_up'),
    ('supervisor_role', 'supervisor.management_log.update_own'),
    ('supervisor_role', 'supervisor.management_log.view_own'),
    ('supervisor_role', 'supervisor.management_log.view_team')
) AS v(role_code, permission_code)
ORDER BY v.role_code, v.permission_code;
