-- 水電話費總表：年度逐月檢視（ga-ub-year-matrix）。新增唯讀函式 ga_ws_ub_year_matrix(p_year)：每家據點一列，附 1～12 月各費用類型金額。
--   口徑與 ga_ws_ub_report 相同：依帳單月份歸月（不跨月拆分）、不含已刪除帳單、每間啟用門市都列（沒帳單算 0）、其他據點名稱正規化後合併。
--   權限沿用 utility_bill.view（ga_ub_can_view）。不新增資料表、欄位、權限碼；不改任何既有函式。可重複執行。
-- 還原：20261127110000_ga_ub_year_matrix.rollback.sql
DO $$
BEGIN
  IF to_regprocedure('public.ga_ws_ub_report(text,integer,text)') IS NULL
     OR to_regprocedure('public.ga_ub_can_view(uuid)') IS NULL
     OR to_regprocedure('public.ga_ub_store_label(uuid)') IS NULL
     OR to_regprocedure('public.ga_rq_err(integer,text,text,jsonb)') IS NULL
     OR to_regprocedure('public.ga_rq_catch(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: 請先套用水電網費（G23）';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ga_ws_ub_year_matrix(p_year integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_start date;
  v_end date;
  v_rows jsonb;
  v_totals jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_ub_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看水電網費的權限'); END IF;
  IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN RETURN public.ga_rq_err(400, 'BAD_YEAR', '請選擇正確年度'); END IF;
  v_start := make_date(p_year, 1, 1); v_end := make_date(p_year + 1, 1, 1);
  WITH bills AS (
    SELECT b.store_id, b.location_name, b.expense_type, b.amount, b.created_at, b.id, extract(month FROM b.billing_month)::integer AS mon,
           CASE WHEN b.store_id IS NOT NULL THEN 's:' || b.store_id::text
                ELSE 'o:' || lower(btrim(regexp_replace(normalize(COALESCE(nullif(btrim(b.location_name), ''), '未命名據點'), NFKC), '\s+', ' ', 'g'))) END AS gkey
      FROM public.ga_utility_bills b WHERE b.deleted_at IS NULL AND b.billing_month >= v_start AND b.billing_month < v_end
  ), names AS (
    SELECT gkey, (array_agg(store_id))[1] AS store_id, (array_agg(COALESCE(nullif(btrim(location_name), ''), '未命名據點') ORDER BY created_at, id))[1] AS location_name
      FROM bills GROUP BY gkey
  ), cells AS (
    SELECT gkey, mon,
           COALESCE(sum(amount) FILTER (WHERE expense_type = 'WATER'), 0) AS water, COALESCE(sum(amount) FILTER (WHERE expense_type = 'ELECTRICITY'), 0) AS electricity,
           COALESCE(sum(amount) FILTER (WHERE expense_type = 'PHONE'), 0) AS phone, COALESCE(sum(amount) FILTER (WHERE expense_type = 'INTERNET'), 0) AS internet,
           COALESCE(sum(amount), 0) AS total, count(*) AS bill_count
      FROM bills GROUP BY gkey, mon
  ), keys AS (
    SELECT COALESCE(n.gkey, 's:' || s.id::text) AS gkey, COALESCE(n.store_id, s.id) AS store_id, n.location_name
      FROM names n FULL JOIN (SELECT id FROM public.stores WHERE is_active IS TRUE) s ON n.gkey = 's:' || s.id::text
  ), full_cells AS (
    SELECT k.gkey, g.m, COALESCE(c.water, 0) AS water, COALESCE(c.electricity, 0) AS electricity, COALESCE(c.phone, 0) AS phone, COALESCE(c.internet, 0) AS internet,
           COALESCE(c.total, 0) AS total, COALESCE(c.bill_count, 0) AS bill_count
      FROM keys k CROSS JOIN generate_series(1, 12) AS g(m) LEFT JOIN cells c ON c.gkey = k.gkey AND c.mon = g.m
  ), per_key AS (
    SELECT k.gkey, k.store_id, st.store_code,
           CASE WHEN k.store_id IS NOT NULL THEN COALESCE(public.ga_ub_store_label(k.store_id), k.location_name) ELSE k.location_name END AS location_name,
           (SELECT jsonb_agg(jsonb_build_object('WATER', f.water, 'ELECTRICITY', f.electricity, 'PHONE', f.phone, 'INTERNET', f.internet, 'total', f.total, 'bill_count', f.bill_count) ORDER BY f.m)
              FROM full_cells f WHERE f.gkey = k.gkey) AS months
      FROM keys k LEFT JOIN public.stores st ON st.id = k.store_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('store_id', p.store_id, 'store_code', p.store_code, 'location_name', p.location_name, 'months', p.months) ORDER BY p.store_code NULLS LAST, p.location_name), '[]'::jsonb)
    INTO v_rows FROM per_key p;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('WATER', t.water, 'ELECTRICITY', t.electricity, 'PHONE', t.phone, 'INTERNET', t.internet, 'total', t.total, 'bill_count', t.bill_count) ORDER BY t.m), '[]'::jsonb)
    INTO v_totals
    FROM (SELECT g.m, COALESCE(sum(b.amount) FILTER (WHERE b.expense_type = 'WATER'), 0) AS water, COALESCE(sum(b.amount) FILTER (WHERE b.expense_type = 'ELECTRICITY'), 0) AS electricity,
                 COALESCE(sum(b.amount) FILTER (WHERE b.expense_type = 'PHONE'), 0) AS phone, COALESCE(sum(b.amount) FILTER (WHERE b.expense_type = 'INTERNET'), 0) AS internet,
                 COALESCE(sum(b.amount), 0) AS total, count(b.id) AS bill_count
            FROM generate_series(1, 12) AS g(m)
            LEFT JOIN public.ga_utility_bills b ON b.deleted_at IS NULL AND b.billing_month >= v_start AND b.billing_month < v_end AND extract(month FROM b.billing_month)::integer = g.m
           GROUP BY g.m) t;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('year', p_year, 'rows', v_rows, 'month_totals', v_totals));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

REVOKE ALL ON FUNCTION public.ga_ws_ub_year_matrix(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_ub_year_matrix(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
