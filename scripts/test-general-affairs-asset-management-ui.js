const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertIncludes(content, needle, label) {
  if (!content.includes(needle)) {
    throw new Error(`${label}: missing "${needle}"`);
  }
}

function assertNotIncludes(content, needle, label) {
  if (content.includes(needle)) {
    throw new Error(`${label}: must not include "${needle}"`);
  }
}

function pass(label) {
  console.log(`PASS ${label}`);
}

const shared = read('components/general-affairs/assets/AssetManagementUI.tsx');
const navigation = read('components/general-affairs/navigation.tsx');
const equipment = read('components/general-affairs/equipment/EquipmentManagementClient.tsx');
const facilities = read('components/general-affairs/facilities/FacilitiesClient.tsx');
const facilityCreate = read('components/general-affairs/facilities/FacilityCreatePageClient.tsx');
const facilityWarranty = read('components/general-affairs/facilities/FacilityWarrantyClient.tsx');
const equipmentCategory = read('components/general-affairs/assets/AssetCategoryManagementClient.tsx');
const equipmentCreate = read('components/general-affairs/equipment/EquipmentCreatePageClient.tsx');
const equipmentTemplatesPage = read('app/general-affairs/equipment/templates/page.tsx');
const equipmentApi = read('app/api/general-affairs/equipment/route.ts');
const resourceAttachments = read('components/general-affairs/attachments/ResourceAttachmentPanel.tsx');
const categoryPicker = read('components/general-affairs/assets/AssetCategoryPicker.tsx');
const equipmentWarranty = read('components/general-affairs/equipment/EquipmentWarrantyClient.tsx');
const maintenanceHistory = read('components/general-affairs/assets/AssetMaintenanceHistoryClient.tsx');
const serviceCenter = read('components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx');
const dashboard = read('components/general-affairs/dashboard/GeneralAffairsDashboardClient.tsx');
const partsClient = read('components/general-affairs/parts/PartsClient.tsx');
const partsPage = read('app/general-affairs/parts/page.tsx');
const sitePicker = read('components/general-affairs/assets/AssetSitePicker.tsx');
const siteFilter = read('components/general-affairs/assets/AssetSiteFilter.tsx');
const scopeTabs = read('components/general-affairs/assets/AssetScopeTabs.tsx');
const catalogPicker = read('components/general-affairs/assets/AssetCatalogPicker.tsx');

assertIncludes(shared, 'AssetKpiGrid', 'shared asset UI');
assertIncludes(sitePicker, '搜尋據點代碼、名稱或簡稱', 'shared searchable site picker');
assertIncludes(equipmentCreate, 'AssetSitePicker', 'equipment creation uses shared site picker');
assertIncludes(facilityCreate, 'AssetSitePicker', 'facility creation uses shared site picker');
assertIncludes(equipment, 'AssetSitePicker', 'equipment editing uses shared site picker');
assertIncludes(facilities, 'AssetSitePicker', 'facility editing uses shared site picker');
assertIncludes(equipment, 'AssetSiteFilter', 'equipment list uses searchable site filter');
assertIncludes(facilities, 'AssetSiteFilter', 'facility list uses searchable site filter');
assertIncludes(siteFilter, 'aria-label="依據點篩選"', 'site filter is accessible');
assertIncludes(siteFilter, '清除據點篩選', 'site filter has a clear action');
for (const needle of ['據點設備清冊', '公司設備型號', '據點設施清冊', '公司設施架型', "aria-current={active ? 'page' : undefined}"]) {
  assertIncludes(scopeTabs, needle, 'asset scope tabs');
}
assertIncludes(equipment, 'current="instances"', 'equipment list identifies instance scope');
assertIncludes(facilities, 'current="instances"', 'facility list identifies instance scope');
assertIncludes(shared, 'AssetTabs', 'shared asset UI');
assertIncludes(shared, 'AssetMaintenanceTimeline', 'shared asset UI');
assertIncludes(shared, 'AssetDetailPanel', 'shared asset UI');
pass('shared asset management components');

