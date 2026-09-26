const fs = require('fs');
const path = require('path');

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const dashboardPath = 'components/general-affairs/dashboard/GeneralAffairsDashboardClient.tsx';
const pagePath = 'app/general-affairs/page.tsx';
const servicePagePath = 'components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx';
const navigationPath = 'components/general-affairs/navigation.tsx';
const featuresPath = 'components/general-affairs/features.ts';
const templatesPath = 'components/general-affairs/GeneralAffairsPageTemplates.tsx';

[
  dashboardPath,
  pagePath,
  servicePagePath,
  navigationPath,
  featuresPath,
  'components/general-affairs/GeneralAffairsPageHeader.tsx',
  'components/general-affairs/GeneralAffairsPageTemplates.tsx',
  'components/general-affairs/GeneralAffairsPageState.tsx',
].forEach((file) => assert(fs.existsSync(path.join(root, file)), `${file} should exist`));

const dashboard = read(dashboardPath);
const page = read(pagePath);
const servicePage = read(servicePagePath);
const navigation = read(navigationPath);
const features = read(featuresPath);
const templates = read(templatesPath);
const dashboardTemplate = templates.match(/export function GeneralAffairsDashboardPage[\s\S]*?(?=type GeneralAffairsFormPageProps)/)?.[0] || '';

console.log('RUN dashboard uses UI-1 common components');
assert(dashboard.includes('GeneralAffairsPageHeader'), 'dashboard should use GeneralAffairsPageHeader');
assert(dashboard.includes('GeneralAffairsDashboardPage'), 'dashboard should use GeneralAffairsDashboardPage');
assert(dashboard.includes('GeneralAffairsEmptyState'), 'dashboard should use shared empty state');
assert(dashboard.includes('GeneralAffairsErrorState'), 'dashboard should use shared error state');
assert(page.includes('GeneralAffairsServiceCenterClient'), '/general-affairs should render service center client');
assert(servicePage.includes('GeneralAffairsDashboardClient'), 'service center should render dashboard client');
console.log('PASS dashboard uses UI-1 common components');

console.log('RUN dashboard does not add API contract');
assert(!dashboard.includes('/api/general-affairs/dashboard'), 'dashboard must not introduce aggregate dashboard API');
assert(dashboard.includes('/api/general-affairs/requests?'), 'dashboard may reuse service requests API for store todo reminders');
assert(dashboard.includes('/api/general-affairs/inventory/balances'), 'dashboard may reuse inventory balances API');
assert(dashboard.includes('/api/general-affairs/inventory/transactions'), 'dashboard may reuse inventory transactions API');
assert(dashboard.includes('/api/general-affairs/inventory/options'), 'dashboard may reuse inventory options API');
assert(!/export\s+async\s+function\s+(GET|POST|PATCH|DELETE)/.test(dashboard), 'dashboard component must not define API handlers');
console.log('PASS dashboard does not add API contract');

console.log('RUN KPI uses real data guards');
assert(dashboard.includes('inventory.balanceMeta'), 'balance KPI should depend on returned metadata');
assert(dashboard.includes('inventory.transactionMeta'), 'transaction KPI should depend on returned metadata');
assert(dashboard.includes('lowStockItems'), 'low stock KPI/task should be computed from options data');
assert(dashboard.includes('negativeBalances'), 'negative balance alert should be computed from balances');
assert(dashboard.includes('canAccessInventory &&'), 'inventory KPIs should require inventory permission');
assert(!dashboard.includes('待受理 12'), 'dashboard must not contain blueprint mock KPI numbers');
assert(!dashboard.includes('處理中 8'), 'dashboard must not contain blueprint mock KPI numbers');
assert(!dashboard.includes('待出庫 3'), 'dashboard must not contain blueprint mock KPI numbers');
console.log('PASS KPI uses real data guards');

