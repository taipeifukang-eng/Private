-- 唯讀檢查：2026 藥師主檔漏同步（只查詢，不修改任何資料）
WITH lock AS (
  SELECT EXISTS (SELECT 1 FROM pharmacist_annual_master_locks WHERE year = 2026) AS locked
),
missing AS (
  -- A. 今年入職且是藥師、生效日已到，但不在 2026 主檔
  SELECT 'A_未入主檔' AS issue, m.employee_code, m.employee_name,
         m.movement_date::text AS movement_date, m.created_at::text AS registered_at,
         NULL::text AS master_status, 'active' AS expected_status
  FROM employee_movement_history m
  WHERE m.movement_type = 'onboarding' AND m.onboarding_is_pharmacist = true
    AND m.movement_date BETWEEN '2026-01-01' AND CURRENT_DATE
    AND NOT EXISTS (SELECT 1 FROM pharmacist_annual_master a
                    WHERE a.year = 2026 AND upper(a.employee_code) = upper(m.employee_code))
),
latest AS (
  -- B. 主檔內人員：今年生效日已到的最新一筆狀態異動
  SELECT DISTINCT ON (upper(m.employee_code))
         upper(m.employee_code) AS code, m.movement_type, m.movement_date, m.created_at
  FROM employee_movement_history m
  WHERE m.movement_type IN ('resignation', 'leave_without_pay', 'return_to_work')
    AND m.movement_date BETWEEN '2026-01-01' AND CURRENT_DATE
  ORDER BY upper(m.employee_code), m.movement_date DESC, m.created_at DESC
),
mismatch AS (
  SELECT 'B_狀態不符' AS issue, a.employee_code, a.employee_name,
         l.movement_date::text, l.created_at::text,
         a.status,
         CASE l.movement_type WHEN 'resignation' THEN 'resigned'
                              WHEN 'leave_without_pay' THEN 'suspended'
                              ELSE 'active' END
  FROM pharmacist_annual_master a
  JOIN latest l ON l.code = upper(a.employee_code)
  WHERE a.year = 2026
    AND a.status IS DISTINCT FROM CASE l.movement_type WHEN 'resignation' THEN 'resigned'
                                                       WHEN 'leave_without_pay' THEN 'suspended'
                                                       ELSE 'active' END
)
SELECT (SELECT locked FROM lock) AS year_locked, * FROM missing
UNION ALL
SELECT (SELECT locked FROM lock), * FROM mismatch
ORDER BY 2, 5;
