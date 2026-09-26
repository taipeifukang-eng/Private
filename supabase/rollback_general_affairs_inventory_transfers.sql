-- Rollback General Affairs Inventory Transfers - Task 1C-3
-- Only removes transfer/receiving objects introduced by this task.

DROP POLICY IF EXISTS ga_inventory_transfer_items_update_manage ON public.ga_inventory_transfer_items;
DROP POLICY IF EXISTS ga_inventory_transfer_items_insert_manage ON public.ga_inventory_transfer_items;
DROP POLICY IF EXISTS ga_inventory_transfer_items_read ON public.ga_inventory_transfer_items;
DROP POLICY IF EXISTS ga_inventory_transfers_update_manage ON public.ga_inventory_transfers;
DROP POLICY IF EXISTS ga_inventory_transfers_insert_manage ON public.ga_inventory_transfers;
DROP POLICY IF EXISTS ga_inventory_transfers_read ON public.ga_inventory_transfers;

DROP TRIGGER IF EXISTS trg_ga_inventory_transfer_items_updated_at ON public.ga_inventory_transfer_items;
DROP TRIGGER IF EXISTS trg_ga_inventory_transfers_updated_at ON public.ga_inventory_transfers;

DROP FUNCTION IF EXISTS public.ga_inventory_transfer_is_visible(UUID);
DROP FUNCTION IF EXISTS public.ga_touch_inventory_transfer_updated_at();
DROP FUNCTION IF EXISTS public.ga_next_inventory_transfer_no();

DROP TABLE IF EXISTS public.ga_inventory_transfer_items;
DROP TABLE IF EXISTS public.ga_inventory_transfers;
DROP SEQUENCE IF EXISTS public.ga_inventory_transfer_no_seq;

UPDATE public.permissions
SET is_active = false
WHERE code IN (
  'general_affairs.inventory_transfer.view',
  'general_affairs.inventory_transfer.manage'
);

NOTIFY pgrst, 'reload schema';
