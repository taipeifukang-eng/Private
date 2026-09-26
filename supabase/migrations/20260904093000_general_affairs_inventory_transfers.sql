-- ============================================================
-- General Affairs Inventory Transfers - Task 1C-3
--
-- Included:
--   ga_inventory_transfers, ga_inventory_transfer_items,
--   transfer/receiving permissions, status constraints, RLS.
--
-- Inventory balance movement is still posted through
-- ga_post_inventory_transaction so transfers reuse the append-only
-- inventory ledger foundation.
-- ============================================================

DO $$
DECLARE
  v_missing TEXT[];
BEGIN
  SELECT array_remove(ARRAY[
    CASE WHEN to_regclass('public.permissions') IS NULL THEN 'table public.permissions' END,
    CASE WHEN to_regclass('public.profiles') IS NULL THEN 'table public.profiles' END,
    CASE WHEN to_regclass('public.ga_parts') IS NULL THEN 'table public.ga_parts' END,
    CASE WHEN to_regclass('public.ga_inventory_locations') IS NULL THEN 'table public.ga_inventory_locations' END,
    CASE WHEN to_regclass('public.ga_inventory_transactions') IS NULL THEN 'table public.ga_inventory_transactions' END,
    CASE WHEN to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN 'function public.current_user_has_permission(varchar)' END,
    CASE WHEN to_regprocedure('public.ga_inventory_location_is_visible(uuid)') IS NULL THEN 'function public.ga_inventory_location_is_visible(uuid)' END,
    CASE WHEN to_regprocedure('public.ga_normalize_optional_text(text)') IS NULL THEN 'function public.ga_normalize_optional_text(text)' END
  ], NULL)
  INTO v_missing;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Task 1C-3 inventory transfer migration prerequisites missing: %', array_to_string(v_missing, ', ');
  END IF;
END $$;

INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('general_affairs', 'inventory_transfer', 'general_affairs.inventory_transfer.view', 'view', '查看總務調撥與收貨單'),
  ('general_affairs', 'inventory_transfer', 'general_affairs.inventory_transfer.manage', 'manage', '建立與處理總務調撥與收貨單')
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = true;

CREATE SEQUENCE IF NOT EXISTS public.ga_inventory_transfer_no_seq
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

CREATE OR REPLACE FUNCTION public.ga_next_inventory_transfer_no()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next BIGINT;
BEGIN
  v_next := nextval('public.ga_inventory_transfer_no_seq');
  RETURN 'GAT-' || to_char(NOW(), 'YYYYMMDD') || '-' || lpad(v_next::TEXT, 5, '0');
END;
$$;

CREATE TABLE IF NOT EXISTS public.ga_inventory_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_no TEXT NOT NULL DEFAULT public.ga_next_inventory_transfer_no(),
  source_location_id UUID NOT NULL REFERENCES public.ga_inventory_locations(id),
  destination_location_id UUID NOT NULL REFERENCES public.ga_inventory_locations(id),
  status TEXT NOT NULL DEFAULT 'REQUESTED',
  reason TEXT NOT NULL,
  notes TEXT,
  shipping_method TEXT,
  source_confirmed_at TIMESTAMPTZ,
  source_confirmed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  shipped_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  received_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  canceled_at TIMESTAMPTZ,
  canceled_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT ga_inventory_transfers_no_unique UNIQUE (transfer_no),
  CONSTRAINT ga_inventory_transfers_status_check
    CHECK (status IN ('REQUESTED', 'SOURCE_CONFIRMED', 'IN_TRANSIT', 'RECEIVED', 'CANCELED')),
  CONSTRAINT ga_inventory_transfers_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT ga_inventory_transfers_distinct_locations CHECK (source_location_id <> destination_location_id),
  CONSTRAINT ga_inventory_transfers_cancel_reason
    CHECK (status <> 'CANCELED' OR btrim(COALESCE(cancel_reason, '')) <> '')
);

CREATE TABLE IF NOT EXISTS public.ga_inventory_transfer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES public.ga_inventory_transfers(id) ON DELETE CASCADE,
  part_id UUID NOT NULL REFERENCES public.ga_parts(id),
  quantity_input NUMERIC(18,4) NOT NULL,
  input_unit_type TEXT NOT NULL DEFAULT 'BASE',
  notes TEXT,
  source_transaction_id UUID REFERENCES public.ga_inventory_transactions(id),
  receipt_transaction_id UUID REFERENCES public.ga_inventory_transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT ga_inventory_transfer_items_unit_check CHECK (input_unit_type IN ('BASE', 'PURCHASE')),
  CONSTRAINT ga_inventory_transfer_items_qty_positive CHECK (quantity_input > 0),
  CONSTRAINT ga_inventory_transfer_items_part_unique UNIQUE (transfer_id, part_id)
);