assertIncludes(catalogPicker, '搜尋${label}', 'company catalog picker is searchable');
assertIncludes(catalogPicker, '找不到相符主檔', 'company catalog picker handles no match');
assertIncludes(equipment, 'label="公司設備型號"', 'equipment edit can link company model');
assertIncludes(equipment, 'template_id: form.template_id || null', 'equipment edit preserves company model relationship');
assertNotIncludes(equipment, 'template_id: null', 'equipment edit does not clear company model relationship');
assertIncludes(facilities, 'label="公司設施架型"', 'facility edit can link company template');
assertIncludes(facilities, 'facility_template_id: form.facility_template_id || null', 'facility edit preserves company template relationship');
pass('legacy assets can link company catalogs');

assertNotIncludes(equipment, '<AssetTabs', 'equipment list page no module tabs');
assertNotIncludes(equipment, "label: '分類視圖'", 'equipment list page no category tab');
assertNotIncludes(equipment, "label: '保固追蹤'", 'equipment list page no warranty tab');
assertNotIncludes(equipment, "label: '維修歷程'", 'equipment list page no maintenance tab');
assertIncludes(equipment, '<AssetKpiGrid items={kpis} />', 'equipment KPI');
assertIncludes(equipment, '/api/general-affairs/equipment?', 'equipment existing API');
assertIncludes(equipment, 'href="/general-affairs/equipment/new"', 'equipment formal new route');
assertNotIncludes(equipment, 'href="/general-affairs/equipment/templates"', 'equipment list page should not expose equipment template action');
assertIncludes(equipment, 'href="/general-affairs/equipment/categories"', 'equipment category route');
assertIncludes(equipment, '/api/maintenance-requests?store_id=', 'equipment maintenance source');
assertIncludes(equipment, 'record.equipment_id === item.id', 'equipment maintenance link');
assertIncludes(equipment, 'has_warranty', 'equipment warranty field');
assertIncludes(equipment, 'warranty_end_date', 'equipment warranty field');
assertIncludes(equipment, 'ResourceAttachmentPanel', 'equipment attachment panel');
assertIncludes(equipment, 'resourceType="EQUIPMENT"', 'equipment attachment resource type');
assertIncludes(equipment, '重新編輯既有設備時，可在此補充圖片或 PDF', 'equipment edit attachment panel guidance');
assertIncludes(equipment, 'resourceId={editing.id}', 'equipment edit attachment panel uses editing id');
assertIncludes(equipment, 'function EquipmentThumbnail', 'equipment list thumbnail component');
assertIncludes(equipment, 'thumbnailUrls', 'equipment list thumbnail state');
assertIncludes(equipment, "resourceType: 'EQUIPMENT'", 'equipment list thumbnail attachment resource type');
assertIncludes(equipment, "attachment.purpose === 'PRIMARY_IMAGE'", 'equipment list prefers primary image attachment');
assertIncludes(equipment, 'attachment.signed_url', 'equipment list uses signed attachment URL');
assertIncludes(equipment, '<EquipmentThumbnail src={thumbnailUrls[item.id]} name={item.name} />', 'equipment desktop and mobile list render thumbnail');
pass('equipment list page split from submodules');

assertNotIncludes(facilities, '<AssetTabs', 'facility list page no module tabs');
assertNotIncludes(facilities, "label: '分類視圖'", 'facility list page no category tab');
assertNotIncludes(facilities, "label: '維修歷程'", 'facility list page no maintenance tab');
assertIncludes(facilities, '<AssetKpiGrid items={kpis} />', 'facility KPI');
assertIncludes(facilities, '/api/general-affairs/facilities?', 'facility existing API');
assertIncludes(facilities, 'href="/general-affairs/facilities/new"', 'facility formal new route');
assertIncludes(facilities, 'href="/general-affairs/facilities/categories"', 'facility category route');
assertIncludes(facilities, '/api/maintenance-requests?store_id=', 'facility maintenance source');
assertIncludes(facilities, 'record.facility_id === item.id', 'facility maintenance link');
assertIncludes(facilities, '未建置的巡檢、保養排程與廠商流程', 'facility unsupported module wording');
assertIncludes(facilities, 'ResourceAttachmentPanel', 'facility attachment panel');
assertIncludes(facilities, 'resourceType="FACILITY"', 'facility attachment resource type');
pass('facility list page split from submodules');

