-- M7/M8 第 6 批 G22 廠商績效與採購分析、G24 總務首頁與導覽徽章（DEV）。
-- 內容：
--   1. 共用「待我處理」述詞（ga_att_*）：徽章計數與列表篩選用同一組條件。
--   2. ga_ws_po_list 補 attention 篩選（待核准與逾期未到貨的聯集；現行函式以文字替換加入，已加過就略過，找不到錨點就明確報錯）。
--   3. ga_ws_vendor_perf（績效）、ga_ws_purchase_analysis（採購分析）。
--   4. ga_hm_counts（九項計數，只回呼叫者有權看的項目）、ga_ws_home_badges、ga_ws_home_summary。
--   5. 索引：maintenance_requests(vendor_id, reported_at)、ga_purchase_orders(vendor_id, ordered_at)。
--      未繳帳單到期日部分索引已在 20261118110000 建立，這裡不重複。
-- 權限語意與正式區 has_permission 相同：只看角色權限，profiles.role = 'admin' 不是後備。不新增權限碼。
-- 不改任何既有資料；可重複套用。

-- ================================================================ 0. 前置檢查
DO $$
BEGIN
  IF to_regclass('public.ga_purchase_orders') IS NULL OR to_regclass('public.ga_utility_bills') IS NULL OR to_regclass('public.ga_vendors') IS NULL
     OR to_regclass('public.maintenance_requests') IS NULL OR to_regclass('public.ga_inventory_transfers') IS NULL THEN
    RAISE EXCEPTION '缺少前置資料表（採購單、水電帳單、廠商、工單、調撥單），請先套用第 3 至第 5 批與本批 090000 至 110000';
  END IF;
  IF to_regprocedure('public.ga_ub_is_overdue(date,date,timestamptz)') IS NULL OR to_regprocedure('public.ga_vd_contract_due(text,boolean,date)') IS NULL
     OR to_regprocedure('public.ga_wo_focus(text,text)') IS NULL OR to_regprocedure('public.ga_po_today()') IS NULL
     OR to_regprocedure('public.ga_inventory_transfer_is_visible(uuid)') IS NULL OR to_regprocedure('public.ga_ws_onboarding_list(text[],text,uuid,text,integer,integer)') IS NULL THEN
    RAISE EXCEPTION '缺少前置函式（逾期、合約到期、工單焦點、貼標待辦等），請先套用前面各批';
  END IF;
END $$;

