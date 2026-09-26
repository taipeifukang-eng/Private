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

const navbar = read('components/Navbar.tsx');
const permissions = read('hooks/useNavbarPermissions.ts');
const page = read('app/supervisor-management-log/page.tsx');

const permissionCodes = [
  'supervisor.management_log.view_own',
  'supervisor.management_log.view_team',
  'supervisor.management_log.create',
  'supervisor.management_log.update_own',
  'supervisor.management_log.follow_up',
  'supervisor.management_log.manage',
];

runCase('top navbar exposes independent supervisor management log block', () => {
  assert(navbar.includes("href=\"/supervisor-management-log\""), 'desktop navbar must link to supervisor management log route');
  assert(navbar.includes('督導管理日誌'), 'navbar must display supervisor management log label');
  assert(navbar.includes('isInSupervisorManagementLogSection'), 'navbar must track active supervisor management log section');
  assert(navbar.includes('NotebookPen'), 'navbar should use a dedicated icon');
  assert(!navbar.includes('/inspection/supervisor-management-log'), 'module must not be nested under inspection');
});

runCase('mobile navbar exposes the same module', () => {
  assert(navbar.includes('setIsMobileMenuOpen(false)'), 'mobile links should close the menu after navigation');
  assert(navbar.includes("permissions.canAccessSupervisorManagementLog"), 'mobile and desktop should share the same permission flag');
});

runCase('permissions use effective RBAC codes', () => {
  assert(permissions.includes('canAccessSupervisorManagementLog'), 'navbar permissions must include supervisor management log flag');
  for (const code of permissionCodes) {
    assert(permissions.includes(code), `missing permission code ${code}`);
  }
  assert(!permissions.includes('profiles.role') || permissions.includes('profileRole'), 'permissions should not rely on profiles.role as the only source');
});

runCase('page is route-level operational SML-2 workbench', () => {
  assert(page.includes('督導管理日誌'), 'page title missing');
  assert(page.includes('/api/supervisor-management-log/cases'), 'page must load real supervisor cases API');
  assert(page.includes('/api/supervisor-management-log/options'), 'page must load real supervisor options API');
  assert(page.includes('/api/supervisor-management-log/today'), 'page must load real today workspace API');
  assert(page.includes('/api/supervisor-management-log/daily-plans'), 'page must use daily plan API');
  assert(page.includes('建立管理案件'), 'page must include case creation action');
  assert(page.includes('新增管理結果'), 'page must include record-first management result flow');
  assert(page.includes('新增追蹤結果'), 'page must include follow-up form');
  assert(!page.includes('Management Case / Record / Follow-up'), 'formal UI must not expose developer information architecture terms');
});

runCase('UX IA prioritizes daily work and cases only', () => {
  assert(page.includes('WORKSPACE_TABS'), 'page must centralize SML workspace tabs');
  for (const label of ['今日工作台', '管理案件']) {
    assert(page.includes(label), `missing workspace tab ${label}`);
  }
  assert(!page.includes("key: 'stores'"), 'store history must not be a first-level tab before the knowledge base phase');
  assert(!page.includes("key: 'employees'"), 'employee history must not be a first-level tab before the knowledge base phase');
  assert(!page.includes("key: 'history'"), 'case library must not be a first-level tab before the knowledge base phase');
  assert(page.includes("activeTab === 'today'"), 'today workspace must be a first-class view');
  assert(page.includes("activeTab === 'cases'"), 'case list must move behind the management cases tab');
});

runCase('today workspace is record-first and does not fake AI', () => {
  assert(page.includes('今日管理工作台'), 'today workspace title missing');
  assert(page.includes('今日管理規劃'), 'daily plan block missing');
  assert(page.includes('快速口述'), 'primary voice entry missing');
  assert(page.includes('新增管理結果'), 'quick record flow missing');
  assert(page.includes('今日待追蹤'), 'today follow-up queue missing');
  assert(page.includes('今日管理紀錄'), 'today record section missing');
  assert(page.includes('快速口述尚未開放'), 'voice entry must be a safe non-writing placeholder');
  assert(!page.includes('AI 已幫你整理'), 'AI review must not be faked before the AI phase');
  assert(!page.includes('Transcript / AI Review'), 'formal UI must not expose implementation phase names');
  assert(!page.includes('今日 / 近期管理'), 'today records must use the real today workspace section name');
});

