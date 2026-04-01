-- 藥師月份快照同步記錄表
-- 用途：記錄每個 year_month 最後一次執行 ensureSnapshotForMonth() 的時間點。
-- 每次打開督導區總覽時，比對 employee_movement_history.created_at > last_synced_at，
-- 若無新增異動則直接跳過 ensureSnapshotForMonth() 的重算，加快快照查詢速度。

CREATE TABLE IF NOT EXISTS pharmacist_monthly_snapshot_sync_log (
  year_month     TEXT         PRIMARY KEY,  -- 格式: YYYY-MM
  last_synced_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 啟用 RLS（實際存取由 service_role adminClient 執行，不受 RLS 限制）
ALTER TABLE pharmacist_monthly_snapshot_sync_log ENABLE ROW LEVEL SECURITY;

-- service_role 完整存取（供 API adminClient 使用）
CREATE POLICY "service_role_all"
  ON pharmacist_monthly_snapshot_sync_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 說明：
-- year_month     = 年月字串（如 "2026-04"）
-- last_synced_at = 上次執行 ensureSnapshotForMonth() 的 UTC 時間戳
-- 判斷邏輯（page.tsx ensureSnapshotForMonth）：
--   1. 快照不存在（snapshotCount = 0）→ 一定執行全量生成
--   2. 快照存在 + last_synced_at 不存在 → 執行（首次或表剛建立）
--   3. 快照存在 + last_synced_at 存在：
--      SELECT count(*) FROM employee_movement_history
--      WHERE created_at > last_synced_at
--        AND store_id IN (storeIds)
--        AND movement_type IN ('resignation','onboarding','return_to_work',
--                              'store_transfer','promotion','leave_without_pay','leave_of_absence')
--        AND movement_date BETWEEN monthStart AND monthEnd
--      → count > 0 → 執行，完成後更新 last_synced_at
--      → count = 0 → 直接略過，回傳現有快照（最快路徑）
