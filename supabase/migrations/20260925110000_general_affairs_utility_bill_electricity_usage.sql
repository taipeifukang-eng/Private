ALTER TABLE public.ga_utility_bills
ADD COLUMN IF NOT EXISTS electricity_kwh NUMERIC(12,2);

ALTER TABLE public.ga_utility_bills
DROP CONSTRAINT IF EXISTS ga_utility_bills_electricity_kwh_check;

ALTER TABLE public.ga_utility_bills
ADD CONSTRAINT ga_utility_bills_electricity_kwh_check CHECK (
  electricity_kwh IS NULL
  OR (expense_type = 'ELECTRICITY' AND electricity_kwh >= 0)
);

NOTIFY pgrst, 'reload schema';
