const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runCase(name, fn) {
  process.stdout.write(`RUN ${name}\n`);
  fn();
  process.stdout.write(`PASS ${name}\n`);
}

function extractPermissionCodes(text) {
  return Array.from(text.matchAll(/'([a-z_]+\.[a-z0-9_.]+)'/g)).map((match) => match[1]);
}

function getNavigationItemBlock(id) {
  const start = navigation.indexOf(`id: '${id}'`);
  if (start < 0) return '';
  const nextSibling = navigation.indexOf('\n      {', start + 1);
  return navigation.slice(start, nextSibling > start ? nextSibling : start + 1200);
}

const navigationPath = 'components/general-affairs/navigation.tsx';
const navbarPermissionsPath = 'hooks/useNavbarPermissions.ts';
const servicePagePath = 'components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx';
const maintenanceRequestsApiPath = 'app/api/maintenance-requests/route.ts';
const maintenanceUpdatesApiPath = 'app/api/maintenance-updates/route.ts';
const maintenancePhotosApiPath = 'app/api/maintenance-photos/route.ts';
const inventoryTransactionsAccessPath = 'lib/general-affairs/inventory/transactions/access.ts';
const equipmentMigrationPath = 'supabase/migrations/20260722030244_dev_schema_baseline.sql';
const maintenanceCompatibilityMigrationPath = 'supabase/migrations/20260724011554_production_legacy_general_affairs_maintenance_compatibility.sql';
const roleMatrixMigrationPath = 'supabase/migrations/20260727015132_dev_general_affairs_role_matrix_permissions.sql';
const gaRbacPermissionSplitMigrationPath = 'supabase/migrations/20260727021000_general_affairs_maintenance_work_order_permission_split.sql';
const gaVendorPermissionRlsMigrationPath = 'supabase/migrations/20260824090000_general_affairs_vendor_permissions_rls.sql';

[
  navigationPath,
  navbarPermissionsPath,
  servicePagePath,
  maintenanceRequestsApiPath,
  maintenanceUpdatesApiPath,
  maintenancePhotosApiPath,
  inventoryTransactionsAccessPath,
  equipmentMigrationPath,
  maintenanceCompatibilityMigrationPath,
  roleMatrixMigrationPath,
  gaRbacPermissionSplitMigrationPath,
  gaVendorPermissionRlsMigrationPath,
].forEach((file) => assert(fs.existsSync(path.join(root, file)), `${file} should exist`));

const navigation = read(navigationPath);
const navbarPermissions = read(navbarPermissionsPath);
const servicePage = read(servicePagePath);
const maintenanceRequestsApi = read(maintenanceRequestsApiPath);
const maintenanceUpdatesApi = read(maintenanceUpdatesApiPath);
const maintenancePhotosApi = read(maintenancePhotosApiPath);
const inventoryTransactionsAccess = read(inventoryTransactionsAccessPath);
const baselineMigration = read(equipmentMigrationPath);
const maintenanceCompatibilityMigration = read(maintenanceCompatibilityMigrationPath);
const roleMatrixMigration = read(roleMatrixMigrationPath);
const gaRbacPermissionSplitMigration = read(gaRbacPermissionSplitMigrationPath);
const gaVendorPermissionRlsMigration = read(gaVendorPermissionRlsMigrationPath);
const allSupabaseSql = fs
  .readdirSync(path.join(root, 'supabase'), { recursive: true })
  .filter((file) => String(file).endsWith('.sql'))
  .map((file) => read(path.join('supabase', String(file))))
  .join('\n');