-- ================================================================ 1. 共用述詞
-- 需求單待受理（待我處理 #1）。
CREATE OR REPLACE FUNCTION public.ga_att_request_intake(p_main_status text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT p_main_status = 'PENDING_INTAKE'; $$;

-- 門市待確認或待補資料（待我處理 #5）。
CREATE OR REPLACE FUNCTION public.ga_att_store_wait(p_main_status text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT p_main_status IN ('WAITING_STORE_CONFIRMATION', 'WAITING_STORE_SUPPLEMENT'); $$;

-- 採購單逾期未到貨（待我處理 #7）：已下訂或部分到貨、有預計到貨日且早於台北今天。
CREATE OR REPLACE FUNCTION public.ga_att_po_overdue(p_status text, p_expected date) RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT p_status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND p_expected IS NOT NULL AND p_expected < public.ga_po_today(); $$;

-- 採購單選單徽章與列表 attention：待核准（呼叫者有核准權限才算）與逾期未到貨的聯集。
CREATE OR REPLACE FUNCTION public.ga_att_po(p_status text, p_expected date, p_can_approve boolean) RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT (COALESCE(p_can_approve, false) AND p_status = 'PENDING_APPROVAL') OR public.ga_att_po_overdue(p_status, p_expected); $$;

-- 調撥單逾期未收（待我處理 #4，C11）：與前端 isOverdue 同一判斷（待收貨狀態、交出時間早於「現在 − 逾期天數」，剛好 N 天整不算）。
CREATE OR REPLACE FUNCTION public.ga_att_transfer_overdue(p_status text, p_source_confirmed_at timestamptz, p_days integer) RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT p_status IN ('SOURCE_CONFIRMED', 'IN_TRANSIT') AND p_source_confirmed_at IS NOT NULL AND p_source_confirmed_at < now() - make_interval(days => COALESCE(p_days, 3)); $$;

-- ================================================================ 2. ga_ws_po_list 補 attention 篩選
DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef('public.ga_ws_po_list(jsonb,integer,integer)'::regprocedure) INTO v_def;
  IF position('v_attention' IN v_def) > 0 THEN RETURN; END IF;
  v_new := replace(v_def, 'v_approvals boolean;', E'v_approvals boolean;\n  v_attention boolean;');
  v_new := regexp_replace(v_new, '(v_approvals := COALESCE\(v_f->>''approvals'', ''false''\) IN \(''true'', ''t'', ''1''\);)',
                          E'\\1\n  v_attention := COALESCE(v_f->>''attention'', ''false'') IN (''true'', ''t'', ''1'');');
  v_new := replace(v_new, 'AND (NOT v_approvals OR o.status = ''PENDING_APPROVAL'')',
                   E'AND (NOT v_approvals OR o.status = ''PENDING_APPROVAL'')\n       AND (NOT v_attention OR public.ga_att_po(o.status, o.expected_delivery_date, has_permission(v_uid, ''general_affairs.purchase_order.approve'')))');
  IF position('v_attention boolean' IN v_new) = 0 OR position('v_attention := ' IN v_new) = 0 OR position('NOT v_attention OR' IN v_new) = 0 THEN
    RAISE EXCEPTION 'ga_ws_po_list 現行定義與預期不同（找不到 v_approvals 的宣告、設定或篩選行），請人工確認後再加 attention 篩選';
  END IF;
  EXECUTE v_new;
END $$;

-- ================================================================ 3. 廠商績效（V5）
-- p_from、p_to：YYYY-MM；預設近 12 個月（到本月）；最長 36 個月。工單以 reported_at（台北）落在區間、依 maintenance_requests.vendor_id 歸屬。
-- 完成數＝status COMPLETED 且 completion_method STORE_CONFIRMED；強制結案（ADMIN_FORCE_CLOSED）與未記方式（NULL）另計且不入平均天數；平均天數＝accepted_at 到 completed_at。
-- 採購單確定金額＝ORDERED／PARTIALLY_RECEIVED／RECEIVED／CLOSED 的含稅額，依下訂日（台北）落區間；只給有採購單檢視權限者（can_view_po_amount），其他人金額與張數為 null、只有採購單的廠商不列出。評價不顯示。沒選廠商的工單列「未指定」。
CREATE OR REPLACE FUNCTION public.ga_ws_vendor_perf(p_from text DEFAULT NULL, p_to text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := public.ga_po_today();
  v_to date;
  v_from date;
  v_start timestamptz;
  v_end timestamptz;
  v_rows jsonb;
  v_unassigned jsonb;
  v_sum jsonb;
  v_can_po boolean;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT has_permission(v_uid, 'general_affairs.cooperation_record.view') THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看合作紀錄的權限'); END IF;
  IF p_to IS NOT NULL AND btrim(p_to) <> '' AND btrim(p_to) !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RETURN public.ga_rq_err(400, 'BAD_RANGE', '結束月份格式錯誤（YYYY-MM）'); END IF;
  IF p_from IS NOT NULL AND btrim(p_from) <> '' AND btrim(p_from) !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RETURN public.ga_rq_err(400, 'BAD_RANGE', '起始月份格式錯誤（YYYY-MM）'); END IF;
  v_to := COALESCE(NULLIF(btrim(p_to), '') || '-01', to_char(v_today, 'YYYY-MM') || '-01')::date;
  v_from := COALESCE(NULLIF(btrim(p_from), '') || '-01', to_char((v_to - interval '11 months')::date, 'YYYY-MM') || '-01')::date;
  IF v_from > v_to THEN RETURN public.ga_rq_err(400, 'BAD_RANGE', '起始月份不能晚於結束月份'); END IF;
  IF (extract(year FROM v_to) - extract(year FROM v_from)) * 12 + extract(month FROM v_to) - extract(month FROM v_from) > 35 THEN
    RETURN public.ga_rq_err(400, 'RANGE_TOO_LONG', '統計區間最長 36 個月');
  END IF;
  v_start := v_from::timestamp AT TIME ZONE 'Asia/Taipei';
  v_end := (v_to + interval '1 month')::timestamp AT TIME ZONE 'Asia/Taipei';
  -- 採購單金額只給有採購單檢視權限者（ga_po_can_view）；沒有權限時金額與張數欄位回 null，且不列出只有採購單、沒有工單的廠商。
  v_can_po := public.ga_po_can_view(v_uid);

  WITH wo AS (
    SELECT m.vendor_id, m.status, m.completion_method, m.accepted_at, m.completed_at
      FROM public.maintenance_requests m WHERE m.reported_at >= v_start AND m.reported_at < v_end
  ), wo_agg AS (
    SELECT vendor_id, count(*) AS wo_count,
           count(*) FILTER (WHERE status = 'COMPLETED' AND completion_method = 'STORE_CONFIRMED') AS completed_count,
           count(*) FILTER (WHERE status = 'COMPLETED' AND completion_method = 'ADMIN_FORCE_CLOSED') AS force_closed_count,
           count(*) FILTER (WHERE status = 'COMPLETED' AND completion_method IS NULL) AS unknown_method_count,
           count(*) FILTER (WHERE status <> 'COMPLETED') AS open_count,
           avg(extract(epoch FROM (completed_at - accepted_at)) / 86400.0) FILTER (WHERE status = 'COMPLETED' AND completion_method = 'STORE_CONFIRMED' AND accepted_at IS NOT NULL AND completed_at IS NOT NULL AND completed_at >= accepted_at) AS avg_days,
           count(*) FILTER (WHERE status = 'COMPLETED' AND completion_method = 'STORE_CONFIRMED' AND accepted_at IS NOT NULL AND completed_at IS NOT NULL AND completed_at >= accepted_at) AS days_sample
      FROM wo GROUP BY vendor_id
  ), po AS (
    SELECT o.vendor_id, count(*) AS po_count, COALESCE(sum(o.total_amount), 0) AS po_amount
      FROM public.ga_purchase_orders o
     WHERE o.status IN ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED') AND o.ordered_at >= v_start AND o.ordered_at < v_end AND o.vendor_id IS NOT NULL AND v_can_po
     GROUP BY o.vendor_id
  ), merged AS (
    SELECT COALESCE(w.vendor_id, p.vendor_id) AS vendor_id, COALESCE(w.wo_count, 0) AS wo_count, COALESCE(w.completed_count, 0) AS completed_count,
           COALESCE(w.force_closed_count, 0) AS force_closed_count, COALESCE(w.unknown_method_count, 0) AS unknown_method_count, COALESCE(w.open_count, 0) AS open_count,
           w.avg_days, COALESCE(w.days_sample, 0) AS days_sample, COALESCE(p.po_count, 0) AS po_count, COALESCE(p.po_amount, 0) AS po_amount
      FROM (SELECT * FROM wo_agg WHERE vendor_id IS NOT NULL) w FULL JOIN po p ON p.vendor_id = w.vendor_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'vendor_id', m.vendor_id, 'vendor_name', v.name, 'vendor_alias', v.alias, 'vendor_status', v.status,
           'wo_count', m.wo_count, 'completed_count', m.completed_count, 'force_closed_count', m.force_closed_count, 'unknown_method_count', m.unknown_method_count,
           'open_count', m.open_count, 'avg_days', CASE WHEN m.days_sample > 0 THEN round(m.avg_days::numeric, 1) END, 'days_sample', m.days_sample,
           'po_count', CASE WHEN v_can_po THEN m.po_count END, 'po_amount', CASE WHEN v_can_po THEN m.po_amount END, 'insufficient', (m.wo_count = 0)
         ) ORDER BY m.wo_count DESC, m.po_amount DESC, v.name, m.vendor_id), '[]'::jsonb)
    INTO v_rows
    FROM merged m JOIN public.ga_vendors v ON v.id = m.vendor_id;

  SELECT jsonb_build_object(
           'wo_count', count(*),
           'completed_count', count(*) FILTER (WHERE status = 'COMPLETED' AND completion_method = 'STORE_CONFIRMED'),
           'force_closed_count', count(*) FILTER (WHERE status = 'COMPLETED' AND completion_method = 'ADMIN_FORCE_CLOSED'),
           'unknown_method_count', count(*) FILTER (WHERE status = 'COMPLETED' AND completion_method IS NULL),
           'open_count', count(*) FILTER (WHERE status <> 'COMPLETED'))
    INTO v_unassigned FROM public.maintenance_requests WHERE reported_at >= v_start AND reported_at < v_end AND vendor_id IS NULL;

  SELECT jsonb_build_object(
           'wo_total', (SELECT count(*) FROM public.maintenance_requests WHERE reported_at >= v_start AND reported_at < v_end),
           'wo_with_vendor', (SELECT count(*) FROM public.maintenance_requests WHERE reported_at >= v_start AND reported_at < v_end AND vendor_id IS NOT NULL),
           'po_amount_total', CASE WHEN v_can_po THEN (SELECT COALESCE(sum(total_amount), 0) FROM public.ga_purchase_orders WHERE status IN ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED') AND ordered_at >= v_start AND ordered_at < v_end AND vendor_id IS NOT NULL) END)
    INTO v_sum;

  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'from', to_char(v_from, 'YYYY-MM'), 'to', to_char(v_to, 'YYYY-MM'), 'generated_at', now(), 'can_view_po_amount', v_can_po, 'rows', v_rows,
    'unassigned', COALESCE(v_unassigned, jsonb_build_object('wo_count', 0, 'completed_count', 0, 'force_closed_count', 0, 'unknown_method_count', 0, 'open_count', 0)),
    'summary', v_sum, 'accumulating', COALESCE((v_sum ->> 'wo_with_vendor')::integer, 0) = 0));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- ================================================================ 4. 採購分析（Q24）
-- 以採購單為主。確定金額＝ORDERED／PARTIALLY_RECEIVED／RECEIVED／CLOSED 的含稅額，月份依下訂日（台北）；已到貨實收（未稅品項小計）另列；
-- 預估＝尚未下訂的採購單（草稿、待核准、已核准，依建立日）與舊採購評估（只列預估，沒有對應採購單的才算）。廠商以快照名稱為準；全部在資料庫彙總，不受 500 筆上限影響。
-- orders 為該月確定採購單的分頁清單（page、page_size ≤ 100）。
CREATE OR REPLACE FUNCTION public.ga_ws_purchase_analysis(p_year_month text DEFAULT NULL, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := public.ga_po_today();
  v_ym text := COALESCE(NULLIF(btrim(p_year_month), ''), to_char(v_today, 'YYYY-MM'));
  v_first date;
  v_start timestamptz;
  v_end timestamptz;
  v_page integer := GREATEST(COALESCE(p_page, 1), 1);
  v_size integer := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
  v_confirmed jsonb;
  v_by_vendor jsonb;
  v_by_store jsonb;
  v_est jsonb;
  v_legacy jsonb;
  v_orders jsonb;
  v_total integer;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT (has_permission(v_uid, 'general_affairs.purchase_review.view') OR has_permission(v_uid, 'general_affairs.purchase_review.manage')) THEN
    RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有採購分析的查看權限（需要採購評估檢視或管理）');
  END IF;
  IF v_ym !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RETURN public.ga_rq_err(400, 'BAD_MONTH', '月份格式錯誤（YYYY-MM）'); END IF;
  v_first := (v_ym || '-01')::date;
  v_start := v_first::timestamp AT TIME ZONE 'Asia/Taipei';
  v_end := (v_first + interval '1 month')::timestamp AT TIME ZONE 'Asia/Taipei';

  WITH c AS (
    SELECT o.id, o.po_no, o.status, COALESCE(o.vendor_id::text, 'name:' || COALESCE(o.vendor_name_snapshot, '')) AS vendor_key,
           COALESCE(NULLIF(btrim(o.vendor_name_snapshot), ''), v.name, '未指定供應商') AS vendor_label,
           COALESCE(st.id::text, 'unknown') AS store_key,
           COALESCE(NULLIF(btrim(COALESCE(st.store_code, '') || ' ' || COALESCE(NULLIF(btrim(st.short_name), ''), st.store_name, '')), ''), '未對應門市') AS store_label,
           o.total_amount, o.subtotal, o.tax_amount, o.ordered_at,
           COALESCE((SELECT sum(i.received_qty * i.unit_price) FROM public.ga_purchase_order_items i WHERE i.po_id = o.id), 0) AS received_amount
      FROM public.ga_purchase_orders o
      LEFT JOIN public.ga_vendors v ON v.id = o.vendor_id
      LEFT JOIN public.ga_service_requests r ON r.id = o.source_request_id
      LEFT JOIN public.stores st ON st.id = COALESCE(r.store_id, (SELECT i.target_store_id FROM public.ga_purchase_order_items i WHERE i.po_id = o.id AND i.target_store_id IS NOT NULL ORDER BY i.line_no LIMIT 1))
     WHERE o.status IN ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED') AND o.ordered_at >= v_start AND o.ordered_at < v_end
  )
  SELECT jsonb_build_object('count', count(*), 'total_amount', COALESCE(sum(total_amount), 0), 'subtotal', COALESCE(sum(subtotal), 0), 'tax_amount', COALESCE(sum(tax_amount), 0),
                            'received_amount', COALESCE(sum(received_amount), 0)),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('key', k, 'label', l, 'amount', a, 'count', n) ORDER BY a DESC, n DESC, l)
                     FROM (SELECT vendor_key AS k, (array_agg(vendor_label ORDER BY ordered_at DESC))[1] AS l, sum(total_amount) AS a, count(*) AS n FROM c GROUP BY vendor_key) x), '[]'::jsonb),
         COALESCE((SELECT jsonb_agg(jsonb_build_object('key', k, 'label', l, 'amount', a, 'count', n) ORDER BY a DESC, n DESC, l)
                     FROM (SELECT store_key AS k, (array_agg(store_label))[1] AS l, sum(total_amount) AS a, count(*) AS n FROM c GROUP BY store_key) x), '[]'::jsonb),
         count(*)::integer,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'po_no', p.po_no, 'status', p.status, 'vendor_label', p.vendor_label, 'store_label', p.store_label,
                     'total_amount', p.total_amount, 'received_amount', p.received_amount, 'ordered_at', p.ordered_at) ORDER BY p.ordered_at DESC, p.id)
                     FROM (SELECT * FROM c ORDER BY ordered_at DESC, id LIMIT v_size OFFSET (v_page - 1) * v_size) p), '[]'::jsonb)
    INTO v_confirmed, v_by_vendor, v_by_store, v_total, v_orders
    FROM c;

  SELECT jsonb_build_object('count', count(*), 'total_amount', COALESCE(sum(total_amount), 0)) INTO v_est
    FROM public.ga_purchase_orders WHERE status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED') AND created_at >= v_start AND created_at < v_end;
  SELECT jsonb_build_object('count', count(*),
           'total_amount', COALESCE(sum(COALESCE(NULLIF(r.final_amount, 0), NULLIF(r.negotiated_amount, 0), NULLIF(r.quoted_amount, 0), NULLIF(r.estimated_amount, 0), 0)), 0),
           'missing_amount_count', count(*) FILTER (WHERE COALESCE(NULLIF(r.final_amount, 0), NULLIF(r.negotiated_amount, 0), NULLIF(r.quoted_amount, 0), NULLIF(r.estimated_amount, 0), 0) = 0))
    INTO v_legacy
    FROM public.ga_purchase_reviews r
   WHERE r.decision = 'PURCHASE' AND r.deleted_at IS NULL AND r.created_at >= v_start AND r.created_at < v_end
     AND NOT EXISTS (SELECT 1 FROM public.ga_purchase_orders o WHERE o.purchase_review_id = r.id);

  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'year_month', v_ym, 'generated_at', now(), 'confirmed', v_confirmed, 'by_vendor', v_by_vendor, 'by_store', v_by_store,
    'estimated', jsonb_build_object('orders', v_est, 'legacy_reviews', v_legacy),
    'orders', v_orders, 'orders_total', v_total, 'page', v_page, 'page_size', v_size));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- ================================================================ 5. 首頁與徽章（V9，九項）
