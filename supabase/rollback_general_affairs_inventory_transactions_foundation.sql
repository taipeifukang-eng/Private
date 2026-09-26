-- ============================================================
-- Rollback - General Affairs Inventory Transactions Foundation - Task 1C-2B
-- DEV/STAGING only unless explicitly approved for Production.
-- Does not remove Task 1C-1 locations, Task 1B parts, profiles,
-- stores, store_managers, or RBAC baseline tables.
-- ============================================================

-- 1. Remove role permission assignments for Task 1C-2B permission codes.
DELETE FROM role_permissions
WHERE permission_id IN (
  SELECT id
  FROM permissions
  WHERE code IN (
    'general_affairs.inventory_balance.view',
    'general_affairs.inventory_transaction.view',
    'general_affairs.inventory_transaction.manage'
  )
);

-- 2. Policies.
DROP POLICY IF EXISTS "ga_inventory_transactions_read" ON public.ga_inventory_transactions;
DROP POLICY IF EXISTS "ga_inventory_balances_read" ON public.ga_inventory_balances;

-- 3. Grants.
REVOKE ALL ON FUNCTION public.ga_post_inventory_transaction(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_inventory_transaction_is_visible(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_inventory_balance_is_visible(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ga_next_inventory_transaction_no() FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.ga_inventory_transaction_no_seq FROM PUBLIC;

-- 4. Triggers.
DROP TRIGGER IF EXISTS trg_ga_inventory_transactions_immutable ON public.ga_inventory_transactions;

-- 5. Functions / RPC.
DROP FUNCTION IF EXISTS public.ga_post_inventory_transaction(TEXT, UUID, UUID, NUMERIC, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, JSONB);
DROP FUNCTION IF EXISTS public.ga_prevent_inventory_transaction_mutation();
DROP FUNCTION IF EXISTS public.ga_inventory_transaction_is_visible(UUID);
DROP FUNCTION IF EXISTS public.ga_inventory_balance_is_visible(UUID);
DROP FUNCTION IF EXISTS public.ga_next_inventory_transaction_no();

-- 6. Circular FK and tables.
ALTER TABLE IF EXISTS public.ga_inventory_balances
DROP CONSTRAINT IF EXISTS fk_ga_inventory_balances_last_transaction;

DROP TABLE IF EXISTS public.ga_inventory_transactions;
DROP TABLE IF EXISTS public.ga_inventory_balances;

-- 7. Sequence.
DROP SEQUENCE IF EXISTS public.ga_inventory_transaction_no_seq;

-- 8. Permission codes.
DELETE FROM permissions
WHERE code IN (
  'general_affairs.inventory_balance.view',
  'general_affairs.inventory_transaction.view',
  'general_affairs.inventory_transaction.manage'
);
