-- 付款日到期自動標記已付款（ga-auto-pay-due）與「取消自動付款」。
--   1. ga_payment_requests 新增兩個欄位：paid_auto（這張已付款是系統自動標記的）、auto_pay_off（已取消自動付款，之後排程不再自動處理這張單）。
--   2. 已付款的必填檢查放寬：自動標記的單 paid_by 可以是空的（系統標記，沒有人）；其餘照舊。
--   3. 操作紀錄類型多一個 cancel_auto_pay。自動標記沿用 mark_paid，payload 帶 auto=true，原因寫「付款日到期，系統自動標記已付款」。
--   4. 狀態機守門 ga_pay_request_guard 加兩個「交易內旗標」例外（只有下面兩支函式會設旗標，旗標只在同一個交易內有效）：
--        ga.pay_auto_mark   ：排程函式把 SUBMITTED 改 PAID 並設 paid_auto = true
--        ga.pay_auto_cancel ：取消函式把「自動標記的 PAID」改回 SUBMITTED 並清掉付款欄位
--      其餘規則（作廢鎖定、金額廠商鎖定、已付款資訊鎖定、狀態轉換表）完全不變；paid_auto 不能被其他路徑改動。
--   5. ga_pay_auto_pay_date(pr)：付款日＝預計付款日 expected_pay_date；沒填時水電用所含帳單（有效明細）最早的繳費期限，採購沒有就是空（不自動）。
--   6. ga_apply_due_payment_requests(p_as_of, p_pr_ids)：只處理 SUBMITTED、沒取消過自動付款、付款日 <= 今天（台北）的單；可重複執行；
--      每張單各自一個子交易，單張失敗只略過那張並記 WARNING。paid_date＝付款日（不是執行日）、pay_method 用單上已有的（沒有記 TRANSFER）、paid_by 空白。
--      p_as_of 與 p_pr_ids 是測試用參數（排程不帶）；函式只開放給 service_role。
--   7. ga_ws_pay_request_cancel_auto_pay(id, 原因, 識別碼, 版本)：只限自動標記的 PAID，改回 SUBMITTED、清付款欄位、auto_pay_off = true、寫事件；需請款管理權限。
--   8. pg_cron：每天台北 00:05（UTC 16:05）執行排程函式（排程名 ga-auto-pay-due-requests；可重複執行；沒有 pg_cron 只丟 NOTICE）。
-- 先決：水電請款（ga_utility_payment）、ga-improve-b1 已套用。不新增權限碼、不授權給任何角色。可重複執行。
-- 還原：01-ga-auto-pay-due.rollback.sql（有自動標記或已取消自動付款的資料時中止）。
DO $$
BEGIN
  IF to_regprocedure('public.ga_pay_request_guard()') IS NULL
     OR to_regclass('public.ga_payment_request_bill_lines') IS NULL
     OR to_regprocedure('public.ga_pay_event(uuid,text,text,text,uuid,text,numeric,jsonb,text)') IS NULL
     OR to_regprocedure('public.ga_rq_err(integer,text,text,jsonb)') IS NULL
     OR to_regprocedure('public.ga_rq_catch(text,text)') IS NULL
     OR to_regprocedure('public.ga_ib1_payee_guard()') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: 請先套用請款單、水電請款與 ga-improve-b1';
  END IF;
END $$;

ALTER TABLE public.ga_payment_requests ADD COLUMN IF NOT EXISTS paid_auto boolean NOT NULL DEFAULT false;
ALTER TABLE public.ga_payment_requests ADD COLUMN IF NOT EXISTS auto_pay_off boolean NOT NULL DEFAULT false;

-- 已付款必填：自動標記的單 paid_by 可以空白。
ALTER TABLE public.ga_payment_requests DROP CONSTRAINT IF EXISTS ga_payment_requests_paid_check;
ALTER TABLE public.ga_payment_requests ADD CONSTRAINT ga_payment_requests_paid_check
  CHECK (status <> 'PAID' OR (pay_method IS NOT NULL AND paid_date IS NOT NULL AND paid_at IS NOT NULL AND (paid_by IS NOT NULL OR paid_auto)));
