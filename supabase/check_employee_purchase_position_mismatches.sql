-- Check all employee purchase position mismatches against employee management.
-- This SQL does not update data. Use it before running
-- repair_employee_purchase_positions_from_employee_master.sql.

-- 1) Summary by month and position difference.
WITH latest_promotion AS (
  SELECT DISTINCT ON (UPPER(BTRIM(emh.employee_code::text)))
    UPPER(BTRIM(emh.employee_code::text)) AS normalized_employee_code,
    NULLIF(BTRIM(emh.new_value::text), '') AS promotion_position
  FROM public.employee_movement_history emh
  WHERE emh.movement_type = 'promotion'
    AND NULLIF(BTRIM(emh.employee_code::text), '') IS NOT NULL
    AND NULLIF(BTRIM(emh.new_value::text), '') IS NOT NULL
  ORDER BY UPPER(BTRIM(emh.employee_code::text)), emh.movement_date DESC, emh.created_at DESC
),
latest_monthly_position AS (
  SELECT DISTINCT ON (UPPER(BTRIM(mss.employee_code::text)))
    UPPER(BTRIM(mss.employee_code::text)) AS normalized_employee_code,
    NULLIF(BTRIM(mss.position::text), '') AS monthly_position
  FROM public.monthly_staff_status mss
  WHERE NULLIF(BTRIM(mss.employee_code::text), '') IS NOT NULL
    AND NULLIF(BTRIM(mss.position::text), '') IS NOT NULL
  ORDER BY UPPER(BTRIM(mss.employee_code::text)), mss.year_month DESC, mss.updated_at DESC NULLS LAST
),
employee_source AS (
  SELECT DISTINCT ON (UPPER(BTRIM(se.employee_code::text)))
    UPPER(BTRIM(se.employee_code::text)) AS normalized_employee_code,
    NULLIF(BTRIM(se.employee_code::text), '') AS employee_code,
    NULLIF(BTRIM(se.employee_name::text), '') AS employee_name,
    COALESCE(latest_promotion.promotion_position, latest_monthly_position.monthly_position, NULLIF(BTRIM(se.current_position::text), ''), NULLIF(BTRIM(se.position::text), '')) AS employee_position,
    se.employment_status,
    se.is_active
  FROM public.store_employees se
  LEFT JOIN latest_promotion
    ON latest_promotion.normalized_employee_code = UPPER(BTRIM(se.employee_code::text))
  LEFT JOIN latest_monthly_position
    ON latest_monthly_position.normalized_employee_code = UPPER(BTRIM(se.employee_code::text))
  WHERE NULLIF(BTRIM(se.employee_code::text), '') IS NOT NULL
  ORDER BY
    UPPER(BTRIM(se.employee_code::text)),
    CASE WHEN se.employment_status = 'active' THEN 0 ELSE 1 END,
    CASE WHEN se.is_active THEN 0 ELSE 1 END,
    se.updated_at DESC NULLS LAST
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
  SELECT DISTINCT ON (UPPER(BTRIM(emh.employee_code::text)))
    UPPER(BTRIM(emh.employee_code::text)) AS normalized_employee_code,
    NULLIF(BTRIM(emh.new_value::text), '') AS promotion_position
  FROM public.employee_movement_history emh
  WHERE emh.movement_type = 'promotion'
    AND NULLIF(BTRIM(emh.employee_code::text), '') IS NOT NULL
    AND NULLIF(BTRIM(emh.new_value::text), '') IS NOT NULL
  ORDER BY UPPER(BTRIM(emh.employee_code::text)), emh.movement_date DESC, emh.created_at DESC
),
latest_monthly_position AS (
  SELECT DISTINCT ON (UPPER(BTRIM(mss.employee_code::text)))
    UPPER(BTRIM(mss.employee_code::text)) AS normalized_employee_code,
    NULLIF(BTRIM(mss.position::text), '') AS monthly_position
  FROM public.monthly_staff_status mss
  WHERE NULLIF(BTRIM(mss.employee_code::text), '') IS NOT NULL
    AND NULLIF(BTRIM(mss.position::text), '') IS NOT NULL
  ORDER BY UPPER(BTRIM(mss.employee_code::text)), mss.year_month DESC, mss.updated_at DESC NULLS LAST
),
employee_source AS (
  SELECT DISTINCT ON (UPPER(BTRIM(se.employee_code::text)))
    UPPER(BTRIM(se.employee_code::text)) AS normalized_employee_code,
    NULLIF(BTRIM(se.employee_code::text), '') AS employee_code,
    NULLIF(BTRIM(se.employee_name::text), '') AS employee_name,
    COALESCE(latest_promotion.promotion_position, latest_monthly_position.monthly_position, NULLIF(BTRIM(se.current_position::text), ''), NULLIF(BTRIM(se.position::text), '')) AS employee_position,
    se.employment_status,
    se.is_active
  FROM public.store_employees se
  LEFT JOIN latest_promotion
    ON latest_promotion.normalized_employee_code = UPPER(BTRIM(se.employee_code::text))
  LEFT JOIN latest_monthly_position
    ON latest_monthly_position.normalized_employee_code = UPPER(BTRIM(se.employee_code::text))
  WHERE NULLIF(BTRIM(se.employee_code::text), '') IS NOT NULL
  ORDER BY
    UPPER(BTRIM(se.employee_code::text)),
    CASE WHEN se.employment_status = 'active' THEN 0 ELSE 1 END,
    CASE WHEN se.is_active THEN 0 ELSE 1 END,
    se.updated_at DESC NULLS LAST
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
  SELECT DISTINCT ON (UPPER(BTRIM(se.employee_code::text)))
    UPPER(BTRIM(se.employee_code::text)) AS normalized_employee_code,
    NULLIF(BTRIM(se.employee_code::text), '') AS employee_code
  FROM public.store_employees se
  WHERE NULLIF(BTRIM(se.employee_code::text), '') IS NOT NULL
  ORDER BY UPPER(BTRIM(se.employee_code::text)), se.updated_at DESC NULLS LAST
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
