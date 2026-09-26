ALTER TABLE public.ga_facilities
ADD COLUMN IF NOT EXISTS purchased_at date,
ADD COLUMN IF NOT EXISTS purchase_unit_amount numeric(12,2),
ADD COLUMN IF NOT EXISTS purchase_amount numeric(14,2);

ALTER TABLE public.ga_facilities
DROP CONSTRAINT IF EXISTS ga_facilities_purchase_amount_nonnegative;
ALTER TABLE public.ga_facilities
ADD CONSTRAINT ga_facilities_purchase_amount_nonnegative CHECK (
  (purchase_unit_amount IS NULL OR purchase_unit_amount >= 0)
  AND (purchase_amount IS NULL OR purchase_amount >= 0)
);

COMMENT ON COLUMN public.ga_facilities.purchase_unit_amount IS '設施每單位購買金額';
COMMENT ON COLUMN public.ga_facilities.purchase_amount IS '該筆設施購買總額';

NOTIFY pgrst, 'reload schema';
