-- ============================================================
-- 維修進度更新補登日期欄位
-- 說明：
--   progress_date = 進度紀錄日期（可由總務補登）
--   created_at    = 實際建立時間
-- ============================================================

ALTER TABLE maintenance_updates
ADD COLUMN IF NOT EXISTS progress_date DATE;

-- 舊資料回填為建立日（台北時區日期）
UPDATE maintenance_updates
SET progress_date = (created_at AT TIME ZONE 'Asia/Taipei')::date
WHERE progress_date IS NULL;

ALTER TABLE maintenance_updates
ALTER COLUMN progress_date SET NOT NULL;

ALTER TABLE maintenance_updates
ALTER COLUMN progress_date SET DEFAULT (now() AT TIME ZONE 'Asia/Taipei')::date;

CREATE INDEX IF NOT EXISTS idx_maintenance_updates_progress_date
ON maintenance_updates (progress_date DESC);
