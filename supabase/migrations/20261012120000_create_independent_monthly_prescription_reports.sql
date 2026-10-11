CREATE TABLE IF NOT EXISTS public.monthly_prescription_reports (
  year_month text NOT NULL
    CHECK (year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  regular_prescription_count integer
    CHECK (regular_prescription_count IS NULL OR regular_prescription_count >= 0),
  regular_prescription_point_value numeric(12,4)
    CHECK (regular_prescription_point_value IS NULL OR regular_prescription_point_value >= 0),
  chronic_prescription_count integer
    CHECK (chronic_prescription_count IS NULL OR chronic_prescription_count >= 0),
  chronic_prescription_point_value numeric(12,4)
    CHECK (chronic_prescription_point_value IS NULL OR chronic_prescription_point_value >= 0),
  total_chronic_prescription_count numeric(12,1)
    GENERATED ALWAYS AS (
      CASE
        WHEN regular_prescription_count IS NULL OR chronic_prescription_count IS NULL THEN NULL
        ELSE round(regular_prescription_count::numeric / 4, 1) + chronic_prescription_count::numeric
      END
    ) STORED,
  prescription_data_updated_at timestamptz NOT NULL DEFAULT now(),
  prescription_data_updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (year_month, store_id)
);

COMMENT ON TABLE public.monthly_prescription_reports IS
  'Independent monthly prescription report data; deliberately separate from monthly_store_summary and monthly staff status.';
COMMENT ON COLUMN public.monthly_prescription_reports.total_chronic_prescription_count IS
  'Generated as round(regular prescription count / 4, 1) + chronic prescription count.';

ALTER TABLE public.monthly_prescription_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.monthly_prescription_reports FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.monthly_prescription_reports TO service_role;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'monthly_store_summary'
      AND column_name = 'prescription_data_updated_at'
  ) THEN
    EXECUTE $copy$
      INSERT INTO public.monthly_prescription_reports (
        year_month,
        store_id,
        regular_prescription_count,
        regular_prescription_point_value,
        chronic_prescription_count,
        chronic_prescription_point_value,
        prescription_data_updated_at,
        prescription_data_updated_by,
        created_at,
        updated_at
      )
      SELECT
        year_month,
        store_id,
        regular_prescription_count,
        regular_prescription_point_value,
        chronic_prescription_count,
        chronic_prescription_point_value,
        prescription_data_updated_at,
        prescription_data_updated_by,
        prescription_data_updated_at,
        prescription_data_updated_at
      FROM public.monthly_store_summary
      WHERE prescription_data_updated_at IS NOT NULL
      ON CONFLICT (year_month, store_id) DO NOTHING
    $copy$;
  END IF;
END
$migration$;
