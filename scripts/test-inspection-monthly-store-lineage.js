const fs = require('fs');
const path = require('path');
const assert = require('assert');

const read = (relativePath) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

const overview = read('components/InspectionOverview.tsx');
const listPage = read('app/inspection/page.tsx');
const diagnosticSql = read('supabase/diagnose_inspection_monthly_store_status.sql');

assert(
  overview.includes("inspection.inspection_date.slice(0, 7) === monthKey"),
  'monthly status must use the same date key semantics as the calendar'
);
assert(
  overview.includes('const getLineageRoot = (storeId: string)'),
  'monthly status must resolve cloned-store lineage'
);
assert(
  overview.includes('inspectedStoreRoots.has(getLineageRoot(store.id))'),
  'assigned stores must be compared through their lineage root'
);
assert(
  listPage.includes(".select('id, store_name, store_code, short_name, source_store_id')"),
  'inspection and assigned-store queries must include source_store_id'
);
assert(
  listPage.includes(".select('id, store_name, short_name, source_store_id')"),
  'inspection list must load the visible store lineage'
);
assert(
  overview.includes('assignedStoreNameCounts.get(storeName) === 1') &&
    overview.includes('inspectedStoreNames.has(storeName)'),
  'legacy stores without source_store_id must use a unique exact-name fallback'
);
assert(
  diagnosticSql.includes('WITH RECURSIVE') && diagnosticSql.includes('matched_history_id'),
  'diagnostic SQL must expose inspections matched through historical store ids'
);

console.log('inspection monthly store lineage checks passed');
