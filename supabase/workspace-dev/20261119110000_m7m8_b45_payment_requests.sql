-- M7/M8 第 4.5 批 B（G45）：請款單（付款申請紀錄）資料表。
-- 內容：ga_payment_requests（狀態 DRAFT／SUBMITTED／PAID／VOID，沒有核准欄位：P3 請款不核准）、ga_payment_request_lines（請款明細：採購單、進貨單、發票、請款額）、
--   ga_payment_request_events（操作紀錄，觸發器擋 UPDATE／DELETE／TRUNCATE，誰與何時都查得到：P4、P7）、ga_next_pr_no（PY-YYYYMMDD-NNN，台北日期，advisory lock 取號）、
--   ga_workflow_settings 預設列 pay_tolerance_amount = 5（尾差 5 元，P5）。
-- 三張新表啟用 RLS 且不開放任何 policy，登入者不能直接讀寫，一律走 ga_ws_pay_* 函式。
-- 先決：20261119100000_m7m8_b45_receipt_voucher（發票與進貨憑證欄位）、ga_workflow_settings。
-- 還原：20261119110000_m7m8_b45_payment_requests.rollback.sql（事件表有不可改刪觸發器，rollback 在同一交易內刪表，表一起消失，不是逐列刪除）。可重複執行。

DO $$
BEGIN
  IF to_regclass('public.ga_purchase_invoices') IS NULL OR to_regclass('public.ga_purchase_invoice_receipts') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: 請先套用 20261119100000_m7m8_b45_receipt_voucher';
  END IF;
  IF to_regclass('public.ga_workflow_settings') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: ga_workflow_settings（第 4 批 20261112110000）';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ga_payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_no text NOT NULL,
  vendor_id uuid NOT NULL REFERENCES public.ga_vendors(id),
  vendor_name_snapshot text NOT NULL,
  vendor_tax_id_snapshot text,
  bank_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT',
  amount_untaxed numeric(14,0) NOT NULL DEFAULT 0,
  tax_amount numeric(14,0) NOT NULL DEFAULT 0,
  amount_total numeric(14,0) NOT NULL DEFAULT 0,
  expected_pay_date date,
  pay_method text,
  paid_date date,
  paid_ref text,
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  paid_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  paid_at timestamptz,
  last_return_reason text,
  last_return_at timestamptz,
  void_reason text,
  voided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  voided_at timestamptz,
  notes text,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_payment_requests_pr_no_unique UNIQUE (pr_no),
  CONSTRAINT ga_payment_requests_idem_unique UNIQUE (idempotency_key),
  CONSTRAINT ga_payment_requests_status_check CHECK (status IN ('DRAFT', 'SUBMITTED', 'PAID', 'VOID')),
  CONSTRAINT ga_payment_requests_amount_check CHECK (amount_untaxed >= 0 AND tax_amount >= 0 AND amount_total = amount_untaxed + tax_amount),
  CONSTRAINT ga_payment_requests_pay_method_check CHECK (pay_method IS NULL OR pay_method IN ('TRANSFER', 'CASH', 'CHECK')),
  CONSTRAINT ga_payment_requests_paid_check CHECK (status <> 'PAID' OR (pay_method IS NOT NULL AND paid_date IS NOT NULL AND paid_by IS NOT NULL AND paid_at IS NOT NULL)),
  CONSTRAINT ga_payment_requests_void_check CHECK ((status = 'VOID' AND voided_at IS NOT NULL) OR (status <> 'VOID' AND voided_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_ga_payment_requests_vendor ON public.ga_payment_requests (vendor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ga_payment_requests_status ON public.ga_payment_requests (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ga_payment_request_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id uuid NOT NULL REFERENCES public.ga_payment_requests(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  po_id uuid NOT NULL REFERENCES public.ga_purchase_orders(id) ON DELETE RESTRICT,
  receipt_id uuid NOT NULL REFERENCES public.ga_purchase_receipts(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES public.ga_purchase_invoices(id) ON DELETE RESTRICT,
  claim_untaxed numeric(14,0) NOT NULL,
  claim_tax numeric(14,0) NOT NULL DEFAULT 0,
  claim_total numeric(14,0) NOT NULL,
  diff_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_payment_request_lines_amount_check CHECK (claim_untaxed >= 0 AND claim_tax >= 0 AND claim_total = claim_untaxed + claim_tax AND claim_total > 0),
  CONSTRAINT ga_payment_request_lines_line_unique UNIQUE (pr_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_ga_payment_request_lines_po ON public.ga_payment_request_lines (po_id);
CREATE INDEX IF NOT EXISTS idx_ga_payment_request_lines_receipt ON public.ga_payment_request_lines (receipt_id);
CREATE INDEX IF NOT EXISTS idx_ga_payment_request_lines_invoice ON public.ga_payment_request_lines (invoice_id) WHERE invoice_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ga_payment_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id uuid NOT NULL REFERENCES public.ga_payment_requests(id) ON DELETE NO ACTION,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  actor_id uuid,
  reason text,
  amount_total numeric(14,0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT ga_payment_request_events_type_check CHECK (event_type IN ('create', 'update', 'submit', 'return', 'mark_paid', 'void', 'note', 'refresh_bank'))
);
CREATE INDEX IF NOT EXISTS idx_ga_payment_request_events_pr ON public.ga_payment_request_events (pr_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ga_payment_request_events_key_uidx ON public.ga_payment_request_events (pr_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 事件表不可修改或刪除（含 TRUNCATE）。只有 DEV 專用清除函式會在單一交易內暫停這個觸發器。
CREATE OR REPLACE FUNCTION public.ga_pay_events_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  RAISE EXCEPTION '請款單操作紀錄不可修改或刪除' USING ERRCODE = 'GA045';
END;
$$;
DROP TRIGGER IF EXISTS trg_ga_payment_request_events_immutable ON public.ga_payment_request_events;
CREATE TRIGGER trg_ga_payment_request_events_immutable BEFORE UPDATE OR DELETE ON public.ga_payment_request_events FOR EACH ROW EXECUTE FUNCTION public.ga_pay_events_immutable();
DROP TRIGGER IF EXISTS trg_ga_payment_request_events_no_truncate ON public.ga_payment_request_events;
CREATE TRIGGER trg_ga_payment_request_events_no_truncate BEFORE TRUNCATE ON public.ga_payment_request_events FOR EACH STATEMENT EXECUTE FUNCTION public.ga_pay_events_immutable();

-- 請款單狀態機守門（最後一道防線；平常由 ga_ws_pay_request_* 函式依規則操作，這裡擋下直接改表的程式或腳本）：
--   只允許 DRAFT→SUBMITTED／VOID、SUBMITTED→DRAFT／PAID／VOID、PAID→VOID；已作廢不能再改；非草稿時金額、廠商、統編與銀行快照、請款單號鎖定（廠商名稱快照只是顯示用，不鎖；統編、銀行才決定錢付給誰）；已付款時付款資訊鎖定。
--   明細表只有草稿的請款單可以新增、修改、刪除。DEV 專用清除函式會在單一交易內暫停明細觸發器。
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
DROP TRIGGER IF EXISTS trg_ga_payment_requests_guard ON public.ga_payment_requests;
CREATE TRIGGER trg_ga_payment_requests_guard BEFORE UPDATE ON public.ga_payment_requests FOR EACH ROW EXECUTE FUNCTION public.ga_pay_request_guard();

CREATE OR REPLACE FUNCTION public.ga_pay_request_lines_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_pr uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.pr_id ELSE NEW.pr_id END;
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.ga_payment_requests WHERE id = v_pr;
  IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN RAISE EXCEPTION '只有草稿的請款單可以修改明細（目前狀態 %）', v_status USING ERRCODE = 'GA045'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS trg_ga_payment_request_lines_guard ON public.ga_payment_request_lines;
CREATE TRIGGER trg_ga_payment_request_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ga_payment_request_lines FOR EACH ROW EXECUTE FUNCTION public.ga_pay_request_lines_guard();

-- 請款單號：PY-YYYYMMDD-NNN（台北日期流水，三位數不足補零，超過 999 照實際位數）。同日取號用 advisory lock 排隊。
CREATE OR REPLACE FUNCTION public.ga_next_pr_no() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_day text := to_char(now() AT TIME ZONE 'Asia/Taipei', 'YYYYMMDD');
  v_prefix text := 'PY-' || to_char(now() AT TIME ZONE 'Asia/Taipei', 'YYYYMMDD') || '-';
  v_seq integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('ga_next_pr_no:' || v_day, 0));
  SELECT COALESCE(max(substring(pr_no FROM '^PY-[0-9]{8}-([0-9]+)$')::integer), 0) + 1 INTO v_seq FROM public.ga_payment_requests WHERE pr_no LIKE v_prefix || '%';
  RETURN v_prefix || CASE WHEN v_seq < 1000 THEN lpad(v_seq::text, 3, '0') ELSE v_seq::text END;
END;
$$;
REVOKE ALL ON FUNCTION public.ga_next_pr_no() FROM PUBLIC, anon, authenticated;

-- 尾差預設 5 元（設定頁可調 0 至 100）。買受人抬頭與統編（value_text）由設定頁填寫，不預設。
INSERT INTO public.ga_workflow_settings (key, value_num) VALUES ('pay_tolerance_amount', 5) ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.ga_payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_payment_request_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_payment_request_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ga_payment_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ga_payment_request_lines FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ga_payment_request_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ga_payment_requests TO service_role;
GRANT ALL ON public.ga_payment_request_lines TO service_role;
GRANT ALL ON public.ga_payment_request_events TO service_role;

NOTIFY pgrst, 'reload schema';