console.log('RUN store todo is shown once in the actionable list');
assert(dashboard.includes('StoreTodoDashboardState'), 'dashboard should track store-facing todo counts separately');
assert(dashboard.includes('loadStoreTodos'), 'dashboard should load store-facing todo reminders');
assert(dashboard.includes("row.main_status === 'WAITING_STORE_CONFIRMATION'"), 'dashboard should count store confirmations');
assert(dashboard.includes("row.main_status === 'WAITING_STORE_SUPPLEMENT'"), 'dashboard should count store supplement actions');
assert(!dashboard.includes('門市待辦提醒'), 'dashboard should not repeat todo items in a large reminder');
assert(!dashboard.includes('你有 ${storeTodos.confirmation} 件總務事項待確認'), 'dashboard should not repeat todo counts above the list');
assert(dashboard.includes('storeTodoHref'), 'dashboard reminder should compute the precise my tracking destination');
assert(dashboard.includes('/general-affairs/reports/mine?status=WAITING_STORE_CONFIRMATION'), 'dashboard reminder should deep-link to waiting confirmation');
assert(dashboard.includes('/general-affairs/reports/mine?status=WAITING_STORE_SUPPLEMENT'), 'dashboard reminder should deep-link to waiting supplement');
assert(dashboard.includes('highlighted: storeTodos.confirmation > 0 || storeTodos.supplement > 0'), 'dashboard should highlight my tracking without repeating counts');
assert(dashboard.includes('actionItems'), 'dashboard should keep recent store action items for my todo list');
assert(dashboard.includes("['WAITING_STORE_CONFIRMATION', 'WAITING_STORE_SUPPLEMENT'].includes(row.main_status)"), 'dashboard todo list should prioritize store action statuses');
assert(dashboard.includes('載入門市待辦'), 'dashboard my todo should load store todos first');
assert(dashboard.includes('請確認現場結果或收貨狀況'), 'dashboard my todo should explain confirmation action in store words');
assert(dashboard.includes('請補充照片、數量或現場說明'), 'dashboard my todo should explain supplement action in store words');
assert(dashboard.includes("isConfirmation ? '待確認' : '待補資料'"), 'dashboard my todo should badge each store action item');
assert(dashboard.includes('requestId=${encodeURIComponent(item.id)}'), 'dashboard my todo should deep-link to the exact request item');
assert(dashboardTemplate.lastIndexOf('{children}') < dashboardTemplate.lastIndexOf('{quickActions}'), 'dashboard todo content should appear before function shortcuts');
assert(dashboardTemplate.lastIndexOf('{quickActions}') < dashboardTemplate.lastIndexOf('{kpi}'), 'inventory KPI should come after actionable content');
assert(dashboard.includes('CardShell title="可用功能"'), 'dashboard should use one flat function area');
assert(!dashboard.includes("title: '門市 / 店長'"), 'dashboard should not explain roles with duplicate action groups');
assert(!dashboard.includes("title: '總務 / 工務'"), 'dashboard should not explain roles with duplicate action groups');
console.log('PASS store todo is shown once in the actionable list');

