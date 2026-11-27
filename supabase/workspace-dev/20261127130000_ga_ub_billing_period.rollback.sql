-- 還原 20261127130000_ga_ub_billing_period.sql（計費期間）：函式還原成套用前的原版、移除兩個新函式、移除 CHECK 與四個新欄位。
--   注意：新欄位裡已填的計費期間會一併刪除，無法復原。可重複執行。
DROP FUNCTION IF EXISTS public.ga_ws_ub_prev_period(jsonb, uuid);
DROP FUNCTION IF EXISTS public.ga_ws_ub_report_details(text, integer, text);

-- 原版 ga_ws_ub_save
CREATE OR REPLACE FUNCTION public.ga_ws_ub_save(p_id uuid, p_payload jsonb, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_confirm_paid_change boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  p jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_new boolean := p_id IS NULL;
  c public.ga_utility_bills%ROWTYPE;
  b public.ga_utility_bills%ROWTYPE;
  v_type text;
  v_month date;
  v_amount numeric;
  v_kwh numeric;
  v_store uuid;
  v_store_changed boolean := false;
  v_loc text;
  v_provider text;
  v_label text;
  v_ident text;
  v_account text;
  v_serial text;
  v_ref text;
  v_notes text;
  v_due date;
  v_paid date;
  v_changed jsonb := '[]'::jsonb;
  v_dup public.ga_utility_bills%ROWTYPE;
  v_anomaly jsonb;
  v_warn jsonb := '[]'::jsonb;
  s public.stores%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_ub_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有新增或編輯水電網費的權限（需要水電話網費管理權限）'); END IF;
  IF jsonb_typeof(p) <> 'object' THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '送出的資料格式錯誤'); END IF;
  IF NOT v_new THEN
    SELECT * INTO c FROM public.ga_utility_bills WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這筆帳單'); END IF;
    IF c.deleted_at IS NOT NULL THEN RETURN public.ga_rq_err(409, 'DELETED', '這筆帳單已被刪除，不能編輯'); END IF;
    IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入後再操作'); END IF;
    IF c.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這筆帳單剛被其他人修改，請重新載入後再操作'); END IF;
  END IF;

  v_type := CASE WHEN jsonb_exists(p, 'expense_type') THEN upper(public.ga_ub_txt(p, 'expense_type', 20, '費用類型')) ELSE c.expense_type END;
  IF v_type IS NULL OR v_type NOT IN ('WATER', 'ELECTRICITY', 'PHONE', 'INTERNET') THEN RETURN public.ga_rq_err(400, 'TYPE_REQUIRED', '請選擇費用類型'); END IF;
  v_month := CASE WHEN jsonb_exists(p, 'billing_month') THEN public.ga_ub_month(public.ga_ub_txt(p, 'billing_month', 10, '帳單月份')) ELSE c.billing_month END;
  IF v_month IS NULL THEN RETURN public.ga_rq_err(400, 'MONTH_REQUIRED', '請選擇帳單月份'); END IF;
  v_amount := CASE WHEN jsonb_exists(p, 'amount') THEN public.ga_ub_num(p, 'amount', '金額', true) ELSE c.amount END;
  IF v_amount IS NULL THEN RETURN public.ga_rq_err(400, 'AMOUNT_REQUIRED', '請輸入金額'); END IF;
  v_kwh := CASE WHEN jsonb_exists(p, 'electricity_kwh') THEN public.ga_ub_num(p, 'electricity_kwh', '用電度數', false) ELSE c.electricity_kwh END;
  IF v_type <> 'ELECTRICITY' THEN v_kwh := NULL; END IF;

  -- 據點：選了門市就同步 location_name；門市沒變時保留原本的名稱（含已停用門市的舊帳單）；新選門市必須是啟用中。
  v_store := CASE WHEN jsonb_exists(p, 'store_id') THEN CASE WHEN nullif(btrim(p ->> 'store_id'), '') IS NULL THEN NULL
      WHEN (p ->> 'store_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (p ->> 'store_id')::uuid
      ELSE public.ga_ub_bad_uuid() END ELSE c.store_id END;
  v_store_changed := v_new OR v_store IS DISTINCT FROM c.store_id;
  IF v_store IS NOT NULL THEN
    SELECT * INTO s FROM public.stores WHERE id = v_store;
    IF NOT FOUND THEN RETURN public.ga_rq_err(400, 'STORE_NOT_FOUND', '找不到選擇的門市，請重新整理後再試'); END IF;
    IF v_store_changed AND s.is_active IS NOT TRUE THEN RETURN public.ga_rq_err(400, 'STORE_INACTIVE', '這間門市已停用，不能新選；請改選其他據點'); END IF;
    v_loc := CASE WHEN v_store_changed THEN public.ga_ub_store_label(v_store) ELSE c.location_name END;
  ELSE
    v_loc := CASE WHEN jsonb_exists(p, 'location_name') THEN public.ga_ub_txt(p, 'location_name', 120, '據點') ELSE c.location_name END;
  END IF;
  IF v_loc IS NULL THEN RETURN public.ga_rq_err(400, 'LOCATION_REQUIRED', '請選擇或輸入據點'); END IF;

  v_provider := CASE WHEN jsonb_exists(p, 'provider_name') THEN public.ga_ub_txt(p, 'provider_name', 120, '供應商') ELSE c.provider_name END;
  v_label := CASE WHEN jsonb_exists(p, 'service_label') THEN public.ga_ub_txt(p, 'service_label', 120, '線路名稱') ELSE c.service_label END;
  v_ident := CASE WHEN jsonb_exists(p, 'service_identifier') THEN public.ga_ub_txt(p, 'service_identifier', 200, '服務識別號碼') ELSE c.service_identifier END;
  v_account := CASE WHEN jsonb_exists(p, 'account_number') THEN public.ga_ub_txt(p, 'account_number', 200, '客戶帳號') ELSE c.account_number END;
  v_serial := CASE WHEN jsonb_exists(p, 'equipment_serial') THEN public.ga_ub_txt(p, 'equipment_serial', 200, '設備序號') ELSE c.equipment_serial END;
  IF v_type <> 'INTERNET' THEN v_serial := NULL; END IF;
  IF v_type = 'INTERNET' AND v_ident IS NULL AND v_serial IS NULL THEN RETURN public.ga_rq_err(400, 'IDENT_REQUIRED', '網路費請至少填寫電路編號或設備序號'); END IF;
  IF v_type <> 'INTERNET' AND v_ident IS NULL THEN RETURN public.ga_rq_err(400, 'IDENT_REQUIRED', '請填寫服務識別號碼（水號、電號或電話號碼）'); END IF;
  v_ref := CASE WHEN jsonb_exists(p, 'reference_no') THEN public.ga_ub_txt(p, 'reference_no', 200, '銷帳編號') ELSE c.reference_no END;
  v_notes := CASE WHEN jsonb_exists(p, 'notes') THEN public.ga_ub_txt(p, 'notes', 1000, '備註') ELSE c.notes END;
  v_due := CASE WHEN jsonb_exists(p, 'due_date') THEN public.ga_ub_date(public.ga_ub_txt(p, 'due_date', 10, '繳費期限'), '繳費期限') ELSE c.due_date END;

  -- 繳費日期：新增時可直接填；編輯時可修正日期，但不可用編輯清空（要改回待繳請用「改回待繳」）。日期或帳單月份有變動才檢查範圍（審查 A6）。
  v_paid := CASE WHEN jsonb_exists(p, 'paid_at') THEN public.ga_ub_date(public.ga_ub_txt(p, 'paid_at', 10, '繳費日期'), '繳費日期') ELSE c.paid_at END;
  IF NOT v_new AND c.paid_at IS NOT NULL AND v_paid IS NULL THEN RETURN public.ga_rq_err(400, 'USE_UNPAY', '要把已繳帳單改回待繳，請用「改回待繳」（會要求確認）'); END IF;
  IF v_paid IS NOT NULL AND (v_new OR v_paid IS DISTINCT FROM c.paid_at OR v_month IS DISTINCT FROM c.billing_month) THEN PERFORM public.ga_ub_check_paid_date(v_paid, v_month); END IF;

  -- 已繳帳單改關鍵欄位：要確認，並回原值。
  IF NOT v_new AND c.paid_at IS NOT NULL THEN
    IF v_amount IS DISTINCT FROM c.amount THEN v_changed := v_changed || to_jsonb('amount'::text); END IF;
    IF v_store IS DISTINCT FROM c.store_id OR v_loc IS DISTINCT FROM c.location_name THEN v_changed := v_changed || to_jsonb('location'::text); END IF;
    IF v_type IS DISTINCT FROM c.expense_type THEN v_changed := v_changed || to_jsonb('expense_type'::text); END IF;
    IF v_month IS DISTINCT FROM c.billing_month THEN v_changed := v_changed || to_jsonb('billing_month'::text); END IF;
    IF v_provider IS DISTINCT FROM c.provider_name THEN v_changed := v_changed || to_jsonb('provider_name'::text); END IF;
    IF v_ident IS DISTINCT FROM c.service_identifier OR v_serial IS DISTINCT FROM c.equipment_serial OR v_account IS DISTINCT FROM c.account_number THEN v_changed := v_changed || to_jsonb('identifier'::text); END IF;
    IF jsonb_array_length(v_changed) > 0 AND NOT COALESCE(p_confirm_paid_change, false) THEN
      RETURN public.ga_rq_err(409, 'PAID_CHANGE_CONFIRM_REQUIRED', '這筆帳單已繳費（' || c.paid_at || '），要修改金額或識別欄位，請確認後再送出', jsonb_build_object('original', public.ga_ub_original(c), 'changed_fields', v_changed));
    END IF;
  END IF;

  -- 重複：同據點、類型、月份、供應商、識別號碼已有一筆（未刪除、排除自己）。先以 advisory lock 序列化同一組鍵，避免兩人同時新增都通過檢查（審查 A1）。
  PERFORM pg_advisory_xact_lock(hashtext('ga_ub_dup:' || COALESCE(v_store::text, '') || '|' || lower(btrim(v_loc)) || '|' || v_type || '|' || v_month::text || '|' || lower(btrim(COALESCE(v_provider, ''))) || '|' || COALESCE(public.ga_ub_ident(v_ident, v_serial, v_account), '')));
  SELECT * INTO v_dup FROM public.ga_utility_bills d
   WHERE d.deleted_at IS NULL AND (v_new OR d.id <> c.id)
     AND COALESCE(d.store_id::text, '') = COALESCE(v_store::text, '') AND lower(btrim(d.location_name)) = lower(btrim(v_loc))
     AND d.expense_type = v_type AND d.billing_month = v_month AND lower(btrim(COALESCE(d.provider_name, ''))) = lower(btrim(COALESCE(v_provider, '')))
     AND public.ga_ub_ident(d.service_identifier, d.equipment_serial, d.account_number) = public.ga_ub_ident(v_ident, v_serial, v_account)
   LIMIT 1;
  IF FOUND THEN
    RETURN public.ga_rq_err(409, 'DUPLICATE_BILL', '這個據點、費用類型、月份、供應商與識別號碼已經有一筆帳單（金額 ' || public.ga_ub_money_text(v_dup.amount) || ' 元'
      || CASE WHEN v_dup.due_date IS NOT NULL THEN '、繳費期限 ' || v_dup.due_date ELSE '' END || CASE WHEN v_dup.paid_at IS NOT NULL THEN '、已繳費' ELSE '、尚未繳費' END
      || '），請直接編輯那一筆；補收或調整請改原帳單', jsonb_build_object('existing', jsonb_build_object('id', v_dup.id, 'amount', v_dup.amount, 'billing_month', v_dup.billing_month, 'due_date', v_dup.due_date,
        'paid_at', v_dup.paid_at, 'location_name', v_dup.location_name, 'expense_type', v_dup.expense_type)));
  END IF;

  IF v_new THEN
    INSERT INTO public.ga_utility_bills (store_id, location_name, expense_type, billing_month, provider_name, service_label, service_identifier, account_number, equipment_serial, amount, electricity_kwh, due_date, paid_at, reference_no, notes)
    VALUES (v_store, v_loc, v_type, v_month, v_provider, v_label, v_ident, v_account, v_serial, v_amount, v_kwh, v_due, v_paid, v_ref, v_notes) RETURNING * INTO b;
  ELSE
    UPDATE public.ga_utility_bills SET store_id = v_store, location_name = v_loc, expense_type = v_type, billing_month = v_month, provider_name = v_provider, service_label = v_label,
      service_identifier = v_ident, account_number = v_account, equipment_serial = v_serial, amount = v_amount, electricity_kwh = v_kwh, due_date = v_due, paid_at = v_paid, reference_no = v_ref, notes = v_notes
     WHERE id = c.id RETURNING * INTO b;
  END IF;

  -- GAUP-BEGIN
  IF jsonb_exists(p, 'payee_vendor_id') THEN
    DECLARE
      v_payee uuid := public.ga_pay_uuid(p ->> 'payee_vendor_id', '繳費單位', false);
    BEGIN
      IF v_payee IS DISTINCT FROM b.payee_vendor_id THEN
        IF v_payee IS NOT NULL THEN PERFORM public.ga_ub_check_payee(v_payee); END IF;
        UPDATE public.ga_utility_bills SET payee_vendor_id = v_payee WHERE id = b.id RETURNING * INTO b;
      END IF;
    END;
  END IF;
  -- GAUP-END
  v_anomaly := public.ga_ub_anomaly(b.store_id, b.location_name, b.expense_type, public.ga_ub_ident(b.service_identifier, b.equipment_serial, b.account_number), b.billing_month, b.amount, b.id);
  IF (v_anomaly ->> 'warn')::boolean THEN v_warn := jsonb_build_array(v_anomaly); END IF;
  RETURN jsonb_build_object('ok', true, 'status', CASE WHEN v_new THEN 201 ELSE 200 END, 'data', public.ga_ub_json(b.id), 'anomaly', v_anomaly, 'warnings', v_warn);
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$function$;

-- 原版 ga_ub_json_ext
CREATE OR REPLACE FUNCTION public.ga_ub_json_ext(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'payee_vendor_id', b.payee_vendor_id,
    'payee_vendor_name', (SELECT v.name FROM public.ga_vendors v WHERE v.id = b.payee_vendor_id),
    'paid_by_pr_id', b.paid_by_pr_id,
    'paid_by_pr_no', CASE WHEN public.ga_pay_can_view(auth.uid()) THEN (SELECT q.pr_no FROM public.ga_payment_requests q WHERE q.id = b.paid_by_pr_id) END,
    'attachment_count', (SELECT count(*) FROM public.ga_resource_attachments a WHERE a.resource_type = 'UTILITY_BILL' AND a.resource_id = b.id AND a.deleted_at IS NULL),
    'payment_request', (SELECT CASE WHEN public.ga_pay_can_view(auth.uid())
                                   THEN jsonb_build_object('in_request', true, 'id', q.id, 'pr_no', q.pr_no, 'status', q.status, 'auto_mark_paid', q.auto_mark_paid)
                                   ELSE jsonb_build_object('in_request', true) END
                          FROM public.ga_payment_request_bill_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.bill_id = b.id AND l.active LIMIT 1),
    'locked', COALESCE((SELECT CASE WHEN q.auto_mark_paid THEN '["amount","payee_vendor_id","billing_month","expense_type","location","identifier","delete","paid_at"]'::jsonb
                                    ELSE '["amount","payee_vendor_id","billing_month","expense_type","location","identifier","delete"]'::jsonb END
                          FROM public.ga_payment_request_bill_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id
                         WHERE l.bill_id = b.id AND l.active AND q.status IN ('SUBMITTED', 'PAID') LIMIT 1), '[]'::jsonb))
  FROM public.ga_utility_bills b WHERE b.id = p_id;
$function$;

-- 原版 ga_pay_ub_apply_bills
CREATE OR REPLACE FUNCTION public.ga_pay_ub_apply_bills(p_pr uuid, p_vendor uuid, p_month date, p_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids uuid[];
  v_found integer;
  b public.ga_utility_bills%ROWTYPE;
  v_e jsonb;
  v_no integer := 0;
  v_sum numeric := 0;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}') INTO v_ids FROM unnest(COALESCE(p_ids, '{}')) x;
  IF cardinality(v_ids) = 0 THEN PERFORM public.ga_rq_raise(400, 'BILLS_REQUIRED', '請至少選擇一張帳單'); END IF;
  IF cardinality(v_ids) > 200 THEN PERFORM public.ga_rq_raise(400, 'TOO_MANY_BILLS', '一張請款單最多 200 張帳單'); END IF;
  PERFORM 1 FROM public.ga_utility_bills WHERE id = ANY (v_ids) ORDER BY id FOR UPDATE;
  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF v_found <> cardinality(v_ids) THEN PERFORM public.ga_rq_raise(404, 'BILL_NOT_FOUND', '有帳單找不到，請重新整理畫面後再試'); END IF;
  DELETE FROM public.ga_payment_request_bill_lines WHERE pr_id = p_pr;
  FOR b IN SELECT * FROM public.ga_utility_bills WHERE id = ANY (v_ids)
            ORDER BY location_name, expense_type, public.ga_pay_ub_ident(service_identifier, equipment_serial, account_number), id LOOP
    v_e := public.ga_pay_ub_eligible(b, p_vendor, p_month, p_pr);
    IF NOT (v_e ->> 'eligible')::boolean THEN
      PERFORM public.ga_rq_raise(409, v_e ->> 'code', public.ga_pay_ub_label(b) || '：' || (v_e ->> 'message'), jsonb_build_object('bill_id', b.id) || (v_e - 'eligible' - 'code' - 'message'));
    END IF;
    v_no := v_no + 1;
    INSERT INTO public.ga_payment_request_bill_lines (pr_id, line_no, bill_id, claim_total, store_id, location_name, expense_type, billing_month, identifier, service_label, due_date)
    VALUES (p_pr, v_no, b.id, b.amount, b.store_id, b.location_name, b.expense_type, b.billing_month, nullif(public.ga_pay_ub_ident(b.service_identifier, b.equipment_serial, b.account_number), ''), b.service_label, b.due_date);
    v_sum := v_sum + b.amount;
  END LOOP;
  IF v_sum > 999999999999 THEN PERFORM public.ga_rq_raise(400, 'AMOUNT_TOO_LARGE', '請款總額太大，請確認'); END IF;
  UPDATE public.ga_payment_requests SET amount_untaxed = v_sum, tax_amount = 0, amount_total = v_sum WHERE id = p_pr;
END;
$function$;

-- 原版 ga_pay_ub_json_ext
CREATE OR REPLACE FUNCTION public.ga_pay_ub_json_ext(p_pr uuid, p_detail boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_can boolean := public.ga_ub_can_view(auth.uid());
  v_out jsonb;
BEGIN
  SELECT jsonb_build_object('bill_count', count(*), 'line_count', count(*), 'bills_masked', NOT v_can,
      'auto_marked_count', count(*) FILTER (WHERE b.paid_by_pr_id = p_pr), 'auto_reverted_count', count(*) FILTER (WHERE l.auto_reverted_at IS NOT NULL))
    INTO v_out FROM public.ga_payment_request_bill_lines l JOIN public.ga_utility_bills b ON b.id = l.bill_id WHERE l.pr_id = p_pr;
  IF p_detail AND v_can THEN
    v_out := v_out || jsonb_build_object('bill_lines', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'line_no', l.line_no, 'bill_id', l.bill_id, 'store_id', l.store_id, 'location_name', l.location_name, 'expense_type', l.expense_type,
          'billing_month', l.billing_month, 'identifier', l.identifier, 'service_label', l.service_label, 'due_date', l.due_date, 'claim_total', l.claim_total, 'active', l.active,
          'bill_amount', b.amount, 'bill_paid_at', b.paid_at, 'bill_deleted', b.deleted_at IS NOT NULL, 'bill_paid_by_this', b.paid_by_pr_id = p_pr,
          'attachment_count', (SELECT count(*) FROM public.ga_resource_attachments a WHERE a.resource_type = 'UTILITY_BILL' AND a.resource_id = l.bill_id AND a.deleted_at IS NULL),
          'auto_paid_date', l.auto_paid_date, 'auto_reverted_at', l.auto_reverted_at, 'auto_revert_reason', l.auto_revert_reason) ORDER BY l.line_no)
        FROM public.ga_payment_request_bill_lines l JOIN public.ga_utility_bills b ON b.id = l.bill_id WHERE l.pr_id = p_pr), '[]'::jsonb));
  END IF;
  RETURN v_out;
