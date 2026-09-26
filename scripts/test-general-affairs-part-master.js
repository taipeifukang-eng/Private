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

const migration = read('supabase/migration_general_affairs_part_master.sql');
const rollback = read('supabase/rollback_general_affairs_part_master.sql');
const testSql = read('supabase/test_general_affairs_part_master.sql');
const validation = read('lib/general-affairs/parts/validation.ts');
const access = read('lib/general-affairs/parts/access.ts');
const listRoute = read('app/api/general-affairs/parts/route.ts');
const itemRoute = read('app/api/general-affairs/parts/[id]/route.ts');
const compatibilityRoute = read('app/api/general-affairs/parts/[id]/compatibilities/route.ts');
const compatibilityItemRoute = read('app/api/general-affairs/parts/[id]/compatibilities/[compatibilityId]/route.ts');
const client = read('components/general-affairs/parts/PartsClient.tsx');
const createClient = read('components/general-affairs/parts/PartCreatePageClient.tsx');

[
  'general_affairs.part.view',
  'general_affairs.part.manage',
  'ga_parts',
  'ga_part_compatibilities',
  'Task 1B-3 part migration prerequisites missing',
  'public.ga_normalize_optional_text(text) from Task 1B-1',
  'public.ga_category_has_active_path(ga_category_kind, uuid)',
  'public.ga_equipment_templates from Task 1B-1',
  'current_user_is_store_manager',
  'ga_is_active_part_category',
  'ga_part_is_visible',
  'ga_validate_part',
  'ga_validate_part_compatibility',
  'ga_soft_delete_part',
  'ga_soft_delete_part_compatibility',
  'SET search_path = public, pg_temp',
  'current_user_has_permission',
  'store_managers',
  'auth.uid()',
].forEach((needle) => assert(migration.includes(needle), `migration missing ${needle}`));

[
  'EQUIPMENT_TEMPLATE',
  'VENDOR_SERIES',
  'BRAND_MODEL',
  'purchase_to_base_rate',
  'minimum_issue_qty',
  'allow_fractional_issue',
  'allow_unpacking',
  'uq_ga_parts_part_code_active',
  'uq_ga_parts_barcode_active',
  'uq_ga_part_compat_template_active',
  'uq_ga_part_compat_vendor_series_active',
  'uq_ga_part_compat_brand_model_active',
  "jsonb_typeof(specs) = 'object'",
  "ga_category_has_active_path('part'",
].forEach((needle) => assert(migration.includes(needle), `migration missing safety rule ${needle}`));

assert(!/CREATE\s+TABLE[^;]+inventory/i.test(migration), 'Task 1B-3 must not create inventory tables');
assert(!/CREATE\s+TABLE[^;]+stock/i.test(migration), 'Task 1B-3 must not create stock tables');
assert(!/CREATE\s+TABLE[^;]+transfer/i.test(migration), 'Task 1B-3 must not create transfer tables');
assert(!/ALTER\s+TABLE[^;]+work_orders?/i.test(migration), 'Task 1B-3 must not alter work orders');
assert(!/CREATE\s+TABLE[^;]+attachment/i.test(migration), 'Task 1B-3 must not create attachments');
assert(!/resource_snapshot\s+(JSONB|TEXT|UUID|VARCHAR)/i.test(migration), 'Task 1B-3 must not create resource_snapshot');
assert(!migration.includes('FOR DELETE TO authenticated'), 'parts must not expose hard delete policies');
assert(migration.includes('NEW.created_by := auth.uid()'), 'DB trigger must own created_by');
assert(migration.includes('NEW.updated_by := auth.uid()'), 'DB trigger must own updated_by');
assert(migration.includes('NEW.created_by := OLD.created_by'), 'DB trigger must preserve created_by on update');
assert(migration.includes("current_setting('app.ga_soft_delete_part'"), 'DB trigger must distinguish part soft delete RPC');
assert(migration.includes("current_setting('app.ga_soft_delete_part_compatibility'"), 'DB trigger must distinguish compatibility soft delete RPC');
assert(migration.includes("set_config('app.ga_soft_delete_part', 'true', true)"), 'part soft delete RPC must set guarded update flag');
assert(migration.includes("set_config('app.ga_soft_delete_part_compatibility', 'true', true)"), 'compatibility soft delete RPC must set guarded update flag');
assert(migration.includes("image_path !~* '^[a-z][a-z0-9+.-]*:'"), 'DB must reject URI scheme image paths');
assert(migration.includes("image_path !~ E'\\\\\\\\'"), 'DB must reject backslash image paths');
assert(migration.includes("image_path !~ '(^|/)\\.\\.(/|$)'"), 'DB must reject image path traversal');

