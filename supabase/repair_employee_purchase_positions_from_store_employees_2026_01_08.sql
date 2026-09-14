-- Backfill employee purchase positions from employee management.
-- ROC 115/01-115/08 equals 2026-01 through 2026-08 in year_month.
--
-- Intended workflow:
-- 1. Finish editing headquarters employees in 員工管理 / store_employees.
-- 2. Run the preview SELECT blocks and confirm the rows look right.
-- 3. Run the UPDATE block in the same SQL editor session.

BEGIN;

-- Preview rows that can be matched by employee code.
WITH employee_source AS (
  SELECT DISTINCT ON (UPPER(BTRIM(employee_code::text)))
    id AS store_employee_id,
    UPPER(BTRIM(employee_code::text)) AS normalized_employee_code,
    NULLIF(BTRIM(employee_code::text), '') AS employee_code,
    NULLIF(BTRIM(employee_name::text), '') AS employee_name,
    COALESCE(NULLIF(BTRIM(current_position::text), ''), NULLIF(BTRIM(position::text), '')) AS employee_position
  FROM public.store_employees
  WHERE NULLIF(BTRIM(employee_code::text), '') IS NOT NULL
    AND COALESCE(NULLIF(BTRIM(current_position::text), ''), NULLIF(BTRIM(position::text), '')) IS NOT NULL
  ORDER BY
    UPPER(BTRIM(employee_code::text)),
    CASE WHEN employment_status = 'active' THEN 0 ELSE 1 END,
    CASE WHEN is_active THEN 0 ELSE 1 END,
    updated_at DESC NULLS LAST
),
code_matches AS (
  SELECT
    sales.id AS sale_id,
    sales.year_month,
    sales.member_code,
    sales.member_name,
    sales.employee_code AS old_employee_code,
    sales.employee_name AS old_employee_name,
    sales.employee_position AS old_employee_position,
    employee_source.employee_code AS new_employee_code,
    employee_source.employee_name AS new_employee_name,
    employee_source.employee_position AS new_employee_position
  FROM public.employee_purchase_sales sales
  JOIN employee_source
    ON UPPER(BTRIM(COALESCE(sales.member_code, sales.employee_code, ''))) = employee_source.normalized_employee_code
  WHERE sales.year_month BETWEEN '2026-01' AND '2026-08'
    AND COALESCE(NULLIF(BTRIM(sales.employee_position::text), ''), '未比對職稱') = '未比對職稱'
)
SELECT
  year_month,
  new_employee_position,
  COUNT(*) AS row_count,
  COALESCE(SUM(CASE WHEN new_employee_code IS NOT NULL THEN 1 ELSE 0 END), 0) AS matched_by_code_count
FROM code_matches
GROUP BY year_month, new_employee_position
ORDER BY year_month, new_employee_position;

-- Preview rows that can be matched by unique employee name, for rows not matched by code.
WITH employee_source AS (
  SELECT
    UPPER(REGEXP_REPLACE(BTRIM(employee_name::text), '\s+', '', 'g')) AS normalized_employee_name,
    MIN(NULLIF(BTRIM(employee_code::text), '')) AS employee_code,
    MIN(NULLIF(BTRIM(employee_name::text), '')) AS employee_name,
    MIN(COALESCE(NULLIF(BTRIM(current_position::text), ''), NULLIF(BTRIM(position::text), ''))) AS employee_position,
    COUNT(*) AS same_name_count
  FROM public.store_employees
  WHERE NULLIF(BTRIM(employee_name::text), '') IS NOT NULL
    AND COALESCE(NULLIF(BTRIM(current_position::text), ''), NULLIF(BTRIM(position::text), '')) IS NOT NULL
  GROUP BY UPPER(REGEXP_REPLACE(BTRIM(employee_name::text), '\s+', '', 'g'))
  HAVING COUNT(*) = 1
),
name_matches AS (
  SELECT
    sales.id AS sale_id,
    sales.year_month,
    sales.member_code,
    sales.member_name,
    sales.employee_code AS old_employee_code,
    sales.employee_name AS old_employee_name,
    sales.employee_position AS old_employee_position,
    employee_source.employee_code AS new_employee_code,
    employee_source.employee_name AS new_employee_name,
    employee_source.employee_position AS new_employee_position
  FROM public.employee_purchase_sales sales
  JOIN employee_source
    ON UPPER(REGEXP_REPLACE(BTRIM(COALESCE(sales.member_name, sales.employee_name, '')), '\s+', '', 'g')) = employee_source.normalized_employee_name
  WHERE sales.year_month BETWEEN '2026-01' AND '2026-08'
    AND COALESCE(NULLIF(BTRIM(sales.employee_position::text), ''), '未比對職稱') = '未比對職稱'
    AND NOT EXISTS (
      SELECT 1
      FROM public.store_employees code_employee
      WHERE UPPER(BTRIM(COALESCE(sales.member_code, sales.employee_code, ''))) = UPPER(BTRIM(code_employee.employee_code::text))
    )
)
SELECT
  year_month,
  new_employee_position,
  COUNT(*) AS row_count,
  COALESCE(SUM(CASE WHEN new_employee_name IS NOT NULL THEN 1 ELSE 0 END), 0) AS matched_by_unique_name_count
