-- ============================================================
-- General Affairs Equipment Asset Code Sequence
--
-- Scope:
--   - Backend-generated equipment asset_code sequence.
--   - Uses level-2 equipment category code + purchase date + 3-digit sequence.
--   - Keeps already-applied Task 1B-1 migration immutable.
--
-- Not in scope:
--   - Facility asset code generation.
--   - Label printing.
--   - API/RLS contract changes.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.ga_equipment') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.ga_equipment';
  END IF;

  IF to_regclass('public.ga_equipment_categories') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.ga_equipment_categories';
  END IF;

  IF to_regprocedure('public.ga_validate_equipment()') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.ga_validate_equipment()';
  END IF;

  IF to_regprocedure('public.ga_category_has_active_path(public.ga_category_kind, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.ga_category_has_active_path(public.ga_category_kind, uuid)';
  END IF;

  IF to_regprocedure('public.ga_normalize_optional_text(text)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite: public.ga_normalize_optional_text(text)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.ga_asset_code_sequences (
  resource_type TEXT NOT NULL,
  level2_category_code TEXT NOT NULL,
  purchase_date DATE NOT NULL,
  last_value INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (resource_type, level2_category_code, purchase_date),
  CONSTRAINT ga_asset_code_sequences_resource_type_check
    CHECK (resource_type IN ('EQUIPMENT')),
  CONSTRAINT ga_asset_code_sequences_level2_code_check
    CHECK (level2_category_code ~ '^[A-Z]{2}[0-9]{2}$'),
  CONSTRAINT ga_asset_code_sequences_last_value_check
    CHECK (last_value BETWEEN 0 AND 999)
);

ALTER TABLE public.ga_asset_code_sequences OWNER TO postgres;

REVOKE ALL ON TABLE public.ga_asset_code_sequences FROM PUBLIC;
REVOKE ALL ON TABLE public.ga_asset_code_sequences FROM anon;
REVOKE ALL ON TABLE public.ga_asset_code_sequences FROM authenticated;

CREATE OR REPLACE FUNCTION public.ga_equipment_level2_category_code(p_category_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_level2_code TEXT;
BEGIN
  IF p_category_id IS NULL THEN
    RAISE EXCEPTION '請選擇設備分類';
  END IF;

  IF NOT ga_category_has_active_path('equipment', p_category_id) THEN
    RAISE EXCEPTION '設備分類必須啟用、未刪除且祖先路徑有效';
  END IF;

  WITH RECURSIVE ancestors AS (
    SELECT id, parent_id, code
    FROM ga_equipment_categories
    WHERE id = p_category_id
      AND deleted_at IS NULL
      AND is_active = true

    UNION ALL

    SELECT parent.id, parent.parent_id, parent.code
    FROM ga_equipment_categories parent
    JOIN ancestors child ON child.parent_id = parent.id
    WHERE parent.deleted_at IS NULL
      AND parent.is_active = true
  )
  SELECT upper(btrim(child.code))
  INTO v_level2_code
  FROM ancestors child
  JOIN ga_equipment_categories parent ON parent.id = child.parent_id
  WHERE parent.parent_id IS NULL
  LIMIT 1;

  IF v_level2_code IS NULL THEN
    RAISE EXCEPTION '資產編號需選擇第二層分類或其下層分類';
  END IF;

  IF v_level2_code !~ '^[A-Z]{2}[0-9]{2}$' THEN
    RAISE EXCEPTION '第二層分類代碼必須為 4 碼，例如 IC01';
  END IF;

  RETURN v_level2_code;
END;
$$;

ALTER FUNCTION public.ga_equipment_level2_category_code(UUID) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.ga_equipment_level2_category_code(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_equipment_level2_category_code(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.ga_equipment_level2_category_code(UUID) FROM authenticated;

CREATE OR REPLACE FUNCTION public.ga_next_equipment_asset_code(
  p_category_id UUID,
  p_purchased_at DATE
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
VOLATILE
AS $$
DECLARE
  v_level2_code TEXT;
  v_prefix TEXT;
  v_existing_max INTEGER := 0;
  v_next_value INTEGER;
BEGIN
  IF p_purchased_at IS NULL THEN
    RAISE EXCEPTION '產生資產編號需填寫購置日期';
  END IF;

  v_level2_code := ga_equipment_level2_category_code(p_category_id);
  v_prefix := v_level2_code || to_char(p_purchased_at, 'YYYYMMDD');

  SELECT COALESCE(MAX(substring(asset_code from 13 for 3)::INTEGER), 0)
  INTO v_existing_max
  FROM ga_equipment
  WHERE deleted_at IS NULL
    AND asset_code ~ ('^' || v_prefix || '[0-9]{3}$');

  INSERT INTO ga_asset_code_sequences (
    resource_type,
    level2_category_code,
    purchase_date,
    last_value
  )
  VALUES (
    'EQUIPMENT',
    v_level2_code,
    p_purchased_at,
    v_existing_max + 1
  )
  ON CONFLICT (resource_type, level2_category_code, purchase_date)
  DO UPDATE SET
    last_value = GREATEST(ga_asset_code_sequences.last_value + 1, v_existing_max + 1),
    updated_at = NOW()
  RETURNING last_value INTO v_next_value;

  IF v_next_value > 999 THEN
    RAISE EXCEPTION '同一分類與購置日期的資產編號流水已達上限 999';
  END IF;

  RETURN v_prefix || lpad(v_next_value::TEXT, 3, '0');
END;
$$;

ALTER FUNCTION public.ga_next_equipment_asset_code(UUID, DATE) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.ga_next_equipment_asset_code(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_next_equipment_asset_code(UUID, DATE) FROM anon;
REVOKE ALL ON FUNCTION public.ga_next_equipment_asset_code(UUID, DATE) FROM authenticated;

CREATE OR REPLACE FUNCTION public.ga_validate_equipment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_category ga_equipment_categories%ROWTYPE;
  v_template RECORD;
  v_template_changed BOOLEAN := false;
BEGIN
  NEW.name := btrim(NEW.name);
  NEW.asset_code := ga_normalize_optional_text(NEW.asset_code);
  NEW.barcode := ga_normalize_optional_text(NEW.barcode);
  NEW.brand := ga_normalize_optional_text(NEW.brand);
  NEW.model := ga_normalize_optional_text(NEW.model);
  NEW.serial_number := ga_normalize_optional_text(NEW.serial_number);
  NEW.area := ga_normalize_optional_text(NEW.area);
  NEW.location_detail := ga_normalize_optional_text(NEW.location_detail);
  NEW.purpose := ga_normalize_optional_text(NEW.purpose);
  NEW.notes := ga_normalize_optional_text(NEW.notes);
  NEW.image_path := ga_normalize_optional_text(NEW.image_path);
  NEW.deletion_reason := ga_normalize_optional_text(NEW.deletion_reason);

  IF NEW.name IS NULL OR NEW.name = '' THEN
    RAISE EXCEPTION '請輸入設備名稱';
  END IF;

  IF NOT ga_is_store_active(NEW.store_id) THEN
    RAISE EXCEPTION '設備所屬門市必須存在且啟用';
  END IF;

  SELECT *
  INTO v_category
  FROM ga_equipment_categories
  WHERE id = NEW.category_id
    AND deleted_at IS NULL
    AND is_active = true;

  IF NOT FOUND OR NOT ga_category_has_active_path('equipment', NEW.category_id) THEN
    RAISE EXCEPTION '設備分類必須啟用、未刪除且祖先路徑有效';
  END IF;

  IF NEW.template_id IS NOT NULL THEN
    SELECT id, category_id, is_active, deleted_at
    INTO v_template
    FROM ga_equipment_templates
    WHERE id = NEW.template_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '設備範本不存在';
    END IF;

    IF v_template.category_id IS DISTINCT FROM NEW.category_id THEN
      RAISE EXCEPTION '設備範本分類必須與設備分類一致';
    END IF;

    v_template_changed := TG_OP = 'INSERT' OR NEW.template_id IS DISTINCT FROM OLD.template_id;
    IF v_template_changed AND (v_template.deleted_at IS NOT NULL OR v_template.is_active = false) THEN
      RAISE EXCEPTION '新增或更換設備範本時，範本必須啟用且未刪除';
    END IF;
  END IF;

  IF v_category.requires_brand AND NEW.brand IS NULL THEN
    RAISE EXCEPTION '此設備分類要求填寫品牌';
  END IF;

  IF v_category.requires_model AND NEW.model IS NULL THEN
    RAISE EXCEPTION '此設備分類要求填寫型號';
  END IF;

  IF v_category.requires_serial_number AND NEW.serial_number IS NULL THEN
    RAISE EXCEPTION '此設備分類要求填寫序號';
  END IF;

  IF NEW.purchase_amount IS NOT NULL AND NEW.purchase_amount < 0 THEN
    RAISE EXCEPTION '購買金額不可為負數';
  END IF;

  IF jsonb_typeof(NEW.specs) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '設備 specs 必須是 JSON object';
  END IF;

  IF NEW.has_warranty = false AND NEW.warranty_end_date IS NOT NULL THEN
    RAISE EXCEPTION '無保固時 warranty_end_date 必須為 NULL';
  END IF;

  IF NEW.image_path IS NOT NULL AND (
    NEW.image_path ~* '^[a-z][a-z0-9+.-]*:'
    OR NEW.image_path ~ E'\\\\'
    OR NEW.image_path ~ '(^|/)\.\.(/|$)'
    OR NEW.image_path ~ '^/'
  ) THEN
    RAISE EXCEPTION '設備 image_path 僅可保存安全的相對 Storage Path';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.asset_code IS NULL AND NEW.purchased_at IS NOT NULL THEN
    NEW.asset_code := ga_next_equipment_asset_code(NEW.category_id, NEW.purchased_at);
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.updated_by := auth.uid();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := NOW();
    NEW.updated_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.ga_validate_equipment() OWNER TO postgres;
