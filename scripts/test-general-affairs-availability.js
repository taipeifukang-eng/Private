#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const generalAffairsPage = read('components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx');
const navbar = read('components/Navbar.tsx');
const navbarPermissions = read('hooks/useNavbarPermissions.ts');
const navigation = read('components/general-affairs/navigation.tsx');
const unavailablePage = read('components/general-affairs/ModuleUnavailablePage.tsx');
const equipmentPage = read('app/general-affairs/equipment/page.tsx');
const equipmentTemplatesPage = read('app/general-affairs/equipment/templates/page.tsx');
const facilitiesPage = read('app/general-affairs/facilities/page.tsx');
const partsPage = read('app/general-affairs/parts/page.tsx');
const vendorFormMigration = read('supabase/migrations/20260724092830_general_affairs_vendor_form_sections.sql');
const vendorPermissionRlsMigration = read('supabase/migrations/20260824090000_general_affairs_vendor_permissions_rls.sql');

assert(
  generalAffairsPage.includes("const MODULE_NOT_AVAILABLE_MESSAGE = '此功能尚未在目前測試環境開放。';"),
  'general affairs page must define a safe unavailable message'
);

assert(
    generalAffairsPage.includes("{ key: 'home', label: '服務首頁', icon: Home }") &&
    generalAffairsPage.includes("{ key: 'maintenance', label: '維修回報', icon: Wrench }") &&
    generalAffairsPage.includes("{ key: 'work-orders', label: '工單中心', icon: ClipboardList }") &&
    generalAffairsPage.includes("{ key: 'vendors', label: '廠商管理', icon: Briefcase }") &&
    generalAffairsPage.includes('visibleServiceNavItems') &&
    generalAffairsPage.includes('canAccessMaintenanceModule'),
  'general affairs internal nav must expose completed maintenance/work-order/vendor entries with permission gating'
);

assert(
  generalAffairsPage.includes("router.push('/general-affairs/inventory')"),
  'general affairs home must keep a working inventory management entry'
);

assert(
  generalAffairsPage.includes("openSection('maintenance'") &&
    generalAffairsPage.includes("openSection('work-orders'") &&
    generalAffairsPage.includes("openSection('vendors'") &&
    generalAffairsPage.includes('renderNewReport()') &&
    generalAffairsPage.includes('renderMyReports()') &&
    generalAffairsPage.includes('renderWorkOrderCenter()') &&
    generalAffairsPage.includes('renderVendorManagement()'),
  'general affairs home and main content must restore maintenance, work-order and vendor modules'
);

assert(
  generalAffairsPage.includes("href: '/general-affairs/equipment'") &&
    generalAffairsPage.includes("href: '/general-affairs/facilities'") &&
    generalAffairsPage.includes("href: '/general-affairs/parts'") &&
    !generalAffairsPage.includes("href: '/general-affairs/equipment/templates'"),
  'general affairs home must expose completed master data pages without equipment template shortcut'
);

assert(
  generalAffairsPage.includes("'part-requests'") &&
    generalAffairsPage.includes("setReportResourceFilter('material')") &&
    generalAffairsPage.includes('const renderPartRequestRecords = () => renderMyReports();') &&
    generalAffairsPage.includes("if (reportResourceFilter !== 'all' && request.resource_type !== reportResourceFilter) return false;") &&
    generalAffairsPage.includes('reportResourceFilters') &&
    generalAffairsPage.includes("key: 'material'") &&
    generalAffairsPage.includes("label: '料件 / 耗材'") &&
    generalAffairsPage.includes('onClick={() => setResourceType(resource.key)}') &&
    generalAffairsPage.includes('送出回報') &&
    generalAffairsPage.includes('維修回報已送出') &&
    generalAffairsPage.includes('新增料件申請') &&
    generalAffairsPage.includes('送出料件申請') &&
    generalAffairsPage.includes('料件申請已送出') &&
    generalAffairsPage.includes('isPartRequestEntry') &&
    !generalAffairsPage.includes('openMaterialRequestForm') &&
    !generalAffairsPage.includes("['申請料件', 'part-requests', Package]") &&
    !generalAffairsPage.includes("['申請料件', 'parts', Package]") &&
    !generalAffairsPage.includes("['料件申請紀錄', 'parts', FileText]"),
  'material requests must have a distinct UI label while staying in the maintenance-backed material data flow'
);

