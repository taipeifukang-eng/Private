-- ============================================================
-- Rollback - General Affairs Inventory Locations - Task 1C-1
-- DEV/STAGING only unless explicitly approved for Production.
-- Does not remove Task 1A, Task 1B-1/2/3, profiles, stores,
-- store_managers, or RBAC baseline tables.
-- ============================================================

-- 1. Remove role permission assignments for Task 1C-1 permission codes.
DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT id
  FROM permissions
  WHERE code IN (
    'general_affairs.inventory_location.view',
    'general_affairs.inventory_location.manage'
  )
);

-- 2. Policies.
DROP POLICY IF EXISTS "ga_inventory_location_parts_update" ON public.ga_inventory_location_parts;
DROP POLICY IF EXISTS "ga_inventory_location_parts_insert" ON public.ga_inventory_location_parts;
DROP POLICY IF EXISTS "ga_inventory_location_parts_read_via_location" ON public.ga_inventory_location_parts;
DROP POLICY IF EXISTS "ga_inventory_locations_update" ON public.ga_inventory_locations;
DROP POLICY IF EXISTS "ga_inventory_locations_insert" ON public.ga_inventory_locations;
DROP POLICY IF EXISTS "ga_inventory_locations_store_manager_read" ON public.ga_inventory_locations;
DROP POLICY IF EXISTS "ga_inventory_locations_general_read" ON public.ga_inventory_locations;

-- 3. Triggers.
DROP TRIGGER IF EXISTS trg_ga_inventory_location_parts_before_write ON public.ga_inventory_location_parts;
DROP TRIGGER IF EXISTS trg_ga_inventory_locations_before_write ON public.ga_inventory_locations;

-- 4. Functions / RPC.
DROP FUNCTION IF EXISTS public.ga_soft_delete_inventory_location_part(UUID, TEXT);
DROP FUNCTION IF EXISTS public.ga_soft_delete_inventory_location(UUID, TEXT);
DROP FUNCTION IF EXISTS public.ga_validate_inventory_location_part();
DROP FUNCTION IF EXISTS public.ga_validate_inventory_location();
DROP FUNCTION IF EXISTS public.ga_inventory_location_is_visible(UUID);
DROP FUNCTION IF EXISTS public.current_user_manages_store(UUID);

-- 5. Tables.
DROP TABLE IF EXISTS public.ga_inventory_location_parts;
DROP TABLE IF EXISTS public.ga_inventory_locations;

-- 6. Permission codes.
DELETE FROM permissions
WHERE code IN (
  'general_affairs.inventory_location.view',
  'general_affairs.inventory_location.manage'
);
