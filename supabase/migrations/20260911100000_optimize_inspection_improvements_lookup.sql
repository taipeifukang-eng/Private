-- Speed up inspection improvement listing by status and scoped visibility.

DO $$
BEGIN
  IF to_regclass('public.inspection_improvements') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.inspection_improvements';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inspection_improvements_status_id
  ON public.inspection_improvements (status, id);

CREATE INDEX IF NOT EXISTS idx_inspection_improvements_store_status_id
  ON public.inspection_improvements (store_id, status, id);

CREATE INDEX IF NOT EXISTS idx_inspection_improvements_inspection_status_id
  ON public.inspection_improvements (inspection_id, status, id);

CREATE INDEX IF NOT EXISTS idx_inspection_improvements_status_deadline_created
  ON public.inspection_improvements (status, deadline, created_at DESC);

NOTIFY pgrst, 'reload schema';