assert(
  generalAffairsPage.includes('htmlFor="maintenance-report-photo-input"') &&
    generalAffairsPage.includes('id="maintenance-report-photo-input"') &&
    generalAffairsPage.includes('accept="image/*,.heic,.heif"') &&
    generalAffairsPage.includes("event.currentTarget.value = '';") &&
    generalAffairsPage.includes("lowerName.endsWith('.heic')") &&
    generalAffairsPage.includes("lowerName.endsWith('.heif')") &&
    !generalAffairsPage.includes('photoInputRef.current?.click()'),
  'maintenance report photo picker must use native label/input selection, support HEIC/HEIF, and allow reselecting the same file'
);

assert(
  !generalAffairsPage.includes("載入廠商管理資料失敗：${error.message || error}") &&
  !generalAffairsPage.includes("儲存廠商失敗：${error.message || error}") &&
  !generalAffairsPage.includes("儲存服務分類失敗：${error.message || error}") &&
  !generalAffairsPage.includes("儲存服務區域失敗：${error.message || error}"),
  'general affairs UI must not surface raw vendor/service schema errors'
);

assert(
  generalAffairsPage.includes("activeSection === 'vendors' && canAccessService") &&
    generalAffairsPage.includes('loadVendorManagementData()'),
  'general affairs page must only query vendor/service tables when the vendor module is opened'
);

[
  'service_capability_note',
  'billing_title',
  'billing_address',
  'invoice_type',
  'payment_terms',
  'payment_methods',
  'accounting_notes',
  'cooperation_start_date',
  'contract_end_date',
  'contract_required',
  'preferred_vendor',
  'cooperation_notes',
  'attachment_names',
].forEach((columnName) => {
  assert(
    vendorFormMigration.includes(`ADD COLUMN IF NOT EXISTS ${columnName}`),
    `vendor form migration must add missing ga_vendors column ${columnName}`
  );
});

assert(
  vendorFormMigration.includes('ALTER TABLE ga_vendors') &&
    !vendorFormMigration.includes('CREATE TABLE') &&
    !vendorFormMigration.includes('DROP TABLE') &&
    !vendorFormMigration.includes('ga_inventory_') &&
    !vendorFormMigration.includes('maintenance_requests') &&
    !vendorFormMigration.includes('INSERT INTO'),
  'vendor form migration must only add ga_vendors form columns'
);

assert(
    navigation.includes("href: '/general-affairs'") &&
    navigation.includes("label: '服務首頁'") &&
    navigation.includes("href: '/general-affairs/reports/new'") &&
    navigation.includes("label: '新增需求'") &&
    navigation.includes("href: '/general-affairs/reports/mine'") &&
    navigation.includes("label: '我的追蹤'") &&
    !navigation.includes("href: '/general-affairs/part-requests/new'") &&
    !navigation.includes("label: '新增料件申請'") &&
    !navigation.includes("href: '/general-affairs/part-requests'") &&
    !navigation.includes("label: '我的料件申請'") &&
    navigation.includes("href: '/general-affairs/work-orders'") &&
    navigation.includes("label: '工單中心'") &&
    !navigation.includes("href: '/general-affairs?section=part-requests&action=new'") &&
    !navigation.includes("label: '料件/耗材回報紀錄'") &&
    navigation.includes("href: '/general-affairs/vendors'") &&
    navigation.includes("label: '廠商資料'") &&
    navigation.includes("href: '/general-affairs/vendors/categories'") &&
    navigation.includes("label: '服務分類'") &&
    navigation.includes("href: '/general-affairs/vendors/regions'") &&
    navigation.includes("label: '服務區域'") &&
    navigation.includes("href: '/general-affairs/vendors/stats'") &&
    navigation.includes("label: '合作紀錄'") &&
    navigation.includes("href: '/general-affairs/inventory'") &&
    navigation.includes("label: '庫存管理'") &&
    navigation.includes("href: '/general-affairs/equipment'") &&
    navigation.includes("label: '設備清冊'") &&
    navigation.includes("href: '/general-affairs/equipment/templates'") &&
    navigation.includes("id: 'equipment-templates'") &&
    navigation.includes("href: '/general-affairs/facilities'") &&
    navigation.includes("label: '設施清冊'") &&
    navigation.includes("href: '/general-affairs/parts'") &&
    navigation.includes("label: '料件管理'"),
  'general affairs sidebar must keep service home, request entries, inventory and master data entries'
);

