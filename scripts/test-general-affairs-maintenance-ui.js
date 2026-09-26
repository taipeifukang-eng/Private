const fs = require('fs');
const path = require('path');

const root = process.cwd();
const pagePath = path.join(root, 'components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx');
const statusPath = path.join(root, 'components/general-affairs/maintenance/status.ts');
const apiRequestPath = path.join(root, 'app/api/maintenance-requests/route.ts');
const apiUpdatePath = path.join(root, 'app/api/maintenance-updates/route.ts');
const statusServicePath = path.join(root, 'lib/maintenance/status-service.ts');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runCase(name, fn) {
  process.stdout.write(`RUN ${name}\n`);
  fn();
  process.stdout.write(`PASS ${name}\n`);
}

const page = read(pagePath);
const status = read(statusPath);
const requestApi = read(apiRequestPath);
const updateApi = read(apiUpdatePath);
const statusService = read(statusServicePath);

runCase('maintenance status mapping is centralized', () => {
  assert(status.includes('MAINTENANCE_STATUS_DEFINITIONS'), 'status definitions must exist');
  assert(page.includes("from '@/components/general-affairs/maintenance/status'"), 'page must import centralized status mapping');
  const codes = [...status.matchAll(/code:\s*'([A-Z_]+)'/g)].map((match) => match[1]);
  assert(codes.length >= 4, 'status mapping must include maintenance statuses');
  assert(new Set(codes).size === codes.length, 'status codes must be unique');
});

runCase('shared UI-1 templates and states are used', () => {
  assert(page.includes('GeneralAffairsPageHeader'), 'maintenance UI must use GeneralAffairsPageHeader');
  assert(page.includes('GeneralAffairsFormPage'), 'new report UI must use GeneralAffairsFormPage');
  assert(page.includes('GeneralAffairsListPage'), 'list/inbox UI must use GeneralAffairsListPage');
  assert(page.includes('GeneralAffairsLoadingState'), 'loading state must use shared PageState');
  assert(page.includes('GeneralAffairsErrorState'), 'error state must use shared PageState');
  assert(page.includes('GeneralAffairsPermissionDeniedState'), 'permission denied must use shared PageState');
});

runCase('permission filtering does not use email or role name', () => {
  const forbiddenPatterns = [
    /dev-[a-z0-9._-]+@example\.test/i,
    /profile(?:s)?\.role\s*===/i,
    /role(?:Name|Code)\s*===/i,
  ];
  for (const pattern of forbiddenPatterns) {
    assert(!pattern.test(page), `maintenance UI must not use ${pattern}`);
  }
  assert(page.includes('GA_MAINTENANCE_REQUEST_CREATE'), 'GA maintenance create permission must be checked');
  assert(page.includes('GA_MAINTENANCE_REQUEST_VIEW_ALL'), 'GA maintenance view-all permission must be checked');
  assert(page.includes('GA_MAINTENANCE_REQUEST_UPDATE'), 'GA maintenance update permission must be checked');
  assert(!page.includes("checkPermission('cross_dept.maintenance."), 'GA page must not use cross-department maintenance permission checks');
});

runCase('store scope remains API and RLS controlled', () => {
  assert(requestApi.includes('store_managers'), 'maintenance API must keep store manager scope');
  assert(page.includes('store_id'), 'page may pass selected store filter');
  assert(!/stores\s*=\s*\[/.test(page), 'page must not hard-code store scope');
});

runCase('view-only users do not see manage-only actions', () => {
  assert(page.includes('disabled={!canUpdateWorkOrders}'), 'work order manage controls must be disabled without update permission');
  assert(page.includes('canForceCloseWorkOrders'), 'force close must have a separate permission gate');
  assert(updateApi.includes('transitionMaintenanceTicket'), 'API must use maintenance transition service');
  assert(statusService.includes('general_affairs.service_center.force_close'), 'service must keep force close permission');
});

runCase('planned operations are not clickable actions', () => {
  const forbiddenButtonLabels = [
    '待報價',
    '待派工',
    '待驗收',
    '待請款',
    '查看設備詳情</button>',
  ];
  for (const label of forbiddenButtonLabels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert(!new RegExp(`<button[^>]*>[\\s\\S]{0,300}${escaped}`, 'i').test(page), `planned operation must not be clickable: ${label}`);
  }
  assert(status.includes('PLANNED_MAINTENANCE_ACTIONS'), 'planned maintenance actions must be documented');
});

runCase('form uses real attachment UI and does not fake success', () => {
  assert(page.includes('/api/maintenance-photos'), 'existing maintenance photo API may remain');
  assert(page.includes('ResourceAttachmentPanel'), 'maintenance UI may use the approved shared attachment panel');
  assert(!/附件上傳成功/.test(page), 'must not present fake attachment success');
});

runCase('work order next action form is beginner friendly', () => {
  assert(page.includes('已選下一步'), 'work order update panel must summarize the selected next step');
  assert(page.includes('門市看得到這段進度'), 'work order update panel must identify store-facing progress text');
  assert(page.includes('進階設定：階段、承辦人、可見性、日期'), 'technical work order fields must be grouped behind advanced settings');
  assert(page.includes('setShowAdvancedWorkOrderUpdate(false)'), 'quick actions and save reset the advanced fields to collapsed');
  ['出庫', '調撥', '採購', '派工', '補資料', '駁回'].forEach((label) => {
    assert(page.includes(label), `work order quick action must exist: ${label}`);
  });
});

runCase('raw API diagnostics are not rendered directly', () => {
  assert(page.includes('GeneralAffairsErrorState'), 'page must use sanitized shared error state');
  const unsafeUiPatterns = [
    /schema cache[^']*<\/|public\.[a-z0-9_]+[^']*<\/|SQLSTATE[^']*<\/|migration_[a-z0-9_]+\.sql[^']*</i,
  ];
  for (const pattern of unsafeUiPatterns) {
    assert(!pattern.test(page), `raw diagnostics must not be rendered: ${pattern}`);
  }
});

runCase('mobile layout avoids fixed width detail drawer', () => {
  assert(page.includes('lg:grid-cols') || page.includes('xl:grid-cols'), 'desktop split layout should be responsive');
  assert(!/[^-]w-\[(9|1\d{3,})px\]/.test(page), 'maintenance UI must not use large fixed pixel widths');
});

runCase('no API contract or DB schema change in UI task', () => {
  const combined = [page, status].join('\n');
  assert(!/CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+POLICY|ALTER\s+POLICY|supabase\s+db\s+push|migration\s+repair|db\s+reset/i.test(combined), 'UI task must not contain DB/migration operations');
  assert(!fs.existsSync(path.join(root, 'app/api/general-affairs/maintenance/dashboard/route.ts')), 'must not add aggregate dashboard API');
});

runCase('no hard-coded fake maintenance records', () => {
  assert(!/MOCK_|FAKE_|WO-000|測試工單|測試維修|DEV\s*假工單/i.test(page), 'must not hard-code fake maintenance records');
});

console.log('General Affairs maintenance UI static tests passed');