for (const route of [
  'app/general-affairs/equipment/categories/page.tsx',
  'app/general-affairs/equipment/new/page.tsx',
  'app/general-affairs/equipment/warranties/page.tsx',
  'app/general-affairs/equipment/maintenance-history/page.tsx',
  'app/general-affairs/facilities/categories/page.tsx',
  'app/general-affairs/facilities/new/page.tsx',
  'app/general-affairs/facilities/warranties/page.tsx',
  'app/general-affairs/facilities/maintenance-history/page.tsx',
]) {
  if (!fs.existsSync(path.join(root, route))) throw new Error(`missing route ${route}`);
}
pass('equipment and facility submodule routes');

for (const needle of [
  "id: 'equipment-list'",
  "label: '設備清冊'",
  "href: '/general-affairs/equipment/categories'",
  "href: '/general-affairs/equipment/new'",
  "href: '/general-affairs/equipment/warranties'",
  "href: '/general-affairs/equipment/maintenance-history'",
  "href: '/general-affairs/facilities/categories'",
  "href: '/general-affairs/facilities/new'",
  "href: '/general-affairs/facilities/maintenance-history'",
  "id: 'parts-list'",
  "href: '/general-affairs/parts'",
  "href: '/general-affairs/parts/categories'",
  "id: 'inventory-management'",
  "label: '庫存總覽'",
  "href: '/general-affairs/inventory'",
  "href: '/general-affairs/inventory/locations'",
  "label: '庫存流水'",
  "label: '合作廠商'",
]) {
  assertIncludes(navigation, needle, 'asset submodule navigation');
}
assertIncludes(navigation, "id: 'parts'", 'parts parent sidebar item');
assertIncludes(navigation, "label: '料件列表'", 'parts list child sidebar item');
assertIncludes(navigation, "label: '料件分類'", 'part categories child sidebar item');
assertIncludes(navigation, "label: '新增料件'", 'part new planned sidebar item');
assertIncludes(navigation, "label: '適用料件設定'", 'part compatibility sidebar item');
assertIncludes(navigation, "label: '使用紀錄'", 'part usage history planned sidebar item');
assertIncludes(navigation, "id: 'equipment-templates'", 'company equipment catalog appears in sidebar navigation');
assertIncludes(navigation, "href: '/general-affairs/equipment/templates'", 'company equipment catalog route appears in sidebar navigation');
assertIncludes(equipmentTemplatesPage, 'EquipmentTemplatesClient', 'company equipment catalog route renders its own screen');
assertNotIncludes(equipmentTemplatesPage, "redirect('/general-affairs/equipment')", 'company equipment catalog must not redirect to equipment list');
assertIncludes(equipmentApi, 'template:ga_equipment_templates', 'equipment assets retain company model relationship');
assertIncludes(equipmentApi, "searchParams.get('templateId')", 'equipment API supports company model filtering');
assertIncludes(equipment, "params.set('templateId', templateFilter)", 'equipment list applies company model filter');
assertIncludes(facilities, "params.set('templateId', templateFilter)", 'facility list applies company model filter');
assertIncludes(equipment, '目前查看：', 'equipment list shows active company model filter');
assertIncludes(facilities, '目前查看：', 'facility list shows active company model filter');
assertIncludes(equipment, '公司設備型號', 'equipment details expose their company model');
assertIncludes(equipment, '公司型號', 'equipment list exposes its company model');
assertIncludes(facilities, '公司設施架型', 'facility details expose their company template');
assertIncludes(facilities, '公司架型', 'facility list exposes its company template');
assertIncludes(navigation, "id: 'equipment-new'", 'equipment new restored to sidebar navigation');
assertIncludes(navigation, "id: 'facility-list'", 'facility list sidebar item');
assertIncludes(navigation, "label: '設施清冊'", 'facility list sidebar item');
assertNotIncludes(navigation, "id: 'facility-warranties'", 'facility warranty omitted from latest sidebar IA');
assertIncludes(navigation, "id: 'facility-new'", 'facility new restored to sidebar navigation');
assertNotIncludes(serviceCenter, "title: '設備範本'", 'equipment template removed from service home shortcuts');
assertNotIncludes(dashboard, "label: '設備範本'", 'equipment template removed from dashboard quick actions');
pass('asset submodule navigation permissions');

