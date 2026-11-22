-- Restore monthly acting-manager flags for the ranges explicitly confirmed by
-- the user. Updates every matching snapshot, including duplicate employee-month
-- rows; it does not insert or delete monthly records.
BEGIN;

WITH targets(employee_code, start_month, end_month) AS (
  VALUES
    ('FK0984', '2026-05', '2026-08'),
    ('FK0864', '2026-03', '2026-09'),
    ('FK0463', '2026-01', '2026-09'),
    ('FK0838', '2026-05', '2026-09')
)
UPDATE public.monthly_staff_status AS monthly
SET is_acting_manager = true,
    updated_at = now()
FROM targets
WHERE monthly.employee_code = targets.employee_code
  AND monthly.year_month BETWEEN targets.start_month AND targets.end_month
  AND monthly.is_acting_manager IS DISTINCT FROM true;

SELECT
  employee_code,
  employee_name,
  year_month,
  is_acting_manager
FROM public.monthly_staff_status
WHERE (employee_code = 'FK0984' AND year_month BETWEEN '2026-05' AND '2026-08')
   OR (employee_code = 'FK0864' AND year_month BETWEEN '2026-03' AND '2026-09')
   OR (employee_code = 'FK0463' AND year_month BETWEEN '2026-01' AND '2026-09')
   OR (employee_code = 'FK0838' AND year_month BETWEEN '2026-05' AND '2026-09')
ORDER BY employee_code, year_month;

COMMIT;
