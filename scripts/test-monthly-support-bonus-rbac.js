const fs = require('fs');
const path = require('path');
const assert = require('assert');

const read = (relativePath) => fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

const monthlyPage = read('app/monthly-status/page.tsx');
const storeActions = read('app/store/actions.ts');
const saveRoute = read('app/api/support-bonus/save/route.ts');

assert(
  storeActions.includes("hasPermission(user.id, 'monthly.allowance.edit_support_bonus')"),
  'monthly status permission loader must resolve the support bonus RBAC permission'
);
assert(
  monthlyPage.includes('{canEditSupportBonus && ('),
  'support bonus button must be controlled by the support bonus permission'
);
assert(
  saveRoute.includes("hasPermission(user.id, 'monthly.allowance.edit_support_bonus')"),
  'support bonus API must enforce the support bonus permission'
);
assert(
  saveRoute.includes(".from('store_managers')") && saveRoute.includes(".eq('store_id', store_id)"),
  'support bonus API must enforce managed-store scope'
);
assert(
  saveRoute.includes("storeSummary?.store_status === 'confirmed'"),
  'support bonus API must reject changes after monthly confirmation'
);
assert(
  !saveRoute.includes("['店長', '代理店長', '督導', '督導(代理店長)']"),
  'support bonus API must not authorize by hard-coded job titles'
);

console.log('monthly support bonus RBAC checks passed');
