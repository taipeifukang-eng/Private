-- 水電話費請款（G46）階段 5：DEV 專用測試角色與測試資料清除函式（不套正式區，沒有對應的正式區草稿）。
-- 角色代碼一律 vue_workspace_gaup_ 開頭（開工前與套用前都查過 roles 表與 role-matrix spec，沒有撞名；既有 vue_workspace_ga_*、ga6_*、ga45_* 不動、不修改、不刪除）：
--   _clerk       總務：水電帳單管理＋檢視、請款管理＋檢視、廠商檢視、採購評估檢視（建立、送出、補填、補附件）
--   _accountant  會計：請款管理＋檢視、水電帳單檢視、廠商檢視、採購評估檢視（沒有水電管理：驗證退回、作廢、標已付款不需水電管理；不能建立、送出水電單）
--   _billonly    水電帳單管理＋檢視（沒有請款權限：驗證不能建立請款單、看得到「已在請款單內」但看不到單號）
--   _payview     只有請款檢視（沒有水電、沒有廠商權限：驗證明細遮蔽與唯讀）
-- 每個角色另帶總務服務中心入口（service_center.access）。權限碼不存在的略過。可重複執行。
-- 另外建立 ga_dev_cleanup_ga_utility_payment()：清除水電請款測試資料（請款單與事件、水電明細、帳單與附件紀錄、測試廠商）。
--   只處理「廠商名稱帶 QA-GAUP- 標記」「帳單供應商名稱帶 QA-GAUP- 標記」的資料；請款單事件表有不可改刪觸發器，
--   函式在單一交易內只對事件表、水電明細表、帳單表暫停觸發器、立刻恢復（任何錯誤整個交易回復，觸發器不會停留在停用狀態）。只有 service_role 能呼叫。
-- 還原：20261124140000_ga_utility_payment_dev_seed.rollback.sql（只刪這四個角色與其成員紀錄，不動既有角色）。

DO $$
DECLARE
  v_def jsonb;
  v_code text;
  v_role_id uuid;
  v_perms text[];
BEGIN
  IF to_regclass('public.roles') IS NULL OR to_regclass('public.permissions') IS NULL THEN RAISE EXCEPTION 'Missing prerequisite table: roles／permissions'; END IF;
  v_def := jsonb_build_object(
    'vue_workspace_gaup_clerk', jsonb_build_object('name', '測試 水電請款 總務', 'perms', jsonb_build_array('general_affairs.service_center.access', 'general_affairs.utility_bill.manage', 'general_affairs.utility_bill.view',
      'general_affairs.purchase_payment.manage', 'general_affairs.purchase_payment.view', 'general_affairs.vendor.view', 'general_affairs.purchase_review.view')),
    'vue_workspace_gaup_accountant', jsonb_build_object('name', '測試 水電請款 會計', 'perms', jsonb_build_array('general_affairs.service_center.access', 'general_affairs.purchase_payment.manage', 'general_affairs.purchase_payment.view',
      'general_affairs.utility_bill.view', 'general_affairs.vendor.view', 'general_affairs.purchase_review.view')),
    'vue_workspace_gaup_billonly', jsonb_build_object('name', '測試 水電請款 只有水電管理', 'perms', jsonb_build_array('general_affairs.service_center.access', 'general_affairs.utility_bill.manage', 'general_affairs.utility_bill.view')),
    'vue_workspace_gaup_payview', jsonb_build_object('name', '測試 水電請款 只有請款檢視', 'perms', jsonb_build_array('general_affairs.service_center.access', 'general_affairs.purchase_payment.view')));
  FOR v_code IN SELECT jsonb_object_keys(v_def) LOOP
    IF v_code NOT LIKE 'vue\_workspace\_gaup\_%' THEN RAISE EXCEPTION '角色代碼必須以 vue_workspace_gaup_ 開頭'; END IF;
    INSERT INTO public.roles (code, name, description, is_active, is_system)
    VALUES (v_code, v_def -> v_code ->> 'name', 'G46 水電話費請款 DEV 測試角色（正式區不建）', true, false)
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = true
    RETURNING id INTO v_role_id;
    DELETE FROM public.role_permissions WHERE role_id = v_role_id;
    SELECT array_agg(DISTINCT x) INTO v_perms FROM jsonb_array_elements_text(v_def -> v_code -> 'perms') x;
    INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
    SELECT v_role_id, p.id, true FROM public.permissions p WHERE p.code = ANY (v_perms);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.ga_dev_cleanup_ga_utility_payment(p_marker text DEFAULT 'QA-GAUP-%')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_vendors uuid[];
  v_bills uuid[];
  v_prs uuid[];
  v_n_pr integer := 0;
  v_n_ev integer := 0;
  v_n_att integer := 0;
  v_n_bill integer := 0;
  v_n_vendor integer := 0;
  v_paths jsonb := '[]'::jsonb;
  v_att uuid[];