assertIncludes(equipmentCategory, '/api/general-affairs/categories?type=', 'category page category API');
assertIncludes(equipmentCategory, '最多只能建立三層', 'category page max depth validation');
assertIncludes(equipmentCategory, '不可選擇自己或自己的子分類', 'category page cycle validation');
assertIncludes(equipmentCategory, '分類代碼', 'category page code field');
assertIncludes(equipmentCategory, 'function CategoryParentPicker', 'category parent hierarchical picker component');
assertIncludes(equipmentCategory, '第 1 層', 'category parent picker first level');
assertIncludes(equipmentCategory, '目前上層路徑', 'category parent picker selected path');
assertIncludes(equipmentCategory, '設為第一層分類', 'category parent picker root action');
assertIncludes(equipmentCategory, '先選第 1 層分類，再依序選擇下層', 'category parent picker guidance');
assertIncludes(equipmentCategory, 'canSelectAsParent', 'category parent picker selectable validation');
assertIncludes(equipmentCategory, 'childrenByParent.get(category.id)', 'category parent picker cascading children');
assertIncludes(equipmentCategory, '第二層分類 code 4 碼', 'category page second-level asset code rule');
assertIncludes(equipmentCategory, '第三層 6 碼不可作為資產編號前綴', 'category page rejects third-level asset prefix');
assertNotIncludes(equipmentCategory, '<select value={form.parent_id}', 'category parent picker no flat select');
pass('equipment and facility category management');

