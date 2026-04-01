-- 回滾 fix_enable_rls_all_tables.sql 的主要影響
-- 目的：先恢復既有系統可用性，再分批做最小安全修補

BEGIN;

-- 1) profiles: 保留 RLS，但改成穩定策略（避免遞迴或誤擋）
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_service_role_all" ON profiles;
DROP POLICY IF EXISTS "profiles_authenticated_select_all" ON profiles;
DROP POLICY IF EXISTS "profiles_anon_deny" ON profiles;
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON profiles;

-- 自己可讀
CREATE POLICY "Users can view own profile"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- 自己可改
CREATE POLICY "Users can update own profile"
  ON profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- 所有已登入可讀 profiles（系統大量功能依賴）
CREATE POLICY "Authenticated can view all profiles"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- service_role 全權限
CREATE POLICY "profiles_service_role_all"
  ON profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2) 以下表先回到「不啟用 RLS」，恢復原系統行為
--    後續再針對每張表個別設計最小必要策略
ALTER TABLE IF EXISTS assignments DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS pharmacist_monthly_snapshot DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS pharmacist_snapshot_locks DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS campaign_department_publish DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS stockout_product_response_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS templates DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS assignment_cleanup_backup_20260401 DISABLE ROW LEVEL SECURITY;

-- 清掉 fix_enable 產生的 policy（若存在）
DROP POLICY IF EXISTS "assignments_service_role_all" ON assignments;
DROP POLICY IF EXISTS "assignments_authenticated_access" ON assignments;
DROP POLICY IF EXISTS "assignments_anon_deny" ON assignments;

DROP POLICY IF EXISTS "logs_service_role_all" ON logs;
DROP POLICY IF EXISTS "logs_authenticated_select" ON logs;
DROP POLICY IF EXISTS "logs_anon_deny" ON logs;

DROP POLICY IF EXISTS "pharmacist_monthly_snapshot_service_role_all" ON pharmacist_monthly_snapshot;
DROP POLICY IF EXISTS "pharmacist_monthly_snapshot_authenticated_access" ON pharmacist_monthly_snapshot;
DROP POLICY IF EXISTS "pharmacist_monthly_snapshot_anon_deny" ON pharmacist_monthly_snapshot;

DROP POLICY IF EXISTS "pharmacist_snapshot_locks_service_role_all" ON pharmacist_snapshot_locks;
DROP POLICY IF EXISTS "pharmacist_snapshot_locks_authenticated_access" ON pharmacist_snapshot_locks;
DROP POLICY IF EXISTS "pharmacist_snapshot_locks_anon_deny" ON pharmacist_snapshot_locks;

DROP POLICY IF EXISTS "campaign_department_publish_service_role_all" ON campaign_department_publish;
DROP POLICY IF EXISTS "campaign_department_publish_authenticated_access" ON campaign_department_publish;
DROP POLICY IF EXISTS "campaign_department_publish_anon_deny" ON campaign_department_publish;

DROP POLICY IF EXISTS "stockout_product_response_history_service_role_all" ON stockout_product_response_history;
DROP POLICY IF EXISTS "stockout_product_response_history_authenticated_access" ON stockout_product_response_history;
DROP POLICY IF EXISTS "stockout_product_response_history_anon_deny" ON stockout_product_response_history;

DROP POLICY IF EXISTS "templates_service_role_all" ON templates;
DROP POLICY IF EXISTS "templates_authenticated_select" ON templates;
DROP POLICY IF EXISTS "templates_authenticated_insert" ON templates;
DROP POLICY IF EXISTS "templates_authenticated_update" ON templates;
DROP POLICY IF EXISTS "templates_authenticated_delete" ON templates;
DROP POLICY IF EXISTS "templates_authenticated_write" ON templates;
DROP POLICY IF EXISTS "templates_anon_deny" ON templates;

DROP POLICY IF EXISTS "assignment_cleanup_backup_service_role_all" ON assignment_cleanup_backup_20260401;
DROP POLICY IF EXISTS "assignment_cleanup_backup_anon_deny" ON assignment_cleanup_backup_20260401;

COMMIT;

-- 驗證：你的帳號與員編
SELECT p.id, p.email, p.employee_code, p.role
FROM profiles p
WHERE lower(p.email) = lower('taipeifukang@gmail.com');
