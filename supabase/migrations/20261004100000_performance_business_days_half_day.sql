-- Preserve half-day operating schedules used by monthly and quarterly bonus thresholds.
ALTER TABLE public.store_performance
  ALTER COLUMN business_days TYPE numeric(4, 1)
  USING business_days::numeric(4, 1);

ALTER TABLE public.store_performance
  DROP CONSTRAINT IF EXISTS store_performance_business_days_check;

ALTER TABLE public.store_performance
  ADD CONSTRAINT store_performance_business_days_check
  CHECK (
    business_days >= 0.5
    AND business_days <= 31
    AND business_days * 2 = trunc(business_days * 2)
  );

COMMENT ON COLUMN public.store_performance.business_days IS
  '當月營業天數，支援以 0.5 天為單位';
