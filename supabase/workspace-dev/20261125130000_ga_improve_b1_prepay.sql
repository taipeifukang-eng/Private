-- 總務採購與請款改善第一批（ga-improve-b1）階段 5：G1 預付款（DEV；正式區草稿 ga-improve-b1-sql/04 內容相同）。
-- 內容：
--   1. 欄位與資料表：ga_payment_requests.pay_kind（NORMAL／PREPAY，預設 NORMAL）、prepay_po_id；ga_payment_request_lines.prepay_offset（預設 0）；
--      ga_payment_prepay_ledger（預付餘額帳：OFFSET 核銷進貨、REFUND 廠商退款或轉抵；事件式，只回復不刪列）；請款事件類型加 prepay_refund（超集）。
--   2. 規則：採購單已下訂（ORDERED／PARTIALLY_RECEIVED）才能開預付單；金額上限 預付＋一般請款 ≤ 採購單含稅總額＋尾差；送出後補核銷既有進貨、之後每次進貨驗入自動核銷；
--      退回、作廢預付單時核銷與退款全部回復；作廢進貨單時該筆核銷回復；一般請款預設金額扣掉核銷額並記 prepay_offset；累計請款（上限檢查）＝一般請款＋核銷。
--   3. 對外函式：ga_ws_pay_prepay_create（建立）、ga_ws_pay_prepay_settle（登記退款或轉抵）、ga_ws_pay_prepay_overview（採購單預付摘要）。
--   4. 結案守門：採購單取消、短收結案、結案時預付餘額大於尾差就擋下（PREPAY_BALANCE_OPEN）；沒有預付單時不多做任何查詢。
--   5. 逾期提醒：採購單列表 prepaid／prepay_overdue 篩選與行內欄位、請款單列表 pay_kind／prepay_overdue 篩選、首頁既有「逾期未到貨採購單」項目的副標加預付餘額（不新增首頁項目）。
--   6. 既有函式加掛（GAIB1-S5 標記，撤回時逐字還原）。
-- 不新增權限碼、不授權給任何角色。沒有預付單時所有輸出與原本相同。可重複執行。先決：20261125100000 至 20261125120000。
-- 還原：20261125130000_ga_improve_b1_prepay.rollback.sql（已有預付單時中止）。
DO $$
BEGIN
  IF to_regprocedure('public.ga_ib1_receive_ext(uuid,uuid,uuid)') IS NULL OR to_regprocedure('public.ga_ib1_pay_json_ext(uuid,boolean,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: 請先套用 20261125110000 與 20261125120000';
  END IF;
END $$;

-- ================================================================ 1. 欄位、約束與預付餘額帳
ALTER TABLE public.ga_payment_requests ADD COLUMN IF NOT EXISTS pay_kind text NOT NULL DEFAULT 'NORMAL';
ALTER TABLE public.ga_payment_requests ADD COLUMN IF NOT EXISTS prepay_po_id uuid REFERENCES public.ga_purchase_orders(id) ON DELETE RESTRICT;
ALTER TABLE public.ga_payment_request_lines ADD COLUMN IF NOT EXISTS prepay_offset numeric(14,0) NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ga_payment_requests_pay_kind_check' AND conrelid = 'public.ga_payment_requests'::regclass) THEN
    ALTER TABLE public.ga_payment_requests ADD CONSTRAINT ga_payment_requests_pay_kind_check CHECK (
      (pay_kind = 'NORMAL' AND prepay_po_id IS NULL) OR (pay_kind = 'PREPAY' AND prepay_po_id IS NOT NULL AND source = 'PURCHASE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ga_payment_request_lines_offset_check' AND conrelid = 'public.ga_payment_request_lines'::regclass) THEN
    ALTER TABLE public.ga_payment_request_lines ADD CONSTRAINT ga_payment_request_lines_offset_check CHECK (prepay_offset >= 0);
  END IF;
  -- 事件類型放寬成超集（舊值全部保留）
  ALTER TABLE public.ga_payment_request_events DROP CONSTRAINT IF EXISTS ga_payment_request_events_type_check;
  ALTER TABLE public.ga_payment_request_events ADD CONSTRAINT ga_payment_request_events_type_check CHECK (event_type IN ('create', 'update', 'submit', 'return', 'mark_paid', 'void', 'note', 'refresh_bank', 'prepay_refund'));
END $$;
CREATE INDEX IF NOT EXISTS idx_ga_payment_requests_prepay_po ON public.ga_payment_requests (prepay_po_id, status) WHERE prepay_po_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ga_payment_prepay_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  prepay_pr_id uuid NOT NULL REFERENCES public.ga_payment_requests(id) ON DELETE RESTRICT,
  po_id uuid NOT NULL REFERENCES public.ga_purchase_orders(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  receipt_id uuid REFERENCES public.ga_purchase_receipts(id) ON DELETE RESTRICT,
  amount numeric(14,0) NOT NULL,
  reason text,
  reversed_at timestamptz,
  reversed_reason text,
  CONSTRAINT ga_prepay_ledger_kind_check CHECK ((kind = 'OFFSET' AND receipt_id IS NOT NULL) OR (kind = 'REFUND' AND receipt_id IS NULL AND reason IS NOT NULL)),
  CONSTRAINT ga_prepay_ledger_amount_check CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS idx_ga_prepay_ledger_pr ON public.ga_payment_prepay_ledger (prepay_pr_id) WHERE reversed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ga_prepay_ledger_po ON public.ga_payment_prepay_ledger (po_id) WHERE reversed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ga_prepay_ledger_receipt ON public.ga_payment_prepay_ledger (receipt_id) WHERE reversed_at IS NULL AND receipt_id IS NOT NULL;
ALTER TABLE public.ga_payment_prepay_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ga_payment_prepay_ledger FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ga_payment_prepay_ledger TO service_role;

-- ================================================================ 2. 餘額與核銷輔助
CREATE OR REPLACE FUNCTION public.ga_pay_po_offset(p_po uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$ SELECT COALESCE(sum(amount), 0) FROM public.ga_payment_prepay_ledger WHERE po_id = p_po AND kind = 'OFFSET' AND reversed_at IS NULL; $f$;

CREATE OR REPLACE FUNCTION public.ga_pay_receipt_offset(p_receipt uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$ SELECT COALESCE(sum(amount), 0) FROM public.ga_payment_prepay_ledger WHERE receipt_id = p_receipt AND kind = 'OFFSET' AND reversed_at IS NULL; $f$;

-- 單張預付單的餘額＝送出或已付款的金額 − 未回復的核銷與退款（草稿、作廢、退回為 0）
CREATE OR REPLACE FUNCTION public.ga_pay_prepay_balance(p_pr uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT COALESCE((SELECT q.amount_total - COALESCE((SELECT sum(l.amount) FROM public.ga_payment_prepay_ledger l WHERE l.prepay_pr_id = q.id AND l.reversed_at IS NULL), 0)
                     FROM public.ga_payment_requests q WHERE q.id = p_pr AND q.pay_kind = 'PREPAY' AND q.status IN ('SUBMITTED', 'PAID')), 0);
$f$;

CREATE OR REPLACE FUNCTION public.ga_pay_po_prepay_balance(p_po uuid) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$ SELECT COALESCE(sum(public.ga_pay_prepay_balance(q.id)), 0) FROM public.ga_payment_requests q WHERE q.prepay_po_id = p_po AND q.pay_kind = 'PREPAY' AND q.status IN ('SUBMITTED', 'PAID'); $f$;

-- 核銷：依進貨先後，對「進貨單含稅額 − 有效請款 − 已核銷」大於 0 的進貨單，用預付單（依建立先後）的餘額逐張寫入核銷帳
CREATE OR REPLACE FUNCTION public.ga_pay_prepay_apply(p_po uuid) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  r record;
  pr record;
  v_remain numeric;
  v_take numeric;
  v_done numeric := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ga_payment_requests WHERE prepay_po_id = p_po AND pay_kind = 'PREPAY' AND status IN ('SUBMITTED', 'PAID')) THEN RETURN 0; END IF;
  PERFORM public.ga_pay_lock_po(p_po);
  FOR r IN SELECT x.id, public.ga_pay_receipt_total(x.id) AS tot FROM public.ga_purchase_receipts x WHERE x.po_id = p_po AND x.voided_at IS NULL ORDER BY x.received_date, x.created_at, x.id LOOP
    v_remain := r.tot - COALESCE((SELECT sum(l.claim_total) FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.receipt_id = r.id AND q.status <> 'VOID'), 0)
                      - public.ga_pay_receipt_offset(r.id);
    CONTINUE WHEN v_remain <= 0;
    FOR pr IN SELECT q.id, public.ga_pay_prepay_balance(q.id) AS bal FROM public.ga_payment_requests q
               WHERE q.prepay_po_id = p_po AND q.pay_kind = 'PREPAY' AND q.status IN ('SUBMITTED', 'PAID') ORDER BY q.created_at, q.id LOOP
      EXIT WHEN v_remain <= 0;
      CONTINUE WHEN pr.bal <= 0;
      v_take := LEAST(v_remain, pr.bal);
      INSERT INTO public.ga_payment_prepay_ledger (created_by, prepay_pr_id, po_id, kind, receipt_id, amount) VALUES (auth.uid(), pr.id, p_po, 'OFFSET', r.id, v_take);
      v_remain := v_remain - v_take;
      v_done := v_done + v_take;
    END LOOP;
  END LOOP;
  RETURN v_done;
END;
$f$;

-- 回復一張預付單所有未回復的核銷與退款
CREATE OR REPLACE FUNCTION public.ga_pay_prepay_release(p_pr uuid, p_reason text) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_sum numeric;
BEGIN
  SELECT COALESCE(sum(amount), 0) INTO v_sum FROM public.ga_payment_prepay_ledger WHERE prepay_pr_id = p_pr AND reversed_at IS NULL;
  UPDATE public.ga_payment_prepay_ledger SET reversed_at = clock_timestamp(), reversed_reason = p_reason WHERE prepay_pr_id = p_pr AND reversed_at IS NULL;
  RETURN v_sum;
END;
$f$;

-- 預付摘要（採購單頁與請款單頁共用）；沒有任何預付單時回 NULL
CREATE OR REPLACE FUNCTION public.ga_ib1_prepay_overview(p_po uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  o public.ga_purchase_orders%ROWTYPE;
  v_today date := public.ga_po_today();
  v_bal numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ga_payment_requests WHERE prepay_po_id = p_po AND pay_kind = 'PREPAY' AND status <> 'VOID') THEN RETURN NULL; END IF;
  SELECT * INTO o FROM public.ga_purchase_orders WHERE id = p_po;
  v_bal := public.ga_pay_po_prepay_balance(p_po);
  RETURN jsonb_build_object(
    'prepaid', COALESCE((SELECT sum(q.amount_total) FROM public.ga_payment_requests q WHERE q.prepay_po_id = p_po AND q.pay_kind = 'PREPAY' AND q.status IN ('SUBMITTED', 'PAID')), 0),
    'paid', COALESCE((SELECT sum(q.amount_total) FROM public.ga_payment_requests q WHERE q.prepay_po_id = p_po AND q.pay_kind = 'PREPAY' AND q.status = 'PAID'), 0),
    'draft', COALESCE((SELECT sum(q.amount_total) FROM public.ga_payment_requests q WHERE q.prepay_po_id = p_po AND q.pay_kind = 'PREPAY' AND q.status = 'DRAFT'), 0),
    'offset', public.ga_pay_po_offset(p_po),
    'refunded', COALESCE((SELECT sum(l.amount) FROM public.ga_payment_prepay_ledger l WHERE l.po_id = p_po AND l.kind = 'REFUND' AND l.reversed_at IS NULL), 0),
    'balance', v_bal,
    'unsettled', (o.status = 'RECEIVED' AND v_bal > public.ga_pay_tol()),
    'overdue', (o.status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND o.expected_delivery_date IS NOT NULL AND o.expected_delivery_date < v_today AND v_bal > 0),
    'overdue_days', CASE WHEN o.status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND o.expected_delivery_date IS NOT NULL AND o.expected_delivery_date < v_today AND v_bal > 0 THEN v_today - o.expected_delivery_date END,
    'requests', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', q.id, 'pr_no', q.pr_no, 'status', q.status, 'amount_total', q.amount_total, 'balance', public.ga_pay_prepay_balance(q.id)) ORDER BY q.created_at, q.id)
                            FROM public.ga_payment_requests q WHERE q.prepay_po_id = p_po AND q.pay_kind = 'PREPAY' AND q.status <> 'VOID'), '[]'::jsonb));
END;
$f$;

-- 上限檢查：這張採購單的預付（不含作廢）＋一般請款（不含核銷）＋新增金額 ≤ 含稅總額＋尾差
CREATE OR REPLACE FUNCTION public.ga_ib1_prepay_cap_check(p_po uuid, p_exclude uuid, p_add numeric) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  o public.ga_purchase_orders%ROWTYPE;
  v_p numeric;
  v_n numeric;
  v_tol numeric := public.ga_pay_tol();
BEGIN
  SELECT * INTO o FROM public.ga_purchase_orders WHERE id = p_po;
  SELECT COALESCE(sum(q.amount_total), 0) INTO v_p FROM public.ga_payment_requests q WHERE q.prepay_po_id = p_po AND q.pay_kind = 'PREPAY' AND q.status <> 'VOID' AND q.id IS DISTINCT FROM p_exclude;
  SELECT COALESCE(sum(l.claim_total), 0) INTO v_n FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.po_id = p_po AND q.status <> 'VOID';
  IF v_p + v_n + p_add > o.total_amount + v_tol THEN
    PERFORM public.ga_rq_raise(409, 'OVER_PO_TOTAL', '採購單 ' || o.po_no || ' 的預付款加一般請款共 ' || public.ga_pay_money(v_p + v_n + p_add) || ' 元，超過採購單含稅總額 ' || public.ga_pay_money(o.total_amount) || ' 元（容許尾差 ' || public.ga_pay_money(v_tol) || ' 元）；預付款加請款的總額不能超過訂單金額',
      jsonb_build_object('po_id', p_po, 'po_no', o.po_no, 'po_total', o.total_amount, 'prepaid', v_p, 'claimed', v_n, 'add', p_add, 'tolerance', v_tol));
  END IF;
END;
$f$;

-- 請款明細守門（審查 H1／H2）：預付款請款單不能放進貨明細（否則金額會被明細合計覆寫、重複計入上限）；
-- 進貨單已有預付核銷時，這條明細的請款額加其他有效請款加核銷額不能超過進貨單含稅額＋尾差（沒有核銷的進貨單不多做任何檢查）
CREATE OR REPLACE FUNCTION public.ga_ib1_prepay_lines_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_kind text;
  v_off numeric;
  v_tot numeric;
  v_other numeric;
  v_no text;
BEGIN
  SELECT pay_kind INTO v_kind FROM public.ga_payment_requests WHERE id = NEW.pr_id;
  IF v_kind = 'PREPAY' THEN
    PERFORM public.ga_rq_raise(409, 'PREPAY_NO_LINES', '預付款請款單不能放進貨明細；預付款會在進貨驗入時自動核銷進貨單');
  END IF;
  v_off := public.ga_pay_receipt_offset(NEW.receipt_id);
  IF v_off > 0 THEN
    v_tot := public.ga_pay_receipt_total(NEW.receipt_id);
    SELECT COALESCE(sum(l.claim_total), 0) INTO v_other FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.receipt_id = NEW.receipt_id AND q.status <> 'VOID';
    IF v_other + NEW.claim_total + v_off > v_tot + public.ga_pay_tol() THEN
      SELECT receipt_no INTO v_no FROM public.ga_purchase_receipts WHERE id = NEW.receipt_id;
      PERFORM public.ga_rq_raise(409, 'PREPAY_COVERED', '進貨單 ' || v_no || ' 已由預付款核銷 ' || public.ga_pay_money(v_off) || ' 元，再請款 ' || public.ga_pay_money(NEW.claim_total) || ' 元會超過進貨單含稅額 ' || public.ga_pay_money(v_tot) || ' 元；請款金額要扣掉預付核銷額',
        jsonb_build_object('receipt_id', NEW.receipt_id, 'receipt_total', v_tot, 'prepay_offset', v_off, 'other_claimed', v_other, 'claim_total', NEW.claim_total));
    END IF;
  END IF;
  RETURN NEW;
END;
$f$;
DROP TRIGGER IF EXISTS trg_ga_ib1_prepay_lines_guard ON public.ga_payment_request_lines;
CREATE TRIGGER trg_ga_ib1_prepay_lines_guard BEFORE INSERT ON public.ga_payment_request_lines FOR EACH ROW EXECUTE FUNCTION public.ga_ib1_prepay_lines_guard();

-- 調整列轉承接後重新對帳（審查 M1）：進貨單的「請款＋核銷」超過它現在的含稅額時，把超出的核銷額回復（由新到舊），回復的餘額之後可再核銷其他進貨
CREATE OR REPLACE FUNCTION public.ga_pay_prepay_reconcile(p_po uuid) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  r record;
  g record;
  v_excess numeric;
  v_cut numeric;
  v_done numeric := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ga_payment_prepay_ledger WHERE po_id = p_po AND kind = 'OFFSET' AND reversed_at IS NULL) THEN RETURN 0; END IF;
  FOR r IN SELECT x.id FROM public.ga_purchase_receipts x WHERE x.po_id = p_po AND x.voided_at IS NULL ORDER BY x.received_date, x.created_at, x.id LOOP
    v_excess := COALESCE((SELECT sum(l.claim_total) FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.receipt_id = r.id AND q.status <> 'VOID'), 0)
                + public.ga_pay_receipt_offset(r.id) - public.ga_pay_receipt_total(r.id);
    CONTINUE WHEN v_excess <= public.ga_pay_tol();
    FOR g IN SELECT * FROM public.ga_payment_prepay_ledger WHERE receipt_id = r.id AND kind = 'OFFSET' AND reversed_at IS NULL ORDER BY created_at DESC, id DESC LOOP
      EXIT WHEN v_excess <= 0;
      v_cut := LEAST(g.amount, v_excess);
      UPDATE public.ga_payment_prepay_ledger SET reversed_at = clock_timestamp(), reversed_reason = '進貨單金額調整，核銷額超過進貨單含稅額' WHERE id = g.id;
      IF g.amount > v_cut THEN
        INSERT INTO public.ga_payment_prepay_ledger (created_by, prepay_pr_id, po_id, kind, receipt_id, amount) VALUES (g.created_by, g.prepay_pr_id, g.po_id, 'OFFSET', g.receipt_id, g.amount - v_cut);
      END IF;
      v_excess := v_excess - v_cut;
      v_done := v_done + v_cut;
    END LOOP;
  END LOOP;
  RETURN v_done;
END;
$f$;

-- 預付單守門：種類與對應採購單建立後不可改；送出前重驗採購單狀態與上限
CREATE OR REPLACE FUNCTION public.ga_ib1_prepay_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  o public.ga_purchase_orders%ROWTYPE;
BEGIN
  IF (NEW.pay_kind, NEW.prepay_po_id) IS DISTINCT FROM (OLD.pay_kind, OLD.prepay_po_id) THEN RAISE EXCEPTION '請款單的類型（一般／預付）與對應採購單建立後不能修改' USING ERRCODE = 'GA045'; END IF;
  IF NEW.pay_kind = 'PREPAY' AND OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED' THEN
    PERFORM public.ga_pay_lock_po(NEW.prepay_po_id);
    SELECT * INTO o FROM public.ga_purchase_orders WHERE id = NEW.prepay_po_id;
    IF o.status NOT IN ('ORDERED', 'PARTIALLY_RECEIVED') THEN
      PERFORM public.ga_rq_raise(409, 'PREPAY_PO_STATE', '採購單 ' || o.po_no || ' 目前是「' || public.ga_po_status_label(o.status) || '」，已下訂且還沒全部到貨或結案的採購單才能送出預付款');
    END IF;
    PERFORM public.ga_ib1_prepay_cap_check(NEW.prepay_po_id, NEW.id, NEW.amount_total);
  END IF;
  RETURN NEW;
END;
$f$;
DROP TRIGGER IF EXISTS trg_ga_ib1_prepay_guard ON public.ga_payment_requests;
CREATE TRIGGER trg_ga_ib1_prepay_guard BEFORE UPDATE ON public.ga_payment_requests FOR EACH ROW EXECUTE FUNCTION public.ga_ib1_prepay_guard();

-- 預付單狀態同步：送出→補核銷；退回草稿或作廢→回復核銷與退款；一般請款單作廢→釋放的進貨單金額可再被預付餘額核銷
CREATE OR REPLACE FUNCTION public.ga_ib1_prepay_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_released numeric;
  v_applied numeric;
  v_po uuid;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NULL; END IF;
  IF NEW.pay_kind <> 'PREPAY' THEN
    IF NEW.status = 'VOID' THEN
      FOR v_po IN SELECT DISTINCT l.po_id FROM public.ga_payment_request_lines l WHERE l.pr_id = NEW.id ORDER BY 1 LOOP PERFORM public.ga_pay_prepay_apply(v_po); END LOOP;
    END IF;
    RETURN NULL;
  END IF;
  IF OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED' THEN
    v_applied := public.ga_pay_prepay_apply(NEW.prepay_po_id);
    IF v_applied > 0 THEN
      INSERT INTO public.ga_payment_request_events (pr_id, event_type, from_status, to_status, actor_id, reason, amount_total, payload, created_at)
        VALUES (NEW.id, 'note', NEW.status, NEW.status, auth.uid(), '送出時依既有進貨核銷預付款 NT$' || v_applied::bigint, NEW.amount_total, jsonb_build_object('prepay_applied', v_applied), clock_timestamp());
    END IF;
  ELSIF (OLD.status = 'SUBMITTED' AND NEW.status = 'DRAFT') OR NEW.status = 'VOID' THEN
    PERFORM public.ga_pay_lock_po(NEW.prepay_po_id);
    v_released := public.ga_pay_prepay_release(NEW.id, CASE WHEN NEW.status = 'VOID' THEN 'VOID' ELSE 'RETURN' END);
    IF v_released > 0 OR (NEW.status = 'VOID' AND OLD.status = 'PAID') THEN
      INSERT INTO public.ga_payment_request_events (pr_id, event_type, from_status, to_status, actor_id, reason, amount_total, payload, created_at)
        VALUES (NEW.id, 'note', NEW.status, NEW.status, auth.uid(),
                '預付核銷與退款 NT$' || v_released::bigint || ' 已回復' || CASE WHEN NEW.status = 'VOID' AND OLD.status = 'PAID' THEN '；此單已付款，需向廠商追回款項' ELSE '' END,
                NEW.amount_total, jsonb_build_object('prepay_released', v_released, 'paid_voided', NEW.status = 'VOID' AND OLD.status = 'PAID'), clock_timestamp());
    END IF;
    -- 回復的餘額可能還能核銷其他沒請款的進貨（例如另一張預付單）
    PERFORM public.ga_pay_prepay_apply(NEW.prepay_po_id);
  END IF;
  RETURN NULL;
END;
$f$;
DROP TRIGGER IF EXISTS trg_ga_ib1_prepay_sync ON public.ga_payment_requests;
CREATE TRIGGER trg_ga_ib1_prepay_sync AFTER UPDATE OF status ON public.ga_payment_requests FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND (NEW.pay_kind = 'PREPAY' OR NEW.status = 'VOID')) EXECUTE FUNCTION public.ga_ib1_prepay_sync();

-- 進貨登錄與作廢進貨的延伸點重新定義（加入預付核銷與回復）
CREATE OR REPLACE FUNCTION public.ga_ib1_receive_ext(p_po uuid, p_receipt uuid, p_uid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
BEGIN
  PERFORM public.ga_ib1_receipt_adj_carry(p_po);
  PERFORM public.ga_pay_prepay_reconcile(p_po);
  PERFORM public.ga_pay_prepay_apply(p_po);
END;
$f$;

CREATE OR REPLACE FUNCTION public.ga_ib1_receipt_void_ext(p_po uuid, p_receipt uuid, p_reason text, p_uid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
BEGIN
  DELETE FROM public.ga_purchase_receipt_adjustments WHERE receipt_id = p_receipt;
  PERFORM public.ga_ib1_receipt_adj_carry(p_po);
  UPDATE public.ga_payment_prepay_ledger SET reversed_at = clock_timestamp(), reversed_reason = '作廢進貨單' WHERE receipt_id = p_receipt AND kind = 'OFFSET' AND reversed_at IS NULL;
  PERFORM public.ga_pay_prepay_reconcile(p_po);
  PERFORM public.ga_pay_prepay_apply(p_po);
END;
$f$;

CREATE OR REPLACE FUNCTION public.ga_ib1_receipt_data_ext(p_receipt uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT jsonb_build_object(
    'amount_total', COALESCE((SELECT c.total FROM public.ga_ib1_receipt_calc(p_receipt) c), 0),
    'amount_untaxed', COALESCE((SELECT c.untaxed FROM public.ga_ib1_receipt_calc(p_receipt) c), 0),
    'amount_tax', COALESCE((SELECT c.tax FROM public.ga_ib1_receipt_calc(p_receipt) c), 0),
    'adjustments', COALESCE((SELECT jsonb_agg(jsonb_build_object('po_adjustment_id', ra.po_adjustment_id, 'kind', a.kind, 'label', a.label, 'amount', ra.amount) ORDER BY a.line_no)
                               FROM public.ga_purchase_receipt_adjustments ra JOIN public.ga_purchase_order_adjustments a ON a.id = ra.po_adjustment_id WHERE ra.receipt_id = p_receipt), '[]'::jsonb),
    'prepay_offset', public.ga_pay_receipt_offset(p_receipt),
    'has_paid_claim', EXISTS (SELECT 1 FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.receipt_id = p_receipt AND q.status = 'PAID')
                      OR EXISTS (SELECT 1 FROM public.ga_payment_prepay_ledger g JOIN public.ga_payment_requests q ON q.id = g.prepay_pr_id WHERE g.receipt_id = p_receipt AND g.kind = 'OFFSET' AND g.reversed_at IS NULL AND q.status = 'PAID'));
$f$;

-- 採購單輸出多預付摘要（只給有請款檢視權限者；沒有預付單時不多輸出）
CREATE OR REPLACE FUNCTION public.ga_ib1_po_data_ext(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT jsonb_build_object('buyer_company_name', c.name, 'buyer_company_tax_id', c.tax_id,
    'adjustments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'line_no', a.line_no, 'kind', a.kind, 'label', a.label, 'amount', a.amount, 'original_price', a.original_price,
        'campaign_name', a.campaign_name, 'note', a.note,
        'receipt_no', (SELECT r.receipt_no FROM public.ga_purchase_receipt_adjustments ra JOIN public.ga_purchase_receipts r ON r.id = ra.receipt_id WHERE ra.po_adjustment_id = a.id AND r.voided_at IS NULL LIMIT 1)) ORDER BY a.line_no)
        FROM public.ga_purchase_order_adjustments a WHERE a.po_id = o.id), '[]'::jsonb),
    'adjustment_total', COALESCE((SELECT sum(a.amount) FROM public.ga_purchase_order_adjustments a WHERE a.po_id = o.id), 0))
    || CASE WHEN public.ga_pay_can_view(auth.uid()) AND public.ga_ib1_prepay_overview(o.id) IS NOT NULL THEN jsonb_build_object('prepay', public.ga_ib1_prepay_overview(o.id)) ELSE '{}'::jsonb END
    FROM public.ga_purchase_orders o LEFT JOIN public.ga_buyer_companies c ON c.id = o.buyer_company_id WHERE o.id = p_id;
$f$;

-- 請款單輸出的預付欄位
CREATE OR REPLACE FUNCTION public.ga_ib1_pay_json_ext(p_pr uuid, p_vendor boolean, p_detail boolean) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  q public.ga_payment_requests%ROWTYPE;
  o public.ga_purchase_orders%ROWTYPE;
  v_visible boolean;
  v_out jsonb;
  v_bal numeric;
BEGIN
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_pr;
  IF NOT FOUND THEN RETURN '{}'::jsonb; END IF;
  v_visible := q.payee_type <> 'EMPLOYEE' OR p_vendor OR q.payee_profile_id IS NOT DISTINCT FROM auth.uid();
  v_out := jsonb_build_object(
    'payee_name', CASE WHEN q.payee_type = 'EMPLOYEE' THEN q.payee_name_snapshot ELSE q.vendor_name_snapshot END,
    'payee_account_snapshot', CASE WHEN v_visible THEN q.payee_account_snapshot ELSE '{}'::jsonb END,
    'payee_account_masked', NOT v_visible,
    'payee_account_last4', CASE WHEN q.payee_type = 'EMPLOYEE' AND q.payee_account_snapshot ->> 'bank_account' IS NOT NULL THEN right(regexp_replace(q.payee_account_snapshot ->> 'bank_account', '[^0-9]', '', 'g'), 4) END);
  IF q.pay_kind = 'PREPAY' THEN
    SELECT * INTO o FROM public.ga_purchase_orders WHERE id = q.prepay_po_id;
    v_bal := public.ga_pay_prepay_balance(q.id);
    v_out := v_out || jsonb_build_object('prepay_po_no', o.po_no, 'prepay_balance', v_bal, 'po_nos', jsonb_build_array(o.po_no),
      'prepay_unsettled', (o.status = 'RECEIVED' AND v_bal > public.ga_pay_tol()),
      'prepay_overdue', (o.status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND o.expected_delivery_date IS NOT NULL AND o.expected_delivery_date < public.ga_po_today() AND v_bal > 0),
      'prepay_overdue_days', CASE WHEN o.status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND o.expected_delivery_date IS NOT NULL AND o.expected_delivery_date < public.ga_po_today() AND v_bal > 0 THEN public.ga_po_today() - o.expected_delivery_date END,
      'prepay_offset_total', COALESCE((SELECT sum(g.amount) FROM public.ga_payment_prepay_ledger g WHERE g.prepay_pr_id = q.id AND g.kind = 'OFFSET' AND g.reversed_at IS NULL), 0),
      'prepay_refund_total', COALESCE((SELECT sum(g.amount) FROM public.ga_payment_prepay_ledger g WHERE g.prepay_pr_id = q.id AND g.kind = 'REFUND' AND g.reversed_at IS NULL), 0));
    IF p_detail THEN
      v_out := v_out || jsonb_build_object('prepay_ledger', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', g.id, 'kind', g.kind, 'amount', g.amount, 'receipt_no', r.receipt_no, 'reason', g.reason,
                  'created_at', g.created_at, 'reversed_at', g.reversed_at, 'reversed_reason', g.reversed_reason) ORDER BY g.created_at, g.id)
                  FROM public.ga_payment_prepay_ledger g LEFT JOIN public.ga_purchase_receipts r ON r.id = g.receipt_id WHERE g.prepay_pr_id = q.id), '[]'::jsonb));
    END IF;
  END IF;
  RETURN v_out;
