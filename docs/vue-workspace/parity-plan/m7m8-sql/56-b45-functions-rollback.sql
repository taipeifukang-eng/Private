-- 56-b45-functions-rollback.sql
-- 撤回 56：移除 ga_ws_pay_* 與 ga_pay_* 函式，並把 ga_vd_json、ga_ws_vendor_save 的銀行欄位擴充拿掉。不刪任何資料表資料。要先撤回 57、58（它們參照這些函式）。
-- 撤回前備份：先存 ga_vd_json 與 ga_ws_vendor_save 的現行定義（pg_get_functiondef）；函式本身可由 56 重新套用還原。
BEGIN;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND (p.proname LIKE 'ga\_ws\_pay\_%' OR p.proname IN (
              'ga_pay_can_view', 'ga_pay_can_manage', 'ga_pay_can_vendor', 'ga_pay_tol', 'ga_pay_money', 'ga_pay_txt', 'ga_pay_int', 'ga_pay_date', 'ga_pay_uuid', 'ga_pay_norm_tax', 'ga_pay_lock_po',
              'ga_pay_receipt_untaxed', 'ga_pay_receipt_rate', 'ga_pay_receipt_total', 'ga_pay_po_received', 'ga_pay_po_claimed', 'ga_pay_event', 'ga_pay_invoice_json', 'ga_pay_request_json',
              'ga_pay_sync_voucher', 'ga_pay_apply_lines', 'ga_pay_check_live', 'ga_pay_vendor_snapshot')) LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s', r.sig);
  END LOOP;
END $$;

DO $$
DECLARE
  v_def text;
  v_new text;
BEGIN
  v_def := pg_get_functiondef('public.ga_vd_json(public.ga_vendors,boolean)'::regprocedure);
  IF position('bank_name' in v_def) > 0 THEN
    v_new := replace(v_def, $q$, 'bank_name', v.bank_name, 'bank_branch', v.bank_branch, 'bank_account', v.bank_account, 'bank_account_name', v.bank_account_name,$q$, ',');
    IF v_new = v_def OR position('bank_name' in v_new) > 0 THEN RAISE EXCEPTION 'ga_vd_json 的銀行欄位無法自動拿掉，請人工處理'; END IF;
    EXECUTE v_new;
  END IF;

  v_def := pg_get_functiondef('public.ga_ws_vendor_save(uuid,jsonb,timestamptz)'::regprocedure);
  IF position('bank_name' in v_def) > 0 THEN
    v_new := replace(v_def, $q$
  IF p_payload ? 'bank_name' THEN v.bank_name := public.ga_vd_txt(p_payload, 'bank_name', 60, '銀行名稱'); END IF;
  IF p_payload ? 'bank_branch' THEN v.bank_branch := public.ga_vd_txt(p_payload, 'bank_branch', 60, '分行'); END IF;
  IF p_payload ? 'bank_account' THEN v.bank_account := public.ga_vd_txt(p_payload, 'bank_account', 40, '銀行帳號'); END IF;
  IF p_payload ? 'bank_account_name' THEN v.bank_account_name := public.ga_vd_txt(p_payload, 'bank_account_name', 100, '戶名'); END IF;$q$, '');
    v_new := replace(v_new, 'cooperation_notes, attachment_names, bank_name, bank_branch, bank_account, bank_account_name, updated_by)', 'cooperation_notes, attachment_names, updated_by)');
    v_new := replace(v_new, 'v.cooperation_notes, v.attachment_names, v.bank_name, v.bank_branch, v.bank_account, v.bank_account_name, v_uid)', 'v.cooperation_notes, v.attachment_names, v_uid)');
    v_new := replace(v_new, $q$
      bank_name = v.bank_name, bank_branch = v.bank_branch, bank_account = v.bank_account, bank_account_name = v.bank_account_name,$q$, '');
    IF position('bank_name' in v_new) > 0 THEN RAISE EXCEPTION 'ga_ws_vendor_save 的銀行欄位無法自動拿掉，請人工處理'; END IF;
    EXECUTE v_new;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';

COMMIT;
