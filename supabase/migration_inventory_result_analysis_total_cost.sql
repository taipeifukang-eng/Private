-- 盤點結果分析報表：新增成本合計
-- 日期: 2026-07-08

ALTER TABLE inventory_result_batches
ADD COLUMN IF NOT EXISTS total_cost NUMERIC(14,2) DEFAULT 0;

COMMENT ON COLUMN inventory_result_batches.total_cost IS '成本合計：盤差量 * 單位成本';
