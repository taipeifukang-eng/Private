-- 15_employee_management 套用後驗證（唯讀，只有 SELECT；不寫入任何資料）。
-- 每一列的 ok 都應為 true。員編規則的範例用純函式（IMMUTABLE）計算，不碰資料表。

-- 1. 資料表存在且啟用 RLS、沒有任何政策、anon／authenticated 無權限
SELECT t.name AS check_name,
  to_regclass('public.'||t.name) IS NOT NULL
  AND coalesce((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid=to_regclass('public.'||t.name)),false)
  AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t.name)
  AND NOT has_table_privilege('anon','public.'||t.name,'SELECT')
  AND NOT has_table_privilege('authenticated','public.'||t.name,'SELECT')
  AND NOT has_table_privilege('authenticated','public.'||t.name,'INSERT')
  AND has_table_privilege('service_role','public.'||t.name,'SELECT') AS ok
FROM (VALUES ('workspace_birthday_requests'),('workspace_employee_create_requests'),('workspace_employee_edit_requests'),('workspace_employee_import_receipts'),('monthly_staff_recheck')) AS t(name);

-- 2. 函式存在、SECURITY DEFINER（員編規則兩個純函式除外）、只有 service_role 可執行（anon／authenticated 不可）
SELECT f.sig AS check_name,
  to_regprocedure('public.'||f.sig) IS NOT NULL
  AND NOT has_function_privilege('anon',to_regprocedure('public.'||f.sig),'EXECUTE')
  AND NOT has_function_privilege('authenticated',to_regprocedure('public.'||f.sig),'EXECUTE')
  AND has_function_privilege('service_role',to_regprocedure('public.'||f.sig),'EXECUTE') AS ok
FROM (VALUES
 ('workspace_birthday_snapshot(text[])'),('workspace_birthday_save(uuid,uuid,jsonb,text,uuid[])'),
 ('workspace_employee_create(uuid,uuid,jsonb)'),('workspace_employee_edit_state(text)'),('workspace_employee_edit(uuid,uuid,jsonb,jsonb)'),
 ('workspace_employee_import_check(jsonb,uuid[])'),('workspace_employee_import_save(uuid,uuid,jsonb,uuid[])'),
 ('workspace_employee_id_valid(text)'),('workspace_employee_id_type(text)'),
 ('workspace_monthly_recheck_add(uuid,text,text,uuid,text,uuid,text,text,text,text,text,text,text)'),
 ('workspace_staff_month_locked(uuid,text,text)')) AS f(sig);

SELECT p.proname AS check_name, p.prosecdef AS ok
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('workspace_birthday_snapshot','workspace_birthday_save','workspace_employee_create','workspace_employee_edit_state','workspace_employee_edit','workspace_employee_import_check','workspace_employee_import_save','workspace_monthly_recheck_add','workspace_staff_month_locked','workspace_guard_onboarding_code','workspace_guard_manual_staff_code')
ORDER BY 1;

-- 3. 觸發器存在、啟用（tgenabled='O'）、BEFORE INSERT 且逐列
SELECT t.tgname AS check_name,
  t.tgenabled='O' AND (t.tgtype & 1)=1 AND (t.tgtype & 2)=2 AND (t.tgtype & 4)=4 AND (t.tgtype & 8)=0 AND (t.tgtype & 16)=0 AS ok,
  c.relname AS on_table
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
WHERE NOT t.tgisinternal AND t.tgname IN ('workspace_guard_onboarding_code','workspace_guard_manual_staff_code')
ORDER BY 1;
SELECT 2 = (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('workspace_guard_onboarding_code','workspace_guard_manual_staff_code')) AS both_triggers_present;

-- 4. 索引與前置欄位
SELECT i.name AS check_name, to_regclass('public.'||i.name) IS NOT NULL AS ok
FROM (VALUES ('monthly_staff_recheck_pending_uidx'),('monthly_staff_recheck_month_idx')) AS i(name);
SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='store_employees' AND column_name='newbie_level') AS has_newbie_level;

-- 5. 員編規則範例（預期結果寫在 expected；ok 應全為 true）
SELECT s.code, s.expected, public.workspace_employee_id_valid(s.code)=s.expected AS ok
FROM (VALUES ('FK1234',true),('FK123',false),('FK12345',false),('FKF12345',true),('FKF1234',false),('FKPT123',true),('FKPT1234',false),('FKI123',false),('FKI1234',false),('fk1234',false),(' FK1234',false),('',false),(NULL,false)) AS s(code,expected);
SELECT s.code, s.expected, public.workspace_employee_id_type(s.code)=s.expected AS ok
FROM (VALUES ('FKPT123','part_time'),('FK1234','full_time'),('FKF12345','full_time')) AS s(code,expected);

-- 6. 目前待確認清單概況（資訊用：套用初期應為 0 筆）
SELECT status, count(*) AS rows_count FROM public.monthly_staff_recheck GROUP BY status ORDER BY status;
