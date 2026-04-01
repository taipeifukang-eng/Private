-- 啟用所有核心表的 RLS 並添加安全策略
-- 修復 Supabase 安全警告：多個表未啟用 RLS

-- ========================================
-- 1. profiles 表（已有現成策略，僅啟用 RLS + 補充 service_role 與 anon）
-- ========================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_service_role_all" ON profiles;
DROP POLICY IF EXISTS "profiles_authenticated_select_all" ON profiles;
DROP POLICY IF EXISTS "profiles_anon_deny" ON profiles;

-- service_role（內部 API）：完整存取（繞過所有 RLS）
CREATE POLICY "profiles_service_role_all"
  ON profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated：允許讀取 profiles（應用程式多處需要讀取角色/姓名）
CREATE POLICY "profiles_authenticated_select_all"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- anon：無存取
CREATE POLICY "profiles_anon_deny"
  ON profiles
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- 說明：SELECT/UPDATE 策略已由現有的
-- "Admins can view all profiles"、"Admins can update all profiles"、
-- "Users can view own profile" 三條規則覆蓋，此處不重複建立。

-- ========================================
-- 2. assignments 表
-- ========================================
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assignments_service_role_all" ON assignments;
DROP POLICY IF EXISTS "assignments_authenticated_access" ON assignments;
DROP POLICY IF EXISTS "assignments_anon_deny" ON assignments;

-- service_role：完整存取
CREATE POLICY "assignments_service_role_all"
  ON assignments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated：透過 adminClient 存取（由應用邏輯控制）
CREATE POLICY "assignments_authenticated_access"
  ON assignments
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- anon：無存取
CREATE POLICY "assignments_anon_deny"
  ON assignments
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ========================================
-- 3. logs 表
-- ========================================
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "logs_service_role_all" ON logs;
DROP POLICY IF EXISTS "logs_authenticated_select" ON logs;
DROP POLICY IF EXISTS "logs_anon_deny" ON logs;

-- service_role：完整存取（寫日誌）
CREATE POLICY "logs_service_role_all"
  ON logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated：查看日誌
CREATE POLICY "logs_authenticated_select"
  ON logs
  FOR SELECT
  TO authenticated
  USING (true);

-- anon：無存取
CREATE POLICY "logs_anon_deny"
  ON logs
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ========================================
-- 4. pharmacist_monthly_snapshot 表
-- ========================================
ALTER TABLE pharmacist_monthly_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pharmacist_monthly_snapshot_service_role_all" ON pharmacist_monthly_snapshot;
DROP POLICY IF EXISTS "pharmacist_monthly_snapshot_authenticated_access" ON pharmacist_monthly_snapshot;
DROP POLICY IF EXISTS "pharmacist_monthly_snapshot_anon_deny" ON pharmacist_monthly_snapshot;

-- service_role：完整存取
CREATE POLICY "pharmacist_monthly_snapshot_service_role_all"
  ON pharmacist_monthly_snapshot
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated：透過應用邏輯存取
CREATE POLICY "pharmacist_monthly_snapshot_authenticated_access"
  ON pharmacist_monthly_snapshot
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- anon：無存取
CREATE POLICY "pharmacist_monthly_snapshot_anon_deny"
  ON pharmacist_monthly_snapshot
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ========================================
-- 5. pharmacist_snapshot_locks 表
-- ========================================
ALTER TABLE pharmacist_snapshot_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pharmacist_snapshot_locks_service_role_all" ON pharmacist_snapshot_locks;
DROP POLICY IF EXISTS "pharmacist_snapshot_locks_authenticated_access" ON pharmacist_snapshot_locks;
DROP POLICY IF EXISTS "pharmacist_snapshot_locks_anon_deny" ON pharmacist_snapshot_locks;

-- service_role：完整存取
CREATE POLICY "pharmacist_snapshot_locks_service_role_all"
  ON pharmacist_snapshot_locks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated：透過應用邏輯存取
