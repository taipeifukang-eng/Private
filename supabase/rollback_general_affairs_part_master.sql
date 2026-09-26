-- ============================================================
-- Rollback - General Affairs Part Master - Task 1B-3
-- DEV/STAGING only unless explicitly approved for Production.
-- Does not remove Task 1A categories, Task 1B-1 equipment,
-- Task 1B-2 facilities, profiles, stores, store_managers, or RBAC.
-- ============================================================

-- 1. Remove role permission assignments for Task 1B-3 permission codes.
DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT id
  FROM permissions
  WHERE code IN (
    'general_affairs.part.view',
    'general_affairs.part.manage'
  )
);

-- 2. Policies.
DROP POLICY IF EXISTS "ga_part_compatibilities_update" ON public.ga_part_compatibilities;
DROP POLICY IF EXISTS "ga_part_compatibilities_insert" ON public.ga_part_compatibilities;
DROP POLICY IF EXISTS "ga_part_compatibilities_read_via_part" ON public.ga_part_compatibilities;
DROP POLICY IF EXISTS "ga_parts_update" ON public.ga_parts;
DROP POLICY IF EXISTS "ga_parts_insert" ON public.ga_parts;
DROP POLICY IF EXISTS "ga_parts_manage_read" ON public.ga_parts;
DROP POLICY IF EXISTS "ga_parts_general_read" ON public.ga_parts;

-- 3. Triggers.
DROP TRIGGER IF EXISTS trg_ga_part_compatibilities_before_write ON public.ga_part_compatibilities;
DROP TRIGGER IF EXISTS trg_ga_parts_before_write ON public.ga_parts;

-- 4. Part-specific functions / RPC.
REVOKE ALL ON FUNCTION public.ga_soft_delete_part_compatibility(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_soft_delete_part(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_is_store_manager() FROM PUBLIC;
DROP FUNCTION IF EXISTS public.ga_soft_delete_part_compatibility(UUID, TEXT);
DROP FUNCTION IF EXISTS public.ga_soft_delete_part(UUID, TEXT);
DROP FUNCTION IF EXISTS public.ga_validate_part_compatibility();
DROP FUNCTION IF EXISTS public.ga_validate_part();
DROP FUNCTION IF EXISTS public.ga_part_is_visible(UUID);
DROP FUNCTION IF EXISTS public.ga_is_active_part_category(UUID);
DROP FUNCTION IF EXISTS public.current_user_is_store_manager();

-- 5. Tables.
DROP TABLE IF EXISTS ga_part_compatibilities;
DROP TABLE IF EXISTS ga_parts;

-- 6. Permission codes.
DELETE FROM permissions
WHERE code IN (
  'general_affairs.part.view',
  'general_affairs.part.manage'
);
