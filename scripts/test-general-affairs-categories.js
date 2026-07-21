const fs = require('fs');
const path = require('path');

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, 'supabase/migration_general_affairs_category_foundation.sql'), 'utf8');
const listRoute = fs.readFileSync(path.join(root, 'app/api/general-affairs/categories/route.ts'), 'utf8');
const itemRoute = fs.readFileSync(path.join(root, 'app/api/general-affairs/categories/[id]/route.ts'), 'utf8');
const validation = fs.readFileSync(path.join(root, 'lib/general-affairs/categories/validation.ts'), 'utf8');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

[
  'ga_equipment_categories',
  'ga_facility_categories',
  'ga_part_categories',
  'general_affairs.equipment_category.view',
  'general_affairs.equipment_category.manage',
  'general_affairs.facility_category.view',
  'general_affairs.facility_category.manage',
  'general_affairs.part_category.view',
  'general_affairs.part_category.manage',
  'ga_category_has_active_path',
  'ga_validate_category_tree',
  'ga_soft_delete_category',
  'current_user_has_permission',
].forEach((needle) => assert(migration.includes(needle), `migration missing ${needle}`));

assert(!migration.includes('p_table_name'), 'migration must not expose p_table_name dynamic SQL');
assert(migration.includes("TG_TABLE_NAME = 'ga_equipment_categories'"), 'trigger must whitelist equipment table');
assert(migration.includes("TG_TABLE_NAME = 'ga_facility_categories'"), 'trigger must whitelist facility table');
assert(migration.includes("TG_TABLE_NAME = 'ga_part_categories'"), 'trigger must whitelist part table');
assert(migration.includes('SET search_path = public, pg_temp'), 'security definer functions must pin search_path');
assert(migration.includes('ALTER FUNCTION public.has_permission(UUID, VARCHAR)'), 'migration must harden existing has_permission search_path');
assert(migration.includes("jsonb_typeof(spec_schema) = 'array'"), 'part spec_schema JSON check missing');
assert(migration.includes("jsonb_typeof(default_fields) = 'object'"), 'equipment default_fields JSON check missing');
assert(migration.includes("jsonb_typeof(default_issue_fields) = 'object'"), 'facility default_issue_fields JSON check missing');
assert(!migration.includes('FOR DELETE TO authenticated'), 'classification tables must not expose hard delete RLS policy');
assert(migration.includes('WHERE deleted_at IS NULL'), 'partial unique code indexes must be present');

assert(listRoute.includes('created_by: user.id'), 'POST must set created_by server-side');
assert(listRoute.includes('updated_by: user.id'), 'POST must set updated_by server-side');
assert(!itemRoute.includes('.delete()'), 'DELETE route must not hard delete');
assert(itemRoute.includes("rpc('ga_soft_delete_category'"), 'DELETE route must use DB soft delete RPC');
assert(migration.includes('CREATE OR REPLACE FUNCTION ga_soft_delete_category'), 'soft delete RPC missing');
assert(migration.includes('deleted_at = $2'), 'soft delete RPC must set deleted_at');
assert(migration.includes('deleted_by = $3'), 'soft delete RPC must set deleted_by');
assert(migration.includes('parent_id = $1 AND deleted_at IS NULL'), 'soft delete RPC must reject categories with children');
assert(migration.includes('REVOKE ALL ON FUNCTION ga_soft_delete_category'), 'soft delete RPC revoke missing');
assert(migration.includes('GRANT EXECUTE ON FUNCTION ga_soft_delete_category'), 'soft delete RPC execute grant missing');
assert(listRoute.includes('MVP 尚未開放已刪除分類查詢'), 'list route must not expose includeDeleted in MVP');
assert(itemRoute.includes('MVP 尚未開放已刪除分類查詢'), 'detail route must not expose includeDeleted in MVP');
assert(!listRoute.includes('createAdminClient'), 'list route must not use service role for includeDeleted');
assert(!itemRoute.includes('createAdminClient'), 'detail route must not use service role for includeDeleted');
assert(migration.includes('GRANT EXECUTE ON FUNCTION public.current_user_has_permission'), 'current_user_has_permission execute grant missing');

assert(validation.includes('trim().toUpperCase()'), 'validation must normalize code to uppercase');
assert(validation.includes('規格 Schema') && validation.includes('必須是陣列格式'), 'part spec_schema validation missing');
assert(validation.includes('預設欄位') && validation.includes('必須是物件格式'), 'equipment default_fields validation missing');
assert(validation.includes('預設問題欄位') && validation.includes('必須是物件格式'), 'facility default_issue_fields validation missing');

console.log('General affairs category foundation static checks passed.');
