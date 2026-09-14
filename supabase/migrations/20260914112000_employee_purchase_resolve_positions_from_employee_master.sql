-- Resolve employee purchase positions from employee management first.
-- POS imports may have stored an older monthly_staff_status.position such as
-- 新人. Reports should prefer store_employees.current_position / position.

DO $$
BEGIN
  IF to_regclass('public.employee_purchase_sales') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.employee_purchase_sales';
  END IF;

  IF to_regclass('public.store_employees') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.store_employees';
  END IF;

  IF to_regclass('public.employee_movement_history') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.employee_movement_history';
  END IF;

  IF to_regclass('public.monthly_staff_status') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.monthly_staff_status';
  END IF;

  IF to_regclass('public.stores') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.stores';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_employee_purchase_sales_month_member_code
  ON public.employee_purchase_sales(year_month, member_code);

CREATE INDEX IF NOT EXISTS idx_store_employees_employee_code_upper
  ON public.store_employees(UPPER(BTRIM(employee_code::text)));

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
      COALESCE(latest_promotion.promotion_position, latest_monthly_position.monthly_position, NULLIF(BTRIM(se.current_position::text), ''), NULLIF(BTRIM(se.position::text), '')) AS master_position
    FROM public.store_employees se
    LEFT JOIN latest_promotion
      ON latest_promotion.normalized_employee_code = UPPER(BTRIM(se.employee_code::text))
    LEFT JOIN latest_monthly_position
      ON latest_monthly_position.normalized_employee_code = UPPER(BTRIM(se.employee_code::text))
    WHERE NULLIF(BTRIM(se.employee_code::text), '') IS NOT NULL
      AND COALESCE(latest_promotion.promotion_position, latest_monthly_position.monthly_position, NULLIF(BTRIM(se.current_position::text), ''), NULLIF(BTRIM(se.position::text), '')) IS NOT NULL
    ORDER BY
      UPPER(BTRIM(se.employee_code::text)),
      CASE WHEN se.employment_status = 'active' THEN 0 ELSE 1 END,
      CASE WHEN se.is_active THEN 0 ELSE 1 END,
      se.updated_at DESC NULLS LAST
  ),
  resolved_sales AS (
    SELECT
      sales.*,
      COALESCE(employee_source.master_position, NULLIF(sales.employee_position, ''), '未比對職稱')::text AS resolved_position
    FROM public.employee_purchase_sales sales
    LEFT JOIN employee_source
      ON UPPER(BTRIM(COALESCE(sales.employee_code, sales.member_code, ''))) = employee_source.normalized_employee_code
    WHERE sales.year_month = p_year_month
  )
  SELECT
    resolved_sales.resolved_position AS position_name,
    COUNT(*) AS sales_count,
    COUNT(DISTINCT COALESCE(NULLIF(resolved_sales.employee_code, ''), NULLIF(resolved_sales.member_code, ''), NULLIF(resolved_sales.employee_name, ''), NULLIF(resolved_sales.member_name, ''))) AS employee_count,
    COALESCE(SUM(resolved_sales.quantity), 0) AS total_quantity,
    COALESCE(SUM(resolved_sales.total_amount), 0) AS total_amount,
    COALESCE(SUM(resolved_sales.gross_profit), 0) AS gross_profit
  FROM resolved_sales
  GROUP BY resolved_sales.resolved_position
  ORDER BY COALESCE(SUM(resolved_sales.total_amount), 0) DESC;
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

  RETURN QUERY
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
      COALESCE(latest_promotion.promotion_position, latest_monthly_position.monthly_position, NULLIF(BTRIM(se.current_position::text), ''), NULLIF(BTRIM(se.position::text), '')) AS master_position
    FROM public.store_employees se
    LEFT JOIN latest_promotion
      ON latest_promotion.normalized_employee_code = UPPER(BTRIM(se.employee_code::text))
    LEFT JOIN latest_monthly_position
      ON latest_monthly_position.normalized_employee_code = UPPER(BTRIM(se.employee_code::text))
    WHERE NULLIF(BTRIM(se.employee_code::text), '') IS NOT NULL
      AND COALESCE(latest_promotion.promotion_position, latest_monthly_position.monthly_position, NULLIF(BTRIM(se.current_position::text), ''), NULLIF(BTRIM(se.position::text), '')) IS NOT NULL
    ORDER BY
      UPPER(BTRIM(se.employee_code::text)),
      CASE WHEN se.employment_status = 'active' THEN 0 ELSE 1 END,
      CASE WHEN se.is_active THEN 0 ELSE 1 END,
      se.updated_at DESC NULLS LAST
  ),
  resolved_sales AS (
    SELECT
      sales.*,
      COALESCE(employee_source.master_position, NULLIF(sales.employee_position, ''), '未比對職稱')::text AS resolved_position
    FROM public.employee_purchase_sales sales
    LEFT JOIN employee_source
      ON UPPER(BTRIM(COALESCE(sales.employee_code, sales.member_code, ''))) = employee_source.normalized_employee_code
    WHERE sales.year_month = p_year_month
  )
  SELECT
    COUNT(*) AS total_count,
    COALESCE(SUM(resolved_sales.total_amount), 0) AS total_amount,
    COUNT(*) FILTER (WHERE resolved_sales.match_status IN ('employee_code', 'employee_name')) AS matched_count,
    COUNT(*) FILTER (WHERE resolved_sales.match_status NOT IN ('employee_code', 'employee_name')) AS unmatched_count
  FROM resolved_sales
  WHERE v_position IS NULL
     OR resolved_sales.resolved_position = v_position;
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

  RETURN QUERY
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
      NULLIF(BTRIM(se.employee_code::text), '') AS master_employee_code,
      NULLIF(BTRIM(se.employee_name::text), '') AS master_employee_name,
      COALESCE(latest_promotion.promotion_position, latest_monthly_position.monthly_position, NULLIF(BTRIM(se.current_position::text), ''), NULLIF(BTRIM(se.position::text), '')) AS master_position
    FROM public.store_employees se
    LEFT JOIN latest_promotion
      ON latest_promotion.normalized_employee_code = UPPER(BTRIM(se.employee_code::text))
    LEFT JOIN latest_monthly_position
      ON latest_monthly_position.normalized_employee_code = UPPER(BTRIM(se.employee_code::text))
    WHERE NULLIF(BTRIM(se.employee_code::text), '') IS NOT NULL
      AND COALESCE(latest_promotion.promotion_position, latest_monthly_position.monthly_position, NULLIF(BTRIM(se.current_position::text), ''), NULLIF(BTRIM(se.position::text), '')) IS NOT NULL
    ORDER BY
      UPPER(BTRIM(se.employee_code::text)),
      CASE WHEN se.employment_status = 'active' THEN 0 ELSE 1 END,
      CASE WHEN se.is_active THEN 0 ELSE 1 END,
      se.updated_at DESC NULLS LAST
  ),
  monthly_staff_store AS (
    SELECT DISTINCT ON (UPPER(BTRIM(mss.employee_code::text)))
      UPPER(BTRIM(mss.employee_code::text)) AS normalized_employee_code,
      mss.store_id
    FROM public.monthly_staff_status mss
    WHERE mss.year_month = p_year_month
      AND NULLIF(BTRIM(mss.employee_code::text), '') IS NOT NULL
    ORDER BY
      UPPER(BTRIM(mss.employee_code::text)),
      CASE
        WHEN mss.monthly_status = 'transferred_out' THEN 0
        WHEN mss.monthly_status = 'transferred_in' THEN 2
        ELSE 1
      END,
      mss.updated_at DESC NULLS LAST,
      mss.created_at DESC NULLS LAST
  ),
  headquarters_store AS (
    SELECT hq.id, hq.store_code, hq.store_name
    FROM public.stores hq
    WHERE hq.store_code = '0000'
       OR hq.store_name ILIKE '%總部%'
       OR hq.store_name ILIKE '%总部%'
       OR hq.store_code ILIKE '%HQ%'
    ORDER BY
      CASE WHEN hq.store_code = '0000' THEN 0 ELSE 1 END,
      hq.store_code
    LIMIT 1
  ),
  resolved_sales AS (
    SELECT
      sales.*,
      COALESCE(employee_source.master_employee_code, NULLIF(sales.employee_code, ''), sales.member_code, '')::text AS resolved_employee_code,
      COALESCE(employee_source.master_employee_name, NULLIF(sales.employee_name, ''), sales.member_name, '')::text AS resolved_employee_name,
      COALESCE(employee_source.master_position, NULLIF(sales.employee_position, ''), '未比對職稱')::text AS resolved_position,
      COALESCE(monthly_staff_store.store_id, headquarters_store.id) AS recognized_store_id
    FROM public.employee_purchase_sales sales
    LEFT JOIN employee_source
      ON UPPER(BTRIM(COALESCE(sales.employee_code, sales.member_code, ''))) = employee_source.normalized_employee_code
    LEFT JOIN monthly_staff_store
      ON monthly_staff_store.normalized_employee_code = UPPER(BTRIM(COALESCE(employee_source.master_employee_code, sales.employee_code, sales.member_code, '')))
    LEFT JOIN headquarters_store
      ON true
    WHERE sales.year_month = p_year_month
  )
  SELECT
    COALESCE(recognized_store.store_code, '0000')::text AS recognized_store_code,
    COALESCE(recognized_store.store_name, '總部')::text AS recognized_store_name,
    resolved_sales.resolved_employee_code AS employee_code,
    resolved_sales.resolved_employee_name AS employee_name,
    resolved_sales.resolved_position AS employee_position,
    COUNT(*) AS purchase_count,
    COALESCE(SUM(resolved_sales.total_amount), 0) AS total_amount
  FROM resolved_sales
  LEFT JOIN public.stores recognized_store
    ON recognized_store.id = resolved_sales.recognized_store_id
  WHERE v_position IS NULL
     OR resolved_sales.resolved_position = v_position
  GROUP BY
    COALESCE(recognized_store.store_code, '0000'),
    COALESCE(recognized_store.store_name, '總部'),
    resolved_sales.resolved_employee_code,
    resolved_sales.resolved_employee_name,
    resolved_sales.resolved_position
  ORDER BY
    COALESCE(recognized_store.store_code, '0000'),
    COALESCE(SUM(resolved_sales.total_amount), 0) DESC,
    resolved_sales.resolved_employee_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.employee_purchase_position_summary(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_purchase_month_stats(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.employee_purchase_employee_summary(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
