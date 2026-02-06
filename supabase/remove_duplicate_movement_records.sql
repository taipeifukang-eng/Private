-- 刪除重複的人員異動記錄
-- 保留每組重複記錄中最早創建的那一筆（根據 created_at）

-- 查看重複記錄（執行刪除前先查看）
SELECT 
  employee_code, 
  employee_name,
  movement_date, 
  movement_type,
  new_value,
  COUNT(*) as count
FROM employee_movement_history
GROUP BY employee_code, employee_name, movement_date, movement_type, new_value
HAVING COUNT(*) > 1
ORDER BY employee_code, movement_date;

-- 刪除重複記錄，保留最早創建的那一筆
WITH duplicates AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY employee_code, movement_date, movement_type 
      ORDER BY created_at ASC
    ) as row_num
  FROM employee_movement_history
)
DELETE FROM employee_movement_history
WHERE id IN (
  SELECT id 
  FROM duplicates 
  WHERE row_num > 1
);

-- 驗證：確認沒有重複記錄了
SELECT 
  employee_code, 
  employee_name,
  movement_date, 
  movement_type,
  new_value,
  COUNT(*) as count
FROM employee_movement_history
GROUP BY employee_code, employee_name, movement_date, movement_type, new_value
HAVING COUNT(*) > 1;
