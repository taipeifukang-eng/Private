-- 診斷「月曆有巡店紀錄，但仍出現在尚未巡店」的門市。
-- 修改 target_month 後，可直接在 Supabase SQL Editor 執行。

WITH RECURSIVE
params AS (
  SELECT DATE '2026-09-01' AS target_month
),
active_stores AS (
  SELECT id, store_code, store_name, short_name, source_store_id
  FROM public.stores
  WHERE is_active = true
),
store_lineage AS (
  SELECT
    s.id AS active_store_id,
    s.id AS lineage_store_id,
    s.source_store_id,
    0 AS depth
  FROM active_stores s

  UNION ALL

  SELECT
    lineage.active_store_id,
    source.id AS lineage_store_id,
    source.source_store_id,
    lineage.depth + 1
  FROM store_lineage lineage
  JOIN public.stores source ON source.id = lineage.source_store_id
  WHERE lineage.depth < 20
),
month_inspections AS (
  SELECT
    im.id,
    im.store_id,
    im.inspection_date,
    im.inspection_type,
    im.status,
    LOWER(REGEXP_REPLACE(TRIM(s.store_name), '\s+', '', 'g')) AS normalized_store_name
  FROM public.inspection_masters im
  JOIN public.stores s ON s.id = im.store_id
  CROSS JOIN params p
  WHERE im.inspection_date >= p.target_month
    AND im.inspection_date < (p.target_month + INTERVAL '1 month')
    AND (im.inspection_type = 'supervisor' OR im.inspection_type IS NULL)
),
active_name_counts AS (
  SELECT
    LOWER(REGEXP_REPLACE(TRIM(store_name), '\s+', '', 'g')) AS normalized_store_name,
    COUNT(*) AS active_store_count
  FROM active_stores
  GROUP BY LOWER(REGEXP_REPLACE(TRIM(store_name), '\s+', '', 'g'))
),
lineage_results AS (
  SELECT
    active.id AS active_store_id,
    COUNT(DISTINCT inspection.id) AS inspection_count,
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT inspection.store_id), NULL) AS matched_inspection_store_ids,
    BOOL_OR(inspection.store_id = active.id) AS matched_current_id,
    BOOL_OR(inspection.store_id IS NOT NULL AND inspection.store_id <> active.id) AS matched_history_id
  FROM active_stores active
  JOIN store_lineage lineage ON lineage.active_store_id = active.id
  LEFT JOIN month_inspections inspection ON inspection.store_id = lineage.lineage_store_id
  GROUP BY active.id
),
name_fallback_results AS (
  SELECT
    active.id AS active_store_id,
    COUNT(DISTINCT inspection.id) AS inspection_count,
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT inspection.store_id), NULL) AS matched_inspection_store_ids
  FROM active_stores active
  JOIN active_name_counts name_count
    ON name_count.normalized_store_name = LOWER(REGEXP_REPLACE(TRIM(active.store_name), '\s+', '', 'g'))
   AND name_count.active_store_count = 1
  LEFT JOIN month_inspections inspection
    ON inspection.normalized_store_name = name_count.normalized_store_name
  GROUP BY active.id
)
SELECT
  active.store_code,
  active.store_name,
  active.short_name,
  active.id AS active_store_id,
  active.source_store_id,
  GREATEST(lineage.inspection_count, name_fallback.inspection_count) AS inspection_count,
  lineage.matched_current_id,
  lineage.matched_history_id,
  CASE
    WHEN lineage.inspection_count > 0 THEN lineage.matched_inspection_store_ids
    ELSE name_fallback.matched_inspection_store_ids
  END AS matched_inspection_store_ids,
  CASE
    WHEN lineage.inspection_count > 0 AND lineage.matched_history_id AND NOT lineage.matched_current_id
      THEN '巡店記在 source_store_id 沿革中的舊門市 ID'
    WHEN lineage.inspection_count = 0 AND name_fallback.inspection_count > 0
      THEN '舊門市未回填 source_store_id，以唯一同名門市認列'
    WHEN lineage.inspection_count = 0 AND name_fallback.inspection_count = 0
      THEN '本月確實沒有巡店紀錄'
    ELSE '本月已巡店'
  END AS diagnosis
FROM active_stores active
JOIN lineage_results lineage ON lineage.active_store_id = active.id
JOIN name_fallback_results name_fallback ON name_fallback.active_store_id = active.id
ORDER BY
  CASE
    WHEN lineage.inspection_count = 0 AND name_fallback.inspection_count > 0 THEN 0
    WHEN lineage.matched_history_id AND NOT lineage.matched_current_id THEN 1
    ELSE 2
  END,
  active.store_code;
