-- 盤點結果分析報表：同檔名覆蓋，不同檔名允許同單位重複匯入
-- 日期: 2026-07-14

ALTER TABLE inventory_result_batches
DROP CONSTRAINT IF EXISTS inventory_result_batches_store_year_month_order_key;

ALTER TABLE inventory_result_batches
DROP CONSTRAINT IF EXISTS inventory_result_batches_store_id_inventory_order_no_key;

DROP INDEX IF EXISTS idx_inventory_result_batches_store_order_unique;

CREATE INDEX IF NOT EXISTS idx_inventory_result_batches_year_month_file
  ON inventory_result_batches(year_month, source_file_name);

COMMENT ON INDEX idx_inventory_result_batches_year_month_file
  IS '盤點結果分析報表同年月同檔名覆蓋查詢索引';
