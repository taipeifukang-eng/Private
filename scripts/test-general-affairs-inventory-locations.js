const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function findMigrationBySuffix(suffix) {
  const migrationDir = path.join(root, 'supabase', 'migrations');
  if (!fs.existsSync(migrationDir)) return null;
  const match = fs
    .readdirSync(migrationDir)
    .filter((file) => file.endsWith(suffix))
    .sort()
    .at(-1);
  return match ? path.join('supabase', 'migrations', match) : null;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const migration = read('supabase/migration_general_affairs_inventory_locations.sql');
const cascadeReasonFixMigrationPath = findMigrationBySuffix('_fix_inventory_location_cascade_deletion_reason.sql');
const cascadeReasonFixMigration = cascadeReasonFixMigrationPath ? read(cascadeReasonFixMigrationPath) : '';
const rollback = read('supabase/rollback_general_affairs_inventory_locations.sql');
const testSql = read('supabase/test_general_affairs_inventory_locations.sql');
const validation = read('lib/general-affairs/inventory/locations/validation.ts');
const access = read('lib/general-affairs/inventory/locations/access.ts');
const listRoute = read('app/api/general-affairs/inventory/locations/route.ts');
const itemRoute = read('app/api/general-affairs/inventory/locations/[id]/route.ts');
const partsRoute = read('app/api/general-affairs/inventory/locations/[id]/parts/route.ts');
const partItemRoute = read('app/api/general-affairs/inventory/locations/[id]/parts/[locationPartId]/route.ts');
const client = read('components/general-affairs/inventory/InventoryLocationsClient.tsx');

[
  'general_affairs.inventory_location.view',
  'general_affairs.inventory_location.manage',
  'ga_inventory_locations',
  'ga_inventory_location_parts',
  'Task 1C-1 inventory location migration prerequisites missing',
  'public.ga_parts from Task 1B-3',
  'public.ga_normalize_optional_text(text)',
  'current_user_manages_store',
  'ga_inventory_location_is_visible',
  'ga_validate_inventory_location',
  'ga_validate_inventory_location_part',
  'ga_soft_delete_inventory_location',
  'ga_soft_delete_inventory_location_part',
  'SET search_path = public, pg_temp',
  'current_user_has_permission',
  'auth.uid()',
].forEach((needle) => assert(migration.includes(needle), `migration missing ${needle}`));

[
  'CENTRAL_WAREHOUSE',
  'STORE',
  'OFFICE',
  'TEMPORARY',
  'OTHER',
  'preferred_issue_unit_type',
  'BASE',
  'PURCHASE',
  'uq_ga_inventory_locations_code_active',
  'uq_ga_inventory_locations_default_store',
  'uq_ga_inventory_locations_default_central',
  'uq_ga_inventory_location_parts_location_part_active',
].forEach((needle) => assert(migration.includes(needle), `migration missing rule ${needle}`));

assert(!/CREATE\s+TABLE[^;]+ga_inventory_transactions/i.test(migration), 'Task 1C-1 must not create inventory transactions');
assert(!/CREATE\s+TABLE[^;]+ga_inventory_balances/i.test(migration), 'Task 1C-1 must not create inventory balances');
assert(!/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(public\.)?ga_.*purchase/i.test(migration), 'Task 1C-1 must not create purchasing tables');
assert(!/CREATE\s+TABLE[^;]+transfer/i.test(migration), 'Task 1C-1 must not create transfer tables');
assert(!/ALTER\s+TABLE[^;]+work_orders?/i.test(migration), 'Task 1C-1 must not alter work orders');
assert(!migration.includes('FOR DELETE TO authenticated'), 'inventory locations must not expose hard delete policies');
assert(migration.includes('NEW.created_by := auth.uid()'), 'DB trigger must own created_by');
assert(migration.includes('NEW.updated_by := auth.uid()'), 'DB trigger must own updated_by');
assert(migration.includes('NEW.created_by := OLD.created_by'), 'DB trigger must preserve created_by on update');
assert(migration.includes("current_setting('app.ga_soft_delete_inventory_location'"), 'location trigger must distinguish soft delete RPC');
assert(migration.includes("current_setting('app.ga_soft_delete_inventory_location_part'"), 'location part trigger must distinguish soft delete RPC');
assert(migration.includes('後續建立交易表後'), 'migration must document future transaction protection');
assert(!migration.includes('父庫存位置刪除衍生：'), 'source migration must not prefix cascade deletion_reason');
assert(/UPDATE\s+public\.ga_inventory_location_parts[\s\S]+deletion_reason\s*=\s*v_reason[\s\S]+WHERE\s+location_id\s*=\s*p_location_id[\s\S]+AND\s+deleted_at\s+IS\s+NULL/i.test(migration), 'source migration must cascade child deletion_reason exactly from parent reason and only update undeleted children');
assert(cascadeReasonFixMigrationPath, 'forward fix migration for cascade deletion_reason missing');
assert(cascadeReasonFixMigration.includes('CREATE OR REPLACE FUNCTION public.ga_soft_delete_inventory_location'), 'forward fix must replace only inventory location soft delete function');
assert(!cascadeReasonFixMigration.includes('父庫存位置刪除衍生：'), 'forward fix must remove cascade deletion_reason prefix');
assert(/UPDATE\s+public\.ga_inventory_location_parts[\s\S]+deletion_reason\s*=\s*v_reason[\s\S]+WHERE\s+location_id\s*=\s*p_location_id[\s\S]+AND\s+deleted_at\s+IS\s+NULL/i.test(cascadeReasonFixMigration), 'forward fix must cascade child deletion_reason exactly from parent reason and only update undeleted children');
assert(!/CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+POLICY|DROP\s+POLICY|CREATE\s+INDEX|DROP\s+INDEX/i.test(cascadeReasonFixMigration), 'forward fix must not change tables, indexes, constraints, or RLS policies');

assert(rollback.includes('public.ga_inventory_location_parts'), 'rollback must use schema-qualified location part table');
assert(rollback.includes('public.ga_inventory_locations'), 'rollback must use schema-qualified location table');
assert(rollback.includes('DELETE FROM role_permissions'), 'rollback must remove role permission assignments first');
assert(!rollback.includes('DROP TABLE IF EXISTS public.ga_parts'), 'rollback must not remove Task 1B-3 parts');
assert(!rollback.includes('DROP TABLE IF EXISTS public.stores'), 'rollback must not remove stores');
assert(testSql.includes('DEV-1C-1'), 'manual test SQL must use DEV-only test data');
assert(testSql.includes('DEV 測試資料清理'), 'manual test SQL must document cleanup');

assert(access.includes("INVENTORY_LOCATION_MANAGE_PERMISSION = 'general_affairs.inventory_location.manage'"), 'access must use RBAC manage permission');
assert(!access.includes('profiles.role'), 'access must not use profiles.role');

assert(validation.includes('SYSTEM_FIELDS'), 'validation must reject system fields');
assert(validation.includes('STORE 類型必須選擇門市'), 'validation must enforce STORE/store pairing');
assert(validation.includes('非 STORE 類型不得設定門市'), 'validation must enforce non-STORE/store pairing');
assert(validation.includes('安全庫存不可大於補貨點'), 'validation must enforce qty order');
assert(validation.includes('偏好領用單位類型錯誤'), 'validation must validate preferred unit type');

assert(!itemRoute.includes('.delete()'), 'location DELETE route must not hard delete');
assert(itemRoute.includes("rpc('ga_soft_delete_inventory_location'"), 'location DELETE route must call soft delete RPC');
assert(!partItemRoute.includes('.delete()'), 'location part DELETE route must not hard delete');
assert(partItemRoute.includes("rpc('ga_soft_delete_inventory_location_part'"), 'location part DELETE route must call soft delete RPC');
assert(listRoute.includes("searchParams.get('locationType')"), 'location API must support locationType');
assert(listRoute.includes("searchParams.get('storeId')"), 'location API must support storeId');
assert(listRoute.includes("searchParams.get('isActive')"), 'location API must support isActive');
assert(partsRoute.includes('resolvedPreferredIssueUnit'), 'location parts API must resolve preferred unit display');

assert(exists('app/general-affairs/inventory/locations/page.tsx'), 'inventory locations page missing');
assert(client.includes('未儲存'), 'UI must include unsaved-change warning');
assert(client.includes('沒有庫存位置權限'), 'UI must include permission denied state');
assert(client.includes('Loader2'), 'UI must include loading state');
assert(client.includes('預設位置'), 'UI must expose default location setting');
assert(client.includes('允許負庫存政策'), 'UI must expose negative stock policy');
assert(client.includes('位置料件設定'), 'UI must include location part settings');
assert(client.includes('缺少 general_affairs.part.view，因此無法新增位置料件設定'), 'UI must explain missing part.view permission');
assert(client.includes('安全庫存'), 'UI must include safety stock');
assert(client.includes('補貨點'), 'UI must include reorder point');
assert(client.includes('最高庫存'), 'UI must include maximum stock');
assert(!client.includes('實際庫存數量'), 'UI must not display actual inventory quantity');

console.log('General affairs inventory locations static checks passed.');
