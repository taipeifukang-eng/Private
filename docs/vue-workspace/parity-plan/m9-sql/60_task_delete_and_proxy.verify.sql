-- 60_task_delete_and_proxy 唯讀驗證（只有 SELECT，可在套用前後各跑一次）。
-- 套用後期望：每列 ok = true。套用前執行時，prereq_* 應為 true（需先套用 20_task_core），其餘為 false 屬正常。
SELECT 'prereq_workspace_version' AS item, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assignments' AND column_name='workspace_version') AS ok
UNION ALL SELECT 'prereq_task_receipts', to_regclass('public.workspace_task_receipts') IS NOT NULL
UNION ALL SELECT 'prereq_template_receipts', to_regclass('public.workspace_template_receipts') IS NOT NULL
UNION ALL SELECT 'prereq_save_task_template', to_regprocedure('public.workspace_save_task_template(uuid,uuid,bigint,jsonb,uuid,text,jsonb)') IS NOT NULL
UNION ALL SELECT 'audit_table_exists', to_regclass('public.workspace_task_delete_audit') IS NOT NULL
UNION ALL SELECT 'audit_table_rls_on', coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.workspace_task_delete_audit')), false)
UNION ALL SELECT 'audit_table_no_anon_auth_privs', to_regclass('public.workspace_task_delete_audit') IS NOT NULL
  AND NOT has_table_privilege('anon','public.workspace_task_delete_audit','SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated','public.workspace_task_delete_audit','SELECT,INSERT,UPDATE,DELETE')
UNION ALL SELECT 'logs_proxy_column', EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='logs' AND column_name='proxy' AND data_type='boolean' AND is_nullable='NO')
UNION ALL SELECT 'support_users_patched', coalesce(position('support_users' in pg_get_functiondef(to_regprocedure('public.workspace_save_task_template(uuid,uuid,bigint,jsonb,uuid,text,jsonb)'))) > 0, false)
UNION ALL SELECT 'delete_uses_progress_complete', coalesce(
  position('workspace_assignment_progress_complete' in pg_get_functiondef(to_regprocedure('public.workspace_delete_assignment(uuid,uuid)'))) > 0
  AND position('workspace_assignment_progress_complete' in pg_get_functiondef(to_regprocedure('public.workspace_delete_template(uuid,uuid,text)'))) > 0, false)
UNION ALL SELECT 'v2_per_action_proxy', coalesce(position('entry->>''proxy''' in pg_get_functiondef(to_regprocedure('public.workspace_save_task_v2(uuid,uuid,bigint,uuid,text,jsonb,text,boolean)'))) > 0, false)
UNION ALL SELECT 'old_save_task_still_exists', to_regprocedure('public.workspace_save_task(uuid,uuid,bigint,uuid,text,jsonb,text)') IS NOT NULL
UNION ALL
SELECT 'fn_service_role_only:' || f.sig,
       to_regprocedure(f.sig) IS NOT NULL
       AND has_function_privilege('service_role', to_regprocedure(f.sig), 'EXECUTE')
       AND NOT has_function_privilege('anon', to_regprocedure(f.sig), 'EXECUTE')
       AND NOT has_function_privilege('authenticated', to_regprocedure(f.sig), 'EXECUTE')
FROM (VALUES
  ('public.workspace_assignment_progress_complete(uuid)'),
  ('public.workspace_delete_assignment(uuid,uuid)'),
  ('public.workspace_delete_template(uuid,uuid,text)'),
  ('public.workspace_save_task_v2(uuid,uuid,bigint,uuid,text,jsonb,text,boolean)'),
  ('public.workspace_save_task_template(uuid,uuid,bigint,jsonb,uuid,text,jsonb)')
) AS f(sig);

-- 資料概況（資訊用，無期望值）：套用後 proxy_logs 應為 0（既有紀錄皆非代做），audit_rows 為 0 直到有人刪除任務
SELECT (SELECT count(*) FROM public.logs) AS logs_total,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='logs' AND column_name='proxy') THEN 'proxy 欄位已存在' ELSE 'proxy 欄位尚未建立' END AS proxy_column_state;
