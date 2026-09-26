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

const listRoutePath = 'app/api/supervisor-management-log/daily-plans/route.ts';
const detailRoutePath = 'app/api/supervisor-management-log/daily-plans/[id]/route.ts';
const todayRoutePath = 'app/api/supervisor-management-log/today/route.ts';
const validationPath = 'lib/supervisor-management-log/validation.ts';
const accessPath = 'lib/supervisor-management-log/access.ts';
const currentStatusPath = 'docs/CURRENT-DEV-STATUS.md';
const handoffPath = 'docs/DEV-RBAC-HANDOFF.md';

const listRoute = read(listRoutePath);
const detailRoute = read(detailRoutePath);
const todayRoute = read(todayRoutePath);
const validation = read(validationPath);
const access = read(accessPath);
const currentStatus = read(currentStatusPath);
const handoff = read(handoffPath);

const apiFiles = [
  listRoutePath,
  detailRoutePath,
  todayRoutePath,
];

runCase('daily plans API routes exist and require authenticated user', () => {
  for (const file of apiFiles) {
    const content = read(file);
    assert(content.includes("createClient"), `${file} must use authenticated Supabase server client`);
    assert(content.includes("supabase.auth.getUser"), `${file} must require a logged-in user`);
    assert(content.includes("if (!user)"), `${file} must explicitly reject unauthenticated users`);
    assert(!content.includes('createAdminClient'), `${file} must not use service role`);
  }
});

runCase('daily plans list route supports read filters and pagination', () => {
  assert(listRoute.includes("from('supervisor_management_daily_plans')"), 'list route must query daily plans table');
  assert(listRoute.includes('getPagination'), 'list route must paginate results');
  for (const filter of ['date', 'status', 'targetType', 'storeId', 'employeeId', 'search']) {
    assert(listRoute.includes(`searchParams.get('${filter}')`), `list route missing ${filter} filter`);
  }
  assert(listRoute.includes('canViewSupervisorManagementLog'), 'list route must use view permission guard');
  assert(listRoute.includes('canCreateSupervisorManagementLog'), 'POST route must use create permission guard');
  assert(listRoute.includes('validateDailyPlanPayload'), 'POST route must validate daily plan payload');
  assert(listRoute.includes('owner_user_id: user.id'), 'POST route must force owner_user_id to current user');
  assert(!/\.insert\(payload\)[\s\S]*?\.select\(/.test(listRoute), 'POST route must avoid INSERT RETURNING RLS trap');
});

runCase('daily plan detail route supports get patch and soft delete', () => {
  assert(detailRoute.includes('export async function GET'), 'detail GET missing');
  assert(detailRoute.includes('export async function PATCH'), 'detail PATCH missing');
  assert(detailRoute.includes('export async function DELETE'), 'detail DELETE missing');
  assert(detailRoute.includes('validateUuid(params.id'), 'detail route must validate id');
  assert(detailRoute.includes('canViewSupervisorManagementLog'), 'detail GET must use view permission guard');
  assert(detailRoute.includes('canWriteSupervisorManagementDailyPlan'), 'PATCH must use daily plan write guard');
  assert(detailRoute.includes('canManageSupervisorManagementLog'), 'DELETE must use manage permission guard');
  assert(detailRoute.includes('validateDeletionReason'), 'DELETE must require deletion reason');
  assert(detailRoute.includes("supervisor_management_soft_delete_daily_plan"), 'DELETE must call soft delete RPC');
  assert(!/\.update\(payload\)[\s\S]*?\.select\(/.test(detailRoute), 'PATCH route must avoid UPDATE RETURNING RLS trap');
});

runCase('today read model uses real tables and no fake data', () => {
  assert(todayRoute.includes("from('supervisor_management_daily_plans')"), 'today API must load daily plans');
  assert(todayRoute.includes("from('supervisor_management_records')"), 'today API must load today records');
  assert(todayRoute.includes("from('supervisor_management_cases')"), 'today API must load follow-up cases');
  assert(todayRoute.includes('followUpQueue'), 'today API must return follow-up queue');
  assert(todayRoute.includes('bucketFollowUp'), 'today API must bucket follow-ups');
  assert(todayRoute.includes('overdue'), 'today API must include overdue bucket');
  assert(todayRoute.includes('upcoming'), 'today API must include upcoming bucket');
  assert(todayRoute.includes('latest_record'), 'today API must include latest real record context');
  assert(!/MOCK_|FAKE_|假資料|測試案件|AI 已幫你整理/i.test(todayRoute), 'today API must not include fake operational data');
});

runCase('validation covers daily plan fields and system field forgery', () => {
  assert(validation.includes('validateDailyPlanPayload'), 'daily plan validation function missing');
  assert(validation.includes('DAILY_PLAN_STATUSES'), 'daily plan status enum missing');
  for (const field of [
    'plan_date',
    'target_type',
    'store_id',
    'employee_id',
    'target_name_snapshot',
    'category_id',
    'title',
    'status',
    'started_at',
    'completed_at',
    'linked_case_id',
    'linked_record_id',
    'notes',
    'metadata',
  ]) {
    assert(validation.includes(field), `daily plan validation missing ${field}`);
  }
  assert(validation.includes('rejectSystemFields(body)'), 'daily plan validation must reject system fields');
});

runCase('access helper exposes daily plan write guard using effective permissions', () => {
  assert(access.includes('canWriteSupervisorManagementDailyPlan'), 'daily plan write guard missing');
  for (const code of [
    'supervisor.management_log.create',
    'supervisor.management_log.update_own',
    'supervisor.management_log.follow_up',
    'supervisor.management_log.manage',
  ]) {
    assert(access.includes(code), `access helper missing ${code}`);
  }
  assert(!access.includes('profiles.role') || access.includes('profileRole'), 'access helper should not rely only on profiles.role');
});

runCase('API implementation does not modify DB migrations or remote state', () => {
  const combined = [...apiFiles.map(read), validation, access].join('\n');
  assert(!/CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+POLICY|supabase\s+db\s+push|migration\s+repair|db\s+reset|rollback/i.test(combined), 'API implementation must not contain DB or remote operations');
  assert(!/odvksgucvfoaqrumpran|service_role|SUPABASE_SERVICE_ROLE|password|jwt/i.test(combined), 'API implementation must not contain project refs or secrets');
});

runCase('handoff and current status record next API phase', () => {
  assert(currentStatus.includes('SML-UX-2C'), 'current status must mention SML-UX-2C');
  assert(handoff.includes('SML-UX-2C'), 'handoff must mention SML-UX-2C');
});

console.log('Supervisor management daily plans API static tests passed');