CREATE POLICY "pharmacist_snapshot_locks_authenticated_access"
  ON pharmacist_snapshot_locks
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- anon：無存取
CREATE POLICY "pharmacist_snapshot_locks_anon_deny"
  ON pharmacist_snapshot_locks
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ========================================
-- 6. campaign_department_publish 表
-- ========================================
ALTER TABLE campaign_department_publish ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_department_publish_service_role_all" ON campaign_department_publish;
DROP POLICY IF EXISTS "campaign_department_publish_authenticated_access" ON campaign_department_publish;
DROP POLICY IF EXISTS "campaign_department_publish_anon_deny" ON campaign_department_publish;

-- service_role：完整存取
CREATE POLICY "campaign_department_publish_service_role_all"
  ON campaign_department_publish
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated：透過應用邏輯存取
CREATE POLICY "campaign_department_publish_authenticated_access"
  ON campaign_department_publish
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- anon：無存取
CREATE POLICY "campaign_department_publish_anon_deny"
  ON campaign_department_publish
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ========================================
-- 7. stockout_product_response_history 表
-- ========================================
ALTER TABLE stockout_product_response_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stockout_product_response_history_service_role_all" ON stockout_product_response_history;
DROP POLICY IF EXISTS "stockout_product_response_history_authenticated_access" ON stockout_product_response_history;
DROP POLICY IF EXISTS "stockout_product_response_history_anon_deny" ON stockout_product_response_history;

-- service_role：完整存取
CREATE POLICY "stockout_product_response_history_service_role_all"
  ON stockout_product_response_history
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated：透過應用邏輯存取
CREATE POLICY "stockout_product_response_history_authenticated_access"
  ON stockout_product_response_history
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- anon：無存取
CREATE POLICY "stockout_product_response_history_anon_deny"
  ON stockout_product_response_history
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ========================================
-- 8. templates 表
-- ========================================
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "templates_service_role_all" ON templates;
DROP POLICY IF EXISTS "templates_authenticated_select" ON templates;
DROP POLICY IF EXISTS "templates_authenticated_write" ON templates;
DROP POLICY IF EXISTS "templates_authenticated_insert" ON templates;
DROP POLICY IF EXISTS "templates_authenticated_update" ON templates;
DROP POLICY IF EXISTS "templates_authenticated_delete" ON templates;
DROP POLICY IF EXISTS "templates_anon_deny" ON templates;

-- service_role：完整存取
CREATE POLICY "templates_service_role_all"
  ON templates
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- authenticated：完整存取（透過應用 RBAC 邏輯控制）
CREATE POLICY "templates_authenticated_select"
  ON templates
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "templates_authenticated_insert"
  ON templates
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "templates_authenticated_update"
  ON templates
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "templates_authenticated_delete"
  ON templates
  FOR DELETE
  TO authenticated
  USING (true);

-- anon：無存取
CREATE POLICY "templates_anon_deny"
  ON templates
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ========================================
-- 9. assignment_cleanup_backup_20260401 表（備份）
-- ========================================
ALTER TABLE assignment_cleanup_backup_20260401 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "assignment_cleanup_backup_service_role_all" ON assignment_cleanup_backup_20260401;
DROP POLICY IF EXISTS "assignment_cleanup_backup_anon_deny" ON assignment_cleanup_backup_20260401;

-- service_role：完整存取
CREATE POLICY "assignment_cleanup_backup_service_role_all"
  ON assignment_cleanup_backup_20260401
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- anon + authenticated：無存取（備份不應修改）
CREATE POLICY "assignment_cleanup_backup_anon_deny"
  ON assignment_cleanup_backup_20260401
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

-- ========================================
-- 完成
-- ========================================
-- 所有核心表已啟用 RLS，設定 service_role 完整存取權限
-- authenticated 用戶透過應用邏輯（RBAC）進行存取控制
-- anon（匿名）用戶完全無存取權限
