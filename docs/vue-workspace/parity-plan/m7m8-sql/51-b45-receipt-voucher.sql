-- 51-b45-receipt-voucher.sql
-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/20261119100000_m7m8_b45_receipt_voucher.sql 相同。
-- 第 4.5 批 A（進貨憑證欄位、進貨明細未稅金額、進貨發票與連結表；D17、D18）（2026-11-19 第 4.5 批問卷 P1 至 P10）。
-- 性質：會寫入（回填）。進貨明細新增 amount_untaxed（未稅金額）並以「採購單品項單價 × 驗入量」回填既有資料（品項各自四捨五入到整數元；50 第 2 區先看筆數與單價為 0 的筆數），
--   並裝 1 個 BEFORE INSERT 觸發器（之後新增的進貨明細自動凍結金額，不改第 4 批到貨函式）；進貨單新增 updated_at／updated_by（既有列以建立時間回填）、voucher_*（憑證狀態）、voided_*（作廢進貨）共 9 個欄位與 2 條檢查、1 個部分索引；
--   新增 2 張表 ga_purchase_invoices（五種類型、同廠商同發票號碼非作廢唯一、含稅＝未稅＋稅額）與 ga_purchase_invoice_receipts（發票與進貨多對多）；兩張新表啟用 RLS 且不開放 policy，登入者不能直接讀寫。
-- 不改舊版任何資料與畫面；舊版沒有發票與請款功能。
-- 先決條件：第 4 批 33（採購單）與 34（到貨驗入）已套用；ga_vendors、profiles 存在（50 第 1 區不能有 MISSING）。回填前請先備份進貨兩表（README 第 4.5 批有備份指令）。
-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：51-b45-receipt-voucher-rollback.sql。套用前先跑 50-b45-preview-before-apply.sql，備份後經使用者核可才執行。
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.ga_purchase_receipts') IS NULL OR to_regclass('public.ga_purchase_receipt_items') IS NULL OR to_regclass('public.ga_purchase_order_items') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: 請先套用第 4 批 20261112110000、20261112120000（採購單、到貨驗入）';
  END IF;
  IF to_regclass('public.ga_vendors') IS NULL OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: ga_vendors／profiles';
  END IF;
END $$;

-- ================================================================ 1. 進貨品項未稅金額
ALTER TABLE public.ga_purchase_receipt_items ADD COLUMN IF NOT EXISTS amount_untaxed numeric(14,0);

-- 寫入進貨明細時自動凍結未稅金額（單價是採購單位計價，乘驗入量 accepted_qty；品項各自四捨五入到整數元）。
CREATE OR REPLACE FUNCTION public.ga_pay_freeze_receipt_item_amount() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.amount_untaxed IS NULL THEN
    SELECT round(i.unit_price * NEW.accepted_qty) INTO NEW.amount_untaxed FROM public.ga_purchase_order_items i WHERE i.id = NEW.po_item_id;
    IF NEW.amount_untaxed IS NULL THEN NEW.amount_untaxed := 0; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ga_pay_freeze_receipt_item_amount ON public.ga_purchase_receipt_items;
CREATE TRIGGER trg_ga_pay_freeze_receipt_item_amount BEFORE INSERT ON public.ga_purchase_receipt_items FOR EACH ROW EXECUTE FUNCTION public.ga_pay_freeze_receipt_item_amount();

-- 回填既有進貨明細（DEV 多半 0 筆；正式區筆數由 50 預覽檔先看）。
UPDATE public.ga_purchase_receipt_items ri SET amount_untaxed = round(i.unit_price * ri.accepted_qty)
  FROM public.ga_purchase_order_items i WHERE i.id = ri.po_item_id AND ri.amount_untaxed IS NULL;
