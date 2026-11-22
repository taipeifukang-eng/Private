-- Imported bonus values are authoritative per store, month, and employee.
-- Remove the legacy trigger that preserved old non-zero values over explicit zeroes.

DROP TRIGGER IF EXISTS trg_preserve_monthly_bonus_nonzero_values
  ON public.monthly_bonus_records;

DROP FUNCTION IF EXISTS public.preserve_monthly_bonus_nonzero_values();