console.log('RUN planned features are not clickable actions');
['inventory-count'].forEach((id) => {
  const navBlock = navigation.match(new RegExp(`id:\\s*'${id}'[\\s\\S]*?(?=\\n\\s*\\{\\n\\s*id:|\\n\\s*\\],|\\n\\s*\\})`))?.[0] || '';
  assert(!/href:\s*'/.test(navBlock), `${id} should not be clickable while planned`);
});
const partFulfillmentBlock = navigation.match(new RegExp(`id:\\s*'part-request-review'[\\s\\S]*?(?=\\n\\s*\\{\\n\\s*id:|\\n\\s*\\],|\\n\\s*\\})`))?.[0] || '';
assert(/href:\s*'\/general-affairs\/part-fulfillments'/.test(partFulfillmentBlock), 'part fulfillment center should replace the planned part request review entry');
assert(!dashboard.includes('/general-affairs/inventory/count'), 'dashboard must not link to inventory count');
assert(navigation.includes("href: '/general-affairs/inventory/transfers'"), 'dashboard navigation may link to available transfers');
console.log('PASS planned features are not clickable actions');

console.log('RUN quick action routes are real existing routes');
[
  'app/general-affairs/inventory/page.tsx',
  'app/general-affairs/inventory/locations/page.tsx',
  'app/general-affairs/inventory/transfers/page.tsx',
  'app/general-affairs/equipment/page.tsx',
  'app/general-affairs/equipment/templates/page.tsx',
  'app/general-affairs/facilities/page.tsx',
  'app/general-affairs/parts/page.tsx',
  'app/general-affairs/work-orders/page.tsx',
].forEach((file) => assert(fs.existsSync(path.join(root, file)), `${file} should exist for quick action`));
assert(dashboard.includes("href: '/general-affairs?section=vendors'"), 'vendor quick action should use existing query route');
assert(dashboard.includes("href: '/general-affairs/work-orders'"), 'work order quick action should use formal route');
console.log('PASS quick action routes are real existing routes');

console.log('RUN permission filtering is effective-permission based');
[
  'canAccessInventory',
  'canAccessInventoryLocations',
  'canAccessEquipment',
  'canAccessFacilities',
  'canAccessParts',
  'canAccessVendors',
].forEach((flag) => assert(dashboard.includes(flag), `dashboard should accept ${flag}`));
assert(dashboard.includes('if (!canAccessInventory)'), 'dashboard should avoid protected inventory requests without permission');
[/@example\.test/i, /dev-ga-/i, /dev-full-admin/i, /profile\.role\s*===/i, /email\s*===/i].forEach((pattern) => {
  assert(!pattern.test(dashboard), `dashboard must not use identity-driven permissions: ${pattern}`);
});
console.log('PASS permission filtering is effective-permission based');

console.log('RUN error output is sanitized');
assert(dashboard.includes('safeMessage'), 'dashboard should sanitize API errors');
['Could not find the table', 'Database error deleting user', 'service_role', 'SUPABASE_SERVICE_ROLE'].forEach((text) => {
  assert(!dashboard.includes(text), `dashboard should not expose raw/sensitive text: ${text}`);
});
console.log('PASS error output is sanitized');

console.log('RUN mobile layout avoids fixed width');
assert(!/w-\[\d+px\]/.test(dashboard), 'dashboard should not use fixed pixel widths that risk mobile overflow');
assert(dashboard.includes('sm:grid-cols-2'), 'dashboard should include responsive two-column behavior');
assert(dashboard.includes('xl:grid-cols'), 'dashboard should include desktop layout behavior');
console.log('PASS mobile layout avoids fixed width');

console.log('RUN page has one primary action');
const primaryActionMatches = dashboard.match(/primaryAction=/g) || [];
assert(primaryActionMatches.length === 1, `dashboard should pass one primary action, got ${primaryActionMatches.length}`);
console.log('PASS page has one primary action');

console.log('RUN no migration or DB schema changes in dashboard');
[dashboard, page].forEach((text, index) => {
  assert(!/create table|alter table|drop table|create policy|alter policy/i.test(text), `DB DDL found in UI file index ${index}`);
  assert(!/supabase\s+db\s+push|migration repair|db reset/i.test(text), `DB operation text found in UI file index ${index}`);
});
console.log('PASS no migration or DB schema changes in dashboard');

console.log('RUN feature availability remains centralized');
assert(features.includes("status: 'available'"), 'feature availability should define available status');
assert(features.includes("status: 'planned'"), 'feature availability should define planned status');
assert(features.includes("status: 'temporarily_unavailable'"), 'feature availability should define temporarily unavailable status');
assert(!dashboard.includes("status: 'planned'"), 'dashboard should not redefine planned feature availability');
console.log('PASS feature availability remains centralized');

console.log('General Affairs dashboard UI static tests passed');
