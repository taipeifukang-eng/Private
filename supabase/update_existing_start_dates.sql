-- 批量更新已存在的 monthly_staff_status 記錄的到職日期
-- 日期: 2026-01-25
-- 說明: 從 store_employees 表同步到職日期到 monthly_staff_status 表
-- 使用 employee_code + store_id 進行匹配（因為 user_id 可能為 NULL）

-- 執行更新並返回更新的記錄
WITH updated AS (
  UPDATE monthly_staff_status AS mss
  SET start_date = se.start_date
  FROM store_employees AS se
  WHERE mss.employee_code = se.employee_code
    AND mss.store_id = se.store_id
    AND mss.start_date IS NULL
    AND se.start_date IS NOT NULL
  RETURNING mss.id, mss.employee_name, mss.employee_code, mss.start_date
)
SELECT 
  COUNT(*) as 更新筆數,
  STRING_AGG(employee_name || ' (' || COALESCE(employee_code, 'N/A') || ')', ', ') as 更新的員工
FROM updated;
