-- ============================================================
-- DEV Baseline 006 - base seed
-- Use only on a brand-new DEV Supabase project.
-- Do not run in Production.
-- ============================================================

INSERT INTO public.roles (name, code, description, is_system, is_active) VALUES
  ('DEV Admin', 'admin', 'DEV-only RBAC admin role', true, true),
  ('DEV No GA Access', 'dev_no_ga_access', 'DEV user without general affairs access', false, true),
  ('DEV GA Access Only', 'dev_ga_access_only', 'DEV user with service center access only', false, true),
  ('DEV GA Category View', 'dev_ga_category_view', 'DEV user with category view permissions', false, true),
  ('DEV GA Category Manage', 'dev_ga_category_manage', 'DEV user with category manage permissions', false, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active;

INSERT INTO public.permissions (module, feature, code, action, description, is_active) VALUES
  ('general_affairs', 'service_center', 'general_affairs.service_center.access', 'view', '可進入總務服務中心', true)
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = true;

INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM public.roles r
JOIN public.permissions p ON p.code = 'general_affairs.service_center.access'
WHERE r.code IN ('dev_ga_access_only', 'dev_ga_category_view', 'dev_ga_category_manage')
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;

INSERT INTO public.stores (store_code, store_name, short_name, address, phone, manager_name) VALUES
  ('DEV001', 'DEV 測試門市一', 'DEV一店', 'DEV only fake address', '02-0000-0001', 'DEV Manager'),
  ('DEV002', 'DEV 測試門市二', 'DEV二店', 'DEV only fake address', '02-0000-0002', 'DEV Manager')
ON CONFLICT (store_code) DO UPDATE SET
  store_name = EXCLUDED.store_name,
  short_name = EXCLUDED.short_name,
  address = EXCLUDED.address,
  phone = EXCLUDED.phone,
  manager_name = EXCLUDED.manager_name,
  is_active = true;

