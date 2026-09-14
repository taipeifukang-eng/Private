const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(
  path.join(process.cwd(), 'app/admin/export-monthly-status/page.tsx'),
  'utf8'
);
const route = fs.readFileSync(
  path.join(process.cwd(), 'app/api/export-monthly-status/roster/route.ts'),
  'utf8'
);

function assertIncludes(content, needle, message) {
  if (!content.includes(needle)) {
    throw new Error(message);
  }
}

assertIncludes(
  route,
  ".from('monthly_staff_status')",
  'roster export should use monthly_staff_status snapshots'
);
assertIncludes(
  route,
  'employee_code',
  'roster export should include employee code'
);
assertIncludes(
  route,
  'employee_name',
  'roster export should include employee name'
);
assertIncludes(
  route,
  'position',
  'roster export should include position'
);
assertIncludes(
  route,
  "requirePermission(user.id, 'monthly.export.download')",
  'roster export should require monthly export permission'
);
assertIncludes(
  page,
  '預覽每月門市人員名冊',
  'export page should expose roster preview'
);
assertIncludes(
  page,
  'rosterLoaded',
  'roster preview should show a loaded empty state instead of appearing unchanged'
);
assertIncludes(
  page,
  '正在載入每月門市人員名冊',
  'roster preview should show loading feedback'
);
assertIncludes(
  page,
  '查無 ${yearMonth}',
  'roster preview should show a no-data message'
);
assertIncludes(
  page,
  '匯出每月門市人員名冊',
  'export page should expose roster download'
);
assertIncludes(
  page,
  '/api/export-monthly-status/roster',
  'export page should call roster API'
);

console.log('monthly staff roster export checks passed');
