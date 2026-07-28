const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertIncludes(content, expected, label) {
  if (!content.includes(expected)) {
    throw new Error(`${label}: missing ${expected}`);
  }
}

function assertNotIncludes(content, unexpected, label) {
  if (content.includes(unexpected)) {
    throw new Error(`${label}: should not include ${unexpected}`);
  }
}

function run() {
  const actions = read('app/store/actions.ts');

  assertIncludes(
    actions,
    'resolvePreMonthResignedEmployeeCodes',
    'monthly initialization resolves pre-month resignation state'
  );
  assertIncludes(
    actions,
    ".lt('movement_date', monthStart)",
    'pre-month resignation check only reads movements before target month'
  );
  assertIncludes(
    actions,
    ".in('movement_type', ['resignation', ...MONTHLY_STATUS_REACTIVATION_MOVEMENT_TYPES])",
    'pre-month resignation check considers resignation and reactivation movements'
  );
  assertIncludes(
    actions,
    "movement.movement_type === 'resignation'",
    'latest pre-month resignation marks employee inactive for carry forward'
  );
  assertIncludes(
    actions,
    "prev.monthly_status !== 'resigned' && !preMonthResignedCodes.has(code)",
    'previous month resigned rows are not copied into next month'
  );
  assertIncludes(
    actions,
    'const activeEmployees = employees.filter',
    'store employee initialization filters stale active employees'
  );
  assertIncludes(
    actions,
    'syncPreMonthResignationsForMonthlyStatus',
    'existing draft months can be cleaned when initialization is re-run'
  );
  assertIncludes(
    actions,
    ".eq('status', 'draft')",
    'existing month cleanup only touches draft rows'
  );
  assertIncludes(
    actions,
    "!row.is_manually_added",
    'existing month cleanup preserves manually added rows'
  );
  assertIncludes(
    actions,
    ".eq('movement_type', 'resignation')",
    'current-month resignation handling remains in place'
  );
  assertIncludes(
    actions,
    ".gte('movement_date', `${yearMonth}-01`)",
    'current-month resignation still starts at target month'
  );
  assertIncludes(
    actions,
    "partial_month_notes = `${mmdd}離職`",
    'current-month resignation remains visible as resigned in the target month'
  );
  assertNotIncludes(
    actions,
    "prevMonthData.map(prev => {",
    'previous month data should be filtered before mapping'
  );

  console.log('PASS monthly status excludes employees resigned before target month');
  console.log('PASS monthly status keeps current-month resignation handling');
  console.log('PASS initialized draft month cleanup is conservative');
}

run();
