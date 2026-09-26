-- ============================================================
-- General Affairs Part Master - Task 1B-3
--
-- Included:
--   ga_parts, ga_part_compatibilities, part permissions,
--   constraints, indexes, validation triggers, soft delete RPC, RLS.
--
-- Not included:
--   inventory locations, inventory balances, inventory transactions,
--   purchasing, transfers, issue flow, work order part relations,
--   attachments, vendor master, homepage KPI, Task 1C.
-- ============================================================

-- 0. Prerequisite checks
DO $$
DECLARE
  v_missing TEXT[];
BEGIN
  SELECT array_remove(ARRAY[
    CASE WHEN to_regclass('public.permissions') IS NULL THEN 'table public.permissions' END,
    CASE WHEN to_regclass('public.profiles') IS NULL THEN 'table public.profiles' END,
    CASE WHEN to_regclass('public.store_managers') IS NULL THEN 'table public.store_managers' END,
    CASE WHEN to_regclass('public.ga_part_categories') IS NULL THEN 'table public.ga_part_categories' END,
    CASE WHEN to_regclass('public.ga_equipment_templates') IS NULL THEN 'table public.ga_equipment_templates from Task 1B-1' END,
    CASE WHEN to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN 'function public.current_user_has_permission(varchar)' END,
    CASE WHEN to_regprocedure('public.ga_category_has_active_path(public.ga_category_kind, uuid)') IS NULL THEN 'function public.ga_category_has_active_path(ga_category_kind, uuid)' END,
    CASE WHEN to_regprocedure('public.ga_normalize_optional_text(text)') IS NULL THEN 'function public.ga_normalize_optional_text(text) from Task 1B-1' END
  ], NULL)
  INTO v_missing;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Task 1B-3 part migration prerequisites missing: %', array_to_string(v_missing, ', ');
  END IF;
END $$;

-- 1. Permissions
INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('general_affairs', 'part', 'general_affairs.part.view', 'view', '查看總務料件主檔'),
  ('general_affairs', 'part', 'general_affairs.part.manage', 'manage', '管理總務料件主檔')
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = true;

-- 2. Tables
CREATE TABLE IF NOT EXISTS ga_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES ga_part_categories(id),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  part_code TEXT,
  barcode TEXT,
  brand TEXT,
  model TEXT,
  specification TEXT,
  description TEXT,
  base_unit TEXT NOT NULL CHECK (btrim(base_unit) <> ''),
  purchase_unit TEXT,
  purchase_to_base_rate NUMERIC(12,4),
  minimum_issue_qty NUMERIC(12,4) NOT NULL DEFAULT 1,
  allow_fractional_issue BOOLEAN NOT NULL DEFAULT false,
  allow_unpacking BOOLEAN NOT NULL DEFAULT false,
  image_path TEXT,
  specs JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deletion_reason TEXT,
  CONSTRAINT ga_parts_specs_object
    CHECK (jsonb_typeof(specs) = 'object'),
  CONSTRAINT ga_parts_purchase_unit_rate_pair
    CHECK (
      (purchase_unit IS NULL AND purchase_to_base_rate IS NULL)
      OR (purchase_unit IS NOT NULL AND btrim(purchase_unit) <> '' AND purchase_to_base_rate > 0)
    ),
  CONSTRAINT ga_parts_minimum_issue_qty_positive
    CHECK (minimum_issue_qty > 0),
  CONSTRAINT ga_parts_minimum_issue_qty_integer_when_required
    CHECK (allow_fractional_issue = true OR trunc(minimum_issue_qty) = minimum_issue_qty),
  CONSTRAINT ga_parts_image_path_relative
    CHECK (
      image_path IS NULL OR (
        image_path = btrim(image_path)
        AND image_path !~* '^[a-z][a-z0-9+.-]*:'
        AND image_path !~ E'\\\\'
        AND image_path !~ '(^|/)\.\.(/|$)'
        AND image_path !~ '^/'
      )
    )
);