[
  'general_affairs.vendor.view',
  'general_affairs.vendor.manage',
  'general_affairs.service_category.view',
  'general_affairs.service_category.manage',
  'general_affairs.service_region.view',
  'general_affairs.service_region.manage',
  'general_affairs.cooperation_record.view',
].forEach((permissionCode) => {
  assert(
    vendorPermissionRlsMigration.includes(`'${permissionCode}'`),
    `vendor permission/RLS migration must include ${permissionCode}`
  );
});

assert(
  vendorPermissionRlsMigration.includes('DROP POLICY IF EXISTS p1e_ga_vendors_read') &&
    vendorPermissionRlsMigration.includes('DROP POLICY IF EXISTS p1e_ga_service_categories_read') &&
    vendorPermissionRlsMigration.includes('DROP POLICY IF EXISTS p1e_ga_service_regions_read') &&
    vendorPermissionRlsMigration.includes("('dev_ga_category_manage', 'general_affairs.vendor.manage')"),
  'vendor permission/RLS migration must replace vendor/service policies and seed DEV GA manager permissions'
);

assert(
    navbarPermissions.includes("permissionSet.has('general_affairs.inventory_balance.view')") &&
    navbarPermissions.includes('GA_MAINTENANCE_MODULE_CODES') &&
    navbarPermissions.includes('GA_WORK_ORDER_MODULE_CODES') &&
    navbarPermissions.includes("permissionSet.has('general_affairs.inventory_transaction.view')") &&
    navbarPermissions.includes("permissionSet.has('general_affairs.inventory_transaction.manage')") &&
    navbarPermissions.includes("permissionSet.has('general_affairs.equipment.view')") &&
    navbarPermissions.includes("permissionSet.has('general_affairs.equipment.manage')") &&
    navbarPermissions.includes("permissionSet.has('general_affairs.facility.view')") &&
    navbarPermissions.includes("permissionSet.has('general_affairs.facility.manage')") &&
    navbarPermissions.includes("permissionSet.has('general_affairs.part.view')") &&
    navbarPermissions.includes("permissionSet.has('general_affairs.part.manage')") &&
    navbar.includes('href="/general-affairs"') &&
    !navbar.includes('getVisibleGeneralAffairsNavbarItems') &&
    navigation.includes("requiredAnyPermissionFlags: ['canAccessGeneralAffairsInventory']") &&
    navigation.includes("requiredAnyPermissionFlags: ['canAccessGeneralAffairsMaintenance']") &&
    navigation.includes("requiredAnyPermissionFlags: ['canAccessGeneralAffairsWorkOrders']") &&
    navigation.includes("requiredAnyPermissionFlags: ['canAccessGeneralAffairsVendors']") &&
    navigation.includes("requiredAnyPermissionFlags: ['canAccessGeneralAffairsEquipment']") &&
    navigation.includes("requiredAnyPermissionFlags: ['canAccessGeneralAffairsFacilities']") &&
    navigation.includes("requiredAnyPermissionFlags: ['canAccessGeneralAffairsParts']"),
  'general affairs navbar entry and sidebar items must be gated by effective module permissions'
);

assert(
  equipmentPage.includes("EquipmentManagementClient") &&
    !equipmentPage.includes("ModuleUnavailablePage"),
  'equipment direct route must render the completed equipment client'
);

assert(
  !equipmentTemplatesPage.includes("redirect('/general-affairs/equipment')") &&
    equipmentTemplatesPage.includes("EquipmentTemplatesClient") &&
    !equipmentTemplatesPage.includes("ModuleUnavailablePage"),
  'equipment templates direct route must render the company equipment catalog'
);

assert(
  facilitiesPage.includes("FacilitiesClient") &&
    !facilitiesPage.includes("ModuleUnavailablePage"),
  'facilities direct route must render the completed facilities client'
);

assert(
  partsPage.includes("PartsClient") &&
    !partsPage.includes("ModuleUnavailablePage"),
  'parts direct route must render the completed parts client'
);

assert(
  unavailablePage.includes('此功能尚未在目前測試環境開放。') &&
  !unavailablePage.includes('schema cache') &&
  !unavailablePage.includes('ga_vendors') &&
  !unavailablePage.includes('migration_'),
  'module unavailable page must use safe user-facing wording'
);

console.log('General affairs availability static tests passed');
