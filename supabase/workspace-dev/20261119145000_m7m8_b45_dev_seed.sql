-- M7/M8 第 4.5 批 F（G45）：DEV 專用測試角色與測試資料清除函式（不套正式區，沒有對應的正式區草稿）。
-- 角色代碼一律 vue_workspace_ga45_ 開頭（開工前與套用前都查過 roles 表與 role-matrix spec，沒有撞名；既有 vue_workspace_ga_* 與 vue_workspace_ga6_* 不動、不修改、不刪除）：
--   _clerk       總務採購：既有 vue_workspace_ga_purchaser 的全部權限碼 ＋ purchase_payment.manage ＋ vendor.view ＋ inventory_transaction.manage ＋ part.view（作廢進貨用）
--   _accountant  會計：purchase_payment.manage＋view、purchase_review.view、vendor.view（權限與總務請款權限相同，P4）
--   _viewer      只有 purchase_payment.view＋purchase_review.view（沒有 vendor.view：驗證遮蔽與唯讀）
--   _novendor    purchase_payment.manage＋purchase_review.view（沒有 vendor.view：能建請款單但看不到銀行與統編）
-- 每個角色另帶總務服務中心入口（service_center.access）。權限碼不存在的略過。可重複執行。
-- 另外建立 ga_dev_cleanup_m7m8_b45()：清除第 4.5 批測試資料（請款單與事件、發票與連結、發票／進貨單附件紀錄、測試帳號留下的設定變更）。
--   只處理「廠商名稱帶 QA-GA45- 標記」「採購單備註帶 [自動測試]M7M8 T 標記」或「建立者是 m7m8-test-* 測試帳號」的資料；請款單事件表有不可改刪觸發器，
--   函式在單一交易內只對該表暫停觸發器、立刻恢復（任何錯誤整個交易回復，觸發器不會停留在停用狀態）。只有 service_role 能呼叫；authenticated／anon 都不能。
-- 還原：20261119145000_m7m8_b45_dev_seed.rollback.sql（只刪這四個角色與其成員紀錄，不動既有角色）。

DO $$
DECLARE
  v_base text[];
  v_def jsonb;
  v_code text;
  v_role_id uuid;
  v_perms text[];
BEGIN
  IF to_regclass('public.roles') IS NULL OR to_regclass('public.permissions') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite table: roles／permissions'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.permissions WHERE code IN ('general_affairs.purchase_payment.view', 'general_affairs.purchase_payment.manage') HAVING count(*) = 2) THEN
    RAISE EXCEPTION 'Missing prerequisite permissions: 請先套用 20261119140000_m7m8_b45_permissions';
  END IF;
  SELECT COALESCE(array_agg(p.code), ARRAY[]::text[]) INTO v_base FROM public.role_permissions rp JOIN public.permissions p ON p.id = rp.permission_id
   WHERE rp.is_allowed AND rp.role_id = (SELECT id FROM public.roles WHERE code = 'vue_workspace_ga_purchaser');
  IF array_length(v_base, 1) IS NULL THEN
    v_base := ARRAY['general_affairs.purchase_review.manage', 'general_affairs.purchase_review.view', 'general_affairs.inventory_transaction.manage', 'general_affairs.part.view', 'general_affairs.vendor.view'];
  END IF;
  v_def := jsonb_build_object(
    'vue_workspace_ga45_clerk', jsonb_build_object('name', '測試 第4.5批 總務採購', 'perms', to_jsonb(v_base || ARRAY['general_affairs.service_center.access', 'general_affairs.purchase_payment.manage', 'general_affairs.vendor.view',
      'general_affairs.inventory_transaction.manage', 'general_affairs.part.view'])),
    'vue_workspace_ga45_accountant', jsonb_build_object('name', '測試 第4.5批 會計', 'perms', jsonb_build_array('general_affairs.service_center.access', 'general_affairs.purchase_payment.manage', 'general_affairs.purchase_payment.view',
      'general_affairs.purchase_review.view', 'general_affairs.vendor.view')),
    'vue_workspace_ga45_viewer', jsonb_build_object('name', '測試 第4.5批 請款檢視', 'perms', jsonb_build_array('general_affairs.service_center.access', 'general_affairs.purchase_payment.view', 'general_affairs.purchase_review.view')),
    'vue_workspace_ga45_novendor', jsonb_build_object('name', '測試 第4.5批 請款無廠商權限', 'perms', jsonb_build_array('general_affairs.service_center.access', 'general_affairs.purchase_payment.manage', 'general_affairs.purchase_review.view')));
  FOR v_code IN SELECT jsonb_object_keys(v_def) LOOP
    IF v_code NOT LIKE 'vue\_workspace\_ga45\_%' THEN RAISE EXCEPTION '角色代碼必須以 vue_workspace_ga45_ 開頭'; END IF;
    INSERT INTO public.roles (code, name, description, is_active, is_system)
    VALUES (v_code, v_def -> v_code ->> 'name', 'M7M8 第 4.5 批 DEV 測試角色（正式區不建）', true, false)
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = true
    RETURNING id INTO v_role_id;
    DELETE FROM public.role_permissions WHERE role_id = v_role_id;
    SELECT array_agg(DISTINCT x) INTO v_perms FROM jsonb_array_elements_text(v_def -> v_code -> 'perms') x;
    INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
    SELECT v_role_id, p.id, true FROM public.permissions p WHERE p.code = ANY (v_perms);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- 測試資料清除函式
