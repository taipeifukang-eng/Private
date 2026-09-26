-- ============================================================
-- General Affairs Inventory Transactions Foundation - Task 1C-2B
--
-- Included:
--   ga_inventory_balances, ga_inventory_transactions,
--   inventory balance/transaction permissions, transaction number
--   sequence, post-transaction RPC, append-only protection, RLS.
--
-- Not included:
--   transfer, stocktake, purchasing, work-order deduction, request flows,
--   reversal workflows, balance repair RPC, Task 1C-3 UI, or later stages.
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
    CASE WHEN to_regclass('public.ga_inventory_locations') IS NULL THEN 'table public.ga_inventory_locations from Task 1C-1' END,
    CASE WHEN to_regclass('public.ga_inventory_location_parts') IS NULL THEN 'table public.ga_inventory_location_parts from Task 1C-1' END,
    CASE WHEN to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN 'function public.current_user_has_permission(varchar)' END,
    CASE WHEN to_regprocedure('public.current_user_manages_store(uuid)') IS NULL THEN 'function public.current_user_manages_store(uuid)' END,
    CASE WHEN to_regprocedure('public.ga_normalize_optional_text(text)') IS NULL THEN 'function public.ga_normalize_optional_text(text)' END
  ], NULL)
  INTO v_missing;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Task 1C-2B inventory transaction migration prerequisites missing: %', array_to_string(v_missing, ', ');
  END IF;
END $$;

-- 1. Permissions
INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('general_affairs', 'inventory_balance', 'general_affairs.inventory_balance.view', 'view', '查看總務庫存餘額'),
  ('general_affairs', 'inventory_transaction', 'general_affairs.inventory_transaction.view', 'view', '查看總務庫存流水'),
  ('general_affairs', 'inventory_transaction', 'general_affairs.inventory_transaction.manage', 'manage', '建立總務庫存交易')
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = true;

