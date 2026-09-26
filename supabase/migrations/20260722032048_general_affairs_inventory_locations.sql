-- ============================================================
-- General Affairs Inventory Locations - Task 1C-1
--
-- Included:
--   ga_inventory_locations, ga_inventory_location_parts,
--   inventory location permissions, constraints, indexes,
--   validation triggers, soft delete RPC, RLS.
--
-- Not included:
--   inventory transactions, balances, stock movement flows, stock counts,
--   work order consumption, request flows, actual low-stock calculation,
--   or later inventory stages.
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
    CASE WHEN to_regclass('public.ga_parts') IS NULL THEN 'table public.ga_parts from Task 1B-3' END,
    CASE WHEN to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN 'function public.current_user_has_permission(varchar)' END,
    CASE WHEN to_regprocedure('public.ga_normalize_optional_text(text)') IS NULL THEN 'function public.ga_normalize_optional_text(text)' END
  ], NULL)
  INTO v_missing;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Task 1C-1 inventory location migration prerequisites missing: %', array_to_string(v_missing, ', ');
  END IF;
END $$;

-- 1. Permissions
INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('general_affairs', 'inventory_location', 'general_affairs.inventory_location.view', 'view', '查看總務庫存位置與位置料件設定'),
  ('general_affairs', 'inventory_location', 'general_affairs.inventory_location.manage', 'manage', '管理總務庫存位置與位置料件設定')
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = true;

-- 2. Tables
CREATE TABLE IF NOT EXISTS public.ga_inventory_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT,
  name TEXT NOT NULL CHECK (btrim(name) <> ''),
  location_type TEXT NOT NULL,
  store_id UUID REFERENCES public.stores(id),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  allow_negative_stock BOOLEAN NOT NULL DEFAULT false,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  deletion_reason TEXT,
  CONSTRAINT ga_inventory_locations_type_check
    CHECK (location_type IN ('CENTRAL_WAREHOUSE', 'STORE', 'OFFICE', 'TEMPORARY', 'OTHER')),
  CONSTRAINT ga_inventory_locations_store_pair
    CHECK (
      (location_type = 'STORE' AND store_id IS NOT NULL)
      OR (location_type <> 'STORE' AND store_id IS NULL)
    ),
  CONSTRAINT ga_inventory_locations_default_type
    CHECK (
      is_default = false
      OR location_type IN ('CENTRAL_WAREHOUSE', 'STORE')
    ),
  CONSTRAINT ga_inventory_locations_default_active
    CHECK (
      is_default = false
      OR is_active = true
    )
);

CREATE TABLE IF NOT EXISTS public.ga_inventory_location_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.ga_inventory_locations(id),
  part_id UUID NOT NULL REFERENCES public.ga_parts(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  safety_stock_qty NUMERIC(12,4),
  maximum_stock_qty NUMERIC(12,4),
  reorder_point_qty NUMERIC(12,4),
  preferred_issue_unit_type TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  deletion_reason TEXT,
  CONSTRAINT ga_inventory_location_parts_preferred_unit_type
    CHECK (preferred_issue_unit_type IS NULL OR preferred_issue_unit_type IN ('BASE', 'PURCHASE')),
  CONSTRAINT ga_inventory_location_parts_qty_nonnegative
    CHECK (
      (safety_stock_qty IS NULL OR safety_stock_qty >= 0)
      AND (reorder_point_qty IS NULL OR reorder_point_qty >= 0)
      AND (maximum_stock_qty IS NULL OR maximum_stock_qty >= 0)
    ),
  CONSTRAINT ga_inventory_location_parts_qty_order
    CHECK (
      (safety_stock_qty IS NULL OR reorder_point_qty IS NULL OR safety_stock_qty <= reorder_point_qty)
      AND (reorder_point_qty IS NULL OR maximum_stock_qty IS NULL OR reorder_point_qty <= maximum_stock_qty)
      AND (safety_stock_qty IS NULL OR maximum_stock_qty IS NULL OR safety_stock_qty <= maximum_stock_qty)
    )
);

-- 3. Indexes
CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_inventory_locations_code_active
ON public.ga_inventory_locations (upper(btrim(code)))
WHERE deleted_at IS NULL AND code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_inventory_locations_default_store
ON public.ga_inventory_locations (store_id)
WHERE deleted_at IS NULL
  AND is_active = true
  AND is_default = true
  AND location_type = 'STORE';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_inventory_locations_default_central
ON public.ga_inventory_locations ((true))
WHERE deleted_at IS NULL
  AND is_active = true
  AND is_default = true
  AND location_type = 'CENTRAL_WAREHOUSE';

