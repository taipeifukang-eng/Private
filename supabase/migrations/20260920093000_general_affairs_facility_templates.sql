DO $$ BEGIN
  IF to_regclass('public.ga_facilities') IS NULL
    OR to_regclass('public.ga_part_target_compatibilities') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisites for general affairs facility templates';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ga_facility_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  category_id uuid REFERENCES public.ga_facility_categories(id) ON DELETE SET NULL,
  brand text,
  model text,
  width_cm numeric(10,2) CHECK (width_cm IS NULL OR width_cm > 0),
  height_cm numeric(10,2) CHECK (height_cm IS NULL OR height_cm > 0),
  depth_cm numeric(10,2) CHECK (depth_cm IS NULL OR depth_cm > 0),
  description text,
  specs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(specs) = 'object'),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deletion_reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_facility_templates_code_active
ON public.ga_facility_templates(upper(code)) WHERE deleted_at IS NULL;

ALTER TABLE public.ga_facilities
ADD COLUMN IF NOT EXISTS facility_template_id uuid REFERENCES public.ga_facility_templates(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ga_facilities_template ON public.ga_facilities(facility_template_id) WHERE deleted_at IS NULL;

ALTER TABLE public.ga_part_target_compatibilities
DROP CONSTRAINT IF EXISTS ga_part_target_compatibilities_target_type_check;
ALTER TABLE public.ga_part_target_compatibilities
ADD CONSTRAINT ga_part_target_compatibilities_target_type_check
CHECK (target_type IN ('EQUIPMENT', 'FACILITY', 'FACILITY_TEMPLATE'));

CREATE OR REPLACE FUNCTION public.ga_validate_part_target_compatibility()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.target_type := upper(btrim(NEW.target_type));
  NEW.updated_at := now();
  IF NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.target_type = 'EQUIPMENT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.ga_equipment WHERE id = NEW.target_id AND deleted_at IS NULL) THEN RAISE EXCEPTION '相容性設備不存在或已刪除'; END IF;
  ELSIF NEW.target_type = 'FACILITY' THEN
    IF NOT EXISTS (SELECT 1 FROM public.ga_facilities WHERE id = NEW.target_id AND deleted_at IS NULL) THEN RAISE EXCEPTION '相容性設施不存在或已刪除'; END IF;
  ELSIF NEW.target_type = 'FACILITY_TEMPLATE' THEN
    IF NOT EXISTS (SELECT 1 FROM public.ga_facility_templates WHERE id = NEW.target_id AND deleted_at IS NULL AND is_active) THEN RAISE EXCEPTION '相容性架型不存在、已刪除或未啟用'; END IF;
  ELSE
    RAISE EXCEPTION '相容性對象類型錯誤';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.ga_parts WHERE id = NEW.part_id AND deleted_at IS NULL AND is_active) THEN RAISE EXCEPTION '相容料件不存在、已刪除或未啟用'; END IF;
  RETURN NEW;
END; $$;

ALTER TABLE public.ga_facility_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ga_facility_templates_read ON public.ga_facility_templates;
CREATE POLICY ga_facility_templates_read ON public.ga_facility_templates FOR SELECT TO authenticated USING (
  deleted_at IS NULL AND (public.current_user_has_permission('general_affairs.facility.view') OR public.current_user_has_permission('general_affairs.facility.manage') OR public.current_user_has_permission('general_affairs.part.view') OR public.current_user_has_permission('general_affairs.part.manage'))
);
DROP POLICY IF EXISTS ga_facility_templates_manage ON public.ga_facility_templates;
CREATE POLICY ga_facility_templates_manage ON public.ga_facility_templates FOR ALL TO authenticated USING (
  public.current_user_has_permission('general_affairs.facility.manage')
) WITH CHECK (public.current_user_has_permission('general_affairs.facility.manage'));

GRANT SELECT, INSERT, UPDATE ON public.ga_facility_templates TO authenticated;
NOTIFY pgrst, 'reload schema';
