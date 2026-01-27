-- 檢查 monthly_store_summary 表的欄位
-- 用於診斷門市統計資料匯入問題

-- 1. 檢查表是否存在
SELECT 
  table_name,
  table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'monthly_store_summary';

-- 2. 列出所有欄位
SELECT 
  column_name,
  data_type,
  character_maximum_length,
  numeric_precision,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'monthly_store_summary'
ORDER BY ordinal_position;

-- 3. 檢查是否有統計資料欄位
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'monthly_store_summary' 
        AND column_name = 'total_staff_count'
    ) THEN '✓ total_staff_count 存在'
    ELSE '✗ total_staff_count 不存在 - 需要執行 migration'
  END as check_total_staff_count,
  
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'monthly_store_summary' 
        AND column_name = 'store_code'
    ) THEN '✓ store_code 存在'
    ELSE '✗ store_code 不存在 - 需要執行 migration'
  END as check_store_code,
  
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'monthly_store_summary' 
        AND column_name = 'business_days'
    ) THEN '✓ business_days 存在'
    ELSE '✗ business_days 不存在 - 需要執行 migration'
  END as check_business_days,
  
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'monthly_store_summary' 
        AND column_name = 'total_gross_profit'
    ) THEN '✓ total_gross_profit 存在'
    ELSE '✗ total_gross_profit 不存在 - 需要執行 migration'
  END as check_total_gross_profit;

-- 4. 查看 monthly_store_summary 的範例數據
SELECT 
  id,
  year_month,
  store_id,
  store_name,
  store_code,
  total_staff_count,
  business_days,
  total_gross_profit,
  total_customer_count
FROM monthly_store_summary
ORDER BY year_month DESC, store_code
LIMIT 5;