CREATE INDEX IF NOT EXISTS idx_ga_inventory_locations_type
ON public.ga_inventory_locations(location_type)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_inventory_locations_store
ON public.ga_inventory_locations(store_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_inventory_locations_search
ON public.ga_inventory_locations(
  upper(name),
  upper(COALESCE(code, '')),
  upper(COALESCE(description, ''))
)
WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_inventory_location_parts_location_part_active
ON public.ga_inventory_location_parts(location_id, part_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_inventory_location_parts_location
ON public.ga_inventory_location_parts(location_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_inventory_location_parts_part
ON public.ga_inventory_location_parts(part_id)
WHERE deleted_at IS NULL;

-- 4. Helper functions / triggers
CREATE OR REPLACE FUNCTION public.current_user_manages_store(p_store_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.store_managers sm
    WHERE sm.user_id = auth.uid()
      AND sm.store_id = p_store_id
  );
$$;

CREATE OR REPLACE FUNCTION public.ga_inventory_location_is_visible(p_location_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ga_inventory_locations l
    WHERE l.id = p_location_id
      AND l.deleted_at IS NULL
      AND (
        current_user_has_permission('general_affairs.inventory_location.view')
        OR current_user_has_permission('general_affairs.inventory_location.manage')
        OR (
          l.location_type = 'STORE'
          AND l.store_id IS NOT NULL
          AND current_user_manages_store(l.store_id)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.ga_validate_inventory_location()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_soft_delete BOOLEAN := COALESCE(current_setting('app.ga_soft_delete_inventory_location', true), '') = 'true';
BEGIN
  NEW.code := upper(ga_normalize_optional_text(NEW.code));
  NEW.name := btrim(NEW.name);
  NEW.location_type := upper(btrim(NEW.location_type));
  NEW.description := ga_normalize_optional_text(NEW.description);

  IF NEW.name IS NULL OR NEW.name = '' THEN
    RAISE EXCEPTION '請輸入庫存位置名稱';
  END IF;

  IF NEW.location_type NOT IN ('CENTRAL_WAREHOUSE', 'STORE', 'OFFICE', 'TEMPORARY', 'OTHER') THEN
    RAISE EXCEPTION '庫存位置類型錯誤';
  END IF;

  IF NEW.location_type = 'STORE' AND NEW.store_id IS NULL THEN
    RAISE EXCEPTION 'STORE 類型必須選擇門市';
  END IF;

  IF NEW.location_type <> 'STORE' AND NEW.store_id IS NOT NULL THEN
    RAISE EXCEPTION '非 STORE 類型不得設定門市';
  END IF;

  IF NEW.is_active = false THEN
    NEW.is_default := false;
  END IF;

  IF NEW.is_default = true AND NEW.location_type NOT IN ('CENTRAL_WAREHOUSE', 'STORE') THEN
    RAISE EXCEPTION '只有 STORE 與 CENTRAL_WAREHOUSE 可設為預設位置';
  END IF;

  IF NEW.is_default = true AND NEW.is_active = false THEN
    RAISE EXCEPTION '停用位置不得設為預設位置';
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
        RAISE EXCEPTION '此庫存位置已被刪除';
      END IF;
      IF NEW.deleted_at IS NULL OR NEW.deleted_by IS NULL OR NEW.deletion_reason IS NULL THEN
        RAISE EXCEPTION 'soft delete 必須設定 deleted_at、deleted_by 與 deletion_reason';
      END IF;
      NEW.is_active := false;
      NEW.is_default := false;
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

CREATE OR REPLACE FUNCTION public.ga_validate_inventory_location_part()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_soft_delete BOOLEAN := COALESCE(current_setting('app.ga_soft_delete_inventory_location_part', true), '') = 'true';
  v_location RECORD;
  v_part RECORD;
  v_location_changed BOOLEAN := false;
  v_part_changed BOOLEAN := false;
BEGIN
  NEW.preferred_issue_unit_type := upper(ga_normalize_optional_text(NEW.preferred_issue_unit_type));
  NEW.notes := ga_normalize_optional_text(NEW.notes);

  IF NEW.preferred_issue_unit_type IS NOT NULL AND NEW.preferred_issue_unit_type NOT IN ('BASE', 'PURCHASE') THEN
    RAISE EXCEPTION '偏好領用單位類型錯誤';
  END IF;

  IF NEW.safety_stock_qty IS NOT NULL AND NEW.safety_stock_qty < 0 THEN
    RAISE EXCEPTION '安全庫存不可小於 0';
  END IF;

  IF NEW.reorder_point_qty IS NOT NULL AND NEW.reorder_point_qty < 0 THEN
    RAISE EXCEPTION '補貨點不可小於 0';
  END IF;

  IF NEW.maximum_stock_qty IS NOT NULL AND NEW.maximum_stock_qty < 0 THEN
    RAISE EXCEPTION '最高庫存不可小於 0';
  END IF;

  IF NEW.safety_stock_qty IS NOT NULL AND NEW.reorder_point_qty IS NOT NULL AND NEW.safety_stock_qty > NEW.reorder_point_qty THEN
    RAISE EXCEPTION '安全庫存不可大於補貨點';
  END IF;

  IF NEW.reorder_point_qty IS NOT NULL AND NEW.maximum_stock_qty IS NOT NULL AND NEW.reorder_point_qty > NEW.maximum_stock_qty THEN
    RAISE EXCEPTION '補貨點不可大於最高庫存';
  END IF;

  IF NEW.safety_stock_qty IS NOT NULL AND NEW.maximum_stock_qty IS NOT NULL AND NEW.safety_stock_qty > NEW.maximum_stock_qty THEN
    RAISE EXCEPTION '安全庫存不可大於最高庫存';
  END IF;

  SELECT id, is_active, deleted_at
  INTO v_location
  FROM public.ga_inventory_locations
  WHERE id = NEW.location_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '庫存位置不存在';
  END IF;

  SELECT id, is_active, deleted_at, base_unit, purchase_unit, purchase_to_base_rate
  INTO v_part
  FROM public.ga_parts
  WHERE id = NEW.part_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '料件不存在';
  END IF;

  v_location_changed := TG_OP = 'INSERT' OR NEW.location_id IS DISTINCT FROM OLD.location_id;
  v_part_changed := TG_OP = 'INSERT' OR NEW.part_id IS DISTINCT FROM OLD.part_id;

  IF v_location_changed AND (v_location.deleted_at IS NOT NULL OR v_location.is_active = false) THEN
    RAISE EXCEPTION '新增或更換位置料件設定時，庫存位置必須啟用且未刪除';
  END IF;

  IF v_part_changed AND (v_part.deleted_at IS NOT NULL OR v_part.is_active = false) THEN
    RAISE EXCEPTION '新增或更換位置料件設定時，料件必須啟用且未刪除';
  END IF;

  IF NEW.preferred_issue_unit_type = 'PURCHASE' AND (
    v_part.purchase_unit IS NULL
    OR v_part.purchase_to_base_rate IS NULL
    OR v_part.purchase_to_base_rate <= 0
  ) THEN
    RAISE EXCEPTION '料件沒有有效採購單位時，不可設定 PURCHASE 為偏好領用單位';
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
        RAISE EXCEPTION '此位置料件設定已被刪除';
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

DROP TRIGGER IF EXISTS trg_ga_inventory_locations_before_write ON public.ga_inventory_locations;
CREATE TRIGGER trg_ga_inventory_locations_before_write
  BEFORE INSERT OR UPDATE ON public.ga_inventory_locations
  FOR EACH ROW EXECUTE FUNCTION public.ga_validate_inventory_location();

DROP TRIGGER IF EXISTS trg_ga_inventory_location_parts_before_write ON public.ga_inventory_location_parts;
CREATE TRIGGER trg_ga_inventory_location_parts_before_write
  BEFORE INSERT OR UPDATE ON public.ga_inventory_location_parts
  FOR EACH ROW EXECUTE FUNCTION public.ga_validate_inventory_location_part();

CREATE OR REPLACE FUNCTION public.ga_soft_delete_inventory_location(
  p_location_id UUID,
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

  IF NOT current_user_has_permission('general_affairs.inventory_location.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有庫存位置管理權限');
  END IF;

  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入刪除原因');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ga_inventory_locations WHERE id = p_location_id) THEN
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到庫存位置');
  END IF;

  IF EXISTS (SELECT 1 FROM public.ga_inventory_locations WHERE id = p_location_id AND deleted_at IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '此庫存位置已被刪除');
  END IF;

  -- 後續建立交易表後，若位置已有任何交易紀錄，這裡必須拒絕 soft delete，改以 is_active=false 停用。
  PERFORM set_config('app.ga_soft_delete_inventory_location_part', 'true', true);
  UPDATE public.ga_inventory_location_parts
  SET
    is_active = false,
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = '父庫存位置刪除衍生：' || v_reason,
    updated_by = v_user_id
  WHERE location_id = p_location_id
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_child_count = ROW_COUNT;

  PERFORM set_config('app.ga_soft_delete_inventory_location', 'true', true);
  UPDATE public.ga_inventory_locations
  SET
    is_active = false,
    is_default = false,
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = v_reason,
    updated_by = v_user_id
  WHERE id = p_location_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    RAISE EXCEPTION '庫存位置 soft delete 失敗，交易已中止';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'data', jsonb_build_object(
      'id', p_location_id,
      'is_active', false,
      'is_default', false,
      'deleted_at', v_deleted_at,
      'deleted_by', v_user_id,
      'deletion_reason', v_reason,
      'deleted_location_parts', v_child_count
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_soft_delete_inventory_location_part(
  p_location_part_id UUID,
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

  IF NOT current_user_has_permission('general_affairs.inventory_location.manage') THEN
    RETURN jsonb_build_object('ok', false, 'status', 403, 'error', '沒有庫存位置管理權限');
  END IF;

  IF v_reason IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'status', 400, 'error', '請輸入刪除原因');
  END IF;

  -- 後續建立交易表後，若位置料件已有任何交易紀錄，這裡必須拒絕 soft delete，改以 is_active=false 停用。
  PERFORM set_config('app.ga_soft_delete_inventory_location_part', 'true', true);

  UPDATE public.ga_inventory_location_parts
  SET
    is_active = false,
    deleted_at = v_deleted_at,
    deleted_by = v_user_id,
    deletion_reason = v_reason,
    updated_by = v_user_id
  WHERE id = p_location_part_id
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count = 0 THEN
    IF EXISTS (SELECT 1 FROM public.ga_inventory_location_parts WHERE id = p_location_part_id AND deleted_at IS NOT NULL) THEN
      RETURN jsonb_build_object('ok', false, 'status', 409, 'error', '此位置料件設定已被刪除');
    END IF;
    RETURN jsonb_build_object('ok', false, 'status', 404, 'error', '找不到位置料件設定');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'status', 200,
    'data', jsonb_build_object(
      'id', p_location_part_id,
      'is_active', false,
      'deleted_at', v_deleted_at,
      'deleted_by', v_user_id,
      'deletion_reason', v_reason
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.current_user_manages_store(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_soft_delete_inventory_location(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_soft_delete_inventory_location_part(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_manages_store(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_soft_delete_inventory_location(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_soft_delete_inventory_location_part(UUID, TEXT) TO authenticated;

-- 5. RLS
ALTER TABLE public.ga_inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_inventory_location_parts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ga_inventory_locations_general_read" ON public.ga_inventory_locations;
CREATE POLICY "ga_inventory_locations_general_read" ON public.ga_inventory_locations
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND (
      current_user_has_permission('general_affairs.inventory_location.view')
      OR current_user_has_permission('general_affairs.inventory_location.manage')
    )
  );

DROP POLICY IF EXISTS "ga_inventory_locations_store_manager_read" ON public.ga_inventory_locations;
CREATE POLICY "ga_inventory_locations_store_manager_read" ON public.ga_inventory_locations
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND location_type = 'STORE'
    AND store_id IS NOT NULL
    AND current_user_manages_store(store_id)
  );

DROP POLICY IF EXISTS "ga_inventory_locations_insert" ON public.ga_inventory_locations;
CREATE POLICY "ga_inventory_locations_insert" ON public.ga_inventory_locations
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_has_permission('general_affairs.inventory_location.manage')
  );

DROP POLICY IF EXISTS "ga_inventory_locations_update" ON public.ga_inventory_locations;
CREATE POLICY "ga_inventory_locations_update" ON public.ga_inventory_locations
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND current_user_has_permission('general_affairs.inventory_location.manage')
  )
  WITH CHECK (
    current_user_has_permission('general_affairs.inventory_location.manage')
  );

DROP POLICY IF EXISTS "ga_inventory_location_parts_read_via_location" ON public.ga_inventory_location_parts;
CREATE POLICY "ga_inventory_location_parts_read_via_location" ON public.ga_inventory_location_parts
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND ga_inventory_location_is_visible(location_id)
  );

DROP POLICY IF EXISTS "ga_inventory_location_parts_insert" ON public.ga_inventory_location_parts;
CREATE POLICY "ga_inventory_location_parts_insert" ON public.ga_inventory_location_parts
  FOR INSERT TO authenticated
  WITH CHECK (
    current_user_has_permission('general_affairs.inventory_location.manage')
  );

DROP POLICY IF EXISTS "ga_inventory_location_parts_update" ON public.ga_inventory_location_parts;
CREATE POLICY "ga_inventory_location_parts_update" ON public.ga_inventory_location_parts
  FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND current_user_has_permission('general_affairs.inventory_location.manage')
  )
  WITH CHECK (
    current_user_has_permission('general_affairs.inventory_location.manage')
  );

-- 不建立 DELETE policy。庫存位置與位置料件設定刪除只能透過 soft delete RPC/API。
