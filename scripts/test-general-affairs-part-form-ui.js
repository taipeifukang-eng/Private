const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pagePath = 'app/general-affairs/parts/new/page.tsx';
const clientPath = 'components/general-affairs/parts/PartCreatePageClient.tsx';
const partsListPath = 'components/general-affairs/parts/PartsClient.tsx';
const navigationPath = 'components/general-affairs/navigation.tsx';
const featuresPath = 'components/general-affairs/features.ts';
const attachmentsRoutePath = 'app/api/general-affairs/attachments/route.ts';
const partsValidationPath = 'lib/general-affairs/parts/validation.ts';
const categoryPickerPath = 'components/general-affairs/assets/AssetCategoryPicker.tsx';
const partAttachmentFixPath = 'supabase/migrations/20260810090000_allow_part_resource_attachments.sql';

[
  pagePath,
  clientPath,
  partsListPath,
  navigationPath,
  featuresPath,
  attachmentsRoutePath,
  partsValidationPath,
  categoryPickerPath,
  partAttachmentFixPath,
].forEach((file) => {
  assert(fs.existsSync(path.join(root, file)), `${file} should exist`);
});

const page = read(pagePath);
const client = read(clientPath);
const partsList = read(partsListPath);
const navigation = read(navigationPath);
const features = read(featuresPath);
const attachmentsRoute = read(attachmentsRoutePath);
const partsValidation = read(partsValidationPath);
const categoryPicker = read(categoryPickerPath);
const partAttachmentFix = read(partAttachmentFixPath);

console.log('RUN part create route exists');
assert(page.includes('PartCreatePageClient'), 'new part route should render PartCreatePageClient');
assert(navigation.includes("id: 'part-new'"), 'part-new nav item should exist');
assert(navigation.includes("href: '/general-affairs/parts/new'"), 'part-new nav item should link to new route');
assert(features.includes("part_new: {\n    key: 'part_new',\n    label: '新增料件',\n    status: 'available'"), 'part_new feature should be available');
assert(partsList.includes('href="/general-affairs/parts/new"'), 'parts list should expose create entry');
console.log('PASS part create route exists');

console.log('RUN part form has four simplified steps');
[
  '先填料件',
  '領用方式',
  '補充資料',
  '確認建立',
].forEach((label) => assert(client.includes(label), `missing step label ${label}`));
assert(client.includes("type StepId = 'basic' | 'units' | 'inventoryNotes' | 'confirm'"), 'part form should define four step ids');
assert(!client.includes("'compatibility' |"), 'part create steps should not include compatibility');
console.log('PASS part form has four simplified steps');

console.log('RUN optional part fields are progressively disclosed');
[
  '進階辨識資料',
  '進階領用設定',
  '系統欄位說明',
  '相容性不在新增料件時決定',
  '不確定時維持「1 個、限整數」即可',
].forEach((text) => assert(client.includes(text), `missing simplified disclosure marker ${text}`));
assert(client.includes('<details className="rounded-lg border border-slate-200 bg-white p-4 md:col-span-2">'), 'optional fields should use collapsed details blocks');
console.log('PASS optional part fields are progressively disclosed');

console.log('RUN quick presets reduce part setup decisions');
[
  'PART_QUICK_PRESETS',
  '快速類型',
  '一般用品',
  '消耗補充',
  '維修零件',
  '備品',
  'applyQuickPreset',
].forEach((text) => assert(client.includes(text), `missing quick preset marker ${text}`));
assert(client.includes("usage_type: 'CONSUMABLE'"), 'consumable preset should set usage type');
assert(!client.includes("compatibility_scope: 'RESTRICTED'"), 'quick presets must not decide compatibility');
assert(client.includes("allow_unpacking: true"), 'consumable preset should allow unpacking by default');
console.log('PASS quick presets reduce part setup decisions');

console.log('RUN fast confirm path keeps simple part creation short');
[
  'goConfirmFast',
  '直接確認',
  "...validateStep('basic')",
  "...validateStep('units')",
  "setCurrentStep('confirm')",
].forEach((text) => assert(client.includes(text), `missing fast confirm marker ${text}`));
assert(!client.includes("...validateStep('compatibility')"), 'fast confirm should not validate compatibility during part creation');
assert(client.includes("currentStep === 'basic'"), 'fast confirm should only appear on the first step');
console.log('PASS fast confirm path keeps simple part creation short');

console.log('RUN part master does not accept fake stock quantity');
[
  '本頁不輸入初始庫存',
  '初始數量、入庫、出庫、調增與調減都必須透過庫存交易建立流水',
  '庫存不在主檔建立',
].forEach((text) => assert(client.includes(text), `missing stock separation text: ${text}`));
assert(!/initial_stock|stock_qty|quantity_on_hand|balance_qty/.test(client), 'part create form must not send stock quantity fields');
console.log('PASS part master does not accept fake stock quantity');

