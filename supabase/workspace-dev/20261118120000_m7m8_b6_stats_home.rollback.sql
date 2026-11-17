-- 還原 20261118120000_m7m8_b6_stats_home.sql：移除績效、採購分析、首頁與徽章函式、共用述詞、兩個索引，並把 ga_ws_po_list 的 attention 篩選拿掉（現行定義反向文字替換）。
-- 不動任何資料。
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_po_list(jsonb,integer,integer)') IS NULL THEN RETURN; END IF;
  SELECT pg_get_functiondef('public.ga_ws_po_list(jsonb,integer,integer)'::regprocedure) INTO v_def;
  IF position('v_attention' IN v_def) = 0 THEN RETURN; END IF;
  v_new := replace(v_def, E'v_approvals boolean;\n  v_attention boolean;', 'v_approvals boolean;');
  v_new := regexp_replace(v_new, E'\n  v_attention := COALESCE\\(v_f->>''attention'', ''false''\\) IN \\(''true'', ''t'', ''1''\\);', '');
  v_new := regexp_replace(v_new, E'\n       AND \\(NOT v_attention OR public\\.ga_att_po\\(o\\.status, o\\.expected_delivery_date, has_permission\\(v_uid, ''general_affairs\\.purchase_order\\.approve''\\)\\)\\)', '');
  IF position('v_attention' IN v_new) > 0 THEN
    RAISE EXCEPTION 'ga_ws_po_list 的 attention 篩選無法自動移除（定義已被改過），請人工處理';
  END IF;
  EXECUTE v_new;
END $$;

DROP FUNCTION IF EXISTS public.ga_ws_home_summary();
DROP FUNCTION IF EXISTS public.ga_ws_home_badges();
DROP FUNCTION IF EXISTS public.ga_hm_counts();
DROP FUNCTION IF EXISTS public.ga_ws_purchase_analysis(text, integer, integer);
DROP FUNCTION IF EXISTS public.ga_ws_vendor_perf(text, text);
DROP FUNCTION IF EXISTS public.ga_att_po(text, date, boolean);
DROP FUNCTION IF EXISTS public.ga_att_po_overdue(text, date);
DROP FUNCTION IF EXISTS public.ga_att_transfer_overdue(text, timestamptz, integer);
DROP FUNCTION IF EXISTS public.ga_att_store_wait(text);
DROP FUNCTION IF EXISTS public.ga_att_request_intake(text);
DROP INDEX IF EXISTS public.idx_ga_purchase_orders_vendor_ordered;
DROP INDEX IF EXISTS public.idx_maintenance_requests_vendor_reported;

NOTIFY pgrst, 'reload schema';