END;
$f$;

-- 請款單列表篩選：付款對象、類型（一般／預付）、預付逾期
CREATE OR REPLACE FUNCTION public.ga_ib1_pay_filter_ok(p_pr uuid, v_f jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  q public.ga_payment_requests%ROWTYPE;
  o public.ga_purchase_orders%ROWTYPE;
BEGIN
  IF COALESCE(upper(nullif(v_f ->> 'payee_type', '')), '') = '' AND COALESCE(upper(nullif(v_f ->> 'pay_kind', '')), '') = '' AND COALESCE(v_f ->> 'prepay_overdue', '') NOT IN ('1', 'true') THEN RETURN true; END IF;
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_pr;
  IF COALESCE(upper(nullif(v_f ->> 'payee_type', '')), '') <> '' AND q.payee_type <> upper(v_f ->> 'payee_type') THEN RETURN false; END IF;
  IF COALESCE(upper(nullif(v_f ->> 'pay_kind', '')), '') <> '' AND q.pay_kind <> upper(v_f ->> 'pay_kind') THEN RETURN false; END IF;
  IF COALESCE(v_f ->> 'prepay_overdue', '') IN ('1', 'true') THEN
    IF q.pay_kind <> 'PREPAY' THEN RETURN false; END IF;
    SELECT * INTO o FROM public.ga_purchase_orders WHERE id = q.prepay_po_id;
    -- 逾期未到貨，或已全部到貨但預付餘額還沒退款或轉抵（審查 M4）
    RETURN (o.status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND o.expected_delivery_date IS NOT NULL AND o.expected_delivery_date < public.ga_po_today() AND public.ga_pay_prepay_balance(q.id) > 0)
        OR (o.status = 'RECEIVED' AND public.ga_pay_prepay_balance(q.id) > public.ga_pay_tol());
  END IF;
  RETURN true;
END;
$f$;

-- 對帳匯出 extended：另外列出預付單（沒有明細列的預付單才不會從對帳表消失）
CREATE OR REPLACE FUNCTION public.ga_ib1_export_enrich(p_res jsonb, v_f jsonb, p_uid uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_can_vendor boolean := public.ga_pay_can_vendor(p_uid);
  v_rows jsonb;
  v_pre jsonb := '[]'::jsonb;
  v_month text := nullif(v_f ->> 'month', '');
  v_vendor uuid := nullif(v_f ->> 'vendor_id', '')::uuid;
  v_status text := upper(nullif(v_f ->> 'status', ''));
BEGIN
  IF COALESCE(v_f ->> 'extended', '') NOT IN ('1', 'true') OR COALESCE((p_res ->> 'ok')::boolean, false) IS NOT TRUE THEN RETURN p_res; END IF;
  SELECT COALESCE(jsonb_agg(r.value || jsonb_build_object(
      'pay_kind', COALESCE(q.pay_kind, 'NORMAL'), 'payee_type', COALESCE(q.payee_type, 'VENDOR'),
      'payee_name', CASE WHEN q.payee_type = 'EMPLOYEE' THEN q.payee_name_snapshot ELSE q.vendor_name_snapshot END,
      'buyer_title', q.buyer_title_snapshot, 'card_last4', q.pay_card_last4, 'platform', q.pay_platform)
      || CASE WHEN v_can_vendor AND q.payee_type = 'EMPLOYEE' THEN jsonb_build_object('payee_bank_name', q.payee_account_snapshot ->> 'bank_name', 'payee_bank_account', q.payee_account_snapshot ->> 'bank_account') ELSE '{}'::jsonb END
      ORDER BY r.ord), '[]'::jsonb)
    INTO v_rows
    FROM jsonb_array_elements(COALESCE(p_res -> 'data' -> 'rows', '[]'::jsonb)) WITH ORDINALITY r(value, ord)
    LEFT JOIN LATERAL (SELECT x.pay_kind, x.payee_type, x.payee_name_snapshot, x.vendor_name_snapshot, x.buyer_title_snapshot, x.pay_card_last4, x.pay_platform, x.payee_account_snapshot
                         FROM public.ga_payment_requests x WHERE x.pr_no = r.value ->> 'pr_no') q ON true;
  IF COALESCE(p_res -> 'data' ->> 'source', '') <> 'UTILITY' AND v_month IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'pr_no', q.pr_no, 'status', q.status, 'created_at', q.created_at, 'vendor_name', q.vendor_name_snapshot, 'vendor_tax_id', CASE WHEN v_can_vendor THEN q.vendor_tax_id_snapshot END,
        'bank_name', CASE WHEN v_can_vendor THEN q.bank_snapshot ->> 'bank_name' END, 'bank_account', CASE WHEN v_can_vendor THEN q.bank_snapshot ->> 'bank_account' END,
        'po_no', o.po_no, 'receipt_no', NULL, 'invoice_no', NULL, 'invoice_type', NULL,
        'amount_untaxed', q.amount_untaxed, 'tax_amount', q.tax_amount, 'amount_total', q.amount_total, 'claim_total', q.amount_total,
        'paid_date', q.paid_date, 'pay_method', q.pay_method, 'paid_ref', q.paid_ref,
        'submitted_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = q.submitted_by), 'submitted_at', q.submitted_at,
        'paid_by_name', (SELECT p.full_name FROM public.profiles p WHERE p.id = q.paid_by), 'paid_at', q.paid_at,
        'pay_kind', 'PREPAY', 'payee_type', q.payee_type, 'payee_name', CASE WHEN q.payee_type = 'EMPLOYEE' THEN q.payee_name_snapshot ELSE q.vendor_name_snapshot END,
        'buyer_title', q.buyer_title_snapshot, 'card_last4', q.pay_card_last4, 'platform', q.pay_platform)
        || CASE WHEN v_can_vendor AND q.payee_type = 'EMPLOYEE' THEN jsonb_build_object('payee_bank_name', q.payee_account_snapshot ->> 'bank_name', 'payee_bank_account', q.payee_account_snapshot ->> 'bank_account') ELSE '{}'::jsonb END
        ORDER BY q.created_at, q.pr_no), '[]'::jsonb)
      INTO v_pre
      FROM public.ga_payment_requests q JOIN public.ga_purchase_orders o ON o.id = q.prepay_po_id
     WHERE q.pay_kind = 'PREPAY' AND to_char(q.created_at AT TIME ZONE 'Asia/Taipei', 'YYYY-MM') = v_month AND (v_vendor IS NULL OR q.vendor_id = v_vendor) AND (v_status IS NULL OR q.status = v_status);
  END IF;
  RETURN jsonb_set(jsonb_set(p_res, '{data,rows}', v_rows || v_pre), '{data,total}', to_jsonb(COALESCE((p_res -> 'data' ->> 'total')::integer, 0) + jsonb_array_length(v_pre))) || jsonb_build_object('extended', true);
