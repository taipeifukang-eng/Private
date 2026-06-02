-- 一次性修復：FK1067 於 2026-04-15 調店後，
-- 將「新門市（movement.store_id）」已初始化月份的月度人員資料補齊/校正為自動帶入
-- 規則：
-- 1) 生效月（2026-04）=> monthly_status = transferred_in，work_days = 月天數 - 15 + 1
-- 2) 後續月份 => monthly_status = full_month，work_days = 當月天數
-- 3) 既有資料會更新並改為 is_manually_added = false；缺少資料則自動補 insert

WITH transfer_row AS (
  SELECT
    emh.employee_code,
    emh.employee_name,
    emh.store_id AS to_store_id,
    emh.movement_date,
    emh.old_value,
    LEFT(emh.movement_date::text, 7) AS transfer_ym,
    EXTRACT(DAY FROM emh.movement_date)::int AS transfer_day
  FROM employee_movement_history emh
  WHERE emh.employee_code = 'FK1067'
    AND emh.movement_type = 'store_transfer'
    AND emh.movement_date = DATE '2026-04-15'
  ORDER BY emh.created_at DESC
  LIMIT 1
),
initialized_months AS (
  SELECT DISTINCT
    mss.year_month
  FROM monthly_staff_status mss
  JOIN transfer_row tr ON mss.store_id = tr.to_store_id
  WHERE mss.status = 'draft'
    AND mss.year_month >= tr.transfer_ym
),
emp_base AS (
  SELECT
    se.user_id,
    se.employee_name,
    COALESCE(se.current_position, se.position, '新人') AS position,
    COALESCE(se.employment_type, 'full_time') AS employment_type,
    COALESCE(se.is_pharmacist, false) AS is_pharmacist,
    se.start_date
  FROM store_employees se
  JOIN transfer_row tr
    ON se.employee_code = tr.employee_code
   AND se.store_id = tr.to_store_id
  ORDER BY se.last_movement_date DESC NULLS LAST, se.updated_at DESC NULLS LAST
  LIMIT 1
),
resolved_start_date AS (
  SELECT
    COALESCE(
      (SELECT eb.start_date FROM emp_base eb),
      (
        SELECT emh.movement_date
        FROM employee_movement_history emh
        JOIN transfer_row tr ON emh.employee_code = tr.employee_code
        WHERE emh.movement_type = 'onboarding'
        ORDER BY emh.movement_date ASC
        LIMIT 1
      )
    ) AS start_date
),
prepared_rows AS (
  SELECT
    im.year_month,
    tr.to_store_id AS store_id,
    (SELECT eb.user_id FROM emp_base eb) AS user_id,
    tr.employee_code,
    COALESCE((SELECT eb.employee_name FROM emp_base eb), tr.employee_name, tr.employee_code) AS employee_name,
    COALESCE((SELECT eb.position FROM emp_base eb), '新人') AS position,
    COALESCE((SELECT eb.employment_type FROM emp_base eb), 'full_time') AS employment_type,
    COALESCE((SELECT eb.is_pharmacist FROM emp_base eb), false) AS is_pharmacist,
    (SELECT rsd.start_date FROM resolved_start_date rsd) AS start_date,
    CASE WHEN im.year_month = tr.transfer_ym THEN 'transferred_in' ELSE 'full_month' END AS monthly_status,
    CASE
      WHEN im.year_month = tr.transfer_ym THEN
        (
          EXTRACT(
            DAY FROM (
              DATE_TRUNC('month', (im.year_month || '-01')::date)
              + INTERVAL '1 month - 1 day'
            )
          )::int - tr.transfer_day + 1
        )
      ELSE
        EXTRACT(
          DAY FROM (
            DATE_TRUNC('month', (im.year_month || '-01')::date)
            + INTERVAL '1 month - 1 day'
          )
        )::int
    END AS work_days,
    EXTRACT(
      DAY FROM (
        DATE_TRUNC('month', (im.year_month || '-01')::date)
        + INTERVAL '1 month - 1 day'
      )
    )::int AS total_days_in_month,
    CASE WHEN COALESCE((SELECT eb.employment_type FROM emp_base eb), 'full_time') = 'part_time' THEN 0 ELSE NULL END AS work_hours,
    CASE WHEN im.year_month = tr.transfer_ym THEN '調入店' ELSE NULL END AS partial_month_reason,
    CASE
      WHEN im.year_month = tr.transfer_ym
      THEN TO_CHAR(tr.movement_date, 'MM/DD') || '自' || COALESCE(tr.old_value, '') || '調入'
      ELSE NULL
    END AS partial_month_notes
  FROM initialized_months im
  CROSS JOIN transfer_row tr
)
-- 先更新既有紀錄
UPDATE monthly_staff_status mss
SET
  user_id = pr.user_id,
  employee_name = pr.employee_name,
  position = pr.position,
  employment_type = pr.employment_type,
  is_pharmacist = pr.is_pharmacist,
  start_date = pr.start_date,
  monthly_status = pr.monthly_status,
  work_days = pr.work_days,
  total_days_in_month = pr.total_days_in_month,
  work_hours = pr.work_hours,
  partial_month_reason = pr.partial_month_reason,
  partial_month_notes = pr.partial_month_notes,
  is_manually_added = false,
  updated_at = NOW()
FROM prepared_rows pr
WHERE mss.year_month = pr.year_month
  AND mss.store_id = pr.store_id
  AND mss.employee_code = pr.employee_code;