runCase('today workspace uses real daily plan state and followup workflow', () => {
  assert(page.includes('todayWorkspace?.summary.plans'), 'today KPI must come from today API summary');
  assert(page.includes('todayWorkspace.plans.map'), 'today plans must render real daily plan rows');
  assert(page.includes('submitDailyPlan'), 'daily plan create/update handler missing');
  assert(page.includes('updateDailyPlanStatus'), 'daily plan status update handler missing');
  assert(page.includes('deleteDailyPlan'), 'daily plan soft delete handler missing');
  assert(page.includes('openQuickFollowup'), 'follow-up queue must open a same-page followup workflow');
  assert(page.includes('startPlanWork'), 'starting a plan must lead into the management result workflow');
  assert(page.includes('今天看到什麼？'), 'record form should use supervisor-friendly language');
  assert(page.includes('結果如何？'), 'followup flow should be quick and outcome-first');
  assert(page.includes('todayWorkspace.todayRecords.map'), 'today record list must render real today records');
});

runCase('unfinished knowledge base tabs are hidden from formal UX', () => {
  assert(!page.includes('此功能尚未開放'), 'unfinished tabs should be hidden instead of showing placeholder cards');
  assert(!page.includes('SML-UX-2A'), 'formal UI must not expose task code names');
  assert(!page.includes('today / history API'), 'formal UI must not expose implementation API notes');
  assert(!page.includes('server API / RLS'), 'formal UI must not expose backend implementation details');
});

