-- M7/M8 第 4 批：DEV 專用測試角色（不套正式區）。
-- 正式區不建「採購單位」角色：到「角色權限」頁替想擔任核決的角色勾「採購核准」即可。DEV 只建兩個種子角色，方便測試帳號掛用：
--   vue_workspace_ga_purchaser：採購人員（採購評估管理、庫存交易管理、料件查看，加需求單與處理單管理、廠商檢視與總務服務中心入口）。
--   vue_workspace_ga_po_approver：核准人（只有採購核准，加採購評估檢視與總務服務中心入口；沒有三個採購寫入權限）。
-- 只動 vue_workspace_ga_* 的這兩個角色；權限碼不存在的會略過。可重複執行。還原：20261112150000_m7m8_b4_dev_roles.rollback.sql。
DO $$
DECLARE
  v_def jsonb := jsonb_build_object(
    'vue_workspace_ga_purchaser', jsonb_build_object('name', '測試 總務採購人員', 'perms', jsonb_build_array(
      'general_affairs.service_center.access', 'general_affairs.purchase_review.manage', 'general_affairs.purchase_review.view',
      'general_affairs.inventory_transaction.manage', 'general_affairs.inventory_transaction.view', 'general_affairs.part.view',
      'general_affairs.inventory_location.view', 'general_affairs.inventory_balance.view', 'general_affairs.request.manage', 'general_affairs.request.view_all',
      'general_affairs.part_fulfillment.manage', 'general_affairs.part_fulfillment.view', 'general_affairs.vendor.view')),
    'vue_workspace_ga_po_approver', jsonb_build_object('name', '測試 採購核准人', 'perms', jsonb_build_array(
      'general_affairs.service_center.access', 'general_affairs.purchase_order.approve', 'general_affairs.purchase_review.view')));
  v_code text;
  v_role_id uuid;
BEGIN
  FOR v_code IN SELECT jsonb_object_keys(v_def) LOOP
    INSERT INTO public.roles (code, name, description, is_active, is_system)
    VALUES (v_code, v_def -> v_code ->> 'name', 'M7M8 第 4 批 DEV 測試角色（正式區不建）', true, false)
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, is_active = true
    RETURNING id INTO v_role_id;
    DELETE FROM public.role_permissions WHERE role_id = v_role_id;
    INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
    SELECT v_role_id, p.id, true FROM public.permissions p WHERE p.code IN (SELECT jsonb_array_elements_text(v_def -> v_code -> 'perms'));
  END LOOP;
END $$;
