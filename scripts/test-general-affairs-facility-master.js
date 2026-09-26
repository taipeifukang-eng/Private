const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function findMigration(suffix) {
  const dir = path.join(root, 'supabase', 'migrations');
  return fs.readdirSync(dir).find((file) => file.endsWith(suffix));
}

const migration = read('supabase/migration_general_affairs_facility_master.sql');
const rollback = read('supabase/rollback_general_affairs_facility_master.sql');
const testSql = read('supabase/test_general_affairs_facility_master.sql');
const validation = read('lib/general-affairs/facilities/validation.ts');
const access = read('lib/general-affairs/facilities/access.ts');
const listRoute = read('app/api/general-affairs/facilities/route.ts');
const itemRoute = read('app/api/general-affairs/facilities/[id]/route.ts');
const client = read('components/general-affairs/facilities/FacilitiesClient.tsx');
const createClient = read('components/general-affairs/facilities/FacilityCreatePageClient.tsx');
const qrMigrationName = findMigration('_general_affairs_asset_qr_scan_tokens.sql');
assert(qrMigrationName, 'asset QR scan token migration missing');
const qrMigration = read(`supabase/migrations/${qrMigrationName}`);
const qrAutoRevokeMigrationName = findMigration('_general_affairs_asset_qr_auto_revoke.sql');
assert(qrAutoRevokeMigrationName, 'asset QR auto revoke migration missing');
const qrAutoRevokeMigration = read(`supabase/migrations/${qrAutoRevokeMigrationName}`);
const scanApiRoute = read('app/api/general-affairs/assets/scan/[token]/route.ts');
const scanPage = read('app/general-affairs/assets/scan/[token]/page.tsx');

[
  'general_affairs.facility.view',
  'general_affairs.facility.manage',
  'ga_facilities',
  'Task 1B-2 facility migration prerequisites missing',
  'public.ga_normalize_optional_text(text) from Task 1B-1',
  'public.ga_is_store_active(uuid) from Task 1B-1',
  'ga_is_active_facility_category',
  'ga_validate_facility',
  'ga_soft_delete_facility',
  'SET search_path = public, pg_temp',
  'current_user_has_permission',
  'store_managers',
  'auth.uid()',
].forEach((needle) => assert(migration.includes(needle), `migration missing ${needle}`));

[
  'ACTIVE',
  'PARTIALLY_DAMAGED',
  'OUT_OF_SERVICE',
  'UNDER_RENOVATION',
  'RETIRED',
  'LOW',
  'NORMAL',
  'HIGH',
  'CRITICAL',
].forEach((needle) => assert(migration.includes(needle), `migration missing enum value ${needle}`));

[
  "jsonb_typeof(specs) = 'object'",
  'ga_facilities_quantity_unit_pair',
  'uq_ga_facilities_code_active',
  'ga_facilities_scope_read',
  'ga_facilities_insert',
  'ga_facilities_update',
  "ga_category_has_active_path('facility'",
].forEach((needle) => assert(migration.includes(needle), `migration missing safety rule ${needle}`));

assert(!/ALTER\s+TABLE[^;]+work_orders?/i.test(migration), 'Task 1B-2 must not alter work orders');
assert(!/resource_snapshot\s+(JSONB|TEXT|UUID|VARCHAR)/i.test(migration), 'Task 1B-2 must not create resource_snapshot');
assert(!/CREATE\s+TABLE[^;]+attachment/i.test(migration), 'Task 1B-2 must not create attachments');
assert(!/CREATE\s+TABLE[^;]+inventory/i.test(migration), 'Task 1B-2 must not create inventory');
assert(!/CREATE\s+TABLE[^;]+ga_parts/i.test(migration), 'Task 1B-2 must not create parts');
assert(!migration.includes('FOR DELETE TO authenticated'), 'facilities must not expose hard delete policies');
assert(migration.includes('NEW.created_by := auth.uid()'), 'DB trigger must own created_by');
assert(migration.includes('NEW.updated_by := auth.uid()'), 'DB trigger must own updated_by');
assert(migration.includes('NEW.created_by := OLD.created_by'), 'DB trigger must preserve created_by on update');
assert(migration.includes('NEW.deleted_at := NULL'), 'DB trigger must reject direct deleted_at on active row update');
assert(migration.includes("current_setting('app.ga_soft_delete_facility'"), 'DB trigger must distinguish soft delete RPC');
assert(migration.includes("set_config('app.ga_soft_delete_facility', 'true', true)"), 'soft delete RPC must set guarded update flag');
assert(migration.includes("image_path !~* '^[a-z][a-z0-9+.-]*:'"), 'DB must reject URI scheme image paths');
assert(migration.includes("image_path !~ E'\\\\\\\\'"), 'DB must reject backslash image paths');
assert(migration.includes("image_path !~ '(^|/)\\.\\.(/|$)'"), 'DB must reject image path traversal');

