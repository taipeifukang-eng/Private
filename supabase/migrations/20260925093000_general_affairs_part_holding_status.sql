-- Track how each location's on-hand part quantity is currently used.
-- Unclassified quantity is derived as balance - in_use - idle.

CREATE TABLE IF NOT EXISTS public.ga_inventory_holding_allocations (
  balance_id UUID PRIMARY KEY REFERENCES public.ga_inventory_balances(id) ON DELETE CASCADE,
  in_use_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (in_use_quantity >= 0),
  idle_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (idle_quantity >= 0),
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.ga_inventory_holding_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  balance_id UUID NOT NULL REFERENCES public.ga_inventory_balances(id) ON DELETE CASCADE,
  before_in_use_quantity NUMERIC(18,4) NOT NULL,
  before_idle_quantity NUMERIC(18,4) NOT NULL,
  after_in_use_quantity NUMERIC(18,4) NOT NULL,
  after_idle_quantity NUMERIC(18,4) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ga_inventory_holding_events_balance_created
ON public.ga_inventory_holding_events(balance_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.ga_set_inventory_holding_allocation(
  p_balance_id UUID,
  p_in_use_quantity NUMERIC,
  p_idle_quantity NUMERIC,
  p_notes TEXT DEFAULT NULL
)
RETURNS public.ga_inventory_holding_allocations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_balance public.ga_inventory_balances%ROWTYPE;
  v_before public.ga_inventory_holding_allocations%ROWTYPE;
  v_after public.ga_inventory_holding_allocations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: 請先登入';
  END IF;
  IF NOT public.current_user_has_permission('general_affairs.inventory_transaction.manage') THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: 沒有庫存狀態管理權限';
  END IF;
  IF p_in_use_quantity IS NULL OR p_idle_quantity IS NULL
     OR p_in_use_quantity < 0 OR p_idle_quantity < 0 THEN
    RAISE EXCEPTION 'INVALID_HOLDING_QUANTITY: 數量不可為負數';
  END IF;

  SELECT * INTO v_balance
  FROM public.ga_inventory_balances
  WHERE id = p_balance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'BALANCE_NOT_FOUND: 找不到庫存餘額';
  END IF;
  IF p_in_use_quantity + p_idle_quantity > GREATEST(v_balance.quantity_base, 0) THEN
    RAISE EXCEPTION 'HOLDING_EXCEEDS_BALANCE: 使用中與閒置數量不可超過實際持有量';
  END IF;

  SELECT * INTO v_before
  FROM public.ga_inventory_holding_allocations
  WHERE balance_id = p_balance_id;

  INSERT INTO public.ga_inventory_holding_allocations (
    balance_id, in_use_quantity, idle_quantity, notes, updated_at, updated_by
  ) VALUES (
    p_balance_id, p_in_use_quantity, p_idle_quantity,
    public.ga_normalize_optional_text(p_notes), NOW(), v_user_id
  )
  ON CONFLICT (balance_id) DO UPDATE SET
    in_use_quantity = EXCLUDED.in_use_quantity,
    idle_quantity = EXCLUDED.idle_quantity,
    notes = EXCLUDED.notes,
    updated_at = NOW(),
    updated_by = v_user_id
  RETURNING * INTO v_after;

  INSERT INTO public.ga_inventory_holding_events (
    balance_id, before_in_use_quantity, before_idle_quantity,
    after_in_use_quantity, after_idle_quantity, notes, created_by
  ) VALUES (
    p_balance_id, COALESCE(v_before.in_use_quantity, 0), COALESCE(v_before.idle_quantity, 0),
    v_after.in_use_quantity, v_after.idle_quantity, v_after.notes, v_user_id
  );

  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.ga_reconcile_inventory_holding_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_available NUMERIC(18,4) := GREATEST(NEW.quantity_base, 0);
BEGIN
  UPDATE public.ga_inventory_holding_allocations
  SET
    in_use_quantity = LEAST(in_use_quantity, v_available),
    idle_quantity = LEAST(idle_quantity, GREATEST(v_available - LEAST(in_use_quantity, v_available), 0)),
    updated_at = NOW(),
    updated_by = NEW.updated_by
  WHERE balance_id = NEW.id
    AND in_use_quantity + idle_quantity > v_available;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ga_inventory_balance_reconcile_holding ON public.ga_inventory_balances;
CREATE TRIGGER trg_ga_inventory_balance_reconcile_holding
AFTER UPDATE OF quantity_base ON public.ga_inventory_balances
FOR EACH ROW EXECUTE FUNCTION public.ga_reconcile_inventory_holding_allocation();

REVOKE ALL ON TABLE public.ga_inventory_holding_allocations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ga_inventory_holding_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ga_inventory_holding_allocations TO authenticated;
GRANT SELECT ON TABLE public.ga_inventory_holding_events TO authenticated;
GRANT ALL ON TABLE public.ga_inventory_holding_allocations TO service_role;
GRANT ALL ON TABLE public.ga_inventory_holding_events TO service_role;

ALTER TABLE public.ga_inventory_holding_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_inventory_holding_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ga_inventory_holding_allocations_read ON public.ga_inventory_holding_allocations;
CREATE POLICY ga_inventory_holding_allocations_read ON public.ga_inventory_holding_allocations
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.ga_inventory_balances b
    WHERE b.id = balance_id
      AND public.ga_inventory_balance_is_visible(b.location_id)
  )
);

DROP POLICY IF EXISTS ga_inventory_holding_events_read ON public.ga_inventory_holding_events;
CREATE POLICY ga_inventory_holding_events_read ON public.ga_inventory_holding_events
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.ga_inventory_balances b
    WHERE b.id = balance_id
      AND public.ga_inventory_balance_is_visible(b.location_id)
  )
);

REVOKE ALL ON FUNCTION public.ga_set_inventory_holding_allocation(UUID, NUMERIC, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ga_set_inventory_holding_allocation(UUID, NUMERIC, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ga_set_inventory_holding_allocation(UUID, NUMERIC, NUMERIC, TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