assertIncludes(equipmentCreate, 'GeneralAffairsFormPage', 'equipment new form page template');
assertIncludes(equipmentCreate, '這個據點要新增哪一種設備？', 'site equipment creation starts from company catalog');
assertIncludes(equipmentCreate, '/api/general-affairs/equipment/templates', 'store equipment creation loads company equipment catalog');
assertIncludes(equipmentCreate, 'template_id: form.template_id || null', 'store equipment keeps selected company model');
for (const label of ['基本資訊', '安裝資訊', '保固資訊', '其他資訊', '完成確認']) {
  assertIncludes(equipmentCreate, label, 'equipment new stepper labels');
}
assertIncludes(equipmentCreate, 'fieldRefs.current', 'equipment new field error focus');
assertIncludes(equipmentCreate, 'formatCurrency', 'equipment purchase amount formatting');
assertIncludes(equipmentCreate, '設備照片', 'equipment attachment upload section');
assertIncludes(equipmentCreate, '/api/general-affairs/attachments', 'equipment attachment upload API');
assertIncludes(equipmentCreate, "formData.set('resource_type', 'EQUIPMENT')", 'equipment attachment resource type');
assertIncludes(equipmentCreate, '設備已新增，但附件上傳失敗', 'equipment create handles attachment failure');
assertIncludes(equipmentCreate, 'function safeErrorMessage', 'equipment create formats plain object errors safely');
assertIncludes(equipmentCreate, "safeErrorMessage(uploadError, '請稍後在設備詳情重新上傳附件')", 'equipment create attachment failure uses safe message');
assertIncludes(equipmentCreate, '新增數量 *', 'equipment create supports store batch quantity');
assertIncludes(equipmentCreate, '每台序號、條碼與實機照片請在建立後逐台補登', 'batch creation explains per-device follow-up');
assertIncludes(equipmentCreate, '每台購買金額', 'batch creation keeps purchase amount semantics clear');
assertIncludes(equipmentCreate, '既有資產補登', 'equipment form offers legacy asset intake');
assertIncludes(equipmentCreate, '新購／新開店設備', 'equipment form offers new purchase intake');
assertIncludes(equipmentCreate, "form.entry_mode === 'NEW_PURCHASE' && !form.purchased_at", 'new purchases require a purchase date');
assertIncludes(equipmentCreate, "form.entry_mode === 'NEW_PURCHASE' && (!form.purchase_amount", 'new purchases require a positive unit amount');
assertIncludes(equipmentCreate, 'entry_mode: form.entry_mode', 'equipment preserves intake source');
assertIncludes(equipmentApi, 'Array.from({ length: quantity }', 'equipment API creates one asset row per quantity');
assertIncludes(equipmentApi, 'createdCount: created.length', 'equipment API reports actual created count');
assertIncludes(equipmentApi, "onboarding_status: 'NEEDS_EQUIPMENT_PHOTO'", 'batch equipment starts in per-device completion flow');
assertNotIncludes(equipmentCreate, 'uploadError instanceof Error ? uploadError.message', 'equipment create must not lose plain object upload errors');
assertIncludes(equipmentCreate, '購買途徑／供應商', 'equipment purchase source supplier label');
assertIncludes(equipmentCreate, 'purchase_source_supplier', 'equipment purchase source supplier field');
assertIncludes(equipmentCreate, '後續廠商主檔流程完成後可改為選擇供應商', 'equipment supplier future vendor linkage guidance');
assertNotIncludes(equipmentCreate, '廠牌／廠商', 'equipment create no stale manufacturer/vendor label');
assertNotIncludes(equipmentCreate, 'manufacturer: string', 'equipment create no manufacturer field');
assertIncludes(equipmentCreate, 'WARRANTY_CLAIM_METHODS', 'equipment warranty claim method options');
assertIncludes(equipmentCreate, '保留購買方發票／收據', 'equipment warranty invoice method');
assertIncludes(equipmentCreate, '上網登錄保固', 'equipment warranty online registration method');
assertIncludes(equipmentCreate, 'warranty_claim_method', 'equipment warranty claim method field');
assertIncludes(equipmentCreate, 'warranty_claim_notes', 'equipment warranty other method notes field');
assertIncludes(equipmentCreate, "form.warranty_claim_method === 'OTHER'", 'equipment warranty other method conditional notes');
assertIncludes(equipmentCreate, '其他保固方式備註', 'equipment warranty other method notes label');
assertIncludes(equipmentCreate, '請補充申請保固時需要準備的資料', 'equipment warranty other method notes guidance');
assertIncludes(equipmentCreate, '保固文件附件', 'equipment warranty document upload section');
assertIncludes(equipmentCreate, "WARRANTY_DOCUMENT: '保固文件'", 'equipment warranty document attachment purpose');
assertIncludes(equipmentCreate, "addPendingAttachments(event.target.files, 'WARRANTY_DOCUMENT')", 'equipment warranty document upload uses warranty purpose');
assertIncludes(equipmentCreate, "formData.set('purpose', purpose)", 'equipment attachment upload sends grouped purpose');
assertIncludes(equipmentCreate, 'function EquipmentCategoryPicker', 'equipment create hierarchical category picker wrapper');
assertIncludes(equipmentCreate, 'CategoryCascadePicker', 'equipment create uses shared category picker');
assertIncludes(categoryPicker, '目前分類路徑', 'shared category picker selected path');
assertIncludes(categoryPicker, '搜尋分類名稱或代碼', 'shared category picker keyword search');
assertIncludes(categoryPicker, 'searchResults', 'shared category picker search results');
assertIncludes(categoryPicker, 'childrenByParent.get(category.id)', 'shared category picker cascading children');
assertIncludes(categoryPicker, 'getGeneralAffairsCategoryPath', 'shared category picker path helper');
assertNotIncludes(equipmentCreate, '<select ref={(node) => { fieldRefs.current.category_id = node; }}', 'equipment create no flat category select');
assertIncludes(equipmentCreate, 'getLevel2Category', 'equipment asset code uses level 2 category helper');
assertIncludes(equipmentCreate, '/^[A-Z]{2}\\d{2}$/', 'equipment asset code requires 4-char level 2 category code');
assertIncludes(equipmentCreate, '第二層分類代碼 4 碼 + 購買日期 YYYYMMDD + 3 碼流水號', 'equipment asset code formal format');
assertIncludes(equipmentCreate, '同一第二層分類與同一購買日期分組', 'equipment asset code sequence scope');
assertIncludes(equipmentCreate, '儲存時由後端安全產生', 'equipment asset code backend generation wording');
assertNotIncludes(equipmentCreate, '2 碼英文資產前綴', 'equipment asset code no first-level prefix rule');
assertIncludes(equipmentCreate, '###', 'equipment asset code preview only');
assertIncludes(equipmentCreate, 'asset_code: null', 'equipment does not generate asset code in frontend');
assertIncludes(equipmentCreate, '標籤列印待資產編號產生後啟用', 'equipment label printing placeholder');
assertNotIncludes(equipmentCreate, '資產編號自動流水仍待後續 forward migration 正式啟用', 'equipment asset code no stale pending migration wording');
pass('equipment formal create form');