ALTER TABLE public.ga_payment_requests DROP CONSTRAINT IF EXISTS ga_payment_requests_paid_auto_check;
ALTER TABLE public.ga_payment_requests ADD CONSTRAINT ga_payment_requests_paid_auto_check CHECK (NOT paid_auto OR (paid_by IS NULL AND status IN ('PAID', 'VOID')));

ALTER TABLE public.ga_payment_request_events DROP CONSTRAINT IF EXISTS ga_payment_request_events_type_check;
ALTER TABLE public.ga_payment_request_events ADD CONSTRAINT ga_payment_request_events_type_check
  CHECK (event_type IN ('create', 'update', 'submit', 'return', 'mark_paid', 'void', 'note', 'refresh_bank', 'prepay_refund', 'cancel_auto_pay'));

-- 狀態機守門（在原本規則上加兩個交易內旗標例外；原有敘述不變）
CREATE OR REPLACE FUNCTION public.ga_pay_request_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_auto_mark boolean := COALESCE(current_setting('ga.pay_auto_mark', true), '') = NEW.id::text;
  v_auto_cancel boolean := COALESCE(current_setting('ga.pay_auto_cancel', true), '') = NEW.id::text AND OLD.status = 'PAID' AND NEW.status = 'SUBMITTED' AND OLD.paid_auto;
BEGIN
  IF OLD.status = 'VOID' AND (to_jsonb(NEW) - 'vendor_name_snapshot') IS DISTINCT FROM (to_jsonb(OLD) - 'vendor_name_snapshot') THEN RAISE EXCEPTION '已作廢的請款單不能再修改' USING ERRCODE = 'GA045'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT v_auto_cancel AND (OLD.status, NEW.status) NOT IN (('DRAFT', 'SUBMITTED'), ('DRAFT', 'VOID'), ('SUBMITTED', 'DRAFT'), ('SUBMITTED', 'PAID'), ('SUBMITTED', 'VOID'), ('PAID', 'VOID')) THEN
    RAISE EXCEPTION '請款單狀態不能從 % 改成 %', OLD.status, NEW.status USING ERRCODE = 'GA045';
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW.pr_no, NEW.vendor_id, NEW.vendor_tax_id_snapshot, NEW.bank_snapshot, NEW.amount_untaxed, NEW.tax_amount, NEW.amount_total, NEW.expected_pay_date)
       IS DISTINCT FROM (OLD.pr_no, OLD.vendor_id, OLD.vendor_tax_id_snapshot, OLD.bank_snapshot, OLD.amount_untaxed, OLD.tax_amount, OLD.amount_total, OLD.expected_pay_date) THEN
    RAISE EXCEPTION '已送出或已付款的請款單，金額、廠商與銀行資料不能修改' USING ERRCODE = 'GA045';
  END IF;
  IF OLD.status = 'PAID' AND NOT v_auto_cancel AND (NEW.pay_method, NEW.paid_date, NEW.paid_ref, NEW.paid_by, NEW.paid_at, NEW.paid_auto) IS DISTINCT FROM (OLD.pay_method, OLD.paid_date, OLD.paid_ref, OLD.paid_by, OLD.paid_at, OLD.paid_auto) THEN
    RAISE EXCEPTION '已付款的請款單，付款資訊不能修改' USING ERRCODE = 'GA045';
  END IF;
  -- 自動付款標記只能由排程函式設定、由取消函式清除
  IF NEW.paid_auto AND NOT OLD.paid_auto AND NOT (v_auto_mark AND OLD.status = 'SUBMITTED' AND NEW.status = 'PAID') THEN
    RAISE EXCEPTION '只有付款日到期的自動排程可以標記自動付款' USING ERRCODE = 'GA045';
  END IF;
  IF OLD.paid_auto AND NOT NEW.paid_auto AND NOT v_auto_cancel THEN
    RAISE EXCEPTION '自動付款標記只能用「取消自動付款」清除' USING ERRCODE = 'GA045';
  END IF;
  IF v_auto_cancel AND (NEW.paid_auto OR NEW.paid_date IS NOT NULL OR NEW.paid_ref IS NOT NULL OR NEW.paid_by IS NOT NULL OR NEW.paid_at IS NOT NULL OR NEW.pay_card_last4 IS DISTINCT FROM OLD.pay_card_last4 OR NEW.pay_platform IS DISTINCT FROM OLD.pay_platform) THEN
    RAISE EXCEPTION '取消自動付款必須清除付款日期、付款人與付款時間' USING ERRCODE = 'GA045';
  END IF;
  RETURN NEW;
