const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/pharmacist-transfer-reconciliation.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const reconcile = context.exports.reconcilePharmacistTransfers;
const stores = [{id:'old',store_name:'新店'}, {id:'new',store_name:'安程'}];
const row = {id:'snapshot',employee_code:'FK0799',store_id:'old',position:'主任',is_active:true};
const transfer = {employee_code:'FK0799',movement_type:'store_transfer',store_id:'new',movement_date:'2026-08-01'};
assert.equal(reconcile([row],[transfer],'2026-10',stores)[0].store_id,'new');
assert.equal(reconcile([row],[transfer],'2026-08',stores)[0].store_id,'new');
assert.equal(reconcile([row],[transfer],'2026-07',stores)[0].store_id,'old');
const partial = {...transfer,movement_date:'2026-08-15'};
assert.equal(reconcile([row],[partial],'2026-08',stores)[0].store_id,'old');
assert.equal(reconcile([row],[partial],'2026-09',stores)[0].store_id,'new');
assert.equal(reconcile([row],[transfer],'2026-10',[stores[0]]).length,0);
assert.equal(reconcile([row],[transfer],'2026-10',[stores[1]])[0].store_id,'new');
assert.equal(reconcile([row,{...row,id:'destination',store_id:'new'}],[transfer],'2026-10',stores).length,1);
assert.equal(reconcile([row],[transfer,{...transfer,movement_type:'onboarding',store_id:'old',movement_date:'2026-09-01'}],'2026-10',stores)[0].store_id,'old');
assert.equal(row.store_id,'old');
for (const file of ['app/admin/pharmacist-management/page.tsx']) {
 assert.match(fs.readFileSync(file,'utf8'), /if \(!isSelectedMonthLocked\) \{\s+currentRowsRaw = await readReconciledPharmacistMonth/);
}
console.log('Passed: historical/day-one/partial-month transfers, incoming/outgoing scope, duplicate snapshots, rehire, immutable input, locked-month guards.');
