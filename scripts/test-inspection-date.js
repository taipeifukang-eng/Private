const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

const compiled = ts.transpileModule(fs.readFileSync('lib/inspection/date.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const context = { exports: {} };
vm.runInNewContext(compiled, context);
const { getInspectionGpsCapturedAt, hasSuspiciousInspectionGpsTime } = context.exports;

const now = Date.parse('2026-10-21T09:55:00Z');
const wrongYear = Date.parse('1995-10-21T09:55:00Z');
for (const value of [wrongYear, 0, NaN, Infinity, -1, now / 1000, now + 86400000]) {
  assert.equal(getInspectionGpsCapturedAt(value, now), new Date(now).toISOString());
}
assert.equal(getInspectionGpsCapturedAt(now - 60000, now), '2026-10-21T09:54:00.000Z');
// A delayed callback across midnight must retain a valid location timestamp.
assert.equal(getInspectionGpsCapturedAt(Date.parse('2026-10-21T15:59:59Z'), Date.parse('2026-10-21T16:00:01Z')), '2026-10-21T15:59:59.000Z');
assert.equal(hasSuspiciousInspectionGpsTime('1995-10-21T09:55:00Z', '2026-10-21T09:55:00Z'), true);
assert.equal(hasSuspiciousInspectionGpsTime('invalid', '2026-10-21T09:55:00Z'), true);
assert.equal(hasSuspiciousInspectionGpsTime(undefined, '2026-10-21T09:55:00Z'), false);
// Restoring an old, internally consistent draft must not move it to today.
assert.equal(hasSuspiciousInspectionGpsTime('2024-12-31T09:55:00Z', '2025-01-01T09:55:00Z'), false);
console.log('inspection date behavior checks passed');
