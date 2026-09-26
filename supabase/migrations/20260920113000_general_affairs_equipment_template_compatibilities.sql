DO $$ BEGIN
  IF to_regclass('public.ga_equipment_templates') IS NULL
    OR to_regclass('public.ga_part_target_compatibilities') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisites for equipment template compatibilities';
  END IF;
END $$;

ALTER TABLE public.ga_part_target_compatibilities
DROP CONSTRAINT IF EXISTS ga_part_target_compatibilities_target_type_check;

ALTER TABLE public.ga_part_target_compatibilities
ADD CONSTRAINT ga_part_target_compatibilities_target_type_check
CHECK (target_type IN ('EQUIPMENT', 'EQUIPMENT_TEMPLATE', 'FACILITY', 'FACILITY_TEMPLATE'));

CREATE OR REPLACE FUNCTION public.ga_validate_part_target_compatibility()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.target_type = 'EQUIPMENT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.ga_equipment WHERE id = NEW.target_id AND deleted_at IS NULL) THEN RAISE EXCEPTION '相容性設備不存在或已刪除'; END IF;
  ELSIF NEW.target_type = 'EQUIPMENT_TEMPLATE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.ga_equipment_templates WHERE id = NEW.target_id AND deleted_at IS NULL AND is_active) THEN RAISE EXCEPTION '相容性設備型號不存在、已刪除或未啟用'; END IF;
  ELSIF NEW.target_type = 'FACILITY' THEN
    IF NOT EXISTS (SELECT 1 FROM public.ga_facilities WHERE id = NEW.target_id AND deleted_at IS NULL) THEN RAISE EXCEPTION '相容性設施不存在或已刪除'; END IF;
  ELSIF NEW.target_type = 'FACILITY_TEMPLATE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.ga_facility_templates WHERE id = NEW.target_id AND deleted_at IS NULL AND is_active) THEN RAISE EXCEPTION '相容性架型不存在、已刪除或未啟用'; END IF;
  ELSE
    RAISE EXCEPTION '相容性對象類型錯誤';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ga_parts WHERE id = NEW.part_id AND deleted_at IS NULL AND is_active) THEN RAISE EXCEPTION '相容料件不存在、已刪除或未啟用'; END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
