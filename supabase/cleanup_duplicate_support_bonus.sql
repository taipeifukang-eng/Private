-- 清理 support_staff_bonus 表中的重複資料
-- 保留每個員工每個月份最新的一筆記錄

-- 1. 查看重複資料
SELECT 
  year_month,
  employee_code,
  employee_name,
  COUNT(*) as count,
  ARRAY_AGG(id ORDER BY created_at DESC) as ids
FROM support_staff_bonus
GROUP BY year_month, employee_code, employee_name
HAVING COUNT(*) > 1
ORDER BY year_month DESC, employee_code;

-- 2. 刪除重複資料（保留最新的一筆）
WITH duplicate_records AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY year_month, employee_code 
      ORDER BY created_at DESC
    ) as rn
  FROM support_staff_bonus
)
DELETE FROM support_staff_bonus
WHERE id IN (
  SELECT id 
  FROM duplicate_records 
  WHERE rn > 1
);

-- 3. 驗證清理結果
SELECT 
  year_month,
  employee_code,
  employee_name,
  COUNT(*) as count
FROM support_staff_bonus
GROUP BY year_month, employee_code, employee_name
HAVING COUNT(*) > 1;
