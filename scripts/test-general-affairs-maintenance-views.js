#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runCase(name, fn) {
  process.stdout.write(`RUN ${name}\n`);
  fn();
  process.stdout.write(`PASS ${name}\n`);
}

function getBlock(source, marker) {
  const index = source.indexOf(marker);
  if (index === -1) return '';
  return source.slice(index, index + 1800);
}

const servicePage = read('components/general-affairs/service-center/GeneralAffairsServiceCenterClient.tsx');
const myReportsClient = read('components/general-affairs/requests/ServiceRequestMyReportsClient.tsx');
const navigation = read('components/general-affairs/navigation.tsx');
const newReportPage = read('app/general-affairs/reports/new/page.tsx');
const myReportsPage = read('app/general-affairs/reports/mine/page.tsx');
const newPartRequestPage = read('app/general-affairs/part-requests/new/page.tsx');
const myPartRequestsPage = read('app/general-affairs/part-requests/page.tsx');
const requestApi = read('app/api/maintenance-requests/route.ts');
const updateApi = read('app/api/maintenance-updates/route.ts');
const statusMapping = read('components/general-affairs/maintenance/status.ts');

runCase('my reports uses unified service request data', () => {
  assert(myReportsClient.includes('/api/general-affairs/requests?'), 'my reports must use unified service request API');
  assert(myReportsClient.includes('REPAIR'), 'my reports must include repair requests');
  assert(myReportsClient.includes('PURCHASE_SUPPLEMENT'), 'my reports must include purchase/supplement requests');
  assert(myReportsClient.includes('public_progress'), 'my reports must show public progress');
});

