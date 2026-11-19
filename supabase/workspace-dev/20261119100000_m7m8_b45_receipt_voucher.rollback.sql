-- 還原 20261119100000_m7m8_b45_receipt_voucher.sql：移除發票表、進貨明細金額觸發器與欄位、進貨單表頭新增欄位。
-- 先決：後面的 110000（請款單）與 150000 之後的函式已先撤回（它們參照這些表與欄位；apply 腳本 --rollback 會反向執行）。
-- 護欄：已有作廢進貨時中止。作廢進貨的庫存沖回與採購單品項驗入量扣回已經發生，撤回 voided_* 欄位會讓這些進貨「復活」成有效，但庫存與驗入量不會還原，等於重複計算。
-- 若確定要撤回，請先人工處理這些進貨（例如重新登錄到貨或手動調整庫存與驗入量）並清掉 voided_at 後再執行。
DO $$
DECLARE v_n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'ga_purchase_receipts' AND column_name = 'voided_at') THEN
    EXECUTE 'SELECT count(*) FROM public.ga_purchase_receipts WHERE voided_at IS NOT NULL' INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION '已有 % 筆作廢進貨，撤回會讓它們復活為有效進貨（庫存與驗入量不會還原）。請先人工處理後再撤回。', v_n;
    END IF;
  END IF;
END $$;
DROP TABLE IF EXISTS public.ga_purchase_invoice_receipts;
DROP TABLE IF EXISTS public.ga_purchase_invoices;
DROP INDEX IF EXISTS public.idx_ga_purchase_receipts_po_active;
ALTER TABLE public.ga_purchase_receipts DROP CONSTRAINT IF EXISTS ga_purchase_receipts_void_check;
ALTER TABLE public.ga_purchase_receipts DROP CONSTRAINT IF EXISTS ga_purchase_receipts_voucher_status_check;
ALTER TABLE public.ga_purchase_receipts DROP COLUMN IF EXISTS void_reason, DROP COLUMN IF EXISTS voided_by, DROP COLUMN IF EXISTS voided_at,
  DROP COLUMN IF EXISTS voucher_recorded_at, DROP COLUMN IF EXISTS voucher_recorded_by, DROP COLUMN IF EXISTS voucher_note, DROP COLUMN IF EXISTS voucher_status,
  DROP COLUMN IF EXISTS updated_by, DROP COLUMN IF EXISTS updated_at;
DROP TRIGGER IF EXISTS trg_ga_pay_freeze_receipt_item_amount ON public.ga_purchase_receipt_items;
DROP FUNCTION IF EXISTS public.ga_pay_freeze_receipt_item_amount();
ALTER TABLE public.ga_purchase_receipt_items DROP CONSTRAINT IF EXISTS ga_purchase_receipt_items_amount_nonneg;
ALTER TABLE public.ga_purchase_receipt_items DROP COLUMN IF EXISTS amount_untaxed;
NOTIFY pgrst, 'reload schema';
