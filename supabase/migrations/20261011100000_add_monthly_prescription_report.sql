ALTER TABLE public.monthly_store_summary
  ADD COLUMN IF NOT EXISTS regular_prescription_point_value numeric(12,4),
  ADD COLUMN IF NOT EXISTS chronic_prescription_point_value numeric(12,4),
  ADD COLUMN IF NOT EXISTS prescription_data_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS prescription_data_updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS total_chronic_prescription_count numeric(12,1)
    GENERATED ALWAYS AS (
      CASE
        WHEN regular_prescription_count IS NULL OR chronic_prescription_count IS NULL THEN NULL
        ELSE round(regular_prescription_count::numeric / 4, 1) + chronic_prescription_count::numeric
      END
    ) STORED;

COMMENT ON COLUMN public.monthly_store_summary.regular_prescription_point_value IS
  'Monthly regular-prescription point value maintained by the performance prescription report.';
COMMENT ON COLUMN public.monthly_store_summary.chronic_prescription_point_value IS
  'Monthly chronic-prescription point value maintained by the performance prescription report.';
COMMENT ON COLUMN public.monthly_store_summary.prescription_data_updated_at IS
  'Latest update time for prescription report fields.';
COMMENT ON COLUMN public.monthly_store_summary.prescription_data_updated_by IS
  'User who last updated prescription report fields.';
COMMENT ON COLUMN public.monthly_store_summary.total_chronic_prescription_count IS
  'Generated as round(regular_prescription_count / 4, 1) + chronic_prescription_count.';