END;
$$;

-- 付款日：預計付款日；沒填時水電用有效明細的帳單最早繳費期限（帳單現值，沒有就用明細快照）；採購沒有預計付款日就是空。
CREATE OR REPLACE FUNCTION public.ga_pay_auto_pay_date(p_pr uuid) RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(q.expected_pay_date,
    CASE WHEN q.source = 'UTILITY' THEN
      (SELECT min(COALESCE(b.due_date, l.due_date)) FROM public.ga_payment_request_bill_lines l JOIN public.ga_utility_bills b ON b.id = l.bill_id WHERE l.pr_id = q.id AND l.active)
    END)
  FROM public.ga_payment_requests q WHERE q.id = p_pr;
$$;

-- 排程函式：付款日到期且仍是已送出的請款單自動標記已付款。回傳 {ok, as_of, marked, failed, ids}。
CREATE OR REPLACE FUNCTION public.ga_apply_due_payment_requests(p_as_of date DEFAULT NULL, p_pr_ids uuid[] DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_today date := COALESCE(p_as_of, public.ga_po_today());
  r record;
  q public.ga_payment_requests%ROWTYPE;
  v_date date;
  v_method text;
  v_marked integer := 0;
  v_failed integer := 0;
  v_ids uuid[] := '{}';
BEGIN
  FOR r IN SELECT id FROM public.ga_payment_requests WHERE status = 'SUBMITTED' AND NOT auto_pay_off AND (p_pr_ids IS NULL OR id = ANY (p_pr_ids)) ORDER BY created_at, id LOOP
    BEGIN
      SELECT * INTO q FROM public.ga_payment_requests WHERE id = r.id FOR UPDATE SKIP LOCKED;
      IF NOT FOUND OR q.status <> 'SUBMITTED' OR q.auto_pay_off THEN CONTINUE; END IF;
      v_date := public.ga_pay_auto_pay_date(q.id);
      IF v_date IS NULL OR v_date > v_today THEN CONTINUE; END IF;
      v_method := COALESCE(q.pay_method, 'TRANSFER');
      PERFORM set_config('ga.pay_auto_mark', q.id::text, true);
      UPDATE public.ga_payment_requests SET status = 'PAID', pay_method = v_method, paid_date = v_date, paid_ref = NULL, paid_by = NULL, paid_at = now(), paid_auto = true, updated_at = clock_timestamp() WHERE id = q.id;
      PERFORM set_config('ga.pay_auto_mark', '', true);
      PERFORM public.ga_pay_event(q.id, 'mark_paid', 'SUBMITTED', 'PAID', NULL, '付款日到期，系統自動標記已付款', q.amount_total,
        jsonb_build_object('auto', true, 'paid_date', v_date, 'pay_method', v_method, 'pay_method_defaulted', q.pay_method IS NULL, 'as_of', v_today,
          'date_source', CASE WHEN q.expected_pay_date IS NOT NULL THEN 'expected_pay_date' ELSE 'bill_due_date' END), NULL);
      v_marked := v_marked + 1;
      v_ids := array_append(v_ids, q.id);
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE WARNING 'ga_apply_due_payment_requests：請款單 % 自動標記失敗：%', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'as_of', v_today, 'marked', v_marked, 'failed', v_failed, 'ids', to_jsonb(v_ids));
END;
$$;

