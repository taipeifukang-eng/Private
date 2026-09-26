-- General Affairs asset QR scan token foundation.
-- QR labels should point to a stable scan entry, not a mutable workflow URL.

DO $$
BEGIN
  IF to_regclass('public.ga_equipment') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.ga_equipment';
  END IF;

  IF to_regclass('public.ga_facilities') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.ga_facilities';
  END IF;
END $$;

ALTER TABLE public.ga_equipment
  ADD COLUMN IF NOT EXISTS qr_token TEXT,
  ADD COLUMN IF NOT EXISTS qr_token_issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qr_token_revoked_at TIMESTAMPTZ;

ALTER TABLE public.ga_facilities
  ADD COLUMN IF NOT EXISTS qr_token TEXT,
  ADD COLUMN IF NOT EXISTS qr_token_issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qr_token_revoked_at TIMESTAMPTZ;

ALTER TABLE public.ga_equipment DISABLE TRIGGER USER;
ALTER TABLE public.ga_facilities DISABLE TRIGGER USER;

DO $$
BEGIN
  UPDATE public.ga_equipment
  SET
    qr_token = lower(replace(gen_random_uuid()::TEXT, '-', '')),
    qr_token_issued_at = COALESCE(qr_token_issued_at, NOW())
  WHERE qr_token IS NULL;

  UPDATE public.ga_facilities
  SET
    qr_token = lower(replace(gen_random_uuid()::TEXT, '-', '')),
    qr_token_issued_at = COALESCE(qr_token_issued_at, NOW())
  WHERE qr_token IS NULL;
END $$;

ALTER TABLE public.ga_equipment ENABLE TRIGGER USER;
ALTER TABLE public.ga_facilities ENABLE TRIGGER USER;

ALTER TABLE public.ga_equipment
  ALTER COLUMN qr_token SET DEFAULT lower(replace(gen_random_uuid()::TEXT, '-', '')),
  ALTER COLUMN qr_token_issued_at SET DEFAULT NOW();

ALTER TABLE public.ga_facilities
  ALTER COLUMN qr_token SET DEFAULT lower(replace(gen_random_uuid()::TEXT, '-', '')),
  ALTER COLUMN qr_token_issued_at SET DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ga_equipment_qr_token_format'
      AND conrelid = 'public.ga_equipment'::regclass
  ) THEN
    ALTER TABLE public.ga_equipment
      ADD CONSTRAINT ga_equipment_qr_token_format
      CHECK (qr_token IS NULL OR qr_token ~ '^[a-z0-9]{24,64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ga_facilities_qr_token_format'
      AND conrelid = 'public.ga_facilities'::regclass
  ) THEN
    ALTER TABLE public.ga_facilities
      ADD CONSTRAINT ga_facilities_qr_token_format
      CHECK (qr_token IS NULL OR qr_token ~ '^[a-z0-9]{24,64}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_equipment_qr_token
ON public.ga_equipment (qr_token)
WHERE qr_token IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_facilities_qr_token
ON public.ga_facilities (qr_token)
WHERE qr_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ga_equipment_qr_token_active
ON public.ga_equipment (qr_token)
WHERE deleted_at IS NULL AND qr_token_revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_facilities_qr_token_active
ON public.ga_facilities (qr_token)
WHERE deleted_at IS NULL AND qr_token_revoked_at IS NULL;

NOTIFY pgrst, 'reload schema';
