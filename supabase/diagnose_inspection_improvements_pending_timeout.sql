-- Diagnose why inspection improvements pending list times out.
-- Run in Supabase SQL Editor on production and share the result rows if the app still times out.

SET statement_timeout = '30s';

SELECT
  'pending_id_probe' AS probe,
  COUNT(*) AS row_count
FROM (
  SELECT id
  FROM public.inspection_improvements
  WHERE status = 'pending'
  LIMIT 200
) pending_ids;

SELECT
  'pending_minimal_probe' AS probe,
  COUNT(*) AS row_count
FROM (
  SELECT
    id,
    inspection_id,
    store_id,
    section_name,
    item_name,
    deduction_amount,
    selected_items,
    status,
    deadline,
    days_taken,
    bonus_score,
    improved_at,
    created_at
  FROM public.inspection_improvements
  WHERE status = 'pending'
  LIMIT 200
) pending_rows;

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'inspection_improvements'
ORDER BY indexname;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id
FROM public.inspection_improvements
WHERE status = 'pending'
LIMIT 200;
