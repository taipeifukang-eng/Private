#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const migration = read('supabase/migrations/20260904093000_general_affairs_inventory_transfers.sql');
const rollback = read('supabase/rollback_general_affairs_inventory_transfers.sql');
const page = read('app/general-affairs/inventory/transfers/page.tsx');
const client = read('components/general-affairs/inventory/InventoryTransfersClient.tsx');
const listApi = read('app/api/general-affairs/inventory/transfers/route.ts');
const actionApi = read('app/api/general-affairs/inventory/transfers/[id]/actions/route.ts');
const nav = read('components/general-affairs/navigation.tsx');
const features = read('components/general-affairs/features.ts');
const navbarPermissions = read('hooks/useNavbarPermissions.ts');

assert(migration.includes('CREATE TABLE IF NOT EXISTS public.ga_inventory_transfers'), 'migration must create transfer header table');
assert(migration.includes('CREATE TABLE IF NOT EXISTS public.ga_inventory_transfer_items'), 'migration must create transfer item table');
assert(migration.includes("'REQUESTED', 'SOURCE_CONFIRMED', 'IN_TRANSIT', 'RECEIVED', 'CANCELED'"), 'migration must constrain transfer statuses');
assert(migration.includes('source_transaction_id UUID REFERENCES public.ga_inventory_transactions'), 'items must link source issue transaction');
assert(migration.includes('receipt_transaction_id UUID REFERENCES public.ga_inventory_transactions'), 'items must link receiving transaction');
assert(migration.includes('general_affairs.inventory_transfer.view'), 'migration must add transfer view permission');
assert(migration.includes('general_affairs.inventory_transfer.manage'), 'migration must add transfer manage permission');
assert(migration.includes('ga_inventory_transfer_is_visible'), 'migration must include RLS visibility helper');
assert(migration.includes("NOTIFY pgrst, 'reload schema'"), 'migration must reload PostgREST schema');

assert(rollback.includes('DROP TABLE IF EXISTS public.ga_inventory_transfer_items'), 'rollback must drop transfer items');
assert(rollback.includes('DROP TABLE IF EXISTS public.ga_inventory_transfers'), 'rollback must drop transfers');
assert(!rollback.includes('DROP TABLE IF EXISTS public.ga_inventory_transactions'), 'rollback must not drop inventory ledger');
assert(!rollback.includes('DROP TABLE IF EXISTS public.ga_inventory_locations'), 'rollback must not drop inventory locations');

assert(page.includes('InventoryTransfersClient'), 'page must render InventoryTransfersClient');
assert(features.includes("inventory_transfer_receiving") && features.includes("status: 'available'"), 'transfer feature must be available');
assert(nav.includes("href: '/general-affairs/inventory/transfers'"), 'navigation must link transfer page');
assert(nav.includes('general_affairs.inventory_transfer.view'), 'navigation must include transfer view permission');
assert(nav.includes('general_affairs.inventory_transfer.manage'), 'navigation must include transfer manage permission');
assert(navbarPermissions.includes('general_affairs.inventory_transfer.view'), 'top navbar permissions must include transfer view');
assert(navbarPermissions.includes('general_affairs.inventory_transfer.manage'), 'top navbar permissions must include transfer manage');

assert(listApi.includes("from('ga_inventory_transfers')"), 'list API must query transfers');
assert(listApi.includes("from('ga_inventory_transfer_items')"), 'create API must insert transfer items');
assert(listApi.includes('validateInventoryTransferCreatePayload'), 'create API must validate payload');
assert(listApi.includes('canManageInventoryTransfers'), 'create API must enforce transfer manage permission');

assert(actionApi.includes("p_transaction_type: 'ISSUE'"), 'source confirmation must post ISSUE transaction');
assert(actionApi.includes("p_transaction_type: 'RECEIPT'"), 'receiving must post RECEIPT transaction');
assert(actionApi.includes("p_reference_type: 'INVENTORY_TRANSFER'"), 'transfer transactions must reference the transfer');
assert(actionApi.includes("status: 'SOURCE_CONFIRMED'"), 'source confirmation must update status');
assert(actionApi.includes("status: 'IN_TRANSIT'"), 'mark in transit must update status');
assert(actionApi.includes("status: 'RECEIVED'"), 'receiving must update status');
assert(actionApi.includes('尚未完成來源交出，不可收貨'), 'receiving must block before source issue');
assert(actionApi.includes('idempotencyKey'), 'actions must require idempotency keys');

assert(client.includes('調撥與收貨'), 'UI must label transfer and receiving page');
assert(client.includes('建立調撥單'), 'UI must include create transfer form');
assert(client.includes('確認交出'), 'UI must expose source confirmation action');
assert(client.includes('確認收貨'), 'UI must expose receiving action');
assert(client.includes('TRANSFER_EXCEPTION_TYPES'), 'UI must define transfer exception types');
assert(client.includes('少收') && client.includes('未收') && client.includes('破損') && client.includes('收錯') && client.includes('取消'), 'UI must cover practical transfer exceptions');
assert(client.includes('回報異常'), 'UI must expose transfer exception action');
assert(client.includes('送出異常並停止入庫'), 'UI must stop receiving when exception is submitted');
assert(client.includes('調撥異常：'), 'UI must persist exception type in cancel reason');
assert(client.includes('parseTransferException'), 'UI must parse transfer exception cancel reasons');
assert(client.includes('異常 / 取消'), 'UI must expose exception and canceled transfer filter card');
assert(client.includes('異常停止：'), 'UI must show stopped-by-exception transfer step');
assert(client.includes('異常說明：'), 'UI must show exception note on transfer cards');
assert(client.includes('來源確認時扣庫存，目的收貨時入庫'), 'UI must explain stock timing');
assert(client.includes('目的位置尚未啟用此料件設定'), 'UI must guard destination location part setup');
assert(client.includes('/api/general-affairs/inventory/options'), 'UI must use inventory options');
assert(client.includes('/api/general-affairs/inventory/transfers'), 'UI must call transfer API');

console.log('General affairs inventory transfers static tests passed');