const ROLE_MATRIX = [
  {
    account: 'dev-no-ga@example.test',
    businessRole: '一般人員',
    roleCode: 'dev_no_ga_access',
    expectedPermissions: [],
    storeScope: 'none',
  },
  {
    account: 'dev-ga-access@example.test',
    businessRole: '店長',
    roleCode: 'dev_ga_access_only',
    expectedPermissions: [
      'general_affairs.service_center.access',
      'general_affairs.maintenance_request.create',
      'general_affairs.maintenance_request.view_own_store',
      'general_affairs.work_order.view_own_store',
      'general_affairs.equipment.view',
      'general_affairs.facility.view',
      'general_affairs.part.view',
      'general_affairs.inventory_location.view',
      'general_affairs.inventory_balance.view',
      'general_affairs.inventory_transaction.view',
    ],
    forbiddenPermissions: [
      'general_affairs.vendor.view',
      'general_affairs.vendor.manage',
      'general_affairs.service_category.manage',
      'general_affairs.service_region.manage',
      'general_affairs.maintenance_request.view_all',
      'general_affairs.maintenance_request.update',
      'general_affairs.work_order.update',
      'general_affairs.work_order.manage',
      'general_affairs.inventory_transaction.manage',
    ],
    storeScope: 'store_managers role_type=store_manager',
  },
  {
    account: 'dev-ga-view@example.test',
    businessRole: '督導',
    roleCode: 'dev_ga_category_view',
    expectedPermissions: [
      'general_affairs.service_center.access',
      'general_affairs.maintenance_request.create',
      'general_affairs.maintenance_request.view_own_store',
      'general_affairs.work_order.view_own_store',
      'general_affairs.equipment.view',
      'general_affairs.facility.view',
      'general_affairs.part.view',
      'general_affairs.inventory_location.view',
      'general_affairs.inventory_balance.view',
      'general_affairs.inventory_transaction.view',
    ],
    forbiddenPermissions: [
      'general_affairs.vendor.view',
      'general_affairs.vendor.manage',
      'general_affairs.service_category.manage',
      'general_affairs.service_region.manage',
      'general_affairs.maintenance_request.update',
      'general_affairs.work_order.update',
      'general_affairs.inventory_transaction.manage',
    ],
    storeScope: 'store_managers role_type=supervisor or scoped manager rows',
  },
  {
    account: 'dev-ga-manage@example.test',
    businessRole: '總務',
    roleCode: 'dev_ga_category_manage',
    expectedPermissions: [
      'general_affairs.service_center.access',
      'general_affairs.maintenance_request.create',
      'general_affairs.maintenance_request.view_all',
      'general_affairs.maintenance_request.update',
      'general_affairs.work_order.view_all',
      'general_affairs.work_order.update',
      'general_affairs.work_order.manage',
      'general_affairs.equipment.manage',
      'general_affairs.facility.manage',
      'general_affairs.part.manage',
      'general_affairs.inventory_location.manage',
      'general_affairs.inventory_balance.view',
      'general_affairs.inventory_transaction.view',
      'general_affairs.inventory_transaction.manage',
    ],
    forbiddenPermissions: [
      'general_affairs.service_center.force_close',
      'role.role.manage',
      'role.permission.assign',
    ],
    storeScope: 'global by permissions, not by store_managers scope',
  },
];

const VENDOR_PERMISSION_CODES = [
  'general_affairs.vendor.view',
  'general_affairs.vendor.manage',
  'general_affairs.service_category.view',
  'general_affairs.service_category.manage',
  'general_affairs.service_region.view',
  'general_affairs.service_region.manage',
  'general_affairs.cooperation_record.view',
];

const GA_MAINTENANCE_PERMISSION_CODES = [
  'general_affairs.maintenance_request.create',
  'general_affairs.maintenance_request.view_own_store',
  'general_affairs.maintenance_request.view_all',
  'general_affairs.maintenance_request.update',
  'general_affairs.work_order.view_own_store',
  'general_affairs.work_order.view_all',
  'general_affairs.work_order.update',
  'general_affairs.work_order.manage',
];

const EXPECTED_VISIBLE_NAV_ITEMS = {
  dev_ga_access_only: [
    'service-home',
    'maintenance',
    'inventory-overview',
    'inventory-locations',
    'equipment',
    'facilities',
    'parts',
  ],
  dev_ga_category_view: [
    'service-home',
    'maintenance',
    'inventory-overview',
    'inventory-locations',
    'equipment',
    'facilities',
    'parts',
  ],
  dev_ga_category_manage: [
    'service-home',
    'maintenance',
    'work-orders',
    'inventory-overview',
    'inventory-locations',
    'equipment',
    'equipment-list',
    'facilities',
    'parts',
    'vendors-list',
    'vendor-categories',
    'vendor-regions',
    'vendor-stats',
    'category-settings',
    'part-compatibilities',
  ],
};

