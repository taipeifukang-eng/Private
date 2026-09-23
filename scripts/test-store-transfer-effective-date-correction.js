const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assertIncludes = (content, needle, label) => {
  if (!content.includes(needle)) throw new Error(`${label}: missing ${needle}`);
  console.log(`PASS ${label}`);
};

const page = read('app/admin/promotion-management/page.tsx');
const api = read('app/api/store-transfer-requests/[id]/effective-date/route.ts');
const listApi = read('app/api/store-transfer-requests/route.ts');
const migration = read('supabase/migrations/20260923090000_store_transfer_correction_audit.sql');

assertIncludes(page, '更正生效日', 'confirmed transfer exposes correction action');
assertIncludes(page, '更正原因 *', 'correction reason is required in UI');
assertIncludes(page, 'canConfirmTransfer || isAdmin', 'action follows confirmation permission');
assertIncludes(page, "method: 'PATCH'", 'correction uses dedicated PATCH endpoint');
assertIncludes(api, 'year < 2000 || year > 2100', 'invalid historical year is rejected');
assertIncludes(api, "transfer.status !== 'confirmed'", 'only confirmed transfers can be corrected');
assertIncludes(api, ".eq('status', 'confirmed')", 'confirmed monthly status blocks correction');
assertIncludes(api, "movement_type', 'store_transfer'", 'duplicate transfer movement is rejected');
assertIncludes(api, 'movement_date: effectiveDate', 'movement history date is synchronized');
assertIncludes(api, 'monthly_status: \'transferred_out\'', 'source monthly status is recalculated');
assertIncludes(api, 'monthly_status: \'transferred_in\'', 'destination monthly status is recalculated');
assertIncludes(listApi, 'corrector:', 'correction operator is returned to UI');
assertIncludes(migration, 'correction_reason text', 'correction audit reason is persisted');

console.log('Store transfer effective date correction static tests passed');
