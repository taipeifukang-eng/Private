-- ========================================================
-- 初始化 2026 年度藥師主檔
-- 執行日期：2026-03-31
-- 用途：從現有資料建立 2026 年藥師年度主檔
-- ========================================================

-- 注意：請先執行 migration_pharmacist_annual_master.sql 建立表結構

-- 1. 檢查表是否存在
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'pharmacist_annual_master') THEN
    RAISE EXCEPTION '請先執行 migration_pharmacist_annual_master.sql 建立表結構';
  END IF;
END $$;

-- 2. 從 store_employees 收集藥師（主要來源）
WITH store_emp_pharmacists AS (
  SELECT DISTINCT ON (UPPER(employee_code))
    UPPER(employee_code) AS employee_code,
    store_id,
    COALESCE(current_position, position) AS current_position,
    start_date,
    is_active
  FROM store_employees
  WHERE is_pharmacist = true
    AND employee_code IS NOT NULL
  ORDER BY UPPER(employee_code), is_active DESC, start_date DESC NULLS LAST
),

-- 3. 從 employee_movement_history 收集入職且為藥師的人員
onboarding_pharmacists AS (
  SELECT DISTINCT ON (UPPER(employee_code))
    UPPER(employee_code) AS employee_code,
    employee_name,
    store_id,
    movement_date AS join_date
  FROM employee_movement_history
  WHERE movement_type = 'onboarding'
    AND onboarding_is_pharmacist = true
    AND employee_code IS NOT NULL
    AND movement_date >= '2026-01-01'
  ORDER BY UPPER(employee_code), movement_date DESC
),

-- 4. 從 monthly_staff_status 補充藥師（可能在月報有但 store_employees 沒有）
monthly_pharmacists AS (
  SELECT DISTINCT ON (UPPER(employee_code))
    UPPER(employee_code) AS employee_code,
    employee_name,
    store_id,
    COALESCE(position, '藥師') AS current_position,
    start_date
  FROM monthly_staff_status
  WHERE is_pharmacist = true
    AND employee_code IS NOT NULL
    AND year_month >= '2026-01'
  ORDER BY UPPER(employee_code), year_month DESC
),

-- 5. 從異動紀錄判斷離職狀態
resignation_info AS (
  SELECT DISTINCT ON (UPPER(employee_code))
    UPPER(employee_code) AS employee_code,
    movement_date AS resignation_date
  FROM employee_movement_history
  WHERE movement_type = 'resignation'
    AND employee_code IS NOT NULL
    AND movement_date >= '2026-01-01'
  ORDER BY UPPER(employee_code), movement_date DESC
),

-- 6. 從異動紀錄判斷留職停薪狀態
suspension_info AS (
  SELECT DISTINCT ON (UPPER(employee_code))
    UPPER(employee_code) AS employee_code,
    movement_date AS suspension_date
  FROM employee_movement_history
  WHERE movement_type = 'leave_without_pay'
    AND employee_code IS NOT NULL
    AND movement_date >= '2026-01-01'
  ORDER BY UPPER(employee_code), movement_date DESC
),

-- 7. 從異動紀錄判斷復職日期
return_info AS (
  SELECT DISTINCT ON (UPPER(employee_code))
    UPPER(employee_code) AS employee_code,
    movement_date AS return_date
  FROM employee_movement_history
  WHERE movement_type = 'return_to_work'
    AND employee_code IS NOT NULL
    AND movement_date >= '2026-01-01'
  ORDER BY UPPER(employee_code), movement_date DESC
),

-- 8. 從 profiles 和 monthly_staff_status 取得姓名
name_lookup AS (
  SELECT employee_code, full_name AS employee_name
  FROM profiles
  WHERE employee_code IS NOT NULL
  UNION
  SELECT * FROM (
    SELECT DISTINCT ON (UPPER(employee_code))
      UPPER(employee_code) AS employee_code,
      employee_name
    FROM monthly_staff_status
    WHERE employee_code IS NOT NULL
      AND employee_name IS NOT NULL
    ORDER BY UPPER(employee_code), year_month DESC
  ) mss_names
  UNION
  SELECT * FROM (
    SELECT DISTINCT ON (UPPER(employee_code))
      UPPER(employee_code) AS employee_code,
      employee_name
    FROM employee_movement_history
    WHERE employee_code IS NOT NULL
      AND employee_name IS NOT NULL
    ORDER BY UPPER(employee_code), movement_date DESC
  ) emh_names
),

-- 9. 合併所有藥師員編
all_pharmacist_codes AS (
  SELECT employee_code FROM store_emp_pharmacists
  UNION
  SELECT employee_code FROM onboarding_pharmacists
  UNION
  SELECT employee_code FROM monthly_pharmacists
),