-- ga_hm_counts：只回呼叫者有權看的項目（沒有權限的鍵不出現）。每項與列表篩選共用同一組述詞：
--   request_intake／store_wait 用 ga_att_request_intake／ga_att_store_wait；bill_overdue 用 ga_ub_is_overdue；contract_due 用 ga_vd_contract_due；
--   transfer_overdue 用 ga_att_transfer_overdue＋調撥列表同一個可見性函式；po_pending／po_overdue／po_menu 用 ga_att_po*；
--   wo_store_rejected 用 ga_wo_focus；onboarding_review 直接呼叫貼標待辦列表函式取 total。
CREATE OR REPLACE FUNCTION public.ga_hm_counts() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb := '{}'::jsonb;
  v_days integer;
  v_approve boolean;
  v_po_view boolean;
  v_n integer;
BEGIN
  IF v_uid IS NULL THEN RETURN '{}'::jsonb; END IF;
  IF has_permission(v_uid, 'general_affairs.request.manage') THEN
    SELECT count(*) INTO v_n FROM public.ga_service_requests WHERE deleted_at IS NULL AND public.ga_att_request_intake(main_status);
    v_out := v_out || jsonb_build_object('request_intake', v_n);
  END IF;
  IF public.ga_ub_can_view(v_uid) THEN
    SELECT count(*) INTO v_n FROM public.ga_utility_bills WHERE public.ga_ub_is_overdue(paid_at, due_date, deleted_at);
    v_out := v_out || jsonb_build_object('bill_overdue', v_n);
  END IF;
  IF public.ga_vd_can_view(v_uid) THEN
    SELECT count(*) INTO v_n FROM public.ga_vendors WHERE public.ga_vd_contract_due(status, contract_required, contract_end_date);
    v_out := v_out || jsonb_build_object('contract_due', v_n);
  END IF;
  IF has_permission(v_uid, 'general_affairs.inventory_transfer.view') OR has_permission(v_uid, 'general_affairs.inventory_transfer.manage') THEN
    SELECT COALESCE((SELECT overdue_days FROM public.ga_inventory_transfer_settings WHERE id = true), 3) INTO v_days;
    SELECT count(*) INTO v_n FROM public.ga_inventory_transfers t
     WHERE t.deleted_at IS NULL AND public.ga_att_transfer_overdue(t.status, t.source_confirmed_at, v_days) AND public.ga_inventory_transfer_is_visible(t.id);
    v_out := v_out || jsonb_build_object('transfer_overdue', v_n);
  END IF;
  IF (has_permission(v_uid, 'general_affairs.request.confirm_own_store') OR has_permission(v_uid, 'general_affairs.request.comment_own_store'))
     AND (has_permission(v_uid, 'general_affairs.request.view_own_store') OR has_permission(v_uid, 'general_affairs.request.view_all') OR has_permission(v_uid, 'general_affairs.request.manage')) THEN
    SELECT count(*) INTO v_n FROM public.ga_service_requests r
     WHERE r.deleted_at IS NULL AND public.ga_att_store_wait(r.main_status) AND r.store_id IN (SELECT sm.store_id FROM public.store_managers sm WHERE sm.user_id = v_uid);
    v_out := v_out || jsonb_build_object('store_wait', v_n);
  END IF;
  v_approve := has_permission(v_uid, 'general_affairs.purchase_order.approve');
  v_po_view := public.ga_po_can_view(v_uid);
  IF v_approve THEN
    SELECT count(*) INTO v_n FROM public.ga_purchase_orders WHERE status = 'PENDING_APPROVAL';
    v_out := v_out || jsonb_build_object('po_pending', v_n);
  END IF;
  IF v_po_view THEN
    SELECT count(*) INTO v_n FROM public.ga_purchase_orders WHERE public.ga_att_po_overdue(status, expected_delivery_date);
    v_out := v_out || jsonb_build_object('po_overdue', v_n);
    SELECT count(*) INTO v_n FROM public.ga_purchase_orders WHERE public.ga_att_po(status, expected_delivery_date, v_approve);
    v_out := v_out || jsonb_build_object('po_menu', v_n);
  END IF;
  IF has_permission(v_uid, 'general_affairs.work_order.update') OR has_permission(v_uid, 'general_affairs.work_order.manage') THEN
    SELECT count(*) INTO v_n FROM public.maintenance_requests WHERE public.ga_wo_focus(status, progress_stage) = 'store_rejected';
    v_out := v_out || jsonb_build_object('wo_store_rejected', v_n);
  END IF;
  IF has_permission(v_uid, 'general_affairs.equipment.manage') OR has_permission(v_uid, 'general_affairs.facility.manage') THEN
    v_n := COALESCE(((public.ga_ws_onboarding_list(ARRAY['PENDING_GA_REVIEW'], NULL, NULL, NULL, 1, 0)) -> 'data' ->> 'total')::integer, 0);
    v_out := v_out || jsonb_build_object('onboarding_review', v_n);
  END IF;
  RETURN v_out;