-- 取消自動付款（只限系統自動標記的 PAID）：改回 SUBMITTED、清付款欄位、之後不再自動（auto_pay_off）。同識別碼重送回原結果；版本不符回 409 STALE。
CREATE OR REPLACE FUNCTION public.ga_ws_pay_request_cancel_auto_pay(p_id uuid, p_reason text, p_key text, p_expected_updated_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := nullif(btrim(COALESCE(p_key, '')), '');
  v_reason text := nullif(btrim(COALESCE(p_reason, '')), '');
  v_hash text;
  q public.ga_payment_requests%ROWTYPE;
  v_ev public.ga_payment_request_events%ROWTYPE;
  v_defaulted boolean;
  v_paid_was date;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有操作請款單的權限（需要請款管理權限）'); END IF;
  IF v_key IS NULL OR char_length(v_key) > 64 THEN RETURN public.ga_rq_err(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少防重複識別碼，請重新整理畫面後再送出'); END IF;
  IF v_reason IS NULL THEN RETURN public.ga_rq_err(400, 'REASON_REQUIRED', '請填寫取消自動付款的原因'); END IF;
  IF char_length(v_reason) > 200 THEN RETURN public.ga_rq_err(400, 'FIELD_TOO_LONG', '原因不可超過 200 個字'); END IF;
  v_hash := md5('cancel_auto_pay|' || v_reason);
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張請款單'); END IF;
  SELECT * INTO v_ev FROM public.ga_payment_request_events WHERE pr_id = q.id AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_ev.payload ->> 'hash' = v_hash THEN
      RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', true, 'data', public.ga_pay_request_json(q.id, public.ga_pay_can_vendor(v_uid), public.ga_po_can_view(v_uid), true));
    END IF;
    RETURN public.ga_rq_err(409, 'IDEMPOTENCY_CONFLICT', '這個送出識別碼已被另一個不同內容的操作使用，請重新整理畫面後再送出');
  END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入後再送出'); END IF;
  IF q.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張請款單剛被其他人修改，請重新載入後再操作'); END IF;
  IF q.status <> 'PAID' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '只有已付款的請款單可以取消自動付款，目前狀態是「' || CASE q.status WHEN 'DRAFT' THEN '草稿' WHEN 'SUBMITTED' THEN '已送出' ELSE '已作廢' END || '」', jsonb_build_object('current_status', q.status)); END IF;
  IF NOT q.paid_auto THEN RETURN public.ga_rq_err(409, 'NOT_AUTO_PAID', '這張請款單是人工標記已付款，不能取消自動付款（標錯了請作廢後重開）', jsonb_build_object('current_status', q.status)); END IF;
  SELECT (e.payload ->> 'pay_method_defaulted')::boolean INTO v_defaulted FROM public.ga_payment_request_events e
   WHERE e.pr_id = q.id AND e.event_type = 'mark_paid' AND e.payload ->> 'auto' = 'true' ORDER BY e.created_at DESC, e.id DESC LIMIT 1;
  v_paid_was := q.paid_date;
  PERFORM set_config('ga.pay_auto_cancel', q.id::text, true);
  UPDATE public.ga_payment_requests SET status = 'SUBMITTED', pay_method = CASE WHEN COALESCE(v_defaulted, false) THEN NULL ELSE pay_method END, paid_date = NULL, paid_ref = NULL, paid_by = NULL, paid_at = NULL,
    paid_auto = false, auto_pay_off = true, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;
  PERFORM set_config('ga.pay_auto_cancel', '', true);
  PERFORM public.ga_pay_event(q.id, 'cancel_auto_pay', 'PAID', 'SUBMITTED', v_uid, v_reason, q.amount_total, jsonb_build_object('hash', v_hash, 'paid_date_was', v_paid_was, 'auto_pay_off', true), v_key);
  RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', false, 'data', public.ga_pay_request_json(q.id, public.ga_pay_can_vendor(v_uid), public.ga_po_can_view(v_uid), true));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$$;

REVOKE ALL ON FUNCTION public.ga_pay_auto_pay_date(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ga_pay_auto_pay_date(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.ga_apply_due_payment_requests(date, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ga_apply_due_payment_requests(date, uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.ga_ws_pay_request_cancel_auto_pay(uuid, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ga_ws_pay_request_cancel_auto_pay(uuid, text, text, timestamptz) TO authenticated, service_role;

-- 排程：每天台北 00:05（UTC 16:05）。可重複執行：先取消同名再建立；沒有 pg_cron 只丟 NOTICE。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ga-auto-pay-due-requests';
    PERFORM cron.schedule('ga-auto-pay-due-requests', '5 16 * * *', 'SELECT public.ga_apply_due_payment_requests();');
  ELSE
    RAISE NOTICE 'pg_cron 未安裝：略過排程，請款單到期自動付款需手動呼叫 ga_apply_due_payment_requests()';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
