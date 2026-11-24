-- 水電話費請款（G46）階段 1：資料表與欄位（DEV；正式區草稿 ga-utility-payment-sql/01 內容相同）。
-- 把水電網費帳單（ga_utility_bills）接到既有請款單（ga_payment_requests）：
--   ga_payment_requests 擴充三欄 source（PURCHASE／UTILITY，預設 PURCHASE）、bill_month、auto_mark_paid（皆有預設值，既有資料不重寫）；
--   新表 ga_payment_request_bill_lines（水電明細，不放寬採購明細表）：部分唯一索引 UNIQUE(bill_id) WHERE active ＝同一張帳單同時只能在一張有效（非作廢）請款單；
--   ga_utility_bills 擴充 payee_vendor_id（繳費單位）、paid_by_pr_id（由哪張請款單自動標記已繳）；
--   設定鍵 utility_payee_category_id（公用事業分類 id）與分類種子（先找 code=UTILITY 或名稱「公用事業」，找不到才新增）；
--   守門觸發器：採購明細只能放進採購請款單；請款單來源不可改、水電單的繳費單位與月份不可改、非草稿時自動標記旗標鎖定；水電明細只有草稿可改（作廢與自動回復留痕例外）。
-- 不新增權限碼、不授權給任何角色、不改 RLS 政策（新表 RLS 全封，與 ga_payment_request_lines 相同）。可重複執行。
-- 先決：第 4.5 批（ga_payment_requests、ga_payment_request_lines、ga_ws_pay_request_*）、G23（ga_utility_bills）、廠商（ga_vendors、ga_service_categories）。
-- 還原：20261124100000_ga_utility_payment_schema.rollback.sql（已有非作廢水電請款單或自動標記的帳單時中止）。

DO $$
BEGIN
  IF to_regclass('public.ga_payment_requests') IS NULL OR to_regclass('public.ga_payment_request_lines') IS NULL OR to_regclass('public.ga_payment_request_events') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: 請先套用第 4.5 批請款單（ga_payment_requests／ga_payment_request_lines）';
  END IF;
  IF to_regclass('public.ga_utility_bills') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite table: ga_utility_bills（G23 水電網費）'; END IF;
  IF to_regclass('public.ga_vendors') IS NULL OR to_regclass('public.ga_service_categories') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite table: ga_vendors／ga_service_categories（廠商資料）'; END IF;
  IF to_regclass('public.ga_workflow_settings') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite table: ga_workflow_settings'; END IF;
  IF to_regprocedure('public.ga_rq_raise(integer,text,text,jsonb)') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite function: ga_rq_raise'; END IF;
END $$;

