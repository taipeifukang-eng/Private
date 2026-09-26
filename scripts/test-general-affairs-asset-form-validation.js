const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

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

const equipmentCreate = read('components/general-affairs/equipment/EquipmentCreatePageClient.tsx');
const facilityCreate = read('components/general-affairs/facilities/FacilityCreatePageClient.tsx');

for (const [name, content] of [
  ['equipment', equipmentCreate],
  ['facility', facilityCreate],
]) {
  assertIncludes(content, 'scrollIntoView', `${name} validation scroll`);
  assertIncludes(content, 'focus()', `${name} validation focus`);
  assertIncludes(content, 'setDirty(false)', `${name} success clears dirty state`);
  assertIncludes(content, '/api/general-affairs/', `${name} submits through existing API`);
  assertNotIncludes(content, 'Math.random', `${name} form no fake data`);
  assertNotIncludes(content, '@example.test', `${name} form no account-specific logic`);
  assertNotIncludes(content, 'profile.role', `${name} form no legacy role logic`);
}
pass('asset form common validation patterns');

assertIncludes(equipmentCreate, 'fieldRefs.current', 'equipment field refs');
assertIncludes(equipmentCreate, '設備已新增，但附件上傳失敗', 'equipment attachment failure explicit');
assertIncludes(equipmentCreate, 'disabled={saving}', 'equipment submit button disables while saving');
pass('equipment form validation');

assertIncludes(facilityCreate, 'renderValidationSummary', 'facility validation summary');
assertIncludes(facilityCreate, 'focusFirstError', 'facility cross-step focus');
assertIncludes(facilityCreate, 'if (saving) return;', 'facility double-click prevention');
assertIncludes(facilityCreate, '保固開始日期不可晚於保固到期日期', 'facility warranty date order validation');
assertIncludes(facilityCreate, "key === 'has_warranty' && value === false", 'facility hidden warranty fields cleared');
assertIncludes(facilityCreate, '設施已新增，但附件上傳失敗', 'facility attachment failure explicit');
pass('facility form validation');

assertNotIncludes(facilityCreate, 'asset_code', 'facility form no equipment asset code');
assertNotIncludes(facilityCreate, 'serial_number', 'facility form no equipment serial number');
assertIncludes(facilityCreate, 'purchase_unit_amount', 'facility form has formal unit purchase amount');
assertIncludes(facilityCreate, 'purchase_amount: form.purchase_unit_amount ? purchaseTotal : null', 'facility form submits calculated purchase total');
pass('facility form avoids equipment identity fields and supports facility purchase data');

console.log('General Affairs asset form validation static tests passed');
