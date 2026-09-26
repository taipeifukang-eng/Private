const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pagePath = 'app/general-affairs/parts/compatibilities/page.tsx';
const clientPath = 'components/general-affairs/parts/PartCompatibilityManagementClient.tsx';
const navigationPath = 'components/general-affairs/navigation.tsx';
const featuresPath = 'components/general-affairs/features.ts';
const routePath = 'app/api/general-affairs/parts/target-compatibilities/route.ts';
const equipmentCreatePath = 'components/general-affairs/equipment/EquipmentCreatePageClient.tsx';
const equipmentTemplatesPath = 'components/general-affairs/equipment/EquipmentTemplatesClient.tsx';
const facilityTemplatesPath = 'components/general-affairs/facilities/FacilityTemplatesClient.tsx';
const facilityTemplatesRoutePath = 'app/api/general-affairs/facility-templates/route.ts';
const migrationPath = 'supabase/migrations/20260916093000_general_affairs_part_target_compatibilities.sql';
const templateMigrationPath = 'supabase/migrations/20260920093000_general_affairs_facility_templates.sql';
const equipmentTemplateMigrationPath = 'supabase/migrations/20260920113000_general_affairs_equipment_template_compatibilities.sql';

[pagePath, clientPath, navigationPath, featuresPath, routePath, migrationPath].forEach((file) => {
  assert(fs.existsSync(path.join(root, file)), `${file} should exist`);
});

const page = read(pagePath);
const client = read(clientPath);
const navigation = read(navigationPath);
const features = read(featuresPath);
const route = read(routePath);
const equipmentCreate = read(equipmentCreatePath);
const equipmentTemplates = read(equipmentTemplatesPath);
const facilityTemplates = read(facilityTemplatesPath);
const facilityTemplatesRoute = read(facilityTemplatesRoutePath);
const equipmentTemplatesRoute = read('app/api/general-affairs/equipment/templates/route.ts');
const migration = read(migrationPath);
const templateMigration = read(templateMigrationPath);
const equipmentTemplateMigration = read(equipmentTemplateMigrationPath);

console.log('RUN compatibility management route and navigation exist');
assert(page.includes('PartCompatibilityManagementClient'), 'compatibility route should render client');
assert(navigation.includes("id: 'part-compatibilities'"), 'nav item should exist');
assert(navigation.includes("href: '/general-affairs/parts/compatibilities'"), 'nav item should link to route');
assert(navigation.includes("featureKey: 'part_compatibilities'"), 'nav item should use feature flag');
assert(features.includes("part_compatibilities: {\n    key: 'part_compatibilities',\n    label: '相容性管理',\n    status: 'available'"), 'feature should be available');
console.log('PASS compatibility management route and navigation exist');

console.log('RUN compatibility management is template-first');
[
  '適用料件設定',
  "useState<TargetType>('facility_template')",
  '設備型號',
  'EPSON L6490、L3190',
  '設施架型',
  '設備或單店有不同需求',
  '返回共用架型',
  '共用架型',
  '搜尋架型',
  '搜尋料件',
  '本次設定',
  '儲存適用料件',
].forEach((text) => assert(client.includes(text), `missing target-first marker ${text}`));
assert(!client.includes('資料建立順序'), 'duplicate onboarding card should be removed');
assert(!client.includes('這裡解決什麼'), 'explanation sidebar should be removed');
console.log('PASS compatibility management is template-first');

console.log('RUN compatibility page uses existing catalogs only');
[
  '/api/general-affairs/equipment?pageSize=100',
  '/api/general-affairs/equipment/templates?pageSize=100',
  '/api/general-affairs/facilities?pageSize=100',
  '/api/general-affairs/facility-templates',
  '/api/general-affairs/parts?pageSize=100&isActive=true',
  '/api/general-affairs/parts/target-compatibilities?targetType=',
  "fetch('/api/general-affairs/parts/target-compatibilities'",
  'readList<EquipmentItem>',
  'readList<FacilityItem>',
  'readList<PartItem>',
].forEach((text) => assert(client.includes(text), `missing catalog integration ${text}`));
assert(!/supabase|create table|alter table|drop table|service_role/i.test(client), 'compatibility page must not perform direct database work');
console.log('PASS compatibility page uses existing catalogs only');

