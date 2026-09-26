-- ============================================================
-- Repair monthly_staff_status pharmacist flags from onboarding movements
-- Purpose:
--   Find employees whose onboarding movement explicitly says they are pharmacists
--   but store_employees / monthly_staff_status were not marked as pharmacist.
--
-- Safe scope:
--   - Only uses employee_movement_history.onboarding_is_pharmacist = true.
--   - Only updates store_employees.is_pharmacist from false/null to true.
--   - Only updates monthly_staff_status.is_pharmacist from false/null to true.
--   - Only affects monthly_staff_status rows at or after the onboarding month.
--   - Does not touch rows already marked as pharmacist.
--   - Does not change employee names, positions, status, bonuses, or notes.
--
-- After execution, the final SELECT returns the affected list.
-- ============================================================

BEGIN;

DROP TABLE IF EXISTS repair_monthly_staff_pharmacist_changes;

CREATE TEMP TABLE repair_monthly_staff_pharmacist_changes (
  source_table text NOT NULL,
  record_id uuid,
  employee_code text NOT NULL,
  employee_name text,
  year_month text,
  store_id uuid,
  onboarding_date date,
  old_is_pharmacist boolean,
  new_is_pharmacist boolean NOT NULL
) ON COMMIT PRESERVE ROWS;

WITH pharmacist_onboarding AS (
  SELECT DISTINCT ON (upper(trim(employee_code)))
    upper(trim(employee_code)) AS employee_code,
    employee_name,
    store_id,
    movement_date::date AS onboarding_date,
    left(movement_date::text, 7) AS onboarding_year_month
  FROM public.employee_movement_history
  WHERE movement_type = 'onboarding'
    AND onboarding_is_pharmacist IS TRUE
    AND nullif(trim(employee_code), '') IS NOT NULL
  ORDER BY upper(trim(employee_code)), movement_date ASC, created_at ASC
),
updated_store_employees AS (
  UPDATE public.store_employees AS se
  SET
    is_pharmacist = true,
    updated_at = now()
  FROM pharmacist_onboarding AS po
  WHERE upper(trim(se.employee_code)) = po.employee_code
    AND coalesce(se.is_pharmacist, false) IS FALSE
  RETURNING
    se.id,
    upper(trim(se.employee_code)) AS employee_code,
    se.employee_name,
    se.store_id,
    po.onboarding_date,
    false::boolean AS old_is_pharmacist,
    true::boolean AS new_is_pharmacist
)
INSERT INTO repair_monthly_staff_pharmacist_changes (
  source_table,
  record_id,
  employee_code,
  employee_name,
  store_id,
  onboarding_date,
  old_is_pharmacist,
  new_is_pharmacist
)
SELECT
  'store_employees',
  id,
  employee_code,
  employee_name,
  store_id,
  onboarding_date,
  old_is_pharmacist,
  new_is_pharmacist
FROM updated_store_employees;

WITH pharmacist_onboarding AS (
  SELECT DISTINCT ON (upper(trim(employee_code)))
    upper(trim(employee_code)) AS employee_code,
    employee_name,
    store_id,
    movement_date::date AS onboarding_date,
    left(movement_date::text, 7) AS onboarding_year_month
  FROM public.employee_movement_history
  WHERE movement_type = 'onboarding'
    AND onboarding_is_pharmacist IS TRUE
    AND nullif(trim(employee_code), '') IS NOT NULL
  ORDER BY upper(trim(employee_code)), movement_date ASC, created_at ASC
),
updated_monthly_staff AS (
  UPDATE public.monthly_staff_status AS mss
  SET
    is_pharmacist = true,
    updated_at = now()
  FROM pharmacist_onboarding AS po
  WHERE upper(trim(mss.employee_code)) = po.employee_code
    AND mss.year_month >= po.onboarding_year_month
    AND coalesce(mss.is_pharmacist, false) IS FALSE
  RETURNING
    mss.id,
    upper(trim(mss.employee_code)) AS employee_code,
    mss.employee_name,
    mss.year_month,
    mss.store_id,
    po.onboarding_date,
    false::boolean AS old_is_pharmacist,
    true::boolean AS new_is_pharmacist
)
INSERT INTO repair_monthly_staff_pharmacist_changes (
  source_table,
  record_id,
  employee_code,
  employee_name,
  year_month,
  store_id,
  onboarding_date,
  old_is_pharmacist,
  new_is_pharmacist
)
SELECT
  'monthly_staff_status',
  id,
  employee_code,
  employee_name,
  year_month,
  store_id,
  onboarding_date,
  old_is_pharmacist,
  new_is_pharmacist
FROM updated_monthly_staff;

COMMIT;

SELECT
  source_table,
  employee_code,
  employee_name,
  year_month,
  store_id,
  onboarding_date,
  old_is_pharmacist,
  new_is_pharmacist
FROM repair_monthly_staff_pharmacist_changes
ORDER BY employee_code, source_table, year_month NULLS FIRST;

-- Verification: rows returned here still need manual review.
WITH pharmacist_onboarding AS (
  SELECT DISTINCT ON (upper(trim(employee_code)))
    upper(trim(employee_code)) AS employee_code,
    employee_name,
    movement_date::date AS onboarding_date,
    left(movement_date::text, 7) AS onboarding_year_month
  FROM public.employee_movement_history
  WHERE movement_type = 'onboarding'
    AND onboarding_is_pharmacist IS TRUE
    AND nullif(trim(employee_code), '') IS NOT NULL
  ORDER BY upper(trim(employee_code)), movement_date ASC, created_at ASC
)
SELECT
  po.employee_code,
  po.employee_name,
  po.onboarding_date,
  count(*) FILTER (WHERE coalesce(mss.is_pharmacist, false) IS FALSE) AS remaining_unmarked_monthly_rows
FROM pharmacist_onboarding AS po
LEFT JOIN public.monthly_staff_status AS mss
  ON upper(trim(mss.employee_code)) = po.employee_code
 AND mss.year_month >= po.onboarding_year_month
GROUP BY po.employee_code, po.employee_name, po.onboarding_date
HAVING count(*) FILTER (WHERE coalesce(mss.is_pharmacist, false) IS FALSE) > 0
ORDER BY po.employee_code;
