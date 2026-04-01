-- ============================================================
-- 逐表 RLS 上線清單（不影響現行功能版）
-- 原則：先不影響已登入使用者功能，再逐步收斂權限
--
-- Phase 1（本檔）：
--   - ENABLE RLS
--   - service_role: FOR ALL
--   - authenticated: FOR ALL（維持現況，避免功能中斷）
--   - anon: 全封鎖
--
-- Phase 2（後續）：
--   - 將 authenticated FOR ALL 改為最小權限（SELECT/INSERT/UPDATE/DELETE 分離）
--
-- 執行方式：
--   1) 一次執行一個「表區塊」
--   2) 每個區塊執行後，先跑該區塊下方的驗證 SQL
--   3) 驗證無誤再進下一張表
-- ============================================================

-- ------------------------------------------------------------
-- 全域驗證工具（每張表都可重用）
-- ------------------------------------------------------------
-- A. 檢查 RLS 是否已啟用
-- SELECT n.nspname AS schema_name, c.relname AS table_name, c.relrowsecurity AS rls_enabled
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relname = '<table_name>';
--
-- B. 檢查政策是否存在
-- SELECT policyname, cmd, roles, permissive, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = '<table_name>'
-- ORDER BY policyname;

-- ============================================================
-- 0) profiles（特殊表：已在 rollback_fix_enable_rls_all_tables.sql 修過）
-- 建議：先維持目前策略，不在本檔覆蓋，避免再影響登入身份判斷
-- ============================================================
-- 驗證 SQL：
-- SELECT policyname, cmd, roles FROM pg_policies WHERE schemaname='public' AND tablename='profiles';
-- SELECT id, email, role, employee_code FROM profiles WHERE lower(email)=lower('taipeifukang@gmail.com');


-- ============================================================
-- 1) assignments
-- ============================================================
BEGIN;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_v1_assignments_service_role_all" ON assignments;
DROP POLICY IF EXISTS "rls_v1_assignments_authenticated_all" ON assignments;
DROP POLICY IF EXISTS "rls_v1_assignments_anon_deny" ON assignments;

CREATE POLICY "rls_v1_assignments_service_role_all"
  ON assignments FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "rls_v1_assignments_authenticated_all"
  ON assignments FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "rls_v1_assignments_anon_deny"
  ON assignments FOR ALL TO anon
  USING (false) WITH CHECK (false);
COMMIT;

-- 驗證
-- SELECT relrowsecurity FROM pg_class WHERE relname='assignments';
-- SELECT policyname, cmd, roles FROM pg_policies WHERE tablename='assignments' ORDER BY policyname;
-- 應用驗證：登入後到任務列表 / 指派 / 編輯，CRUD 均應正常


-- ============================================================
-- 2) templates
-- ============================================================
BEGIN;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_v1_templates_service_role_all" ON templates;
DROP POLICY IF EXISTS "rls_v1_templates_authenticated_all" ON templates;
DROP POLICY IF EXISTS "rls_v1_templates_anon_deny" ON templates;

CREATE POLICY "rls_v1_templates_service_role_all"
  ON templates FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "rls_v1_templates_authenticated_all"
  ON templates FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "rls_v1_templates_anon_deny"
  ON templates FOR ALL TO anon
  USING (false) WITH CHECK (false);
COMMIT;

-- 驗證
-- SELECT relrowsecurity FROM pg_class WHERE relname='templates';
-- SELECT policyname, cmd, roles FROM pg_policies WHERE tablename='templates' ORDER BY policyname;
-- 應用驗證：模板列表、建立、編輯、刪除、指派功能


-- ============================================================
-- 3) campaign_department_publish
-- ============================================================
BEGIN;
ALTER TABLE campaign_department_publish ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_v1_campaign_department_publish_service_role_all" ON campaign_department_publish;
DROP POLICY IF EXISTS "rls_v1_campaign_department_publish_authenticated_all" ON campaign_department_publish;
DROP POLICY IF EXISTS "rls_v1_campaign_department_publish_anon_deny" ON campaign_department_publish;

