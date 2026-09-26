-- ============================================================
-- Task UI-3A-1 - DEV General Affairs role matrix permissions
-- DEV-only RBAC seed for manual verification accounts.
--
-- This migration intentionally:
-- - assigns permissions by role code + permission code, never by email
-- - uses General Affairs maintenance/work-order permission codes, not
--   cross-department maintenance permission codes
-- - does not create Auth users or profiles
-- - does not grant vendor/service-category/service-region permissions
-- - does not change RLS, RPC, tables, indexes, or API contracts
-- - does not modify previously applied migrations
-- ============================================================

INSERT INTO public.permissions (module, feature, code, action, description, is_active) VALUES
  ('general_affairs', 'maintenance_request', 'general_affairs.maintenance_request.create', 'create', '建立總務維修回報與臨時料件申請', true),
  ('general_affairs', 'maintenance_request', 'general_affairs.maintenance_request.view_own_store', 'view_own_store', '查看自己門市總務維修回報', true),
  ('general_affairs', 'maintenance_request', 'general_affairs.maintenance_request.view_all', 'view_all', '查看全部總務維修回報', true),
  ('general_affairs', 'maintenance_request', 'general_affairs.maintenance_request.update', 'update', '更新總務維修回報', true),
  ('general_affairs', 'work_order', 'general_affairs.work_order.view_own_store', 'view_own_store', '查看自己門市總務工單', true),
  ('general_affairs', 'work_order', 'general_affairs.work_order.view_all', 'view_all', '查看全部總務工單', true),
  ('general_affairs', 'work_order', 'general_affairs.work_order.update', 'update', '更新總務工單進度', true),
  ('general_affairs', 'work_order', 'general_affairs.work_order.manage', 'manage', '管理總務工單', true)
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = true;

DO $$
DECLARE
  v_missing_roles text;
  v_missing_permissions text;
BEGIN
  WITH expected_roles(code) AS (
    VALUES
      ('dev_ga_access_only'),
      ('dev_ga_category_view'),
      ('dev_ga_category_manage')
  )
  SELECT string_agg(er.code, ', ' ORDER BY er.code)
  INTO v_missing_roles
  FROM expected_roles er
  LEFT JOIN public.roles r ON r.code = er.code
  WHERE r.id IS NULL;

  IF v_missing_roles IS NOT NULL THEN
    RAISE EXCEPTION 'UI-3A DEV role matrix seed missing roles: %', v_missing_roles;
  END IF;

  WITH expected_permissions(code) AS (
    VALUES
      ('general_affairs.service_center.access'),
      ('general_affairs.maintenance_request.create'),
      ('general_affairs.maintenance_request.view_own_store'),
      ('general_affairs.maintenance_request.view_all'),
      ('general_affairs.maintenance_request.update'),
      ('general_affairs.work_order.view_own_store'),
      ('general_affairs.work_order.view_all'),
      ('general_affairs.work_order.update'),
      ('general_affairs.work_order.manage'),
      ('general_affairs.equipment.view'),
      ('general_affairs.equipment.manage'),
      ('general_affairs.equipment_template.manage'),
      ('general_affairs.facility.view'),
      ('general_affairs.facility.manage'),
      ('general_affairs.part.view'),
      ('general_affairs.part.manage'),
      ('general_affairs.inventory_location.view'),
      ('general_affairs.inventory_location.manage'),
      ('general_affairs.inventory_balance.view'),
      ('general_affairs.inventory_transaction.view'),
      ('general_affairs.inventory_transaction.manage')
  )
  SELECT string_agg(ep.code, ', ' ORDER BY ep.code)
  INTO v_missing_permissions
  FROM expected_permissions ep
  LEFT JOIN public.permissions p ON p.code = ep.code
  WHERE p.id IS NULL;

  IF v_missing_permissions IS NOT NULL THEN
    RAISE EXCEPTION 'UI-3A DEV role matrix seed missing permissions: %', v_missing_permissions;
  END IF;
END $$;

WITH assignments(role_code, permission_code) AS (
  VALUES
    -- Store manager: can enter GA, submit/track maintenance-backed requests,
    -- and read scoped assets/inventory through API/RLS.
    ('dev_ga_access_only', 'general_affairs.service_center.access'),
    ('dev_ga_access_only', 'general_affairs.maintenance_request.create'),
    ('dev_ga_access_only', 'general_affairs.maintenance_request.view_own_store'),
    ('dev_ga_access_only', 'general_affairs.work_order.view_own_store'),
    ('dev_ga_access_only', 'general_affairs.equipment.view'),
    ('dev_ga_access_only', 'general_affairs.facility.view'),
    ('dev_ga_access_only', 'general_affairs.part.view'),
    ('dev_ga_access_only', 'general_affairs.inventory_location.view'),
    ('dev_ga_access_only', 'general_affairs.inventory_balance.view'),
    ('dev_ga_access_only', 'general_affairs.inventory_transaction.view'),

    -- Supervisor: can submit/track maintenance-backed requests and view
    -- scoped store assets/inventory. It does not get manage/global permissions.
    ('dev_ga_category_view', 'general_affairs.service_center.access'),
    ('dev_ga_category_view', 'general_affairs.maintenance_request.create'),
    ('dev_ga_category_view', 'general_affairs.maintenance_request.view_own_store'),
    ('dev_ga_category_view', 'general_affairs.work_order.view_own_store'),
    ('dev_ga_category_view', 'general_affairs.equipment.view'),
    ('dev_ga_category_view', 'general_affairs.facility.view'),
    ('dev_ga_category_view', 'general_affairs.part.view'),
    ('dev_ga_category_view', 'general_affairs.inventory_location.view'),
    ('dev_ga_category_view', 'general_affairs.inventory_balance.view'),
    ('dev_ga_category_view', 'general_affairs.inventory_transaction.view'),

    -- General Affairs: manage current available GA modules, excluding
    -- vendor permissions until the dedicated vendor permission/RLS migration.
    ('dev_ga_category_manage', 'general_affairs.service_center.access'),
    ('dev_ga_category_manage', 'general_affairs.maintenance_request.create'),
    ('dev_ga_category_manage', 'general_affairs.maintenance_request.view_all'),
    ('dev_ga_category_manage', 'general_affairs.maintenance_request.update'),
    ('dev_ga_category_manage', 'general_affairs.work_order.view_all'),
    ('dev_ga_category_manage', 'general_affairs.work_order.update'),
    ('dev_ga_category_manage', 'general_affairs.work_order.manage'),
    ('dev_ga_category_manage', 'general_affairs.equipment.manage'),
    ('dev_ga_category_manage', 'general_affairs.equipment_template.manage'),
    ('dev_ga_category_manage', 'general_affairs.facility.manage'),
    ('dev_ga_category_manage', 'general_affairs.part.view'),
    ('dev_ga_category_manage', 'general_affairs.part.manage'),
    ('dev_ga_category_manage', 'general_affairs.inventory_location.manage'),
    ('dev_ga_category_manage', 'general_affairs.inventory_balance.view'),
    ('dev_ga_category_manage', 'general_affairs.inventory_transaction.view'),
    ('dev_ga_category_manage', 'general_affairs.inventory_transaction.manage')
)
INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM assignments a
JOIN public.roles r ON r.code = a.role_code
JOIN public.permissions p ON p.code = a.permission_code
ON CONFLICT (role_id, permission_id)
DO UPDATE SET is_allowed = true;
