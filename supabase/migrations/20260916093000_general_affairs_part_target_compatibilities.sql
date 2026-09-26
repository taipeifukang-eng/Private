-- General Affairs part target compatibility relationships.
-- Stores target-first relationships such as:
--   facility/equipment -> compatible parts

CREATE TABLE IF NOT EXISTS public.ga_part_target_compatibilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  part_id uuid NOT NULL REFERENCES public.ga_parts(id) ON DELETE RESTRICT,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deletion_reason text,
  CONSTRAINT ga_part_target_compatibilities_target_type_check
    CHECK (target_type IN ('EQUIPMENT', 'FACILITY'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_part_target_compat_active
ON public.ga_part_target_compatibilities(target_type, target_id, part_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_part_target_compat_target
ON public.ga_part_target_compatibilities(target_type, target_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_part_target_compat_part
ON public.ga_part_target_compatibilities(part_id)
WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.ga_validate_part_target_compatibility()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.target_type := upper(btrim(NEW.target_type));
  NEW.updated_at := now();

  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.target_type = 'EQUIPMENT' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.ga_equipment e
      WHERE e.id = NEW.target_id
        AND e.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION '相容性設備不存在或已刪除';
    END IF;
  ELSIF NEW.target_type = 'FACILITY' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.ga_facilities f
      WHERE f.id = NEW.target_id
        AND f.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION '相容性設施不存在或已刪除';
    END IF;
  ELSE
    RAISE EXCEPTION '相容性對象類型錯誤';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.ga_parts p
    WHERE p.id = NEW.part_id
      AND p.deleted_at IS NULL
      AND p.is_active = true
  ) THEN
    RAISE EXCEPTION '相容料件不存在、已刪除或未啟用';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ga_part_target_compatibilities_before_write
ON public.ga_part_target_compatibilities;

CREATE TRIGGER trg_ga_part_target_compatibilities_before_write
BEFORE INSERT OR UPDATE ON public.ga_part_target_compatibilities
FOR EACH ROW EXECUTE FUNCTION public.ga_validate_part_target_compatibility();

ALTER TABLE public.ga_part_target_compatibilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ga_part_target_compatibilities_read" ON public.ga_part_target_compatibilities;
CREATE POLICY "ga_part_target_compatibilities_read"
ON public.ga_part_target_compatibilities
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND (
    public.current_user_has_permission('general_affairs.part.view')
    OR public.current_user_has_permission('general_affairs.part.manage')
  )
);

DROP POLICY IF EXISTS "ga_part_target_compatibilities_insert" ON public.ga_part_target_compatibilities;
CREATE POLICY "ga_part_target_compatibilities_insert"
ON public.ga_part_target_compatibilities
FOR INSERT
TO authenticated
WITH CHECK (
  public.current_user_has_permission('general_affairs.part.manage')
);

DROP POLICY IF EXISTS "ga_part_target_compatibilities_update" ON public.ga_part_target_compatibilities;
CREATE POLICY "ga_part_target_compatibilities_update"
ON public.ga_part_target_compatibilities
FOR UPDATE
TO authenticated
USING (
  public.current_user_has_permission('general_affairs.part.manage')
)
WITH CHECK (
  public.current_user_has_permission('general_affairs.part.manage')
);

COMMENT ON TABLE public.ga_part_target_compatibilities IS 'Target-first compatibility links between equipment/facilities and compatible parts.';

NOTIFY pgrst, 'reload schema';