UPDATE public.ga_purchase_receipt_items SET amount_untaxed = 0 WHERE amount_untaxed IS NULL;
ALTER TABLE public.ga_purchase_receipt_items ALTER COLUMN amount_untaxed SET NOT NULL;
-- 不設預設值：新增進貨明細時金額欄位是 NULL，由觸發器依單價與驗入量凍結（若預設 0，觸發器會看不出沒給金額）。
ALTER TABLE public.ga_purchase_receipt_items ALTER COLUMN amount_untaxed DROP DEFAULT;
DO $$ BEGIN
  ALTER TABLE public.ga_purchase_receipt_items ADD CONSTRAINT ga_purchase_receipt_items_amount_nonneg CHECK (amount_untaxed >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ================================================================ 2. 進貨單表頭
ALTER TABLE public.ga_purchase_receipts ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.ga_purchase_receipts ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
UPDATE public.ga_purchase_receipts SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE public.ga_purchase_receipts ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.ga_purchase_receipts ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE public.ga_purchase_receipts ADD COLUMN IF NOT EXISTS voucher_status text NOT NULL DEFAULT 'NONE';
ALTER TABLE public.ga_purchase_receipts ADD COLUMN IF NOT EXISTS voucher_note text;
ALTER TABLE public.ga_purchase_receipts ADD COLUMN IF NOT EXISTS voucher_recorded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.ga_purchase_receipts ADD COLUMN IF NOT EXISTS voucher_recorded_at timestamptz;
ALTER TABLE public.ga_purchase_receipts ADD COLUMN IF NOT EXISTS voided_at timestamptz;
ALTER TABLE public.ga_purchase_receipts ADD COLUMN IF NOT EXISTS voided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.ga_purchase_receipts ADD COLUMN IF NOT EXISTS void_reason text;
DO $$ BEGIN
  ALTER TABLE public.ga_purchase_receipts ADD CONSTRAINT ga_purchase_receipts_voucher_status_check CHECK (voucher_status IN ('NONE', 'LINKED', 'NO_INVOICE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.ga_purchase_receipts ADD CONSTRAINT ga_purchase_receipts_void_check CHECK ((voided_at IS NULL AND void_reason IS NULL) OR (voided_at IS NOT NULL AND void_reason IS NOT NULL AND btrim(void_reason) <> ''));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_ga_purchase_receipts_po_active ON public.ga_purchase_receipts (po_id) WHERE voided_at IS NULL;

-- ================================================================ 3. 進貨發票
CREATE TABLE IF NOT EXISTS public.ga_purchase_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_type text NOT NULL,
  invoice_no text,
  invoice_date date NOT NULL,
  vendor_id uuid NOT NULL REFERENCES public.ga_vendors(id),
  seller_tax_id_snapshot text,
  buyer_tax_id text,
  amount_untaxed numeric(14,0) NOT NULL,
  tax_amount numeric(14,0) NOT NULL DEFAULT 0,
  amount_total numeric(14,0) NOT NULL,
  diff_reason text,
  tax_mismatch_reason text,
  no_image_reason text,
  status text NOT NULL DEFAULT 'ACTIVE',
  void_reason text,
  voided_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  voided_at timestamptz,
  void_key text,
  notes text,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ga_purchase_invoices_type_check CHECK (invoice_type IN ('TRIPLE', 'DUPLEX', 'E_INVOICE', 'RECEIPT', 'NO_INVOICE')),
  CONSTRAINT ga_purchase_invoices_status_check CHECK (status IN ('ACTIVE', 'VOID')),
  CONSTRAINT ga_purchase_invoices_amount_check CHECK (amount_untaxed >= 0 AND tax_amount >= 0 AND amount_total = amount_untaxed + tax_amount),
  CONSTRAINT ga_purchase_invoices_no_tax_types CHECK (invoice_type IN ('TRIPLE', 'DUPLEX', 'E_INVOICE') OR tax_amount = 0),
  CONSTRAINT ga_purchase_invoices_no_required CHECK (invoice_type IN ('RECEIPT', 'NO_INVOICE') OR (invoice_no IS NOT NULL AND btrim(invoice_no) <> '')),
  CONSTRAINT ga_purchase_invoices_void_check CHECK ((status = 'ACTIVE' AND voided_at IS NULL AND void_reason IS NULL) OR (status = 'VOID' AND voided_at IS NOT NULL AND void_reason IS NOT NULL AND btrim(void_reason) <> '')),
  CONSTRAINT ga_purchase_invoices_idem_unique UNIQUE (idempotency_key)
);
-- 同廠商同發票號碼（排除作廢、忽略大小寫與前後空白）不可重複。
CREATE UNIQUE INDEX IF NOT EXISTS ga_purchase_invoices_vendor_no_uidx ON public.ga_purchase_invoices (vendor_id, lower(btrim(invoice_no))) WHERE status <> 'VOID' AND invoice_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ga_purchase_invoices_vendor_date ON public.ga_purchase_invoices (vendor_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_ga_purchase_invoices_status ON public.ga_purchase_invoices (status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.ga_purchase_invoice_receipts (
  invoice_id uuid NOT NULL REFERENCES public.ga_purchase_invoices(id) ON DELETE CASCADE,
  receipt_id uuid NOT NULL REFERENCES public.ga_purchase_receipts(id) ON DELETE RESTRICT,
  allocated_untaxed numeric(14,0) NOT NULL DEFAULT 0,
  allocated_tax numeric(14,0) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (invoice_id, receipt_id),
  CONSTRAINT ga_purchase_invoice_receipts_amount CHECK (allocated_untaxed >= 0 AND allocated_tax >= 0)
);
CREATE INDEX IF NOT EXISTS idx_ga_purchase_invoice_receipts_receipt ON public.ga_purchase_invoice_receipts (receipt_id);

-- 登入者不能直接讀寫（啟用 RLS 且不建 policy；另收回資料表權限）。
ALTER TABLE public.ga_purchase_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_purchase_invoice_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ga_purchase_invoices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.ga_purchase_invoice_receipts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ga_purchase_invoices TO service_role;
GRANT ALL ON public.ga_purchase_invoice_receipts TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 核對
SELECT count(*) AS receipt_items, count(*) FILTER (WHERE amount_untaxed IS NULL) AS null_amount FROM public.ga_purchase_receipt_items;
-- 核對：null_amount 必須是 0
SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' AND ((table_name = 'ga_purchase_receipt_items' AND column_name = 'amount_untaxed') OR (table_name = 'ga_purchase_receipts' AND column_name IN ('updated_at', 'updated_by', 'voucher_status', 'voucher_note', 'voucher_recorded_by', 'voucher_recorded_at', 'voided_at', 'voided_by', 'void_reason'))) ORDER BY 1, 2;
-- 核對：應列出 10 個欄位
SELECT to_regclass('public.ga_purchase_invoices') AS invoices, to_regclass('public.ga_purchase_invoice_receipts') AS invoice_receipts;
-- 核對：兩個都不是空的
