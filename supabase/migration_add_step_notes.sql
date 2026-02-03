-- 新增步驟備註欄位
-- 允許使用者在完成任務步驟時添加備註說明
-- 執行日期: 2026-02-03

-- 在 logs 表添加備註欄位
ALTER TABLE logs
  ADD COLUMN IF NOT EXISTS note TEXT;

-- 註解說明
COMMENT ON COLUMN logs.note IS '步驟完成時的備註說明';