CREATE TABLE IF NOT EXISTS ga_part_compatibilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  part_id UUID NOT NULL REFERENCES ga_parts(id),
  compatibility_type TEXT NOT NULL,
  equipment_template_id UUID REFERENCES ga_equipment_templates(id),
  vendor_name TEXT,
  series_name TEXT,
  brand TEXT,
  model TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deletion_reason TEXT,
  CONSTRAINT ga_part_compatibilities_type_check
    CHECK (compatibility_type IN ('EQUIPMENT_TEMPLATE', 'VENDOR_SERIES', 'BRAND_MODEL'))
);

-- 3. Indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_parts_part_code_active
ON ga_parts (upper(btrim(part_code)))
WHERE deleted_at IS NULL AND part_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_parts_barcode_active
ON ga_parts (btrim(barcode))
WHERE deleted_at IS NULL AND barcode IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ga_parts_category
ON ga_parts(category_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_parts_active
ON ga_parts(is_active, deleted_at, name);

CREATE INDEX IF NOT EXISTS idx_ga_parts_brand
ON ga_parts(upper(COALESCE(brand, '')))
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_parts_search
ON ga_parts(
  upper(name),
  upper(COALESCE(part_code, '')),
  upper(COALESCE(barcode, '')),
  upper(COALESCE(brand, '')),
  upper(COALESCE(model, '')),
  upper(COALESCE(specification, ''))
)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_parts_duplicate_hint
ON ga_parts(
  upper(COALESCE(brand, '')),
  upper(COALESCE(model, '')),
  upper(COALESCE(specification, ''))
)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_part_compat_template_active
ON ga_part_compatibilities(part_id, equipment_template_id)
WHERE deleted_at IS NULL AND compatibility_type = 'EQUIPMENT_TEMPLATE';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_part_compat_vendor_series_active
ON ga_part_compatibilities(
  part_id,
  upper(btrim(vendor_name)),
  upper(btrim(COALESCE(series_name, '')))
)
WHERE deleted_at IS NULL AND compatibility_type = 'VENDOR_SERIES';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_part_compat_brand_model_active
ON ga_part_compatibilities(
  part_id,
  upper(btrim(brand)),
  upper(btrim(COALESCE(model, '')))
)
WHERE deleted_at IS NULL AND compatibility_type = 'BRAND_MODEL';

CREATE INDEX IF NOT EXISTS idx_ga_part_compatibilities_part
ON ga_part_compatibilities(part_id)
WHERE deleted_at IS NULL;

-- 4. Helper functions / triggers
CREATE OR REPLACE FUNCTION current_user_is_store_manager()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM store_managers sm
    WHERE sm.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION ga_is_active_part_category(p_category_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM ga_part_categories c
    WHERE c.id = p_category_id
      AND c.deleted_at IS NULL
      AND c.is_active = true
      AND ga_category_has_active_path('part', c.id)
  );
$$;

CREATE OR REPLACE FUNCTION ga_part_is_visible(p_part_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM ga_parts p
    WHERE p.id = p_part_id
      AND p.deleted_at IS NULL
      AND (
        (
          p.is_active = true
          AND (
            current_user_has_permission('general_affairs.part.view')
            OR current_user_has_permission('general_affairs.part.manage')
            OR current_user_is_store_manager()
          )
        )
        OR current_user_has_permission('general_affairs.part.manage')
      )
  );
$$;

CREATE OR REPLACE FUNCTION ga_validate_part()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_soft_delete BOOLEAN := COALESCE(current_setting('app.ga_soft_delete_part', true), '') = 'true';
BEGIN
  NEW.name := btrim(NEW.name);
  NEW.part_code := upper(ga_normalize_optional_text(NEW.part_code));
  NEW.barcode := ga_normalize_optional_text(NEW.barcode);
  NEW.brand := ga_normalize_optional_text(NEW.brand);
  NEW.model := ga_normalize_optional_text(NEW.model);
  NEW.specification := ga_normalize_optional_text(NEW.specification);
  NEW.description := ga_normalize_optional_text(NEW.description);
  NEW.base_unit := btrim(NEW.base_unit);
  NEW.purchase_unit := ga_normalize_optional_text(NEW.purchase_unit);
  NEW.image_path := ga_normalize_optional_text(NEW.image_path);
  NEW.notes := ga_normalize_optional_text(NEW.notes);

  IF NEW.name IS NULL OR NEW.name = '' THEN
    RAISE EXCEPTION '請輸入料件名稱';
  END IF;

  IF NEW.base_unit IS NULL OR NEW.base_unit = '' THEN
    RAISE EXCEPTION '請輸入基本庫存單位';
  END IF;

  IF NOT ga_is_active_part_category(NEW.category_id) THEN
    RAISE EXCEPTION '料件分類必須啟用、未刪除且祖先路徑有效';
  END IF;

  IF jsonb_typeof(NEW.specs) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '料件 specs 必須是 JSON object';
  END IF;

  IF NEW.purchase_unit IS NULL AND NEW.purchase_to_base_rate IS NOT NULL THEN
    RAISE EXCEPTION '未填採購單位時，purchase_to_base_rate 必須為 NULL';
  END IF;

  IF NEW.purchase_unit IS NOT NULL THEN
    IF upper(NEW.purchase_unit) = upper(NEW.base_unit) THEN
      NEW.purchase_to_base_rate := 1;
    ELSIF NEW.purchase_to_base_rate IS NULL OR NEW.purchase_to_base_rate <= 0 THEN
      RAISE EXCEPTION '填寫採購單位時，purchase_to_base_rate 必須大於 0';
    END IF;
  END IF;

  IF NEW.minimum_issue_qty <= 0 THEN
    RAISE EXCEPTION '最小領用量必須大於 0';
  END IF;

  IF NEW.allow_fractional_issue = false AND trunc(NEW.minimum_issue_qty) <> NEW.minimum_issue_qty THEN
    RAISE EXCEPTION '不允許小數領用時，最小領用量必須為整數';
  END IF;

  IF NEW.image_path IS NOT NULL AND (
    NEW.image_path ~* '^[a-z][a-z0-9+.-]*:'
    OR NEW.image_path ~ E'\\\\'
    OR NEW.image_path ~ '(^|/)\.\.(/|$)'
    OR NEW.image_path ~ '^/'
  ) THEN
    RAISE EXCEPTION '料件 image_path 僅可保存安全的相對 Storage Path';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := NOW();
    NEW.created_by := auth.uid();
    NEW.updated_at := NOW();
    NEW.updated_by := auth.uid();
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
    NEW.deletion_reason := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := NOW();
    NEW.updated_by := auth.uid();

    IF v_is_soft_delete THEN
      IF OLD.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION '此料件已被刪除';
      END IF;
      IF NEW.deleted_at IS NULL OR NEW.deleted_by IS NULL OR NEW.deletion_reason IS NULL THEN
        RAISE EXCEPTION 'soft delete 必須設定 deleted_at、deleted_by 與 deletion_reason';
      END IF;
      NEW.is_active := false;
    ELSIF OLD.deleted_at IS NULL THEN
      NEW.deleted_at := NULL;
      NEW.deleted_by := NULL;
      NEW.deletion_reason := NULL;
    ELSE
      NEW.deleted_at := OLD.deleted_at;
      NEW.deleted_by := OLD.deleted_by;
      NEW.deletion_reason := OLD.deletion_reason;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ga_validate_part_compatibility()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_soft_delete BOOLEAN := COALESCE(current_setting('app.ga_soft_delete_part_compatibility', true), '') = 'true';
  v_template RECORD;
  v_template_changed BOOLEAN := false;
BEGIN
  NEW.compatibility_type := upper(btrim(NEW.compatibility_type));
  NEW.vendor_name := ga_normalize_optional_text(NEW.vendor_name);
  NEW.series_name := ga_normalize_optional_text(NEW.series_name);
  NEW.brand := ga_normalize_optional_text(NEW.brand);
  NEW.model := ga_normalize_optional_text(NEW.model);
  NEW.notes := ga_normalize_optional_text(NEW.notes);

  IF NOT EXISTS (
    SELECT 1
    FROM ga_parts p
    WHERE p.id = NEW.part_id
      AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION '相容性所屬料件必須存在且未刪除';
  END IF;

  IF NEW.compatibility_type = 'EQUIPMENT_TEMPLATE' THEN
    IF NEW.equipment_template_id IS NULL THEN
      RAISE EXCEPTION '設備範本相容性必須選擇設備範本';
    END IF;
    IF NEW.vendor_name IS NOT NULL OR NEW.series_name IS NOT NULL OR NEW.brand IS NOT NULL OR NEW.model IS NOT NULL THEN
      RAISE EXCEPTION '設備範本相容性不可填寫廠商、系列、品牌或型號欄位';
    END IF;

    SELECT id, is_active, deleted_at
    INTO v_template
    FROM ga_equipment_templates
    WHERE id = NEW.equipment_template_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '相容設備範本不存在';
    END IF;

    v_template_changed := TG_OP = 'INSERT' OR NEW.equipment_template_id IS DISTINCT FROM OLD.equipment_template_id;
    IF v_template_changed AND (v_template.deleted_at IS NOT NULL OR v_template.is_active = false) THEN
      RAISE EXCEPTION '新增或更換相容設備範本時，範本必須啟用且未刪除';
    END IF;
  ELSIF NEW.compatibility_type = 'VENDOR_SERIES' THEN
    IF NEW.vendor_name IS NULL THEN
      RAISE EXCEPTION '廠商系列相容性必須填寫廠商名稱';
    END IF;
    IF NEW.equipment_template_id IS NOT NULL OR NEW.brand IS NOT NULL OR NEW.model IS NOT NULL THEN
      RAISE EXCEPTION '廠商系列相容性不可填寫設備範本、品牌或型號欄位';
    END IF;
  ELSIF NEW.compatibility_type = 'BRAND_MODEL' THEN
    IF NEW.brand IS NULL THEN
      RAISE EXCEPTION '品牌型號相容性必須填寫品牌';
    END IF;
    IF NEW.equipment_template_id IS NOT NULL OR NEW.vendor_name IS NOT NULL OR NEW.series_name IS NOT NULL THEN
      RAISE EXCEPTION '品牌型號相容性不可填寫設備範本、廠商或系列欄位';
    END IF;
  ELSE
    RAISE EXCEPTION '相容性類型錯誤';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := NOW();
    NEW.created_by := auth.uid();
    NEW.updated_at := NOW();
    NEW.updated_by := auth.uid();
    NEW.deleted_at := NULL;
    NEW.deleted_by := NULL;
    NEW.deletion_reason := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
    NEW.created_by := OLD.created_by;
    NEW.updated_at := NOW();
    NEW.updated_by := auth.uid();

    IF v_is_soft_delete THEN
      IF OLD.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION '此相容性資料已被刪除';
      END IF;
      IF NEW.deleted_at IS NULL OR NEW.deleted_by IS NULL OR NEW.deletion_reason IS NULL THEN
        RAISE EXCEPTION 'soft delete 必須設定 deleted_at、deleted_by 與 deletion_reason';
      END IF;
    ELSIF OLD.deleted_at IS NULL THEN
      NEW.deleted_at := NULL;
      NEW.deleted_by := NULL;
      NEW.deletion_reason := NULL;
    ELSE
      NEW.deleted_at := OLD.deleted_at;
      NEW.deleted_by := OLD.deleted_by;
      NEW.deletion_reason := OLD.deletion_reason;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ga_parts_before_write ON ga_parts;
CREATE TRIGGER trg_ga_parts_before_write
  BEFORE INSERT OR UPDATE ON ga_parts
  FOR EACH ROW EXECUTE FUNCTION ga_validate_part();

DROP TRIGGER IF EXISTS trg_ga_part_compatibilities_before_write ON ga_part_compatibilities;
CREATE TRIGGER trg_ga_part_compatibilities_before_write
  BEFORE INSERT OR UPDATE ON ga_part_compatibilities
  FOR EACH ROW EXECUTE FUNCTION ga_validate_part_compatibility();

CREATE OR REPLACE FUNCTION ga_soft_delete_part(
  p_part_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT := ga_normalize_optional_text(p_reason);
  v_deleted_at TIMESTAMPTZ := NOW();
  v_updated_count INTEGER := 0;
  v_child_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入');
  END IF;

  IF NOT current_user_has_permission('general_affairs.part.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有料件管理權限');
  END IF;

  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入刪除原因');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM ga_parts WHERE id = p_part_id) THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到料件');
  END IF;

  IF EXISTS (SELECT 1 FROM ga_parts WHERE id = p_part_id AND deleted_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '此料件已被刪除');
  END IF;

  PERFORM set_config('app.ga_soft_delete_part_compatibility', 'true', true);
  UPDATE ga_part_compatibilities
  SET
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = '父料件刪除衍生：' || v_reason,
    updated_by = v_user_id
  WHERE part_id = p_part_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_child_count = ROW_COUNT;

  PERFORM set_config('app.ga_soft_delete_part', 'true', true);
  UPDATE ga_parts
  SET
    is_active = false,
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = v_reason,
    updated_by = v_user_id
  WHERE id = p_part_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RAISE EXCEPTION '料件 soft delete 失敗，交易已中止';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'data', jsonb_build_object(
      'id', p_part_id,
      'is_active', false,
      'deleted_at', v_deleted_at,
      'deleted_by', v_user_id,
      'deletion_reason', v_reason,
      'deleted_compatibilities', v_child_count
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION ga_soft_delete_part_compatibility(
  p_compatibility_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT := ga_normalize_optional_text(p_reason);
  v_deleted_at TIMESTAMPTZ := NOW();
  v_updated_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入');
  END IF;

  IF NOT current_user_has_permission('general_affairs.part.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有料件管理權限');
  END IF;

  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入刪除原因');
  END IF;

  PERFORM set_config('app.ga_soft_delete_part_compatibility', 'true', true);

  UPDATE ga_part_compatibilities
  SET
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = v_reason,
    updated_by = v_user_id
  WHERE id = p_compatibility_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    IF EXISTS (SELECT 1 FROM ga_part_compatibilities WHERE id = p_compatibility_id AND deleted_at IS NOT NULL) THEN
      RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '此相容性資料已被刪除');
    END IF;
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到相容性資料');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'data', jsonb_build_object(
      'id', p_compatibility_id,
      'deleted_at', v_deleted_at,
      'deleted_by', v_user_id,
      'deletion_reason', v_reason
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION current_user_is_store_manager() FROM PUBLIC;
REVOKE ALL ON FUNCTION ga_soft_delete_part(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION ga_soft_delete_part_compatibility(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_user_is_store_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION ga_soft_delete_part(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION ga_soft_delete_part_compatibility(UUID, TEXT) TO authenticated;

-- 5. RLS
ALTER TABLE ga_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ga_part_compatibilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ga_parts_general_read" ON ga_parts;
CREATE POLICY "ga_parts_general_read" ON ga_parts
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND is_active = true
    AND (
      current_user_has_permission('general_affairs.part.view')
      OR current_user_has_permission('general_affairs.part.manage')
      OR current_user_is_store_manager()
    )
  );

DROP POLICY IF EXISTS "ga_parts_manage_read" ON ga_parts;
CREATE POLICY "ga_parts_manage_read" ON ga_parts
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND current_user_has_permission('general_affairs.part.manage')
  );

DROP POLICY IF EXISTS "ga_parts_insert" ON ga_parts;
CREATE POLICY "ga_parts_insert" ON ga_parts
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_has_permission('general_affairs.part.manage')
  );

DROP POLICY IF EXISTS "ga_parts_update" ON ga_parts;
CREATE POLICY "ga_parts_update" ON ga_parts
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND current_user_has_permission('general_affairs.part.manage')
  )
  WITH CHECK (
    current_user_has_permission('general_affairs.part.manage')
  );

DROP POLICY IF EXISTS "ga_part_compatibilities_read_via_part" ON ga_part_compatibilities;
CREATE POLICY "ga_part_compatibilities_read_via_part" ON ga_part_compatibilities
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND ga_part_is_visible(part_id)
  );

DROP POLICY IF EXISTS "ga_part_compatibilities_insert" ON ga_part_compatibilities;
CREATE POLICY "ga_part_compatibilities_insert" ON ga_part_compatibilities
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_has_permission('general_affairs.part.manage')
  );

DROP POLICY IF EXISTS "ga_part_compatibilities_update" ON ga_part_compatibilities;
CREATE POLICY "ga_part_compatibilities_update" ON ga_part_compatibilities
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND current_user_has_permission('general_affairs.part.manage')
  )
  WITH CHECK (
    current_user_has_permission('general_affairs.part.manage')
  );

-- 不建立 DELETE policy。料件與相容性刪除只能透過 soft delete RPC/API。
