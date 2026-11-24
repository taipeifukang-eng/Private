-- 還原 20261124100000_ga_utility_payment_schema.sql（水電話費請款階段 1）。
-- 先決：140000、130000、120000、110000 已先撤回（撤回順序與套用相反）。
-- 安全規則：已有非作廢的水電請款單，或有帳單的 paid_by_pr_id 不為空時，開頭就中止並列出筆數；請先把這些請款單作廢、確認帳單狀態後才可撤回（避免撤回後留下孤兒或帳單狀態無法回復）。
-- 已作廢的水電請款單與其明細會隨撤回一起刪除（水電明細表整張 DROP；請款單主表的水電列在這裡一併刪除，操作紀錄事件不可改刪，撤回前請確認不需要保留）。
DO $$
DECLARE
  v_open integer := 0;
  v_paid integer := 0;
  v_void integer := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'source') THEN
    SELECT count(*) INTO v_open FROM public.ga_payment_requests WHERE source = 'UTILITY' AND status <> 'VOID';
    SELECT count(*) INTO v_void FROM public.ga_payment_requests WHERE source = 'UTILITY' AND status = 'VOID';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_utility_bills' AND column_name = 'paid_by_pr_id') THEN
    SELECT count(*) INTO v_paid FROM public.ga_utility_bills WHERE paid_by_pr_id IS NOT NULL;
  END IF;
  IF v_open > 0 OR v_paid > 0 THEN
    RAISE EXCEPTION '不能撤回：還有 % 張非作廢的水電請款單、% 張由請款單自動標記已繳的帳單。請先把水電請款單作廢並確認帳單狀態，再撤回。', v_open, v_paid;
  END IF;
  IF v_void > 0 THEN
    RAISE NOTICE '將一併刪除 % 張已作廢的水電請款單（含其操作紀錄）', v_void;
  END IF;
END $$;

-- 已作廢的水電請款單：事件表有不可改刪觸發器，單一交易內暫停後刪除、立刻恢復。
DO $$
DECLARE
  v_prs uuid[];
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_payment_requests' AND column_name = 'source') THEN
    SELECT COALESCE(array_agg(id), '{}') INTO v_prs FROM public.ga_payment_requests WHERE source = 'UTILITY';
    IF COALESCE(array_length(v_prs, 1), 0) > 0 THEN
      ALTER TABLE public.ga_payment_request_events DISABLE TRIGGER trg_ga_payment_request_events_immutable;
      DELETE FROM public.ga_payment_request_events WHERE pr_id = ANY (v_prs);
      ALTER TABLE public.ga_payment_request_events ENABLE TRIGGER trg_ga_payment_request_events_immutable;
      IF to_regclass('public.ga_payment_request_bill_lines') IS NOT NULL THEN
        ALTER TABLE public.ga_payment_request_bill_lines DISABLE TRIGGER trg_ga_pay_ub_lines_guard;
        DELETE FROM public.ga_payment_request_bill_lines WHERE pr_id = ANY (v_prs);
        ALTER TABLE public.ga_payment_request_bill_lines ENABLE TRIGGER trg_ga_pay_ub_lines_guard;
      END IF;
      DELETE FROM public.ga_payment_requests WHERE id = ANY (v_prs);
    END IF;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_ga_pay_ub_lines_guard ON public.ga_payment_request_bill_lines;
DROP TABLE IF EXISTS public.ga_payment_request_bill_lines;
DROP TRIGGER IF EXISTS trg_ga_pay_ub_guard ON public.ga_payment_requests;
DROP TRIGGER IF EXISTS trg_ga_pay_lines_source_guard ON public.ga_payment_request_lines;
DROP FUNCTION IF EXISTS public.ga_pay_ub_lines_guard();
DROP FUNCTION IF EXISTS public.ga_pay_ub_guard();
DROP FUNCTION IF EXISTS public.ga_pay_lines_source_guard();

DROP INDEX IF EXISTS public.idx_ga_utility_bills_paid_by_pr;
DROP INDEX IF EXISTS public.idx_ga_utility_bills_payee_month;
ALTER TABLE public.ga_utility_bills DROP COLUMN IF EXISTS paid_by_pr_id;
ALTER TABLE public.ga_utility_bills DROP COLUMN IF EXISTS payee_vendor_id;

DROP INDEX IF EXISTS public.idx_ga_payment_requests_source_status;
ALTER TABLE public.ga_payment_requests DROP CONSTRAINT IF EXISTS ga_payment_requests_utility_check;
ALTER TABLE public.ga_payment_requests DROP CONSTRAINT IF EXISTS ga_payment_requests_source_check;
ALTER TABLE public.ga_payment_requests DROP COLUMN IF EXISTS auto_mark_paid;
ALTER TABLE public.ga_payment_requests DROP COLUMN IF EXISTS bill_month;
ALTER TABLE public.ga_payment_requests DROP COLUMN IF EXISTS source;

-- 分類：只有「這個檔新增的」且沒有廠商使用才刪；總務自己建的同名分類不動。
DO $$
DECLARE
  v_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ga_workflow_settings WHERE key = 'utility_payee_category_seeded' AND value_num = 1) THEN
    SELECT value_text::uuid INTO v_id FROM public.ga_workflow_settings WHERE key = 'utility_payee_category_id';
    IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.ga_vendors WHERE v_id = ANY (service_category_ids)) THEN
      DELETE FROM public.ga_service_categories WHERE id = v_id AND code = 'UTILITY';
    END IF;
  END IF;
  DELETE FROM public.ga_workflow_settings WHERE key IN ('utility_payee_category_id', 'utility_payee_category_seeded');
END $$;
NOTIFY pgrst, 'reload schema';
