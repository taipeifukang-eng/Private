-- ============================================================
-- 批量修正小寫員編為大寫
-- 說明: 將所有表中的小寫員編統一轉換為大寫格式
-- 執行日期: 2026-02-02
-- ============================================================

-- 開始事務
BEGIN;

-- 1. 更新 store_employees 表的員編
UPDATE store_employees
SET employee_code = UPPER(employee_code)
WHERE employee_code IS NOT NULL
  AND employee_code != UPPER(employee_code)
  AND employee_code ~ '^[Ff][Kk]';  -- 只更新 FK 開頭的員編

-- 記錄影響行數
DO $$
DECLARE
  affected_rows INTEGER;
BEGIN
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RAISE NOTICE '✅ store_employees: 更新了 % 筆員編', affected_rows;
END $$;

-- 2. 更新 monthly_staff_status 表的員編
UPDATE monthly_staff_status
SET employee_code = UPPER(employee_code)
WHERE employee_code IS NOT NULL
  AND employee_code != UPPER(employee_code)
  AND employee_code ~ '^[Ff][Kk]';

DO $$
DECLARE
  affected_rows INTEGER;
BEGIN
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RAISE NOTICE '✅ monthly_staff_status: 更新了 % 筆員編', affected_rows;
END $$;

-- 3. 更新 monthly_staff_status 表的督導員編
UPDATE monthly_staff_status
SET supervisor_employee_code = UPPER(supervisor_employee_code)
WHERE supervisor_employee_code IS NOT NULL
  AND supervisor_employee_code != UPPER(supervisor_employee_code)
  AND supervisor_employee_code ~ '^[Ff][Kk]';

DO $$
DECLARE
  affected_rows INTEGER;
BEGIN
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RAISE NOTICE '✅ monthly_staff_status (督導員編): 更新了 % 筆', affected_rows;
END $$;

-- 4. 更新 meal_allowance_records 表的員編
UPDATE meal_allowance_records
SET employee_code = UPPER(employee_code)
WHERE employee_code IS NOT NULL
  AND employee_code != UPPER(employee_code)
  AND employee_code ~ '^[Ff][Kk]';

DO $$
DECLARE
  affected_rows INTEGER;
BEGIN
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RAISE NOTICE '✅ meal_allowance_records: 更新了 % 筆', affected_rows;
END $$;

-- 5. 更新 profiles 表的員編（如果有的話）
UPDATE profiles
SET employee_code = UPPER(employee_code)
WHERE employee_code IS NOT NULL
  AND employee_code != UPPER(employee_code)
  AND employee_code ~ '^[Ff][Kk]';

DO $$
DECLARE
  affected_rows INTEGER;
BEGIN
  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RAISE NOTICE '✅ profiles: 更新了 % 筆員編', affected_rows;
END $$;

-- 提交事務
COMMIT;

-- ============================================================
-- 驗證結果：檢查是否還有小寫員編
-- ============================================================

SELECT 
  '檢查結果' as 說明,
  'store_employees' as 表名,
  COUNT(*) as 剩餘小寫員編數量
FROM store_employees
WHERE employee_code IS NOT NULL
  AND employee_code != UPPER(employee_code)
  AND employee_code ~ '^[Ff][Kk]'

UNION ALL

SELECT 
  '檢查結果',
  'monthly_staff_status',
  COUNT(*)
FROM monthly_staff_status
WHERE employee_code IS NOT NULL
  AND employee_code != UPPER(employee_code)
  AND employee_code ~ '^[Ff][Kk]'

UNION ALL

SELECT 
  '檢查結果',
  'meal_allowance_records',
  COUNT(*)
FROM meal_allowance_records
WHERE employee_code IS NOT NULL
  AND employee_code != UPPER(employee_code)
  AND employee_code ~ '^[Ff][Kk]'

UNION ALL

SELECT 
  '檢查結果',
  'profiles',
  COUNT(*)
FROM profiles
WHERE employee_code IS NOT NULL
  AND employee_code != UPPER(employee_code)
  AND employee_code ~ '^[Ff][Kk]';

-- ============================================================
-- 顯示更新後的範例資料
-- ============================================================

SELECT 
  '更新後範例' as 說明,
  employee_code,
  employee_name,
  store_id
FROM store_employees
WHERE employee_code ~ '^FK'
ORDER BY employee_code
LIMIT 10;
