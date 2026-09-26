-- ============================================================
-- General Affairs Facility Master - Task 1B-2
--
-- Included:
--   ga_facilities, facility permissions, constraints, indexes,
--   validation trigger, soft delete RPC, RLS.
--
-- Not included:
--   work order facility_id, resource_snapshot, attachments, inspections,
--   maintenance schedules, vendors, costs, parts, inventory, homepage KPI.
-- ============================================================

-- 0. Prerequisite checks
DO $$
DECLARE
  v_missing TEXT[];
BEGIN
  SELECT array_remove(ARRAY[
    CASE WHEN to_regclass('public.permissions') IS NULL THEN 'table public.permissions' END,
    CASE WHEN to_regclass('public.profiles') IS NULL THEN 'table public.profiles' END,
    CASE WHEN to_regclass('public.stores') IS NULL THEN 'table public.stores' END,
    CASE WHEN to_regclass('public.store_managers') IS NULL THEN 'table public.store_managers' END,
    CASE WHEN to_regclass('public.ga_facility_categories') IS NULL THEN 'table public.ga_facility_categories' END,
    CASE WHEN to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN 'function public.current_user_has_permission(varchar)' END,
    CASE WHEN to_regprocedure('public.ga_category_has_active_path(public.ga_category_kind, uuid)') IS NULL THEN 'function public.ga_category_has_active_path(ga_category_kind, uuid)' END,
    CASE WHEN to_regprocedure('public.ga_normalize_optional_text(text)') IS NULL THEN 'function public.ga_normalize_optional_text(text) from Task 1B-1' END,
    CASE WHEN to_regprocedure('public.ga_is_store_active(uuid)') IS NULL THEN 'function public.ga_is_store_active(uuid) from Task 1B-1' END
  ], NULL)
  INTO v_missing;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Task 1B-2 facility migration prerequisites missing: %', array_to_string(v_missing, ', ');
  END IF;
END $$;

-- 1. Permissions
INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('general_affairs', 'facility', 'general_affairs.facility.view', 'view', '查看總務門市設施主檔'),
  ('general_affairs', 'facility', 'general_affairs.facility.manage', 'manage', '管理總務門市設施主檔')
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = true;

