-- 正式區草稿 ga-improve-b1-sql/01-ga-improve-b1-buyer-companies.rollback.sql（G11 多家買受人公司）：SQL 內容與 DEV 實測檔 supabase/workspace-dev/20261125100000_ga_improve_b1_buyer_companies.rollback.sql 完全相同（只差這幾行說明）。
-- 套用前先跑 00-preview-before-apply.sql 確認現況與先決條件；套用後跑 01-ga-improve-b1-buyer-companies.verify.sql，全部 pass 才算成功。不新增權限碼、不授權給任何角色。
-- 既有函式採「讀現行定義＋文字替換」：形狀與預期不符就中止（不整支覆蓋），所以正式區函式與 DEV 有出入時會停下來，不會寫壞。
-- 還原 20261125100000_ga_improve_b1_buyer_companies.sql（G11 多家買受人公司）。
-- 先決：其他 ga_improve_b1 階段（110000、120000、130000）已先撤回。
-- 安全規則：已有採購單或請款單引用買受人公司時中止（請先處理或確認不需要保留）；請款單的抬頭快照欄位隨欄位刪除。
-- 舊設定鍵 pay_buyer_title／pay_buyer_tax_id 保留不動（雙寫期間內容與預設公司一致）。既有函式加掛逐字還原。可重複執行。
DO $$
BEGIN
  IF to_regclass('public.ga_buyer_companies') IS NOT NULL AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='ga_purchase_orders' AND column_name='buyer_company_id') THEN
    IF EXISTS (SELECT 1 FROM public.ga_purchase_orders WHERE buyer_company_id IS NOT NULL AND buyer_company_id IN (SELECT id FROM public.ga_buyer_companies))
       OR EXISTS (SELECT 1 FROM public.ga_payment_requests WHERE buyer_company_id IS NOT NULL) THEN
      RAISE EXCEPTION '不能撤回：還有採購單或請款單引用買受人公司。請先確認這些單據可以失去抬頭選擇（例如測試資料已清除）後再撤回。';
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ga_ib1_nl(p_ref text, p_x text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN position(E'\r\n' IN p_ref) > 0 THEN replace(replace(p_x, E'\r\n', E'\n'), E'\n', E'\r\n') ELSE replace(p_x, E'\r\n', E'\n') END;
$f$;
CREATE OR REPLACE FUNCTION public.ga_ib1_swap(p_text text, p_old text, p_new text, p_label text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
BEGIN
  IF position(p_old IN p_text) = 0 THEN RAISE EXCEPTION '函式形狀與預期不符，找不到要替換的文字（%）：%', p_label, left(p_old, 80); END IF;
  IF position(p_old IN substr(p_text, position(p_old IN p_text) + 1)) > 0 THEN RAISE EXCEPTION '函式形狀與預期不符，要替換的文字出現不只一次（%）：%', p_label, left(p_old, 80); END IF;
  RETURN replace(p_text, p_old, p_new);
END;
$f$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_pay_settings_get()') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_ws_pay_settings_get()'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    /* GAIB1-S2 */ 'buyer_title', COALESCE((SELECT c.name FROM public.ga_buyer_companies c WHERE c.is_default AND c.is_active), (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_title')),
    'buyer_tax_id', COALESCE((SELECT c.tax_id FROM public.ga_buyer_companies c WHERE c.is_default AND c.is_active), (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_tax_id')),$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$    /* GAIB1-S2 */ 'buyer_title', COALESCE((SELECT c.name FROM public.ga_buyer_companies c WHERE c.is_default AND c.is_active), (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_title')),
    'buyer_tax_id', COALESCE((SELECT c.tax_id FROM public.ga_buyer_companies c WHERE c.is_default AND c.is_active), (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_tax_id')),$ib1n$), public.ga_ib1_nl(v_def, $ib1o$    'buyer_title', (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_title'),
    'buyer_tax_id', (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_tax_id'),$ib1o$)); END IF;
  IF position('GAIB1-S2' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_pay_settings_get() 還有無法自動移除的 GAIB1-S2 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_pay_settings_set(jsonb,timestamp with time zone)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_ws_pay_settings_set(jsonb,timestamp with time zone)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  -- GAIB1-S2
  IF v_vals ? 'buyer_title' OR v_vals ? 'buyer_tax_id' THEN PERFORM public.ga_ib1_buyer_from_settings(v_uid); END IF;
  RETURN public.ga_ws_pay_settings_get();$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$  -- GAIB1-S2
  IF v_vals ? 'buyer_title' OR v_vals ? 'buyer_tax_id' THEN PERFORM public.ga_ib1_buyer_from_settings(v_uid); END IF;
  RETURN public.ga_ws_pay_settings_get();$ib1n$), public.ga_ib1_nl(v_def, $ib1o$  RETURN public.ga_ws_pay_settings_get();$ib1o$)); END IF;
  IF position('GAIB1-S2' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_pay_settings_set(jsonb,timestamp with time zone) 還有無法自動移除的 GAIB1-S2 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_pay_request_get(uuid)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_ws_pay_request_get(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    /* GAIB1-S2 */ 'buyer', public.ga_ib1_pay_buyer(p_id));$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$    /* GAIB1-S2 */ 'buyer', public.ga_ib1_pay_buyer(p_id));$ib1n$), public.ga_ib1_nl(v_def, $ib1o$    'buyer', jsonb_build_object('title', (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_title'), 'tax_id', (SELECT value_text FROM public.ga_workflow_settings WHERE key = 'pay_buyer_tax_id')));$ib1o$)); END IF;
  IF position('GAIB1-S2' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_pay_request_get(uuid) 還有無法自動移除的 GAIB1-S2 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_pay_invoice_save(uuid,jsonb,text,timestamp with time zone)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_ws_pay_invoice_save(uuid,jsonb,text,timestamp with time zone)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$AND v_buyer <> v_buyer_cfg AND NOT EXISTS (SELECT 1 FROM public.ga_buyer_companies bc WHERE bc.is_active AND bc.tax_id = v_buyer) /* GAIB1-S2 */ THEN v_mismatch := true; END IF;$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$AND v_buyer <> v_buyer_cfg AND NOT EXISTS (SELECT 1 FROM public.ga_buyer_companies bc WHERE bc.is_active AND bc.tax_id = v_buyer) /* GAIB1-S2 */ THEN v_mismatch := true; END IF;$ib1n$), public.ga_ib1_nl(v_def, $ib1o$AND v_buyer <> v_buyer_cfg THEN v_mismatch := true; END IF;$ib1o$)); END IF;
  IF position('GAIB1-S2' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_pay_invoice_save(uuid,jsonb,text,timestamp with time zone) 還有無法自動移除的 GAIB1-S2 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_po_header_apply(uuid,jsonb)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_po_header_apply(uuid,jsonb)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$    UPDATE public.ga_purchase_orders SET purchase_review_id = v_txt::uuid WHERE id = p_po_id AND purchase_review_id IS DISTINCT FROM v_txt::uuid;
  END IF;
  -- GAIB1-S2
  PERFORM public.ga_ib1_po_header_ext(p_po_id, p_header);$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$    UPDATE public.ga_purchase_orders SET purchase_review_id = v_txt::uuid WHERE id = p_po_id AND purchase_review_id IS DISTINCT FROM v_txt::uuid;
  END IF;
  -- GAIB1-S2
  PERFORM public.ga_ib1_po_header_ext(p_po_id, p_header);$ib1n$), public.ga_ib1_nl(v_def, $ib1o$    UPDATE public.ga_purchase_orders SET purchase_review_id = v_txt::uuid WHERE id = p_po_id AND purchase_review_id IS DISTINCT FROM v_txt::uuid;
  END IF;$ib1o$)); END IF;
  IF position('GAIB1-S2' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_po_header_apply(uuid,jsonb) 還有無法自動移除的 GAIB1-S2 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_po_data(uuid)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_po_data(uuid)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  RETURN v_obj || public.ga_ib1_po_data_ext(p_id) /* GAIB1-S2 */ || jsonb_build_object('items', v_items, 'events', v_events);$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$  RETURN v_obj || public.ga_ib1_po_data_ext(p_id) /* GAIB1-S2 */ || jsonb_build_object('items', v_items, 'events', v_events);$ib1n$), public.ga_ib1_nl(v_def, $ib1o$  RETURN v_obj || jsonb_build_object('items', v_items, 'events', v_events);$ib1o$)); END IF;
  IF position('GAIB1-S2' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_po_data(uuid) 還有無法自動移除的 GAIB1-S2 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_pay_request_create(jsonb,text)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_ws_pay_request_create(jsonb,text)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_pay_apply_lines(q.id, v_vendor, p -> 'lines');
  PERFORM public.ga_ib1_pay_set_buyer(q.id, p); -- GAIB1-S2
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = q.id;$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_pay_apply_lines(q.id, v_vendor, p -> 'lines');
  PERFORM public.ga_ib1_pay_set_buyer(q.id, p); -- GAIB1-S2
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = q.id;$ib1n$), public.ga_ib1_nl(v_def, $ib1o$  PERFORM public.ga_pay_apply_lines(q.id, v_vendor, p -> 'lines');
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = q.id;$ib1o$)); END IF;
  IF position('GAIB1-S2' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_pay_request_create(jsonb,text) 還有無法自動移除的 GAIB1-S2 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_pay_request_update(uuid,jsonb,timestamp with time zone)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_ws_pay_request_update(uuid,jsonb,timestamp with time zone)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_ib1_pay_set_buyer(q.id, p); -- GAIB1-S2
  UPDATE public.ga_payment_requests SET expected_pay_date = v_pay, notes = v_notes, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_ib1_pay_set_buyer(q.id, p); -- GAIB1-S2
  UPDATE public.ga_payment_requests SET expected_pay_date = v_pay, notes = v_notes, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;$ib1n$), public.ga_ib1_nl(v_def, $ib1o$  UPDATE public.ga_payment_requests SET expected_pay_date = v_pay, notes = v_notes, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;$ib1o$)); END IF;
  IF position('GAIB1-S2' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_pay_request_update(uuid,jsonb,timestamp with time zone) 還有無法自動移除的 GAIB1-S2 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_pay_ub_create(jsonb,text)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_ws_pay_ub_create(jsonb,text)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_pay_ub_apply_bills(q.id, v_vendor, v_month, v_ids);
  PERFORM public.ga_ib1_pay_set_buyer(q.id, p); -- GAIB1-S2
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = q.id;$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_pay_ub_apply_bills(q.id, v_vendor, v_month, v_ids);
  PERFORM public.ga_ib1_pay_set_buyer(q.id, p); -- GAIB1-S2
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = q.id;$ib1n$), public.ga_ib1_nl(v_def, $ib1o$  PERFORM public.ga_pay_ub_apply_bills(q.id, v_vendor, v_month, v_ids);
  SELECT * INTO q FROM public.ga_payment_requests WHERE id = q.id;$ib1o$)); END IF;
  IF position('GAIB1-S2' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_pay_ub_create(jsonb,text) 還有無法自動移除的 GAIB1-S2 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DO $ib1$
DECLARE
  v_def text;
  v_new text;
BEGIN
  IF to_regprocedure('public.ga_ws_pay_ub_update(uuid,jsonb,timestamp with time zone)') IS NULL THEN RETURN; END IF;
  v_def := pg_get_functiondef('public.ga_ws_pay_ub_update(uuid,jsonb,timestamp with time zone)'::regprocedure);
  v_new := v_def;
  IF position(public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_ib1_pay_set_buyer(q.id, p); -- GAIB1-S2
  UPDATE public.ga_payment_requests SET expected_pay_date = v_pay, notes = v_notes, auto_mark_paid = v_auto, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;$ib1n$) IN v_new) > 0 THEN v_new := replace(v_new, public.ga_ib1_nl(v_def, $ib1n$  PERFORM public.ga_ib1_pay_set_buyer(q.id, p); -- GAIB1-S2
  UPDATE public.ga_payment_requests SET expected_pay_date = v_pay, notes = v_notes, auto_mark_paid = v_auto, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;$ib1n$), public.ga_ib1_nl(v_def, $ib1o$  UPDATE public.ga_payment_requests SET expected_pay_date = v_pay, notes = v_notes, auto_mark_paid = v_auto, updated_by = v_uid, updated_at = clock_timestamp() WHERE id = q.id RETURNING * INTO q;$ib1o$)); END IF;
  IF position('GAIB1-S2' IN v_new) > 0 THEN RAISE EXCEPTION 'public.ga_ws_pay_ub_update(uuid,jsonb,timestamp with time zone) 還有無法自動移除的 GAIB1-S2 標記，請人工處理'; END IF;
  IF v_new IS DISTINCT FROM v_def THEN EXECUTE v_new; END IF;
END $ib1$;

DROP FUNCTION IF EXISTS public.ga_ib1_swap(text, text, text, text);
DROP FUNCTION IF EXISTS public.ga_ib1_nl(text, text);

DROP TRIGGER IF EXISTS trg_ga_ib1_pay_buyer_freeze ON public.ga_payment_requests;
DROP TRIGGER IF EXISTS trg_ga_ib1_po_buyer_default ON public.ga_purchase_orders;
DROP FUNCTION IF EXISTS public.ga_ib1_pay_buyer_freeze();
DROP FUNCTION IF EXISTS public.ga_ib1_po_buyer_default();
DROP FUNCTION IF EXISTS public.ga_ws_buyer_company_deactivate(uuid);
DROP FUNCTION IF EXISTS public.ga_ws_buyer_company_set_default(uuid);
DROP FUNCTION IF EXISTS public.ga_ws_buyer_company_save(jsonb, text, timestamptz);
DROP FUNCTION IF EXISTS public.ga_ws_buyer_company_list();
DROP FUNCTION IF EXISTS public.ga_ib1_buyer_rows();
DROP FUNCTION IF EXISTS public.ga_ib1_po_data_ext(uuid);
DROP FUNCTION IF EXISTS public.ga_ib1_po_header_ext(uuid, jsonb);
DROP FUNCTION IF EXISTS public.ga_ib1_pay_set_buyer(uuid, jsonb);
DROP FUNCTION IF EXISTS public.ga_ib1_pay_buyer(uuid);
DROP FUNCTION IF EXISTS public.ga_ib1_buyer_from_settings(uuid);
DROP FUNCTION IF EXISTS public.ga_ib1_buyer_sync_settings(uuid);
DROP FUNCTION IF EXISTS public.ga_ib1_buyer_default_id();

ALTER TABLE public.ga_payment_requests DROP COLUMN IF EXISTS buyer_tax_id_snapshot;
ALTER TABLE public.ga_payment_requests DROP COLUMN IF EXISTS buyer_title_snapshot;
ALTER TABLE public.ga_payment_requests DROP COLUMN IF EXISTS buyer_company_id;
ALTER TABLE public.ga_purchase_orders DROP COLUMN IF EXISTS buyer_company_id;
DROP TRIGGER IF EXISTS trg_ga_buyer_company_events_immutable ON public.ga_buyer_company_events;
DROP TABLE IF EXISTS public.ga_buyer_company_events;
DROP TABLE IF EXISTS public.ga_buyer_companies;
-- ga_ib1_events_immutable 供後續階段共用，最後一個階段撤回時一併移除
DROP FUNCTION IF EXISTS public.ga_ib1_events_immutable();
NOTIFY pgrst, 'reload schema';
