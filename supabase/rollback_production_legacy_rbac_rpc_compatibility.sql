-- ============================================================
-- Rollback P1-J - Production legacy RBAC RPC compatibility
-- DEV only. Do not run in Production without explicit approval.
-- ============================================================

DROP FUNCTION IF EXISTS public.get_all_employees_for_rbac();
DROP FUNCTION IF EXISTS public.check_user_permission(uuid, varchar);
