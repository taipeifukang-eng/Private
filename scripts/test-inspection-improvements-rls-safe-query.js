const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(
  path.join(process.cwd(), 'app/inspection/improvements/page.tsx'),
  'utf8'
);

function assertIncludes(needle, message) {
  if (!page.includes(needle)) {
    throw new Error(message);
  }
}

function assertNotIncludes(needle, message) {
  if (page.includes(needle)) {
    throw new Error(message);
  }
}

assertIncludes(
  '避免 stores / inspection_masters inner join 被關聯表 RLS 連帶過濾成空資料',
  'improvements page should document why it avoids inner joins'
);
assertIncludes(
  "const { data: simpleData, error: simpleError } = await supabase\n        .from('inspection_improvements')",
  'improvements page should load inspection_improvements as the primary query'
);
assertIncludes(
  "supabase.from('stores').select('id, store_name, store_code').in('id', storeIds)",
  'improvements page should hydrate stores separately'
);
assertIncludes(
  ".from('inspection_masters')\n              .select('id, inspection_date, inspector_id')",
  'improvements page should hydrate inspection masters separately'
);
assertNotIncludes(
  'stores!inner',
  'improvements page should not inner join stores in the primary query'
);
assertNotIncludes(
  'inspection_masters!inner',
  'improvements page should not inner join inspection_masters in the primary query'
);

console.log('inspection improvements RLS-safe query checks passed');
