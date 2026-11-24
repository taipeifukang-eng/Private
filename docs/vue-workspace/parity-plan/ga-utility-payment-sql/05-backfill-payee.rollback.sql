-- 還原 05-backfill-payee.sql：依備份表把「這支腳本補填的」帳單的繳費單位清回空白（只清備份表裡、且目前仍是備份當時那間單位、且不在有效請款單內的帳單），然後刪備份表。
-- 若有補填的帳單已被放進未作廢的水電請款單，開頭就中止並列出筆數：請先把那些請款單作廢，再撤回。
DO $$
DECLARE
  v_n integer;
BEGIN
  IF to_regclass('public.ga_utility_bills_payee_backfill_bak') IS NULL THEN RAISE NOTICE '沒有備份表，不需要撤回'; RETURN; END IF;
  SELECT count(*) INTO v_n FROM public.ga_payment_request_bill_lines l JOIN public.ga_utility_bills_payee_backfill_bak k ON k.bill_id = l.bill_id WHERE l.active;
  IF v_n > 0 THEN RAISE EXCEPTION '不能撤回：有 % 筆補填過的帳單已在有效請款單內，請先作廢那些請款單', v_n; END IF;
  ALTER TABLE public.ga_utility_bills DISABLE TRIGGER trg_ga_utility_bills_before_write;
  UPDATE public.ga_utility_bills b SET payee_vendor_id = NULL FROM public.ga_utility_bills_payee_backfill_bak k WHERE k.bill_id = b.id AND b.payee_vendor_id = k.vendor_id;
  ALTER TABLE public.ga_utility_bills ENABLE TRIGGER trg_ga_utility_bills_before_write;
  DROP TABLE public.ga_utility_bills_payee_backfill_bak;
END $$;
