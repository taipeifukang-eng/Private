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

const newPage = read('app/inspection/new/page.tsx');
const editPage = read('app/inspection/[id]/edit/page.tsx');
const detailPage = read('app/inspection/[id]/page.tsx');
const inspectionMigration = read('supabase/migration_production_legacy_inventory_inspection_monthly_compatibility.sql');

assertIncludes(
  inspectionMigration,
  'gps_timestamp timestamptz',
  'production inspection compatibility migration should include gps_timestamp'
);

for (const [label, content] of [
  ['new inspection page', newPage],
  ['edit inspection page', editPage],
]) {
  assertIncludes(
    content,
    'function formatDateInputValue(date: Date)',
    `${label} should format GPS dates with local date semantics`
  );
  assertIncludes(
    content,
    'capturedAt: new Date(position.timestamp || Date.now()).toISOString()',
    `${label} should capture the geolocation timestamp`
  );
  assertIncludes(
    content,
    'setInspectionDate(formatDateInputValue(new Date(position.timestamp || Date.now())))',
    `${label} should sync the inspection date when GPS is captured`
  );
  assertIncludes(
    content,
    'const gpsInspectionDate = gpsLocation?.capturedAt',
    `${label} should derive the saved inspection date from the GPS timestamp`
  );
  assertIncludes(
    content,
    'inspection_date: gpsInspectionDate',
    `${label} should persist the GPS-derived inspection date`
  );
  assertIncludes(
    content,
    'gps_timestamp: gpsLocation?.capturedAt || null',
    `${label} should persist gps_timestamp`
  );
  assertIncludes(
    content,
    'gps_accuracy: gpsLocation?.accuracy || null',
    `${label} should persist gps_accuracy with the location`
  );
}

assertIncludes(
  detailPage,
  'gps_timestamp',
  'inspection detail page should select gps_timestamp'
);
assertIncludes(
  detailPage,
  "inspection.gps_timestamp ? 'GPS定位於' : '建立於'",
  'inspection detail page should prefer GPS timestamp in the header'
);
assertIncludes(
  detailPage,
  'const primaryInspectionDate = inspection.gps_timestamp || inspection.inspection_date',
  'inspection detail page should prefer GPS timestamp for the inspection date card'
);
assertIncludes(
  detailPage,
  '定位時間：',
  'inspection detail page should show the GPS timestamp near the coordinates'
);

console.log('inspection GPS timestamp checks passed');
