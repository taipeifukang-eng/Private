-- 還原 20261127100000_ga_auto_pay_due.sql（付款日到期自動付款）。
-- 安全規則：還有系統自動標記的已付款單、已取消自動付款的單、或已有「取消自動付款」操作紀錄就中止（操作紀錄不可刪，請先確認可以丟掉；測試資料請先用 DEV 清除函式清掉）。可重複執行。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'paid_auto') THEN
    IF EXISTS (SELECT 1 FROM public.ga_payment_requests WHERE paid_auto OR auto_pay_off) THEN
      RAISE EXCEPTION '不能撤回：還有系統自動標記已付款或已取消自動付款的請款單。';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ga_payment_request_events WHERE event_type = 'cancel_auto_pay') THEN
    RAISE EXCEPTION '不能撤回：操作紀錄裡還有「取消自動付款」的紀錄。';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ga-auto-pay-due-requests';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.ga_ws_pay_request_cancel_auto_pay(uuid, text, text, timestamptz);
DROP FUNCTION IF EXISTS public.ga_apply_due_payment_requests(date, uuid[]);
DROP FUNCTION IF EXISTS public.ga_pay_auto_pay_date(uuid);

-- 狀態機守門還原成原版
CREATE OR REPLACE FUNCTION public.ga_pay_request_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF OLD.status = 'VOID' AND (to_jsonb(NEW) - 'vendor_name_snapshot') IS DISTINCT FROM (to_jsonb(OLD) - 'vendor_name_snapshot') THEN RAISE EXCEPTION '已作廢的請款單不能再修改' USING ERRCODE = 'GA045'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND (OLD.status, NEW.status) NOT IN (('DRAFT', 'SUBMITTED'), ('DRAFT', 'VOID'), ('SUBMITTED', 'DRAFT'), ('SUBMITTED', 'PAID'), ('SUBMITTED', 'VOID'), ('PAID', 'VOID')) THEN
    RAISE EXCEPTION '請款單狀態不能從 % 改成 %', OLD.status, NEW.status USING ERRCODE = 'GA045';
  END IF;
  IF OLD.status <> 'DRAFT' AND (NEW.pr_no, NEW.vendor_id, NEW.vendor_tax_id_snapshot, NEW.bank_snapshot, NEW.amount_untaxed, NEW.tax_amount, NEW.amount_total, NEW.expected_pay_date)
       IS DISTINCT FROM (OLD.pr_no, OLD.vendor_id, OLD.vendor_tax_id_snapshot, OLD.bank_snapshot, OLD.amount_untaxed, OLD.tax_amount, OLD.amount_total, OLD.expected_pay_date) THEN
    RAISE EXCEPTION '已送出或已付款的請款單，金額、廠商與銀行資料不能修改' USING ERRCODE = 'GA045';
  END IF;
  IF OLD.status = 'PAID' AND (NEW.pay_method, NEW.paid_date, NEW.paid_ref, NEW.paid_by, NEW.paid_at) IS DISTINCT FROM (OLD.pay_method, OLD.paid_date, OLD.paid_ref, OLD.paid_by, OLD.paid_at) THEN
    RAISE EXCEPTION '已付款的請款單，付款資訊不能修改' USING ERRCODE = 'GA045';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE public.ga_payment_requests DROP CONSTRAINT IF EXISTS ga_payment_requests_paid_auto_check;
ALTER TABLE public.ga_payment_requests DROP CONSTRAINT IF EXISTS ga_payment_requests_paid_check;
ALTER TABLE public.ga_payment_requests ADD CONSTRAINT ga_payment_requests_paid_check
  CHECK (status <> 'PAID' OR (pay_method IS NOT NULL AND paid_date IS NOT NULL AND paid_by IS NOT NULL AND paid_at IS NOT NULL));
ALTER TABLE public.ga_payment_request_events DROP CONSTRAINT IF EXISTS ga_payment_request_events_type_check;
ALTER TABLE public.ga_payment_request_events ADD CONSTRAINT ga_payment_request_events_type_check
  CHECK (event_type IN ('create', 'update', 'submit', 'return', 'mark_paid', 'void', 'note', 'refresh_bank', 'prepay_refund'));
ALTER TABLE public.ga_payment_requests DROP COLUMN IF EXISTS auto_pay_off;
ALTER TABLE public.ga_payment_requests DROP COLUMN IF EXISTS paid_auto;
NOTIFY pgrst, 'reload schema';
