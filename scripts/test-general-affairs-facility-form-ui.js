const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertIncludes(content, needle, label) {
  assert(content.includes(needle), `${label}: missing "${needle}"`);
}

function assertNotIncludes(content, needle, label) {
  assert(!content.includes(needle), `${label}: must not include "${needle}"`);
}

function pass(label) {
  console.log(`PASS ${label}`);
}

const client = read('components/general-affairs/facilities/FacilityCreatePageClient.tsx');
const route = read('app/api/general-affairs/facilities/route.ts');
const validation = read('lib/general-affairs/facilities/validation.ts');
const purchaseMigration = read('supabase/migrations/20260920133000_general_affairs_facility_purchase_fields.sql');
const sitePicker = read('components/general-affairs/assets/AssetSitePicker.tsx');

assertIncludes(client, "const STEPS", 'facility form steps');
for (const label of ['基本資訊', '位置資訊', '維護與保固資訊', '確認建立']) {
  assertIncludes(client, label, 'facility form uses formal 4 steps');
}
pass('facility create uses 4 steps');

for (const needle of ['設施名稱 *', '設施分類 *', '狀態 *', '重要程度', '設施描述', '標籤', '品牌', '型號']) {
  assertIncludes(client, needle, 'step 1 basic fields');
}
assertIncludes(client, '公司設施架型', 'facility form selects from company facility catalog');
assertIncludes(client, 'facility_template_id', 'facility form submits its shared template reference');
assertIncludes(client, '這個據點要新增哪一種設施？', 'facility form guides beginners to reuse company facilities first');
assertIncludes(client, '適用料件：', 'facility form previews inherited compatible parts');
assertIncludes(client, '找不到？先新增公司設施架型', 'facility form links to company facility creation');
assertIncludes(client, 'FACILITY_DRAFT_KEY', 'facility form preserves draft while creating company facility');
assertIncludes(client, 'returnTo=/general-affairs/facilities/new', 'facility catalog returns to store creation');
assertIncludes(client, '請先選擇公司設施架型；若公司尚未建立此架型，請先新增公司設施架型', 'facility form blocks unregistered facility types');
assertNotIncludes(client, '這是特殊設施，沒有共用架型', 'facility form must not bypass company catalog');
assertIncludes(client, '繼承適用料件', 'facility confirmation repeats inherited parts');
assertIncludes(client, 'FacilityCategoryPicker', 'step 1 hierarchical facility category picker');
assertIncludes(client, '目前分類路徑', 'step 1 category breadcrumb');
assertIncludes(client, '先選第 1 層', 'step 1 category cascades by level');
assertNotIncludes(client, '<select ref={(node) => { refs.current.category_id = node; }}', 'facility form must not use old flat category select');
pass('step 1 basic fields');

for (const needle of ['AssetSitePicker', '據點區域 *', '詳細位置 *', '所在樓層／區域描述', 'STORE_AREA_OPTIONS']) {
  assertIncludes(client, needle, 'step 2 location fields');
}
assertIncludes(client, '據點選項只取目前 API / RLS 允許的資料', 'site scope guidance');
for (const needle of ['所在據點 *', '搜尋據點代碼、名稱或簡稱', 'store_code', 'short_name']) {
  assertIncludes(sitePicker, needle, 'shared searchable site picker');
}
assertNotIncludes(client, 'store_area_id', 'facility form must not send fake store_area_id');
assertNotIncludes(client, 'is_store_wide', 'facility form must not send fake store-wide field');
pass('step 2 location fields');

for (const needle of ['建置／啟用日期', '最近整修日期', '設施圖片', '維護資訊']) {
  assertIncludes(client, needle, 'step 3 maintenance fields');
}
assertIncludes(client, '/api/general-affairs/attachments', 'facility form uses real attachment API');
assertIncludes(client, "formData.set('resource_type', 'FACILITY')", 'facility attachment resource type');
assertIncludes(client, '設施已新增，但附件上傳失敗', 'facility attachment failure must be explicit');
assertNotIncludes(client, '圖片上傳成功', 'facility form must not show fake upload success');
pass('step 3 maintenance fields and attachment support');

