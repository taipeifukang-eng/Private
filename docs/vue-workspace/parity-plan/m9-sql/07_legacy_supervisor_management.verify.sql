-- 唯讀驗證 07_legacy_supervisor_management.sql（只有 SELECT）。套用後每列 ok 都應為 true；rollback 後 object 類應為 false。
WITH t(name, idx_cnt, pol) AS (VALUES
  ('supervisor_management_categories', 2, 3),
  ('supervisor_management_cases',      8, 3),
  ('supervisor_management_records',    5, 3),
  ('supervisor_management_followups',  2, 3),
  ('supervisor_management_case_events',3, 2),
  ('supervisor_management_daily_plans',7, 3)
), f(sig, auth_exec) AS (VALUES
  ('supervisor_management_current_user_manages_store(uuid)', true),
  ('supervisor_management_case_is_visible(uuid)', true),
  ('supervisor_management_case_is_manageable(uuid)', true),
  ('supervisor_management_current_user_has_permission(text)', true),
  ('supervisor_management_validate_category()', false),
  ('supervisor_management_validate_case()', false),
  ('supervisor_management_validate_record()', false),
  ('supervisor_management_validate_followup()', false),
  ('supervisor_management_soft_delete_case(uuid,text)', true),
  ('supervisor_management_soft_delete_record(uuid,text)', true),
  ('supervisor_management_daily_plan_is_visible(uuid)', true),
  ('supervisor_management_daily_plan_is_manageable(uuid)', true),
  ('supervisor_management_validate_daily_plan()', true),
  ('supervisor_management_soft_delete_daily_plan(uuid,text)', true)
)
SELECT 'table:'||name AS item, to_regclass('public.'||name) IS NOT NULL AS ok FROM t
UNION ALL
SELECT 'rls_on:'||name, COALESCE((SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.'||name)), false) FROM t
UNION ALL
SELECT 'policy_count:'||name||'(expect '||pol||')',
  (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t.name) = pol
FROM t
UNION ALL
SELECT 'index_count:'||name||'(expect '||idx_cnt||')',
  (SELECT count(*) FROM pg_indexes i WHERE i.schemaname='public' AND i.tablename=t.name) = idx_cnt
FROM t
UNION ALL
-- 沒有 DELETE（或 ALL）政策：硬刪除不開放給用戶端
SELECT 'no_delete_policy', NOT EXISTS (
  SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename LIKE 'supervisor\_management\_%' AND p.cmd IN ('DELETE','ALL'))
UNION ALL
-- 政策一律改用模組自己的權限輔助函式，不再直接呼叫舊的 current_user_has_permission
SELECT 'policies_use_module_helper', NOT EXISTS (
  SELECT 1 FROM pg_policies p
  WHERE p.schemaname='public' AND p.tablename LIKE 'supervisor\_management\_%'
    AND (COALESCE(p.qual,'')||COALESCE(p.with_check,'')) LIKE '%current_user_has_permission%'
    AND (COALESCE(p.qual,'')||COALESCE(p.with_check,'')) NOT LIKE '%supervisor_management_current_user_has_permission%')
UNION ALL
SELECT 'table_grants:'||name||' authenticated=SELECT,INSERT,UPDATE 無DELETE、anon無',
  has_table_privilege('authenticated','public.'||name,'SELECT') AND has_table_privilege('authenticated','public.'||name,'INSERT')
  AND has_table_privilege('authenticated','public.'||name,'UPDATE') AND NOT has_table_privilege('authenticated','public.'||name,'DELETE')
  AND NOT has_table_privilege('anon','public.'||name,'SELECT') AND NOT has_table_privilege('anon','public.'||name,'INSERT')
FROM t WHERE to_regclass('public.'||name) IS NOT NULL
UNION ALL
SELECT 'function:'||sig, to_regprocedure('public.'||sig) IS NOT NULL FROM f
UNION ALL
SELECT 'function_secdef_search_path:'||sig,
  EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.'||sig) AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public, pg_temp'])
FROM f WHERE to_regprocedure('public.'||sig) IS NOT NULL
UNION ALL
SELECT 'function_exec:'||sig||' authenticated='||auth_exec||' anon=false',
  has_function_privilege('authenticated', to_regprocedure('public.'||sig), 'EXECUTE') = auth_exec
  AND NOT has_function_privilege('anon', to_regprocedure('public.'||sig), 'EXECUTE')
FROM f WHERE to_regprocedure('public.'||sig) IS NOT NULL
UNION ALL
SELECT 'trigger:'||g.tg, EXISTS (SELECT 1 FROM pg_trigger x WHERE x.tgname=g.tg AND NOT x.tgisinternal AND x.tgenabled <> 'D')
FROM (VALUES ('trg_supervisor_management_categories_validate'),('trg_supervisor_management_cases_validate'),
  ('trg_supervisor_management_records_validate'),('trg_supervisor_management_followups_validate'),
  ('trg_supervisor_management_daily_plans_validate')) g(tg)
UNION ALL
-- 最終版內容標記（來源 4：案件新增可見性修正）
SELECT 'case_is_visible_is_final(含 create 權限)',
  to_regprocedure('public.supervisor_management_case_is_visible(uuid)') IS NOT NULL
  AND position('supervisor.management_log.create' in pg_get_functiondef(to_regprocedure('public.supervisor_management_case_is_visible(uuid)'))) > 0
UNION ALL
SELECT 'validate_case_is_final(含 OWNER_MISMATCH)',
  to_regprocedure('public.supervisor_management_validate_case()') IS NOT NULL
  AND position('SUPERVISOR_CASE_OWNER_MISMATCH' in pg_get_functiondef(to_regprocedure('public.supervisor_management_validate_case()'))) > 0
UNION ALL
-- 前置（不由本檔建立）：舊版權限函式與 7 個權限碼
SELECT 'prereq:current_user_has_permission(varchar)', to_regprocedure('public.current_user_has_permission(character varying)') IS NOT NULL
UNION ALL
SELECT 'prereq:permission_codes(7)', (SELECT count(*) FROM public.permissions WHERE code IN (
  'supervisor.management_log.view_own','supervisor.management_log.view_team','supervisor.management_log.create',
  'supervisor.management_log.update_own','supervisor.management_log.follow_up','supervisor.management_log.manage',
  'supervisor.management_category.manage')) = 7
ORDER BY 1;
