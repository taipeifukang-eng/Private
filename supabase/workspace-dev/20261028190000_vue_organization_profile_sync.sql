BEGIN;
-- Keep the legacy profile department projection consistent when a unit changes,
-- not only when membership changes. No existing profile backfill is performed.
CREATE OR REPLACE FUNCTION public.workspace_organization_unit_sync_profiles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE person uuid;
BEGIN
 IF (OLD.type='department' OR NEW.type='department') AND
    (OLD.name IS DISTINCT FROM NEW.name OR OLD.status IS DISTINCT FROM NEW.status OR OLD.type IS DISTINCT FROM NEW.type) THEN
  FOR person IN SELECT DISTINCT user_id FROM organization_memberships
   WHERE organization_unit_id=NEW.id AND status='active' AND effective_to IS NULL AND is_primary
  LOOP
   PERFORM sync_primary_department_to_profile(person);
  END LOOP;
 END IF;
 RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.workspace_organization_unit_sync_profiles() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_organization_unit_sync_profiles() TO service_role;
DROP TRIGGER IF EXISTS workspace_organization_unit_sync_profiles ON public.organization_units;
CREATE TRIGGER workspace_organization_unit_sync_profiles
AFTER UPDATE OF name,status,type ON public.organization_units
FOR EACH ROW EXECUTE FUNCTION public.workspace_organization_unit_sync_profiles();
NOTIFY pgrst,'reload schema';
COMMIT;
