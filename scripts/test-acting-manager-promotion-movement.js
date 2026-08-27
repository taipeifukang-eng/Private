const fs = require('fs');
const path = require('path');

const root = process.cwd();
const pagePath = path.join(root, 'app/admin/promotion-management/page.tsx');
const syncPath = path.join(root, 'lib/monthly-staff/promotion-position-sync.ts');
const batchRoutePath = path.join(root, 'app/api/employee-movements/batch/route.ts');
const editRoutePath = path.join(root, 'app/api/employee-movements/[id]/route.ts');

function read(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${path.relative(root, filePath)}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function assertContains(filePath, expected, message) {
  const content = read(filePath);
  if (!content.includes(expected)) {
    throw new Error(`${message}\nMissing: ${expected}\nFile: ${path.relative(root, filePath)}`);
  }
}

assertContains(pagePath, ".concat('代理店長')", 'promotion UI should include acting manager as a promotion option');
assertContains(pagePath, '代理店長只會標註每月人員狀態', 'import template should explain acting manager behavior');
assertContains(pagePath, 'PROMOTION_POSITION_OPTIONS.map', 'edit modal should use the same promotion option list');

assertContains(syncPath, 'function isActingManagerPromotion', 'sync helper should detect acting manager promotions');
assertContains(syncPath, 'is_acting_manager: true', 'acting manager promotion should set monthly flag');
assertContains(syncPath, 'is_acting_manager: false', 'regular promotions should clear monthly acting flag');
assertContains(syncPath, 'position: promotion.position', 'regular promotions should continue updating monthly position');

assertContains(batchRoutePath, 'syncPromotionPositionToMonthlyStaffStatus', 'batch movement API should sync promotion effects');
assertContains(editRoutePath, 'syncEmployeePromotionTimelineToMonthlyStaffStatus', 'edit movement API should rebuild promotion effects');

console.log('acting manager promotion movement checks passed');