-- ================================================================ 1. 請款單主表擴充
ALTER TABLE public.ga_payment_requests ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'PURCHASE';
ALTER TABLE public.ga_payment_requests ADD COLUMN IF NOT EXISTS bill_month date;
ALTER TABLE public.ga_payment_requests ADD COLUMN IF NOT EXISTS auto_mark_paid boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ga_payment_requests_source_check' AND conrelid = 'public.ga_payment_requests'::regclass) THEN
    ALTER TABLE public.ga_payment_requests ADD CONSTRAINT ga_payment_requests_source_check CHECK (source IN ('PURCHASE', 'UTILITY'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ga_payment_requests_utility_check' AND conrelid = 'public.ga_payment_requests'::regclass) THEN
    ALTER TABLE public.ga_payment_requests ADD CONSTRAINT ga_payment_requests_utility_check CHECK (
      (source = 'UTILITY' AND bill_month IS NOT NULL AND extract(day FROM bill_month) = 1)
      OR (source = 'PURCHASE' AND bill_month IS NULL AND auto_mark_paid = false));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_ga_payment_requests_source_status ON public.ga_payment_requests (source, status, created_at DESC);

-- ================================================================ 2. 帳單表擴充
ALTER TABLE public.ga_utility_bills ADD COLUMN IF NOT EXISTS payee_vendor_id uuid REFERENCES public.ga_vendors(id) ON DELETE RESTRICT;
ALTER TABLE public.ga_utility_bills ADD COLUMN IF NOT EXISTS paid_by_pr_id uuid REFERENCES public.ga_payment_requests(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ga_utility_bills_payee_month ON public.ga_utility_bills (payee_vendor_id, billing_month) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ga_utility_bills_paid_by_pr ON public.ga_utility_bills (paid_by_pr_id) WHERE paid_by_pr_id IS NOT NULL;

-- ================================================================ 3. 水電請款明細（新表）
CREATE TABLE IF NOT EXISTS public.ga_payment_request_bill_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id uuid NOT NULL REFERENCES public.ga_payment_requests(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  bill_id uuid NOT NULL REFERENCES public.ga_utility_bills(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  claim_total numeric(14,0) NOT NULL,
  store_id uuid,
  location_name text NOT NULL,
  expense_type text NOT NULL,
  billing_month date NOT NULL,
  identifier text,
  service_label text,
  due_date date,
  auto_paid_date date,
  auto_reverted_at timestamptz,
  auto_revert_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_payment_request_bill_lines_amount_check CHECK (claim_total > 0),
  CONSTRAINT ga_payment_request_bill_lines_line_unique UNIQUE (pr_id, line_no),
  CONSTRAINT ga_payment_request_bill_lines_revert_check CHECK (auto_revert_reason IS NULL OR auto_revert_reason IN ('RETURN', 'VOID'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ga_payment_request_bill_lines_active_uidx ON public.ga_payment_request_bill_lines (bill_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_ga_payment_request_bill_lines_bill ON public.ga_payment_request_bill_lines (bill_id);
CREATE INDEX IF NOT EXISTS idx_ga_payment_request_bill_lines_pr ON public.ga_payment_request_bill_lines (pr_id);

ALTER TABLE public.ga_payment_request_bill_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ga_payment_request_bill_lines FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ga_payment_request_bill_lines TO service_role;

-- ================================================================ 4. 守門觸發器
-- 4.1 採購明細只能放進採購請款單（防止呼叫錯函式把採購明細塞進水電請款單）。採購既有流程父單一律是 PURCHASE，不受影響。
CREATE OR REPLACE FUNCTION public.ga_pay_lines_source_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_src text;
BEGIN
  SELECT source INTO v_src FROM public.ga_payment_requests WHERE id = NEW.pr_id;
  IF v_src IS NOT NULL AND v_src <> 'PURCHASE' THEN
    PERFORM public.ga_rq_raise(409, 'SOURCE_MISMATCH', '這張是水電話費請款單，不能放採購明細；水電請款單的明細是水電帳單');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ga_pay_lines_source_guard ON public.ga_payment_request_lines;
CREATE TRIGGER trg_ga_pay_lines_source_guard BEFORE INSERT ON public.ga_payment_request_lines FOR EACH ROW EXECUTE FUNCTION public.ga_pay_lines_source_guard();

-- 4.2 請款單來源不可改；水電單的繳費單位（vendor_id）與帳單月份建立後不可改；非草稿時自動標記旗標鎖定。與既有 ga_pay_request_guard 並存，各管各的欄位。
CREATE OR REPLACE FUNCTION public.ga_pay_ub_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.source IS DISTINCT FROM OLD.source THEN RAISE EXCEPTION '請款單的來源（採購／水電話費）建立後不能修改' USING ERRCODE = 'GA045'; END IF;
  IF NEW.source = 'UTILITY' AND (NEW.vendor_id IS DISTINCT FROM OLD.vendor_id OR NEW.bill_month IS DISTINCT FROM OLD.bill_month) THEN
    RAISE EXCEPTION '水電話費請款單的繳費單位與帳單月份建立後不能修改' USING ERRCODE = 'GA045';
  END IF;
  IF OLD.status <> 'DRAFT' AND NEW.auto_mark_paid IS DISTINCT FROM OLD.auto_mark_paid THEN
    RAISE EXCEPTION '已送出或已付款的請款單，自動標記已繳的設定不能修改' USING ERRCODE = 'GA045';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ga_pay_ub_guard ON public.ga_payment_requests;
CREATE TRIGGER trg_ga_pay_ub_guard BEFORE UPDATE ON public.ga_payment_requests FOR EACH ROW EXECUTE FUNCTION public.ga_pay_ub_guard();

-- 4.3 水電明細守門（比照 ga_pay_request_lines_guard）：父單必須是水電請款單；新增、刪除只有草稿可以；修改只有草稿可以，
--     例外：只改留痕欄位（auto_paid_date、auto_reverted_at、auto_revert_reason），以及父單已作廢時把 active 改 false（釋放帳單）。
--     新增或換帳單時，帳單的繳費單位必須等於父單的 vendor_id、帳單月份必須等於父單的 bill_month。
CREATE OR REPLACE FUNCTION public.ga_pay_ub_lines_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_pr uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.pr_id ELSE NEW.pr_id END;
  q public.ga_payment_requests%ROWTYPE;
  b public.ga_utility_bills%ROWTYPE;
  v_trace text[] := ARRAY['auto_paid_date', 'auto_reverted_at', 'auto_revert_reason'];
  v_only_trace boolean;
  v_only_active boolean;
  v_has boolean;
BEGIN
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = v_pr;
  v_has := FOUND;
  IF v_has AND q.source <> 'UTILITY' THEN
    PERFORM public.ga_rq_raise(409, 'SOURCE_MISMATCH', '這張是採購請款單，不能放水電帳單明細');
  END IF;
  IF TG_OP = 'UPDATE' THEN
    v_only_trace := (to_jsonb(NEW) - v_trace) = (to_jsonb(OLD) - v_trace);
    v_only_active := (to_jsonb(NEW) - v_trace - 'active') = (to_jsonb(OLD) - v_trace - 'active');
    IF v_has AND q.status <> 'DRAFT' THEN
      IF v_only_trace OR (q.status = 'VOID' AND v_only_active AND NEW.active = false) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION '只有草稿的請款單可以修改明細（目前狀態 %）', q.status USING ERRCODE = 'GA045';
    END IF;
  ELSIF v_has AND q.status <> 'DRAFT' THEN
    RAISE EXCEPTION '只有草稿的請款單可以修改明細（目前狀態 %）', q.status USING ERRCODE = 'GA045';
  END IF;
  IF TG_OP <> 'DELETE' AND v_has AND (TG_OP = 'INSERT' OR NEW.bill_id IS DISTINCT FROM OLD.bill_id) THEN
    SELECT * INTO b FROM public.ga_utility_bills WHERE id = NEW.bill_id;
    IF FOUND THEN
      IF b.payee_vendor_id IS DISTINCT FROM q.vendor_id THEN
        PERFORM public.ga_rq_raise(409, 'BILL_PAYEE_MISMATCH', '這筆帳單的繳費單位與請款單的繳費單位不同，不能放進這張請款單');
      END IF;
      IF b.billing_month IS DISTINCT FROM q.bill_month THEN
        PERFORM public.ga_rq_raise(409, 'BILL_MONTH_MISMATCH', '這筆帳單的月份與請款單的帳單月份不同，不能放進這張請款單');
      END IF;
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
DROP TRIGGER IF EXISTS trg_ga_pay_ub_lines_guard ON public.ga_payment_request_bill_lines;
CREATE TRIGGER trg_ga_pay_ub_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ga_payment_request_bill_lines FOR EACH ROW EXECUTE FUNCTION public.ga_pay_ub_lines_guard();

REVOKE ALL ON FUNCTION public.ga_pay_lines_source_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_pay_ub_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ga_pay_ub_lines_guard() FROM PUBLIC, anon, authenticated;

-- ================================================================ 5. 設定鍵與「公用事業」分類種子
-- 先找設定鍵已指向的分類；沒有再找 code='UTILITY' 或名稱「公用事業」的分類；都沒有才新增（旗標 utility_payee_category_seeded=1 記錄「是這個檔新增的」，撤回時才可刪）。
DO $$
DECLARE
  v_id uuid;
  v_new boolean := false;
BEGIN
  SELECT c.id INTO v_id FROM public.ga_workflow_settings s JOIN public.ga_service_categories c ON c.id::text = s.value_text WHERE s.key = 'utility_payee_category_id';
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.ga_service_categories WHERE code = 'UTILITY' OR btrim(name) = '公用事業' ORDER BY (code = 'UTILITY') DESC, created_at LIMIT 1;
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.ga_service_categories (name, code, status, sort_order, common_items) VALUES ('公用事業', 'UTILITY', 'active', 90, '{}') RETURNING id INTO v_id;
    v_new := true;
  END IF;
  INSERT INTO public.ga_workflow_settings (key, value_text) VALUES ('utility_payee_category_id', v_id::text)
  ON CONFLICT (key) DO UPDATE SET value_text = EXCLUDED.value_text WHERE public.ga_workflow_settings.value_text IS DISTINCT FROM EXCLUDED.value_text;
  IF v_new THEN
    INSERT INTO public.ga_workflow_settings (key, value_num) VALUES ('utility_payee_category_seeded', 1) ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
