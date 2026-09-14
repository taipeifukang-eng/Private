-- Repair store_employees employment status from the latest employee movement.
-- Use this when employee_movement_history has resignation records but
-- employee management still shows the employee as active.

BEGIN;

-- Preview rows that will be changed.
WITH latest_movements AS (
  SELECT DISTINCT ON (UPPER(BTRIM(employee_code::text)))
    UPPER(BTRIM(employee_code::text)) AS employee_code,
    movement_type,
    new_value,
    movement_date
  FROM public.employee_movement_history
  WHERE NULLIF(BTRIM(employee_code::text), '') IS NOT NULL
  ORDER BY UPPER(BTRIM(employee_code::text)), movement_date DESC, created_at DESC
),
status_targets AS (
  SELECT
    se.id,
    se.employee_code,
    se.employee_name,
    se.is_active AS old_is_active,
    se.employment_status AS old_employment_status,
    latest_movements.movement_type,
    latest_movements.new_value,
    latest_movements.movement_date,
    CASE
      WHEN latest_movements.movement_type = 'resignation'
        AND latest_movements.new_value = 'resigned' THEN false
      ELSE true
    END AS next_is_active,
    CASE
      WHEN latest_movements.movement_type = 'resignation'
        AND latest_movements.new_value = 'resigned' THEN 'resigned'
      WHEN latest_movements.movement_type = 'leave_without_pay' THEN 'leave_without_pay'
      ELSE 'active'
    END AS next_employment_status
  FROM public.store_employees se
  JOIN latest_movements
    ON UPPER(BTRIM(se.employee_code::text)) = latest_movements.employee_code
  WHERE latest_movements.movement_type IN ('resignation', 'leave_without_pay', 'return_to_work', 'onboarding')
)
SELECT
  employee_code,
  employee_name,
  old_is_active,
  old_employment_status,
  movement_type,
  movement_date,
  next_is_active,
  next_employment_status
FROM status_targets
WHERE old_is_active IS DISTINCT FROM next_is_active
   OR old_employment_status IS DISTINCT FROM next_employment_status
ORDER BY employee_code;

-- Apply repair.
WITH latest_movements AS (
  SELECT DISTINCT ON (UPPER(BTRIM(employee_code::text)))
    UPPER(BTRIM(employee_code::text)) AS employee_code,
    movement_type,
    new_value,
    movement_date
  FROM public.employee_movement_history
  WHERE NULLIF(BTRIM(employee_code::text), '') IS NOT NULL
  ORDER BY UPPER(BTRIM(employee_code::text)), movement_date DESC, created_at DESC
),
status_targets AS (
  SELECT
    se.id,
    latest_movements.movement_type,
    latest_movements.movement_date,
    CASE
      WHEN latest_movements.movement_type = 'resignation'
        AND latest_movements.new_value = 'resigned' THEN false
      ELSE true
    END AS next_is_active,
    CASE
      WHEN latest_movements.movement_type = 'resignation'
        AND latest_movements.new_value = 'resigned' THEN 'resigned'
      WHEN latest_movements.movement_type = 'leave_without_pay' THEN 'leave_without_pay'
      ELSE 'active'
    END AS next_employment_status
  FROM public.store_employees se
  JOIN latest_movements
    ON UPPER(BTRIM(se.employee_code::text)) = latest_movements.employee_code
  WHERE latest_movements.movement_type IN ('resignation', 'leave_without_pay', 'return_to_work', 'onboarding')
)
UPDATE public.store_employees se
SET
  is_active = status_targets.next_is_active,
  employment_status = status_targets.next_employment_status,
  last_movement_type = status_targets.movement_type,
  last_movement_date = status_targets.movement_date,
  updated_at = NOW()
FROM status_targets
WHERE se.id = status_targets.id
  AND (
    se.is_active IS DISTINCT FROM status_targets.next_is_active
    OR se.employment_status IS DISTINCT FROM status_targets.next_employment_status
  );

-- FK1054 spot check.
SELECT
  employee_code,
  employee_name,
  is_active,
  employment_status,
  last_movement_type,
  last_movement_date
FROM public.store_employees
WHERE UPPER(BTRIM(employee_code::text)) = 'FK1054';

COMMIT;