BEGIN
  IF p_marker IS NULL OR left(p_marker, 8) <> 'QA-GAUP-' THEN RAISE EXCEPTION '只能清除帶 QA-GAUP- 標記的測試資料'; END IF;
  IF to_regclass('public.ga_payment_request_bill_lines') IS NULL THEN RETURN jsonb_build_object('payment_requests', 0); END IF;
  SELECT COALESCE(array_agg(id), '{}') INTO v_vendors FROM public.ga_vendors WHERE name LIKE p_marker;
  SELECT COALESCE(array_agg(id), '{}') INTO v_bills FROM public.ga_utility_bills WHERE provider_name LIKE p_marker OR payee_vendor_id = ANY (v_vendors);
  SELECT COALESCE(array_agg(DISTINCT r.id), '{}') INTO v_prs FROM public.ga_payment_requests r
   WHERE r.source = 'UTILITY' AND (r.vendor_id = ANY (v_vendors) OR EXISTS (SELECT 1 FROM public.ga_payment_request_bill_lines l WHERE l.pr_id = r.id AND l.bill_id = ANY (v_bills)));

  ALTER TABLE public.ga_payment_request_events DISABLE TRIGGER trg_ga_payment_request_events_immutable;
  ALTER TABLE public.ga_payment_request_bill_lines DISABLE TRIGGER trg_ga_pay_ub_lines_guard;
  ALTER TABLE public.ga_utility_bills DISABLE TRIGGER trg_ga_utility_bills_before_write;
  DELETE FROM public.ga_payment_request_events WHERE pr_id = ANY (v_prs);
  GET DIAGNOSTICS v_n_ev = ROW_COUNT;
  DELETE FROM public.ga_payment_request_bill_lines WHERE pr_id = ANY (v_prs) OR bill_id = ANY (v_bills);
  UPDATE public.ga_utility_bills SET paid_by_pr_id = NULL WHERE paid_by_pr_id = ANY (v_prs);
  DELETE FROM public.ga_payment_requests WHERE id = ANY (v_prs);
  GET DIAGNOSTICS v_n_pr = ROW_COUNT;
  SELECT COALESCE(array_agg(a.id), '{}'), COALESCE(jsonb_agg(a.storage_path), '[]'::jsonb) INTO v_att, v_paths FROM public.ga_resource_attachments a
   WHERE a.resource_type = 'UTILITY_BILL' AND a.resource_id = ANY (v_bills);
  DELETE FROM public.ga_resource_attachments WHERE id = ANY (v_att);
  GET DIAGNOSTICS v_n_att = ROW_COUNT;
  DELETE FROM public.ga_utility_bills WHERE id = ANY (v_bills);
  GET DIAGNOSTICS v_n_bill = ROW_COUNT;
  ALTER TABLE public.ga_utility_bills ENABLE TRIGGER trg_ga_utility_bills_before_write;
  ALTER TABLE public.ga_payment_request_bill_lines ENABLE TRIGGER trg_ga_pay_ub_lines_guard;
  ALTER TABLE public.ga_payment_request_events ENABLE TRIGGER trg_ga_payment_request_events_immutable;

  -- 沒有採購單與其他請款單參照的測試廠商
  DELETE FROM public.ga_vendors v WHERE v.name LIKE p_marker AND NOT EXISTS (SELECT 1 FROM public.ga_purchase_orders o WHERE o.vendor_id = v.id)
    AND NOT EXISTS (SELECT 1 FROM public.ga_payment_requests r WHERE r.vendor_id = v.id);
  GET DIAGNOSTICS v_n_vendor = ROW_COUNT;
  RETURN jsonb_build_object('payment_requests', v_n_pr, 'events', v_n_ev, 'bills', v_n_bill, 'attachments', v_n_att, 'vendors', v_n_vendor, 'storage_paths', v_paths);
END;
$$;

REVOKE ALL ON FUNCTION public.ga_dev_cleanup_ga_utility_payment(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ga_dev_cleanup_ga_utility_payment(text) TO service_role;
NOTIFY pgrst, 'reload schema';
