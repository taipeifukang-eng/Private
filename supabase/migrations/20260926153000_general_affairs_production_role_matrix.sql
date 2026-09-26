-- Complete the production General Affairs permission catalogue and role matrix.
-- This migration does not migrate legacy cross-department tickets or grant GA
-- permissions to supervisors and other unrelated roles.

DO $$
DECLARE
  v_missing_roles text[];
BEGIN
  IF to_regclass('public.permissions') IS NULL
     OR to_regclass('public.roles') IS NULL
     OR to_regclass('public.role_permissions') IS NULL THEN
    RAISE EXCEPTION 'General Affairs role matrix prerequisites are missing';
  END IF;

  SELECT array_agg(required_role)
  INTO v_missing_roles
  FROM unnest(ARRAY['admin', 'general_affairs', 'store_manager_role']) AS required_role
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles r WHERE r.code = required_role
  );

  IF array_length(v_missing_roles, 1) > 0 THEN
    RAISE EXCEPTION 'Required production roles are missing: %', array_to_string(v_missing_roles, ', ');
  END IF;
END $$;

INSERT INTO public.permissions (module, feature, code, action, description, is_active) VALUES
  ('general_affairs', 'maintenance_request', 'general_affairs.maintenance_request.create', 'create', '建立總務維修回報與臨時料件申請', true),
  ('general_affairs', 'maintenance_request', 'general_affairs.maintenance_request.view_own_store', 'view_own_store', '查看自己門市總務維修回報', true),
  ('general_affairs', 'maintenance_request', 'general_affairs.maintenance_request.view_all', 'view_all', '查看全部總務維修回報', true),
  ('general_affairs', 'maintenance_request', 'general_affairs.maintenance_request.update', 'update', '更新總務維修回報', true),
  ('general_affairs', 'work_order', 'general_affairs.work_order.view_own_store', 'view_own_store', '查看自己門市總務工單', true),
  ('general_affairs', 'work_order', 'general_affairs.work_order.view_all', 'view_all', '查看全部總務工單', true),
  ('general_affairs', 'work_order', 'general_affairs.work_order.update', 'update', '更新總務工單進度', true),
  ('general_affairs', 'work_order', 'general_affairs.work_order.manage', 'manage', '管理總務工單', true),
  ('general_affairs', 'vendor', 'general_affairs.vendor.view', 'view', '查看總務合作廠商資料', true),
  ('general_affairs', 'vendor', 'general_affairs.vendor.manage', 'manage', '新增、更新與管理總務合作廠商資料', true),
  ('general_affairs', 'service_category', 'general_affairs.service_category.view', 'view', '查看總務廠商服務分類', true),
  ('general_affairs', 'service_category', 'general_affairs.service_category.manage', 'manage', '新增、更新與管理總務廠商服務分類', true),
  ('general_affairs', 'service_region', 'general_affairs.service_region.view', 'view', '查看總務廠商服務區域', true),
  ('general_affairs', 'service_region', 'general_affairs.service_region.manage', 'manage', '新增、更新與管理總務廠商服務區域', true),
  ('general_affairs', 'cooperation_record', 'general_affairs.cooperation_record.view', 'view', '查看總務廠商合作紀錄與統計', true)
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = true;

-- System administrators and General Affairs staff operate the full GA centre.
INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code IN ('admin', 'general_affairs')
  AND p.module = 'general_affairs'
  AND p.is_active = true
ON CONFLICT (role_id, permission_id) DO UPDATE
SET is_allowed = true;

-- Store managers can submit and follow only their own store's requests.
INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM public.roles r
JOIN public.permissions p ON p.code = ANY (ARRAY[
  'general_affairs.service_center.access',
  'general_affairs.request.create',
  'general_affairs.request.view_own_store',
  'general_affairs.request.comment_own_store',
  'general_affairs.request.confirm_own_store',
  'general_affairs.maintenance_request.create',
  'general_affairs.maintenance_request.view_own_store',
  'general_affairs.work_order.view_own_store'
])
WHERE r.code = 'store_manager_role'
ON CONFLICT (role_id, permission_id) DO UPDATE
SET is_allowed = true;

DO $$
DECLARE
  v_permission_count integer;
  v_admin_count integer;
  v_ga_count integer;
BEGIN
  SELECT count(*) INTO v_permission_count
  FROM public.permissions
  WHERE module = 'general_affairs' AND is_active = true;

  SELECT count(*) INTO v_admin_count
  FROM public.role_permissions rp
  JOIN public.roles r ON r.id = rp.role_id
  JOIN public.permissions p ON p.id = rp.permission_id
  WHERE r.code = 'admin' AND p.module = 'general_affairs' AND rp.is_allowed = true;

  SELECT count(*) INTO v_ga_count
  FROM public.role_permissions rp
  JOIN public.roles r ON r.id = rp.role_id
  JOIN public.permissions p ON p.id = rp.permission_id
  WHERE r.code = 'general_affairs' AND p.module = 'general_affairs' AND rp.is_allowed = true;

  IF v_permission_count < 50 OR v_admin_count <> v_permission_count OR v_ga_count <> v_permission_count THEN
    RAISE EXCEPTION
      'Incomplete General Affairs role matrix (permissions %, admin %, GA %)',
      v_permission_count, v_admin_count, v_ga_count;
  END IF;
END $$;
