-- Optimize employee purchase filtered summaries.
-- The previous RPCs checked permissions inside row filters, which can become
-- expensive when a month has many POS detail rows. Check access once, then run
-- direct month/position queries that can use indexes.

DO $$
BEGIN
  IF to_regclass('public.employee_purchase_sales') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.employee_purchase_sales';
  END IF;

  IF to_regclass('public.monthly_staff_status') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.monthly_staff_status';
  END IF;

  IF to_regclass('public.stores') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.stores';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_employee_purchase_sales_month_position_staff
  ON public.employee_purchase_sales(year_month, employee_position, matched_staff_status_id);

CREATE INDEX IF NOT EXISTS idx_employee_purchase_sales_month_employee_identity
  ON public.employee_purchase_sales(year_month, employee_code, employee_name, member_code, member_name);

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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed boolean;
BEGIN
  SELECT
    public.has_permission(auth.uid(), 'employee_purchase.view')
    OR public.has_permission(auth.uid(), 'employee_purchase.import')
  INTO v_allowed;

  IF NOT COALESCE(v_allowed, false) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(NULLIF(sales.employee_position, ''), '未比對職稱')::text AS position_name,
    COUNT(*) AS sales_count,
    COUNT(DISTINCT COALESCE(NULLIF(sales.employee_code, ''), NULLIF(sales.employee_name, ''))) AS employee_count,
    COALESCE(SUM(sales.quantity), 0) AS total_quantity,
    COALESCE(SUM(sales.total_amount), 0) AS total_amount,
    COALESCE(SUM(sales.gross_profit), 0) AS gross_profit
  FROM public.employee_purchase_sales sales
  WHERE sales.year_month = p_year_month
  GROUP BY COALESCE(NULLIF(sales.employee_position, ''), '未比對職稱')
  ORDER BY COALESCE(SUM(sales.total_amount), 0) DESC;
END;
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed boolean;
  v_position text := NULLIF(p_position, '');
BEGIN
  SELECT
    public.has_permission(auth.uid(), 'employee_purchase.view')
    OR public.has_permission(auth.uid(), 'employee_purchase.import')
  INTO v_allowed;

  IF NOT COALESCE(v_allowed, false) THEN
    RETURN;
  END IF;

  IF v_position IS NULL THEN
    RETURN QUERY
    SELECT
      COUNT(*) AS total_count,
      COALESCE(SUM(sales.total_amount), 0) AS total_amount,
      COUNT(*) FILTER (WHERE sales.match_status IN ('employee_code', 'employee_name')) AS matched_count,
      COUNT(*) FILTER (WHERE sales.match_status NOT IN ('employee_code', 'employee_name')) AS unmatched_count
    FROM public.employee_purchase_sales sales
    WHERE sales.year_month = p_year_month;
  ELSIF v_position = '未比對職稱' THEN
    RETURN QUERY
    SELECT
      COUNT(*) AS total_count,
      COALESCE(SUM(sales.total_amount), 0) AS total_amount,
      COUNT(*) FILTER (WHERE sales.match_status IN ('employee_code', 'employee_name')) AS matched_count,
      COUNT(*) FILTER (WHERE sales.match_status NOT IN ('employee_code', 'employee_name')) AS unmatched_count
    FROM public.employee_purchase_sales sales
    WHERE sales.year_month = p_year_month
      AND COALESCE(NULLIF(sales.employee_position, ''), '未比對職稱') = '未比對職稱';
  ELSE
    RETURN QUERY
    SELECT
      COUNT(*) AS total_count,
      COALESCE(SUM(sales.total_amount), 0) AS total_amount,
      COUNT(*) FILTER (WHERE sales.match_status IN ('employee_code', 'employee_name')) AS matched_count,
      COUNT(*) FILTER (WHERE sales.match_status NOT IN ('employee_code', 'employee_name')) AS unmatched_count
    FROM public.employee_purchase_sales sales
    WHERE sales.year_month = p_year_month
      AND sales.employee_position = v_position;
  END IF;
END;
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_allowed boolean;
  v_position text := NULLIF(p_position, '');
BEGIN
  SELECT
    public.has_permission(auth.uid(), 'employee_purchase.view')
    OR public.has_permission(auth.uid(), 'employee_purchase.import')
  INTO v_allowed;

  IF NOT COALESCE(v_allowed, false) THEN
    RETURN;
  END IF;

  IF v_position IS NULL THEN
    RETURN QUERY
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
  ELSIF v_position = '未比對職稱' THEN
    RETURN QUERY
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
      AND COALESCE(NULLIF(sales.employee_position, ''), '未比對職稱') = '未比對職稱'
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
  ELSE
    RETURN QUERY
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
      AND sales.employee_position = v_position
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
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.employee_purchase_position_summary(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_purchase_month_stats(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_purchase_employee_summary(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
