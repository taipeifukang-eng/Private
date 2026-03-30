-- =====================================================
-- 查詢 1~2 月每月人員狀態中重複列到的人員
-- (同一個月內，同一人員出現在多個門市)
-- =====================================================

-- 1月份重複人員
SELECT 
  '2026-01' as 月份,
  mss.employee_code as 員編,
  mss.employee_name as 姓名,
  STRING_AGG(DISTINCT s.store_name, ', ') as 所屬門市,
  COUNT(DISTINCT mss.store_id) as 門市數量,
  STRING_AGG(
    mss.monthly_status || ' (' || 
    CASE 
      WHEN mss.employment_type = 'full_time' THEN COALESCE(mss.work_days::text, '0') || '天'
      WHEN mss.employment_type = 'part_time' THEN COALESCE(mss.work_hours::text, '0') || '時'
      ELSE ''
    END || ')',
    '; '
  ) as 狀態詳情
FROM monthly_staff_status mss
JOIN stores s ON mss.store_id = s.id
WHERE mss.year_month = '2026-01'
GROUP BY mss.user_id, mss.employee_code, mss.employee_name
HAVING COUNT(DISTINCT mss.store_id) > 1
ORDER BY mss.employee_code

UNION ALL

-- 2月份重複人員
SELECT 
  '2026-02' as 月份,
  mss.employee_code as 員編,
  mss.employee_name as 姓名,
  STRING_AGG(DISTINCT s.store_name, ', ') as 所屬門市,
  COUNT(DISTINCT mss.store_id) as 門市數量,
  STRING_AGG(
    mss.monthly_status || ' (' || 
    CASE 
      WHEN mss.employment_type = 'full_time' THEN COALESCE(mss.work_days::text, '0') || '天'
      WHEN mss.employment_type = 'part_time' THEN COALESCE(mss.work_hours::text, '0') || '時'
      ELSE ''
    END || ')',
    '; '
  ) as 狀態詳情
FROM monthly_staff_status mss
JOIN stores s ON mss.store_id = s.id
WHERE mss.year_month = '2026-02'
GROUP BY mss.user_id, mss.employee_code, mss.employee_name
HAVING COUNT(DISTINCT mss.store_id) > 1
ORDER BY mss.employee_code;


-- =====================================================
-- 詳細版本：顯示每個門市的詳細資訊
-- =====================================================

-- 1月份詳細資料
SELECT 
  '2026-01' as 月份,
  mss.employee_code as 員編,
  mss.employee_name as 姓名,
  s.store_name as 門市,
  mss.monthly_status as 本月狀態,
  CASE 
    WHEN mss.employment_type = 'full_time' THEN COALESCE(mss.work_days::text, '0') || '天'
    WHEN mss.employment_type = 'part_time' THEN COALESCE(mss.work_hours::text, '0') || '時'
    ELSE ''
  END as 天數時數,
  mss.position as 職位,
  mss.employment_type as 雇用類型
FROM monthly_staff_status mss
JOIN stores s ON mss.store_id = s.id
WHERE mss.year_month = '2026-01'
  AND mss.user_id IN (
    -- 找出在1月有多個門市記錄的 user_id
    SELECT user_id 
    FROM monthly_staff_status 
    WHERE year_month = '2026-01'
    GROUP BY user_id 
    HAVING COUNT(DISTINCT store_id) > 1
  )
ORDER BY mss.employee_code, s.store_name

UNION ALL

-- 2月份詳細資料
SELECT 
  '2026-02' as 月份,
  mss.employee_code as 員編,
  mss.employee_name as 姓名,
  s.store_name as 門市,
  mss.monthly_status as 本月狀態,
  CASE 
    WHEN mss.employment_type = 'full_time' THEN COALESCE(mss.work_days::text, '0') || '天'
    WHEN mss.employment_type = 'part_time' THEN COALESCE(mss.work_hours::text, '0') || '時'
    ELSE ''
  END as 天數時數,
  mss.position as 職位,
  mss.employment_type as 雇用類型
FROM monthly_staff_status mss
JOIN stores s ON mss.store_id = s.id
WHERE mss.year_month = '2026-02'
  AND mss.user_id IN (
    -- 找出在2月有多個門市記錄的 user_id
    SELECT user_id 
    FROM monthly_staff_status 
    WHERE year_month = '2026-02'
    GROUP BY user_id 
    HAVING COUNT(DISTINCT store_id) > 1
  )
ORDER BY mss.employee_code, s.store_name;
