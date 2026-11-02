BEGIN;
-- DEV compatibility with the current monthly-bonus import contract.
ALTER TABLE public.monthly_bonus_records
 ADD COLUMN IF NOT EXISTS brand_bonus numeric(12,2) DEFAULT 0,
 ADD COLUMN IF NOT EXISTS long_term_care_bonus numeric(12,2) DEFAULT 0,
 ADD COLUMN IF NOT EXISTS manager_supervisor_quarterly_bonus numeric(12,2) DEFAULT 0,
 ADD COLUMN IF NOT EXISTS opening_abnormal_responsibility_amount numeric(12,2) DEFAULT 0,
 ADD COLUMN IF NOT EXISTS bonus_difference_adjustment numeric(12,2) DEFAULT 0,
 ADD COLUMN IF NOT EXISTS other_bonus numeric(12,2) DEFAULT 0,
 ADD COLUMN IF NOT EXISTS other_bonus_note text;
-- Match the existing 20261019120000 import semantics: explicit zero is a value.
DROP TRIGGER IF EXISTS trg_preserve_monthly_bonus_nonzero_values ON public.monthly_bonus_records;
NOTIFY pgrst,'reload schema';
COMMIT;