assert(rollback.includes('DELETE FROM role_permissions'), 'rollback must remove role permission assignments first');
assert(rollback.includes('DROP TABLE IF EXISTS ga_facilities'), 'rollback must drop facilities table');
assert(!rollback.includes('ga_equipment'), 'rollback must not remove Task 1B-1 equipment');
assert(!rollback.includes('ga_facility_categories'), 'rollback must not remove Task 1A facility categories');
assert(testSql.includes('DEV-1B-2'), 'manual test SQL must use DEV-only test data');
assert(testSql.includes('DEV 測試資料清理'), 'manual test SQL must document cleanup');

assert(access.includes("FACILITY_MANAGE_PERMISSION = 'general_affairs.facility.manage'"), 'access must use RBAC manage permission');
assert(!access.includes('profiles.role'), 'access must not use profiles.role');

assert(validation.includes('SYSTEM_FIELDS'), 'validation must reject system fields');
assert(validation.includes('quantity !== null && quantity <= 0'), 'validation must reject non-positive quantity');
assert(validation.includes('數量與單位必須一起填寫'), 'validation must enforce quantity/unit pair');
assert(validation.includes('圖片路徑僅可保存相對 Storage Path'), 'validation must reject external image URLs');
assert(validation.includes("text.includes('\\\\')"), 'validation must reject backslash image paths');
assert(validation.includes("text.split('/').includes('..')"), 'validation must reject image path traversal');

assert(!itemRoute.includes('.delete()'), 'facility DELETE route must not hard delete');
assert(itemRoute.includes("rpc('ga_soft_delete_facility'"), 'facility DELETE route must call soft delete RPC');
assert(listRoute.includes('POSSIBLE_DUPLICATE_FACILITY'), 'facility API must return duplicate warnings');
assert(listRoute.includes("searchParams.get('sortOrder')"), 'facility API must use sortOrder query parameter');
assert(!listRoute.includes('sortDir'), 'facility API must not add sortDir alias');
assert(listRoute.includes("searchParams.get('storeId')"), 'facility API must support storeId');
assert(listRoute.includes("searchParams.get('categoryId')"), 'facility API must support categoryId');
assert(listRoute.includes("searchParams.get('area')"), 'facility API must support area');
assert(listRoute.includes('qr_token'), 'facility API must select QR token');
assert(listRoute.includes('qr_token_issued_at'), 'facility API must select QR issue timestamp');
assert(listRoute.includes('qr_scan_path'), 'facility API must return stable QR scan path');
assert(listRoute.includes('/general-affairs/assets/scan/'), 'facility API must use stable asset scan route');

[
  'ALTER TABLE public.ga_facilities',
  'qr_token TEXT',
  'qr_token_issued_at TIMESTAMPTZ',
  'qr_token_revoked_at TIMESTAMPTZ',
  'uq_ga_facilities_qr_token',
  'idx_ga_facilities_qr_token_active',
].forEach((needle) => assert(qrMigration.includes(needle), `asset QR migration missing facility rule ${needle}`));
[
  'ga_revoke_asset_qr_on_terminal_status',
  'trg_ga_facilities_qr_auto_revoke',
  "NEW.status::text = 'RETIRED'",
  'NEW.deleted_at IS NOT NULL',
].forEach((needle) => assert(qrAutoRevokeMigration.includes(needle), `asset QR auto revoke migration missing ${needle}`));
assert(scanApiRoute.includes("from('ga_facilities')"), 'scan API must resolve facilities by QR token');
assert(scanApiRoute.includes('VIEW_ALL_SCAN_PERMISSIONS'), 'scan API must define role-based scan visibility');
assert(scanApiRoute.includes('isStoreManagerForStore'), 'scan API must support own-store scan visibility');
assert(scanApiRoute.includes('repair_request_path'), 'scan API must return dynamic repair request path');
assert(scanApiRoute.includes('management_path'), 'scan API must return management path by permission');
assert(itemRoute.includes("normalized.status === 'RETIRED'"), 'facility update must revoke QR when retired');
assert(itemRoute.includes('qr_token_revoked_at: new Date().toISOString()'), 'facility update must set QR revoked timestamp');
assert(scanPage.includes('目前使用門市'), 'scan page must show current store');
assert(scanPage.includes('保固狀態'), 'scan page must show warranty status');
assert(createClient.includes('createdQrScanPath'), 'facility create flow must track created QR scan path');
assert(createClient.includes('QR Code 掃描入口'), 'facility create flow must explain QR scan entry');
assert(createClient.includes('不需要重印既有貼紙'), 'facility create flow must explain stable QR labels');
assert(createClient.includes('開啟 QR 掃描入口'), 'facility create flow must link to scan entry after create');

assert(exists('app/general-affairs/facilities/page.tsx'), 'facilities page missing');
assert(client.includes('未儲存'), 'UI must include unsaved-change warning');
assert(client.includes('Permission') || client.includes('沒有設施資料權限'), 'UI must include permission denied state');
assert(client.includes('Loader2'), 'UI must include loading state');
assert(client.includes('href="/general-affairs/facilities/new"') || client.includes('openCreate'), 'UI must include create flow');
assert(client.includes('async function softDelete'), 'UI must include soft delete flow');
assert(client.includes('areaFilter'), 'UI must include area filter');

console.log('General affairs facility master static checks passed.');