-- 2. Tables
CREATE TABLE IF NOT EXISTS public.ga_inventory_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id UUID NOT NULL REFERENCES public.ga_inventory_locations(id),
  part_id UUID NOT NULL REFERENCES public.ga_parts(id),
  quantity_base NUMERIC(18,4) NOT NULL DEFAULT 0,
  last_transaction_id UUID,
  last_transaction_at TIMESTAMPTZ,
  version BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT ga_inventory_balances_location_part_unique UNIQUE (location_id, part_id),
  CONSTRAINT ga_inventory_balances_version_nonnegative CHECK (version >= 0),
  CONSTRAINT ga_inventory_balances_last_transaction_pair CHECK (
    (last_transaction_id IS NULL AND last_transaction_at IS NULL)
    OR (last_transaction_id IS NOT NULL AND last_transaction_at IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.ga_inventory_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_no TEXT NOT NULL,
  transaction_type TEXT NOT NULL,
  location_id UUID NOT NULL REFERENCES public.ga_inventory_locations(id),
  part_id UUID NOT NULL REFERENCES public.ga_parts(id),
  quantity_input NUMERIC(18,4) NOT NULL,
  input_unit_type TEXT NOT NULL,
  unit_conversion_rate NUMERIC(18,6) NOT NULL,
  quantity_base NUMERIC(18,4) NOT NULL,
  balance_before NUMERIC(18,4) NOT NULL,
  balance_after NUMERIC(18,4) NOT NULL,
  reference_type TEXT,
  reference_id UUID,
  idempotency_key TEXT,
  idempotency_payload_hash TEXT,
  reason TEXT NOT NULL,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  CONSTRAINT ga_inventory_transactions_no_unique UNIQUE (transaction_no),
  CONSTRAINT ga_inventory_transactions_type_check
    CHECK (transaction_type IN ('RECEIPT', 'ISSUE', 'ADJUST_IN', 'ADJUST_OUT')),
  CONSTRAINT ga_inventory_transactions_input_unit_check
    CHECK (input_unit_type IN ('BASE', 'PURCHASE')),
  CONSTRAINT ga_inventory_transactions_quantity_input_positive
    CHECK (quantity_input > 0),
  CONSTRAINT ga_inventory_transactions_unit_conversion_positive
    CHECK (unit_conversion_rate > 0),
  CONSTRAINT ga_inventory_transactions_quantity_base_nonzero
    CHECK (quantity_base <> 0),
  CONSTRAINT ga_inventory_transactions_quantity_sign
    CHECK (
      (transaction_type IN ('RECEIPT', 'ADJUST_IN') AND quantity_base > 0)
      OR (transaction_type IN ('ISSUE', 'ADJUST_OUT') AND quantity_base < 0)
    ),
  CONSTRAINT ga_inventory_transactions_balance_math
    CHECK (balance_after = balance_before + quantity_base),
  CONSTRAINT ga_inventory_transactions_reason_not_blank
    CHECK (btrim(reason) <> ''),
  CONSTRAINT ga_inventory_transactions_metadata_object
    CHECK (jsonb_typeof(metadata) = 'object'),
  CONSTRAINT ga_inventory_transactions_idempotency_pair
    CHECK (
      (idempotency_key IS NULL AND idempotency_payload_hash IS NULL)
      OR (
        idempotency_key IS NOT NULL
        AND btrim(idempotency_key) <> ''
        AND idempotency_payload_hash IS NOT NULL
      )
    ),
  CONSTRAINT ga_inventory_transactions_reference_pair
    CHECK (
      reference_id IS NULL
      OR (reference_type IS NOT NULL AND btrim(reference_type) <> '')
    )
);

ALTER TABLE public.ga_inventory_balances
DROP CONSTRAINT IF EXISTS fk_ga_inventory_balances_last_transaction;

ALTER TABLE public.ga_inventory_balances
ADD CONSTRAINT fk_ga_inventory_balances_last_transaction
FOREIGN KEY (last_transaction_id)
REFERENCES public.ga_inventory_transactions(id);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_ga_inventory_balances_location
ON public.ga_inventory_balances(location_id);

CREATE INDEX IF NOT EXISTS idx_ga_inventory_balances_part
ON public.ga_inventory_balances(part_id);

CREATE INDEX IF NOT EXISTS idx_ga_inventory_balances_last_transaction_at
ON public.ga_inventory_balances(last_transaction_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ga_inventory_transactions_idempotency_active
ON public.ga_inventory_transactions(created_by, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ga_inventory_transactions_occurred_at
ON public.ga_inventory_transactions(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ga_inventory_transactions_location_occurred
ON public.ga_inventory_transactions(location_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ga_inventory_transactions_part_occurred
ON public.ga_inventory_transactions(part_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ga_inventory_transactions_type_occurred
ON public.ga_inventory_transactions(transaction_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_ga_inventory_transactions_reference
ON public.ga_inventory_transactions(reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_ga_inventory_transactions_created_by_occurred
ON public.ga_inventory_transactions(created_by, occurred_at DESC);

-- 4. Transaction number sequence / helper
CREATE SEQUENCE IF NOT EXISTS public.ga_inventory_transaction_no_seq
  AS BIGINT
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

CREATE OR REPLACE FUNCTION public.ga_next_inventory_transaction_no()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next BIGINT;
BEGIN
  v_next := nextval('public.ga_inventory_transaction_no_seq');
  RETURN 'INV-' || lpad(v_next::TEXT, 12, '0');
END;
$$;

-- 5. Visibility helpers for RLS
CREATE OR REPLACE FUNCTION public.ga_inventory_balance_is_visible(p_location_id UUID)
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
        current_user_has_permission('general_affairs.inventory_balance.view')
        OR current_user_has_permission('general_affairs.inventory_transaction.manage')
        OR (
          l.location_type = 'STORE'
          AND l.store_id IS NOT NULL
          AND current_user_manages_store(l.store_id)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.ga_inventory_transaction_is_visible(p_location_id UUID)
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
      AND (
        current_user_has_permission('general_affairs.inventory_transaction.view')
        OR current_user_has_permission('general_affairs.inventory_transaction.manage')
        OR (
          l.location_type = 'STORE'
          AND l.store_id IS NOT NULL
          AND current_user_manages_store(l.store_id)
        )
      )
  );
$$;

-- 6. Append-only trigger
CREATE OR REPLACE FUNCTION public.ga_prevent_inventory_transaction_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'INVENTORY_TRANSACTION_IMMUTABLE: 庫存流水不可修改或刪除';
END;
$$;

DROP TRIGGER IF EXISTS trg_ga_inventory_transactions_immutable ON public.ga_inventory_transactions;
CREATE TRIGGER trg_ga_inventory_transactions_immutable
  BEFORE UPDATE OR DELETE ON public.ga_inventory_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.ga_prevent_inventory_transaction_mutation();

-- 7. Main transaction RPC
CREATE OR REPLACE FUNCTION public.ga_post_inventory_transaction(
  p_transaction_type TEXT,
  p_location_id UUID,
  p_part_id UUID,
  p_quantity NUMERIC,
  p_input_unit_type TEXT,
  p_reason TEXT,
  p_notes TEXT DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_occurred_at TIMESTAMPTZ DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  transaction_id UUID,
  transaction_no TEXT,
  transaction_type TEXT,
  location_id UUID,
  part_id UUID,
  quantity_input NUMERIC,
  input_unit_type TEXT,
  unit_conversion_rate NUMERIC,
  quantity_base NUMERIC,
  balance_before NUMERIC,
  balance_after NUMERIC,
  occurred_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  created_by UUID,
  balance_id UUID,
  balance_quantity_base NUMERIC,
  balance_version BIGINT,
  idempotent_replay BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_transaction_type TEXT := upper(btrim(COALESCE(p_transaction_type, '')));
  v_input_unit_type TEXT := upper(btrim(COALESCE(p_input_unit_type, '')));
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
  v_notes TEXT := ga_normalize_optional_text(p_notes);
  v_reference_type TEXT := upper(ga_normalize_optional_text(p_reference_type));
  v_idempotency_key TEXT := ga_normalize_optional_text(p_idempotency_key);
  v_metadata JSONB := COALESCE(p_metadata, '{}'::jsonb);
  v_quantity_input NUMERIC := p_quantity;
  v_location public.ga_inventory_locations%ROWTYPE;
  v_part public.ga_parts%ROWTYPE;
  v_balance public.ga_inventory_balances%ROWTYPE;
  v_existing public.ga_inventory_transactions%ROWTYPE;
  v_rate NUMERIC(18,6);
  v_abs_base_unrounded NUMERIC;
  v_abs_base NUMERIC(18,4);
  v_signed_base NUMERIC(18,4);
  v_before NUMERIC(18,4);
  v_after NUMERIC(18,4);
  v_payload JSONB;
  v_payload_hash TEXT;
  v_transaction_no TEXT;
  v_transaction_id UUID;
  v_occurred_at TIMESTAMPTZ := COALESCE(p_occurred_at, NOW());
  v_created_at TIMESTAMPTZ := NOW();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: 請先登入';
  END IF;

  IF NOT current_user_has_permission('general_affairs.inventory_transaction.manage') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: 沒有庫存交易管理權限';
  END IF;

  IF NOT (
    current_user_has_permission('general_affairs.part.view')
    OR current_user_has_permission('general_affairs.part.manage')
  ) THEN
    RAISE EXCEPTION 'PART_VIEW_REQUIRED: 缺少 general_affairs.part.view，因此無法建立庫存交易';
  END IF;

  IF v_transaction_type NOT IN ('RECEIPT', 'ISSUE', 'ADJUST_IN', 'ADJUST_OUT') THEN
    RAISE EXCEPTION 'INVALID_TRANSACTION_TYPE: 庫存交易類型錯誤';
  END IF;

  IF v_input_unit_type NOT IN ('BASE', 'PURCHASE') THEN
    RAISE EXCEPTION 'INVALID_UNIT_TYPE: 庫存交易單位類型錯誤';
  END IF;

  IF v_quantity_input IS NULL OR v_quantity_input <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: 庫存交易數量必須大於 0';
  END IF;

  IF v_reason = '' THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: 請輸入庫存交易原因';
  END IF;

  IF jsonb_typeof(v_metadata) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: 庫存交易 metadata 必須是 JSON object';
  END IF;

  IF p_reference_id IS NOT NULL AND (v_reference_type IS NULL OR v_reference_type = '') THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: reference_id 有值時必須提供 reference_type';
  END IF;

  SELECT *
  INTO v_location
  FROM public.ga_inventory_locations
  WHERE id = p_location_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LOCATION_NOT_FOUND: 找不到庫存位置';
  END IF;

  IF v_location.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'LOCATION_NOT_FOUND: 此庫存位置已被刪除';
  END IF;

  IF v_location.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'LOCATION_INACTIVE: 此庫存位置已停用';
  END IF;

  SELECT *
  INTO v_part
  FROM public.ga_parts
  WHERE id = p_part_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PART_NOT_FOUND: 找不到料件';
  END IF;

  IF v_part.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'PART_NOT_FOUND: 此料件已被刪除';
  END IF;

  IF v_part.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'PART_INACTIVE: 此料件已停用';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.ga_inventory_location_parts lp
    WHERE lp.location_id = p_location_id
      AND lp.part_id = p_part_id
      AND lp.is_active = true
      AND lp.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'LOCATION_PART_NOT_CONFIGURED: 此庫存位置尚未啟用此料件設定';
  END IF;

  IF v_input_unit_type = 'BASE' THEN
    v_rate := 1;
  ELSE
    IF v_part.purchase_unit IS NULL OR v_part.purchase_to_base_rate IS NULL OR v_part.purchase_to_base_rate <= 0 THEN
      RAISE EXCEPTION 'INVALID_PURCHASE_UNIT: 此料件未設定有效採購單位換算率';
    END IF;
    v_rate := v_part.purchase_to_base_rate;
  END IF;

  v_abs_base_unrounded := v_quantity_input * v_rate;
  v_abs_base := round(v_abs_base_unrounded, 4);

  IF v_abs_base <> v_abs_base_unrounded THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: 換算後 base quantity 超過 4 位小數';
  END IF;

  IF v_abs_base <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: 換算後 base quantity 必須大於 0';
  END IF;

  IF v_part.allow_fractional_issue IS DISTINCT FROM true AND v_abs_base <> trunc(v_abs_base) THEN
    RAISE EXCEPTION 'FRACTIONAL_NOT_ALLOWED: 此料件不允許小數領用';
  END IF;

  IF v_transaction_type IN ('ISSUE', 'ADJUST_OUT') THEN
    IF v_part.minimum_issue_qty IS NOT NULL AND v_abs_base < v_part.minimum_issue_qty THEN
      RAISE EXCEPTION 'MINIMUM_ISSUE_NOT_MET: 低於最小領用量';
    END IF;

    IF v_part.allow_unpacking IS DISTINCT FROM true
      AND v_part.purchase_unit IS NOT NULL
      AND v_part.purchase_to_base_rate IS NOT NULL
      AND v_part.purchase_to_base_rate > 0
      AND mod(v_abs_base, v_part.purchase_to_base_rate) <> 0 THEN
      RAISE EXCEPTION 'UNPACKING_NOT_ALLOWED: 此料件不允許拆包領用';
    END IF;
  END IF;

  IF v_transaction_type IN ('RECEIPT', 'ADJUST_IN') THEN
    v_signed_base := v_abs_base;
  ELSE
    v_signed_base := -v_abs_base;
  END IF;

  v_payload := jsonb_build_object(
    'transaction_type', v_transaction_type,
    'location_id', p_location_id,
    'part_id', p_part_id,
    'quantity', v_quantity_input,
    'input_unit_type', v_input_unit_type,
    'reason', v_reason,
    'notes', v_notes,
    'reference_type', v_reference_type,
    'reference_id', p_reference_id,
    'occurred_at', p_occurred_at,
    'metadata', v_metadata
  );

  IF v_idempotency_key IS NOT NULL THEN
    v_payload_hash := md5(v_payload::TEXT);

    -- Advisory locks serialize same actor/key retries and same location/part stock movement.
    -- Hash collisions are theoretically possible; unique constraints and row locks remain the final correctness guard.
    PERFORM pg_advisory_xact_lock(hashtextextended('ga_inventory_idempotency:' || v_user_id::TEXT || ':' || v_idempotency_key, 0));
  ELSE
    v_payload_hash := NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('ga_inventory_location_part:' || p_location_id::TEXT || ':' || p_part_id::TEXT, 0));

  IF v_idempotency_key IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.ga_inventory_transactions t
    WHERE t.created_by = v_user_id
      AND t.idempotency_key = v_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      IF v_existing.idempotency_payload_hash = v_payload_hash THEN
        SELECT *
        INTO v_balance
        FROM public.ga_inventory_balances b
        WHERE b.location_id = v_existing.location_id
          AND b.part_id = v_existing.part_id;

        RETURN QUERY
        SELECT
          v_existing.id,
          v_existing.transaction_no,
          v_existing.transaction_type,
          v_existing.location_id,
          v_existing.part_id,
          v_existing.quantity_input,
          v_existing.input_unit_type,
          v_existing.unit_conversion_rate,
          v_existing.quantity_base,
          v_existing.balance_before,
          v_existing.balance_after,
          v_existing.occurred_at,
          v_existing.created_at,
          v_existing.created_by,
          v_balance.id,
          v_balance.quantity_base,
          v_balance.version,
          true;
        RETURN;
      END IF;

      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: idempotency_key 已被不同請求使用';
    END IF;
  END IF;

  INSERT INTO public.ga_inventory_balances (
    location_id,
    part_id,
    quantity_base,
    version,
    created_at,
    created_by,
    updated_at,
    updated_by
  )
  VALUES (
    p_location_id,
    p_part_id,
    0,
    0,
    v_created_at,
    v_user_id,
    v_created_at,
    v_user_id
  )
  ON CONFLICT ON CONSTRAINT ga_inventory_balances_location_part_unique DO NOTHING;

  SELECT *
  INTO v_balance
  FROM public.ga_inventory_balances b
  WHERE b.location_id = p_location_id
    AND b.part_id = p_part_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LOCATION_PART_NOT_CONFIGURED: 無法建立或鎖定庫存餘額';
  END IF;

  v_before := v_balance.quantity_base;
  v_after := v_before + v_signed_base;

  IF v_location.allow_negative_stock IS DISTINCT FROM true AND v_after < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: 庫存不足';
  END IF;

  v_transaction_id := gen_random_uuid();
  v_transaction_no := public.ga_next_inventory_transaction_no();

  INSERT INTO public.ga_inventory_transactions (
    id,
    transaction_no,
    transaction_type,
    location_id,
    part_id,
    quantity_input,
    input_unit_type,
    unit_conversion_rate,
    quantity_base,
    balance_before,
    balance_after,
    reference_type,
    reference_id,
    idempotency_key,
    idempotency_payload_hash,
    reason,
    notes,
    metadata,
    occurred_at,
    created_at,
    created_by
  )
  VALUES (
    v_transaction_id,
    v_transaction_no,
    v_transaction_type,
    p_location_id,
    p_part_id,
    v_quantity_input,
    v_input_unit_type,
    v_rate,
    v_signed_base,
    v_before,
    v_after,
    v_reference_type,
    p_reference_id,
    v_idempotency_key,
    v_payload_hash,
    v_reason,
    v_notes,
    v_metadata,
    v_occurred_at,
    v_created_at,
    v_user_id
  );

  UPDATE public.ga_inventory_balances
  SET
    quantity_base = v_after,
    last_transaction_id = v_transaction_id,
    last_transaction_at = v_occurred_at,
    version = version + 1,
    updated_at = v_created_at,
    updated_by = v_user_id
  WHERE id = v_balance.id
  RETURNING *
  INTO v_balance;

  RETURN QUERY
  SELECT
    v_transaction_id,
    v_transaction_no,
    v_transaction_type,
    p_location_id,
    p_part_id,
    v_quantity_input,
    v_input_unit_type,
    v_rate,
    v_signed_base,
    v_before,
    v_after,
    v_occurred_at,
    v_created_at,
    v_user_id,
    v_balance.id,
    v_balance.quantity_base,
    v_balance.version,
    false;
END;
$$;

-- 8. Grants
REVOKE ALL ON TABLE public.ga_inventory_balances FROM anon, authenticated;
REVOKE ALL ON TABLE public.ga_inventory_transactions FROM anon, authenticated;
GRANT SELECT ON TABLE public.ga_inventory_balances TO authenticated;
GRANT SELECT ON TABLE public.ga_inventory_transactions TO authenticated;

REVOKE ALL ON SEQUENCE public.ga_inventory_transaction_no_seq FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.ga_inventory_transaction_no_seq FROM anon;
REVOKE ALL ON SEQUENCE public.ga_inventory_transaction_no_seq FROM authenticated;
REVOKE ALL ON FUNCTION public.ga_next_inventory_transaction_no() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_next_inventory_transaction_no() FROM anon;
REVOKE ALL ON FUNCTION public.ga_next_inventory_transaction_no() FROM authenticated;
REVOKE ALL ON FUNCTION public.ga_inventory_balance_is_visible(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_inventory_transaction_is_visible(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_prevent_inventory_transaction_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_post_inventory_transaction(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_post_inventory_transaction(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.ga_post_inventory_transaction(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.ga_inventory_balance_is_visible(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_inventory_transaction_is_visible(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_post_inventory_transaction(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB) TO authenticated;

-- 9. RLS
ALTER TABLE public.ga_inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_inventory_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ga_inventory_balances_read" ON public.ga_inventory_balances;
CREATE POLICY "ga_inventory_balances_read" ON public.ga_inventory_balances
  FOR SELECT TO authenticated
  USING (
    ga_inventory_balance_is_visible(location_id)
  );

DROP POLICY IF EXISTS "ga_inventory_transactions_read" ON public.ga_inventory_transactions;
CREATE POLICY "ga_inventory_transactions_read" ON public.ga_inventory_transactions
  FOR SELECT TO authenticated
  USING (
    ga_inventory_transaction_is_visible(location_id)
  );

-- 不建立 INSERT / UPDATE / DELETE policy。
-- 庫存流水與餘額只能透過 SECURITY DEFINER RPC 受控寫入。
