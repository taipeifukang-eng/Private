-- M7/M8 第 4.5 批追加 F7（2026-11-20 驗收問卷）：逾 14 天未送出的請款草稿提醒（DEV）。
-- 內容：
--   1. 內部輔助 ga_pay_stale_draft_ids()：草稿（DRAFT）且「放著的天數」大於 14 天的請款單 id。放著的天數 = 台北今天 − 台北日期（最近一次退回時間，沒有退回過就用建立時間）；
--      編輯草稿不會重新計時，被退回的草稿從退回那天重新計算。單一 SQL 述詞（可被規劃器內嵌）；首頁待辦、列表篩選共用同一個述詞，數字必等於點進去的列表筆數。
--   2. ga_hm_counts 新增 pay_stale_draft（需請款檢視／管理，與 pay_submitted 同一個區塊）；ga_ws_home_summary 新增待辦「逾 14 天未送出的請款草稿」（最多 5 筆，最久的在前；導向 payment_requests）。
--   3. ga_ws_pay_request_list 新增篩選 stale_draft（'true' 或 '1'），並在 global 回 stale_draft_count。
--   導覽徽章（ga_ws_home_badges 的 payment_requests）維持「待付款（SUBMITTED）」不變：徽章與選單連結的列表篩選是一對一（status = SUBMITTED），把草稿併進同一個數字會讓徽章與列表筆數對不上。
--   以讀現行定義再文字替換擴充 3 個函式（已套用就略過，形狀不符就中止）。
-- 先決：20261119160000（ga_hm_counts 的 pay_submitted 區塊、ga_ws_home_summary 的 pay_submitted 待辦）、20261119150000。
-- 還原：20261120120000_m7m8_b45f_stale_draft.rollback.sql。可重複執行。
DO $$
BEGIN
  IF to_regclass('public.ga_payment_requests') IS NULL OR to_regprocedure('public.ga_pay_can_view(uuid)') IS NULL OR to_regprocedure('public.ga_po_today()') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: 請先套用 20261119110000、20261119150000';
  END IF;
  IF position('pay_submitted' IN pg_get_functiondef('public.ga_hm_counts()'::regprocedure)) = 0 OR position('pay_submitted' IN pg_get_functiondef('public.ga_ws_home_summary()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'Missing prerequisite: 請先套用 20261119160000_m7m8_b45_analysis';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ga_b45f_swap(p_text text, p_old text, p_new text, p_label text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
BEGIN
  IF position(p_old IN p_text) = 0 THEN RAISE EXCEPTION '函式形狀與預期不符，找不到要替換的文字（%）：%', p_label, left(p_old, 80); END IF;
  RETURN replace(p_text, p_old, p_new);
END;
$f$;

CREATE OR REPLACE FUNCTION public.ga_pay_stale_draft_ids() RETURNS TABLE (id uuid) LANGUAGE sql STABLE
AS $f$
  SELECT q.id FROM public.ga_payment_requests q
   WHERE q.status = 'DRAFT'
     AND ((now() AT TIME ZONE 'Asia/Taipei')::date - (COALESCE(q.last_return_at, q.created_at) AT TIME ZONE 'Asia/Taipei')::date) > 14;
$f$;
REVOKE ALL ON FUNCTION public.ga_pay_stale_draft_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ga_pay_stale_draft_ids() TO service_role;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_hm_counts()$a$::regprocedure);
  IF position($a$pay_stale_draft$a$ IN v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45f_swap(v_new, $a$    v_out := v_out || jsonb_build_object('pay_submitted', v_n);$a$, $a$    v_out := v_out || jsonb_build_object('pay_submitted', v_n);
    SELECT count(*) INTO v_n FROM public.ga_pay_stale_draft_ids();
    v_out := v_out || jsonb_build_object('pay_stale_draft', v_n);$a$, $a$ga_hm_counts()$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_hm_counts() 沒有任何變更'; END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_ws_home_summary()$a$::regprocedure);
  IF position($a$pay_stale_draft$a$ IN v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45f_swap(v_new, $a$'label', '待付款請款單', 'menu', 'payment_requests', 'count', (v_c ->> 'pay_submitted')::integer, 'top', v_top));
  END IF;$a$, $a$'label', '待付款請款單', 'menu', 'payment_requests', 'count', (v_c ->> 'pay_submitted')::integer, 'top', v_top));
  END IF;
  IF v_c ? 'pay_stale_draft' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.pr_no, 'sub', COALESCE(x.vendor_name_snapshot, '') || '　NT$ ' || x.amount_total::text || '　已放 ' || x.days::text || ' 天', 'at', x.since) ORDER BY x.since, x.id), '[]'::jsonb) INTO v_top
      FROM (SELECT q.id, q.pr_no, q.vendor_name_snapshot, q.amount_total, COALESCE(q.last_return_at, q.created_at) AS since, (public.ga_po_today() - (COALESCE(q.last_return_at, q.created_at) AT TIME ZONE 'Asia/Taipei')::date) AS days
              FROM public.ga_payment_requests q WHERE q.id IN (SELECT s.id FROM public.ga_pay_stale_draft_ids() s) ORDER BY COALESCE(q.last_return_at, q.created_at), q.id LIMIT 5) x;
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'pay_stale_draft', 'label', '逾 14 天未送出的請款草稿', 'menu', 'payment_requests', 'count', (v_c ->> 'pay_stale_draft')::integer, 'top', v_top));
  END IF;$a$, $a$ga_ws_home_summary()$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_ws_home_summary() 沒有任何變更'; END IF;
  EXECUTE v_new;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef($a$public.ga_ws_pay_request_list(jsonb,integer,integer)$a$::regprocedure);
  IF position($a$v_stale$a$ IN v_def) > 0 THEN RETURN; END IF;
  v_new := v_def;
  v_new := public.ga_b45f_swap(v_new, $a$  v_mine boolean := COALESCE(v_f ->> 'mine', '') IN ('true', '1');$a$, $a$  v_mine boolean := COALESCE(v_f ->> 'mine', '') IN ('true', '1');
  v_stale boolean := COALESCE(v_f ->> 'stale_draft', '') IN ('true', '1');$a$, $a$ga_ws_pay_request_list(jsonb,integer,integer)$a$);
  v_new := public.ga_b45f_swap(v_new, $a$       AND (NOT v_mine OR q.created_by = v_uid)$a$, $a$       AND (NOT v_mine OR q.created_by = v_uid)
       AND (NOT v_stale OR q.id IN (SELECT s.id FROM public.ga_pay_stale_draft_ids() s))$a$, $a$ga_ws_pay_request_list(jsonb,integer,integer)$a$);
  v_new := public.ga_b45f_swap(v_new, $a$'draft_count', count(*) FILTER (WHERE status = 'DRAFT')) FROM public.ga_payment_requests));$a$, $a$'draft_count', count(*) FILTER (WHERE status = 'DRAFT'), 'stale_draft_count', (SELECT count(*) FROM public.ga_pay_stale_draft_ids())) FROM public.ga_payment_requests));$a$, $a$ga_ws_pay_request_list(jsonb,integer,integer)$a$);
  IF v_new = v_def THEN RAISE EXCEPTION 'public.ga_ws_pay_request_list(jsonb,integer,integer) 沒有任何變更'; END IF;
  EXECUTE v_new;
END $$;

DROP FUNCTION IF EXISTS public.ga_b45f_swap(text, text, text, text);
NOTIFY pgrst, 'reload schema';
