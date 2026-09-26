-- ============================================================
-- Supervisor Management Log RLS Helper EXECUTE Grants
-- Fix:
--   RLS policies call these SECURITY DEFINER helper functions.
--   Authenticated users need EXECUTE on helpers that appear in
--   policy expressions, otherwise PostgREST SELECT/INSERT/UPDATE
--   can fail with "permission denied for function ...".
-- Scope:
--   - Grant EXECUTE only to authenticated.
--   - Keep PUBLIC and anon without EXECUTE.
--   - Do not change tables, policies, RPC logic or data.
-- ============================================================

REVOKE ALL ON FUNCTION public.supervisor_management_current_user_manages_store(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.supervisor_management_case_is_visible(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.supervisor_management_case_is_manageable(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.supervisor_management_current_user_manages_store(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.supervisor_management_case_is_visible(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.supervisor_management_case_is_manageable(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
