const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(
  path.join(process.cwd(), 'app/inspection/improvements/page.tsx'),
  'utf8'
);
const route = fs.readFileSync(
  path.join(process.cwd(), 'app/api/inspection/improvements/route.ts'),
  'utf8'
);
const navbarPermissions = fs.readFileSync(
  path.join(process.cwd(), 'hooks/useNavbarPermissions.ts'),
  'utf8'
);

function assertIncludes(content, needle, message) {
  if (!content.includes(needle)) {
    throw new Error(message);
  }
}

function assertNotIncludes(content, needle, message) {
  if (content.includes(needle)) {
    throw new Error(message);
  }
}

assertIncludes(
  page,
  "fetch('/api/inspection/improvements'",
  'improvements page should load data through the server API'
);
assertIncludes(
  page,
  '避免前端 RLS 對 inspection_improvements 回傳假空白',
  'improvements page should document why it uses the server API'
);
assertIncludes(
  page,
  'setImprovementsMeta(payload.meta || null)',
  'improvements page should keep API visibility diagnostics'
);
assertIncludes(
  page,
  '目前帳號可見範圍是 0 筆',
  'improvements page should explain scoped-empty results'
);
assertIncludes(
  page,
  'setErrorMessage(payload.error ||',
  'improvements page should show API errors instead of silent zero counts'
);
assertNotIncludes(
  page,
  ".from('inspection_improvements')\n        .select(`",
  'improvements page should not query inspection_improvements directly'
);
assertNotIncludes(
  page,
  'stores!inner',
  'improvements page should not inner join stores in the client query'
);
assertNotIncludes(
  page,
  'inspection_masters!inner',
  'improvements page should not inner join inspection_masters in the client query'
);

assertIncludes(
  route,
  'createAdminClient',
  'improvements API should use the admin client after checking permissions'
);
assertIncludes(
  route,
  "'inspection.improvement.view_all'",
  'improvements API should allow view_all permission'
);
assertIncludes(
  route,
  'const [canViewAll, canViewOwnScope]',
  'improvements API should separate global visibility from scoped visibility'
);
assertIncludes(
  route,
  "'inspection.improvement.view_own_store'",
  'improvements API should allow own-store permission'
);
assertIncludes(
  route,
  "'inspection.improvement.manage'",
  'improvements API should allow manage permission within scoped visibility'
);
assertNotIncludes(
  route,
  "'inspection.view_all'",
  'inspection.view_all should not grant global visibility for improvement tracking'
);
assertIncludes(
  route,
  ".from('inspection_improvements')",
  'improvements API should query inspection_improvements'
);
assertIncludes(
  route,
  '避免 stores / inspection_masters inner join 被關聯表 RLS 連帶過濾成空資料',
  'improvements API should document why it avoids inner joins'
);
assertIncludes(
  route,
  'totalCount: rawImprovements?.length || 0',
  'improvements API should return total row count diagnostics'
);
assertIncludes(
  route,
  'visibleCount: improvements.length',
  'improvements API should return visible row count diagnostics'
);
assertIncludes(
  route,
  'managedStoreCount',
  'improvements API should return own-store scope diagnostics'
);
assertIncludes(
  route,
  'ownInspectionCount',
  'improvements API should return own-inspection scope diagnostics'
);
assertIncludes(
  navbarPermissions,
  "'inspection.improvement.manage'",
  'navbar should show improvement tracking for manage permission'
);
assertIncludes(
  navbarPermissions,
  "'inspection.improvement.submit'",
  'navbar should show improvement tracking for submit permission'
);

console.log('inspection improvements RLS-safe query checks passed');
