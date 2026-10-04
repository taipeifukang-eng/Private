ALTER TABLE public.monthly_store_summary
  ALTER COLUMN business_days TYPE numeric(4,1)
  USING business_days::numeric(4,1);

COMMENT ON COLUMN public.monthly_store_summary.business_days IS '營業天數，支援 0.5 天';