CREATE POLICY "rls_v1_campaign_department_publish_service_role_all"
  ON campaign_department_publish FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "rls_v1_campaign_department_publish_authenticated_all"
  ON campaign_department_publish FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "rls_v1_campaign_department_publish_anon_deny"
  ON campaign_department_publish FOR ALL TO anon
  USING (false) WITH CHECK (false);
COMMIT;

-- 驗證
-- SELECT relrowsecurity FROM pg_class WHERE relname='campaign_department_publish';
-- SELECT policyname, cmd, roles FROM pg_policies WHERE tablename='campaign_department_publish' ORDER BY policyname;
-- 應用驗證：活動發布/查詢流程


-- ============================================================
-- 4) pharmacist_monthly_snapshot
-- ============================================================
BEGIN;
ALTER TABLE pharmacist_monthly_snapshot ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_v1_pharmacist_monthly_snapshot_service_role_all" ON pharmacist_monthly_snapshot;
DROP POLICY IF EXISTS "rls_v1_pharmacist_monthly_snapshot_authenticated_all" ON pharmacist_monthly_snapshot;
DROP POLICY IF EXISTS "rls_v1_pharmacist_monthly_snapshot_anon_deny" ON pharmacist_monthly_snapshot;

CREATE POLICY "rls_v1_pharmacist_monthly_snapshot_service_role_all"
  ON pharmacist_monthly_snapshot FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "rls_v1_pharmacist_monthly_snapshot_authenticated_all"
  ON pharmacist_monthly_snapshot FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "rls_v1_pharmacist_monthly_snapshot_anon_deny"
  ON pharmacist_monthly_snapshot FOR ALL TO anon
  USING (false) WITH CHECK (false);
COMMIT;

-- 驗證
-- SELECT relrowsecurity FROM pg_class WHERE relname='pharmacist_monthly_snapshot';
-- SELECT policyname, cmd, roles FROM pg_policies WHERE tablename='pharmacist_monthly_snapshot' ORDER BY policyname;
-- 應用驗證：藥師管理頁面（督導區總覽）載入/同步


-- ============================================================
-- 5) pharmacist_snapshot_locks
-- ============================================================
BEGIN;
ALTER TABLE pharmacist_snapshot_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_v1_pharmacist_snapshot_locks_service_role_all" ON pharmacist_snapshot_locks;
DROP POLICY IF EXISTS "rls_v1_pharmacist_snapshot_locks_authenticated_all" ON pharmacist_snapshot_locks;
DROP POLICY IF EXISTS "rls_v1_pharmacist_snapshot_locks_anon_deny" ON pharmacist_snapshot_locks;

CREATE POLICY "rls_v1_pharmacist_snapshot_locks_service_role_all"
  ON pharmacist_snapshot_locks FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "rls_v1_pharmacist_snapshot_locks_authenticated_all"
  ON pharmacist_snapshot_locks FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "rls_v1_pharmacist_snapshot_locks_anon_deny"
  ON pharmacist_snapshot_locks FOR ALL TO anon
  USING (false) WITH CHECK (false);
COMMIT;

-- 驗證
-- SELECT relrowsecurity FROM pg_class WHERE relname='pharmacist_snapshot_locks';
-- SELECT policyname, cmd, roles FROM pg_policies WHERE tablename='pharmacist_snapshot_locks' ORDER BY policyname;
-- 應用驗證：快照鎖定/解鎖流程


-- ============================================================
-- 6) stockout_product_response_history
-- ============================================================
BEGIN;
ALTER TABLE stockout_product_response_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_v1_stockout_product_response_history_service_role_all" ON stockout_product_response_history;
DROP POLICY IF EXISTS "rls_v1_stockout_product_response_history_authenticated_all" ON stockout_product_response_history;
DROP POLICY IF EXISTS "rls_v1_stockout_product_response_history_anon_deny" ON stockout_product_response_history;

