const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/employee-movement-date.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText, context);
const { getMovementDateError: validate } = context.exports;
for (const date of ['2026-10-01', '2024-02-29', '2008-03-01', '1912-01-01', '2027-01-01']) assert.equal(validate(date), null, date);
for (const date of ['0115-10-01', '115-10-01', '0000-01-01', '2026-02-29', '2026-04-31', '2026-13-01', '2026-01-00', '', null, 20261001]) assert.ok(validate(date), String(date));
assert.match(validate('0115-10-01'), /2026/);
// Every existing movement write entry validates before accepting an effective date.
for (const file of ['employee-movements/[id]', 'employee-movements/batch', 'promotions/batch', 'promotions/batch-global', 'store-transfer-requests/[id]/confirm', 'store-transfer-requests/[id]/effective-date']) {
  assert.match(fs.readFileSync(`app/api/${file}/route.ts`, 'utf8'), /getMovementDateError\(/, file);
}
console.log('Movement date validation: valid historical/future dates, ROC years, invalid calendar days and six API entry points passed.');
