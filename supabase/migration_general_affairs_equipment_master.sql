-- ============================================================
-- 總務服務中心 - Task 1B-1 設備範本與門市設備主檔
--
-- Scope:
--   1. ga_equipment_templates
--   2. ga_equipment
--   3. equipment template/equipment permissions
--   4. constraints, triggers, helper RPCs, RLS
--
-- Not included:
--   facilities, parts, inventory, attachments, warranty tables,
--   work order relations, resource_snapshot, homepage KPI.
-- ============================================================

-- 1. 權限碼：idempotent，不自動授權角色
INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('general_affairs', 'equipment_template', 'general_affairs.equipment_template.view', 'view', '可查看總務設備範本'),
  ('general_affairs', 'equipment_template', 'general_affairs.equipment_template.manage', 'manage', '可管理總務設備範本'),
  ('general_affairs', 'equipment', 'general_affairs.equipment.view', 'view', '可查看總務門市設備'),
  ('general_affairs', 'equipment', 'general_affairs.equipment.manage', 'manage', '可管理總務門市設備')
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = true;

-- 2. 資料表
CREATE TABLE IF NOT EXISTS ga_equipment_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES ga_equipment_categories(id),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  brand TEXT,
  model TEXT,
  description TEXT,
  specs JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  default_warranty_months INTEGER,
  image_path TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deletion_reason TEXT,
  CONSTRAINT ga_equipment_templates_specs_object
    CHECK (jsonb_typeof(specs) = 'object'),
  CONSTRAINT ga_equipment_templates_default_fields_object
    CHECK (jsonb_typeof(default_fields) = 'object'),
  CONSTRAINT ga_equipment_templates_warranty_months_nonnegative
    CHECK (default_warranty_months IS NULL OR default_warranty_months >= 0),
  CONSTRAINT ga_equipment_templates_image_path_relative
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

