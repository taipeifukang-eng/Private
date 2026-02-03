-- ============================================================
-- 允許 store_employees 表的 store_id 欄位為 NULL
-- 說明: 支援全域員工（不綁定特定門市的員工）
-- 執行日期: 2026-02-03
-- ============================================================

-- 1. 移除 store_id 的 NOT NULL 約束
ALTER TABLE store_employees 
ALTER COLUMN store_id DROP NOT NULL;

-- 2. 為現有數據添加註釋說明
COMMENT ON COLUMN store_employees.store_id IS '門市 ID（可為 NULL，表示全域員工，未分配到特定門市）';

-- 3. 驗證變更
-- 查詢沒有門市的員工數量
SELECT COUNT(*) as global_employees_count
FROM store_employees 
WHERE store_id IS NULL;
