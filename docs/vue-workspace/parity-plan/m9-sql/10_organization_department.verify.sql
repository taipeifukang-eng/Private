-- 唯讀驗證 10_organization_department.sql（只有 SELECT）。套用後每列 ok 都應為 true；rollback 後 object 類應為 false。
SELECT 'table:'||t AS item, to_regclass('public.'||t) IS NOT NULL AS ok
FROM (VALUES ('workspace_organization_requests'),('workspace_department_requests')) v(t)
UNION ALL
SELECT 'rls_on:'||c.relname, c.relrowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('workspace_organization_requests','workspace_department_requests')
UNION ALL
SELECT 'function:'||f, to_regprocedure('public.'||f) IS NOT NULL
FROM (VALUES
 ('workspace_organization_snapshot()'),('workspace_organization_catalog()'),
 ('workspace_organization_save(uuid,uuid,text,jsonb,text)'),
 ('workspace_department_version(uuid)'),('workspace_department_catalog(uuid)'),
 ('workspace_department_save(uuid,uuid,jsonb,text)')) v(f)
UNION ALL
-- 只有 service_role 可執行（anon／authenticated 不可）
SELECT 'exec_service_role_only:'||p.proname,
  has_function_privilege('service_role',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('workspace_organization_snapshot','workspace_organization_catalog','workspace_organization_save','workspace_department_version','workspace_department_catalog','workspace_department_save')
UNION ALL
-- M5 W21 最終狀態：單位同步觸發器不應存在
SELECT 'absent:workspace_organization_unit_sync_profiles trigger',
  NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='workspace_organization_unit_sync_profiles' AND NOT tgisinternal)
UNION ALL
-- 最終版 save 應已拿掉「停用單位不可調整成員／主管」的檢查
SELECT 'save_is_m5_w21_final', position('WORKSPACE_INACTIVE' in pg_get_functiondef('public.workspace_organization_save(uuid,uuid,text,jsonb,text)'::regprocedure))=0
WHERE to_regprocedure('public.workspace_organization_save(uuid,uuid,text,jsonb,text)') IS NOT NULL
UNION ALL
-- 前置：正式區既有權限碼應已存在（10 個）
SELECT 'permission_codes_present(10)', count(*)=10 FROM public.permissions
WHERE code IN ('organization.organization.view','organization.department.view','organization.department.create','organization.department.edit','organization.member.view','organization.member.manage','organization.manager.view','organization.manager.manage','organization.department_workspace.view','organization.department_workspace.manage')
ORDER BY 1;