function assertRolePermission(roleCode, permissionCode) {
  assert(
    roleMatrixMigration.includes(`('${roleCode}', '${permissionCode}')`),
    `${roleCode} should receive ${permissionCode} in UI-3A role matrix migration`
  );
}

function assertNavigationItemRequiresPermission(itemId, permissionCode) {
  const block = getNavigationItemBlock(itemId);
  assert(block, `${itemId} nav item should exist`);
  assert(
    block.includes(`'${permissionCode}'`) || navigation.includes(`'${permissionCode}'`),
    `${itemId} should require ${permissionCode}`
  );
}

runCase('formal role matrix is documented in test fixture only', () => {
  assert(ROLE_MATRIX.length === 4, 'matrix should include four manual DEV accounts');
  assert(ROLE_MATRIX[0].expectedPermissions.length === 0, 'general staff should have no GA permissions');
  assert(ROLE_MATRIX.every((row) => row.roleCode.startsWith('dev_')), 'DEV accounts should map to DEV fixture role codes');
});

runCase('DEV role matrix migration restores existing sidebar roles', () => {
  assert(roleMatrixMigration.includes('DEV-only RBAC seed'), 'role matrix migration must be marked DEV-only');
  assert(!/@example\.test/i.test(roleMatrixMigration), 'role matrix migration must not assign by email');
  assert(!roleMatrixMigration.includes('general_affairs.vendor.view'), 'vendor permissions must remain out of UI-3A-1 seed');
  assert(!roleMatrixMigration.includes('general_affairs.vendor.manage'), 'vendor manage permission must remain out of UI-3A-1 seed');
  assert(!roleMatrixMigration.includes('cross_dept.maintenance.'), 'GA role matrix must not grant cross-department maintenance permissions');

  ROLE_MATRIX
    .filter((row) => row.roleCode !== 'dev_no_ga_access')
    .forEach((row) => {
      row.expectedPermissions.forEach((permissionCode) => assertRolePermission(row.roleCode, permissionCode));
    });
});

runCase('GA maintenance permission split migration adds codes and RLS compatibility', () => {
  GA_MAINTENANCE_PERMISSION_CODES.forEach((permissionCode) => {
    assert(
      gaRbacPermissionSplitMigration.includes(`'${permissionCode}'`),
      `permission split migration should include ${permissionCode}`
    );
  });
  assert(
    gaRbacPermissionSplitMigration.includes('DROP POLICY IF EXISTS p1e_maintenance_requests_read') &&
    gaRbacPermissionSplitMigration.includes('CREATE POLICY p1e_maintenance_requests_read'),
    'permission split migration should refresh maintenance request RLS'
  );
  assert(
    gaRbacPermissionSplitMigration.includes("'cross_dept.maintenance.submit'"),
    'shared legacy RLS must preserve cross-department maintenance compatibility'
  );
  assert(
    !/CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE\s+(?!IF EXISTS p1e_)/i.test(gaRbacPermissionSplitMigration),
    'permission split migration must not change business table shape'
  );
});

runCase('role matrix gives each role more than service home', () => {
  Object.entries(EXPECTED_VISIBLE_NAV_ITEMS).forEach(([roleCode, itemIds]) => {
    assert(itemIds.includes('service-home'), `${roleCode} should include service home`);
    assert(itemIds.length > 1, `${roleCode} sidebar must not collapse to service home only`);
  });
  assert(!EXPECTED_VISIBLE_NAV_ITEMS.dev_ga_access_only.includes('vendors-list'), 'store manager should not show vendor list');
  assert(!EXPECTED_VISIBLE_NAV_ITEMS.dev_ga_category_view.includes('vendors-list'), 'supervisor should not show vendor list');
  assert(EXPECTED_VISIBLE_NAV_ITEMS.dev_ga_category_manage.includes('vendors-list'), 'GA manager should show vendor list after vendor permission/RLS migration');
});

