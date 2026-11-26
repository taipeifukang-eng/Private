-- 水電話費請款（G46）階段 3：請款單核心（DEV；正式區草稿 ga-utility-payment-sql/03 內容相同）。
-- 內容：
--   1. 內部輔助：ga_pay_ub_eligible（帳單能不能請款，建立、重新帶入、送出三處共用的同一支判斷）、ga_pay_ub_excluded_stats（沒有可請款帳單時的原因統計）、
--      ga_pay_ub_apply_bills（鎖帳單、逐張驗證、寫明細與快照、重算金額）、ga_pay_ub_json_ext（請款單 JSON 的水電欄位與明細）。
--   2. 送出前檢查觸發器 ga_pay_ub_submit_check（BEFORE UPDATE OF status，只在水電單 DRAFT→SUBMITTED）：兩個權限、鎖帳單、逐張重驗、金額快照比對（BILL_CHANGED）、每張帳單至少一個附件（BILL_MISSING_ATTACHMENT，整張擋下並列清單）。
--   3. 狀態同步觸發器 ga_pay_ub_sync（AFTER UPDATE OF status，只在水電單狀態變化）：送出且勾自動標記→帳單標已繳（繳費日期＝台北今天，記錄 paid_by_pr_id）；
--      退回、作廢→只回復 paid_by_pr_id＝本單的帳單；作廢→釋放明細（active=false）；會計標已付款→帳單不動。
--   4. 對外函式：ga_ws_pay_ub_candidates（候選）、ga_ws_pay_ub_create、ga_ws_pay_ub_update、ga_ws_pay_export_ub（水電對帳列）。
-- 先決：20261124100000、20261124110000。可重複執行。不新增權限碼、不授權給任何角色。
-- 還原：20261124120000_ga_utility_payment_request_core.rollback.sql。

