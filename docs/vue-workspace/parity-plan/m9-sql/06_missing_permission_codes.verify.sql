-- 06 檢查（唯讀，只有 SELECT）：11 個權限碼都存在、啟用，module／feature／action 與 DEV 相同。
-- 每一列 ok 都應為 true。授權角色數（granted_roles）只是資訊：套用 06 當下為 0，授權步驟之後才會有數字，不影響 ok。
WITH expected(code, module, feature, action) AS (VALUES
  ('activity.support_request.edit', 'activity', 'support_request', 'edit'),
  ('inventory.result_analysis.delete', 'inventory', 'result_analysis', 'delete'),
  ('monthly.allowance.view_support_hours', 'monthly', 'allowance', 'view_support_hours'),
  ('store.clinic_selfpay.mapping.manage', 'store', 'clinic_selfpay', 'manage'),
  ('supervisor.management_category.manage', 'supervisor', 'management_category', 'manage'),
  ('supervisor.management_log.create', 'supervisor', 'management_log', 'create'),
  ('supervisor.management_log.follow_up', 'supervisor', 'management_log', 'follow_up'),
  ('supervisor.management_log.manage', 'supervisor', 'management_log', 'manage'),
  ('supervisor.management_log.update_own', 'supervisor', 'management_log', 'update_own'),
  ('supervisor.management_log.view_own', 'supervisor', 'management_log', 'view_own'),
  ('supervisor.management_log.view_team', 'supervisor', 'management_log', 'view_team')
)
SELECT e.code,
       (p.id IS NOT NULL AND p.is_active = true AND p.module = e.module AND p.feature = e.feature AND p.action = e.action) AS ok,
       (p.id IS NOT NULL) AS exists_in_db,
       p.is_active,
       (SELECT count(*) FROM public.role_permissions rp WHERE rp.permission_id = p.id) AS granted_roles
FROM expected e
LEFT JOIN public.permissions p ON p.code = e.code
ORDER BY e.code;