assertIncludes(facilityCreate, 'CategoryCascadePicker', 'facility create uses shared category picker');
assertIncludes(facilityCreate, 'function FacilityCategoryPicker', 'facility create hierarchical category picker wrapper');
assertNotIncludes(facilityCreate, '<select ref={(node) => { fieldRefs.current.category_id = node; }}', 'facility create no flat category select');
assertIncludes(facilityCreate, '保固資訊', 'facility create warranty section');
assertIncludes(facilityCreate, 'facility_has_warranty', 'facility create warranty specs flag');
assertIncludes(facilityCreate, 'facility_warranty_end_date', 'facility create warranty specs end date');
assertIncludes(facilityCreate, 'facility_warranty_claim_method', 'facility create warranty specs claim method');
assertIncludes(facilityCreate, 'facility_warranty_claim_notes', 'facility create warranty specs notes');
assertIncludes(facilityCreate, '保固文件', 'facility create warranty attachment section');
assertIncludes(facilityCreate, "formData.set('resource_type', 'FACILITY')", 'facility create attachment upload uses facility resource type');
assertIncludes(facilityCreate, '設施已新增，但附件上傳失敗', 'facility create handles attachment failure');
assertIncludes(facilities, 'facility_has_warranty', 'facility list warranty specs flag');
assertIncludes(facilities, 'facility_warranty_end_date', 'facility list warranty specs end date');
assertIncludes(facilities, '保固管理', 'facility list warranty action and edit section');
assertIncludes(facilities, 'href="/general-affairs/facilities/warranties"', 'facility warranty route action');
assertIncludes(facilities, 'buildFacilitySpecs', 'facility edit preserves specs and warranty keys');
assertIncludes(facilityWarranty, '/api/general-affairs/facilities?pageSize=100', 'facility warranty uses existing facility API');
assertIncludes(facilityWarranty, "resourceType: 'FACILITY'", 'facility warranty uses existing facility attachment API');
assertIncludes(facilityWarranty, 'facility_warranty_claim_method', 'facility warranty reads claim method from specs');
assertIncludes(facilityWarranty, 'facility_warranty_claim_notes', 'facility warranty reads claim notes from specs');
assertIncludes(facilityWarranty, '設施保固管理', 'facility warranty page title');
assertNotIncludes(facilityWarranty, 'Math.random', 'facility warranty no fake data');
pass('facility warranty management');

