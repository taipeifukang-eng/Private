const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertIncludes(content, needle, message) {
  if (!content.includes(needle)) {
    throw new Error(message);
  }
}

const migration = read('supabase/migrations/20260911093000_inspection_request_identity.sql');
const newPage = read('app/inspection/new/page.tsx');
const listPage = read('app/inspection/page.tsx');
const detailPage = read('app/inspection/[id]/page.tsx');

assertIncludes(
  migration,
  'ADD COLUMN IF NOT EXISTS inspection_no TEXT',
  'migration should add inspection_no'
);
assertIncludes(
  migration,
  'ADD COLUMN IF NOT EXISTS client_request_id UUID',
  'migration should add client_request_id'
);
assertIncludes(
  migration,
  'CREATE UNIQUE INDEX IF NOT EXISTS ux_inspection_masters_client_request_id',
  'migration should enforce unique client_request_id'
);

for (const field of ['clientRequestId: string', 'inspectionNo: string']) {
  assertIncludes(newPage, field, `inspection draft should include ${field}`);
}

assertIncludes(
  newPage,
  'const [clientRequestId, setClientRequestId] = useState(() => createInspectionClientRequestId())',
  'new inspection page should create a stable client request id'
);
assertIncludes(
  newPage,
  'const [inspectionNo, setInspectionNo] = useState(() => createInspectionNo(inspectionType))',
  'new inspection page should create a visible inspection number'
);
assertIncludes(
  newPage,
  ".eq('client_request_id', clientRequestId)",
  'new inspection page should check existing records by client_request_id'
);
assertIncludes(
  newPage,
  'inspection_no: inspectionNo',
  'new inspection insert should persist inspection_no'
);
assertIncludes(
  newPage,
  'client_request_id: clientRequestId',
  'new inspection insert should persist client_request_id'
);

assertIncludes(
  listPage,
  'inspection_no, store_id',
  'inspection list should select inspection_no'
);
assertIncludes(
  listPage,
  '巡店單號',
  'inspection list should show the inspection number'
);
assertIncludes(
  detailPage,
  'inspection_no',
  'inspection detail should select inspection_no'
);
assertIncludes(
  detailPage,
  '巡店單號',
  'inspection detail should show the inspection number'
);

console.log('inspection request identity checks passed');