console.log('RUN compatibility persistence foundation exists');
[
  'ga_part_target_compatibilities',
  "CHECK (target_type IN ('EQUIPMENT', 'FACILITY'))",
  'uq_ga_part_target_compat_active',
  'ga_validate_part_target_compatibility',
  "current_user_has_permission('general_affairs.part.view')",
  "current_user_has_permission('general_affairs.part.manage')",
  "NOTIFY pgrst, 'reload schema'",
].forEach((text) => assert(migration.includes(text), `missing migration marker ${text}`));
[
  'canAccessPartCatalog',
  'canManageParts',
  'createAdminClient',
  'normalizeTargetType',
  'uniqueUuids',
  '.from(\'ga_part_target_compatibilities\')',
  "deletion_reason: 'REPLACED_BY_COMPATIBILITY_MANAGEMENT'",
  'added: addPartIds.length',
  'removed: removeIds.length',
].forEach((text) => assert(route.includes(text), `missing API marker ${text}`));
console.log('PASS compatibility persistence foundation exists');

console.log('RUN facility template compatibility inheritance exists');
assert(templateMigration.includes('ga_facility_templates'), 'facility template table should exist');
assert(templateMigration.includes("'FACILITY_TEMPLATE'"), 'compatibility target should support facility templates');
assert(templateMigration.includes('facility_template_id'), 'facility instances should reference a template');
assert(route.includes('includeInherited'), 'facility compatibility API should support inherited template parts');
assert(route.includes('inherited_from_template'), 'inherited compatibility rows should be identifiable');
console.log('PASS facility template compatibility inheritance exists');

console.log('RUN equipment template compatibility inheritance exists');
assert(equipmentTemplateMigration.includes("'EQUIPMENT_TEMPLATE'"), 'compatibility target should support equipment templates');
assert(equipmentTemplateMigration.includes('ga_equipment_templates'), 'equipment template validation should exist');
assert(route.includes(".select('template_id')"), 'equipment compatibility should resolve its template');
assert(route.includes(".eq('target_type', 'EQUIPMENT_TEMPLATE')"), 'equipment should inherit template parts');
console.log('PASS equipment template compatibility inheritance exists');

console.log('RUN equipment creation reuses equipment models');
[
  '這個據點要新增哪一種設備？',
  '/api/general-affairs/equipment/templates?pageSize=100',
  'template_id: form.template_id || null',
  '沿用該型號的適用料件',
  '找不到？先新增公司設備型號',
  'EQUIPMENT_DRAFT_KEY',
  'returnTo=/general-affairs/equipment/new',
].forEach((text) => assert(equipmentCreate.includes(text), `missing equipment model reuse marker ${text}`));
assert(!equipmentCreate.includes('template_id: null'), 'equipment creation should not discard the selected model');
assert(!equipmentCreate.includes('先以特殊設備建檔'), 'store equipment must not bypass the company equipment catalog');
console.log('PASS equipment creation reuses equipment models');

console.log('RUN company asset creation can set applicable parts');
[
  "targetType: 'EQUIPMENT_TEMPLATE'",
  '搜尋墨水、碳粉或其他配件',
  'selectedPartIds',
  'includeInherited=false',
  '未勾選的料件會在儲存後移除',
  '可能已經有這個公司設備',
  '使用這筆',
].forEach((text) => assert(equipmentTemplates.includes(text), `missing equipment catalog compatibility marker ${text}`));
[
  'targetType: "FACILITY_TEMPLATE"',
  '搜尋掛鉤、層板或其他配件',
  'selectedPartIds',
  'includeInherited=false',
  '未勾選的料件會在儲存後移除',
  '可能已經有這個公司設施',
  '使用這筆',
].forEach((text) => assert(facilityTemplates.includes(text), `missing facility catalog compatibility marker ${text}`));
console.log('PASS company asset creation can set applicable parts');

console.log('RUN company catalogs reject duplicate master data');
assert(facilityTemplatesRoute.includes('findDuplicateFacilityTemplate'), 'facility template API must reject duplicate catalog entries');
assert(facilityTemplatesRoute.includes('status: 409'), 'facility template duplicate must return conflict');
console.log('PASS company catalogs reject duplicate master data');

console.log('RUN company catalogs expose visible usage summaries');
['asset_count', 'site_count', "from('ga_equipment')"].forEach((text) =>
  assert(equipmentTemplatesRoute.includes(text), `missing equipment catalog usage marker ${text}`),
);
['asset_count', 'site_count', "from('ga_facilities')", 'facility_template_id'].forEach((text) =>
  assert(facilityTemplatesRoute.includes(text), `missing facility catalog usage marker ${text}`),
);
assert(equipmentTemplates.includes('個據點'), 'equipment catalog must show site usage');
assert(facilityTemplates.includes('個據點'), 'facility catalog must show site usage');
assert(equipmentTemplates.includes('/general-affairs/equipment?templateId='), 'equipment usage must link to filtered asset list');
assert(facilityTemplates.includes('/general-affairs/facilities?templateId='), 'facility usage must link to filtered asset list');
console.log('PASS company catalogs expose visible usage summaries');

console.log('General affairs part compatibility UI static tests passed');