DO $$
BEGIN
  IF to_regclass('public.ga_payment_request_bill_lines') IS NULL OR to_regprocedure('public.ga_ub_check_payee(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: 請先套用 20261124100000 與 20261124110000';
  END IF;
  IF to_regprocedure('public.ga_pay_request_json(uuid,boolean,boolean,boolean)') IS NULL OR to_regprocedure('public.ga_next_pr_no()') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: 第 4.5 批請款單函式（ga_pay_request_json、ga_next_pr_no）';
  END IF;
END $$;

-- ================================================================ 1. 內部輔助
-- 帳單能不能放進請款單（水電單 p_pr 本身的明細不算「在別張請款單」）；回 {eligible, code, message, pr_no?}。
CREATE OR REPLACE FUNCTION public.ga_pay_ub_eligible(b public.ga_utility_bills, p_vendor uuid, p_month date, p_pr uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_name text;
  v_other text;
BEGIN
  IF b.deleted_at IS NOT NULL THEN RETURN jsonb_build_object('eligible', false, 'code', 'BILL_DELETED', 'message', '這筆帳單已被刪除，不能請款'); END IF;
  IF b.payee_vendor_id IS NULL THEN RETURN jsonb_build_object('eligible', false, 'code', 'BILL_NO_PAYEE', 'message', '這筆帳單還沒有指定繳費單位，請先到水電帳單補填'); END IF;
  IF b.payee_vendor_id <> p_vendor THEN
    SELECT name INTO v_name FROM public.ga_vendors WHERE id = p_vendor;
    RETURN jsonb_build_object('eligible', false, 'code', 'BILL_PAYEE_MISMATCH', 'message', '這筆帳單的繳費單位不是 ' || COALESCE(v_name, '這張請款單的繳費單位'));
  END IF;
  IF b.billing_month <> p_month THEN
    RETURN jsonb_build_object('eligible', false, 'code', 'BILL_MONTH_MISMATCH', 'message', '這筆帳單是 ' || to_char(b.billing_month, 'YYYY-MM') || ' 月，不能放進 ' || to_char(p_month, 'YYYY-MM') || ' 月的請款單');
  END IF;
  IF b.paid_at IS NOT NULL THEN RETURN jsonb_build_object('eligible', false, 'code', 'BILL_ALREADY_PAID', 'message', '這筆帳單已標記已繳（' || b.paid_at || '），不需要再請款'); END IF;
  IF b.amount <= 0 THEN RETURN jsonb_build_object('eligible', false, 'code', 'BILL_AMOUNT_INVALID', 'message', '0 元帳單不需要請款'); END IF;
  IF b.amount <> trunc(b.amount) THEN RETURN jsonb_build_object('eligible', false, 'code', 'BILL_AMOUNT_INVALID', 'message', '金額有小數，請先到水電帳單修正'); END IF;
  SELECT q.pr_no INTO v_other FROM public.ga_payment_request_bill_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id
   WHERE l.bill_id = b.id AND l.active AND (p_pr IS NULL OR l.pr_id <> p_pr) LIMIT 1;
  IF v_other IS NOT NULL THEN RETURN jsonb_build_object('eligible', false, 'code', 'BILL_IN_OTHER_REQUEST', 'message', '這筆帳單已在請款單 ' || v_other || ' 內', 'pr_no', v_other); END IF;
  RETURN jsonb_build_object('eligible', true);
END;
$$;

-- 該單位該月全部（未刪除）帳單依「不能請款的原因」分組的張數（NO_BILLS 的說明用）。
CREATE OR REPLACE FUNCTION public.ga_pay_ub_excluded_stats(p_vendor uuid, p_month date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(jsonb_object_agg(x.code, x.n), '{}'::jsonb) FROM (
    SELECT public.ga_pay_ub_eligible(b, p_vendor, p_month, NULL) ->> 'code' AS code, count(*) AS n
      FROM public.ga_utility_bills b WHERE b.payee_vendor_id = p_vendor AND b.billing_month = p_month AND b.deleted_at IS NULL
     GROUP BY 1) x WHERE x.code IS NOT NULL;
$$;

-- 鎖帳單（依 id 排序）、逐張驗證、整批取代請款單明細（草稿）、快照帳單欄位、重算金額。任何一張不能請款就整批回復並指出是哪一張。
CREATE OR REPLACE FUNCTION public.ga_pay_ub_apply_bills(p_pr uuid, p_vendor uuid, p_month date, p_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
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
$$;

-- 請款單 JSON 的水電欄位（ga_pay_request_json 加掛）：帳單張數、遮蔽旗標、自動標記與回復張數；有水電檢視權限者且 p_detail 時另附 bill_lines。
CREATE OR REPLACE FUNCTION public.ga_pay_ub_json_ext(p_pr uuid, p_detail boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
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
$$;

-- ================================================================ 2. 送出前檢查
CREATE OR REPLACE FUNCTION public.ga_pay_ub_submit_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  l public.ga_payment_request_bill_lines%ROWTYPE;
  b public.ga_utility_bills%ROWTYPE;
  v_e jsonb;
  v_missing jsonb := '[]'::jsonb;
  v_labels text[] := '{}';
  v_n integer;
BEGIN
  IF v_uid IS NULL THEN PERFORM public.ga_rq_raise(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN PERFORM public.ga_rq_raise(403, 'PERMISSION_DENIED', '沒有送出請款單的權限（需要請款管理權限）'); END IF;
  IF NOT public.ga_ub_can_manage(v_uid) THEN PERFORM public.ga_rq_raise(403, 'PERMISSION_DENIED', '沒有送出水電話費請款單的權限（需要請款管理與水電網費管理兩個權限）'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ga_payment_request_bill_lines WHERE pr_id = NEW.id) THEN PERFORM public.ga_rq_raise(400, 'LINES_REQUIRED', '請款單沒有任何明細，不能送出'); END IF;
  -- 鎖順序固定：請款單（呼叫端已鎖）→ 帳單（依 id）。帳單端函式只鎖帳單列、不回頭鎖請款單，不會死結。
  PERFORM 1 FROM public.ga_utility_bills WHERE id IN (SELECT x.bill_id FROM public.ga_payment_request_bill_lines x WHERE x.pr_id = NEW.id) ORDER BY id FOR UPDATE;
  FOR l IN SELECT * FROM public.ga_payment_request_bill_lines WHERE pr_id = NEW.id ORDER BY line_no LOOP
    SELECT * INTO b FROM public.ga_utility_bills WHERE id = l.bill_id;
    v_e := public.ga_pay_ub_eligible(b, NEW.vendor_id, NEW.bill_month, NEW.id);
    IF NOT (v_e ->> 'eligible')::boolean THEN
      PERFORM public.ga_rq_raise(409, v_e ->> 'code', public.ga_pay_ub_label(b) || '：' || (v_e ->> 'message') || '。請把它從請款單移除後再送出', jsonb_build_object('bill_id', b.id) || (v_e - 'eligible' - 'code' - 'message'));
    END IF;
    IF b.amount <> l.claim_total THEN
      PERFORM public.ga_rq_raise(409, 'BILL_CHANGED', public.ga_pay_ub_label(b) || '：帳單金額已被修改（請款單是 ' || public.ga_pay_money(l.claim_total) || ' 元，帳單現在是 ' || public.ga_pay_money(b.amount) || ' 元），請在請款單按「重新帶入」', jsonb_build_object('bill_id', b.id));
    END IF;
    SELECT count(*) INTO v_n FROM public.ga_resource_attachments a WHERE a.resource_type = 'UTILITY_BILL' AND a.resource_id = b.id AND a.deleted_at IS NULL;
    IF v_n = 0 THEN
      v_missing := v_missing || jsonb_build_object('bill_id', b.id, 'location_name', b.location_name, 'expense_type', b.expense_type, 'identifier', nullif(public.ga_pay_ub_ident(b.service_identifier, b.equipment_serial, b.account_number), ''),
        'billing_month', b.billing_month, 'amount', b.amount);
      v_labels := v_labels || public.ga_pay_ub_label(b);
    END IF;
  END LOOP;
  IF jsonb_array_length(v_missing) > 0 THEN
    PERFORM public.ga_rq_raise(409, 'BILL_MISSING_ATTACHMENT', '有 ' || jsonb_array_length(v_missing) || ' 張帳單還沒有附件（帳單照片或 PDF），請先上傳：' || array_to_string(v_labels[1:10], '、') || CASE WHEN array_length(v_labels, 1) > 10 THEN ' 等' ELSE '' END,
      jsonb_build_object('missing_bills', v_missing));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ga_pay_ub_submit_check ON public.ga_payment_requests;
CREATE TRIGGER trg_ga_pay_ub_submit_check BEFORE UPDATE OF status ON public.ga_payment_requests FOR EACH ROW
  WHEN (OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED' AND NEW.source = 'UTILITY') EXECUTE FUNCTION public.ga_pay_ub_submit_check();

-- ================================================================ 3. 自動標記已繳與回復（單一入口，與狀態變更同一交易）
CREATE OR REPLACE FUNCTION public.ga_pay_ub_sync() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_today date := public.ga_po_today();
  v_ids uuid[];
  v_reason text;
BEGIN
  IF NEW.source <> 'UTILITY' OR OLD.status = NEW.status THEN RETURN NULL; END IF;
  -- 同步情境旗標：只在這個交易內有效，讓帳單觸發器放行「只改繳費狀態」的寫入（會計沒有水電管理權限也要能回復）。
  PERFORM set_config('ga.ub_sync_pr', NEW.id::text, true);
  IF OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED' THEN
    IF NEW.auto_mark_paid THEN
      PERFORM 1 FROM public.ga_utility_bills WHERE id IN (SELECT x.bill_id FROM public.ga_payment_request_bill_lines x WHERE x.pr_id = NEW.id) ORDER BY id FOR UPDATE;
      UPDATE public.ga_utility_bills SET paid_at = v_today, paid_by_pr_id = NEW.id WHERE id IN (SELECT x.bill_id FROM public.ga_payment_request_bill_lines x WHERE x.pr_id = NEW.id);
      UPDATE public.ga_payment_request_bill_lines SET auto_paid_date = v_today, auto_reverted_at = NULL, auto_revert_reason = NULL WHERE pr_id = NEW.id;
    END IF;
  ELSIF (OLD.status = 'SUBMITTED' AND NEW.status = 'DRAFT') OR NEW.status = 'VOID' THEN
    v_reason := CASE WHEN NEW.status = 'VOID' THEN 'VOID' ELSE 'RETURN' END;
    -- 只回復「因這張請款單自動標記」的帳單；手動標記或手動改過的（paid_by_pr_id 已被清空或指向別張）不動
    SELECT array_agg(b.id ORDER BY b.id) INTO v_ids FROM public.ga_utility_bills b
     WHERE b.paid_by_pr_id = NEW.id AND b.id IN (SELECT x.bill_id FROM public.ga_payment_request_bill_lines x WHERE x.pr_id = NEW.id);
    IF v_ids IS NOT NULL THEN
      PERFORM 1 FROM public.ga_utility_bills WHERE id = ANY (v_ids) ORDER BY id FOR UPDATE;
      UPDATE public.ga_utility_bills SET paid_at = NULL, paid_by_pr_id = NULL WHERE id = ANY (v_ids) AND paid_by_pr_id = NEW.id;
      UPDATE public.ga_payment_request_bill_lines SET auto_reverted_at = now(), auto_revert_reason = v_reason WHERE pr_id = NEW.id AND bill_id = ANY (v_ids);
    END IF;
    IF NEW.status = 'VOID' THEN UPDATE public.ga_payment_request_bill_lines SET active = false WHERE pr_id = NEW.id AND active; END IF;
  END IF;
  PERFORM set_config('ga.ub_sync_pr', '', true);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_ga_pay_ub_sync ON public.ga_payment_requests;
CREATE TRIGGER trg_ga_pay_ub_sync AFTER UPDATE OF status ON public.ga_payment_requests FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.source = 'UTILITY') EXECUTE FUNCTION public.ga_pay_ub_sync();

-- ================================================================ 4. 對外函式
-- 候選：沒指定單位＝各公用事業單位該月的張數與可請款金額（加未指定繳費單位的張數）；指定單位＝該單位該月全部帳單，每張標可請款或不可請款原因。
-- 帳單明細需水電檢視；只有請款檢視者只看到張數與總額。p_filters：month（YYYY-MM，必填）、vendor_id、pr_id（編輯草稿時，本單的帳單不算「在別張請款單」）。
CREATE OR REPLACE FUNCTION public.ga_ws_pay_ub_candidates(p_filters jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
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
$$;

-- 建立水電請款單（草稿）：需請款管理＋水電管理；未帶 bill_ids＝自動帶入該單位該月全部可請款帳單；固定識別沿用採購做法（同識別同內容回原結果、內容不同 409）。
CREATE OR REPLACE FUNCTION public.ga_ws_pay_ub_create(p_payload jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  p jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_key text := nullif(btrim(COALESCE(p_key, '')), '');
  v_hash text;
  q public.ga_payment_requests%ROWTYPE;
  v_vendor uuid;
  v_snap jsonb;
  v_pay date;
  v_notes text;
  v_m text;
  v_month date;
  v_auto boolean := true;
  v_ids uuid[];
  v_name text;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有建立請款單的權限（需要請款管理權限）'); END IF;
  IF NOT public.ga_ub_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有建立水電話費請款單的權限（需要水電網費管理權限）'); END IF;
  IF v_key IS NULL OR char_length(v_key) > 64 THEN RETURN public.ga_rq_err(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少防重複識別碼，請重新整理畫面後再送出'); END IF;
  IF jsonb_typeof(p) <> 'object' THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '送出的資料格式錯誤'); END IF;
  v_hash := md5(p::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('ga_pay_request_create:' || v_key, 0));
  SELECT * INTO q FROM public.ga_payment_requests WHERE idempotency_key = v_key;
  IF FOUND THEN
    IF q.payload_hash = v_hash AND q.created_by = v_uid THEN
      RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', true, 'data', public.ga_pay_request_json(q.id, public.ga_pay_can_vendor(v_uid), public.ga_po_can_view(v_uid), true));
    END IF;
    RETURN public.ga_rq_err(409, 'IDEMPOTENCY_CONFLICT', '這個送出識別碼已被另一張不同內容的請款單使用，請重新整理畫面後再送出');
  END IF;
  v_vendor := public.ga_pay_uuid(p ->> 'vendor_id', '繳費單位', true);
  v_m := public.ga_pay_txt(p, 'bill_month', 10, '帳單月份');
  IF v_m IS NULL OR v_m !~ '^[0-9]{4}-(0[1-9]|1[0-2])(-01)?$' THEN RETURN public.ga_rq_err(400, 'FIELD_REQUIRED', '請選擇帳單月份（YYYY-MM）'); END IF;
  v_month := (substr(v_m, 1, 7) || '-01')::date;
  PERFORM public.ga_ub_check_payee(v_vendor);
  IF p ? 'auto_mark_paid' AND jsonb_typeof(p -> 'auto_mark_paid') <> 'null' THEN
    IF jsonb_typeof(p -> 'auto_mark_paid') <> 'boolean' THEN RETURN public.ga_rq_err(400, 'FIELD_TYPE', '送出後帳單自動標記已繳的選項格式錯誤'); END IF;
    v_auto := (p ->> 'auto_mark_paid')::boolean;
  END IF;
  IF p ? 'bill_ids' AND jsonb_typeof(p -> 'bill_ids') <> 'null' THEN
    IF jsonb_typeof(p -> 'bill_ids') <> 'array' THEN RETURN public.ga_rq_err(400, 'FIELD_TYPE', '帳單清單格式錯誤'); END IF;
    SELECT COALESCE(array_agg(public.ga_pay_uuid(x, '帳單', true)), '{}') INTO v_ids FROM jsonb_array_elements_text(p -> 'bill_ids') x;
  END IF;
  v_snap := public.ga_pay_vendor_snapshot(v_vendor);
  v_pay := public.ga_pay_date(p ->> 'expected_pay_date', '預計付款日');
  v_notes := public.ga_pay_txt(p, 'notes', 500, '備註');
  INSERT INTO public.ga_payment_requests (pr_no, vendor_id, vendor_name_snapshot, vendor_tax_id_snapshot, bank_snapshot, status, expected_pay_date, notes, idempotency_key, payload_hash, created_by, updated_by, source, bill_month, auto_mark_paid)
  VALUES (public.ga_next_pr_no(), v_vendor, v_snap ->> 'name', v_snap ->> 'tax_id', v_snap -> 'bank', 'DRAFT', v_pay, v_notes, v_key, v_hash, v_uid, v_uid, 'UTILITY', v_month, v_auto) RETURNING * INTO q;
  IF v_ids IS NULL THEN
    SELECT array_agg(b.id) INTO v_ids FROM public.ga_utility_bills b
     WHERE b.payee_vendor_id = v_vendor AND b.billing_month = v_month AND (public.ga_pay_ub_eligible(b, v_vendor, v_month, q.id) ->> 'eligible')::boolean;
    IF v_ids IS NULL THEN
      SELECT name INTO v_name FROM public.ga_vendors WHERE id = v_vendor;
      PERFORM public.ga_rq_raise(409, 'NO_BILLS', COALESCE(v_name, '這個繳費單位') || ' ' || to_char(v_month, 'YYYY-MM') || ' 月沒有可以請款的帳單', jsonb_build_object('excluded', public.ga_pay_ub_excluded_stats(v_vendor, v_month)));
    END IF;
  END IF;
  PERFORM public.ga_pay_ub_apply_bills(q.id, v_vendor, v_month, v_ids);
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = q.id;
  PERFORM public.ga_pay_event(q.id, 'create', NULL, 'DRAFT', v_uid, NULL, q.amount_total, jsonb_build_object('source', 'UTILITY', 'bill_month', v_month, 'line_count', (SELECT count(*) FROM public.ga_payment_request_bill_lines WHERE pr_id = q.id), 'auto_mark_paid', v_auto), NULL);
  RETURN jsonb_build_object('ok', true, 'status', 201, 'replay', false, 'data', public.ga_pay_request_json(q.id, public.ga_pay_can_vendor(v_uid), public.ga_po_can_view(v_uid), true));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 修改水電請款單草稿：bill_ids（整批取代並重新快照）、refresh=true（只重新帶入目前帳單金額）、auto_mark_paid、expected_pay_date、notes；需請款管理＋水電管理與 expected_updated_at。
CREATE OR REPLACE FUNCTION public.ga_ws_pay_ub_update(p_id uuid, p_payload jsonb, p_expected_updated_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  p jsonb := COALESCE(p_payload, '{}'::jsonb);
  q public.ga_payment_requests%ROWTYPE;
  v_pay date;
  v_notes text;
  v_auto boolean;
  v_ids uuid[];
  v_replaced boolean := false;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有修改請款單的權限（需要請款管理權限）'); END IF;
  IF NOT public.ga_ub_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有修改水電話費請款單的權限（需要水電網費管理權限）'); END IF;
  IF jsonb_typeof(p) <> 'object' THEN RETURN public.ga_rq_err(400, 'BAD_PAYLOAD', '送出的資料格式錯誤'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入後再儲存'); END IF;
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張請款單'); END IF;
  IF q.source <> 'UTILITY' THEN RETURN public.ga_rq_err(409, 'SOURCE_MISMATCH', '這張是採購請款單，不能用水電話費請款單的方式修改'); END IF;
  IF p ? 'lines' THEN RETURN public.ga_rq_err(409, 'SOURCE_MISMATCH', '水電話費請款單沒有採購明細，請用 bill_ids 指定帳單'); END IF;
  IF q.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張請款單剛被其他人修改，請重新載入後再儲存'); END IF;
  IF q.status <> 'DRAFT' THEN
    RETURN public.ga_rq_err(409, 'INVALID_STATE', CASE q.status WHEN 'SUBMITTED' THEN '這張請款單已送出，要修改請先退回草稿' WHEN 'PAID' THEN '這張請款單已付款，內容鎖定，只能加備註或作廢' ELSE '這張請款單已作廢，不能修改' END, jsonb_build_object('current_status', q.status));
  END IF;
  v_pay := CASE WHEN p ? 'expected_pay_date' THEN public.ga_pay_date(p ->> 'expected_pay_date', '預計付款日') ELSE q.expected_pay_date END;
  v_notes := CASE WHEN p ? 'notes' THEN public.ga_pay_txt(p, 'notes', 500, '備註') ELSE q.notes END;
  v_auto := q.auto_mark_paid;
  IF p ? 'auto_mark_paid' THEN
    IF jsonb_typeof(p -> 'auto_mark_paid') <> 'boolean' THEN RETURN public.ga_rq_err(400, 'FIELD_TYPE', '送出後帳單自動標記已繳的選項格式錯誤'); END IF;
    v_auto := (p ->> 'auto_mark_paid')::boolean;
  END IF;
  IF p ? 'bill_ids' THEN
    IF jsonb_typeof(p -> 'bill_ids') <> 'array' THEN RETURN public.ga_rq_err(400, 'FIELD_TYPE', '帳單清單格式錯誤'); END IF;
    SELECT COALESCE(array_agg(public.ga_pay_uuid(x, '帳單', true)), '{}') INTO v_ids FROM jsonb_array_elements_text(p -> 'bill_ids') x;
  ELSIF COALESCE((p ->> 'refresh')::boolean, false) THEN
    SELECT array_agg(bill_id) INTO v_ids FROM public.ga_payment_request_bill_lines WHERE pr_id = q.id;
  END IF;
  IF p ? 'bill_ids' OR COALESCE((p ->> 'refresh')::boolean, false) THEN
    PERFORM public.ga_pay_ub_apply_bills(q.id, q.vendor_id, q.bill_month, v_ids);
    v_replaced := true;
  END IF;
  UPDATE public.ga_payment_requests SET expected_pay_date = v_pay, notes = v_notes, auto_mark_paid = v_auto, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;
  PERFORM public.ga_pay_event(q.id, 'update', 'DRAFT', 'DRAFT', v_uid, NULL, q.amount_total, jsonb_build_object('lines_replaced', v_replaced, 'auto_mark_paid', v_auto), NULL);
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', public.ga_pay_request_json(q.id, public.ga_pay_can_vendor(v_uid), public.ga_po_can_view(v_uid), true));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- 水電對帳列（每張帳單一列；沒有水電檢視權限者每張請款單一列、帳單欄位留空）。廠商統編與銀行只給廠商檢視／管理。
CREATE OR REPLACE FUNCTION public.ga_ws_pay_export_ub(p_filters jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_f jsonb := COALESCE(p_filters, '{}'::jsonb);
  v_vendor uuid;
  v_month text;
  v_status text;
  v_can_vendor boolean;
  v_can_bills boolean;
  v_count integer;
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有匯出對帳資料的權限'); END IF;
  v_can_vendor := public.ga_pay_can_vendor(v_uid);
  v_can_bills := public.ga_ub_can_view(v_uid);
  v_vendor := public.ga_pay_uuid(v_f ->> 'vendor_id', '繳費單位', false);
  v_month := public.ga_pay_txt(v_f, 'month', 7, '月份');
  v_status := upper(public.ga_pay_txt(v_f, 'status', 10, '狀態'));
  IF v_month IS NULL OR v_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '請選擇要匯出的月份（YYYY-MM）'); END IF;
  IF v_status IS NOT NULL AND v_status NOT IN ('DRAFT', 'SUBMITTED', 'PAID', 'VOID') THEN RETURN public.ga_rq_err(400, 'BAD_FILTER', '狀態篩選值錯誤'); END IF;
  IF v_can_bills THEN
    SELECT count(*) INTO v_count FROM public.ga_payment_request_bill_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id
     WHERE q.source = 'UTILITY' AND to_char(q.created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM') = v_month AND (v_vendor IS NULL OR q.vendor_id = v_vendor) AND (v_status IS NULL OR q.status = v_status);
  ELSE
    SELECT count(*) INTO v_count FROM public.ga_payment_requests q
     WHERE q.source = 'UTILITY' AND to_char(q.created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM') = v_month AND (v_vendor IS NULL OR q.vendor_id = v_vendor) AND (v_status IS NULL OR q.status = v_status);
  END IF;
  IF v_count > 5000 THEN RETURN public.ga_rq_err(400, 'TOO_MANY_ROWS', '符合條件的明細有 ' || v_count || ' 筆，超過一次匯出的上限 5,000 筆，請縮小範圍（例如指定繳費單位或狀態）'); END IF;
  IF v_can_bills THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'pr_no', q.pr_no, 'status', q.status, 'created_at', q.created_at, 'vendor_name', q.vendor_name_snapshot, 'vendor_tax_id', CASE WHEN v_can_vendor THEN q.vendor_tax_id_snapshot END,
        'bank_name', CASE WHEN v_can_vendor THEN q.bank_snapshot ->> 'bank_name' END, 'bank_account', CASE WHEN v_can_vendor THEN q.bank_snapshot ->> 'bank_account' END,
        'bill_month', q.bill_month, 'location_name', l.location_name, 'expense_type', l.expense_type, 'billing_month', l.billing_month, 'identifier', l.identifier, 'service_label', l.service_label,
        'amount_total', l.claim_total, 'claim_total', l.claim_total, 'auto_mark_paid', q.auto_mark_paid, 'bills_masked', false,
        'paid_date', q.paid_date, 'pay_method', q.pay_method, 'paid_ref', q.paid_ref,
        'submitted_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = q.submitted_by), 'submitted_at', q.submitted_at,
        'paid_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = q.paid_by), 'paid_at', q.paid_at) ORDER BY q.created_at, q.pr_no, l.line_no), '[]'::jsonb)
      INTO v_rows FROM public.ga_payment_request_bill_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id
     WHERE q.source = 'UTILITY' AND to_char(q.created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM') = v_month AND (v_vendor IS NULL OR q.vendor_id = v_vendor) AND (v_status IS NULL OR q.status = v_status);
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'pr_no', q.pr_no, 'status', q.status, 'created_at', q.created_at, 'vendor_name', q.vendor_name_snapshot, 'vendor_tax_id', CASE WHEN v_can_vendor THEN q.vendor_tax_id_snapshot END,
        'bank_name', CASE WHEN v_can_vendor THEN q.bank_snapshot ->> 'bank_name' END, 'bank_account', CASE WHEN v_can_vendor THEN q.bank_snapshot ->> 'bank_account' END,
        'bill_month', q.bill_month, 'amount_total', q.amount_total, 'claim_total', q.amount_total, 'auto_mark_paid', q.auto_mark_paid, 'bills_masked', true,
        'paid_date', q.paid_date, 'pay_method', q.pay_method, 'paid_ref', q.paid_ref,
        'submitted_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = q.submitted_by), 'submitted_at', q.submitted_at,
        'paid_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = q.paid_by), 'paid_at', q.paid_at) ORDER BY q.created_at, q.pr_no), '[]'::jsonb)
      INTO v_rows FROM public.ga_payment_requests q
     WHERE q.source = 'UTILITY' AND to_char(q.created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM') = v_month AND (v_vendor IS NULL OR q.vendor_id = v_vendor) AND (v_status IS NULL OR q.status = v_status);
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('rows', v_rows, 'total', v_count, 'month', v_month, 'vendor_id', v_vendor, 'include_vendor_secret', v_can_vendor, 'source', 'UTILITY', 'bills_masked', NOT v_can_bills));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

-- ================================================================ 5. 權限：對外函式只給登入者；內部輔助與觸發器函式不開放（不授權給任何角色）
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('ga_ws_pay_ub_candidates', 'ga_ws_pay_ub_create', 'ga_ws_pay_ub_update', 'ga_ws_pay_export_ub') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('ga_pay_ub_eligible', 'ga_pay_ub_excluded_stats', 'ga_pay_ub_apply_bills', 'ga_pay_ub_json_ext', 'ga_pay_ub_submit_check', 'ga_pay_ub_sync') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
