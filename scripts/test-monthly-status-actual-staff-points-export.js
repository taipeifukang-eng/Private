const fs = require('fs');
const path = require('path');

const root = process.cwd();
const routePath = path.join(root, 'app/api/export-monthly-status/actual-staff-points/route.ts');
const helperPath = path.join(root, 'lib/monthly-staff/actual-staff-points.ts');
const pagePath = path.join(root, 'app/admin/export-monthly-status/page.tsx');

function assertContains(filePath, expected, message) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes(expected)) {
    throw new Error(`${message}\nMissing: ${expected}\nFile: ${path.relative(root, filePath)}`);
  }
}

function assertFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${path.relative(root, filePath)}`);
  }
}

assertFileExists(routePath);
assertFileExists(helperPath);

assertContains(pagePath, '/api/export-monthly-status/actual-staff-points', 'export page should call actual staff points API');
assertContains(pagePath, '匯出實際人力點值', 'export page should render the actual staff points button');

assertContains(routePath, "requirePermission(user.id, 'monthly.export.download')", 'API should enforce monthly export permission');
assertContains(routePath, '門市人力點值加總', 'workbook should include store summary sheet');
assertContains(routePath, '人員明細', 'workbook should include staff detail sheet');
assertContains(routePath, '規則待確認', 'workbook should include review sheet for omitted/inferred rules');
assertContains(routePath, '計算規則', 'workbook should include rule sheet');

[
  '專員以上職等 = 1',
  '行政(過階) = 0.5',
  '新人(二階) = 0.7',
  '兼職助理(未過階) = 時數 / 160 / 2',
  '兼職藥師(三階/未過階) = 時數 / 160',
  '未整月在職：專員以上職等 = 天數 / 當月營業天數',
  '兼職藥師專員歸屬兼職藥師(三階)',
].forEach((rule) => {
  assertContains(helperPath, rule, `helper should document or implement rule: ${rule}`);
});

assertContains(routePath, '未整月新人一階/二階、行政過階', 'rule worksheet should mention inferred partial-month rules');

console.log('actual staff points export wiring and rule checks passed');