-- 再補新增缺漏紀錄
WITH transfer_row AS (
  SELECT
    emh.employee_code,
    emh.employee_name,
    emh.store_id AS to_store_id,
    emh.movement_date,
    emh.old_value,
    LEFT(emh.movement_date::text, 7) AS transfer_ym,
    EXTRACT(DAY FROM emh.movement_date)::int AS transfer_day
  FROM employee_movement_history emh
  WHERE emh.employee_code = 'FK1067'
    AND emh.movement_type = 'store_transfer'
    AND emh.movement_date = DATE '2026-04-15'
  ORDER BY emh.created_at DESC
  LIMIT 1
),
initialized_months AS (
  SELECT DISTINCT
    mss.year_month
  FROM monthly_staff_status mss
  JOIN transfer_row tr ON mss.store_id = tr.to_store_id
  WHERE mss.status = 'draft'
    AND mss.year_month >= tr.transfer_ym
),
emp_base AS (
  SELECT
    se.user_id,
    se.employee_name,
    COALESCE(se.current_position, se.position, '新人') AS position,
    COALESCE(se.employment_type, 'full_time') AS employment_type,
    COALESCE(se.is_pharmacist, false) AS is_pharmacist,
    se.start_date
  FROM store_employees se
  JOIN transfer_row tr
    ON se.employee_code = tr.employee_code
   AND se.store_id = tr.to_store_id
  ORDER BY se.last_movement_date DESC NULLS LAST, se.updated_at DESC NULLS LAST
  LIMIT 1
),
resolved_start_date AS (
  SELECT
    COALESCE(
      (SELECT eb.start_date FROM emp_base eb),
      (
        SELECT emh.movement_date
        FROM employee_movement_history emh
        JOIN transfer_row tr ON emh.employee_code = tr.employee_code
        WHERE emh.movement_type = 'onboarding'
        ORDER BY emh.movement_date ASC
        LIMIT 1
      )
    ) AS start_date
),
prepared_rows AS (
  SELECT
    im.year_month,
    tr.to_store_id AS store_id,
    (SELECT eb.user_id FROM emp_base eb) AS user_id,
    tr.employee_code,
    COALESCE((SELECT eb.employee_name FROM emp_base eb), tr.employee_name, tr.employee_code) AS employee_name,
    COALESCE((SELECT eb.position FROM emp_base eb), '新人') AS position,
    COALESCE((SELECT eb.employment_type FROM emp_base eb), 'full_time') AS employment_type,
    COALESCE((SELECT eb.is_pharmacist FROM emp_base eb), false) AS is_pharmacist,
    (SELECT rsd.start_date FROM resolved_start_date rsd) AS start_date,
    CASE WHEN im.year_month = tr.transfer_ym THEN 'transferred_in' ELSE 'full_month' END AS monthly_status,
    CASE
      WHEN im.year_month = tr.transfer_ym THEN
        (
          EXTRACT(
            DAY FROM (
              DATE_TRUNC('month', (im.year_month || '-01')::date)
              + INTERVAL '1 month - 1 day'
            )
          )::int - tr.transfer_day + 1
        )
      ELSE
        EXTRACT(
          DAY FROM (
            DATE_TRUNC('month', (im.year_month || '-01')::date)
            + INTERVAL '1 month - 1 day'
          )
        )::int
    END AS work_days,
    EXTRACT(
      DAY FROM (
        DATE_TRUNC('month', (im.year_month || '-01')::date)
        + INTERVAL '1 month - 1 day'
      )
    )::int AS total_days_in_month,
    CASE WHEN COALESCE((SELECT eb.employment_type FROM emp_base eb), 'full_time') = 'part_time' THEN 0 ELSE NULL END AS work_hours,
    CASE WHEN im.year_month = tr.transfer_ym THEN '調入店' ELSE NULL END AS partial_month_reason,
    CASE
      WHEN im.year_month = tr.transfer_ym
      THEN TO_CHAR(tr.movement_date, 'MM/DD') || '自' || COALESCE(tr.old_value, '') || '調入'
      ELSE NULL
    END AS partial_month_notes
  FROM initialized_months im
  CROSS JOIN transfer_row tr
)
INSERT INTO monthly_staff_status (
  year_month,
  store_id,
  user_id,
  employee_code,
  employee_name,
  position,
  employment_type,
  is_pharmacist,
  start_date,
  monthly_status,
  work_days,
  total_days_in_month,
  work_hours,
  is_dual_position,
  has_manager_bonus,
  is_supervisor_rotation,
  is_acting_manager,
  partial_month_reason,
  partial_month_days,
  partial_month_notes,
  extra_tasks,
  is_manually_added,
  status
)
SELECT
  pr.year_month,
  pr.store_id,
  pr.user_id,
  pr.employee_code,
  pr.employee_name,
  pr.position,
  pr.employment_type,
  pr.is_pharmacist,
  pr.start_date,
  pr.monthly_status,
  pr.work_days,
  pr.total_days_in_month,
  pr.work_hours,
  false,
  false,
  false,
  false,
  pr.partial_month_reason,
  NULL,
  pr.partial_month_notes,
  NULL,
  false,
  'draft'
FROM prepared_rows pr
LEFT JOIN monthly_staff_status mss
  ON mss.year_month = pr.year_month
 AND mss.store_id = pr.store_id
 AND mss.employee_code = pr.employee_code
WHERE mss.id IS NULL;

-- 檢視修復結果
SELECT
  year_month,
  store_id,
  employee_code,
  employee_name,
  monthly_status,
  work_days,
  total_days_in_month,
  partial_month_reason,
  partial_month_notes,
  is_manually_added
FROM monthly_staff_status
WHERE employee_code = 'FK1067'
  AND year_month >= '2026-04'
ORDER BY year_month, store_id;