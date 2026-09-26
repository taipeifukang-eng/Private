-- ============================================================
-- GA-VENDOR-RBAC-1 - General Affairs vendor permission/RLS split
--
-- This forward migration introduces formal vendor/service permission
-- codes and replaces the legacy service-center-access-only policies on
-- ga_vendors, ga_service_categories, and ga_service_regions.
--
-- It does not create or alter business table columns and does not change
-- API contracts. The DEV General Affairs manager role receives the new
-- permissions only when that DEV fixture role exists.
-- ============================================================

DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT array_remove(ARRAY[
    CASE WHEN to_regclass('public.permissions') IS NULL THEN 'table public.permissions' END,
    CASE WHEN to_regclass('public.roles') IS NULL THEN 'table public.roles' END,
    CASE WHEN to_regclass('public.role_permissions') IS NULL THEN 'table public.role_permissions' END,
    CASE WHEN to_regclass('public.ga_vendors') IS NULL THEN 'table public.ga_vendors' END,
    CASE WHEN to_regclass('public.ga_service_categories') IS NULL THEN 'table public.ga_service_categories' END,
    CASE WHEN to_regclass('public.ga_service_regions') IS NULL THEN 'table public.ga_service_regions' END,
    CASE WHEN to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN 'function public.current_user_has_permission(varchar)' END
  ], NULL)
  INTO v_missing;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'GA-VENDOR-RBAC-1 prerequisites missing: %', array_to_string(v_missing, ', ');
  END IF;
END $$;

INSERT INTO public.permissions (module, feature, code, action, description, is_active) VALUES
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

DROP POLICY IF EXISTS p1e_ga_vendors_read ON public.ga_vendors;
CREATE POLICY p1e_ga_vendors_read ON public.ga_vendors
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('general_affairs.vendor.view')
  OR public.current_user_has_permission('general_affairs.vendor.manage')
  OR public.current_user_has_permission('general_affairs.service_category.view')
  OR public.current_user_has_permission('general_affairs.service_category.manage')
  OR public.current_user_has_permission('general_affairs.service_region.view')
  OR public.current_user_has_permission('general_affairs.service_region.manage')
  OR public.current_user_has_permission('general_affairs.cooperation_record.view')
);

DROP POLICY IF EXISTS p1e_ga_vendors_write ON public.ga_vendors;
CREATE POLICY p1e_ga_vendors_write ON public.ga_vendors
TO authenticated
USING (public.current_user_has_permission('general_affairs.vendor.manage'))
WITH CHECK (public.current_user_has_permission('general_affairs.vendor.manage'));

DROP POLICY IF EXISTS p1e_ga_service_categories_read ON public.ga_service_categories;
CREATE POLICY p1e_ga_service_categories_read ON public.ga_service_categories
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('general_affairs.vendor.view')
  OR public.current_user_has_permission('general_affairs.vendor.manage')
  OR public.current_user_has_permission('general_affairs.service_category.view')
  OR public.current_user_has_permission('general_affairs.service_category.manage')
  OR public.current_user_has_permission('general_affairs.service_region.view')
  OR public.current_user_has_permission('general_affairs.service_region.manage')
  OR public.current_user_has_permission('general_affairs.cooperation_record.view')
);

DROP POLICY IF EXISTS p1e_ga_service_categories_write ON public.ga_service_categories;
CREATE POLICY p1e_ga_service_categories_write ON public.ga_service_categories
TO authenticated
USING (public.current_user_has_permission('general_affairs.service_category.manage'))
WITH CHECK (public.current_user_has_permission('general_affairs.service_category.manage'));

DROP POLICY IF EXISTS p1e_ga_service_regions_read ON public.ga_service_regions;
CREATE POLICY p1e_ga_service_regions_read ON public.ga_service_regions
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('general_affairs.vendor.view')
  OR public.current_user_has_permission('general_affairs.vendor.manage')
  OR public.current_user_has_permission('general_affairs.service_category.view')
  OR public.current_user_has_permission('general_affairs.service_category.manage')
  OR public.current_user_has_permission('general_affairs.service_region.view')
  OR public.current_user_has_permission('general_affairs.service_region.manage')
  OR public.current_user_has_permission('general_affairs.cooperation_record.view')
);

DROP POLICY IF EXISTS p1e_ga_service_regions_write ON public.ga_service_regions;
CREATE POLICY p1e_ga_service_regions_write ON public.ga_service_regions
TO authenticated
USING (public.current_user_has_permission('general_affairs.service_region.manage'))
WITH CHECK (public.current_user_has_permission('general_affairs.service_region.manage'));

WITH dev_assignments(role_code, permission_code) AS (
  VALUES
    ('dev_ga_category_manage', 'general_affairs.vendor.view'),
    ('dev_ga_category_manage', 'general_affairs.vendor.manage'),
    ('dev_ga_category_manage', 'general_affairs.service_category.view'),
    ('dev_ga_category_manage', 'general_affairs.service_category.manage'),
    ('dev_ga_category_manage', 'general_affairs.service_region.view'),
    ('dev_ga_category_manage', 'general_affairs.service_region.manage'),
    ('dev_ga_category_manage', 'general_affairs.cooperation_record.view')
)
INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM dev_assignments a
JOIN public.roles r ON r.code = a.role_code
JOIN public.permissions p ON p.code = a.permission_code
ON CONFLICT (role_id, permission_id)
DO UPDATE SET is_allowed = true;

NOTIFY pgrst, 'reload schema';
