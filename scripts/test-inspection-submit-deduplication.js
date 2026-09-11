const fs = require('fs');
const path = require('path');

const newPage = fs.readFileSync(
  path.join(process.cwd(), 'app/inspection/new/page.tsx'),
  'utf8'
);

function assertIncludes(needle, message) {
  if (!newPage.includes(needle)) {
    throw new Error(message);
  }
}

assertIncludes(
  'const submitInFlightRef = useRef(false)',
  'new inspection page should keep a synchronous submit lock'
);
assertIncludes(
  'if (submitInFlightRef.current)',
  'new inspection submit handler should ignore duplicate submit attempts'
);
assertIncludes(
  'submitInFlightRef.current = true',
  'new inspection submit handler should lock before async insert'
);
assertIncludes(
  'submitInFlightRef.current = false',
  'new inspection submit handler should release the lock after completion'
);
assertIncludes(
  "{submitting ? '送出中...'",
  'new inspection submit button should show in-flight state'
);
assertIncludes(
  ".eq('client_request_id', clientRequestId)",
  'new inspection submit handler should check the stable client request id before inserting'
);
assertIncludes(
  ".from('inspection_masters')\n        .select('id, status, created_at')",
  'new inspection page should query existing inspections before inserting'
);
assertIncludes(
  ".eq('store_id', selectedStoreId)",
  'duplicate check should match the selected store'
);
assertIncludes(
  ".eq('inspector_id', user.id)",
  'duplicate check should match the inspector'
);
assertIncludes(
  ".eq('inspection_date', gpsInspectionDate)",
  'duplicate check should match the GPS-derived inspection date'
);
assertIncludes(
  "duplicateQuery.or('inspection_type.eq.supervisor,inspection_type.is.null')",
  'duplicate check should treat legacy null inspection_type as supervisor inspections'
);
assertIncludes(
  '避免重複建立',
  'new inspection page should explain duplicate prevention to the user'
);

console.log('inspection submit deduplication checks passed');
