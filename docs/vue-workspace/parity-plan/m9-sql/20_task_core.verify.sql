-- M9 草稿 20 任務核心：套用後唯讀驗證（只有 SELECT）。預期每列 ok = true。
SELECT 'assignments.workspace_version 欄位' AS item,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assignments' AND column_name='workspace_version') AS ok
UNION ALL SELECT 'templates.workspace_version 欄位',
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='templates' AND column_name='workspace_version')
UNION ALL SELECT '版本觸發器 5 個都在',
  (SELECT count(*)=5 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal AND t.tgname IN
    ('workspace_task_version','workspace_task_logs_version','workspace_task_collaborators_version','workspace_task_template_version','workspace_template_version'))
UNION ALL SELECT '5 個 workspace_* 函式都在',
  (SELECT count(*)=5 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
    ('workspace_save_task','workspace_copy_archived_task','workspace_archive_template_tasks','workspace_save_task_template','workspace_dispatch_task'))
UNION ALL SELECT '5 張收據表都在且啟用 RLS',
  (SELECT count(*)=5 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity AND c.relname IN
    ('workspace_task_receipts','workspace_task_copy_receipts','workspace_task_archive_receipts','workspace_template_receipts','workspace_task_dispatch_receipts'))
UNION ALL SELECT '函式只有 service_role 可執行（anon／authenticated 不可）',
  (SELECT bool_and(has_function_privilege('service_role',p.oid,'EXECUTE') AND NOT has_function_privilege('anon',p.oid,'EXECUTE') AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE'))
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
    ('workspace_save_task','workspace_copy_archived_task','workspace_archive_template_tasks','workspace_save_task_template','workspace_dispatch_task'))
UNION ALL SELECT '收據表 anon／authenticated 無權限',
  (SELECT NOT bool_or(has_table_privilege('anon',c.oid,'SELECT') OR has_table_privilege('authenticated',c.oid,'SELECT'))
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname LIKE 'workspace\_%receipts' ESCAPE '\')
UNION ALL SELECT '版本觸發器函式 4 個都在',
  (SELECT count(*)=4
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
    ('workspace_task_version','workspace_task_child_version','workspace_task_template_version','workspace_template_version'))
UNION ALL SELECT '既有資料沒有版本號異常（皆 >= 0）',
  NOT EXISTS(SELECT 1 FROM public.assignments WHERE workspace_version<0) AND NOT EXISTS(SELECT 1 FROM public.templates WHERE workspace_version<0);
-- 對照筆數（套用前後應相同，請人工比對）
SELECT (SELECT count(*) FROM public.assignments) AS assignments_rows, (SELECT count(*) FROM public.templates) AS templates_rows,
       (SELECT count(*) FROM public.logs) AS logs_rows, (SELECT count(*) FROM public.assignment_collaborators) AS collaborators_rows;
