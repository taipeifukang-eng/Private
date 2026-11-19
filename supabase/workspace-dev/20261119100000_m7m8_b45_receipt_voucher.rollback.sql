-- 還原 20261119100000_m7m8_b45_receipt_voucher.sql：移除發票表、進貨明細金額觸發器與欄位、進貨單表頭新增欄位。
-- 先決：後面的 110000（請款單）與 150000 之後的函式已先撤回（它們參照這些表與欄位；apply 腳本 --rollback 會反向執行）。
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
