-- ========================================================
-- 檢查並修正新入職藥師資料
-- 問題：FK1103、FK1100 等新入職藥師未出現在年度主檔
-- ========================================================

-- 1. 檢查 FK1103、FK1100 在各資料表的狀態
SELECT '=== employee_movement_history ===' AS source;
SELECT 
  employee_code, 
  employee_name, 
  movement_type, 
  movement_date,
  onboarding_is_pharmacist,
  store_id
FROM employee_movement_history
WHERE employee_code IN ('FK1103', 'FK1100')
ORDER BY employee_code, movement_date;

SELECT '=== store_employees ===' AS source;
SELECT 
  employee_code, 
  is_pharmacist, 
  current_position,
  start_date,
  is_active
FROM store_employees
WHERE employee_code IN ('FK1103', 'FK1100');

SELECT '=== monthly_staff_status ===' AS source;
SELECT 
  employee_code, 
  employee_name,
  is_pharmacist, 
  position,
  year_month
FROM monthly_staff_status
WHERE employee_code IN ('FK1103', 'FK1100')
ORDER BY year_month DESC
LIMIT 10;

SELECT '=== pharmacist_annual_master ===' AS source;
SELECT * FROM pharmacist_annual_master
WHERE employee_code IN ('FK1103', 'FK1100');

-- 2. 檢查目前年度主檔有多少筆
SELECT 
  year,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE status = 'active') AS active_count,
  COUNT(*) FILTER (WHERE status = 'resigned') AS resigned_count,
  COUNT(*) FILTER (WHERE status = 'suspended') AS suspended_count
FROM pharmacist_annual_master
GROUP BY year;

-- ========================================================
-- 如果 FK1103、FK1100 的 onboarding_is_pharmacist 是 false，
-- 執行以下 UPDATE 來修正：
-- ========================================================

-- 3. 修正 employee_movement_history 的 onboarding_is_pharmacist
UPDATE employee_movement_history
SET onboarding_is_pharmacist = true
WHERE employee_code IN ('FK1103', 'FK1100')
  AND movement_type = 'onboarding'
  AND onboarding_is_pharmacist = false;

-- 4. 修正 store_employees 的 is_pharmacist（如果存在）
UPDATE store_employees
SET is_pharmacist = true
WHERE employee_code IN ('FK1103', 'FK1100')
  AND is_pharmacist = false;

-- 5. 手動新增到 2026 年度主檔（如果上面修正後仍未出現）
INSERT INTO pharmacist_annual_master (
  year,
  employee_code,
  employee_name,
  status,
  status_date,
  join_date,
  current_store_id,
  current_position,
  source,
  notes
)
SELECT
  2026,
  emh.employee_code,
  emh.employee_name,
  'active',
  emh.movement_date,
  emh.movement_date,
  emh.store_id,
  '藥師',
  'onboarding',
  '手動補入 - 新入職藥師'
FROM employee_movement_history emh
WHERE emh.employee_code IN ('FK1103', 'FK1100')
  AND emh.movement_type = 'onboarding'
  AND NOT EXISTS (
    SELECT 1 FROM pharmacist_annual_master pam
    WHERE pam.year = 2026 AND pam.employee_code = emh.employee_code
  )
ON CONFLICT (year, employee_code) DO NOTHING;

-- 6. 驗證結果
SELECT 
  pam.employee_code,
  pam.employee_name,
  pam.status,
  pam.join_date,
  s.store_code,
  pam.current_position,
  pam.source
FROM pharmacist_annual_master pam
LEFT JOIN stores s ON s.id = pam.current_store_id
WHERE pam.year = 2026
  AND pam.employee_code IN ('FK1103', 'FK1100');
