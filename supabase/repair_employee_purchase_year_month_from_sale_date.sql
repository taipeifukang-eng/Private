-- Repair employee purchase rows imported into the wrong year_month.
-- Run the preview SELECT first. If the counts match the bad import, run the
-- UPDATE statements in the same SQL editor session.

BEGIN;

-- Preview mismatched rows before repair.
SELECT
  year_month AS stored_year_month,
  to_char(sale_date, 'YYYY-MM') AS sale_year_month,
  COUNT(*) AS row_count,
  COALESCE(SUM(total_amount), 0) AS total_amount
FROM public.employee_purchase_sales
WHERE sale_date IS NOT NULL
  AND year_month <> to_char(sale_date, 'YYYY-MM')
GROUP BY year_month, to_char(sale_date, 'YYYY-MM')
ORDER BY stored_year_month, sale_year_month;

-- Move sales rows to the month shown by sale_date.
UPDATE public.employee_purchase_sales
SET year_month = to_char(sale_date, 'YYYY-MM')
WHERE sale_date IS NOT NULL
  AND year_month <> to_char(sale_date, 'YYYY-MM');

-- If an import batch contains rows from exactly one sale month, move the batch
-- record to that same month so "latest import" cards point to the corrected month.
WITH batch_months AS (
  SELECT
    batch_id,
    MIN(to_char(sale_date, 'YYYY-MM')) AS sale_year_month,
    MAX(to_char(sale_date, 'YYYY-MM')) AS max_sale_year_month,
    COUNT(*) AS row_count,
    COUNT(*) FILTER (
      WHERE sale_date IS NOT NULL
        AND year_month = to_char(sale_date, 'YYYY-MM')
    ) AS aligned_row_count
  FROM public.employee_purchase_sales
  WHERE batch_id IS NOT NULL
  GROUP BY batch_id
)
UPDATE public.employee_purchase_import_batches batches
SET year_month = batch_months.sale_year_month
FROM batch_months
WHERE batches.id = batch_months.batch_id
  AND batch_months.sale_year_month = batch_months.max_sale_year_month
  AND batch_months.row_count = batch_months.aligned_row_count
  AND batches.year_month <> batch_months.sale_year_month;

-- Preview after repair. This should return zero rows.
SELECT
  year_month AS stored_year_month,
  to_char(sale_date, 'YYYY-MM') AS sale_year_month,
  COUNT(*) AS row_count,
  COALESCE(SUM(total_amount), 0) AS total_amount
FROM public.employee_purchase_sales
WHERE sale_date IS NOT NULL
  AND year_month <> to_char(sale_date, 'YYYY-MM')
GROUP BY year_month, to_char(sale_date, 'YYYY-MM')
ORDER BY stored_year_month, sale_year_month;

COMMIT;
