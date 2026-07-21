-- ============================================================
-- 總務服務中心 - Task 1A 分類與權限基礎
-- 範圍：
--   1. 細項權限碼
--   2. 設備/設施/料件分類表
--   3. 分類最多三層與防循環資料庫防線
--   4. 有效分類路徑 helper
--   5. RLS policies
--
-- 注意：
--   本 migration 不建立設備、設施、料件主檔，不修改工單流程。
-- ============================================================

-- 1. 權限碼：idempotent，不自動授權任何角色
INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('general_affairs', 'equipment_category', 'general_affairs.equipment_category.view', 'view', '可查看總務設備分類'),
  ('general_affairs', 'equipment_category', 'general_affairs.equipment_category.manage', 'manage', '可管理總務設備分類'),
  ('general_affairs', 'facility_category', 'general_affairs.facility_category.view', 'view', '可查看總務設施分類'),
  ('general_affairs', 'facility_category', 'general_affairs.facility_category.manage', 'manage', '可管理總務設施分類'),
  ('general_affairs', 'part_category', 'general_affairs.part_category.view', 'view', '可查看總務料件分類'),
  ('general_affairs', 'part_category', 'general_affairs.part_category.manage', 'manage', '可管理總務料件分類')
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = true;

-- 現有 has_permission() 是 Task 1A RLS 的權限基礎。
-- 若函式存在，補上安全 search_path；若基礎 RBAC 尚未建立，本 migration 會在 permissions insert 先失敗。
ALTER FUNCTION public.has_permission(UUID, VARCHAR)
SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.current_user_has_permission(p_permission_code VARCHAR)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT public.has_permission(auth.uid(), p_permission_code);
$$;

GRANT EXECUTE ON FUNCTION public.current_user_has_permission(VARCHAR) TO authenticated;

-- 2. 固定分類種類 enum，避免任意 table name dynamic SQL
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ga_category_kind') THEN
    CREATE TYPE ga_category_kind AS ENUM ('equipment', 'facility', 'part');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION ga_category_table_name(p_kind ga_category_kind)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_kind
    WHEN 'equipment' THEN RETURN 'ga_equipment_categories';
    WHEN 'facility' THEN RETURN 'ga_facility_categories';
    WHEN 'part' THEN RETURN 'ga_part_categories';
    ELSE RAISE EXCEPTION 'Unsupported general affairs category kind: %', p_kind;
  END CASE;
END;
$$;

-- 3. 分類表
CREATE TABLE IF NOT EXISTS ga_equipment_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES ga_equipment_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  code TEXT NOT NULL CHECK (btrim(code) <> '' AND code = upper(btrim(code))),
  description TEXT,
  icon_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 10,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  requires_brand BOOLEAN NOT NULL DEFAULT false,
  requires_model BOOLEAN NOT NULL DEFAULT false,
  requires_serial_number BOOLEAN NOT NULL DEFAULT false,
  requires_warranty BOOLEAN NOT NULL DEFAULT false,
  default_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ga_equipment_categories_default_fields_object
    CHECK (jsonb_typeof(default_fields) = 'object')
);

CREATE TABLE IF NOT EXISTS ga_facility_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES ga_facility_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  code TEXT NOT NULL CHECK (btrim(code) <> '' AND code = upper(btrim(code))),
  description TEXT,
  icon_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 10,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  default_issue_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT ga_facility_categories_default_issue_fields_object
    CHECK (jsonb_typeof(default_issue_fields) = 'object')
);

CREATE TABLE IF NOT EXISTS ga_part_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES ga_part_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  code TEXT NOT NULL CHECK (btrim(code) <> '' AND code = upper(btrim(code))),
  description TEXT,
  icon_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 10,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  spec_schema JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_base_unit TEXT,
  is_recyclable_default BOOLEAN NOT NULL DEFAULT false,
  manage_compatibility BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT ga_part_categories_spec_schema_array
    CHECK (jsonb_typeof(spec_schema) = 'array')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_equipment_categories_code_active
