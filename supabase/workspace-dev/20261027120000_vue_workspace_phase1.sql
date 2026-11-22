-- DEV-only incremental foundation. Apply via scripts/apply-workspace-dev.cjs.
-- Kept separate from historical migrations until duplicate versions are reconciled.
BEGIN;
ALTER TABLE public.inspection_masters
  ADD COLUMN IF NOT EXISTS inspection_no text,
  ADD COLUMN IF NOT EXISTS client_request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS ux_inspection_masters_client_request_id
  ON public.inspection_masters(client_request_id) WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_inspection_masters_inspection_no
  ON public.inspection_masters(inspection_no) WHERE inspection_no IS NOT NULL;
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS workspace_version bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS workspace_request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS ux_campaigns_workspace_request
  ON public.campaigns(created_by, workspace_request_id) WHERE workspace_request_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.workspace_campaign_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.workspace_version := OLD.workspace_version + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.workspace_campaign_version() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_workspace_campaign_version ON public.campaigns;
CREATE TRIGGER trg_workspace_campaign_version BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.workspace_campaign_version();
NOTIFY pgrst, 'reload schema';
COMMIT;
