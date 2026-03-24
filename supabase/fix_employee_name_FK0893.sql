-- ============================================================
-- 修正員工 FK0893 姓名：吳姵瑀 → 吳珮瑀
-- 執行環境：Supabase SQL 編輯器（需使用 Service Role 或 Dashboard）
-- 建立日期：2026-03-24
-- ============================================================

-- 【步驟 1】先查詢確認目前資料庫中有哪些地方有「吳姵瑀」
SELECT 'profiles' AS table_name, full_name AS current_name, employee_code
FROM profiles
WHERE employee_code = 'FK0893'
UNION ALL
SELECT 'store_employees', employee_name, employee_code
FROM store_employees
WHERE employee_code = 'FK0893'
UNION ALL
SELECT 'monthly_staff_status', employee_name, employee_code
FROM monthly_staff_status
WHERE employee_code = 'FK0893'
UNION ALL
SELECT 'employee_movement_history', employee_name, employee_code
FROM employee_movement_history
WHERE employee_code = 'FK0893'
UNION ALL
SELECT 'support_staff_bonus', employee_name, employee_code
FROM support_staff_bonus
WHERE employee_code = 'FK0893'
UNION ALL
SELECT 'meal_allowance_records', employee_name, employee_code
FROM meal_allowance_records
WHERE employee_code = 'FK0893'
UNION ALL
SELECT 'spring_festival_bonus', employee_name, employee_code
FROM spring_festival_bonus
WHERE employee_code = 'FK0893'
UNION ALL
SELECT 'talent_cultivation_bonus', employee_name, employee_code
FROM talent_cultivation_bonus
WHERE employee_code = 'FK0893'
UNION ALL
SELECT 'campaign_store_own_staff', employee_name, employee_code
FROM campaign_store_own_staff
WHERE employee_code = 'FK0893'
UNION ALL
SELECT 'campaign_support_staff', employee_name, employee_code
FROM campaign_support_staff
WHERE employee_code = 'FK0893';


-- ============================================================
-- 【步驟 2】確認查詢結果無誤後，執行以下 UPDATE 語句
-- ============================================================

-- 1. profiles 主帳號
UPDATE profiles
SET full_name = '吳珮瑀', updated_at = NOW()
WHERE employee_code = 'FK0893'
  AND full_name = '吳姵瑀';

-- 2. store_employees 門市員工表
UPDATE store_employees
SET employee_name = '吳珮瑀'
WHERE employee_code = 'FK0893'
  AND employee_name = '吳姵瑀';

-- 3. monthly_staff_status 每月人員狀態
UPDATE monthly_staff_status
SET employee_name = '吳珮瑀'
WHERE employee_code = 'FK0893'
  AND employee_name = '吳姵瑀';

-- 4. employee_movement_history 員工異動歷程
UPDATE employee_movement_history
SET employee_name = '吳珮瑀'
WHERE employee_code = 'FK0893'
  AND employee_name = '吳姵瑀';

-- 5. support_staff_bonus 支援員工獎金
UPDATE support_staff_bonus
SET employee_name = '吳珮瑀'
WHERE employee_code = 'FK0893'
  AND employee_name = '吳姵瑀';

-- 7. meal_allowance_records 餐費補貼記錄
UPDATE meal_allowance_records
SET employee_name = '吳珮瑀'
WHERE employee_code = 'FK0893'
  AND employee_name = '吳姵瑀';

-- 8. spring_festival_bonus 年節獎金
UPDATE spring_festival_bonus
SET employee_name = '吳珮瑀'
WHERE employee_code = 'FK0893'
  AND employee_name = '吳姵瑀';

-- 9. talent_cultivation_bonus 人才培育獎金
UPDATE talent_cultivation_bonus
SET employee_name = '吳珮瑀'
WHERE employee_code = 'FK0893'
  AND employee_name = '吳姵瑀';

-- 10. campaign_store_own_staff 活動本店人員
UPDATE campaign_store_own_staff
SET employee_name = '吳珮瑀'
WHERE employee_code = 'FK0893'
  AND employee_name = '吳姵瑀';

-- 11. campaign_support_staff 活動支援人員
UPDATE campaign_support_staff
SET employee_name = '吳珮瑀'
WHERE employee_code = 'FK0893'
  AND employee_name = '吳姵瑀';

-- ============================================================
-- 【步驟 3】執行後再次查詢確認已全部更新
-- ============================================================

SELECT 'profiles' AS table_name, full_name AS updated_name, employee_code
FROM profiles
WHERE employee_code = 'FK0893'
UNION ALL
SELECT 'store_employees', employee_name, employee_code
FROM store_employees
WHERE employee_code = 'FK0893'
UNION ALL
SELECT 'monthly_staff_status', employee_name, employee_code
FROM monthly_staff_status
WHERE employee_code = 'FK0893'
UNION ALL
SELECT 'employee_movement_history', employee_name, employee_code
FROM employee_movement_history
WHERE employee_code = 'FK0893';
