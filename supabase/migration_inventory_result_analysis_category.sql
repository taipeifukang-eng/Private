-- 盤點結果分析報表：品號分類統計
-- 日期: 2026-07-08

ALTER TABLE inventory_result_items
ADD COLUMN IF NOT EXISTS category_code VARCHAR(2),
ADD COLUMN IF NOT EXISTS category_name TEXT;

COMMENT ON COLUMN inventory_result_items.category_code IS '品號前兩碼分類碼';
COMMENT ON COLUMN inventory_result_items.category_name IS '品號分類名稱';