console.log('RUN usage type is stored and compatibility is deferred');
[
  'REPAIR_PART',
  'CONSUMABLE',
  'SPARE_PART',
  'GENERAL_SUPPLY',
  'part_usage_type',
  'part_compatibility_scope',
  'UNDECIDED',
].forEach((text) => assert(client.includes(text), `missing usage or compatibility marker ${text}`));
assert(client.includes('相容性不在新增料件時決定，後續交由相容性管理模組維護'), 'compatibility deferral should be explicit');
console.log('PASS usage type is stored and compatibility is deferred');

console.log('RUN part creation does not manage compatibility');
assert(!client.includes('/api/general-affairs/parts/${partId}/compatibilities'), 'part create form must not create compatibility links');
assert(!client.includes('BRAND_MODEL'), 'part create form should not expose brand/model compatibility');
assert(!client.includes('VENDOR_SERIES'), 'part create form should not expose vendor series compatibility');
assert(!client.includes("newCompatibilityDraft('EQUIPMENT_TEMPLATE')"), 'part form must not add equipment template compatibility');
assert(!client.includes('/api/general-affairs/equipment/templates'), 'part form must not load equipment templates');
assert(!/facility_id|facility_category_id|FACILITY_COMPATIBILITY/.test(client), 'part form must not invent facility compatibility fields');
console.log('PASS part creation does not manage compatibility');

console.log('RUN part category picker supports cascade and search');
assert(client.includes('CategoryCascadePicker'), 'part form should use shared category picker');
assert(categoryPicker.includes('搜尋分類名稱或代碼'), 'shared category picker should support keyword search');
assert(categoryPicker.includes('childrenByParent.get(category.id)'), 'shared category picker should keep cascading children');
assert(categoryPicker.includes('getGeneralAffairsCategoryPath'), 'shared category picker should display selected path');
assert(categoryPicker.includes('searchResults'), 'shared category picker should compute search results');
console.log('PASS part category picker supports cascade and search');

console.log('RUN part image upload uses shared attachment foundation');
assert(attachmentsRoute.includes("'PART'") && attachmentsRoute.includes("'SERVICE_REQUEST'"), 'attachment API should accept PART and SERVICE_REQUEST resources');
assert(client.includes('料件圖片'), 'part image upload section should be visible');
assert(client.includes('支援 JPG、PNG、WebP、HEIC 與 PDF'), 'part image upload should name supported files');
assert(client.includes("formData.set('resource_type', 'PART')"), 'part create form should upload PART attachments');
assert(client.includes('料件已新增，但圖片上傳失敗'), 'part create form should report post-create image upload failure');
assert(client.includes('pendingAttachments'), 'part create form should stage selected files before create');
assert(partAttachmentFix.includes("CHECK (resource_type IN ('EQUIPMENT', 'FACILITY', 'PART', 'MAINTENANCE_REQUEST', 'MAINTENANCE_UPDATE'))"), 'forward migration should allow PART resource type');
assert(partAttachmentFix.includes("public.current_user_has_permission('general_affairs.part.view')"), 'forward migration should allow part viewers to read attachments');
assert(partAttachmentFix.includes("public.current_user_has_permission('general_affairs.part.manage')"), 'forward migration should require part manage for writes');
assert(!client.includes('料件圖片尚未開放上傳'), 'part image blocker should be removed');
assert(!client.includes('尚未支援 `resource_type=PART`'), 'part image blocker must not remain');
console.log('PASS part image upload uses shared attachment foundation');

console.log('RUN validation and UX safeguards exist');
[
  '請先修正以下欄位',
  'beforeunload',
  'focusFirstError',
  'scrollIntoView',
  'if (saving) return',
  'setDirty(false)',
  'setMessage(safeErrorMessage',
].forEach((text) => assert(client.includes(text), `missing UX safeguard ${text}`));
assert(partsValidation.includes('created_by') && partsValidation.includes('updated_by') && partsValidation.includes('deleted_by'), 'part validation should reject system fields');
console.log('PASS validation and UX safeguards exist');

console.log('RUN no migration or remote operation in UI files');
[client, page, navigation, features, partsList].forEach((text, index) => {
  assert(!/supabase\s+db\s+push|migration repair|db reset/i.test(text), `remote DB command leaked into UI file index ${index}`);
  assert(!/create table|alter table|drop table|create policy|alter policy/i.test(text), `DDL leaked into UI file index ${index}`);
  assert(!/service_role|SUPABASE_SERVICE_ROLE/i.test(text), `service role leaked into UI file index ${index}`);
});
console.log('PASS no migration or remote operation in UI files');

console.log('General Affairs part create UI static tests passed');
