-- Track equipment setup / labeling progress separately from equipment usage status.

DO $$
BEGIN
  IF to_regclass('public.ga_equipment') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.ga_equipment';
  END IF;
END $$;

ALTER TABLE public.ga_equipment
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT NOT NULL DEFAULT 'NEEDS_EQUIPMENT_PHOTO';

ALTER TABLE public.ga_equipment
  DROP CONSTRAINT IF EXISTS ga_equipment_onboarding_status_check;

ALTER TABLE public.ga_equipment
  ADD CONSTRAINT ga_equipment_onboarding_status_check
  CHECK (
    onboarding_status IN (
      'NEEDS_EQUIPMENT_PHOTO',
      'NEEDS_LABEL_PHOTO',
      'PENDING_GA_REVIEW',
      'COMPLETED'
    )
  );

CREATE INDEX IF NOT EXISTS idx_ga_equipment_onboarding_status
ON public.ga_equipment (onboarding_status, deleted_at);

COMMENT ON COLUMN public.ga_equipment.onboarding_status
IS 'Tracks initial setup and QR label photo progress independently from equipment usage status.';

NOTIFY pgrst, 'reload schema';
