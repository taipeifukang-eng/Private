-- 54-b45-attachment-types.sql
-- 正式區草稿（尚未執行，僅供使用者審閱）。內容與 DEV 已測過的 supabase/workspace-dev/20261119130000_m7m8_b45_attachment_types.sql 相同。
-- 第 4.5 批 D（附件資源類型 PURCHASE_INVOICE、PURCHASE_RECEIPT、缺圖判斷與最後一張圖守門；A5、P10）（2026-11-19 第 4.5 批問卷 P1 至 P10）。
-- 性質：會改共用函式（要特別小心）。重建 ga_resource_attachments 的 resource_type CHECK（8 值加 PURCHASE_INVOICE、PURCHASE_RECEIPT）；對 ga_resource_attachment_can_manage 與 ga_resource_attachment_can_read（讀取函式實名是 can_read，不是 can_view）
--   各補一個分支：不整支覆蓋，讀出現行定義、只在最後的 RETURN false 前插入分支再重建；已有就略過；結尾格式不符就中止（請人工處理）。寫入需 purchase_payment.manage（發票未作廢、進貨單未作廢），讀取需 purchase_payment.view 或 manage。
--   另新增 ga_pay_invoice_image_count、ga_pay_invoice_missing_image（缺圖判斷）與軟刪除守門觸發器：已被有效（非作廢）請款單引用的發票，最後一張圖片不可刪除。
-- 既有資源類型（含水電帳單）的行為不變；套用後請用 DEV 已測過的 G45-db 附件回歸項目自己抽查（水電帳單、料件、設備附件上傳與讀取）。
-- 先決條件：先套 51、52（觸發器參照發票與請款明細）；建議第 6 批 45 已套用（can_manage 已含 UTILITY_BILL 分支；沒套也不影響本檔）。**套用前一定要做**：跑 50 第 3 區並把兩個函式現行定義與 CHECK 存檔（撤回 54 要照這份）。
-- 檔案自己 BEGIN ... COMMIT，一次 Run 即可，任何一句出錯整份不生效。撤回：54-b45-attachment-types-rollback.sql。套用前先跑 50-b45-preview-before-apply.sql，備份後經使用者核可才執行。
BEGIN;

