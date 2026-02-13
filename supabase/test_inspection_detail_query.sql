-- 測試詳情頁的查詢
-- 檢查是否有 Foreign Key 歧義問題

-- 1. 檢查 inspection_results 表的 FK
SELECT
  tc.table_name, 
  kcu.column_name, 
  ccu.table_name AS foreign_table_name,
  ccu.column_name AS foreign_column_name,
  tc.constraint_name
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' 
  AND tc.table_name='inspection_results'
  AND ccu.table_name = 'inspection_templates';

-- 2. 測試主記錄查詢（最近一筆）
SELECT 
  id,
  store_id,
  inspector_id,
  inspection_date,
  status,
  total_score
FROM inspection_masters
ORDER BY created_at DESC
LIMIT 1;

-- 3. 測試詳情查詢（使用最近一筆的 ID）
-- 注意：需要替換 'RECORD_ID' 為實際的記錄 ID
-- SELECT 
--   ir.id,
--   ir.template_id,
--   ir.max_score,
--   ir.given_score,
--   it.section,
--   it.section_name,
--   it.item_name
-- FROM inspection_results ir
-- JOIN inspection_templates it ON ir.template_id = it.id
-- WHERE ir.inspection_id = 'RECORD_ID'
-- ORDER BY it.section_order, it.item_order;
