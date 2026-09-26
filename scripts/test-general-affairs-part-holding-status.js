#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const migration = read('supabase/migrations/20260925093000_general_affairs_part_holding_status.sql');
const balancesRoute = read('app/api/general-affairs/inventory/balances/route.ts');
const holdingRoute = read('app/api/general-affairs/inventory/balances/[id]/holding/route.ts');
const client = read('components/general-affairs/inventory/InventoryTransactionsClient.tsx');

[
  'ga_inventory_holding_allocations',
  'ga_inventory_holding_events',
  'ga_set_inventory_holding_allocation',
  'HOLDING_EXCEEDS_BALANCE',
  'p_in_use_quantity + p_idle_quantity > GREATEST(v_balance.quantity_base, 0)',
  'ga_reconcile_inventory_holding_allocation',
  'AFTER UPDATE OF quantity_base',
  'current_user_has_permission',
  'ENABLE ROW LEVEL SECURITY',
  'DROP POLICY IF EXISTS ga_inventory_holding_allocations_read',
  'DROP POLICY IF EXISTS ga_inventory_holding_events_read',
  'ga_inventory_balance_is_visible',
  "NOTIFY pgrst, 'reload schema'",
].forEach((needle) => assert(migration.includes(needle), `holding migration missing ${needle}`));

assert(migration.includes('GRANT SELECT ON TABLE public.ga_inventory_holding_allocations TO authenticated'), 'authenticated users need scoped holding reads');
assert(!migration.includes('GRANT INSERT, UPDATE ON TABLE public.ga_inventory_holding_allocations TO authenticated'), 'holding writes must only use the validated RPC');
assert(holdingRoute.includes('canPostInventoryTransactions()'), 'holding update API must require inventory manage permission');
assert(holdingRoute.includes("rpc('ga_set_inventory_holding_allocation'"), 'holding update API must use validated RPC');
assert(balancesRoute.includes("from('ga_inventory_holding_allocations')"), 'balance API must include holding allocations');
assert(balancesRoute.includes('unclassified_quantity'), 'balance API must derive unclassified quantity');
assert(client.includes('in_use_quantity') && client.includes('idle_quantity') && client.includes('unclassified_quantity'), 'holding UI must show all quantity buckets');
assert(client.includes('使用中與閒置合計不可超過持有量'), 'holding UI must validate allocation total');

console.log('General affairs part holding status checks passed.');
