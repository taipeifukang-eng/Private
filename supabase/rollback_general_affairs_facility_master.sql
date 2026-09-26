-- ============================================================
-- Rollback - General Affairs Facility Master - Task 1B-2
-- DEV/STAGING only unless explicitly approved for Production.
-- Does not remove Task 1A categories, Task 1B-1 equipment,
-- profiles, stores, store_managers, or RBAC baseline tables.
-- ============================================================

-- 1. Remove role permission assignments for Task 1B-2 permission codes.
DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT id
  FROM permissions
  WHERE code IN (
    'general_affairs.facility.view',
    'general_affairs.facility.manage'
  )
);

-- 2. Policies.
DROP POLICY IF EXISTS "ga_facilities_update" ON ga_facilities;
DROP POLICY IF EXISTS "ga_facilities_insert" ON ga_facilities;
DROP POLICY IF EXISTS "ga_facilities_scope_read" ON ga_facilities;

-- 3. Trigger.
DROP TRIGGER IF EXISTS trg_ga_facilities_before_write ON ga_facilities;

-- 4. Facility-specific functions / RPC.
REVOKE ALL ON FUNCTION ga_soft_delete_facility(UUID, TEXT) FROM PUBLIC;
DROP FUNCTION IF EXISTS ga_soft_delete_facility(UUID, TEXT);
DROP FUNCTION IF EXISTS ga_validate_facility();
DROP FUNCTION IF EXISTS ga_is_active_facility_category(UUID);

-- 5. Table.
DROP TABLE IF EXISTS ga_facilities;

-- 6. Permission codes.
DELETE FROM permissions
WHERE code IN (
  'general_affairs.facility.view',
  'general_affairs.facility.manage'
);
