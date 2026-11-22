-- 58-b45-receipt-void-rollback.sql
-- 撤回 58：移除 ga_ws_po_receipt_void、void_key 欄位與索引，並把進貨讀取與配發函式的排除條件拿掉。已作廢的進貨（voided_at 有值）資料不會還原、庫存不會自動加回；撤回前若已有作廢進貨，請先人工確認。
-- 撤回前備份：
--   CREATE TABLE public.zz_bak_b45_58_receipts AS SELECT id, voided_at, voided_by, void_reason, void_key FROM public.ga_purchase_receipts WHERE voided_at IS NOT NULL;
BEGIN;

DO $$
DECLARE
  v_sig text;
  v_def text;
  v_new text;
  c_new constant text := ' AND NOT EXISTS (SELECT 1 FROM public.ga_purchase_receipts vr WHERE vr.id = ri.receipt_id AND vr.voided_at IS NOT NULL)';
BEGIN
  FOR v_sig IN SELECT p.oid::regprocedure::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('ga_ws_po_receipts_get', 'ga_ws_po_dispatch') LOOP
    v_def := pg_get_functiondef(v_sig::regprocedure);
    IF position('vr.voided_at' IN v_def) = 0 THEN CONTINUE; END IF;
    v_new := replace(v_def, c_new, '');
    IF position('vr.voided_at' IN v_new) > 0 THEN RAISE EXCEPTION '函式 % 的作廢排除條件無法自動拿掉，請人工處理', v_sig; END IF;
    EXECUTE v_new;
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.ga_ws_po_receipt_void(uuid, uuid, text, text, timestamptz);
DROP INDEX IF EXISTS public.ga_purchase_receipts_void_key_uidx;
ALTER TABLE public.ga_purchase_receipts DROP COLUMN IF EXISTS void_key;
NOTIFY pgrst, 'reload schema';

COMMIT;
