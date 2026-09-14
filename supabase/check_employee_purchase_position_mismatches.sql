-- Check all employee purchase position mismatches against employee management.
-- This SQL does not update data. Use it before running
-- repair_employee_purchase_positions_from_employee_master.sql.

-- 1) Summary by month and position difference.
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
    COALESCE(latest_promotion.promotion_position, NULLIF(BTRIM(current_position::text), ''), NULLIF(BTRIM(position::text), '')) AS employee_position,
    employment_status,
    is_active
  FROM public.store_employees
  LEFT JOIN latest_promotion
    ON latest_promotion.normalized_employee_code = UPPER(BTRIM(store_employees.employee_code::text))
  WHERE NULLIF(BTRIM(employee_code::text), '') IS NOT NULL
  ORDER BY
    UPPER(BTRIM(employee_code::text)),
    CASE WHEN employment_status = 'active' THEN 0 ELSE 1 END,
    CASE WHEN is_active THEN 0 ELSE 1 END,
    updated_at DESC NULLS LAST
),
resolved AS (
  SELECT
    sales.year_month,
    COALESCE(NULLIF(BTRIM(sales.employee_code), ''), NULLIF(BTRIM(sales.member_code), '')) AS purchase_employee_code,
    COALESCE(NULLIF(BTRIM(sales.employee_name), ''), NULLIF(BTRIM(sales.member_name), '')) AS purchase_employee_name,
    COALESCE(NULLIF(BTRIM(sales.employee_position), ''), '未比對職稱') AS purchase_position,
    employee_source.employee_code AS master_employee_code,
    employee_source.employee_name AS master_employee_name,
    COALESCE(NULLIF(BTRIM(employee_source.employee_position), ''), '員工主檔無職稱') AS master_position,
    sales.total_amount
  FROM public.employee_purchase_sales sales
  LEFT JOIN employee_source
    ON UPPER(BTRIM(COALESCE(sales.employee_code, sales.member_code, ''))) = employee_source.normalized_employee_code
)
SELECT
  year_month,
  purchase_position AS 員購目前職稱,
  master_position AS 員工管理職稱,
  COUNT(*) AS 銷售筆數,
  COUNT(DISTINCT COALESCE(master_employee_code, purchase_employee_code, purchase_employee_name)) AS 人數,
  COALESCE(SUM(total_amount), 0) AS 消費總額
FROM resolved
WHERE master_employee_code IS NOT NULL
  AND purchase_position IS DISTINCT FROM master_position
GROUP BY year_month, purchase_position, master_position
ORDER BY year_month, purchase_position, master_position;

-- 2) Employee-level mismatch detail.
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
    COALESCE(latest_promotion.promotion_position, NULLIF(BTRIM(current_position::text), ''), NULLIF(BTRIM(position::text), '')) AS employee_position,
    employment_status,
    is_active
  FROM public.store_employees
  LEFT JOIN latest_promotion
    ON latest_promotion.normalized_employee_code = UPPER(BTRIM(store_employees.employee_code::text))
  WHERE NULLIF(BTRIM(employee_code::text), '') IS NOT NULL
  ORDER BY
    UPPER(BTRIM(employee_code::text)),
    CASE WHEN employment_status = 'active' THEN 0 ELSE 1 END,
    CASE WHEN is_active THEN 0 ELSE 1 END,
    updated_at DESC NULLS LAST
),
resolved AS (
  SELECT
    sales.year_month,
    COALESCE(NULLIF(BTRIM(sales.employee_code), ''), NULLIF(BTRIM(sales.member_code), '')) AS purchase_employee_code,
    COALESCE(NULLIF(BTRIM(sales.employee_name), ''), NULLIF(BTRIM(sales.member_name), '')) AS purchase_employee_name,
    COALESCE(NULLIF(BTRIM(sales.employee_position), ''), '未比對職稱') AS purchase_position,
    employee_source.employee_code AS master_employee_code,
    employee_source.employee_name AS master_employee_name,
    COALESCE(NULLIF(BTRIM(employee_source.employee_position), ''), '員工主檔無職稱') AS master_position,
    sales.total_amount
  FROM public.employee_purchase_sales sales
  LEFT JOIN employee_source
    ON UPPER(BTRIM(COALESCE(sales.employee_code, sales.member_code, ''))) = employee_source.normalized_employee_code
)
SELECT
  year_month,
  COALESCE(master_employee_code, purchase_employee_code) AS 員編,
  COALESCE(master_employee_name, purchase_employee_name) AS 姓名,
  purchase_position AS 員購目前職稱,
  master_position AS 員工管理職稱,
  COUNT(*) AS 銷售筆數,
  COALESCE(SUM(total_amount), 0) AS 消費總額
FROM resolved
WHERE master_employee_code IS NOT NULL
  AND purchase_position IS DISTINCT FROM master_position
GROUP BY
  year_month,
  COALESCE(master_employee_code, purchase_employee_code),
  COALESCE(master_employee_name, purchase_employee_name),
  purchase_position,
  master_position
ORDER BY year_month, 員工管理職稱, 員購目前職稱, 員編;

-- 3) Rows that still cannot be matched to employee management by employee code.
WITH employee_source AS (
  SELECT DISTINCT ON (UPPER(BTRIM(employee_code::text)))
    UPPER(BTRIM(employee_code::text)) AS normalized_employee_code,
    NULLIF(BTRIM(employee_code::text), '') AS employee_code
  FROM public.store_employees
  WHERE NULLIF(BTRIM(employee_code::text), '') IS NOT NULL
  ORDER BY UPPER(BTRIM(employee_code::text)), updated_at DESC NULLS LAST
)
SELECT
  sales.year_month,
  COALESCE(NULLIF(BTRIM(sales.employee_code), ''), NULLIF(BTRIM(sales.member_code), '')) AS 員編或會員編號,
  COALESCE(NULLIF(BTRIM(sales.employee_name), ''), NULLIF(BTRIM(sales.member_name), '')) AS 姓名或會員名稱,
  COALESCE(NULLIF(BTRIM(sales.employee_position), ''), '未比對職稱') AS 員購目前職稱,
  COUNT(*) AS 銷售筆數,
  COALESCE(SUM(sales.total_amount), 0) AS 消費總額
FROM public.employee_purchase_sales sales
LEFT JOIN employee_source
  ON UPPER(BTRIM(COALESCE(sales.employee_code, sales.member_code, ''))) = employee_source.normalized_employee_code
WHERE employee_source.employee_code IS NULL
GROUP BY
  sales.year_month,
  COALESCE(NULLIF(BTRIM(sales.employee_code), ''), NULLIF(BTRIM(sales.member_code), '')),
  COALESCE(NULLIF(BTRIM(sales.employee_name), ''), NULLIF(BTRIM(sales.member_name), '')),
  COALESCE(NULLIF(BTRIM(sales.employee_position), ''), '未比對職稱')
ORDER BY sales.year_month, 消費總額 DESC, 員編或會員編號;