END;
$$;

-- 導覽徽章：items（九項）、menu（各選單合計，採購單選單為待核准與逾期的聯集）、total（九項加總）。
CREATE OR REPLACE FUNCTION public.ga_ws_home_badges() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_c jsonb;
  v_total integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  v_c := public.ga_hm_counts();
  SELECT COALESCE(sum(value::integer), 0) INTO v_total FROM jsonb_each_text(v_c - 'po_menu');
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'items', v_c - 'po_menu',
    'menu', jsonb_strip_nulls(jsonb_build_object(
      'requests', v_c -> 'request_intake', 'my_reports', v_c -> 'store_wait', 'purchase_orders', v_c -> 'po_menu', 'purchase_approvals', v_c -> 'po_pending',
      'work_orders', v_c -> 'wo_store_rejected', 'vendors', v_c -> 'contract_due', 'utility_bills', v_c -> 'bill_overdue',
      'transfers', v_c -> 'transfer_overdue', 'onboarding', v_c -> 'onboarding_review')),
    'total', v_total, 'generated_at', now()));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 首頁：九項（計數與前 5 筆）、KPI、庫存提醒（負庫存、低庫存完整計數）、等門市回覆（唯讀，不計入徽章）。
CREATE OR REPLACE FUNCTION public.ga_ws_home_summary() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_c jsonb;
  v_days integer;
  v_approve boolean;
  v_items jsonb := '[]'::jsonb;
  v_top jsonb;
  v_kpi jsonb := '[]'::jsonb;
  v_inv jsonb := NULL;
  v_wait integer := NULL;
  v_total integer;
  v_n integer;
  v_amt numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  v_c := public.ga_hm_counts();
  v_approve := has_permission(v_uid, 'general_affairs.purchase_order.approve');
  SELECT COALESCE((SELECT overdue_days FROM public.ga_inventory_transfer_settings WHERE id = true), 3) INTO v_days;

  IF v_c ? 'request_intake' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.request_no || ' ' || x.title, 'sub', x.store_label, 'at', x.created_at) ORDER BY x.created_at, x.id), '[]'::jsonb) INTO v_top
      FROM (SELECT r.id, r.request_no, r.title, r.created_at, COALESCE(s.store_code || ' ' || COALESCE(NULLIF(btrim(s.short_name), ''), s.store_name), '') AS store_label
              FROM public.ga_service_requests r LEFT JOIN public.stores s ON s.id = r.store_id
             WHERE r.deleted_at IS NULL AND public.ga_att_request_intake(r.main_status) ORDER BY r.created_at, r.id LIMIT 5) x;
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'request_intake', 'label', '待受理需求單', 'menu', 'requests', 'count', (v_c ->> 'request_intake')::integer, 'top', v_top));
  END IF;
  IF v_c ? 'bill_overdue' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.location_name || ' ' || to_char(x.billing_month, 'YYYY-MM'), 'sub', 'NT$ ' || x.amount::text || '，到期 ' || x.due_date::text, 'at', x.due_date) ORDER BY x.due_date, x.id), '[]'::jsonb) INTO v_top
      FROM (SELECT b.id, b.location_name, b.billing_month, b.amount, b.due_date FROM public.ga_utility_bills b WHERE public.ga_ub_is_overdue(b.paid_at, b.due_date, b.deleted_at) ORDER BY b.due_date, b.id LIMIT 5) x;
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'bill_overdue', 'label', '逾期未繳帳單', 'menu', 'utility_bills', 'count', (v_c ->> 'bill_overdue')::integer, 'top', v_top));
  END IF;
  IF v_c ? 'contract_due' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.name, 'sub', '合約到期 ' || x.contract_end_date::text, 'at', x.contract_end_date) ORDER BY x.contract_end_date, x.id), '[]'::jsonb) INTO v_top
      FROM (SELECT v.id, v.name, v.contract_end_date FROM public.ga_vendors v WHERE public.ga_vd_contract_due(v.status, v.contract_required, v.contract_end_date) ORDER BY v.contract_end_date, v.id LIMIT 5) x;
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'contract_due', 'label', '30 天內到期合約（含已過期）', 'menu', 'vendors', 'count', (v_c ->> 'contract_due')::integer, 'top', v_top));
  END IF;
  IF v_c ? 'transfer_overdue' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.transfer_no, 'sub', '交出於 ' || to_char(x.source_confirmed_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM-DD'), 'at', x.source_confirmed_at) ORDER BY x.source_confirmed_at, x.id), '[]'::jsonb) INTO v_top
      FROM (SELECT t.id, t.transfer_no, t.source_confirmed_at FROM public.ga_inventory_transfers t
             WHERE t.deleted_at IS NULL AND public.ga_att_transfer_overdue(t.status, t.source_confirmed_at, v_days) AND public.ga_inventory_transfer_is_visible(t.id)
             ORDER BY t.source_confirmed_at, t.id LIMIT 5) x;
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'transfer_overdue', 'label', '逾期未收調撥單', 'menu', 'transfers', 'count', (v_c ->> 'transfer_overdue')::integer, 'top', v_top));
  END IF;
  IF v_c ? 'store_wait' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.request_no || ' ' || x.title, 'sub', CASE x.main_status WHEN 'WAITING_STORE_CONFIRMATION' THEN '待門市確認' ELSE '待門市補資料' END, 'at', x.updated_at) ORDER BY x.updated_at, x.id), '[]'::jsonb) INTO v_top
      FROM (SELECT r.id, r.request_no, r.title, r.main_status, r.updated_at FROM public.ga_service_requests r
             WHERE r.deleted_at IS NULL AND public.ga_att_store_wait(r.main_status) AND r.store_id IN (SELECT sm.store_id FROM public.store_managers sm WHERE sm.user_id = v_uid)
             ORDER BY r.updated_at, r.id LIMIT 5) x;
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'store_wait', 'label', '待我的門市確認或補資料', 'menu', 'my_reports', 'count', (v_c ->> 'store_wait')::integer, 'top', v_top));
  END IF;
  IF v_c ? 'po_pending' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.po_no, 'sub', COALESCE(x.vendor_name_snapshot, '') || '　NT$ ' || x.total_amount::text, 'at', x.submitted_at) ORDER BY x.submitted_at, x.id), '[]'::jsonb) INTO v_top
      FROM (SELECT o.id, o.po_no, o.vendor_name_snapshot, o.total_amount, o.submitted_at FROM public.ga_purchase_orders o WHERE o.status = 'PENDING_APPROVAL' ORDER BY o.submitted_at, o.id LIMIT 5) x;
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'po_pending', 'label', '待核准採購單', 'menu', 'purchase_approvals', 'count', (v_c ->> 'po_pending')::integer, 'top', v_top));
  END IF;
  IF v_c ? 'po_overdue' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.po_no, 'sub', COALESCE(x.vendor_name_snapshot, '') || '　預計 ' || x.expected_delivery_date::text, 'at', x.expected_delivery_date) ORDER BY x.expected_delivery_date, x.id), '[]'::jsonb) INTO v_top
      FROM (SELECT o.id, o.po_no, o.vendor_name_snapshot, o.expected_delivery_date FROM public.ga_purchase_orders o WHERE public.ga_att_po_overdue(o.status, o.expected_delivery_date) ORDER BY o.expected_delivery_date, o.id LIMIT 5) x;
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'po_overdue', 'label', '逾期未到貨採購單', 'menu', 'purchase_orders', 'count', (v_c ->> 'po_overdue')::integer, 'top', v_top));
  END IF;
  IF v_c ? 'wo_store_rejected' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.id, 'title', public.ga_wo_no(x.id) || ' ' || x.title, 'sub', '門市反映仍有問題', 'at', x.updated_at) ORDER BY x.updated_at, x.id), '[]'::jsonb) INTO v_top
      FROM (SELECT m.id, m.title, m.updated_at FROM public.maintenance_requests m WHERE public.ga_wo_focus(m.status, m.progress_stage) = 'store_rejected' ORDER BY m.updated_at, m.id LIMIT 5) x;
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'wo_store_rejected', 'label', '門市退回的工單', 'menu', 'work_orders', 'count', (v_c ->> 'wo_store_rejected')::integer, 'top', v_top));
  END IF;
  IF v_c ? 'onboarding_review' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r ->> 'id', 'title', r ->> 'name', 'sub', CASE r ->> 'asset_type' WHEN 'EQUIPMENT' THEN '設備貼標待複核' ELSE '設施貼標待複核' END, 'at', r ->> 'updated_at')), '[]'::jsonb) INTO v_top
      FROM jsonb_array_elements(COALESCE((public.ga_ws_onboarding_list(ARRAY['PENDING_GA_REVIEW'], NULL, NULL, NULL, 5, 0)) -> 'data' -> 'rows', '[]'::jsonb)) r;
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', 'onboarding_review', 'label', '貼標待複核', 'menu', 'onboarding', 'count', (v_c ->> 'onboarding_review')::integer, 'top', v_top));
  END IF;
  SELECT COALESCE(sum(value::integer), 0) INTO v_total FROM jsonb_each_text(v_c - 'po_menu');

  -- 等門市回覆（總務；唯讀，不計入徽章）
  IF has_permission(v_uid, 'general_affairs.request.manage') THEN
    SELECT count(*)::integer INTO v_wait FROM public.ga_service_requests WHERE deleted_at IS NULL AND public.ga_att_store_wait(main_status);
    SELECT count(*)::integer INTO v_n FROM public.ga_service_requests WHERE deleted_at IS NULL AND main_status NOT IN ('COMPLETED', 'REJECTED', 'CANCELED');
    v_kpi := v_kpi || jsonb_build_array(jsonb_build_object('key', 'open_requests', 'label', '未結需求單', 'value', v_n, 'unit', '張'));
  END IF;
  IF has_permission(v_uid, 'general_affairs.work_order.update') OR has_permission(v_uid, 'general_affairs.work_order.manage') THEN
    SELECT count(*)::integer INTO v_n FROM public.maintenance_requests WHERE status <> 'COMPLETED';
    v_kpi := v_kpi || jsonb_build_array(jsonb_build_object('key', 'open_work_orders', 'label', '進行中工單', 'value', v_n, 'unit', '張'));
  END IF;
  IF public.ga_po_can_view(v_uid) THEN
    SELECT count(*)::integer INTO v_n FROM public.ga_purchase_orders WHERE status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED');
    v_kpi := v_kpi || jsonb_build_array(jsonb_build_object('key', 'open_purchase_orders', 'label', '未結採購單', 'value', v_n, 'unit', '張'));
  END IF;
  IF public.ga_ub_can_view(v_uid) THEN
    SELECT count(*)::integer, COALESCE(sum(amount), 0) INTO v_n, v_amt FROM public.ga_utility_bills WHERE deleted_at IS NULL AND paid_at IS NULL;
    v_kpi := v_kpi || jsonb_build_array(jsonb_build_object('key', 'unpaid_bills', 'label', '待繳帳單', 'value', v_n, 'unit', '筆', 'amount', v_amt));
  END IF;

  -- 庫存提醒（負庫存、低庫存：狀態提醒，不計入徽章；完整計數。允許負庫存的位置屬預期，另列不算異常）
  IF has_permission(v_uid, 'general_affairs.inventory_balance.view') OR has_permission(v_uid, 'general_affairs.inventory_transaction.manage') THEN
    WITH inv AS (
      SELECT b.id, b.location_id, b.part_id, b.quantity_base, l.name AS location_name, l.allow_negative_stock, p.name AS part_name, lp.safety_stock_qty, lp.reorder_point_qty,
             CASE WHEN lp.safety_stock_qty IS NOT NULL AND b.quantity_base < lp.safety_stock_qty THEN 'red'
                  WHEN lp.reorder_point_qty IS NOT NULL AND b.quantity_base < lp.reorder_point_qty THEN 'yellow' END AS level
        FROM public.ga_inventory_balances b
        JOIN public.ga_inventory_locations l ON l.id = b.location_id AND l.deleted_at IS NULL
        LEFT JOIN public.ga_parts p ON p.id = b.part_id
        LEFT JOIN LATERAL (SELECT x.safety_stock_qty, x.reorder_point_qty FROM public.ga_inventory_location_parts x
                            WHERE x.location_id = b.location_id AND x.part_id = b.part_id AND x.deleted_at IS NULL AND x.is_active ORDER BY x.updated_at DESC LIMIT 1) lp ON true
       WHERE public.ga_inventory_balance_is_visible(b.location_id)
    )
    SELECT jsonb_build_object(
      'negative_count', (SELECT count(*) FROM inv WHERE quantity_base < 0 AND NOT allow_negative_stock),
      'negative_allowed_count', (SELECT count(*) FROM inv WHERE quantity_base < 0 AND allow_negative_stock),
      'low_red_count', (SELECT count(*) FROM inv WHERE level = 'red' AND NOT (quantity_base < 0 AND allow_negative_stock)),
      'low_yellow_count', (SELECT count(*) FROM inv WHERE level = 'yellow' AND NOT (quantity_base < 0 AND allow_negative_stock)),
      'negative_top', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'part_name', x.part_name, 'location_name', x.location_name, 'quantity', x.quantity_base) ORDER BY x.quantity_base, x.id)
                                  FROM (SELECT * FROM inv WHERE quantity_base < 0 AND NOT allow_negative_stock ORDER BY quantity_base, id LIMIT 5) x), '[]'::jsonb),
      'low_top', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'part_name', x.part_name, 'location_name', x.location_name, 'quantity', x.quantity_base, 'level', x.level,
                                  'safety', x.safety_stock_qty, 'reorder', x.reorder_point_qty) ORDER BY x.level, x.quantity_base, x.id)
                              FROM (SELECT * FROM inv WHERE level IS NOT NULL AND NOT (quantity_base < 0 AND allow_negative_stock) ORDER BY level, quantity_base, id LIMIT 5) x), '[]'::jsonb))
      INTO v_inv;
  END IF;

  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object(
    'today', public.ga_po_today(), 'generated_at', now(), 'items', v_items, 'total', v_total, 'waiting_reply', v_wait, 'kpi', v_kpi, 'inventory', v_inv));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- ================================================================ 6. 索引
CREATE INDEX IF NOT EXISTS idx_maintenance_requests_vendor_reported ON public.maintenance_requests (vendor_id, reported_at);
CREATE INDEX IF NOT EXISTS idx_ga_purchase_orders_vendor_ordered ON public.ga_purchase_orders (vendor_id, ordered_at);

-- ================================================================ 7. 授權
REVOKE ALL ON FUNCTION public.ga_att_request_intake(text), public.ga_att_store_wait(text), public.ga_att_po_overdue(text, date), public.ga_att_po(text, date, boolean),
  public.ga_att_transfer_overdue(text, timestamptz, integer), public.ga_hm_counts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_ws_vendor_perf(text, text), public.ga_ws_purchase_analysis(text, integer, integer), public.ga_ws_home_badges(), public.ga_ws_home_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_vendor_perf(text, text), public.ga_ws_purchase_analysis(text, integer, integer), public.ga_ws_home_badges(), public.ga_ws_home_summary() TO authenticated;

NOTIFY pgrst, 'reload schema';