ON ga_equipment_categories (code)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_facility_categories_code_active
ON ga_facility_categories (code)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_part_categories_code_active
ON ga_part_categories (code)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_equipment_categories_parent ON ga_equipment_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_ga_equipment_categories_active_sort ON ga_equipment_categories(is_active, sort_order, name);
CREATE INDEX IF NOT EXISTS idx_ga_equipment_categories_deleted ON ga_equipment_categories(deleted_at);

CREATE INDEX IF NOT EXISTS idx_ga_facility_categories_parent ON ga_facility_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_ga_facility_categories_active_sort ON ga_facility_categories(is_active, sort_order, name);
CREATE INDEX IF NOT EXISTS idx_ga_facility_categories_deleted ON ga_facility_categories(deleted_at);

CREATE INDEX IF NOT EXISTS idx_ga_part_categories_parent ON ga_part_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_ga_part_categories_active_sort ON ga_part_categories(is_active, sort_order, name);
CREATE INDEX IF NOT EXISTS idx_ga_part_categories_deleted ON ga_part_categories(deleted_at);

-- 4. 分類樹 helper，所有 dynamic SQL 都由 enum whitelist 決定固定資料表
CREATE OR REPLACE FUNCTION ga_category_depth(p_kind ga_category_kind, p_category_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_table TEXT := ga_category_table_name(p_kind);
  v_depth INTEGER;
BEGIN
  EXECUTE format($sql$
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, 1 AS depth, ARRAY[id] AS path
      FROM %I
      WHERE id = $1
      UNION ALL
      SELECT p.id, p.parent_id, a.depth + 1, a.path || p.id
      FROM %I p
      JOIN ancestors a ON a.parent_id = p.id
      WHERE NOT p.id = ANY(a.path)
    )
    SELECT max(depth) FROM ancestors
  $sql$, v_table, v_table)
  INTO v_depth
  USING p_category_id;

  RETURN COALESCE(v_depth, 0);
END;
$$;

CREATE OR REPLACE FUNCTION ga_category_has_active_path(p_kind ga_category_kind, p_category_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_table TEXT := ga_category_table_name(p_kind);
  v_is_valid BOOLEAN;
BEGIN
  EXECUTE format($sql$
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, is_active, deleted_at, ARRAY[id] AS path
      FROM %I
      WHERE id = $1
      UNION ALL
      SELECT p.id, p.parent_id, p.is_active, p.deleted_at, a.path || p.id
      FROM %I p
      JOIN ancestors a ON a.parent_id = p.id
      WHERE NOT p.id = ANY(a.path)
    )
    SELECT
      count(*) > 0
      AND bool_and(is_active = true)
      AND bool_and(deleted_at IS NULL)
    FROM ancestors
  $sql$, v_table, v_table)
  INTO v_is_valid
  USING p_category_id;

  RETURN COALESCE(v_is_valid, false);
END;
$$;