-- 2. Table
CREATE TABLE IF NOT EXISTS ga_facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id),
  category_id UUID NOT NULL REFERENCES ga_facility_categories(id),
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  facility_code TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  criticality TEXT NOT NULL DEFAULT 'NORMAL',
  area TEXT,
  location_detail TEXT,
  quantity NUMERIC(12,3),
  unit TEXT,
  is_fixed_asset BOOLEAN NOT NULL DEFAULT true,
  installed_at DATE,
  last_renovated_at DATE,
  description TEXT,
  specs JSONB NOT NULL DEFAULT '{}'::jsonb,
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  image_path TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  deletion_reason TEXT,
  CONSTRAINT ga_facilities_status_check
    CHECK (status IN ('ACTIVE', 'PARTIALLY_DAMAGED', 'OUT_OF_SERVICE', 'UNDER_RENOVATION', 'RETIRED')),
  CONSTRAINT ga_facilities_criticality_check
    CHECK (criticality IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  CONSTRAINT ga_facilities_specs_object
    CHECK (jsonb_typeof(specs) = 'object'),
  CONSTRAINT ga_facilities_quantity_unit_pair
    CHECK (
      (quantity IS NULL AND unit IS NULL)
      OR (quantity > 0 AND unit IS NOT NULL AND btrim(unit) <> '')
    ),
  CONSTRAINT ga_facilities_image_path_relative
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_facilities_code_active
ON ga_facilities (upper(btrim(facility_code)))
WHERE deleted_at IS NULL AND facility_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ga_facilities_store
ON ga_facilities (store_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_facilities_category
ON ga_facilities (category_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_facilities_status
ON ga_facilities (status)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_facilities_area
ON ga_facilities (upper(COALESCE(area, '')))
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_facilities_duplicate_hint
ON ga_facilities (
  store_id,
  category_id,
  upper(btrim(name)),
  upper(COALESCE(area, '')),
  upper(COALESCE(location_detail, ''))
)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_facilities_search
ON ga_facilities (
  upper(name),
  upper(COALESCE(facility_code, '')),
  upper(COALESCE(area, '')),
  upper(COALESCE(location_detail, ''))
)
WHERE deleted_at IS NULL;

-- 4. Helper functions / triggers
CREATE OR REPLACE FUNCTION ga_is_active_facility_category(p_category_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM ga_facility_categories c
    WHERE c.id = p_category_id
      AND c.deleted_at IS NULL
      AND c.is_active = true
      AND ga_category_has_active_path('facility', c.id)
  );
$$;

CREATE OR REPLACE FUNCTION ga_validate_facility()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_soft_delete BOOLEAN := COALESCE(current_setting('app.ga_soft_delete_facility', true), '') = 'true';
BEGIN
  NEW.name := btrim(NEW.name);
  NEW.facility_code := upper(ga_normalize_optional_text(NEW.facility_code));
  NEW.area := ga_normalize_optional_text(NEW.area);
  NEW.location_detail := ga_normalize_optional_text(NEW.location_detail);
  NEW.unit := ga_normalize_optional_text(NEW.unit);
  NEW.description := ga_normalize_optional_text(NEW.description);
  NEW.image_path := ga_normalize_optional_text(NEW.image_path);
  NEW.notes := ga_normalize_optional_text(NEW.notes);

  IF NEW.name IS NULL OR NEW.name = '' THEN
    RAISE EXCEPTION '請輸入設施名稱';
  END IF;

  IF NOT ga_is_store_active(NEW.store_id) THEN
    RAISE EXCEPTION '設施所屬門市必須存在且啟用';
  END IF;

  IF NOT ga_is_active_facility_category(NEW.category_id) THEN
    RAISE EXCEPTION '設施分類必須啟用、未刪除且祖先路徑有效';
  END IF;

  IF jsonb_typeof(NEW.specs) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '設施 specs 必須是 JSON object';
  END IF;

  IF (NEW.quantity IS NULL AND NEW.unit IS NOT NULL)
    OR (NEW.quantity IS NOT NULL AND (NEW.quantity <= 0 OR NEW.unit IS NULL)) THEN
    RAISE EXCEPTION 'quantity 與 unit 必須一起填寫，且 quantity 必須大於 0';
  END IF;

  IF NEW.image_path IS NOT NULL AND (
    NEW.image_path ~* '^[a-z][a-z0-9+.-]*:'
    OR NEW.image_path ~ E'\\\\'
    OR NEW.image_path ~ '(^|/)\.\.(/|$)'
    OR NEW.image_path ~ '^/'
  ) THEN
    RAISE EXCEPTION '設施 image_path 僅可保存安全的相對 Storage Path';
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
        RAISE EXCEPTION '此設施已被刪除';
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

DROP TRIGGER IF EXISTS trg_ga_facilities_before_write ON ga_facilities;
CREATE TRIGGER trg_ga_facilities_before_write
  BEFORE INSERT OR UPDATE ON ga_facilities
  FOR EACH ROW EXECUTE FUNCTION ga_validate_facility();

CREATE OR REPLACE FUNCTION ga_soft_delete_facility(
  p_facility_id UUID,
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

  IF NOT current_user_has_permission('general_affairs.facility.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有設施管理權限');
  END IF;

  IF v_reason IS NULL OR char_length(v_reason) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入至少 2 個字的刪除原因');
  END IF;

  PERFORM set_config('app.ga_soft_delete_facility', 'true', true);

  UPDATE ga_facilities
  SET
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = v_reason,
    updated_by = v_user_id
  WHERE id = p_facility_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    IF EXISTS (SELECT 1 FROM ga_facilities WHERE id = p_facility_id AND deleted_at IS NOT NULL) THEN
      RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '此設施已被刪除');
    END IF;
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到設施');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'data', jsonb_build_object(
      'id', p_facility_id,
      'deleted_at', v_deleted_at,
      'deleted_by', v_user_id,
      'deletion_reason', v_reason
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION ga_soft_delete_facility(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ga_soft_delete_facility(UUID, TEXT) TO authenticated;

-- 5. RLS
ALTER TABLE ga_facilities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ga_facilities_scope_read" ON ga_facilities;
CREATE POLICY "ga_facilities_scope_read" ON ga_facilities
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      current_user_has_permission('general_affairs.facility.view')
      OR current_user_has_permission('general_affairs.facility.manage')
      OR EXISTS (
        SELECT 1
        FROM store_managers sm
        WHERE sm.store_id = ga_facilities.store_id
          AND sm.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "ga_facilities_insert" ON ga_facilities;
CREATE POLICY "ga_facilities_insert" ON ga_facilities
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_has_permission('general_affairs.facility.manage')
  );

DROP POLICY IF EXISTS "ga_facilities_update" ON ga_facilities;
CREATE POLICY "ga_facilities_update" ON ga_facilities
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND current_user_has_permission('general_affairs.facility.manage')
  )
  WITH CHECK (
    current_user_has_permission('general_affairs.facility.manage')
  );

-- 不建立 DELETE policy。設施刪除只能透過 soft delete RPC/API。
