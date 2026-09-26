-- Allow GA reviewers to reject only the equipment photo, only the label-position photo, or both.

DO $$
BEGIN
  IF to_regclass('public.ga_equipment') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.ga_equipment';
  END IF;

  IF to_regclass('public.ga_resource_attachments') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.ga_resource_attachments';
  END IF;
END $$;

ALTER TABLE public.ga_equipment
  ADD COLUMN IF NOT EXISTS onboarding_requires_primary_photo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS onboarding_requires_label_photo BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ga_equipment.onboarding_requires_primary_photo
IS 'When true, the store must upload a replacement equipment body photo before GA can review setup again.';

COMMENT ON COLUMN public.ga_equipment.onboarding_requires_label_photo
IS 'When true, the store must upload a replacement QR label placement photo before GA can review setup again.';

CREATE OR REPLACE FUNCTION public.ga_calculate_equipment_onboarding_status(
  p_equipment_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_status TEXT;
  v_requires_primary_photo BOOLEAN;
  v_requires_label_photo BOOLEAN;
  v_has_equipment_photo BOOLEAN;
  v_has_label_photo BOOLEAN;
BEGIN
  SELECT
    onboarding_status,
    COALESCE(onboarding_requires_primary_photo, false),
    COALESCE(onboarding_requires_label_photo, false)
  INTO
    v_current_status,
    v_requires_primary_photo,
    v_requires_label_photo
  FROM public.ga_equipment
  WHERE id = p_equipment_id
    AND deleted_at IS NULL;

  IF v_current_status IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_current_status = 'COMPLETED' THEN
    RETURN 'COMPLETED';
  END IF;

  IF v_requires_primary_photo THEN
    RETURN 'NEEDS_EQUIPMENT_PHOTO';
  END IF;

  IF v_requires_label_photo THEN
    RETURN 'NEEDS_LABEL_PHOTO';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.ga_resource_attachments
    WHERE resource_type = 'EQUIPMENT'
      AND resource_id = p_equipment_id
      AND purpose = 'PRIMARY_IMAGE'
      AND content_type LIKE 'image/%'
      AND deleted_at IS NULL
  )
  INTO v_has_equipment_photo;

  SELECT EXISTS (
    SELECT 1
    FROM public.ga_resource_attachments
    WHERE resource_type = 'EQUIPMENT'
      AND resource_id = p_equipment_id
      AND purpose = 'LABEL_POSITION_IMAGE'
      AND content_type LIKE 'image/%'
      AND deleted_at IS NULL
  )
  INTO v_has_label_photo;

  IF NOT v_has_equipment_photo THEN
    RETURN 'NEEDS_EQUIPMENT_PHOTO';
  END IF;

  IF NOT v_has_label_photo THEN
    RETURN 'NEEDS_LABEL_PHOTO';
  END IF;

  RETURN 'PENDING_GA_REVIEW';
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_sync_equipment_onboarding_status(
  p_equipment_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next_status TEXT;
BEGIN
  v_next_status := public.ga_calculate_equipment_onboarding_status(p_equipment_id);

  IF v_next_status IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.ga_equipment
  SET onboarding_status = v_next_status
  WHERE id = p_equipment_id
    AND deleted_at IS NULL
    AND onboarding_status IS DISTINCT FROM v_next_status;
END;
$$;

REVOKE ALL ON FUNCTION public.ga_calculate_equipment_onboarding_status(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_sync_equipment_onboarding_status(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ga_calculate_equipment_onboarding_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_sync_equipment_onboarding_status(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
