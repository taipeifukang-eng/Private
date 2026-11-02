BEGIN;
-- Existing DEV store SELECT policies only admit active stores. Allow inactive
-- records only for the already-defined inactive/manage permissions or active admin roles.
CREATE OR REPLACE FUNCTION public.workspace_can_read_inactive_store()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT auth.uid() IS NOT NULL AND (
  public.has_permission(auth.uid(),'store.store.view_inactive'::varchar)
  OR public.has_permission(auth.uid(),'store.manage'::varchar)
  OR EXISTS(SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
    WHERE ur.user_id=auth.uid() AND ur.is_active AND r.is_active
     AND (ur.expires_at IS NULL OR ur.expires_at>now())
     AND r.code IN ('admin','system_admin','full_admin','full_admin_role','dev_full_admin','owner','owner_role','admin_role'))
 );
$$;
REVOKE ALL ON FUNCTION public.workspace_can_read_inactive_store() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.workspace_can_read_inactive_store() TO authenticated,service_role;
DROP POLICY IF EXISTS workspace_store_inactive_read ON public.stores;
CREATE POLICY workspace_store_inactive_read ON public.stores FOR SELECT TO authenticated
USING (is_active=false AND public.workspace_can_read_inactive_store());
NOTIFY pgrst,'reload schema';
COMMIT;
