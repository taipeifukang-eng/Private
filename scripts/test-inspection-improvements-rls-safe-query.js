const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(
  path.join(process.cwd(), 'app/inspection/improvements/page.tsx'),
  'utf8'
);
const route = fs.readFileSync(
  path.join(process.cwd(), 'app/api/inspection/improvements/route.ts'),
  'utf8'
);
const permissionMigration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260911093000_grant_inspection_improvement_permissions.sql'),
  'utf8'
);
const lookupIndexMigration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260911100000_optimize_inspection_improvements_lookup.sql'),
  'utf8'
);
const navbarPermissions = fs.readFileSync(
  path.join(process.cwd(), 'hooks/useNavbarPermissions.ts'),
  'utf8'
);

function assertIncludes(content, needle, message) {
  if (!content.includes(needle)) {
    throw new Error(message);
  }
}

function assertNotIncludes(content, needle, message) {
  if (content.includes(needle)) {
    throw new Error(message);
  }
}

assertIncludes(
  page,
  "fetch('/api/inspection/improvements'",
  'improvements page should load data through the server API'
);
assertIncludes(
  page,
  '避免前端 RLS 對 inspection_improvements 回傳假空白',
  'improvements page should document why it uses the server API'
);
assertIncludes(
  page,
  'setImprovementsMeta(payload.meta || null)',
  'improvements page should keep API visibility diagnostics'
);
assertIncludes(
  page,
  '目前帳號可見範圍是 0 筆',
  'improvements page should explain scoped-empty results'
);
assertIncludes(
  page,
  'setErrorMessage(payload.error ||',
  'improvements page should show API errors instead of silent zero counts'
);
assertNotIncludes(
  page,
  ".from('inspection_improvements')\n        .select(`",
  'improvements page should not query inspection_improvements directly'
);
assertNotIncludes(
  page,
  'stores!inner',
  'improvements page should not inner join stores in the client query'
);
assertNotIncludes(
  page,
  'inspection_masters!inner',
  'improvements page should not inner join inspection_masters in the client query'
);

assertIncludes(
  route,
  'createAdminClient',
  'improvements API should use the admin client after checking permissions'
);
assertIncludes(
  route,
  "'inspection.improvement.view_all'",
  'improvements API should allow view_all permission'
);
assertIncludes(
  route,
  'getImprovementAccess(adminClient, user.id)',
  'improvements API should read RBAC through the admin client instead of slow permission RPC loops'
);
assertNotIncludes(
  route,
  'role_permissions!inner',
  'improvements API should avoid nested RBAC joins that can timeout in production'
);
assertNotIncludes(
  route,
  "count: 'exact'",
  'improvements API should avoid exact counts on the listing request'
);
assertNotIncludes(
  route,
  '.update({ status:',
  'improvements API should not update rows during the listing request'
);
assertIncludes(
  route,
  "'inspection.improvement.view_own_store'",
  'improvements API should allow own-store permission'
);
assertIncludes(
  route,
  "PROFILE_SCOPED_ROLES.has(profileRole)",
  'improvements API should allow supervisor and manager profiles into scoped visibility'
);
assertIncludes(
  route,
  'profileAllowsScopedAccess || SCOPED_PERMISSIONS.some',
  'profile scoped access should not grant global visibility'
);
assertIncludes(
  route,
  'LEGACY_INSPECTION_VIEW_ALL_PERMISSION',
  'global inspection access should be considered for admin-like fallback'
);
assertIncludes(
  route,
  'permissionCodes.has(VIEW_ALL_PERMISSION) || hasLegacyGlobalInspectionAccess',
  'admin-like all-permission roles should be able to see all improvements'
);
assertIncludes(
  route,
  "'inspection.improvement.manage'",
  'improvements API should allow manage permission within scoped visibility'
);
assertIncludes(
  route,
  'permissionCodes.has(LEGACY_INSPECTION_VIEW_ALL_PERMISSION) && hasAdminCapability',
  'legacy inspection.view_all should require an admin capability before granting global improvements'
);
assertIncludes(
  route,
  ".from('inspection_improvements')",
  'improvements API should query inspection_improvements'
);
assertIncludes(
  route,
  ".in('inspection_id', Array.from(inspectionIds))",
  'improvements API should query only own-inspection scoped improvements'
);
assertIncludes(
  route,
  'const LIST_LIMIT = 200',
  'improvements API should limit each listing query to avoid production timeouts'
);
assertNotIncludes(
  route,
  ".order('deadline'",
  'improvements API should sort in memory instead of ordering listing queries in SQL'
);
assertIncludes(
  route,
  'fetchImprovementsByStatus',
  'improvements API should split listing queries by status'
);
assertIncludes(
  route,
  '.select(\'id\')',
  'improvements API should fetch ids before loading list rows'
);
assertIncludes(
  route,
  'IMPROVEMENT_LIST_SELECT',
  'improvements API should use a minimal list select'
);
assertNotIncludes(
  route,
  'issue_photo_urls',
  'improvements list API should not load photo URLs'
);
assertIncludes(
  route,
  'ImprovementQueryError',
  'improvements API should return a diagnostic stage for query failures'
);
assertIncludes(
  route,
  ".in('store_id', Array.from(storeIds))",
  'improvements API should query only own-store scoped improvements'
);
assertIncludes(
  route,
  '避免 stores / inspection_masters inner join 被關聯表 RLS 連帶過濾成空資料',
  'improvements API should document why it avoids inner joins'
);
assertIncludes(
  route,
  'totalCount: visibleImprovements.length',
  'improvements API should return lightweight visible count diagnostics'
);
assertIncludes(
  route,
  'visibleCount: improvements.length',
  'improvements API should return visible row count diagnostics'
);
assertIncludes(
  route,
  'managedStoreCount',
  'improvements API should return own-store scope diagnostics'
);
assertIncludes(
  route,
  'ownInspectionCount',
  'improvements API should return own-inspection scope diagnostics'
);
assertIncludes(
  navbarPermissions,
  "'inspection.improvement.manage'",
  'navbar should show improvement tracking for manage permission'
);
assertIncludes(
  navbarPermissions,
  "'inspection.improvement.submit'",
  'navbar should show improvement tracking for submit permission'
);
assertIncludes(
  permissionMigration,
  "'inspection.improvement.view_all'",
  'migration should ensure improvement view_all permission exists'
);
assertIncludes(
  permissionMigration,
  "'inspection.improvement.manage'",
  'migration should ensure improvement manage permission exists'
);
assertIncludes(
  permissionMigration,
  "'admin_role'",
  'migration should grant improvement permissions to admin-like roles'
);
assertIncludes(
  lookupIndexMigration,
  'idx_inspection_improvements_status_id',
  'lookup index migration should add status lookup index'
);
assertIncludes(
  lookupIndexMigration,
  'idx_inspection_improvements_store_status_id',
  'lookup index migration should add store scoped status index'
);
assertIncludes(
  lookupIndexMigration,
  'idx_inspection_improvements_inspection_status_id',
  'lookup index migration should add inspection scoped status index'
);

console.log('inspection improvements RLS-safe query checks passed');