assertIncludes(partsPage, "import PartsClient from '@/components/general-affairs/parts/PartsClient'", 'parts page imports client');
assertIncludes(partsClient, "'use client'", 'parts client is client component');
assertIncludes(partsClient, '/api/general-affairs/parts?', 'parts client uses existing parts API');
assertIncludes(partsClient, 'GeneralAffairsPageHeader', 'parts client uses shared page header');
assertIncludes(partsClient, '料件列表', 'parts client has list title');
assertIncludes(partsClient, '庫存管理', 'parts client links inventory management');
assertIncludes(partsClient, '庫存位置', 'parts client links inventory locations');
assertIncludes(partsClient, '沒有料件查看權限', 'parts client preserves permission error visibility');
assertNotIncludes(partsClient, 'Math.random', 'parts client no fake data');
assertNotIncludes(partsClient, 'db push', 'parts client no db operations');
pass('parts list client restored');

assertIncludes(resourceAttachments, '/api/general-affairs/attachments?', 'resource attachment list API');
assertIncludes(resourceAttachments, '/api/general-affairs/attachments/${attachment.id}', 'resource attachment delete API');
assertIncludes(resourceAttachments, 'signed_url', 'resource attachment signed URL preview');
assertIncludes(resourceAttachments, '檔案格式不支援', 'resource attachment format error');
assertIncludes(resourceAttachments, '超過 20MB 限制', 'resource attachment size error');
assertIncludes(resourceAttachments, '請輸入刪除', 'resource attachment deletion reason');
assertIncludes(serviceCenter, 'resourceType="MAINTENANCE_REQUEST"', 'maintenance request shared attachment panel');
pass('shared resource attachment UI');

assertIncludes(equipmentWarranty, 'has_warranty', 'warranty page real field');
assertIncludes(equipmentWarranty, 'warranty_end_date', 'warranty page real field');
assertIncludes(equipmentWarranty, 'WARRANTY_CLAIM_METHOD_LABELS', 'warranty page claim method labels');
assertIncludes(equipmentWarranty, 'warranty_claim_method', 'warranty page reads claim method from specs');
assertIncludes(equipmentWarranty, 'warranty_claim_notes', 'warranty page reads claim notes from specs');
assertIncludes(equipmentWarranty, "attachment.purpose === 'WARRANTY_DOCUMENT'", 'warranty page filters warranty document attachments');
assertIncludes(equipmentWarranty, 'function WarrantyDocumentLinks', 'warranty page document links component');
assertIncludes(equipmentWarranty, '文件 / 單據', 'warranty page document column');
assertIncludes(equipmentWarranty, '申請保固方式', 'warranty page claim method column');
assertNotIncludes(equipmentWarranty, '保固廠商、文件與自動通知尚未建置', 'warranty page no stale unsupported document wording');
assertIncludes(maintenanceHistory, '/api/maintenance-requests?pageSize=100', 'maintenance history real source');
assertIncludes(maintenanceHistory, 'Boolean(record.equipment_id)', 'equipment maintenance filter');
assertIncludes(maintenanceHistory, 'Boolean(record.facility_id)', 'facility maintenance filter');
pass('warranty and maintenance submodule pages');

const combined = [shared, equipment, facilities].join('\n');
assertNotIncludes(combined, 'Math.random', 'asset UI no fake data');
assertNotIncludes(combined, 'mock', 'asset UI no mock data');
assertNotIncludes(combined, 'dummy', 'asset UI no dummy data');
assertNotIncludes(combined, 'ga_inventory_transactions', 'asset UI no inventory transaction scope');
assertNotIncludes(combined, 'db push', 'asset UI no db operations');
assertNotIncludes(combined, 'migration repair', 'asset UI no migration operations');
pass('asset UI does not add fake data or DB operations');

console.log('General Affairs asset management UI static tests passed');
