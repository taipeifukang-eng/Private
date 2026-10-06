ALTER TABLE public.monthly_bonus_records
  ADD COLUMN IF NOT EXISTS brand_bonus numeric(12,2) DEFAULT 0;

NOTIFY pgrst, 'reload schema';