DO $$
BEGIN
  IF to_regclass('public.ga_resource_attachments') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite table: ga_resource_attachments'; END IF;
  IF to_regprocedure('public.ga_resource_attachment_can_manage(text,uuid)') IS NULL OR to_regprocedure('public.ga_resource_attachment_can_read(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: ga_resource_attachment_can_manage／can_read（第 1 批附件 migration）';
  END IF;
  IF to_regclass('public.ga_purchase_invoices') IS NULL OR to_regclass('public.ga_payment_request_lines') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: 請先套用 20261119100000 與 20261119110000';
  END IF;
END $$;

-- ================================================================ 1. resource_type CHECK
DO $$
DECLARE
  v_name text;
BEGIN
  FOR v_name IN SELECT c.conname FROM pg_constraint c WHERE c.conrelid = 'public.ga_resource_attachments'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%resource_type = ANY%' LOOP
    EXECUTE format('ALTER TABLE public.ga_resource_attachments DROP CONSTRAINT %I', v_name);
  END LOOP;
  ALTER TABLE public.ga_resource_attachments ADD CONSTRAINT ga_resource_attachments_resource_type_check CHECK (resource_type = ANY (ARRAY[
    'EQUIPMENT', 'FACILITY', 'PART', 'MAINTENANCE_REQUEST', 'MAINTENANCE_UPDATE', 'SERVICE_REQUEST', 'SERVICE_REQUEST_COMMENT', 'UTILITY_BILL', 'PURCHASE_INVOICE', 'PURCHASE_RECEIPT']));
END $$;

-- ================================================================ 2. 管理與讀取判斷函式補分支
DO $$
DECLARE
  v_def text;
  v_new text;
  v_manage_block text := $blk$IF p_resource_type = 'PURCHASE_INVOICE' THEN
    RETURN public.current_user_has_permission('general_affairs.purchase_payment.manage')
      AND EXISTS (SELECT 1 FROM public.ga_purchase_invoices pi WHERE pi.id = p_resource_id AND pi.status = 'ACTIVE');
  END IF;

  IF p_resource_type = 'PURCHASE_RECEIPT' THEN
    RETURN public.current_user_has_permission('general_affairs.purchase_payment.manage')
      AND EXISTS (SELECT 1 FROM public.ga_purchase_receipts pr WHERE pr.id = p_resource_id AND pr.voided_at IS NULL);
  END IF;$blk$;
  v_read_block text := $blk$IF p_resource_type = 'PURCHASE_INVOICE' THEN
    RETURN (public.current_user_has_permission('general_affairs.purchase_payment.view') OR public.current_user_has_permission('general_affairs.purchase_payment.manage'))
      AND EXISTS (SELECT 1 FROM public.ga_purchase_invoices pi WHERE pi.id = p_resource_id);
  END IF;

  IF p_resource_type = 'PURCHASE_RECEIPT' THEN
    RETURN (public.current_user_has_permission('general_affairs.purchase_payment.view') OR public.current_user_has_permission('general_affairs.purchase_payment.manage'))
      AND EXISTS (SELECT 1 FROM public.ga_purchase_receipts pr WHERE pr.id = p_resource_id);
  END IF;$blk$;
BEGIN
  v_def := pg_get_functiondef('public.ga_resource_attachment_can_manage(text,uuid)'::regprocedure);
  IF position('PURCHASE_INVOICE' in v_def) = 0 THEN
    v_new := regexp_replace(v_def, 'RETURN false;(\s*END;\s*\$function\$\s*)$', v_manage_block || E'\n\n  RETURN false;' || '\1');
    IF v_new = v_def OR position('PURCHASE_INVOICE' in v_new) = 0 THEN
      RAISE EXCEPTION 'ga_resource_attachment_can_manage 現行定義的結尾不是預期的 RETURN false; END;，請人工確認後再加 PURCHASE_INVOICE 分支';
    END IF;
    EXECUTE v_new;
  END IF;

  v_def := pg_get_functiondef('public.ga_resource_attachment_can_read(text,uuid)'::regprocedure);
  IF position('PURCHASE_INVOICE' in v_def) = 0 THEN
    v_new := regexp_replace(v_def, 'RETURN false;(\s*END;\s*\$function\$\s*)$', v_read_block || E'\n\n  RETURN false;' || '\1');
    IF v_new = v_def OR position('PURCHASE_INVOICE' in v_new) = 0 THEN
      RAISE EXCEPTION 'ga_resource_attachment_can_read 現行定義的結尾不是預期的 RETURN false; END;，請人工確認後再加 PURCHASE_INVOICE 分支';
    END IF;
    EXECUTE v_new;
  END IF;
END $$;

-- ================================================================ 3. 發票圖片與缺圖判斷、最後一張圖守門
-- 有效（未刪除）的發票圖片張數；p_exclude 可排除某一張（刪除前先算「剩幾張」）。
CREATE OR REPLACE FUNCTION public.ga_pay_invoice_image_count(p_invoice_id uuid, p_exclude uuid DEFAULT NULL) RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$ SELECT count(*)::integer FROM public.ga_resource_attachments a
       WHERE a.resource_type = 'PURCHASE_INVOICE' AND a.resource_id = p_invoice_id AND a.purpose = 'INVOICE_IMAGE' AND a.deleted_at IS NULL AND a.id IS DISTINCT FROM p_exclude; $$;

-- 缺圖（P10）：三聯式、二聯式、電子發票一定要有圖；收據沒有圖時要有「沒有圖的原因」才算齊；免開發票不需要。
CREATE OR REPLACE FUNCTION public.ga_pay_invoice_missing_image(p_type text, p_no_image_reason text, p_images integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$ SELECT (p_type IN ('TRIPLE', 'DUPLEX', 'E_INVOICE') AND COALESCE(p_images, 0) = 0)
          OR (p_type = 'RECEIPT' AND COALESCE(p_images, 0) = 0 AND COALESCE(btrim(p_no_image_reason), '') = ''); $$;

-- 軟刪除守門：已被有效請款單引用的發票，最後一張圖片不可刪除。
CREATE OR REPLACE FUNCTION public.ga_pay_attachment_last_image_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_inv public.ga_purchase_invoices%ROWTYPE;
  v_pr text;
BEGIN
  IF NEW.resource_type <> 'PURCHASE_INVOICE' OR NEW.purpose <> 'INVOICE_IMAGE' THEN RETURN NEW; END IF;
  IF NOT (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN RETURN NEW; END IF;
  SELECT * INTO v_inv FROM public.ga_purchase_invoices WHERE id = NEW.resource_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT string_agg(DISTINCT r.pr_no, '、' ORDER BY r.pr_no) INTO v_pr
    FROM public.ga_payment_request_lines l JOIN public.ga_payment_requests r ON r.id = l.pr_id WHERE l.invoice_id = v_inv.id AND r.status <> 'VOID';
  IF v_pr IS NOT NULL AND public.ga_pay_invoice_missing_image(v_inv.invoice_type, v_inv.no_image_reason, public.ga_pay_invoice_image_count(v_inv.id, NEW.id)) THEN
    RAISE EXCEPTION 'INVOICE_LAST_IMAGE_LOCKED: 這張發票已被請款單 % 使用，最後一張圖片不能刪除；請先上傳新的圖片，或先作廢、退回請款單', v_pr USING ERRCODE = 'GA046';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ga_pay_attachment_last_image_guard ON public.ga_resource_attachments;
CREATE TRIGGER trg_ga_pay_attachment_last_image_guard BEFORE UPDATE ON public.ga_resource_attachments FOR EACH ROW EXECUTE FUNCTION public.ga_pay_attachment_last_image_guard();

NOTIFY pgrst, 'reload schema';

COMMIT;

-- 核對
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.ga_resource_attachments'::regclass AND conname = 'ga_resource_attachments_resource_type_check';
-- 核對：10 個類型，含 PURCHASE_INVOICE、PURCHASE_RECEIPT
SELECT p.proname, position('PURCHASE_INVOICE' in pg_get_functiondef(p.oid)) > 0 AS has_branch FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('ga_resource_attachment_can_manage', 'ga_resource_attachment_can_read') ORDER BY 1;
-- 核對：兩個都是 true
SELECT tgname FROM pg_trigger WHERE tgname = 'trg_ga_pay_attachment_last_image_guard';
-- 核對：應列出 1 個觸發器
