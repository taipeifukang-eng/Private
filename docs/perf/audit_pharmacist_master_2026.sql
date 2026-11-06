-- 唯讀檢查：2026 藥師主檔漏同步（只查詢，不修改任何資料）
-- 「今天」用台灣日期（與同步程式一致），不用資料庫 UTC 的 CURRENT_DATE。
-- B 段狀態判斷與 syncAnnualMaster 相同：各類型取最新生效日，同日時優先序為 復職 > 留停 > 離職。
-- leave_of_absence 不納入狀態判斷（與程式一致）。
-- 一次性缺口：舊程式用 UTC 日期，若某年度是在台灣 00:00-08:00 同步的，當天生效的異動可能漏掉，
-- 且新觸發條件不會補；本查詢找到的人需手動補正（例如刪除該年 pharmacist_annual_master_sync_log 的列，下次開頁即重跑）。
WITH tw AS (
  SELECT (now() AT TIME ZONE 'Asia/Taipei')::date AS today
),
lock AS (
  SELECT EXISTS (SELECT 1 FROM pharmacist_annual_master_locks WHERE year = 2026) AS locked
),
missing AS (
  -- A. 今年入職且是藥師、生效日已到，但不在 2026 主檔
  SELECT 'A_未入主檔' AS issue, m.employee_code, m.employee_name,
         m.movement_date::text AS movement_date, m.created_at::text AS registered_at,
         NULL::text AS master_status, 'active' AS expected_status
  FROM employee_movement_history m
  WHERE m.movement_type = 'onboarding' AND m.onboarding_is_pharmacist = true
    AND m.movement_date BETWEEN '2026-01-01' AND (SELECT today FROM tw)
    AND NOT EXISTS (SELECT 1 FROM pharmacist_annual_master a
                    WHERE a.year = 2026 AND upper(a.employee_code) = upper(m.employee_code))
),
latest AS (
  -- B. 主檔內人員：今年生效日已到的各類狀態異動，取各類型最新生效日
  SELECT upper(m.employee_code) AS code,
         max(m.movement_date) FILTER (WHERE m.movement_type = 'resignation')        AS resign_date,
         max(m.movement_date) FILTER (WHERE m.movement_type = 'leave_without_pay')  AS suspend_date,
         max(m.movement_date) FILTER (WHERE m.movement_type = 'return_to_work')     AS return_date,
         max(m.created_at) AS last_registered
  FROM employee_movement_history m
  WHERE m.movement_type IN ('resignation', 'leave_without_pay', 'return_to_work')
    AND m.movement_date BETWEEN '2026-01-01' AND (SELECT today FROM tw)
  GROUP BY upper(m.employee_code)
),
expected AS (
  SELECT l.*,
         CASE
           WHEN l.return_date IS NOT NULL
                AND l.return_date >= COALESCE(l.resign_date, '0001-01-01')
                AND l.return_date >= COALESCE(l.suspend_date, '0001-01-01') THEN 'active'
           WHEN l.suspend_date IS NOT NULL
                AND l.suspend_date >= COALESCE(l.resign_date, '0001-01-01') THEN 'suspended'
           WHEN l.resign_date IS NOT NULL THEN 'resigned'
         END AS exp_status,
         GREATEST(l.resign_date, l.suspend_date, l.return_date) AS exp_date
  FROM latest l
),
mismatch AS (
  SELECT 'B_狀態不符' AS issue, a.employee_code, a.employee_name,
         e.exp_date::text, e.last_registered::text,
         a.status, e.exp_status
  FROM pharmacist_annual_master a
  JOIN expected e ON e.code = upper(a.employee_code)
  WHERE a.year = 2026
    AND a.status IS DISTINCT FROM e.exp_status
)
SELECT (SELECT locked FROM lock) AS year_locked, * FROM missing
UNION ALL
SELECT (SELECT locked FROM lock), * FROM mismatch
ORDER BY 2, 5;