assert(rollback.includes('DELETE FROM role_permissions'), 'rollback must remove role permission assignments first');
assert(rollback.includes('DROP TABLE IF EXISTS ga_part_compatibilities'), 'rollback must drop compatibility table');
assert(rollback.includes('DROP TABLE IF EXISTS ga_parts'), 'rollback must drop parts table');
assert(!rollback.includes('DROP TABLE IF EXISTS ga_equipment'), 'rollback must not remove Task 1B-1 equipment');
assert(!rollback.includes('DROP TABLE IF EXISTS ga_facilities'), 'rollback must not remove Task 1B-2 facilities');
assert(!rollback.includes('DROP TABLE IF EXISTS ga_part_categories'), 'rollback must not remove Task 1A part categories');
assert(testSql.includes('DEV-1B-3'), 'manual test SQL must use DEV-only test data');
assert(testSql.includes('DEV 測試資料清理'), 'manual test SQL must document cleanup');

assert(access.includes("PART_MANAGE_PERMISSION = 'general_affairs.part.manage'"), 'access must use RBAC manage permission');
assert(!access.includes('profiles.role'), 'access must not use profiles.role');

assert(validation.includes('SYSTEM_FIELDS'), 'validation must reject system fields');
assert(validation.includes('換算率必須大於 0'), 'validation must enforce positive purchase conversion rate');
assert(validation.includes('最小領用量必須大於 0'), 'validation must reject non-positive minimum issue quantity');
assert(validation.includes('不允許小數領用時，最小領用量必須為整數'), 'validation must enforce integer issue qty when fractional issue is disabled');
assert(validation.includes('圖片路徑僅可保存相對 Storage Path'), 'validation must reject external image URLs');
assert(validation.includes("text.includes('\\\\')"), 'validation must reject backslash image paths');
assert(validation.includes("text.split('/').includes('..')"), 'validation must reject image path traversal');
assert(validation.includes('設備範本相容性必須選擇設備範本'), 'validation must enforce equipment template compatibility target');
assert(validation.includes('廠商系列相容性必須填寫廠商名稱'), 'validation must enforce vendor compatibility target');
assert(validation.includes('品牌型號相容性必須填寫品牌'), 'validation must enforce brand/model compatibility target');

assert(!itemRoute.includes('.delete()'), 'part DELETE route must not hard delete');
assert(itemRoute.includes("rpc('ga_soft_delete_part'"), 'part DELETE route must call soft delete RPC');
assert(!compatibilityItemRoute.includes('.delete()'), 'compatibility DELETE route must not hard delete');
assert(compatibilityItemRoute.includes("rpc('ga_soft_delete_part_compatibility'"), 'compatibility DELETE route must call soft delete RPC');
assert(listRoute.includes('POSSIBLE_DUPLICATE_PART'), 'part API must return duplicate warnings');
assert(listRoute.includes("searchParams.get('sortOrder')"), 'part API must use sortOrder query parameter');
assert(listRoute.includes("searchParams.get('categoryId')"), 'part API must support categoryId');
assert(listRoute.includes("searchParams.get('isActive')"), 'part API must support isActive');
assert(listRoute.includes("searchParams.get('brand')"), 'part API must support brand');
assert(compatibilityRoute.includes("POST"), 'compatibility API must support create');

assert(exists('app/general-affairs/parts/page.tsx'), 'parts page missing');
assert(client.includes('沒有料件資料權限'), 'UI must include permission denied state');
assert(client.includes('Loader2'), 'UI must include loading state');
assert(client.includes('href="/general-affairs/parts/new"'), 'UI must include create flow');
assert(createClient.includes('未儲存'), 'create UI must include unsaved-change warning');
assert(!createClient.includes('newCompatibilityDraft'), 'create UI must defer compatibility management');
assert(createClient.includes("part_compatibility_scope: 'UNDECIDED'"), 'create UI must mark compatibility as undecided');
assert(createClient.includes('allow_unpacking'), 'create UI must include unpacking control');
assert(createClient.includes('allow_fractional_issue'), 'create UI must include fractional issue control');

console.log('General affairs part master static checks passed.');