END;
$f$;

-- ================================================================ 3. 對外函式
CREATE OR REPLACE FUNCTION public.ga_ib1_prepay_set_amount(p_pr uuid, p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  q public.ga_payment_requests%ROWTYPE;
  v_txt text;
  v_amt numeric;
  o public.ga_purchase_orders%ROWTYPE;
  v_u numeric;
BEGIN
  IF NOT (p ? 'amount') THEN RETURN; END IF;
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_pr AND status = 'DRAFT' AND pay_kind = 'PREPAY';
  IF NOT FOUND THEN RETURN; END IF;
  v_txt := nullif(btrim(COALESCE(p ->> 'amount', '')), '');
  IF v_txt IS NULL OR v_txt !~ '^[0-9]{1,9}$' OR v_txt::numeric <= 0 THEN PERFORM public.ga_rq_raise(400, 'AMOUNT_REQUIRED', '預付金額必須是大於 0 的整數元'); END IF;
  v_amt := v_txt::numeric;
  SELECT * INTO o FROM public.ga_purchase_orders WHERE id = q.prepay_po_id;
  PERFORM public.ga_pay_lock_po(o.id);
  PERFORM public.ga_ib1_prepay_cap_check(o.id, q.id, v_amt);
  v_u := round(v_amt / (1 + o.tax_rate));
  UPDATE public.ga_payment_requests SET amount_untaxed = v_u, tax_amount = v_amt - v_u, amount_total = v_amt WHERE id = p_pr;
END;
$f$;

CREATE OR REPLACE FUNCTION public.ga_ws_pay_prepay_create(p_payload jsonb, p_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_uid uuid := auth.uid();
  p jsonb := COALESCE(p_payload, '{}'::jsonb);
  v_key text := nullif(btrim(COALESCE(p_key, '')), '');
  v_hash text;
  q public.ga_payment_requests%ROWTYPE;
  o public.ga_purchase_orders%ROWTYPE;
  v_po uuid;
  v_snap jsonb;
  v_pay date;
  v_notes text;
  v_txt text;
  v_amt numeric;
  v_u numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有建立請款單的權限（需要請款管理權限）'); END IF;
  IF NOT public.ga_po_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PO_VIEW_REQUIRED', '建立預付款需要「採購評估檢視」權限'); END IF;
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
  v_po := public.ga_pay_uuid(p ->> 'po_id', '採購單', true);
  PERFORM public.ga_pay_lock_po(v_po);
  SELECT * INTO o FROM public.ga_purchase_orders WHERE id = v_po;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張採購單'); END IF;
  IF o.status NOT IN ('ORDERED', 'PARTIALLY_RECEIVED') THEN
    RETURN public.ga_rq_err(409, 'PREPAY_PO_STATE', CASE WHEN o.status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED') THEN '採購單還沒有下訂，核准並下訂後才能開預付款'
      WHEN o.status = 'RECEIVED' THEN '採購單已經全部到貨，請改開一般請款' ELSE '採購單目前是「' || public.ga_po_status_label(o.status) || '」，不能再開預付款' END, jsonb_build_object('current_status', o.status));
  END IF;
  IF o.vendor_id IS NULL THEN RETURN public.ga_rq_err(409, 'VENDOR_REQUIRED', '採購單沒有廠商，不能開預付款'); END IF;
  v_txt := nullif(btrim(COALESCE(p ->> 'amount', '')), '');
  IF v_txt IS NULL OR v_txt !~ '^[0-9]{1,9}$' OR v_txt::numeric <= 0 THEN RETURN public.ga_rq_err(400, 'AMOUNT_REQUIRED', '預付金額必須是大於 0 的整數元'); END IF;
  v_amt := v_txt::numeric;
  PERFORM public.ga_ib1_prepay_cap_check(o.id, NULL, v_amt);
  v_snap := public.ga_pay_vendor_snapshot(o.vendor_id);
  IF v_snap IS NULL THEN RETURN public.ga_rq_err(404, 'VENDOR_NOT_FOUND', '找不到這個廠商'); END IF;
  v_pay := public.ga_pay_date(p ->> 'expected_pay_date', '預計付款日');
  v_notes := public.ga_pay_txt(p, 'notes', 500, '備註');
  v_u := round(v_amt / (1 + o.tax_rate));
  INSERT INTO public.ga_payment_requests (pr_no, vendor_id, vendor_name_snapshot, vendor_tax_id_snapshot, bank_snapshot, status, expected_pay_date, notes, idempotency_key, payload_hash, created_by, updated_by,
                                          pay_kind, prepay_po_id, amount_untaxed, tax_amount, amount_total, buyer_company_id)
  VALUES (public.ga_next_pr_no(), o.vendor_id, v_snap ->> 'name', v_snap ->> 'tax_id', v_snap -> 'bank', 'DRAFT', v_pay, v_notes, v_key, v_hash, v_uid, v_uid,
          'PREPAY', o.id, v_u, v_amt - v_u, v_amt, COALESCE(o.buyer_company_id, public.ga_ib1_buyer_default_id())) RETURNING * INTO q;
  PERFORM public.ga_ib1_pay_set_buyer(q.id, p);
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = q.id;
  PERFORM public.ga_pay_event(q.id, 'create', NULL, 'DRAFT', v_uid, NULL, q.amount_total, jsonb_build_object('pay_kind', 'PREPAY', 'po_no', o.po_no), NULL);
  RETURN jsonb_build_object('ok', true, 'status', 201, 'replay', false, 'data', public.ga_pay_request_json(q.id, public.ga_pay_can_vendor(v_uid), public.ga_po_can_view(v_uid), true));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$f$;

-- 登記退款或轉抵：已付款的預付單，金額不得超過餘額，必填原因；寫退款帳與事件（不改狀態）
CREATE OR REPLACE FUNCTION public.ga_ws_pay_prepay_settle(p_id uuid, p_amount numeric, p_reason text, p_key text, p_expected_updated_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_uid uuid := auth.uid();
  v_key text := nullif(btrim(COALESCE(p_key, '')), '');
  v_reason text := nullif(btrim(COALESCE(p_reason, '')), '');
  v_hash text;
  q public.ga_payment_requests%ROWTYPE;
  v_ev public.ga_payment_request_events%ROWTYPE;
  v_bal numeric;
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_manage(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有操作請款單的權限（需要請款管理權限）'); END IF;
  IF v_key IS NULL OR char_length(v_key) > 64 THEN RETURN public.ga_rq_err(400, 'IDEMPOTENCY_KEY_REQUIRED', '缺少防重複識別碼，請重新整理畫面後再送出'); END IF;
  IF p_expected_updated_at IS NULL THEN RETURN public.ga_rq_err(400, 'EXPECTED_REQUIRED', '缺少版本資訊（expected_updated_at），請重新載入後再送出'); END IF;
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> trunc(p_amount) THEN RETURN public.ga_rq_err(400, 'AMOUNT_REQUIRED', '退款金額必須是大於 0 的整數元'); END IF;
  IF v_reason IS NULL THEN RETURN public.ga_rq_err(400, 'REASON_REQUIRED', '請填寫退款或轉抵的說明'); END IF;
  IF char_length(v_reason) > 200 THEN RETURN public.ga_rq_err(400, 'REASON_TOO_LONG', '說明不可超過 200 字'); END IF;
  v_hash := md5('prepay_refund|' || p_amount::text || '|' || v_reason);
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張請款單'); END IF;
  SELECT * INTO v_ev FROM public.ga_payment_request_events WHERE pr_id = q.id AND idempotency_key = v_key;
  IF FOUND THEN
    IF v_ev.payload ->> 'hash' = v_hash THEN RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', true, 'data', public.ga_pay_request_json(q.id, public.ga_pay_can_vendor(v_uid), public.ga_po_can_view(v_uid), true)); END IF;
    RETURN public.ga_rq_err(409, 'IDEMPOTENCY_CONFLICT', '這個送出識別碼已被另一個不同內容的操作使用，請重新整理畫面後再送出');
  END IF;
  IF q.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN public.ga_rq_err(409, 'STALE', '這張請款單剛被其他人修改，請重新載入後再操作'); END IF;
  IF q.pay_kind <> 'PREPAY' THEN RETURN public.ga_rq_err(409, 'NOT_PREPAY', '只有預付款請款單可以登記退款'); END IF;
  IF q.status <> 'PAID' THEN RETURN public.ga_rq_err(409, 'INVALID_STATE', '只有已付款的預付單可以登記退款或轉抵，目前狀態是「' || CASE q.status WHEN 'DRAFT' THEN '草稿' WHEN 'SUBMITTED' THEN '已送出' ELSE '已作廢' END || '」', jsonb_build_object('current_status', q.status)); END IF;
  PERFORM public.ga_pay_lock_po(q.prepay_po_id);
  v_bal := public.ga_pay_prepay_balance(q.id);
  IF p_amount > v_bal THEN RETURN public.ga_rq_err(409, 'OVER_BALANCE', '退款金額 ' || public.ga_pay_money(p_amount) || ' 元超過這張預付單目前的餘額 ' || public.ga_pay_money(v_bal) || ' 元', jsonb_build_object('balance', v_bal)); END IF;
  INSERT INTO public.ga_payment_prepay_ledger (created_by, prepay_pr_id, po_id, kind, amount, reason) VALUES (v_uid, q.id, q.prepay_po_id, 'REFUND', p_amount, v_reason);
  UPDATE public.ga_payment_requests SET updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;
  PERFORM public.ga_pay_event(q.id, 'prepay_refund', q.status, q.status, v_uid, v_reason, p_amount, jsonb_build_object('hash', v_hash, 'balance_after', v_bal - p_amount), v_key);
  RETURN jsonb_build_object('ok', true, 'status', 200, 'replay', false, 'data', public.ga_pay_request_json(q.id, public.ga_pay_can_vendor(v_uid), public.ga_po_can_view(v_uid), true));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$f$;

CREATE OR REPLACE FUNCTION public.ga_ws_pay_prepay_overview(p_po_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN public.ga_rq_err(401, 'AUTH_REQUIRED', '請先登入'); END IF;
  IF NOT public.ga_pay_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PERMISSION_DENIED', '沒有查看請款資料的權限'); END IF;
  IF NOT public.ga_po_can_view(v_uid) THEN RETURN public.ga_rq_err(403, 'PO_VIEW_REQUIRED', '查看採購單的預付款需要「採購評估檢視」權限'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ga_purchase_orders WHERE id = p_po_id) THEN RETURN public.ga_rq_err(404, 'NOT_FOUND', '找不到這張採購單'); END IF;
  RETURN jsonb_build_object('ok', true, 'status', 200, 'data', jsonb_build_object('prepay', public.ga_ib1_prepay_overview(p_po_id), 'can_manage', public.ga_pay_can_manage(v_uid)));
EXCEPTION WHEN OTHERS THEN
  RETURN public.ga_rq_catch(SQLERRM, SQLSTATE);
END;
$f$;

-- 採購單取消、短收結案、結案的守門：預付餘額大於尾差就擋（沒有預付單時只做一次存在性檢查）
CREATE OR REPLACE FUNCTION public.ga_ib1_prepay_close_guard(p_po uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_bal numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ga_payment_requests WHERE prepay_po_id = p_po AND pay_kind = 'PREPAY' AND status IN ('SUBMITTED', 'PAID')) THEN RETURN; END IF;
  v_bal := public.ga_pay_po_prepay_balance(p_po);
  IF v_bal > public.ga_pay_tol() THEN
    PERFORM public.ga_po_raise(409, 'PREPAY_BALANCE_OPEN', '這張採購單還有預付款 NT$' || public.ga_pay_money(v_bal) || ' 未核銷，請先登記退款或轉抵，或等到貨核銷後再處理', jsonb_build_object('prepay_balance', v_bal));
  END IF;
END;
$f$;

-- 請款明細的預付核銷檢查（送出前重驗）：每條明細記的核銷額必須等於進貨單目前的核銷額
CREATE OR REPLACE FUNCTION public.ga_ib1_check_prepay_live(p_pr uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  l record;
BEGIN
  FOR l IN SELECT x.line_no, r.receipt_no, x.prepay_offset, public.ga_pay_receipt_offset(x.receipt_id) AS cur FROM public.ga_payment_request_lines x JOIN public.ga_purchase_receipts r ON r.id = x.receipt_id
            WHERE x.pr_id = p_pr AND x.prepay_offset IS DISTINCT FROM public.ga_pay_receipt_offset(x.receipt_id) ORDER BY x.line_no LOOP
    PERFORM public.ga_rq_raise(409, 'PREPAY_CHANGED', '進貨單 ' || l.receipt_no || ' 的預付核銷有變動（草稿記錄 ' || public.ga_pay_money(l.prepay_offset) || ' 元、目前 ' || public.ga_pay_money(l.cur) || ' 元），請重新整理明細後再送出',
      jsonb_build_object('line_no', l.line_no));
  END LOOP;
END;
$f$;

-- 階段 4 的延伸點重新定義（加入預付金額修改）
CREATE OR REPLACE FUNCTION public.ga_ib1_pay_set_buyer(p_pr uuid, p jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
  v_cur uuid;
  v_new uuid;
  v_txt text;
BEGIN
  PERFORM public.ga_ib1_pay_set_payee(p_pr, p);
  PERFORM public.ga_ib1_prepay_set_amount(p_pr, p);
  SELECT buyer_company_id INTO v_cur FROM public.ga_payment_requests WHERE id = p_pr AND status = 'DRAFT';
  IF NOT FOUND THEN RETURN; END IF;
  IF p ? 'buyer_company_id' THEN
    v_txt := nullif(btrim(COALESCE(p ->> 'buyer_company_id', '')), '');
    IF v_txt IS NOT NULL THEN
      v_new := public.ga_pay_uuid(v_txt, '買受人公司', true);
      IF NOT EXISTS (SELECT 1 FROM public.ga_buyer_companies WHERE id = v_new AND (is_active OR id = v_cur)) THEN
        PERFORM public.ga_rq_raise(404, 'BUYER_NOT_FOUND', '找不到這家買受人公司，或已停用');
      END IF;
    ELSE
      v_new := public.ga_ib1_buyer_default_id();
    END IF;
  ELSIF v_cur IS NULL THEN
    SELECT o.buyer_company_id INTO v_new FROM public.ga_payment_request_lines l JOIN public.ga_purchase_orders o ON o.id = l.po_id WHERE l.pr_id = p_pr ORDER BY l.line_no LIMIT 1;
    IF v_new IS NULL THEN v_new := public.ga_ib1_buyer_default_id(); END IF;
  ELSE
    RETURN;
  END IF;
  IF v_new IS DISTINCT FROM v_cur THEN UPDATE public.ga_payment_requests SET buyer_company_id = v_new WHERE id = p_pr; END IF;
END;
$f$;

-- ================================================================ 4. 既有函式加掛（讀現行定義＋文字替換；已套用就略過、形狀不符就中止）
CREATE OR REPLACE FUNCTION public.ga_ib1_nl(p_ref text, p_x text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN position(E'\r\n' IN p_ref) > 0 THEN replace(replace(p_x, E'\r\n', E'\n'), E'\n', E'\r\n') ELSE replace(p_x, E'\r\n', E'\n') END;
$f$;
CREATE OR REPLACE FUNCTION public.ga_ib1_swap(p_text text, p_old text, p_new text, p_label text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
BEGIN
  IF position(p_old IN p_text) = 0 THEN RAISE EXCEPTION '函式形狀與預期不符，找不到要替換的文字（%）：%', p_label, left(p_old, 80); END IF;
  IF position(p_old IN substr(p_text, position(p_old IN p_text) + 1)) > 0 THEN RAISE EXCEPTION '函式形狀與預期不符，要替換的文字出現不只一次（%）：%', p_label, left(p_old, 80); END IF;
  RETURN replace(p_text, p_old, p_new);
END;
$f$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_pay_po_claimed(uuid,uuid,text)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$SELECT COALESCE(sum(l.claim_total), 0) + CASE WHEN p_status IS NULL THEN public.ga_pay_po_offset(p_po) ELSE 0 END /* GAIB1-S5 */ FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$SELECT COALESCE(sum(l.claim_total), 0) FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id$ib1o$), public.ga_ib1_nl(v_def, $ib1n$SELECT COALESCE(sum(l.claim_total), 0) + CASE WHEN p_status IS NULL THEN public.ga_pay_po_offset(p_po) ELSE 0 END /* GAIB1-S5 */ FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id$ib1n$), 'public.ga_pay_po_claimed(uuid,uuid,text) 累計請款含核銷');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_pay_unclaimed_po_ids(numeric)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$   WHERE s.tot - COALESCE(c.c, 0) - public.ga_pay_po_offset(o.id) /* GAIB1-S5 */ > p_tol;$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$   WHERE s.tot - COALESCE(c.c, 0) > p_tol;$ib1o$), public.ga_ib1_nl(v_def, $ib1n$   WHERE s.tot - COALESCE(c.c, 0) - public.ga_pay_po_offset(o.id) /* GAIB1-S5 */ > p_tol;$ib1n$), 'public.ga_pay_unclaimed_po_ids(numeric) 待請款含核銷');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_pay_po_amounts(uuid[])'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$         COALESCE(c.claimed, 0) + public.ga_pay_po_offset(o.id), /* GAIB1-S5 */$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$         COALESCE(c.claimed, 0),$ib1o$), public.ga_ib1_nl(v_def, $ib1n$         COALESCE(c.claimed, 0) + public.ga_pay_po_offset(o.id), /* GAIB1-S5 */$ib1n$), 'public.ga_pay_po_amounts(uuid[]) 已請款含核銷');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_pay_apply_lines(uuid,uuid,jsonb)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  v_ponos text;
  v_off numeric := 0; -- GAIB1-S5
  v_ptax numeric;
BEGIN$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$  v_ponos text;
BEGIN$ib1o$), public.ga_ib1_nl(v_def, $ib1n$  v_ponos text;
  v_off numeric := 0; -- GAIB1-S5
  v_ptax numeric;
BEGIN$ib1n$), 'public.ga_pay_apply_lines(uuid,uuid,jsonb) 變數');
  END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    v_off := public.ga_pay_receipt_offset(v_rid); -- GAIB1-S5
    v_ptax := NULL;
    IF v_u IS NULL AND v_off > 0 THEN
      v_u := round((public.ga_pay_receipt_total(v_rid) - v_off) / (1 + v_rec.tax_rate));
      v_ptax := (public.ga_pay_receipt_total(v_rid) - v_off) - v_u;
    END IF;
    IF v_u IS NULL THEN v_u := public.ga_pay_receipt_untaxed(v_rid); END IF;$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$    IF v_u IS NULL THEN v_u := public.ga_pay_receipt_untaxed(v_rid); END IF;$ib1o$), public.ga_ib1_nl(v_def, $ib1n$    v_off := public.ga_pay_receipt_offset(v_rid); -- GAIB1-S5
    v_ptax := NULL;
    IF v_u IS NULL AND v_off > 0 THEN
      v_u := round((public.ga_pay_receipt_total(v_rid) - v_off) / (1 + v_rec.tax_rate));
      v_ptax := (public.ga_pay_receipt_total(v_rid) - v_off) - v_u;
    END IF;
    IF v_u IS NULL THEN v_u := public.ga_pay_receipt_untaxed(v_rid); END IF;$ib1n$), 'public.ga_pay_apply_lines(uuid,uuid,jsonb) 預設金額扣核銷');
  END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    IF v_t IS NULL AND v_ptax IS NOT NULL THEN v_t := v_ptax; END IF; -- GAIB1-S5
    IF v_t IS NULL THEN v_t := CASE WHEN v_u = public.ga_pay_receipt_untaxed(v_rid)$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$    IF v_t IS NULL THEN v_t := CASE WHEN v_u = public.ga_pay_receipt_untaxed(v_rid)$ib1o$), public.ga_ib1_nl(v_def, $ib1n$    IF v_t IS NULL AND v_ptax IS NOT NULL THEN v_t := v_ptax; END IF; -- GAIB1-S5
    IF v_t IS NULL THEN v_t := CASE WHEN v_u = public.ga_pay_receipt_untaxed(v_rid)$ib1n$), 'public.ga_pay_apply_lines(uuid,uuid,jsonb) 預設稅額扣核銷');
  END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    v_total := v_u + v_t;
    IF v_off > 0 AND v_total <= 0 THEN PERFORM public.ga_rq_raise(409, 'PREPAY_COVERED', '進貨單 ' || v_rec.receipt_no || ' 已由預付款核銷，免再請款（仍可登錄憑證與連結發票）'); END IF; -- GAIB1-S5$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$    v_total := v_u + v_t;$ib1o$), public.ga_ib1_nl(v_def, $ib1n$    v_total := v_u + v_t;
    IF v_off > 0 AND v_total <= 0 THEN PERFORM public.ga_rq_raise(409, 'PREPAY_COVERED', '進貨單 ' || v_rec.receipt_no || ' 已由預付款核銷，免再請款（仍可登錄憑證與連結發票）'); END IF; -- GAIB1-S5$ib1n$), 'public.ga_pay_apply_lines(uuid,uuid,jsonb) 已核銷免請款');
  END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$      IF abs(v_total + v_off - (v_ir.allocated_untaxed + v_ir.allocated_tax)) > v_tol AND v_diff IS NULL THEN /* GAIB1-S5 */$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$      IF abs(v_total - (v_ir.allocated_untaxed + v_ir.allocated_tax)) > v_tol AND v_diff IS NULL THEN$ib1o$), public.ga_ib1_nl(v_def, $ib1n$      IF abs(v_total + v_off - (v_ir.allocated_untaxed + v_ir.allocated_tax)) > v_tol AND v_diff IS NULL THEN /* GAIB1-S5 */$ib1n$), 'public.ga_pay_apply_lines(uuid,uuid,jsonb) 發票差異比對');
  END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$      IF abs(v_total + v_off - (v_ir.allocated_untaxed + v_ir.allocated_tax)) <= v_tol THEN v_diff := NULL; END IF; -- GAIB1-S5$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$      IF abs(v_total - (v_ir.allocated_untaxed + v_ir.allocated_tax)) <= v_tol THEN v_diff := NULL; END IF;$ib1o$), public.ga_ib1_nl(v_def, $ib1n$      IF abs(v_total + v_off - (v_ir.allocated_untaxed + v_ir.allocated_tax)) <= v_tol THEN v_diff := NULL; END IF; -- GAIB1-S5$ib1n$), 'public.ga_pay_apply_lines(uuid,uuid,jsonb) 發票差異清除');
  END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    INSERT INTO public.ga_payment_request_lines (pr_id, line_no, po_id, receipt_id, invoice_id, claim_untaxed, claim_tax, claim_total, diff_reason, prepay_offset) -- GAIB1-S5
    VALUES (p_pr, v_no, v_rec.po_id, v_rid, v_iid, v_u, v_t, v_total, v_diff, v_off);$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$    INSERT INTO public.ga_payment_request_lines (pr_id, line_no, po_id, receipt_id, invoice_id, claim_untaxed, claim_tax, claim_total, diff_reason)
    VALUES (p_pr, v_no, v_rec.po_id, v_rid, v_iid, v_u, v_t, v_total, v_diff);$ib1o$), public.ga_ib1_nl(v_def, $ib1n$    INSERT INTO public.ga_payment_request_lines (pr_id, line_no, po_id, receipt_id, invoice_id, claim_untaxed, claim_tax, claim_total, diff_reason, prepay_offset) -- GAIB1-S5
    VALUES (p_pr, v_no, v_rec.po_id, v_rid, v_iid, v_u, v_t, v_total, v_diff, v_off);$ib1n$), 'public.ga_pay_apply_lines(uuid,uuid,jsonb) 寫入核銷額');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_pay_check_live(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_pay_check_tol_reasons(p_pr);
  PERFORM public.ga_ib1_check_prepay_live(p_pr); -- GAIB1-S5$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$  PERFORM public.ga_pay_check_tol_reasons(p_pr);$ib1o$), public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_pay_check_tol_reasons(p_pr);
  PERFORM public.ga_ib1_check_prepay_live(p_pr); -- GAIB1-S5$ib1n$), 'public.ga_pay_check_live(uuid) 核銷重驗');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_pay_check_tol_reasons(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$x.claim_total + x.prepay_offset /* GAIB1-S5 */ AS claim_total, ir.allocated_untaxed + ir.allocated_tax AS allocated$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$x.claim_total, ir.allocated_untaxed + ir.allocated_tax AS allocated$ib1o$), public.ga_ib1_nl(v_def, $ib1n$x.claim_total + x.prepay_offset /* GAIB1-S5 */ AS claim_total, ir.allocated_untaxed + ir.allocated_tax AS allocated$ib1n$), 'public.ga_pay_check_tol_reasons(uuid) 尾差原因含核銷');
  END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$AND abs(x.claim_total + x.prepay_offset - (ir.allocated_untaxed + ir.allocated_tax)) > v_tol /* GAIB1-S5 */$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$AND abs(x.claim_total - (ir.allocated_untaxed + ir.allocated_tax)) > v_tol$ib1o$), public.ga_ib1_nl(v_def, $ib1n$AND abs(x.claim_total + x.prepay_offset - (ir.allocated_untaxed + ir.allocated_tax)) > v_tol /* GAIB1-S5 */$ib1n$), 'public.ga_pay_check_tol_reasons(uuid) 尾差條件含核銷');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$/* GAUP */ AND q.pay_kind <> 'PREPAY' /* GAIB1-S5 */ THEN RETURN public.ga_rq_err(400, 'LINES_REQUIRED'$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$/* GAUP */ THEN RETURN public.ga_rq_err(400, 'LINES_REQUIRED'$ib1o$), public.ga_ib1_nl(v_def, $ib1n$/* GAUP */ AND q.pay_kind <> 'PREPAY' /* GAIB1-S5 */ THEN RETURN public.ga_rq_err(400, 'LINES_REQUIRED'$ib1n$), 'public.ga_ws_pay_request_action(uuid,text,jsonb,text,timestamp with time zone) 預付單免明細');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_pay_request_json(uuid,boolean,boolean,boolean)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$'claim_untaxed', l.claim_untaxed, 'claim_tax', l.claim_tax, 'claim_total', l.claim_total, 'diff_reason', l.diff_reason, 'prepay_offset', l.prepay_offset, /* GAIB1-S5 */$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$'claim_untaxed', l.claim_untaxed, 'claim_tax', l.claim_tax, 'claim_total', l.claim_total, 'diff_reason', l.diff_reason,$ib1o$), public.ga_ib1_nl(v_def, $ib1n$'claim_untaxed', l.claim_untaxed, 'claim_tax', l.claim_tax, 'claim_total', l.claim_total, 'diff_reason', l.diff_reason, 'prepay_offset', l.prepay_offset, /* GAIB1-S5 */$ib1n$), 'public.ga_pay_request_json(uuid,boolean,boolean,boolean) 明細核銷額');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_pay_po_summary(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    'unclaimed_received', GREATEST((v_recv ->> 'total')::numeric - v_claimed, 0), 'prepay', public.ga_ib1_prepay_overview(o.id), /* GAIB1-S5 */$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$    'unclaimed_received', GREATEST((v_recv ->> 'total')::numeric - v_claimed, 0),$ib1o$), public.ga_ib1_nl(v_def, $ib1n$    'unclaimed_received', GREATEST((v_recv ->> 'total')::numeric - v_claimed, 0), 'prepay', public.ga_ib1_prepay_overview(o.id), /* GAIB1-S5 */$ib1n$), 'public.ga_ws_pay_po_summary(uuid) 預付摘要');
  END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$'untaxed', public.ga_pay_receipt_untaxed(r.id), 'total', public.ga_pay_receipt_total(r.id), 'prepay_offset', public.ga_pay_receipt_offset(r.id), /* GAIB1-S5 */$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$'untaxed', public.ga_pay_receipt_untaxed(r.id), 'total', public.ga_pay_receipt_total(r.id),$ib1o$), public.ga_ib1_nl(v_def, $ib1n$'untaxed', public.ga_pay_receipt_untaxed(r.id), 'total', public.ga_pay_receipt_total(r.id), 'prepay_offset', public.ga_pay_receipt_offset(r.id), /* GAIB1-S5 */$ib1n$), 'public.ga_ws_pay_po_summary(uuid) 進貨核銷額');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_pay_receipt_candidates(jsonb,integer,integer)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$        'receipt_prepay_offset', public.ga_pay_receipt_offset(x.receipt_id), 'prepay_covered', (x.u + public.ga_pay_receipt_tax(x.receipt_id) - public.ga_pay_receipt_offset(x.receipt_id) - (SELECT COALESCE(sum(l.claim_total), 0) FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.receipt_id = x.receipt_id AND q.status <> 'VOID') <= 0 AND public.ga_pay_receipt_offset(x.receipt_id) > 0), /* GAIB1-S5 */
        'tolerance', v_tol,$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$        'tolerance', v_tol,$ib1o$), public.ga_ib1_nl(v_def, $ib1n$        'receipt_prepay_offset', public.ga_pay_receipt_offset(x.receipt_id), 'prepay_covered', (x.u + public.ga_pay_receipt_tax(x.receipt_id) - public.ga_pay_receipt_offset(x.receipt_id) - (SELECT COALESCE(sum(l.claim_total), 0) FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests q ON q.id = l.pr_id WHERE l.receipt_id = x.receipt_id AND q.status <> 'VOID') <= 0 AND public.ga_pay_receipt_offset(x.receipt_id) > 0), /* GAIB1-S5 */
        'tolerance', v_tol,$ib1n$), 'public.ga_ws_pay_receipt_candidates(jsonb,integer,integer) 候選核銷額');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_po_action(uuid,text,timestamp with time zone,text)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    IF p_action IN ('cancel', 'short_close', 'close') THEN PERFORM public.ga_ib1_prepay_close_guard(p_id); END IF; -- GAIB1-S5
    v_thr := public.ga_wf_num('po_approval_threshold', 5000);$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$    v_thr := public.ga_wf_num('po_approval_threshold', 5000);$ib1o$), public.ga_ib1_nl(v_def, $ib1n$    IF p_action IN ('cancel', 'short_close', 'close') THEN PERFORM public.ga_ib1_prepay_close_guard(p_id); END IF; -- GAIB1-S5
    v_thr := public.ga_wf_num('po_approval_threshold', 5000);$ib1n$), 'public.ga_ws_po_action(uuid,text,timestamp with time zone,text) 結案守門');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_po_list(jsonb,integer,integer)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$       AND (COALESCE(v_f->>'prepaid', '') NOT IN ('1', 'true') OR (v_pay AND public.ga_pay_po_prepay_balance(o.id) > 0)) -- GAIB1-S5
       AND (COALESCE(v_f->>'prepay_overdue', '') NOT IN ('1', 'true') OR (v_pay AND o.status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND o.expected_delivery_date IS NOT NULL AND o.expected_delivery_date < v_today AND public.ga_pay_po_prepay_balance(o.id) > 0))
       AND (v_vendor IS NULL OR o.vendor_id = v_vendor)$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$       AND (v_vendor IS NULL OR o.vendor_id = v_vendor)$ib1o$), public.ga_ib1_nl(v_def, $ib1n$       AND (COALESCE(v_f->>'prepaid', '') NOT IN ('1', 'true') OR (v_pay AND public.ga_pay_po_prepay_balance(o.id) > 0)) -- GAIB1-S5
       AND (COALESCE(v_f->>'prepay_overdue', '') NOT IN ('1', 'true') OR (v_pay AND o.status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND o.expected_delivery_date IS NOT NULL AND o.expected_delivery_date < v_today AND public.ga_pay_po_prepay_balance(o.id) > 0))
       AND (v_vendor IS NULL OR o.vendor_id = v_vendor)$ib1n$), 'public.ga_ws_po_list(jsonb,integer,integer) 預付篩選');
  END IF;
  IF position(public.ga_ib1_nl(v_def, $ib1n$'overdue', (b.status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND b.expected_delivery_date IS NOT NULL AND b.expected_delivery_date < v_today),
             'prepay_balance', CASE WHEN v_pay THEN public.ga_pay_po_prepay_balance(b.id) END, /* GAIB1-S5 */$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$'overdue', (b.status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND b.expected_delivery_date IS NOT NULL AND b.expected_delivery_date < v_today),$ib1o$), public.ga_ib1_nl(v_def, $ib1n$'overdue', (b.status IN ('ORDERED', 'PARTIALLY_RECEIVED') AND b.expected_delivery_date IS NOT NULL AND b.expected_delivery_date < v_today),
             'prepay_balance', CASE WHEN v_pay THEN public.ga_pay_po_prepay_balance(b.id) END, /* GAIB1-S5 */$ib1n$), 'public.ga_ws_po_list(jsonb,integer,integer) 預付欄位');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_ws_home_summary()'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$'sub', COALESCE(x.vendor_name_snapshot, '') || '　預計 ' || x.expected_delivery_date::text || COALESCE(CASE WHEN public.ga_pay_can_view(auth.uid()) AND public.ga_pay_po_prepay_balance(x.id) > 0 THEN '　已預付餘額 NT$' || public.ga_pay_po_prepay_balance(x.id)::bigint END, '') /* GAIB1-S5 */, 'at', x.expected_delivery_date) ORDER BY x.expected_delivery_date, x.id), '[]'::jsonb) INTO v_top$ib1n$) IN v_new) = 0 THEN
    v_new := public.ga_ib1_swap(v_new, public.ga_ib1_nl(v_def, $ib1o$'sub', COALESCE(x.vendor_name_snapshot, '') || '　預計 ' || x.expected_delivery_date::text, 'at', x.expected_delivery_date) ORDER BY x.expected_delivery_date, x.id), '[]'::jsonb) INTO v_top$ib1o$), public.ga_ib1_nl(v_def, $ib1n$'sub', COALESCE(x.vendor_name_snapshot, '') || '　預計 ' || x.expected_delivery_date::text || COALESCE(CASE WHEN public.ga_pay_can_view(auth.uid()) AND public.ga_pay_po_prepay_balance(x.id) > 0 THEN '　已預付餘額 NT$' || public.ga_pay_po_prepay_balance(x.id)::bigint END, '') /* GAIB1-S5 */, 'at', x.expected_delivery_date) ORDER BY x.expected_delivery_date, x.id), '[]'::jsonb) INTO v_top$ib1n$), 'public.ga_ws_home_summary() 逾期標預付');
  END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DROP FUNCTION IF EXISTS public.ga_ib1_swap(text, text, text, text);
DROP FUNCTION IF EXISTS public.ga_ib1_nl(text, text);

-- ================================================================ 5. 權限：對外函式只給登入者；內部輔助與觸發器函式不開放（不授權給任何角色）
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('ga_ws_pay_prepay_create', 'ga_ws_pay_prepay_settle', 'ga_ws_pay_prepay_overview') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('ga_pay_po_offset', 'ga_pay_receipt_offset', 'ga_pay_prepay_balance', 'ga_pay_po_prepay_balance', 'ga_pay_prepay_apply', 'ga_pay_prepay_release',
                                                         'ga_ib1_prepay_overview', 'ga_ib1_prepay_cap_check', 'ga_ib1_prepay_guard', 'ga_ib1_prepay_sync', 'ga_ib1_prepay_set_amount',
                                                         'ga_ib1_prepay_close_guard', 'ga_ib1_check_prepay_live', 'ga_ib1_prepay_lines_guard', 'ga_pay_prepay_reconcile') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;
NOTIFY pgrst, 'reload schema';
