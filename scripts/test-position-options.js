const fs = require('fs');
const path = require('path');

const root = process.cwd();
const files = {
  workflow: 'types/workflow.ts',
  actualStaffPoints: 'lib/monthly-staff/actual-staff-points.ts',
  monthlyStatus: 'app/monthly-status/page.tsx',
  storeEmployees: 'app/admin/stores/[id]/employees/page.tsx',
  monthlyExport: 'app/api/export-monthly-status/download/route.ts',
  bonusDetails: 'app/api/monthly-status/bonus-details/route.ts',
  performanceAverages: 'app/api/performance-bonus/averages/route.ts',
};

const headquartersPositions = [
  '出納專員',
  '助理',
  '高級專員',
  '副理',
  '副總經理',
  '專員',
  '組長',
  '督導',
  '經理',
  '資深副理',
  '資深專員',
  '資深經理',
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertIncludes(content, needle, message) {
  if (!content.includes(`'${needle}'`)) {
    throw new Error(message);
  }
}

const loaded = Object.fromEntries(
  Object.entries(files).map(([key, relativePath]) => [key, read(relativePath)])
);

headquartersPositions.forEach((position) => {
  assertIncludes(loaded.workflow, position, `POSITION_OPTIONS should include ${position}`);
  assertIncludes(loaded.actualStaffPoints, position, `actual staff points should recognize ${position}`);
  assertIncludes(loaded.monthlyStatus, position, `monthly status sorting should include ${position}`);
  assertIncludes(loaded.storeEmployees, position, `store employee sorting should include ${position}`);
  assertIncludes(loaded.monthlyExport, position, `monthly export should include ${position}`);
  assertIncludes(loaded.bonusDetails, position, `bonus details sorting should include ${position}`);
  assertIncludes(loaded.performanceAverages, position, `performance averages should include ${position}`);
});

console.log('position option checks passed');
