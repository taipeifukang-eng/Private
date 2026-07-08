-- 盤點結果分析報表：新增資料年月
-- 日期: 2026-07-08

ALTER TABLE inventory_result_batches
ADD COLUMN IF NOT EXISTS year_month VARCHAR(7);

UPDATE inventory_result_batches
SET year_month = to_char(imported_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM')
WHERE year_month IS NULL;

ALTER TABLE inventory_result_batches
ALTER COLUMN year_month SET NOT NULL;

DROP INDEX IF EXISTS idx_inventory_result_batches_store_order_unique;

ALTER TABLE inventory_result_batches
DROP CONSTRAINT IF EXISTS inventory_result_batches_store_id_inventory_order_no_key;

ALTER TABLE inventory_result_batches
ADD CONSTRAINT inventory_result_batches_store_year_month_order_key
UNIQUE(store_id, year_month, inventory_order_no);

CREATE INDEX IF NOT EXISTS idx_inventory_result_batches_year_month ON inventory_result_batches(year_month);

COMMENT ON COLUMN inventory_result_batches.year_month IS '盤點結果資料年月，格式 YYYY-MM';