END;
$function$;

-- 原版 ga_ws_pay_ub_candidates
CREATE OR REPLACE FUNCTION public.ga_ws_pay_ub_candidates(p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  f jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_m text := public.ga_pay_txt(f, 'month', 10, '帳單月份');
  v_month date;
  v_vendor uuid;
  v_pr uuid;
  v_can boolean;
  v_v public.ga_vendors%ROWTYPE;
  v_np integer;
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看請款單的權限'); END IF;
  IF v_m IS NULL OR v_m !~ '^[0-9]{4}-(0[1-9]|1[0-2])(-01)?$' THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '請選擇帳單月份（YYYY-MM）'); END IF;
  v_month := (substr(v_m, 1, 7) || '-01')::date;
  v_vendor := public.ga_pay_uuid(f ->> 'vendor_id', '繳費單位', false);
  v_pr := public.ga_pay_uuid(f ->> 'pr_id', '請款單', false);
  v_can := public.ga_ub_can_view(v_uid);
  SELECT count(*) INTO v_np FROM public.ga_utility_bills b WHERE b.billing_month = v_month AND b.deleted_at IS NULL AND b.paid_at IS NULL AND b.payee_vendor_id IS NULL;
  IF v_vendor IS NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('vendor_id', y.vid, 'vendor_name', y.vname, 'vendor_status', y.vstatus, 'bill_count', y.n, 'eligible_count', y.ok_n, 'eligible_amount', y.ok_amt) ORDER BY y.vname, y.vid), '[]'::jsonb)
      INTO v_out FROM (
        SELECT v.id AS vid, v.name AS vname, v.status AS vstatus, count(*) AS n, count(*) FILTER (WHERE x.ok) AS ok_n, COALESCE(sum(x.amount) FILTER (WHERE x.ok), 0) AS ok_amt
          FROM (SELECT b.payee_vendor_id AS vid, b.amount, (public.ga_pay_ub_eligible(b, b.payee_vendor_id, v_month, v_pr) ->> 'eligible')::boolean AS ok
                  FROM public.ga_utility_bills b WHERE b.billing_month = v_month AND b.deleted_at IS NULL AND b.payee_vendor_id IS NOT NULL) x
          JOIN public.ga_vendors v ON v.id = x.vid GROUP BY v.id, v.name, v.status) y;
    RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('month', v_month, 'payees', v_out, 'no_payee_count', v_np, 'bills_masked', NOT v_can));
  END IF;
  SELECT * INTO v_v FROM public.ga_vendors WHERE id = v_vendor;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'VENDOR_NOT_FOUND', '找不到這個繳費單位'); END IF;
  SELECT jsonb_build_object('bill_count', count(*), 'eligible_count', count(*) FILTER (WHERE x.ok), 'eligible_amount', COALESCE(sum(x.amount) FILTER (WHERE x.ok), 0))
    INTO v_out FROM (SELECT b.amount, (public.ga_pay_ub_eligible(b, v_vendor, v_month, v_pr) ->> 'eligible')::boolean AS ok FROM public.ga_utility_bills b
                      WHERE b.payee_vendor_id = v_vendor AND b.billing_month = v_month AND b.deleted_at IS NULL) x;
  v_out := v_out || jsonb_build_object('month', v_month, 'vendor', jsonb_build_object('id', v_v.id, 'name', v_v.name, 'status', v_v.status), 'no_payee_count', v_np, 'bills_masked', NOT v_can);
  IF v_can THEN
    v_out := v_out || jsonb_build_object('bills', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', b.id, 'store_id', b.store_id, 'location_name', b.location_name, 'expense_type', b.expense_type, 'billing_month', b.billing_month,
          'identifier', nullif(public.ga_pay_ub_ident(b.service_identifier, b.equipment_serial, b.account_number), ''), 'service_label', b.service_label, 'amount', b.amount, 'due_date', b.due_date, 'paid_at', b.paid_at,
          'attachment_count', (SELECT count(*) FROM public.ga_resource_attachments a WHERE a.resource_type = 'UTILITY_BILL' AND a.resource_id = b.id AND a.deleted_at IS NULL),
          'eligible', (e.j ->> 'eligible')::boolean, 'code', e.j ->> 'code', 'reason', e.j ->> 'message', 'pr_no', e.j ->> 'pr_no')
        ORDER BY b.location_name, b.expense_type, public.ga_pay_ub_ident(b.service_identifier, b.equipment_serial, b.account_number), b.id)
        FROM public.ga_utility_bills b CROSS JOIN LATERAL (SELECT public.ga_pay_ub_eligible(b, v_vendor, v_month, v_pr) AS j) e
       WHERE b.payee_vendor_id = v_vendor AND b.billing_month = v_month AND b.deleted_at IS NULL), '[]'::jsonb));
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', v_out);
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$function$;

ALTER TABLE public.ga_utility_bills DROP CONSTRAINT IF EXISTS ga_utility_bills_service_period_check;
ALTER TABLE public.ga_utility_bills DROP COLUMN IF EXISTS service_period_start;
ALTER TABLE public.ga_utility_bills DROP COLUMN IF EXISTS service_period_end;
ALTER TABLE public.ga_payment_request_bill_lines DROP COLUMN IF EXISTS service_period_start;
ALTER TABLE public.ga_payment_request_bill_lines DROP COLUMN IF EXISTS service_period_end;
NOTIFY pgrst, 'reload schema';
