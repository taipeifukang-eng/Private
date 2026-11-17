-- M7/M8 第 6 批：DEV 專用測試角色（不套正式區，沒有對應的正式區草稿）。代碼一律 vue_workspace_ga6_ 開頭（開工前實測 roles 表與 role-matrix 都沒有此前綴，不會撞名；既有 vue_workspace_ga_* 不動）。
--   _vendor_mgr：廠商檢視與管理；_cat_only：只有服務分類與服務區域檢視；_coop_only：只有合作紀錄檢視；
--   _util_mgr：水電網費檢視與管理；_util_view：只有水電網費檢視；
--   _ga_all：總務全套（廠商、分類區域管理、合作紀錄、採購評估與採購（不含採購核准：G25 測試要求只有核准人角色持有）、工單管理、水電網費、需求單、調撥、設備與設施管理）。
-- 每個角色另帶總務服務中心入口（service_center.access）。權限碼不存在的略過。可重複執行；還原：20261118130000_m7m8_b6_dev_seed.rollback.sql。
DO $$
DECLARE
  v_def jsonb := jsonb_build_object(
    'vue_workspace_ga6_vendor_mgr', jsonb_build_object('name', '測試 第6批 廠商管理', 'perms', jsonb_build_array(
      'general_affairs.service_center.access', 'general_affairs.vendor.view', 'general_affairs.vendor.manage')),
    'vue_workspace_ga6_cat_only', jsonb_build_object('name', '測試 第6批 只有分類區域', 'perms', jsonb_build_array(
      'general_affairs.service_center.access', 'general_affairs.service_category.view', 'general_affairs.service_region.view')),
    'vue_workspace_ga6_coop_only', jsonb_build_object('name', '測試 第6批 只有合作紀錄', 'perms', jsonb_build_array(
      'general_affairs.service_center.access', 'general_affairs.cooperation_record.view')),
    'vue_workspace_ga6_util_mgr', jsonb_build_object('name', '測試 第6批 水電網費管理', 'perms', jsonb_build_array(
      'general_affairs.service_center.access', 'general_affairs.utility_bill.view', 'general_affairs.utility_bill.manage')),
    'vue_workspace_ga6_util_view', jsonb_build_object('name', '測試 第6批 水電網費檢視', 'perms', jsonb_build_array(
      'general_affairs.service_center.access', 'general_affairs.utility_bill.view')),
    'vue_workspace_ga6_ga_all', jsonb_build_object('name', '測試 第6批 總務全套', 'perms', jsonb_build_array(
      'general_affairs.service_center.access', 'general_affairs.vendor.view', 'general_affairs.vendor.manage', 'general_affairs.service_category.view', 'general_affairs.service_category.manage',
      'general_affairs.service_region.view', 'general_affairs.service_region.manage', 'general_affairs.cooperation_record.view',
      'general_affairs.purchase_review.view', 'general_affairs.purchase_review.manage',
      'general_affairs.inventory_transaction.view', 'general_affairs.inventory_transaction.manage', 'general_affairs.part.view', 'general_affairs.part.manage',
      'general_affairs.work_order.view_all', 'general_affairs.work_order.update', 'general_affairs.work_order.manage', 'general_affairs.service_center.force_close',
      'general_affairs.utility_bill.view', 'general_affairs.utility_bill.manage', 'general_affairs.request.manage', 'general_affairs.request.view_all',
      'general_affairs.inventory_transfer.view', 'general_affairs.inventory_transfer.manage', 'general_affairs.equipment.manage', 'general_affairs.equipment.view',
      'general_affairs.facility.manage', 'general_affairs.facility.view')));
  v_code text;
  v_role_id uuid;
BEGIN
  FOR v_code IN SELECT jsonb_object_keys(v_def) LOOP
    IF v_code NOT LIKE 'vue_workspace_ga6\_%' THEN RAISE EXCEPTION '角色代碼必須以 vue_workspace_ga6_ 開頭'; END IF;
    INSERT INTO public.roles (code, name, description, is_active, is_system)
    VALUES (v_code, v_def -> v_code ->> 'name', 'M7M8 第 6 批 DEV 測試角色（正式區不建）', true, false)
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = true
    RETURNING id INTO v_role_id;
    DELETE FROM public.role_permissions WHERE role_id = v_role_id;
    INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
    SELECT v_role_id, p.id, true FROM public.permissions p WHERE p.code IN (SELECT jsonb_array_elements_text(v_def -> v_code -> 'perms'));
  END LOOP;
END $$;
