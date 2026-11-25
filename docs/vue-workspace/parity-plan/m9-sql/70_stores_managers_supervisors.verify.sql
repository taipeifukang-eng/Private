-- M9 正式區草稿 70 驗證（唯讀，只有 SELECT）：門市、店長與督導。套用後執行；每列 ok 應為 true。
-- 1. 物件是否齊全
SELECT 'table workspace_store_requests' AS item, to_regclass('public.workspace_store_requests') IS NOT NULL AS ok
UNION ALL SELECT 'rls on workspace_store_requests', coalesce((SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.workspace_store_requests')),false)
UNION ALL SELECT 'no policy on workspace_store_requests', NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='workspace_store_requests')
UNION ALL SELECT 'anon/authenticated 無表權限', NOT (has_table_privilege('anon','public.workspace_store_requests','SELECT') OR has_table_privilege('authenticated','public.workspace_store_requests','SELECT') OR has_table_privilege('authenticated','public.workspace_store_requests','INSERT'))
UNION ALL SELECT 'service_role 有表權限', has_table_privilege('service_role','public.workspace_store_requests','SELECT') AND has_table_privilege('service_role','public.workspace_store_requests','INSERT')
UNION ALL SELECT 'policy workspace_store_inactive_read', EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='stores' AND policyname='workspace_store_inactive_read' AND cmd='SELECT')
UNION ALL SELECT 'stores 啟用 RLS（政策才有作用）', coalesce((SELECT relrowsecurity FROM pg_class WHERE oid='public.stores'::regclass),false);

-- 2. 函式：存在、SECURITY DEFINER、只有 service_role 可執行（workspace_can_read_inactive_store 另給 authenticated）
SELECT f.sig AS item,
  to_regprocedure(f.sig) IS NOT NULL AS exists_ok,
  coalesce((SELECT prosecdef FROM pg_proc WHERE oid=to_regprocedure(f.sig)),false) AS security_definer,
  coalesce(has_function_privilege('service_role',to_regprocedure(f.sig),'EXECUTE'),false) AS service_role_exec,
  coalesce(NOT has_function_privilege('anon',to_regprocedure(f.sig),'EXECUTE'),false) AS anon_denied,
  CASE WHEN f.sig LIKE 'public.workspace_can_read_inactive_store%' THEN true
       ELSE coalesce(NOT has_function_privilege('authenticated',to_regprocedure(f.sig),'EXECUTE'),false) END AS authenticated_denied_unless_policy_fn
FROM (VALUES
 ('public.workspace_store_catalog(boolean,uuid)'),
 ('public.workspace_store_history(uuid)'),
 ('public.workspace_store_mutate(uuid,uuid,text,jsonb,text)'),
 ('public.workspace_set_store_manager(uuid,uuid[],text[])'),
 ('public.workspace_set_supervisor(uuid,text,uuid[],uuid[],text[])'),
 ('public.workspace_set_supervisor_choices(uuid,text,uuid[],jsonb,text[])'),
 ('public.workspace_can_read_inactive_store()')) AS f(sig);

-- 3. 權限碼：五個都在且啟用
SELECT c.code AS item, p.id IS NOT NULL AS exists_ok, coalesce(p.is_active,false) AS active_ok
FROM (VALUES ('store.store.view'),('store.store.view_inactive'),('store.store.create'),('store.store.edit'),('store.store.clone')) AS c(code)
LEFT JOIN public.permissions p ON p.code=c.code ORDER BY c.code;

-- 4. 資訊：這五個權限碼目前被授權給哪些角色（本草稿不授權；套用前後數字不應因本檔而改變）
SELECT p.code, r.code AS role_code, rp.is_allowed
FROM public.permissions p JOIN public.role_permissions rp ON rp.permission_id=p.id JOIN public.roles r ON r.id=rp.role_id
WHERE p.code IN ('store.store.view','store.store.view_inactive','store.store.create','store.store.edit','store.store.clone')
ORDER BY p.code, r.code;

-- 5. 資訊：正式區 has_permission 語意（應為不含 roles.is_active、不含 admin 繞過）
SELECT pg_get_functiondef(to_regprocedure('public.has_permission(uuid,character varying)')) ~* '(^|[^a-z_])r\.is_active' AS checks_roles_is_active_expect_false,
       pg_get_functiondef(to_regprocedure('public.has_permission(uuid,character varying)')) ILIKE '%''admin''%' AS has_admin_bypass_expect_false;
