BEGIN;
CREATE TABLE IF NOT EXISTS public.workspace_snapshot_import_chunks(run_id uuid NOT NULL,table_name text NOT NULL,batch_no integer NOT NULL,part_no integer NOT NULL,payload text NOT NULL,PRIMARY KEY(run_id,table_name,batch_no,part_no));
ALTER TABLE public.workspace_snapshot_import_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_snapshot_import_chunks FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.workspace_snapshot_import_chunks TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
