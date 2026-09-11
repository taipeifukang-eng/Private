-- Repair inspection improvement pending-list timeout in production.
-- Run this in Supabase SQL Editor for the production project.

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

ANALYZE public.inspection_improvements;

SELECT
  'inspection_improvements_index_repair_done' AS result,
  COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
  COUNT(*) FILTER (WHERE status = 'overdue') AS overdue_count,
  COUNT(*) FILTER (WHERE status = 'improved') AS improved_count,
  COUNT(*) AS total_count
FROM public.inspection_improvements;

NOTIFY pgrst, 'reload schema';