CREATE INDEX IF NOT EXISTS idx_ga_inventory_transfers_status
ON public.ga_inventory_transfers(status, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_inventory_transfers_source
ON public.ga_inventory_transfers(source_location_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_inventory_transfers_destination
ON public.ga_inventory_transfers(destination_location_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ga_inventory_transfer_items_transfer
ON public.ga_inventory_transfer_items(transfer_id);

CREATE INDEX IF NOT EXISTS idx_ga_inventory_transfer_items_part
ON public.ga_inventory_transfer_items(part_id);

CREATE OR REPLACE FUNCTION public.ga_touch_inventory_transfer_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ga_inventory_transfers_updated_at ON public.ga_inventory_transfers;
CREATE TRIGGER trg_ga_inventory_transfers_updated_at
BEFORE UPDATE ON public.ga_inventory_transfers
FOR EACH ROW EXECUTE FUNCTION public.ga_touch_inventory_transfer_updated_at();

DROP TRIGGER IF EXISTS trg_ga_inventory_transfer_items_updated_at ON public.ga_inventory_transfer_items;
CREATE TRIGGER trg_ga_inventory_transfer_items_updated_at
BEFORE UPDATE ON public.ga_inventory_transfer_items
FOR EACH ROW EXECUTE FUNCTION public.ga_touch_inventory_transfer_updated_at();

CREATE OR REPLACE FUNCTION public.ga_inventory_transfer_is_visible(p_transfer_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.ga_inventory_transfers t
    WHERE t.id = p_transfer_id
      AND t.deleted_at IS NULL
      AND (
        public.current_user_has_permission('general_affairs.inventory_transfer.view')
        OR public.current_user_has_permission('general_affairs.inventory_transfer.manage')
        OR public.current_user_has_permission('general_affairs.inventory_transaction.view')
        OR public.current_user_has_permission('general_affairs.inventory_transaction.manage')
        OR public.ga_inventory_location_is_visible(t.source_location_id)
        OR public.ga_inventory_location_is_visible(t.destination_location_id)
      )
  );
$$;

REVOKE ALL ON TABLE public.ga_inventory_transfers FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ga_inventory_transfer_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ga_inventory_transfers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.ga_inventory_transfer_items TO authenticated;
GRANT ALL ON TABLE public.ga_inventory_transfers TO service_role;
GRANT ALL ON TABLE public.ga_inventory_transfer_items TO service_role;

REVOKE ALL ON SEQUENCE public.ga_inventory_transfer_no_seq FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_next_inventory_transfer_no() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_touch_inventory_transfer_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_inventory_transfer_is_visible(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ga_inventory_transfer_is_visible(UUID) TO authenticated;

ALTER TABLE public.ga_inventory_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ga_inventory_transfer_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ga_inventory_transfers_read ON public.ga_inventory_transfers;
CREATE POLICY ga_inventory_transfers_read ON public.ga_inventory_transfers
FOR SELECT TO authenticated
USING (public.ga_inventory_transfer_is_visible(id));

DROP POLICY IF EXISTS ga_inventory_transfers_insert_manage ON public.ga_inventory_transfers;
CREATE POLICY ga_inventory_transfers_insert_manage ON public.ga_inventory_transfers
FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_permission('general_affairs.inventory_transfer.manage'));

DROP POLICY IF EXISTS ga_inventory_transfers_update_manage ON public.ga_inventory_transfers;
CREATE POLICY ga_inventory_transfers_update_manage ON public.ga_inventory_transfers
FOR UPDATE TO authenticated
USING (public.current_user_has_permission('general_affairs.inventory_transfer.manage'))
WITH CHECK (public.current_user_has_permission('general_affairs.inventory_transfer.manage'));

DROP POLICY IF EXISTS ga_inventory_transfer_items_read ON public.ga_inventory_transfer_items;
CREATE POLICY ga_inventory_transfer_items_read ON public.ga_inventory_transfer_items
FOR SELECT TO authenticated
USING (public.ga_inventory_transfer_is_visible(transfer_id));

DROP POLICY IF EXISTS ga_inventory_transfer_items_insert_manage ON public.ga_inventory_transfer_items;
CREATE POLICY ga_inventory_transfer_items_insert_manage ON public.ga_inventory_transfer_items
FOR INSERT TO authenticated
WITH CHECK (public.current_user_has_permission('general_affairs.inventory_transfer.manage'));

DROP POLICY IF EXISTS ga_inventory_transfer_items_update_manage ON public.ga_inventory_transfer_items;
CREATE POLICY ga_inventory_transfer_items_update_manage ON public.ga_inventory_transfer_items
FOR UPDATE TO authenticated
USING (public.current_user_has_permission('general_affairs.inventory_transfer.manage'))
WITH CHECK (public.current_user_has_permission('general_affairs.inventory_transfer.manage'));

NOTIFY pgrst, 'reload schema';