for (const needle of ['無保固', '有保固', '保固開始日期 *', '保固到期日期 *', '保固年限／剩餘時間', '申請保固方式', '保固說明', '保固文件']) {
  assertIncludes(client, needle, 'step 3 warranty fields');
}
assertIncludes(client, "key === 'has_warranty' && value === false", 'has_warranty false clears hidden warranty fields');
assertIncludes(client, '保固開始日期不可晚於保固到期日期', 'warranty date order validation');
assertIncludes(client, 'facility_warranty_start_date', 'warranty start stored in specs');
assertIncludes(client, 'facility_warranty_end_date', 'warranty end stored in specs');
pass('step 3 warranty validation');

for (const needle of ['SummaryRow', '確認建立後才會送出 API', '設施名稱', '設施分類', '保固期間', '附件']) {
  assertIncludes(client, needle, 'step 4 confirm summary');
}
assertIncludes(client, 'router.push(facilityId ? `/general-affairs/facilities?createdFacilityId=${facilityId}`', 'success should navigate to facility list with created id');
pass('step 4 confirmation and success behavior');

assertIncludes(client, 'renderValidationSummary', 'validation summary');
assertIncludes(client, 'focusFirstError', 'cross-step focus helper');
assertIncludes(client, 'setCurrentStep(nextStep)', 'cross-step errors switch step');
assertIncludes(client, "scrollIntoView({ block: 'center', behavior: 'smooth' })", 'field error scroll');
assertIncludes(client, 'if (saving) return;', 'double click prevention');
assertIncludes(client, 'setDirty(false)', 'success clears unsaved warning');
pass('validation UX and double-click prevention');

for (const forbidden of [
  'asset_code',
  'serial_number',
  'barcode',
  'warranty_vendor_id',
  'warranty_document_id',
  'reminder',
]) {
  assertNotIncludes(client, forbidden, 'facility form must not send equipment or unsupported warranty fields');
}
assertNotIncludes(client, 'Math.random', 'facility form must not use fake data');
assertNotIncludes(client, '@example.test', 'facility form must not depend on account email');
assertNotIncludes(client, 'profile.role', 'facility form must not depend on legacy role');
assertNotIncludes(client, 'db push', 'facility form must not run DB operations');
pass('facility form avoids unsupported fields and identity shortcuts');

assertIncludes(route, 'validateFacilityPayload', 'facility API keeps validation');
assertIncludes(validation, 'assertPlainObject(payload.specs', 'facility API accepts specs object');
assertIncludes(validation, 'installed_at', 'facility API supports installed_at');
assertIncludes(validation, 'last_renovated_at', 'facility API supports last_renovated_at');
assertIncludes(validation, 'purchased_at', 'facility API supports purchased_at');
assertIncludes(validation, 'purchase_unit_amount', 'facility API supports unit purchase amount');
assertIncludes(validation, 'purchase_amount', 'facility API supports purchase total');
assertIncludes(validation, "['area', 'location_detail', 'unit', 'description', 'notes']", 'facility API supports area and location_detail');
assertIncludes(client, '既有設施補登', 'facility form supports existing asset intake');
assertIncludes(client, '新購／新開店設施', 'facility form supports new purchase intake');
assertIncludes(client, '購買總額', 'facility form calculates purchase total');
assertIncludes(route, 'purchase_unit_amount', 'facility list API returns unit purchase amount');
assertIncludes(route, 'purchase_amount', 'facility list API returns purchase total');
assertIncludes(purchaseMigration, 'ADD COLUMN IF NOT EXISTS purchased_at date', 'facility purchase date migration exists');
assertIncludes(purchaseMigration, 'purchase_unit_amount numeric(12,2)', 'facility unit amount migration exists');
assertIncludes(purchaseMigration, 'purchase_amount numeric(14,2)', 'facility total amount migration exists');
pass('facility API contract supports submitted fields');

console.log('General Affairs facility form UI static tests passed');
