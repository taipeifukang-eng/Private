-- 54-b45-attachment-types-rollback.sql
-- 撤回 54：拿掉兩個附件判斷函式的 PURCHASE_ 分支、移除最後一張圖守門觸發器與缺圖函式，並把 resource_type CHECK 還原成 8 值。若附件表已有 PURCHASE_INVOICE／PURCHASE_RECEIPT 的紀錄，還原 CHECK 會失敗而整份中止（先自行決定那些附件怎麼處理；本檔不刪附件紀錄與檔案）。
-- **正式區兩個函式原定義若與 DEV 不同，以 50 第 3 區存檔的定義為準**。要先撤回 56 至 58。
-- 撤回前備份：先存 50 第 3 區的兩個函式定義與 CHECK；另存附件紀錄：
--   CREATE TABLE public.zz_bak_b45_54_attachments AS SELECT * FROM public.ga_resource_attachments WHERE resource_type IN ('PURCHASE_INVOICE', 'PURCHASE_RECEIPT');
BEGIN;

DROP TRIGGER IF EXISTS trg_ga_pay_attachment_last_image_guard ON public.ga_resource_attachments;
DROP FUNCTION IF EXISTS public.ga_pay_attachment_last_image_guard();
DROP FUNCTION IF EXISTS public.ga_pay_invoice_missing_image(text, text, integer);
DROP FUNCTION IF EXISTS public.ga_pay_invoice_image_count(uuid, uuid);

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  FOREACH v_def IN ARRAY ARRAY['public.ga_resource_attachment_can_manage(text,uuid)', 'public.ga_resource_attachment_can_read(text,uuid)'] LOOP
    v_new := pg_get_functiondef(v_def::regprocedure);
    IF position('PURCHASE_INVOICE' in v_new) > 0 THEN
      v_new := regexp_replace(v_new, 'IF p_resource_type = ''PURCHASE_INVOICE'' THEN.*?END IF;\s*IF p_resource_type = ''PURCHASE_RECEIPT'' THEN.*?END IF;\s*', '');
      IF position('PURCHASE_INVOICE' in v_new) > 0 OR position('PURCHASE_RECEIPT' in v_new) > 0 THEN
        RAISE EXCEPTION '% 的 PURCHASE_ 分支無法自動拿掉，請人工處理', v_def;
      END IF;
      EXECUTE v_new;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.ga_resource_attachments DROP CONSTRAINT IF EXISTS ga_resource_attachments_resource_type_check;
ALTER TABLE public.ga_resource_attachments ADD CONSTRAINT ga_resource_attachments_resource_type_check CHECK (resource_type = ANY (ARRAY[
  'EQUIPMENT', 'FACILITY', 'PART', 'MAINTENANCE_REQUEST', 'MAINTENANCE_UPDATE', 'SERVICE_REQUEST', 'SERVICE_REQUEST_COMMENT', 'UTILITY_BILL']));
NOTIFY pgrst, 'reload schema';

COMMIT;
