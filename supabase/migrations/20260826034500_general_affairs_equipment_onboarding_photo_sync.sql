-- Keep equipment setup / QR label progress aligned with equipment photo attachments.

DO $$
BEGIN
  IF to_regclass('public.ga_equipment') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.ga_equipment';
  END IF;

  IF to_regclass('public.ga_resource_attachments') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.ga_resource_attachments';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ga_equipment'
      AND column_name = 'onboarding_status'
  ) THEN
    RAISE EXCEPTION 'Missing prerequisite column: public.ga_equipment.onboarding_status';
  END IF;
END $$;

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
  v_has_equipment_photo BOOLEAN;
  v_has_label_photo BOOLEAN;
BEGIN
  SELECT onboarding_status
  INTO v_current_status
  FROM public.ga_equipment
  WHERE id = p_equipment_id
    AND deleted_at IS NULL;

  IF v_current_status IS NULL THEN
    RETURN NULL;
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

  IF v_current_status = 'COMPLETED' THEN
    RETURN 'COMPLETED';
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

CREATE OR REPLACE FUNCTION public.ga_resource_attachment_sync_equipment_onboarding()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_resource_type TEXT;
  v_resource_id UUID;
  v_purpose TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_resource_type := OLD.resource_type;
    v_resource_id := OLD.resource_id;
    v_purpose := OLD.purpose;
  ELSE
    v_resource_type := NEW.resource_type;
    v_resource_id := NEW.resource_id;
    v_purpose := NEW.purpose;
  END IF;

  IF v_resource_type = 'EQUIPMENT'
    AND v_purpose IN ('PRIMARY_IMAGE', 'LABEL_POSITION_IMAGE') THEN
    PERFORM public.ga_sync_equipment_onboarding_status(v_resource_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_ga_resource_attachments_equipment_onboarding_sync
ON public.ga_resource_attachments;

CREATE TRIGGER trg_ga_resource_attachments_equipment_onboarding_sync
AFTER INSERT OR UPDATE OF resource_type, resource_id, purpose, content_type, deleted_at OR DELETE
ON public.ga_resource_attachments
FOR EACH ROW
EXECUTE FUNCTION public.ga_resource_attachment_sync_equipment_onboarding();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.ga_equipment'::regclass
      AND tgname = 'trg_ga_equipment_before_write'
      AND NOT tgisinternal
  ) THEN
    ALTER TABLE public.ga_equipment DISABLE TRIGGER trg_ga_equipment_before_write;
  END IF;
END $$;

UPDATE public.ga_equipment equipment
SET onboarding_status = public.ga_calculate_equipment_onboarding_status(equipment.id)
WHERE equipment.deleted_at IS NULL
  AND public.ga_calculate_equipment_onboarding_status(equipment.id) IS NOT NULL
  AND equipment.onboarding_status IS DISTINCT FROM public.ga_calculate_equipment_onboarding_status(equipment.id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.ga_equipment'::regclass
      AND tgname = 'trg_ga_equipment_before_write'
      AND NOT tgisinternal
  ) THEN
    ALTER TABLE public.ga_equipment ENABLE TRIGGER trg_ga_equipment_before_write;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.ga_calculate_equipment_onboarding_status(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_sync_equipment_onboarding_status(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ga_resource_attachment_sync_equipment_onboarding() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.ga_calculate_equipment_onboarding_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_sync_equipment_onboarding_status(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