CREATE OR REPLACE FUNCTION public.ga_dev_cleanup_m7m8_b45(p_vendor_marker text DEFAULT 'QA-GA45-%')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_marker text := '[自動測試]M7M8 T%';
  v_vendors uuid[];
  v_tests uuid[];
  v_po uuid[];
  v_rc uuid[];
  v_prs uuid[];
  v_inv uuid[];
  v_n_pr integer := 0;
  v_n_ev integer := 0;
  v_n_inv integer := 0;
  v_n_att integer := 0;
  v_n_vendor integer := 0;
  v_paths jsonb := '[]'::jsonb;
  v_att uuid[];
BEGIN
  IF p_vendor_marker IS NULL OR left(p_vendor_marker, 8) <> 'QA-GA45-' THEN RAISE EXCEPTION '只能清除廠商名稱帶 QA-GA45- 標記的測試資料'; END IF;
  IF to_regclass('public.ga_payment_requests') IS NULL THEN RETURN jsonb_build_object('payment_requests', 0); END IF;
  SELECT COALESCE(array_agg(id), '{}') INTO v_vendors FROM public.ga_vendors WHERE name LIKE p_vendor_marker;
  SELECT COALESCE(array_agg(id), '{}') INTO v_tests FROM public.profiles WHERE email LIKE 'm7m8-test-%@example.test';
  SELECT COALESCE(array_agg(o.id), '{}') INTO v_po FROM public.ga_purchase_orders o
   WHERE o.vendor_id = ANY (v_vendors) OR o.notes LIKE v_marker OR o.vendor_name_snapshot LIKE v_marker OR o.vendor_name_snapshot LIKE p_vendor_marker;
  SELECT COALESCE(array_agg(r.id), '{}') INTO v_rc FROM public.ga_purchase_receipts r WHERE r.po_id = ANY (v_po);
  SELECT COALESCE(array_agg(DISTINCT r.id), '{}') INTO v_prs FROM public.ga_payment_requests r
   WHERE r.vendor_id = ANY (v_vendors) OR EXISTS (SELECT 1 FROM public.ga_payment_request_lines l WHERE l.pr_id = r.id AND (l.po_id = ANY (v_po) OR l.receipt_id = ANY (v_rc)));
  SELECT COALESCE(array_agg(DISTINCT i.id), '{}') INTO v_inv FROM public.ga_purchase_invoices i
   WHERE i.vendor_id = ANY (v_vendors) OR EXISTS (SELECT 1 FROM public.ga_purchase_invoice_receipts ir WHERE ir.invoice_id = i.id AND ir.receipt_id = ANY (v_rc));

  IF COALESCE(array_length(v_prs, 1), 0) > 0 THEN
    ALTER TABLE public.ga_payment_request_events DISABLE TRIGGER trg_ga_payment_request_events_immutable;
    DELETE FROM public.ga_payment_request_events WHERE pr_id = ANY (v_prs);
    GET DIAGNOSTICS v_n_ev = ROW_COUNT;
    DELETE FROM public.ga_payment_request_lines WHERE pr_id = ANY (v_prs);
    DELETE FROM public.ga_payment_requests WHERE id = ANY (v_prs);
    GET DIAGNOSTICS v_n_pr = ROW_COUNT;
    ALTER TABLE public.ga_payment_request_events ENABLE TRIGGER trg_ga_payment_request_events_immutable;
  END IF;

  -- 附件紀錄（發票圖片、進貨單照片）：回傳儲存路徑，讓呼叫端把實體檔也清掉。
  SELECT COALESCE(array_agg(a.id), '{}'), COALESCE(jsonb_agg(a.storage_path), '[]'::jsonb) INTO v_att, v_paths FROM public.ga_resource_attachments a
   WHERE (a.resource_type = 'PURCHASE_INVOICE' AND a.resource_id = ANY (v_inv)) OR (a.resource_type = 'PURCHASE_RECEIPT' AND a.resource_id = ANY (v_rc));
  DELETE FROM public.ga_resource_attachments WHERE id = ANY (v_att);
  GET DIAGNOSTICS v_n_att = ROW_COUNT;
  DELETE FROM public.ga_purchase_invoice_receipts WHERE invoice_id = ANY (v_inv) OR receipt_id = ANY (v_rc);
  DELETE FROM public.ga_purchase_invoices WHERE id = ANY (v_inv);
  GET DIAGNOSTICS v_n_inv = ROW_COUNT;

  -- 測試帳號動過的設定（尾差、買受人）：還原預設與清除變更紀錄。
  DELETE FROM public.ga_workflow_settings WHERE key IN ('pay_buyer_title', 'pay_buyer_tax_id') AND updated_by = ANY (v_tests);
  UPDATE public.ga_workflow_settings SET value_num = 5, updated_by = NULL WHERE key = 'pay_tolerance_amount' AND updated_by = ANY (v_tests);
  DELETE FROM public.ga_workflow_setting_events WHERE setting_key LIKE 'pay\_%' AND actor_id = ANY (v_tests);

  -- 沒有採購單參照的測試廠商（採購單由第 4 批清除函式處理，所以測試收尾會再呼叫一次）。
  DELETE FROM public.ga_vendors v WHERE v.name LIKE p_vendor_marker AND NOT EXISTS (SELECT 1 FROM public.ga_purchase_orders o WHERE o.vendor_id = v.id);
  GET DIAGNOSTICS v_n_vendor = ROW_COUNT;
  RETURN jsonb_build_object('payment_requests', v_n_pr, 'events', v_n_ev, 'invoices', v_n_inv, 'attachments', v_n_att, 'vendors', v_n_vendor, 'storage_paths', v_paths);
END;
$$;

REVOKE ALL ON FUNCTION public.ga_dev_cleanup_m7m8_b45(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ga_dev_cleanup_m7m8_b45(text) TO service_role;
NOTIFY pgrst, 'reload schema';
