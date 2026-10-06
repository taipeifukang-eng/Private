-- Allow monthly store summaries to store half-day business-day values.
ALTER TABLE public.monthly_store_summary
  ALTER COLUMN business_days TYPE numeric(4,1)
  USING business_days::numeric(4,1);

COMMENT ON COLUMN public.monthly_store_summary.business_days IS
  '營業天數，支援 0.5 天';

NOTIFY pgrst, 'reload schema';

SELECT
  table_schema,
  table_name,
  column_name,
  data_type,
  numeric_precision,
  numeric_scale
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'monthly_store_summary'
  AND column_name = 'business_days';