FROM name_matches
GROUP BY year_month, new_employee_position
ORDER BY year_month, new_employee_position;

-- Apply updates. Code matches take priority; name matches only apply when code
-- could not identify an employee and the name is unique in store_employees.
WITH code_source AS (
  SELECT DISTINCT ON (UPPER(BTRIM(employee_code::text)))
    UPPER(BTRIM(employee_code::text)) AS normalized_employee_code,
    NULLIF(BTRIM(employee_code::text), '') AS employee_code,
    NULLIF(BTRIM(employee_name::text), '') AS employee_name,
    COALESCE(NULLIF(BTRIM(current_position::text), ''), NULLIF(BTRIM(position::text), '')) AS employee_position
  FROM public.store_employees
  WHERE NULLIF(BTRIM(employee_code::text), '') IS NOT NULL
    AND COALESCE(NULLIF(BTRIM(current_position::text), ''), NULLIF(BTRIM(position::text), '')) IS NOT NULL
  ORDER BY
    UPPER(BTRIM(employee_code::text)),
    CASE WHEN employment_status = 'active' THEN 0 ELSE 1 END,
    CASE WHEN is_active THEN 0 ELSE 1 END,
    updated_at DESC NULLS LAST
),
name_source AS (
  SELECT
    UPPER(REGEXP_REPLACE(BTRIM(employee_name::text), '\s+', '', 'g')) AS normalized_employee_name,
    MIN(NULLIF(BTRIM(employee_code::text), '')) AS employee_code,
    MIN(NULLIF(BTRIM(employee_name::text), '')) AS employee_name,
    MIN(COALESCE(NULLIF(BTRIM(current_position::text), ''), NULLIF(BTRIM(position::text), ''))) AS employee_position
  FROM public.store_employees
  WHERE NULLIF(BTRIM(employee_name::text), '') IS NOT NULL
    AND COALESCE(NULLIF(BTRIM(current_position::text), ''), NULLIF(BTRIM(position::text), '')) IS NOT NULL
  GROUP BY UPPER(REGEXP_REPLACE(BTRIM(employee_name::text), '\s+', '', 'g'))
  HAVING COUNT(*) = 1
),
resolved AS (
  SELECT
    sales.id AS sale_id,
    COALESCE(code_source.employee_code, name_source.employee_code) AS employee_code,
    COALESCE(code_source.employee_name, name_source.employee_name) AS employee_name,
    COALESCE(code_source.employee_position, name_source.employee_position) AS employee_position,
    CASE
      WHEN code_source.employee_position IS NOT NULL THEN 'employee_code'
      WHEN name_source.employee_position IS NOT NULL THEN 'employee_name'
      ELSE NULL
    END AS match_status
  FROM public.employee_purchase_sales sales
  LEFT JOIN code_source
    ON UPPER(BTRIM(COALESCE(sales.member_code, sales.employee_code, ''))) = code_source.normalized_employee_code
  LEFT JOIN name_source
    ON code_source.employee_position IS NULL
   AND UPPER(REGEXP_REPLACE(BTRIM(COALESCE(sales.member_name, sales.employee_name, '')), '\s+', '', 'g')) = name_source.normalized_employee_name
  WHERE sales.year_month BETWEEN '2026-01' AND '2026-08'
    AND COALESCE(NULLIF(BTRIM(sales.employee_position::text), ''), '未比對職稱') = '未比對職稱'
)
UPDATE public.employee_purchase_sales sales
SET
  employee_code = COALESCE(resolved.employee_code, sales.employee_code),
  employee_name = COALESCE(resolved.employee_name, sales.employee_name),
  employee_position = resolved.employee_position,
  match_status = resolved.match_status
FROM resolved
WHERE sales.id = resolved.sale_id
  AND resolved.employee_position IS NOT NULL;

-- Final check: remaining unmatched position rows by month.
SELECT
  year_month,
  COUNT(*) AS remaining_unmatched_position_rows,
  COALESCE(SUM(total_amount), 0) AS total_amount
FROM public.employee_purchase_sales
WHERE year_month BETWEEN '2026-01' AND '2026-08'
  AND COALESCE(NULLIF(BTRIM(employee_position::text), ''), '未比對職稱') = '未比對職稱'
GROUP BY year_month
ORDER BY year_month;

COMMIT;