runCase('material is not an independent data source', () => {
  const forbiddenPatterns = [
    /ga_material_requests/i,
    /material_request_records/i,
    /CREATE\s+TABLE[\s\S]{0,120}material/i,
    /from\('ga_material/i,
    /\/api\/general-affairs\/part-requests/i,
  ];
  for (const pattern of forbiddenPatterns) {
    assert(!pattern.test(servicePage), `service page must not use independent material data source: ${pattern}`);
    assert(!pattern.test(requestApi), `maintenance request API must not use independent material data source: ${pattern}`);
  }
  assert(servicePage.includes('/api/maintenance-requests'), 'my reports and work order center must use maintenance requests API');
});

runCase('part request routes converge to unified demand pages', () => {
  assert(newPartRequestPage.includes("redirect('/general-affairs/reports/new')"), 'new part request route must redirect to unified create');
  assert(myPartRequestsPage.includes("redirect('/general-affairs/reports/mine')"), 'my part requests route must redirect to unified my reports');
});

runCase('sidebar exposes distinct request pages without independent data source', () => {
  assert(navigation.includes("href: '/general-affairs/reports/new'"), 'sidebar create report entry must open a distinct new report route');
  assert(navigation.includes("href: '/general-affairs/reports/mine'"), 'sidebar my reports entry must open a distinct my reports route');
  assert(!navigation.includes("href: '/general-affairs/part-requests/new'"), 'sidebar must not expose legacy new part request');
  assert(!navigation.includes("href: '/general-affairs/part-requests'"), 'sidebar must not expose legacy my part requests');
  assert(!navigation.includes("href: '/general-affairs?section=maintenance&view=new'"), 'new report sidebar entry must not rely on query-string pseudo page');
  assert(!navigation.includes("href: '/general-affairs?section=maintenance&view=mine'"), 'my reports sidebar entry must not rely on query-string pseudo page');
  assert(!navigation.includes("href: '/general-affairs?section=part-requests&view=new'"), 'new part request sidebar entry must not rely on query-string pseudo page');
  assert(!navigation.includes("label: '料件/耗材回報紀錄'"), 'sidebar must not show material records label');
  assert(navigation.includes("label: '我的追蹤'"), 'sidebar must expose my tracking for store users');
  assert(navigation.includes("label: '新增需求'"), 'sidebar must keep unified create demand entry');
  assert(navigation.includes("href: '/general-affairs/work-orders'"), 'sidebar must keep work order center entry for eligible users');
});

runCase('request routes provide distinct UI entry points', () => {
  assert(newReportPage.includes('ServiceRequestCreateClient'), 'new report route must open unified service request create UI');
  assert(myReportsPage.includes('ServiceRequestMyReportsClient'), 'my reports route must open unified service request tracking UI');
  assert(newPartRequestPage.includes("redirect('/general-affairs/reports/new')"), 'new part request route must redirect to unified create UI');
  assert(myPartRequestsPage.includes("redirect('/general-affairs/reports/mine')"), 'my part requests route must redirect to unified tracking UI');
  assert(servicePage.includes('GeneralAffairsServiceCenterInitialView'), 'service center must accept explicit route initial view');
  assert(servicePage.includes("section?: Extract<ServiceSection, 'maintenance' | 'work-orders' | 'part-requests' | 'vendors'>"), 'service center explicit route initial view must include work-orders');
});

runCase('maintenance route supports explicit my reports view', () => {
  assert(servicePage.includes("const view = searchParams.get('view') as MaintenanceView | null;"), 'route query must parse maintenance view');
  assert(servicePage.includes("view === 'mine' || !canSubmit ? 'mine' : 'new'"), 'maintenance view query must keep store users on my reports when requested');
});

runCase('my reports is formal tracking UI', () => {
  const block = myReportsClient;
  [
    'breadcrumbs',
    'GeneralAffairsPageHeader',
    'STATUS_FILTERS',
    '更多篩選',
    '需求紀錄',
    '門市 / 標的',
    '目前進度',
    '現場描述',
    'selectedRequest',
  ].forEach((needle) => {
    assert(block.includes(needle), `my reports UI must include ${needle}`);
  });
});

runCase('kpi and pagination use real query results', () => {
  assert(servicePage.includes('scopedReportRows.reduce'), 'KPI counts must derive from current request rows');
  assert(servicePage.includes('filteredRequests.length'), 'pagination total must derive from filtered rows');
  assert(!/const\s+statusCounts\s*=\s*\{\s*all:\s*\d/.test(servicePage), 'KPI counts must not be hard-coded');
  assert(!/WO-000|假工單|測試維修/.test(servicePage), 'my reports must not hard-code fake work orders');
});

runCase('status and progress are shared with work order center', () => {
  assert(statusMapping.includes('MAINTENANCE_STATUS_DEFINITIONS'), 'central status mapping must exist');
  assert(servicePage.includes("from '@/components/general-affairs/maintenance/status'"), 'service page must import central status mapping');
  assert(servicePage.includes('renderProgress(request)'), 'my reports must use shared progress renderer');
  assert(servicePage.includes('renderWorkOrderCenter'), 'work order center must remain in same component data flow');
  assert(updateApi.includes('transitionMaintenanceTicket'), 'work order updates must use maintenance transition service');
});

runCase('store scope remains API/RLS controlled', () => {
  assert(requestApi.includes('getManagedStoreIds') || requestApi.includes('store_managers'), 'maintenance API must enforce managed store scope');
  assert(servicePage.includes('selectedStoreId'), 'frontend may pass selected store filter');
  assert(!/stores\s*=\s*\[/.test(servicePage), 'frontend must not hard-code store scope');
  assert(!/dev-[a-z0-9._-]+@example\.test/i.test(servicePage), 'frontend must not branch by DEV email');
});

runCase('no DB migration or API contract changes for UI convergence', () => {
  const combined = [servicePage, navigation, statusMapping].join('\n');
  assert(!/CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+POLICY|ALTER\s+POLICY|supabase\s+db\s+push|migration\s+repair|db\s+reset/i.test(combined), 'UI convergence must not contain DB/migration operations');
});

console.log('General Affairs maintenance view convergence tests passed');
