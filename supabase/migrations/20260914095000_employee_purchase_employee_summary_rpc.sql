-- Repair migration for environments where 20260914094000 was already applied
-- before employee_purchase_employee_summary was added.

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

GRANT EXECUTE ON FUNCTION public.employee_purchase_employee_summary(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
