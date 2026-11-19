-- 51-b45-receipt-voucher-rollback.sql
-- 撤回 51：移除發票表與連結表、進貨明細金額觸發器與 amount_untaxed 欄位、進貨單新增的 9 個欄位與檢查。會刪除：所有發票與連結、進貨憑證狀態與作廢進貨標記、進貨明細的未稅金額。
-- 要先撤回 52（請款單參照發票與進貨單）與 56 至 58（函式參照這些欄位）。撤回後新版發票與請款頁無法使用。
-- 撤回前備份（只備份會被刪掉的表與欄位）：
--   CREATE TABLE public.zz_bak_b45_51_invoices AS SELECT * FROM public.ga_purchase_invoices;
--   CREATE TABLE public.zz_bak_b45_51_invoice_receipts AS SELECT * FROM public.ga_purchase_invoice_receipts;
--   CREATE TABLE public.zz_bak_b45_51_receipt_items AS SELECT id, amount_untaxed FROM public.ga_purchase_receipt_items;
--   CREATE TABLE public.zz_bak_b45_51_receipts AS SELECT id, updated_at, updated_by, voucher_status, voucher_note, voucher_recorded_by, voucher_recorded_at, voided_at, voided_by, void_reason FROM public.ga_purchase_receipts;
BEGIN;

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

COMMIT;