runCase('no DB migration or fake operational data in UI', () => {
  const combined = [navbar, permissions, page].join('\n');
  assert(!/CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+POLICY|supabase\s+db\s+push|migration\s+repair|db\s+reset/i.test(combined), 'UI shell must not contain DB or remote operations');
  assert(!/MOCK_|FAKE_|測試案件|WO-000|CASE-000|本週完成.*value:\s*['"]\d+|保健品業績大概差目標八趴/i.test(combined), 'UI must not hard-code fake case records or KPI');
});

runCase('SML APIs exist and use server-side permission guards', () => {
  const apiFiles = [
    'app/api/supervisor-management-log/cases/route.ts',
    'app/api/supervisor-management-log/cases/[id]/route.ts',
    'app/api/supervisor-management-log/cases/[id]/records/route.ts',
    'app/api/supervisor-management-log/cases/[id]/followups/route.ts',
    'app/api/supervisor-management-log/options/route.ts',
    'app/api/supervisor-management-log/categories/route.ts',
    'app/api/supervisor-management-log/daily-plans/route.ts',
    'app/api/supervisor-management-log/daily-plans/[id]/route.ts',
    'app/api/supervisor-management-log/today/route.ts',
  ];

  for (const file of apiFiles) {
    const content = read(file);
    assert(content.includes("createClient"), `${file} must use authenticated Supabase server client`);
    assert(content.includes("supabase.auth.getUser"), `${file} must require logged-in user`);
    assert(/can(View|Create|Update|Manage)SupervisorManagementLog/.test(content), `${file} must check server-side permission`);
    assert(!content.includes('createAdminClient'), `${file} must not use service role for tested RLS flows`);
  }
});

runCase('case creation avoids INSERT RETURNING RLS trap', () => {
  const casesApi = read('app/api/supervisor-management-log/cases/route.ts');
  const postHandler = casesApi.slice(casesApi.indexOf('export async function POST'));

  assert(postHandler.includes('.insert(payload)'), 'case POST must insert the validated payload');
  assert(!/\.insert\(payload\)[\s\S]*?\.select\(/.test(postHandler), 'case POST must not chain select() after insert because INSERT RETURNING also requires SELECT RLS');
  assert(postHandler.includes('data: null'), 'case POST should return minimal success data and let the UI reload the list');
});

runCase('record and followup creation avoid INSERT RETURNING RLS trap', () => {
  const files = [
    'app/api/supervisor-management-log/cases/[id]/records/route.ts',
    'app/api/supervisor-management-log/cases/[id]/followups/route.ts',
  ];

  for (const file of files) {
    const content = read(file);
    const postHandler = content.slice(content.indexOf('export async function POST'));
    assert(postHandler.includes('.insert(payload)'), `${file} must insert the validated payload`);
    assert(!/\.insert\(payload\)[\s\S]*?\.select\(/.test(postHandler), `${file} must not chain select() after insert`);
    assert(postHandler.includes('data: null'), `${file} should return minimal success data and let the UI reload details`);
  }
});

runCase('case update avoids UPDATE RETURNING RLS trap', () => {
  const caseApi = read('app/api/supervisor-management-log/cases/[id]/route.ts');
  const patchHandler = caseApi.slice(caseApi.indexOf('export async function PATCH'), caseApi.indexOf('export async function DELETE'));

  assert(patchHandler.includes('.update(payload)'), 'case PATCH must update the validated payload');
  assert(!/\.update\(payload\)[\s\S]*?\.select\(/.test(patchHandler), 'case PATCH must not chain select() after update');
  assert(patchHandler.includes('data: null'), 'case PATCH should return minimal success data and let the UI reload details');
});

runCase('case detail panel reads records followups and events', () => {
  assert(page.includes('loadCaseDetail'), 'page must have a detail loading helper');
  assert(page.includes('/api/supervisor-management-log/cases/${caseId}'), 'page must fetch case detail API after selecting a case');
  assert(page.includes('管理紀錄'), 'detail panel must render management records section');
  assert(page.includes('追蹤結果'), 'detail panel must render follow-up section');
  assert(page.includes('系統紀錄'), 'detail panel must render system timeline section');
  assert(page.includes('selectedCase.records'), 'detail panel must use records from detail API');
  assert(page.includes('selectedCase.followups'), 'detail panel must use followups from detail API');
  assert(page.includes('selectedCase.events'), 'detail panel must use events from detail API');
});

runCase('record form exposes approved operational log fields', () => {
  assert(page.includes('RECORD_TYPE'), 'record form must use centralized record type labels');
  assert(page.includes('recordForm.record_type'), 'record form must let users choose record type');
  assert(page.includes('recordForm.record_date'), 'record form must let users choose record date');
  assert(page.includes('ACTION_OPTIONS'), 'record form must expose management action options');
  assert(page.includes('toggleActionOption'), 'record action options must be selectable');
  assert(page.includes('recordForm.action_options'), 'record payload must include action_options');
  assert(page.includes('FOLLOW_UP_METHOD'), 'record form must expose follow-up method options');
  assert(page.includes('recordForm.follow_up_method'), 'record payload must include follow_up_method');
});

runCase('followup form can link back to source management record', () => {
  assert(page.includes('followupForm.source_record_id'), 'followup form must expose source_record_id');
  assert(page.includes('selectedCase.records || []'), 'followup source selector must use case records');
  assert(page.includes('sourceRecord'), 'followup detail must resolve linked source record for display');
  assert(page.includes('followupForm.follow_up_date'), 'followup form must expose actual follow-up date');
  assert(page.includes('FOLLOWUP_STATUS'), 'followup status options must be centralized');
  assert(page.includes('source_record_id: followupForm.source_record_id || null'), 'followup payload must normalize optional source_record_id');
});

runCase('case page uses compact status filters instead of dashboard cards', () => {
  assert(page.includes("['OPEN', '待處理']"), 'case page must expose status filter pills');
  assert(page.includes("['FOLLOW_UP', '待追蹤']"), 'case page must expose follow-up status filter');
  assert(page.includes("['CLOSED', '已結案']"), 'case page must expose closed status filter');
  assert(!page.includes("helper: '目前頁資料'"), 'case page should not show large page-level KPI cards');
});

runCase('case workbench exposes edit and soft delete actions', () => {
  assert(page.includes('submitCaseUpdate'), 'page must support case editing through PATCH API');
  assert(page.includes('deleteSelectedCase'), 'page must support case soft delete through DELETE API');
  assert(page.includes('deletion_reason'), 'delete API request must include deletion_reason');
  assert(page.includes('請輸入刪除督導管理案件的原因'), 'delete action must ask for a reason');
  assert(page.includes('編輯案件'), 'detail panel must show an edit form');
  assert(page.includes('儲存案件變更'), 'edit form must include a save action');
  assert(page.includes('案件已更新'), 'case update success notice missing');
  assert(page.includes('案件已刪除'), 'case delete success notice missing');
});

runCase('validation blocks system field forgery', () => {
  const validation = read('lib/supervisor-management-log/validation.ts');
  assert(validation.includes('SYSTEM_FIELDS'), 'validation must centralize system fields');
  assert(validation.includes('欄位 ${field} 不可由 Client 指定'), 'validation must reject client system fields');
  assert(validation.includes('validateCasePayload'), 'case validation missing');
  assert(validation.includes('validateRecordPayload'), 'record validation missing');
  assert(validation.includes('validateFollowupPayload'), 'followup validation missing');
});

console.log('Supervisor management log UI/API static tests passed');
