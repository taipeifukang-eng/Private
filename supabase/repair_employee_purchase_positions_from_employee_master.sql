-- Repair employee purchase positions from employee management.
-- Use when employee_purchase_sales.employee_position differs from
-- latest promotion / store_employees.current_position / position, for example
-- FK0385 displayed as 新人 in employee purchase but 督導 in employee management.

BEGIN;

-- Preview rows that will be changed.
WITH latest_promotion AS (
  SELECT DISTINCT ON (UPPER(BTRIM(employee_code::text)))
    UPPER(BTRIM(employee_code::text)) AS normalized_employee_code,
    NULLIF(BTRIM(new_value::text), '') AS promotion_position
  FROM public.employee_movement_history
  WHERE movement_type = 'promotion'
    AND NULLIF(BTRIM(employee_code::text), '') IS NOT NULL
    AND NULLIF(BTRIM(new_value::text), '') IS NOT NULL
  ORDER BY UPPER(BTRIM(employee_code::text)), movement_date DESC, created_at DESC
),
employee_source AS (
  SELECT DISTINCT ON (UPPER(BTRIM(employee_code::text)))
    UPPER(BTRIM(employee_code::text)) AS normalized_employee_code,
    NULLIF(BTRIM(employee_code::text), '') AS employee_code,
    NULLIF(BTRIM(employee_name::text), '') AS employee_name,
    COALESCE(latest_promotion.promotion_position, NULLIF(BTRIM(current_position::text), ''), NULLIF(BTRIM(position::text), '')) AS employee_position
  FROM public.store_employees
  LEFT JOIN latest_promotion
    ON latest_promotion.normalized_employee_code = UPPER(BTRIM(store_employees.employee_code::text))
  WHERE NULLIF(BTRIM(employee_code::text), '') IS NOT NULL
    AND COALESCE(latest_promotion.promotion_position, NULLIF(BTRIM(current_position::text), ''), NULLIF(BTRIM(position::text), '')) IS NOT NULL
  ORDER BY
    UPPER(BTRIM(employee_code::text)),
    CASE WHEN employment_status = 'active' THEN 0 ELSE 1 END,
    CASE WHEN is_active THEN 0 ELSE 1 END,
    updated_at DESC NULLS LAST
),
changes AS (
  SELECT
    sales.id,
    sales.year_month,
    sales.member_code,
    sales.member_name,
    sales.employee_code AS old_employee_code,
    sales.employee_name AS old_employee_name,
    sales.employee_position AS old_employee_position,
    employee_source.employee_code AS new_employee_code,
    employee_source.employee_name AS new_employee_name,
    employee_source.employee_position AS new_employee_position,
    sales.total_amount
  FROM public.employee_purchase_sales sales
  JOIN employee_source
    ON UPPER(BTRIM(COALESCE(sales.employee_code, sales.member_code, ''))) = employee_source.normalized_employee_code
  WHERE NULLIF(BTRIM(employee_source.employee_position), '') IS NOT NULL
    AND NULLIF(BTRIM(COALESCE(sales.employee_position, '')), '') IS DISTINCT FROM employee_source.employee_position
)
SELECT
  year_month,
  old_employee_position,
  new_employee_position,
  COUNT(*) AS row_count,
  COALESCE(SUM(total_amount), 0) AS total_amount
FROM changes
GROUP BY year_month, old_employee_position, new_employee_position
ORDER BY year_month, old_employee_position, new_employee_position;

-- Apply updates.
WITH latest_promotion AS (
  SELECT DISTINCT ON (UPPER(BTRIM(employee_code::text)))
    UPPER(BTRIM(employee_code::text)) AS normalized_employee_code,
    NULLIF(BTRIM(new_value::text), '') AS promotion_position
  FROM public.employee_movement_history
  WHERE movement_type = 'promotion'
    AND NULLIF(BTRIM(employee_code::text), '') IS NOT NULL
    AND NULLIF(BTRIM(new_value::text), '') IS NOT NULL
  ORDER BY UPPER(BTRIM(employee_code::text)), movement_date DESC, created_at DESC
),
employee_source AS (
  SELECT DISTINCT ON (UPPER(BTRIM(employee_code::text)))
    UPPER(BTRIM(employee_code::text)) AS normalized_employee_code,
    NULLIF(BTRIM(employee_code::text), '') AS employee_code,
    NULLIF(BTRIM(employee_name::text), '') AS employee_name,
    COALESCE(latest_promotion.promotion_position, NULLIF(BTRIM(current_position::text), ''), NULLIF(BTRIM(position::text), '')) AS employee_position
  FROM public.store_employees
  LEFT JOIN latest_promotion
    ON latest_promotion.normalized_employee_code = UPPER(BTRIM(store_employees.employee_code::text))
  WHERE NULLIF(BTRIM(employee_code::text), '') IS NOT NULL
    AND COALESCE(latest_promotion.promotion_position, NULLIF(BTRIM(current_position::text), ''), NULLIF(BTRIM(position::text), '')) IS NOT NULL
  ORDER BY
    UPPER(BTRIM(employee_code::text)),
    CASE WHEN employment_status = 'active' THEN 0 ELSE 1 END,
    CASE WHEN is_active THEN 0 ELSE 1 END,
    updated_at DESC NULLS LAST
),
changes AS (
  SELECT
    sales.id,
    employee_source.employee_code,
    employee_source.employee_name,
    employee_source.employee_position
  FROM public.employee_purchase_sales sales
  JOIN employee_source
    ON UPPER(BTRIM(COALESCE(sales.employee_code, sales.member_code, ''))) = employee_source.normalized_employee_code
  WHERE NULLIF(BTRIM(employee_source.employee_position), '') IS NOT NULL
    AND NULLIF(BTRIM(COALESCE(sales.employee_position, '')), '') IS DISTINCT FROM employee_source.employee_position
)
UPDATE public.employee_purchase_sales sales
SET
  employee_code = COALESCE(changes.employee_code, sales.employee_code),
  employee_name = COALESCE(changes.employee_name, sales.employee_name),
  employee_position = changes.employee_position,
  match_status = CASE
    WHEN changes.employee_code IS NOT NULL THEN 'employee_code'
    ELSE sales.match_status
  END
FROM changes
WHERE sales.id = changes.id;

-- Spot check.
SELECT
  year_month,
  employee_code,
  employee_name,
  employee_position,
  COUNT(*) AS row_count,
  COALESCE(SUM(total_amount), 0) AS total_amount
FROM public.employee_purchase_sales
WHERE UPPER(BTRIM(COALESCE(employee_code, member_code, ''))) IN ('FK0385', 'FK0195')
GROUP BY year_month, employee_code, employee_name, employee_position
ORDER BY employee_code, year_month, employee_position;

COMMIT;
