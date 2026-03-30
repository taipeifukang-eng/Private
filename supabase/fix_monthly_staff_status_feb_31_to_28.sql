-- 修正 2026-02 每月人員狀態中「31/28」的異常資料
-- 僅更新指定 13 筆：work_days 改為 28，total_days_in_month 維持 28

BEGIN;

-- 1) 修正前檢查（應為 13 筆）
SELECT
  s.store_code,
  s.store_name,
  m.employee_code,
  m.employee_name,
  m.work_days,
  m.total_days_in_month,
  m.employment_type
FROM monthly_staff_status m
LEFT JOIN stores s ON s.id = m.store_id
WHERE m.year_month = '2026-02'
  AND m.work_days = 31
  AND m.total_days_in_month = 28
  AND (
    (s.store_code = '0020' AND m.employee_code IN ('FK0496', 'FK0545', 'FK0527', 'FK1039', 'FK1056'))
    OR
    (s.store_code = '0035' AND m.employee_code IN ('FK1073', 'FK0859', 'FK0718', 'FK0381', 'FK0962', 'FK1022', 'FK0743', 'FK1079'))
  )
ORDER BY s.store_code, m.employee_code;

-- 2) 只修正這 13 筆
UPDATE monthly_staff_status m
SET
  work_days = 28,
  updated_at = TIMEZONE('utc', NOW())
FROM stores s
WHERE s.id = m.store_id
  AND m.year_month = '2026-02'
  AND m.work_days = 31
  AND m.total_days_in_month = 28
  AND (
    (s.store_code = '0020' AND m.employee_code IN ('FK0496', 'FK0545', 'FK0527', 'FK1039', 'FK1056'))
    OR
    (s.store_code = '0035' AND m.employee_code IN ('FK1073', 'FK0859', 'FK0718', 'FK0381', 'FK0962', 'FK1022', 'FK0743', 'FK1079'))
  );

-- 3) 修正後檢查（應為 0 筆）
SELECT
  s.store_code,
  s.store_name,
  m.employee_code,
  m.employee_name,
  m.work_days,
  m.total_days_in_month,
  m.employment_type
FROM monthly_staff_status m
LEFT JOIN stores s ON s.id = m.store_id
WHERE m.year_month = '2026-02'
  AND m.work_days = 31
  AND m.total_days_in_month = 28
  AND (
    (s.store_code = '0020' AND m.employee_code IN ('FK0496', 'FK0545', 'FK0527', 'FK1039', 'FK1056'))
    OR
    (s.store_code = '0035' AND m.employee_code IN ('FK1073', 'FK0859', 'FK0718', 'FK0381', 'FK0962', 'FK1022', 'FK0743', 'FK1079'))
  )
ORDER BY s.store_code, m.employee_code;

COMMIT;
