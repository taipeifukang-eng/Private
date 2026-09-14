-- Move employee purchase summaries to Postgres to avoid Vercel gateway timeouts
-- when POS imports contain many rows.

DO $$
BEGIN
  IF to_regclass('public.employee_purchase_sales') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.employee_purchase_sales';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_employee_purchase_sales_month_match_status
  ON public.employee_purchase_sales(year_month, match_status);

CREATE INDEX IF NOT EXISTS idx_employee_purchase_sales_month_amount
  ON public.employee_purchase_sales(year_month, total_amount);

CREATE OR REPLACE FUNCTION public.employee_purchase_position_summary(
  p_year_month text
)
RETURNS TABLE (
  position_name text,
  sales_count bigint,
  employee_count bigint,
  total_quantity numeric,
  total_amount numeric,
  gross_profit numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(NULLIF(employee_position, ''), '未比對職稱') AS position_name,
    COUNT(*) AS sales_count,
    COUNT(DISTINCT COALESCE(NULLIF(employee_code, ''), NULLIF(employee_name, ''))) AS employee_count,
    COALESCE(SUM(quantity), 0) AS total_quantity,
    COALESCE(SUM(total_amount), 0) AS total_amount,
    COALESCE(SUM(gross_profit), 0) AS gross_profit
  FROM public.employee_purchase_sales
  WHERE year_month = p_year_month
    AND (
      public.has_permission(auth.uid(), 'employee_purchase.view')
      OR public.has_permission(auth.uid(), 'employee_purchase.import')
    )
  GROUP BY COALESCE(NULLIF(employee_position, ''), '未比對職稱')
  ORDER BY COALESCE(SUM(total_amount), 0) DESC;
$$;

CREATE OR REPLACE FUNCTION public.employee_purchase_month_stats(
  p_year_month text,
  p_position text DEFAULT NULL
)
RETURNS TABLE (
  total_count bigint,
  total_amount numeric,
  matched_count bigint,
  unmatched_count bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COUNT(*) AS total_count,
    COALESCE(SUM(total_amount), 0) AS total_amount,
    COUNT(*) FILTER (WHERE match_status IN ('employee_code', 'employee_name')) AS matched_count,
    COUNT(*) FILTER (WHERE match_status NOT IN ('employee_code', 'employee_name')) AS unmatched_count
  FROM public.employee_purchase_sales
  WHERE year_month = p_year_month
    AND (
      public.has_permission(auth.uid(), 'employee_purchase.view')
      OR public.has_permission(auth.uid(), 'employee_purchase.import')
    )
    AND (
      NULLIF(p_position, '') IS NULL
      OR employee_position = p_position
      OR (p_position = '未比對職稱' AND COALESCE(NULLIF(employee_position, ''), '未比對職稱') = '未比對職稱')
    );
$$;

CREATE OR REPLACE FUNCTION public.employee_purchase_employee_summary(
  p_year_month text,
  p_position text DEFAULT NULL
)
RETURNS TABLE (
  recognized_store_code text,
  recognized_store_name text,
  employee_code text,
  employee_name text,
  employee_position text,
  purchase_count bigint,
  total_amount numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(recognized_store.store_code, purchase_store.store_code, sales.store_code, '')::text AS recognized_store_code,
    COALESCE(recognized_store.store_name, purchase_store.store_name, '')::text AS recognized_store_name,
    COALESCE(NULLIF(sales.employee_code, ''), sales.member_code, '')::text AS employee_code,
    COALESCE(NULLIF(sales.employee_name, ''), sales.member_name, '')::text AS employee_name,
    COALESCE(NULLIF(sales.employee_position, ''), '未比對職稱')::text AS employee_position,
    COUNT(*) AS purchase_count,
    COALESCE(SUM(sales.total_amount), 0) AS total_amount
  FROM public.employee_purchase_sales sales
  LEFT JOIN public.monthly_staff_status staff
    ON staff.id = sales.matched_staff_status_id
  LEFT JOIN public.stores recognized_store
    ON recognized_store.id = staff.store_id
  LEFT JOIN public.stores purchase_store
    ON purchase_store.id = sales.store_id
  WHERE sales.year_month = p_year_month
    AND (
      public.has_permission(auth.uid(), 'employee_purchase.view')
      OR public.has_permission(auth.uid(), 'employee_purchase.import')
    )
    AND (
      NULLIF(p_position, '') IS NULL
      OR sales.employee_position = p_position
      OR (p_position = '未比對職稱' AND COALESCE(NULLIF(sales.employee_position, ''), '未比對職稱') = '未比對職稱')
    )
  GROUP BY
    COALESCE(recognized_store.store_code, purchase_store.store_code, sales.store_code, ''),
    COALESCE(recognized_store.store_name, purchase_store.store_name, ''),
    COALESCE(NULLIF(sales.employee_code, ''), sales.member_code, ''),
    COALESCE(NULLIF(sales.employee_name, ''), sales.member_name, ''),
    COALESCE(NULLIF(sales.employee_position, ''), '未比對職稱')
  ORDER BY
    COALESCE(recognized_store.store_code, purchase_store.store_code, sales.store_code, ''),
    COALESCE(SUM(sales.total_amount), 0) DESC,
    COALESCE(NULLIF(sales.employee_code, ''), sales.member_code, '');
$$;

GRANT EXECUTE ON FUNCTION public.employee_purchase_position_summary(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_purchase_month_stats(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_purchase_employee_summary(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