runCase('navigation required permissions match canonical maintenance and asset semantics', () => {
  assert(getNavigationItemBlock('maintenance').includes('SERVICE_REQUEST_VIEW_ACCESS'), 'my reports nav should use unified service request view permissions');
  assert(getNavigationItemBlock('work-orders').includes('GA_WORK_ORDER_MODULE_CODES'), 'work-orders nav should use GA work-order permissions');
  assert(!getNavigationItemBlock('part-requests'), 'legacy material request records item must not remain as a separate sidebar item');
  assertNavigationItemRequiresPermission('inventory-overview', 'general_affairs.inventory_balance.view');
  assertNavigationItemRequiresPermission('inventory-locations', 'general_affairs.inventory_location.view');
  assertNavigationItemRequiresPermission('equipment', 'general_affairs.equipment.view');
  assertNavigationItemRequiresPermission('facilities', 'general_affairs.facility.view');
  assertNavigationItemRequiresPermission('parts', 'general_affairs.part.view');
});

runCase('maintenance APIs use permission and store scope guards', () => {
  assert(maintenanceRequestsApi.includes('SHARED_MAINTENANCE_REQUEST_CREATE_CODES'), 'maintenance request API must accept GA create permissions');
  assert(maintenanceRequestsApi.includes('SHARED_MAINTENANCE_REQUEST_VIEW_ALL_CODES'), 'maintenance request API must accept GA view-all permissions');
  assert(maintenanceRequestsApi.includes('SHARED_MAINTENANCE_REQUEST_UPDATE_CODES'), 'maintenance request API must accept GA update permissions');
  assert(maintenanceRequestsApi.includes('getManagedStoreIds'), 'maintenance request API must enforce managed store scope');
  assert(maintenanceRequestsApi.includes('store_managers'), 'maintenance request API must read store_managers scope');
  assert(maintenanceUpdatesApi.includes('transitionMaintenanceTicket'), 'maintenance updates must use transition service');
  assert(maintenancePhotosApi.includes('SHARED_MAINTENANCE_REQUEST_CREATE_CODES'), 'maintenance photo upload must require GA create or stronger permission');
});

runCase('material request remains maintenance-backed resource filter', () => {
  assert(!navigation.includes("id: 'new-part-request'"), 'new part request compatibility entry should not remain in the latest IA');
  assert(!navigation.includes("id: 'my-part-requests'"), 'my part requests compatibility entry should not remain in the latest IA');
  assert(fs.readFileSync(path.join(root, 'app/general-affairs/part-requests/new/page.tsx'), 'utf8').includes("redirect('/general-affairs/reports/new')"), 'legacy new part request route should redirect to unified create');
  assert(fs.readFileSync(path.join(root, 'app/general-affairs/part-requests/page.tsx'), 'utf8').includes("redirect('/general-affairs/reports/mine')"), 'legacy my part requests route should redirect to unified reports');
  assert(!allSupabaseSql.includes('general_affairs.part_request.create'), 'formal part request permission should not be invented yet');
});

runCase('vendor navigation is no longer service-center-access only', () => {
  const vendorIndex = navigation.indexOf("id: 'vendors-list'");
  const vendorNavBlock = vendorIndex >= 0 ? navigation.slice(vendorIndex, vendorIndex + 700) : '';
  assert(vendorNavBlock.includes('general_affairs.vendor.view'), 'vendor list should require vendor view permission');
  assert(vendorNavBlock.includes("href: '/general-affairs/vendors'"), 'vendor list should use a direct vendor route');
  assert(!vendorNavBlock.includes('SERVICE_ACCESS'), 'vendor list must not be gated only by service center access');
  assert(navbarPermissions.includes("permissionSet.has('general_affairs.vendor.view')"), 'navbar vendor flag should use vendor permission');
  assert(!/canAccessGeneralAffairsVendors\s*=[\s\S]{0,120}canAccessGeneralAffairsService/.test(navbarPermissions), 'navbar vendor flag must not derive from service access');
  assert(servicePage.includes('canAccessVendors'), 'service page must track vendor permission separately');
  assert(servicePage.includes('vendorView?: VendorView'), 'service page should allow route shells to select a vendor tab');
  assert(!servicePage.includes('canAccessVendors={canAccessService}'), 'dashboard must not receive service access as vendor access');
});