CREATE TABLE IF NOT EXISTS ga_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id),
  category_id UUID NOT NULL REFERENCES ga_equipment_categories(id),
  template_id UUID REFERENCES ga_equipment_templates(id),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  asset_code TEXT,
  barcode TEXT,
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  criticality TEXT NOT NULL DEFAULT 'NORMAL',
  area TEXT,
  location_detail TEXT,
  purpose TEXT,
  installed_at DATE,
  purchased_at DATE,
  activated_at DATE,
  purchase_amount NUMERIC(12,2),
  specs JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  notes TEXT,
  has_warranty BOOLEAN NOT NULL DEFAULT false,
  warranty_end_date DATE,
  image_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deletion_reason TEXT,
  CONSTRAINT ga_equipment_status_check
    CHECK (status IN ('ACTIVE', 'TEMPORARILY_STOPPED', 'SPARE', 'RETIRED', 'SCRAPPED')),
  CONSTRAINT ga_equipment_criticality_check
    CHECK (criticality IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  CONSTRAINT ga_equipment_specs_object
    CHECK (jsonb_typeof(specs) = 'object'),
  CONSTRAINT ga_equipment_purchase_amount_nonnegative
    CHECK (purchase_amount IS NULL OR purchase_amount >= 0),
  CONSTRAINT ga_equipment_warranty_date_rule
    CHECK (has_warranty = true OR warranty_end_date IS NULL),
  CONSTRAINT ga_equipment_image_path_relative
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

-- 3. Indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_equipment_templates_identity_active
ON ga_equipment_templates (
  category_id,
  upper(btrim(name)),
  upper(btrim(COALESCE(brand, ''))),
  upper(btrim(COALESCE(model, '')))
)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_equipment_templates_category
ON ga_equipment_templates(category_id);

CREATE INDEX IF NOT EXISTS idx_ga_equipment_templates_active
ON ga_equipment_templates(is_active, deleted_at, name);

CREATE INDEX IF NOT EXISTS idx_ga_equipment_templates_search
ON ga_equipment_templates(upper(name), upper(COALESCE(brand, '')), upper(COALESCE(model, '')));

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_equipment_asset_code_active
ON ga_equipment (upper(btrim(asset_code)))
WHERE deleted_at IS NULL AND asset_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_equipment_barcode_active
ON ga_equipment (upper(btrim(barcode)))
WHERE deleted_at IS NULL AND barcode IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ga_equipment_store
ON ga_equipment(store_id);

CREATE INDEX IF NOT EXISTS idx_ga_equipment_category
ON ga_equipment(category_id);

CREATE INDEX IF NOT EXISTS idx_ga_equipment_template
ON ga_equipment(template_id);

CREATE INDEX IF NOT EXISTS idx_ga_equipment_status
ON ga_equipment(status, deleted_at);

CREATE INDEX IF NOT EXISTS idx_ga_equipment_search
ON ga_equipment(
  upper(name),
  upper(COALESCE(brand, '')),
  upper(COALESCE(model, '')),
  upper(COALESCE(asset_code, '')),
  upper(COALESCE(barcode, '')),
  upper(COALESCE(serial_number, ''))
);

CREATE TABLE IF NOT EXISTS ga_asset_code_sequences (
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

REVOKE ALL ON TABLE ga_asset_code_sequences FROM PUBLIC;
REVOKE ALL ON TABLE ga_asset_code_sequences FROM anon;
REVOKE ALL ON TABLE ga_asset_code_sequences FROM authenticated;

-- 4. Helper functions / triggers
CREATE OR REPLACE FUNCTION ga_normalize_optional_text(p_value TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(btrim(p_value), '');
$$;

CREATE OR REPLACE FUNCTION ga_is_store_active(p_store_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM stores s
    WHERE s.id = p_store_id
      AND COALESCE(s.is_active, true) = true
      AND (to_jsonb(s) ->> 'deleted_at') IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION ga_is_active_equipment_category(p_category_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM ga_equipment_categories c
    WHERE c.id = p_category_id
      AND c.deleted_at IS NULL
      AND c.is_active = true
      AND ga_category_has_active_path('equipment', c.id)
  );
$$;

CREATE OR REPLACE FUNCTION ga_equipment_level2_category_code(p_category_id UUID)
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

REVOKE ALL ON FUNCTION ga_equipment_level2_category_code(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION ga_equipment_level2_category_code(UUID) FROM anon;
REVOKE ALL ON FUNCTION ga_equipment_level2_category_code(UUID) FROM authenticated;

CREATE OR REPLACE FUNCTION ga_next_equipment_asset_code(
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

REVOKE ALL ON FUNCTION ga_next_equipment_asset_code(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION ga_next_equipment_asset_code(UUID, DATE) FROM anon;
REVOKE ALL ON FUNCTION ga_next_equipment_asset_code(UUID, DATE) FROM authenticated;

CREATE OR REPLACE FUNCTION ga_validate_equipment_template()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.name := btrim(NEW.name);
  NEW.brand := ga_normalize_optional_text(NEW.brand);
  NEW.model := ga_normalize_optional_text(NEW.model);
  NEW.description := ga_normalize_optional_text(NEW.description);
  NEW.image_path := ga_normalize_optional_text(NEW.image_path);
  NEW.deletion_reason := ga_normalize_optional_text(NEW.deletion_reason);

  IF NEW.name IS NULL OR NEW.name = '' THEN
    RAISE EXCEPTION '請輸入設備範本名稱';
  END IF;

  IF NOT ga_is_active_equipment_category(NEW.category_id) THEN
    RAISE EXCEPTION '設備範本分類必須啟用、未刪除且祖先路徑有效';
  END IF;

  IF jsonb_typeof(NEW.specs) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '設備範本 specs 必須是 JSON object';
  END IF;

  IF jsonb_typeof(NEW.default_fields) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '設備範本 default_fields 必須是 JSON object';
  END IF;

  IF NEW.default_warranty_months IS NOT NULL AND NEW.default_warranty_months < 0 THEN
    RAISE EXCEPTION '設備範本預設保固月數不可為負數';
  END IF;

  IF NEW.image_path IS NOT NULL AND (
    NEW.image_path ~* '^[a-z][a-z0-9+.-]*:'
    OR NEW.image_path ~ E'\\\\'
    OR NEW.image_path ~ '(^|/)\.\.(/|$)'
    OR NEW.image_path ~ '^/'
  ) THEN
    RAISE EXCEPTION '設備範本 image_path 僅可保存安全的相對 Storage Path';
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

CREATE OR REPLACE FUNCTION ga_validate_equipment()
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

DROP TRIGGER IF EXISTS trg_ga_equipment_templates_before_write ON ga_equipment_templates;
CREATE TRIGGER trg_ga_equipment_templates_before_write
  BEFORE INSERT OR UPDATE ON ga_equipment_templates
  FOR EACH ROW EXECUTE FUNCTION ga_validate_equipment_template();

DROP TRIGGER IF EXISTS trg_ga_equipment_before_write ON ga_equipment;
CREATE TRIGGER trg_ga_equipment_before_write
  BEFORE INSERT OR UPDATE ON ga_equipment
  FOR EACH ROW EXECUTE FUNCTION ga_validate_equipment();

CREATE OR REPLACE FUNCTION ga_soft_delete_equipment_template(
  p_template_id UUID,
  p_deletion_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT := ga_normalize_optional_text(p_deletion_reason);
  v_deleted_at TIMESTAMPTZ := NOW();
  v_updated_count INTEGER := 0;
  v_related_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入');
  END IF;

  IF NOT current_user_has_permission('general_affairs.equipment_template.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有設備範本管理權限');
  END IF;

  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入刪除原因');
  END IF;

  SELECT count(*)::integer
  INTO v_related_count
  FROM ga_equipment
  WHERE template_id = p_template_id
    AND deleted_at IS NULL;

  UPDATE ga_equipment_templates
  SET
    is_active = false,
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = v_reason,
    updated_by = v_user_id
  WHERE id = p_template_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到可刪除的設備範本');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'data', jsonb_build_object(
      'id', p_template_id,
      'is_active', false,
      'deleted_at', v_deleted_at,
      'deleted_by', v_user_id,
      'deletion_reason', v_reason
    ),
    'warning', CASE
      WHEN v_related_count > 0 THEN jsonb_build_object(
        'code', 'TEMPLATE_HAS_EQUIPMENT_RELATIONS',
        'message', '此範本已有門市設備歷史關聯，系統會保留既有設備 template_id。',
        'related_equipment_count', v_related_count
      )
      ELSE NULL
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION ga_soft_delete_equipment(
  p_equipment_id UUID,
  p_deletion_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_reason TEXT := ga_normalize_optional_text(p_deletion_reason);
  v_deleted_at TIMESTAMPTZ := NOW();
  v_updated_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 401, 'error', '未登入');
  END IF;

  IF NOT current_user_has_permission('general_affairs.equipment.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有設備管理權限');
  END IF;

  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入刪除原因');
  END IF;

  UPDATE ga_equipment
  SET
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = v_reason,
    updated_by = v_user_id
  WHERE id = p_equipment_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到可刪除的設備');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'data', jsonb_build_object(
      'id', p_equipment_id,
      'deleted_at', v_deleted_at,
      'deleted_by', v_user_id,
      'deletion_reason', v_reason
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION ga_soft_delete_equipment_template(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION ga_soft_delete_equipment(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ga_soft_delete_equipment_template(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION ga_soft_delete_equipment(UUID, TEXT) TO authenticated;

-- 5. RLS
ALTER TABLE ga_equipment_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE ga_equipment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ga_equipment_templates_general_read" ON ga_equipment_templates;
CREATE POLICY "ga_equipment_templates_general_read" ON ga_equipment_templates
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND is_active = true
    AND ga_is_active_equipment_category(category_id)
    AND (
      current_user_has_permission('general_affairs.equipment_template.view')
      OR current_user_has_permission('general_affairs.equipment_template.manage')
    )
  );

DROP POLICY IF EXISTS "ga_equipment_templates_manage_read" ON ga_equipment_templates;
CREATE POLICY "ga_equipment_templates_manage_read" ON ga_equipment_templates
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND current_user_has_permission('general_affairs.equipment_template.manage')
  );

DROP POLICY IF EXISTS "ga_equipment_templates_insert" ON ga_equipment_templates;
CREATE POLICY "ga_equipment_templates_insert" ON ga_equipment_templates
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_has_permission('general_affairs.equipment_template.manage')
  );

DROP POLICY IF EXISTS "ga_equipment_templates_update" ON ga_equipment_templates;
CREATE POLICY "ga_equipment_templates_update" ON ga_equipment_templates
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND current_user_has_permission('general_affairs.equipment_template.manage')
  )
  WITH CHECK (
    current_user_has_permission('general_affairs.equipment_template.manage')
  );

DROP POLICY IF EXISTS "ga_equipment_scope_read" ON ga_equipment;
CREATE POLICY "ga_equipment_scope_read" ON ga_equipment
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      current_user_has_permission('general_affairs.equipment.view')
      OR current_user_has_permission('general_affairs.equipment.manage')
      OR EXISTS (
        SELECT 1
        FROM store_managers sm
        WHERE sm.store_id = ga_equipment.store_id
          AND sm.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "ga_equipment_insert" ON ga_equipment;
CREATE POLICY "ga_equipment_insert" ON ga_equipment
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_has_permission('general_affairs.equipment.manage')
  );

DROP POLICY IF EXISTS "ga_equipment_update" ON ga_equipment;
CREATE POLICY "ga_equipment_update" ON ga_equipment
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND current_user_has_permission('general_affairs.equipment.manage')
  )
  WITH CHECK (
    current_user_has_permission('general_affairs.equipment.manage')
  );

-- 不建立 DELETE policy。設備與範本刪除只能透過 soft delete RPC/API。
