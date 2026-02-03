-- 新增 is_from_file2 欄位到 monthly_performance_details
-- 用於標記該筆業績明細是否來自檔案2（處方加購回補）
-- 執行日期: 2026-02-03

ALTER TABLE monthly_performance_details
  ADD COLUMN IF NOT EXISTS is_from_file2 BOOLEAN DEFAULT FALSE;

-- 註解說明
COMMENT ON COLUMN monthly_performance_details.is_from_file2 IS '是否來自檔案2（處方加購回補）';