runCase('vendor permission/RLS migration resolves service access blocker', () => {
  const existingCodes = new Set(extractPermissionCodes(allSupabaseSql));
  const missing = VENDOR_PERMISSION_CODES.filter((code) => !existingCodes.has(code));
  assert(missing.length === 0, `vendor permission codes should exist after GA-VENDOR-RBAC-1: ${missing.join(', ')}`);
  assert(
    maintenanceCompatibilityMigration.includes("current_user_has_permission('general_affairs.service_center.access')"),
    'legacy compatibility migration should remain unchanged for migration history'
  );
  VENDOR_PERMISSION_CODES.forEach((permissionCode) => {
    assert(
      gaVendorPermissionRlsMigration.includes(`'${permissionCode}'`),
      `vendor permission/RLS migration should include ${permissionCode}`
    );
    assert(
      gaVendorPermissionRlsMigration.includes(`('dev_ga_category_manage', '${permissionCode}')`),
      `DEV GA manager should receive ${permissionCode}`
    );
  });
  const rewrittenPolicySection = gaVendorPermissionRlsMigration.slice(
    gaVendorPermissionRlsMigration.indexOf('DROP POLICY IF EXISTS p1e_ga_vendors_read'),
  );
  assert(
    !rewrittenPolicySection.includes("general_affairs.service_center.access"),
    'new vendor/service RLS policies must not use service center access'
  );
});

runCase('assets and inventory APIs keep server or RLS scoped access', () => {
  assert(
    /CREATE POLICY "ga_equipment_scope_read"[\s\S]*FROM "public"\."store_managers"/.test(baselineMigration) ||
      /CREATE POLICY "ga_equipment_scope_read"[\s\S]*FROM store_managers/.test(allSupabaseSql),
    'equipment RLS should retain store_managers scoped read semantics'
  );
  assert(
    /CREATE POLICY "ga_facilities_scope_read"[\s\S]*FROM "public"\."store_managers"/.test(baselineMigration) ||
      /CREATE POLICY "ga_facilities_scope_read"[\s\S]*FROM store_managers/.test(allSupabaseSql),
    'facility RLS should retain store_managers scoped read semantics'
  );
  assert(inventoryTransactionsAccess.includes('isCurrentUserStoreManager'), 'inventory read access should support store manager scope');
});

runCase('navigation and service page do not authorize by email or role name', () => {
  [navigation, navbarPermissions, servicePage].forEach((text, index) => {
    assert(!/@example\.test/i.test(text), `file index ${index} must not authorize by DEV email`);
    assert(!/email\s*===/i.test(text), `file index ${index} must not authorize by email comparison`);
    assert(!/roleName\s*===|role\s*name/i.test(text), `file index ${index} must not authorize by role name`);
  });
});

runCase('empty groups remain filtered and planned features remain unavailable', () => {
  assert(navigation.includes('.filter((group) => group.items.length > 0)'), 'empty nav groups must be hidden');
  assert(navigation.includes('isGeneralAffairsFeatureAvailable'), 'feature availability must remain centralized');
  assert(getNavigationItemBlock('part-request-review').includes("href: '/general-affairs/part-fulfillments'"), 'part fulfillment center must replace the planned part request review entry');
  assert(getNavigationItemBlock('transfer-receiving').includes("href: '/general-affairs/inventory/transfers'"), 'available transfer receiving must remain clickable');
  assert(!getNavigationItemBlock('inventory-count').includes('href:'), 'inventory count must not be clickable while planned');
});

console.log('General Affairs role matrix static audit summary');
console.log(JSON.stringify(ROLE_MATRIX.map((row) => ({
  businessRole: row.businessRole,
  roleCode: row.roleCode,
  expectedPermissions: row.expectedPermissions,
  forbiddenPermissions: row.forbiddenPermissions || [],
  storeScope: row.storeScope,
})), null, 2));
console.log('General Affairs role matrix static tests passed with vendor permission/RLS forward migration coverage');
