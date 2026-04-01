-- 藥師年度主檔同步記錄表
-- 用途：記錄每個年度最後一次執行 syncAnnualMaster() 的時間點。
-- 每次打開藥師主檔時，比對 employee_movement_history.created_at > last_synced_at，
-- 若無新增異動則直接回傳快照，有新異動才重跑同步。

CREATE TABLE IF NOT EXISTS pharmacist_annual_master_sync_log (
  year         INTEGER      PRIMARY KEY,
  last_synced_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 啟用 RLS（實際存取由 service_role adminClient 執行，不受 RLS 限制）
ALTER TABLE pharmacist_annual_master_sync_log ENABLE ROW LEVEL SECURITY;

-- service_role 完整存取（供 API adminClient 使用）
CREATE POLICY "service_role_all"
  ON pharmacist_annual_master_sync_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 說明：
-- year           = 西元年（如 2026）
-- last_synced_at = 上次執行同步的 UTC 時間戳
-- 判斷邏輯（route.ts）：
--   SELECT count(*) FROM employee_movement_history
--   WHERE created_at > last_synced_at
--     AND movement_type IN ('resignation','leave_without_pay','leave_of_absence','return_to_work','onboarding')
--     AND movement_date BETWEEN yearStart AND today
--   → count > 0 → 執行 syncAnnualMaster() + UPDATE last_synced_at
--   → count = 0 → 略過同步，直接回傳現有主檔資料
