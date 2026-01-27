-- 診斷到職日期更新問題
-- 檢查資料匹配情況

-- 1. 檢查 store_employees 中有到職日期的員工
SELECT 
  '1. store_employees 中有到職日期的員工' as 檢查項目,
  COUNT(*) as 數量
FROM store_employees
WHERE start_date IS NOT NULL;

-- 2. 檢查 monthly_staff_status 中的員工
SELECT 
  '2. monthly_staff_status 中的員工' as 檢查項目,
  COUNT(*) as 數量
FROM monthly_staff_status;

-- 3. 檢查 monthly_staff_status 中 start_date 為 NULL 的記錄
SELECT 
  '3. monthly_staff_status 中 start_date 為 NULL' as 檢查項目,
  COUNT(*) as 數量
FROM monthly_staff_status
WHERE start_date IS NULL;

-- 4. 檢查可以匹配的記錄（透過 user_id 和 store_id）
SELECT 
  '4. 可透過 user_id + store_id 匹配的記錄' as 檢查項目,
  COUNT(*) as 數量
FROM monthly_staff_status AS mss
JOIN store_employees AS se ON mss.user_id = se.user_id AND mss.store_id = se.store_id
WHERE mss.start_date IS NULL
  AND se.start_date IS NOT NULL;

-- 5. 檢查 monthly_staff_status 中 user_id 為 NULL 的記錄
SELECT 
  '5. monthly_staff_status 中 user_id 為 NULL' as 檢查項目,
  COUNT(*) as 數量
FROM monthly_staff_status
WHERE user_id IS NULL;

-- 6. 顯示範例資料：monthly_staff_status 的記錄
SELECT 
  '範例: monthly_staff_status' as 說明,
  employee_name,
  employee_code,
  user_id,
  store_id,
  start_date
FROM monthly_staff_status
LIMIT 5;

-- 7. 顯示範例資料：store_employees 的記錄
SELECT 
  '範例: store_employees' as 說明,
  employee_name,
  employee_code,
  user_id,
  store_id,
  start_date
FROM store_employees
WHERE start_date IS NOT NULL
LIMIT 5;