CREATE OR REPLACE FUNCTION ga_active_category_path(p_kind ga_category_kind, p_category_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_table TEXT := ga_category_table_name(p_kind);
  v_path JSONB;
BEGIN
  IF NOT ga_category_has_active_path(p_kind, p_category_id) THEN
    RETURN '[]'::jsonb;
  END IF;

  EXECUTE format($sql$
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, name, code, 1 AS depth, ARRAY[id] AS path
      FROM %I
      WHERE id = $1
      UNION ALL
      SELECT p.id, p.parent_id, p.name, p.code, a.depth + 1, a.path || p.id
      FROM %I p
      JOIN ancestors a ON a.parent_id = p.id
      WHERE NOT p.id = ANY(a.path)
    )
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code) ORDER BY depth DESC),
      '[]'::jsonb
    )
    FROM ancestors
  $sql$, v_table, v_table)
  INTO v_path
  USING p_category_id;

  RETURN COALESCE(v_path, '[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION ga_validate_category_tree(
  p_kind ga_category_kind,
  p_category_id UUID,
  p_parent_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_table TEXT := ga_category_table_name(p_kind);
  v_parent_exists BOOLEAN;
  v_parent_depth INTEGER := 0;
  v_descendant_depth INTEGER := 1;
  v_parent_is_descendant BOOLEAN := false;
BEGIN
  IF p_parent_id IS NULL THEN
    v_parent_depth := 0;
  ELSE
    IF p_parent_id = p_category_id THEN
      RAISE EXCEPTION '分類不可將自己設為父分類';
    END IF;

    EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND deleted_at IS NULL)', v_table)
    INTO v_parent_exists
    USING p_parent_id;

    IF NOT COALESCE(v_parent_exists, false) THEN
      RAISE EXCEPTION '父分類不存在或已刪除';
    END IF;

    v_parent_depth := ga_category_depth(p_kind, p_parent_id);
    IF v_parent_depth <= 0 THEN
      RAISE EXCEPTION '父分類層級無法判定';
    END IF;

    EXECUTE format($sql$
      WITH RECURSIVE descendants AS (
        SELECT id, parent_id, ARRAY[id] AS path
        FROM %I
        WHERE parent_id = $1
        UNION ALL
        SELECT c.id, c.parent_id, d.path || c.id
        FROM %I c
        JOIN descendants d ON c.parent_id = d.id
        WHERE NOT c.id = ANY(d.path)
      )
      SELECT EXISTS (SELECT 1 FROM descendants WHERE id = $2)
    $sql$, v_table, v_table)
    INTO v_parent_is_descendant
    USING p_category_id, p_parent_id;

    IF COALESCE(v_parent_is_descendant, false) THEN
      RAISE EXCEPTION '分類不可移動到自己的子分類底下';
    END IF;
  END IF;

  EXECUTE format($sql$
    WITH RECURSIVE descendants AS (
      SELECT id, parent_id, 1 AS depth, ARRAY[id] AS path
      FROM %I
      WHERE id = $1
      UNION ALL
      SELECT c.id, c.parent_id, d.depth + 1, d.path || c.id
      FROM %I c
      JOIN descendants d ON c.parent_id = d.id
      WHERE NOT c.id = ANY(d.path)
    )
    SELECT COALESCE(max(depth), 1) FROM descendants
  $sql$, v_table, v_table)
  INTO v_descendant_depth
  USING p_category_id;

  IF (v_parent_depth + v_descendant_depth) > 3 THEN
    RAISE EXCEPTION '分類最多只能建立三層';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION ga_category_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_kind ga_category_kind;
