const fs = require('fs');
const path = require('path');

const root = process.cwd();
const files = {
  page: 'app/admin/employee-management/page.tsx',
  batchRoute: 'app/api/employee-movements/batch/route.ts',
  repairSql: 'supabase/repair_store_employee_status_from_latest_movement.sql',
};

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

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

const page = read(files.page);
const batchRoute = read(files.batchRoute);
const repairSql = read(files.repairSql);

assertIncludes(page, "latestMovement?.movement_type === 'resignation'", 'employee management should inspect latest resignation movement');
assertIncludes(page, "currentStatus = 'resigned'", 'employee management should mark latest resignation as resigned');
assertNotIncludes(page, 'latestMovementIsNewerOrSame && latestMovementIsResignation', 'resignation should not be overridden by later monthly snapshots');

assertIncludes(batchRoute, 'employmentStatusMovements', 'batch movement route should sync employment status to employee master');
assertIncludes(batchRoute, "is_active: nextStatus !== 'resigned'", 'resignation should deactivate store employee master');
assertIncludes(batchRoute, 'employment_status: nextStatus', 'movement status should update store employee employment_status');
assertIncludes(batchRoute, 'last_movement_type: movement.movement_type', 'movement sync should update last movement type');

assertIncludes(repairSql, 'latest_movements AS', 'repair SQL should derive latest movement per employee');
assertIncludes(repairSql, "latest_movements.movement_type = 'resignation'", 'repair SQL should detect latest resignation');
assertIncludes(repairSql, "WHERE UPPER(BTRIM(employee_code::text)) = 'FK1054'", 'repair SQL should include FK1054 spot check');

console.log('employee management status sync checks passed');