CREATE POLICY "rls_v1_stockout_product_response_history_service_role_all"
  ON stockout_product_response_history FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "rls_v1_stockout_product_response_history_authenticated_all"
  ON stockout_product_response_history FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "rls_v1_stockout_product_response_history_anon_deny"
  ON stockout_product_response_history FOR ALL TO anon
  USING (false) WITH CHECK (false);
COMMIT;

-- 驗證
-- SELECT relrowsecurity FROM pg_class WHERE relname='stockout_product_response_history';
-- SELECT policyname, cmd, roles FROM pg_policies WHERE tablename='stockout_product_response_history' ORDER BY policyname;
-- 應用驗證：缺貨回報歷程讀寫


-- ============================================================
-- 7) logs
-- ============================================================
BEGIN;
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_v1_logs_service_role_all" ON logs;
DROP POLICY IF EXISTS "rls_v1_logs_authenticated_all" ON logs;
DROP POLICY IF EXISTS "rls_v1_logs_anon_deny" ON logs;

CREATE POLICY "rls_v1_logs_service_role_all"
  ON logs FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "rls_v1_logs_authenticated_all"
  ON logs FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "rls_v1_logs_anon_deny"
  ON logs FOR ALL TO anon
  USING (false) WITH CHECK (false);
COMMIT;

-- 驗證
-- SELECT relrowsecurity FROM pg_class WHERE relname='logs';
-- SELECT policyname, cmd, roles FROM pg_policies WHERE tablename='logs' ORDER BY policyname;
-- 應用驗證：操作日誌寫入/查詢


-- ============================================================
-- 8) assignment_cleanup_backup_20260401（備份表）
-- ============================================================
BEGIN;
ALTER TABLE assignment_cleanup_backup_20260401 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rls_v1_assignment_cleanup_backup_service_role_all" ON assignment_cleanup_backup_20260401;
DROP POLICY IF EXISTS "rls_v1_assignment_cleanup_backup_authenticated_all" ON assignment_cleanup_backup_20260401;
DROP POLICY IF EXISTS "rls_v1_assignment_cleanup_backup_anon_deny" ON assignment_cleanup_backup_20260401;

CREATE POLICY "rls_v1_assignment_cleanup_backup_service_role_all"
  ON assignment_cleanup_backup_20260401 FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 備份表保守策略：authenticated 僅可讀，不可寫
CREATE POLICY "rls_v1_assignment_cleanup_backup_authenticated_select"
  ON assignment_cleanup_backup_20260401 FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "rls_v1_assignment_cleanup_backup_anon_deny"
  ON assignment_cleanup_backup_20260401 FOR ALL TO anon
  USING (false) WITH CHECK (false);
COMMIT;

-- 驗證
-- SELECT relrowsecurity FROM pg_class WHERE relname='assignment_cleanup_backup_20260401';
-- SELECT policyname, cmd, roles FROM pg_policies WHERE tablename='assignment_cleanup_backup_20260401' ORDER BY policyname;
-- 應用驗證：備份表不應有前台寫入流程


-- ============================================================
-- 上線後總驗證（一次檢查）
-- ============================================================
-- 1) 確認所有目標表 RLS 都是 ON
-- SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public'
--   AND c.relname IN (
--     'profiles',
--     'assignments',
--     'templates',
--     'campaign_department_publish',
--     'pharmacist_monthly_snapshot',
--     'pharmacist_snapshot_locks',
--     'stockout_product_response_history',
--     'logs',
--     'assignment_cleanup_backup_20260401'
--   )
-- ORDER BY c.relname;
--
-- 2) 確認每張表至少有 service_role + anon + authenticated/其它策略
-- SELECT tablename, policyname, cmd, roles
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'profiles',
--     'assignments',
--     'templates',
--     'campaign_department_publish',
--     'pharmacist_monthly_snapshot',
--     'pharmacist_snapshot_locks',
--     'stockout_product_response_history',
--     'logs',
--     'assignment_cleanup_backup_20260401'
--   )
-- ORDER BY tablename, policyname;
