ALTER TABLE public.ga_utility_bills
ADD COLUMN IF NOT EXISTS service_identifier TEXT,
ADD COLUMN IF NOT EXISTS equipment_serial TEXT;

DROP INDEX IF EXISTS public.uq_ga_utility_bills_identity;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_utility_bills_identity
ON public.ga_utility_bills(
  COALESCE(store_id::text, ''),
  lower(btrim(location_name)),
  expense_type,
  billing_month,
  lower(btrim(COALESCE(provider_name, ''))),
  lower(btrim(COALESCE(service_identifier, equipment_serial, account_number, '')))
) WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