BEGIN
  IF TG_TABLE_NAME = 'ga_equipment_categories' THEN
    v_kind := 'equipment';
  ELSIF TG_TABLE_NAME = 'ga_facility_categories' THEN
    v_kind := 'facility';
  ELSIF TG_TABLE_NAME = 'ga_part_categories' THEN
    v_kind := 'part';
  ELSE
    RAISE EXCEPTION 'Unsupported category trigger table: %', TG_TABLE_NAME;
  END IF;

  NEW.name := btrim(NEW.name);
  NEW.code := upper(btrim(NEW.code));

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := NOW();
  END IF;

  IF TG_OP = 'INSERT' OR NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    PERFORM ga_validate_category_tree(v_kind, NEW.id, NEW.parent_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ga_equipment_categories_before_write ON ga_equipment_categories;
CREATE TRIGGER trg_ga_equipment_categories_before_write
  BEFORE INSERT OR UPDATE ON ga_equipment_categories
  FOR EACH ROW EXECUTE FUNCTION ga_category_before_write();

DROP TRIGGER IF EXISTS trg_ga_facility_categories_before_write ON ga_facility_categories;
CREATE TRIGGER trg_ga_facility_categories_before_write
  BEFORE INSERT OR UPDATE ON ga_facility_categories
  FOR EACH ROW EXECUTE FUNCTION ga_category_before_write();

DROP TRIGGER IF EXISTS trg_ga_part_categories_before_write ON ga_part_categories;
CREATE TRIGGER trg_ga_part_categories_before_write
  BEFORE INSERT OR UPDATE ON ga_part_categories
  FOR EACH ROW EXECUTE FUNCTION ga_category_before_write();

CREATE OR REPLACE FUNCTION ga_soft_delete_category(
  p_kind ga_category_kind,
  p_category_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_table TEXT;
  v_permission TEXT;
  v_user_id UUID;
  v_child_count INTEGER := 0;
  v_updated_count INTEGER := 0;
  v_deleted_at TIMESTAMPTZ := NOW();
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 401,
      'error', '未登入'
    );
  END IF;

  v_table := ga_category_table_name(p_kind);
  v_permission := CASE p_kind
    WHEN 'equipment' THEN 'general_affairs.equipment_category.manage'
    WHEN 'facility' THEN 'general_affairs.facility_category.manage'
    WHEN 'part' THEN 'general_affairs.part_category.manage'
  END;

  IF NOT has_permission(v_user_id, v_permission) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 403,
      'error', '沒有分類管理權限'
    );
  END IF;

  EXECUTE format(
    'SELECT count(*)::integer FROM %I WHERE parent_id = $1 AND deleted_at IS NULL',
    v_table
  )
  INTO v_child_count
  USING p_category_id;

  IF v_child_count > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 409,
      'error', '此分類仍有未刪除子分類，請先移除或刪除子分類後再刪除',
      'active_children_count', v_child_count
    );
  END IF;

  EXECUTE format($sql$
    UPDATE %I
    SET
      is_active = false,
      deleted_at = $2,
      deleted_by = $3,
      updated_by = $3
    WHERE id = $1
      AND deleted_at IS NULL
  $sql$, v_table)
  USING p_category_id, v_deleted_at, v_user_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 404,
      'error', '找不到可刪除的分類'
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'data', jsonb_build_object(
      'id', p_category_id,
      'is_active', false,
      'deleted_at', v_deleted_at,
      'deleted_by', v_user_id,
      'updated_by', v_user_id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION ga_soft_delete_category(ga_category_kind, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ga_soft_delete_category(ga_category_kind, UUID) TO authenticated;

-- 5. RLS
ALTER TABLE ga_equipment_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE ga_facility_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE ga_part_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ga_equipment_categories_general_read" ON ga_equipment_categories;
CREATE POLICY "ga_equipment_categories_general_read" ON ga_equipment_categories
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND is_active = true
    AND ga_category_has_active_path('equipment', id)
    AND (
      has_permission(auth.uid(), 'general_affairs.service_center.access')
      OR has_permission(auth.uid(), 'general_affairs.equipment_category.view')
    )
  );

DROP POLICY IF EXISTS "ga_equipment_categories_manage_read" ON ga_equipment_categories;
CREATE POLICY "ga_equipment_categories_manage_read" ON ga_equipment_categories
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND has_permission(auth.uid(), 'general_affairs.equipment_category.manage')
  );

DROP POLICY IF EXISTS "ga_equipment_categories_insert" ON ga_equipment_categories;
CREATE POLICY "ga_equipment_categories_insert" ON ga_equipment_categories
  FOR INSERT TO authenticated
  WITH CHECK (has_permission(auth.uid(), 'general_affairs.equipment_category.manage'));

DROP POLICY IF EXISTS "ga_equipment_categories_update" ON ga_equipment_categories;
CREATE POLICY "ga_equipment_categories_update" ON ga_equipment_categories
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND has_permission(auth.uid(), 'general_affairs.equipment_category.manage')
  )
  WITH CHECK (has_permission(auth.uid(), 'general_affairs.equipment_category.manage'));

DROP POLICY IF EXISTS "ga_facility_categories_general_read" ON ga_facility_categories;
CREATE POLICY "ga_facility_categories_general_read" ON ga_facility_categories
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND is_active = true
    AND ga_category_has_active_path('facility', id)
    AND (
      has_permission(auth.uid(), 'general_affairs.service_center.access')
      OR has_permission(auth.uid(), 'general_affairs.facility_category.view')
    )
  );

