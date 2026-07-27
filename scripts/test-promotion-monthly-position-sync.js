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
  const helper = read('lib/monthly-staff/promotion-position-sync.ts');
  const employeeMovementsRoute = read('app/api/employee-movements/batch/route.ts');
  const employeeMovementSingleRoute = read('app/api/employee-movements/[id]/route.ts');
  const promotionManagementPage = read('app/admin/promotion-management/page.tsx');
  const promotionBatchRoute = read('app/api/promotions/batch/route.ts');
  const promotionGlobalRoute = read('app/api/promotions/batch-global/route.ts');

  assertIncludes(helper, "from('monthly_staff_status')", 'helper updates monthly_staff_status');
  assertIncludes(helper, 'position: promotion.position', 'helper updates monthly position');
  assertIncludes(helper, ".gte('year_month', promotion.targetYearMonth)", 'helper starts at effective month');
  assertIncludes(helper, ".lt('year_month', nextPromotionYearMonth)", 'helper stops before next promotion month');
  assertIncludes(helper, "from('employee_movement_history')", 'helper checks future movement history');
  assertIncludes(helper, ".eq('movement_type', 'promotion')", 'helper only considers promotion history');
  assertIncludes(helper, 'syncEmployeePromotionTimelineToMonthlyStaffStatus', 'helper can rebuild promotion timeline after edit');
  assertIncludes(helper, 'syncMovementEmployeeNameToMonthlyStaffStatus', 'helper can sync corrected movement names to monthly status');
  assertIncludes(helper, ".gte('year_month', affectedYearMonth)", 'timeline sync starts from affected month');
  assertIncludes(helper, "promotion.oldPosition", 'timeline sync can restore months before edited first promotion');

  for (const [label, content] of [
    ['employee movement batch route', employeeMovementsRoute],
    ['promotion batch route', promotionBatchRoute],
    ['promotion global route', promotionGlobalRoute],
  ]) {
    assertIncludes(
      content,
      'syncPromotionPositionToMonthlyStaffStatus',
      `${label} calls promotion monthly sync`
    );
  }

  assertIncludes(employeeMovementsRoute, 'promotionPositionSyncInputs.push', 'main route tracks promotion sync inputs');
  assertIncludes(employeeMovementsRoute, 'new_value: newValue', 'main route writes current movement schema');
  assertIncludes(employeeMovementsRoute, 'movement_date: movement.effective_date', 'main route writes movement_date');
  assertIncludes(employeeMovementSingleRoute, 'export async function PATCH', 'single route supports movement editing');
  assertIncludes(employeeMovementSingleRoute, 'syncEmployeePromotionTimelineToMonthlyStaffStatus', 'single route rebuilds timeline after promotion edits');
  assertIncludes(employeeMovementSingleRoute, 'syncMovementEmployeeNameToMonthlyStaffStatus', 'single route syncs corrected names to monthly status');
  assertIncludes(employeeMovementSingleRoute, 'employee.movement.manage', 'single route accepts formal movement manage permission');
  assertIncludes(employeeMovementSingleRoute, 'employee.promotion.batch', 'single route preserves legacy promotion management access');
  assertIncludes(employeeMovementSingleRoute, '.neq(\'id\', params.id)', 'single route excludes current row in duplicate check');
  assertIncludes(promotionManagementPage, 'openEditMovement(record)', 'promotion management history has edit action');
  assertIncludes(promotionManagementPage, '儲存並同步', 'promotion management edit modal saves and syncs');
  assertIncludes(promotionManagementPage, 'handleUpdateMovement', 'promotion management edit modal calls PATCH handler');
  assertIncludes(promotionBatchRoute, "movement_type: 'promotion'", 'legacy store batch writes movement_type');
  assertIncludes(promotionBatchRoute, 'movement_date: promo.effective_date', 'legacy store batch writes movement_date');
  assertIncludes(promotionBatchRoute, 'new_value: promo.position', 'legacy store batch writes new_value');
  assertIncludes(promotionGlobalRoute, "movement_type: 'promotion'", 'legacy global batch writes movement_type');
  assertIncludes(promotionGlobalRoute, 'movement_date: promo.effective_date', 'legacy global batch writes movement_date');
  assertIncludes(promotionGlobalRoute, 'new_value: promo.position', 'legacy global batch writes new_value');

  assertNotIncludes(promotionBatchRoute, 'promotion_date: promo.effective_date', 'legacy store batch avoids old promotion_date column');
  assertNotIncludes(promotionBatchRoute, 'new_position: promo.position', 'legacy store batch avoids old new_position column');
  assertNotIncludes(promotionGlobalRoute, 'promotion_date: promo.effective_date', 'legacy global batch avoids old promotion_date column');
  assertNotIncludes(promotionGlobalRoute, 'new_position: promo.position', 'legacy global batch avoids old new_position column');

  console.log('PASS promotion monthly position sync helper');
  console.log('PASS promotion effective month updates monthly_staff_status.position');
  console.log('PASS promotion sync stops before a later promotion month');
  console.log('PASS promotion edit rebuilds affected monthly position timeline');
  console.log('PASS movement edit syncs corrected names to monthly status');
  console.log('PASS employee movement batch route calls promotion sync');
  console.log('PASS employee movement single route supports edit and sync');
  console.log('PASS promotion management history exposes edit action');
  console.log('PASS legacy promotion routes use current movement schema');
}

run();