-- 10. 整合資料
combined_data AS (
  SELECT
    apc.employee_code,
    COALESCE(
      nl.employee_name,
      op.employee_name,
      mp.employee_name
    ) AS employee_name,
    COALESCE(sep.store_id, op.store_id, mp.store_id) AS current_store_id,
    COALESCE(sep.current_position, mp.current_position, '藥師') AS current_position,
    COALESCE(sep.start_date, op.join_date, mp.start_date) AS join_date,
    ri.resignation_date,
    si.suspension_date,
    rti.return_date,
    COALESCE(sep.is_active, true) AS base_is_active
  FROM all_pharmacist_codes apc
  LEFT JOIN store_emp_pharmacists sep ON sep.employee_code = apc.employee_code
  LEFT JOIN onboarding_pharmacists op ON op.employee_code = apc.employee_code
  LEFT JOIN monthly_pharmacists mp ON mp.employee_code = apc.employee_code
  LEFT JOIN resignation_info ri ON ri.employee_code = apc.employee_code
  LEFT JOIN suspension_info si ON si.employee_code = apc.employee_code
  LEFT JOIN return_info rti ON rti.employee_code = apc.employee_code
  LEFT JOIN (
    SELECT DISTINCT ON (UPPER(employee_code)) 
      UPPER(employee_code) AS employee_code, 
      employee_name 
    FROM name_lookup 
    WHERE employee_name IS NOT NULL
  ) nl ON nl.employee_code = apc.employee_code
)

-- 11. 插入年度主檔
INSERT INTO pharmacist_annual_master (
  year,
  employee_code,
  employee_name,
  status,
  status_date,
  join_date,
  resignation_date,
  current_store_id,
  current_position,
  source,
  notes
)
SELECT
  2026 AS year,
  cd.employee_code,
  cd.employee_name,
  -- 判斷狀態優先順序：復職 > 留停 > 離職 > 在職
  CASE
    -- 有復職且復職日期 >= 離職/留停日期 => active
    WHEN cd.return_date IS NOT NULL 
         AND (cd.resignation_date IS NULL OR cd.return_date >= cd.resignation_date)
         AND (cd.suspension_date IS NULL OR cd.return_date >= cd.suspension_date)
    THEN 'active'
    -- 有留停且留停日期 >= 離職日期 => suspended
    WHEN cd.suspension_date IS NOT NULL 
         AND (cd.resignation_date IS NULL OR cd.suspension_date >= cd.resignation_date)
    THEN 'suspended'
    -- 有離職 => resigned
    WHEN cd.resignation_date IS NOT NULL
    THEN 'resigned'
    -- 預設在職
    ELSE 'active'
  END AS status,
  -- 狀態日期
  CASE
    WHEN cd.return_date IS NOT NULL 
         AND (cd.resignation_date IS NULL OR cd.return_date >= cd.resignation_date)
         AND (cd.suspension_date IS NULL OR cd.return_date >= cd.suspension_date)
    THEN cd.return_date
    WHEN cd.suspension_date IS NOT NULL 
         AND (cd.resignation_date IS NULL OR cd.suspension_date >= cd.resignation_date)
    THEN cd.suspension_date
    WHEN cd.resignation_date IS NOT NULL
    THEN cd.resignation_date
    ELSE cd.join_date
  END AS status_date,
  cd.join_date,
  cd.resignation_date,
  cd.current_store_id,
  cd.current_position,
  'initial' AS source,
  '2026-03-31 初始化建立' AS notes
FROM combined_data cd
ON CONFLICT (year, employee_code) DO UPDATE SET
  employee_name = COALESCE(EXCLUDED.employee_name, pharmacist_annual_master.employee_name),
  status = EXCLUDED.status,
  status_date = EXCLUDED.status_date,
  resignation_date = EXCLUDED.resignation_date,
  current_store_id = COALESCE(EXCLUDED.current_store_id, pharmacist_annual_master.current_store_id),
  current_position = COALESCE(EXCLUDED.current_position, pharmacist_annual_master.current_position),
  updated_at = NOW();

-- 12. 驗證結果
DO $$
DECLARE
  v_total INT;
  v_active INT;
  v_resigned INT;
  v_suspended INT;
BEGIN
  SELECT COUNT(*) INTO v_total FROM pharmacist_annual_master WHERE year = 2026;
  SELECT COUNT(*) INTO v_active FROM pharmacist_annual_master WHERE year = 2026 AND status = 'active';
  SELECT COUNT(*) INTO v_resigned FROM pharmacist_annual_master WHERE year = 2026 AND status = 'resigned';
  SELECT COUNT(*) INTO v_suspended FROM pharmacist_annual_master WHERE year = 2026 AND status = 'suspended';
  
  RAISE NOTICE '========================================';
  RAISE NOTICE '✓ 2026 年度藥師主檔初始化完成';
  RAISE NOTICE '  總人數：%', v_total;
  RAISE NOTICE '  在職：%', v_active;
  RAISE NOTICE '  離職：%', v_resigned;
  RAISE NOTICE '  留停：%', v_suspended;
  RAISE NOTICE '========================================';
END $$;

-- 13. 顯示初始化結果
SELECT 
  pam.employee_code,
  pam.employee_name,
  pam.status,
  pam.status_date,
  pam.join_date,
  pam.resignation_date,
  s.store_code,
  s.store_name,
  pam.current_position,
  pam.source
FROM pharmacist_annual_master pam
LEFT JOIN stores s ON s.id = pam.current_store_id
WHERE pam.year = 2026
ORDER BY pam.status, pam.employee_code
LIMIT 50;