DROP POLICY IF EXISTS "ga_facility_categories_manage_read" ON ga_facility_categories;
CREATE POLICY "ga_facility_categories_manage_read" ON ga_facility_categories
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND has_permission(auth.uid(), 'general_affairs.facility_category.manage')
  );

DROP POLICY IF EXISTS "ga_facility_categories_insert" ON ga_facility_categories;
CREATE POLICY "ga_facility_categories_insert" ON ga_facility_categories
  FOR INSERT TO authenticated
  WITH CHECK (has_permission(auth.uid(), 'general_affairs.facility_category.manage'));

DROP POLICY IF EXISTS "ga_facility_categories_update" ON ga_facility_categories;
CREATE POLICY "ga_facility_categories_update" ON ga_facility_categories
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND has_permission(auth.uid(), 'general_affairs.facility_category.manage')
  )
  WITH CHECK (has_permission(auth.uid(), 'general_affairs.facility_category.manage'));

DROP POLICY IF EXISTS "ga_part_categories_general_read" ON ga_part_categories;
CREATE POLICY "ga_part_categories_general_read" ON ga_part_categories
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND is_active = true
    AND ga_category_has_active_path('part', id)
    AND (
      has_permission(auth.uid(), 'general_affairs.service_center.access')
      OR has_permission(auth.uid(), 'general_affairs.part_category.view')
    )
  );

DROP POLICY IF EXISTS "ga_part_categories_manage_read" ON ga_part_categories;
CREATE POLICY "ga_part_categories_manage_read" ON ga_part_categories
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND has_permission(auth.uid(), 'general_affairs.part_category.manage')
  );

DROP POLICY IF EXISTS "ga_part_categories_insert" ON ga_part_categories;
CREATE POLICY "ga_part_categories_insert" ON ga_part_categories
  FOR INSERT TO authenticated
  WITH CHECK (has_permission(auth.uid(), 'general_affairs.part_category.manage'));

DROP POLICY IF EXISTS "ga_part_categories_update" ON ga_part_categories;
CREATE POLICY "ga_part_categories_update" ON ga_part_categories
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND has_permission(auth.uid(), 'general_affairs.part_category.manage')
  )
  WITH CHECK (has_permission(auth.uid(), 'general_affairs.part_category.manage'));

-- 不建立 DELETE policy。分類刪除只能由 API 做 soft delete。

-- ============================================================
-- 人工驗收 SQL 範例（請在測試環境執行）
-- ============================================================
-- 1. code trim + uppercase：
-- INSERT INTO ga_equipment_categories(name, code) VALUES ('空調設備', ' ac ');
-- SELECT code FROM ga_equipment_categories WHERE name = '空調設備'; -- AC
--
-- 2. 三層允許、四層拒絕：
-- WITH r AS (
--   INSERT INTO ga_facility_categories(name, code) VALUES ('建築結構', 'BLD') RETURNING id
-- ), c AS (
--   INSERT INTO ga_facility_categories(name, code, parent_id) SELECT '天花板', 'CEIL', id FROM r RETURNING id
-- ), g AS (
--   INSERT INTO ga_facility_categories(name, code, parent_id) SELECT '前場天花板', 'CEIL-FRONT', id FROM c RETURNING id
-- )
-- INSERT INTO ga_facility_categories(name, code, parent_id) SELECT '第四層', 'LEVEL4', id FROM g; -- 應失敗
--
-- 3. 防循環：
-- UPDATE ga_facility_categories SET parent_id = '<child-id>' WHERE id = '<parent-id>'; -- 應失敗
--
-- 4. 父層停用後，一般讀取 helper 應判定子層路徑失效：
-- SELECT ga_category_has_active_path('facility', '<child-id>');
--
-- 5. soft delete code 可重用：
-- UPDATE ga_part_categories SET deleted_at = now(), is_active = false WHERE code = 'HOOK';
-- INSERT INTO ga_part_categories(name, code) VALUES ('新掛勾', 'HOOK'); -- 應成功
