-- 05 選用：依「正規化名稱唯一對應」補填既有帳單的繳費單位（正式區草稿；套用前須老闆或總務確認、且總務已先建好公用事業廠商）。
-- 規則：帳單的供應商名稱（provider_name）經 ga_vd_norm_name 正規化後，與「恰好一間」公用事業分類且合作中的廠商的正規化名稱完全相同，才填；
--       零間或多間對應者一律不動；已有繳費單位的、已刪除的不動。先把將要填的帳單 id 與廠商寫入備份表 ga_utility_bills_payee_backfill_bak，撤回依備份表清回空白。
-- 帳單表有寫入觸發器（要求登入身分），這支腳本在同一個交易內暫停它、只改 payee_vendor_id、立刻恢復（任何錯誤整個交易回復）。可重複執行（只會補還沒有單位的）。
-- 先決：01 至 04 已套用、總務已在廠商資料建立公用事業廠商。
-- 還原：05-backfill-payee.rollback.sql。驗證：05-backfill-payee.verify.sql。
DO $$
DECLARE
  v_cat uuid;
  v_n integer;
BEGIN
  IF to_regclass('public.ga_payment_request_bill_lines') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite: 請先套用 01 至 04'; END IF;
  SELECT value_text::uuid INTO v_cat FROM ga_workflow_settings WHERE key = 'utility_payee_category_id';
  IF v_cat IS NULL THEN RAISE EXCEPTION '找不到公用事業分類設定（utility_payee_category_id）'; END IF;
  CREATE TABLE IF NOT EXISTS public.ga_utility_bills_payee_backfill_bak (
    bill_id uuid PRIMARY KEY,
    vendor_id uuid NOT NULL,
    filled_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE public.ga_utility_bills_payee_backfill_bak ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON public.ga_utility_bills_payee_backfill_bak FROM PUBLIC, anon, authenticated;
  WITH payee AS (
    SELECT v.id, public.ga_vd_norm_name(v.name) AS nm FROM ga_vendors v WHERE v.status = 'active' AND v_cat = ANY (v.service_category_ids)
  ), uniq AS (
    SELECT nm, (array_agg(id))[1] AS vendor_id FROM payee WHERE nm <> '' GROUP BY nm HAVING count(*) = 1
  )
  INSERT INTO public.ga_utility_bills_payee_backfill_bak (bill_id, vendor_id)
  SELECT b.id, u.vendor_id FROM ga_utility_bills b JOIN uniq u ON u.nm = public.ga_vd_norm_name(b.provider_name)
   WHERE b.deleted_at IS NULL AND b.payee_vendor_id IS NULL AND b.provider_name IS NOT NULL
  ON CONFLICT (bill_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  ALTER TABLE public.ga_utility_bills DISABLE TRIGGER trg_ga_utility_bills_before_write;
  UPDATE public.ga_utility_bills b SET payee_vendor_id = k.vendor_id FROM public.ga_utility_bills_payee_backfill_bak k WHERE k.bill_id = b.id AND b.payee_vendor_id IS NULL AND b.deleted_at IS NULL;
  ALTER TABLE public.ga_utility_bills ENABLE TRIGGER trg_ga_utility_bills_before_write;
  RAISE NOTICE '本次新增備份並補填 % 筆帳單的繳費單位', v_n;
END $$;
