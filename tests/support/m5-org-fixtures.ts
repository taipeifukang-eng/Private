import type { APIRequestContext } from '@playwright/test';
import { adminDb, runIdOrThrow } from './m5-fixtures';
import { randomUUID } from 'node:crypto';

/**
 * M5 W21（組織與部門）、P06（使用者與角色）測試共用工具。
 * 規則：只用 DEV；組織單位代碼一律 M5W21-<RUNID>-<標記>、名稱「[自動測試]M5 <runId> …」；
 * 只刪帶標記的單位、成員、主管、職掌與本次帳號寫入的儲存識別紀錄，不做大量刪除。DEV 組織單位原本是空的，仍以標記為準。
 */
export const ORG_CODE_PREFIX = 'M5W21-';
export const orgCode = (tag: string) => `${ORG_CODE_PREFIX}${runIdOrThrow().toUpperCase()}-${tag}`;
export const orgName = (tag: string) => `[自動測試]M5 ${runIdOrThrow()} ${tag}`;
function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} 失敗：${res.error.message}`);
  return res.data;
}

export type OrgTree = { hq: string; deptA: string; deptB: string; teamA1: string; deptC: string };
export async function seedOrgTree(): Promise<OrgTree> {
  const db = adminDb();
  const insert = async (tag: string, type: string, parent: string | null, status = 'active', sort = 0) =>
    (must(await db.from('organization_units').insert({ code: orgCode(tag), name: orgName(tag), short_name: tag, type, parent_id: parent, status, sort_order: sort }).select('id').single(), `建立單位 ${tag}`) as { id: string }).id;
  const hq = await insert('HQ', 'headquarters', null);
  const deptA = await insert('A', 'department', hq, 'active', 1);
  const deptB = await insert('B', 'department', hq, 'inactive', 2); // 停用部門
  const teamA1 = await insert('A1', 'team', deptA, 'active', 1);
  const deptC = await insert('C', 'department', hq, 'active', 3);
  return { hq, deptA, deptB, teamA1, deptC };
}
export async function addMember(unitId: string, userId: string, primary = true) {
  must(await adminDb().from('organization_memberships').insert({ organization_unit_id: unitId, user_id: userId, membership_role: 'member', membership_type: 'primary_department', is_primary: primary, status: 'active' }), '加入成員');
}
export async function addManager(unitId: string, userId: string, role = 'manager', primary = true) {
  must(await adminDb().from('organization_manager_assignments').insert({ organization_unit_id: unitId, user_id: userId, manager_role: role, is_primary: primary, status: 'active' }), '加入主管');
}
export async function profileDepartment(userId: string): Promise<string | null> {
  return (must(await adminDb().from('profiles').select('department').eq('id', userId).single(), '讀取人員資料') as any).department ?? null;
}
export async function setProfileDepartment(userId: string, department: string | null) {
  must(await adminDb().from('profiles').update({ department }).eq('id', userId), '設定人員部門');
}
export async function unitRow(id: string): Promise<any> {
  return must(await adminDb().from('organization_units').select('*').eq('id', id).single(), '讀取單位');
}
export async function activeMemberIds(unitId: string): Promise<string[]> {
  const rows = must(await adminDb().from('organization_memberships').select('user_id').eq('organization_unit_id', unitId).eq('status', 'active').is('effective_to', null), '讀取成員') as any[];
  return rows.map((r) => r.user_id).sort();
}
export async function activeManagerIds(unitId: string): Promise<string[]> {
  const rows = must(await adminDb().from('organization_manager_assignments').select('user_id').eq('organization_unit_id', unitId).eq('status', 'active').is('effective_to', null), '讀取主管') as any[];
  return rows.map((r) => r.user_id).sort();
}

/** 部門職掌：deptA 兩個啟用職掌＋一個停用職掌；deptC 一個啟用職掌。 */
export async function seedWork(tree: OrgTree, p: { u1: string; u2: string }) {
  const db = adminDb();
  const item = async (unit: string, tag: string, status = 'active') =>
    (must(await db.from('work_items').insert({ organization_unit_id: unit, title: orgName(tag), work_type: 'fixed', importance: 'normal', status }).select('id').single(), `職掌 ${tag}`) as { id: string }).id;
  const a1 = await item(tree.deptA, 'work-a1');
  const a2 = await item(tree.deptA, 'work-a2');
  const aOff = await item(tree.deptA, 'work-a-off', 'inactive');
  const c1 = await item(tree.deptC, 'work-c1');
  const rows: Array<{ work_item_id: string; user_id: string; assignment_type: string; status?: string; effective_to?: string | null }> = [
    { work_item_id: a1, user_id: p.u1, assignment_type: 'PRIMARY' },
    { work_item_id: a2, user_id: p.u1, assignment_type: 'PRIMARY' },
    { work_item_id: a1, user_id: p.u1, assignment_type: 'COLLABORATOR' },
    { work_item_id: a2, user_id: p.u1, assignment_type: 'BACKUP', effective_to: '2001-01-01' }, // 已結束，不算
    { work_item_id: aOff, user_id: p.u1, assignment_type: 'PRIMARY' }, // 停用職掌，不算
    { work_item_id: a2, user_id: p.u2, assignment_type: 'BACKUP' },
    { work_item_id: a1, user_id: p.u2, assignment_type: 'COLLABORATOR', status: 'inactive' }, // 指派已停用，不算
    { work_item_id: c1, user_id: p.u1, assignment_type: 'PRIMARY' }, // 別的部門，不算進 deptA
  ];
  must(await db.from('work_assignments').insert(rows.map((r) => ({ status: 'active', effective_from: '2000-01-01', ...r }))), '職掌指派');
  return { a1, a2, aOff, c1 };
}

/** 只刪帶標記的資料：職掌→成員／主管→單位（葉子先刪）。呼叫端也要在刪帳號前呼叫，另外清掉本次帳號寫入的儲存識別紀錄。 */
export async function cleanupM5Org(actorIds: string[] = []) {
  const db = adminDb();
  const units = ((await db.from('organization_units').select('id,parent_id').like('code', `${ORG_CODE_PREFIX}T%`)).data || []) as Array<{ id: string; parent_id: string | null }>;
  const ids = units.map((u) => u.id);
  if (ids.length) {
    const items = ((await db.from('work_items').select('id').in('organization_unit_id', ids)).data || []).map((r: any) => r.id);
    if (items.length) await db.from('work_assignments').delete().in('work_item_id', items);
    if (items.length) await db.from('work_items').delete().in('id', items);
    await db.from('work_categories').delete().in('organization_unit_id', ids);
    await db.from('organization_memberships').delete().in('organization_unit_id', ids);
    await db.from('organization_manager_assignments').delete().in('organization_unit_id', ids);
    let left = ids.slice();
    for (let round = 0; round < 6 && left.length; round += 1) {
      const rows = ((await db.from('organization_units').select('id,parent_id').in('id', left)).data || []) as Array<{ id: string; parent_id: string | null }>;
      const parents = new Set(rows.map((r) => r.parent_id).filter(Boolean));
      const leaves = rows.filter((r) => !parents.has(r.id)).map((r) => r.id);
      if (leaves.length) await db.from('organization_units').delete().in('id', leaves);
      left = rows.filter((r) => parents.has(r.id)).map((r) => r.id);
    }
  }
  if (actorIds.length) {
    await db.from('workspace_organization_requests').delete().in('actor_id', actorIds);
    await db.from('workspace_department_requests').delete().in('actor_id', actorIds);
  }
  const remain = ((await db.from('organization_units').select('id').like('code', `${ORG_CODE_PREFIX}T%`)).data || []) as any[];
  return remain.length;
}

// ---- API 小工具：寫入前先讀最新版本（expected），遇到 409 衝突就重讀再送一次。
export async function orgCatalog(api: APIRequestContext) {
  const res = await api.get('/api/workspace/organization');
  return { status: res.status(), body: res.status() === 200 ? await res.json() : null };
}
export async function orgPost(api: APIRequestContext, operation: string, data: unknown) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const cat = await orgCatalog(api);
    if (cat.status !== 200) throw new Error(`讀取組織失敗 HTTP ${cat.status}`);
    const res = await api.post('/api/workspace/organization', { data: { operation, data, requestId: randomUUID(), expected: cat.body.version } });
    if (res.status() !== 409) return res;
    const text = await res.text();
    if (!text.includes('已被其他操作更新')) return res;
  }
  throw new Error('組織版本連續衝突');
}

// ---- 使用者
export async function createAuthUser(tag: string, opts: { ban?: boolean; profileRole?: string; employeeCode?: string } = {}) {
  const db = adminDb();
  const email = `m5p-test-${tag}@example.test`;
  const password = `${randomUUID()}aA1!`;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `M5P ${tag}` } });
  if (created.error) throw new Error(`建立帳號 ${tag} 失敗：${created.error.message}`);
  const id = created.data.user.id as string;
  must(await db.from('profiles').update({ role: opts.profileRole || 'member', job_title: '測試', department: null, ...(opts.employeeCode ? { employee_code: opts.employeeCode } : {}) }).eq('id', id), `profile ${tag}`);
  if (opts.ban) {
    const b = await db.auth.admin.updateUserById(id, { ban_duration: '24h' });
    if (b.error) throw new Error(`停用帳號失敗：${b.error.message}`);
  }
  return { id, email, password };
}

// ---- 角色
export const TEST_ROLE_DESCRIPTION = 'm5 p06 test role';
/** 建立一般測試角色（代碼 m5p_test_ 開頭，cleanupM5Users 會清除）。 */
export async function createPlainRole(tag: string, over: { name?: string; code?: string } = {}) {
  const row = must(
    await adminDb().from('roles').insert({ name: over.name || `M5P Test ${tag}`, code: over.code || `m5p_test_${tag}`, description: TEST_ROLE_DESCRIPTION, is_system: false, is_active: true }).select('id,code,name').single(),
    `建立角色 ${tag}`,
  ) as { id: string; code: string; name: string };
  return row;
}
/**
 * 建立管理員等級角色（代碼 owner_role，沒有任何權限）。DEV 若已有同代碼角色就回傳 null（測試略過，不動別人的角色）。
 * 刪除只認自己的標記說明。
 */
export async function createAdminLevelRole(): Promise<{ id: string; code: string; name: string } | null> {
  const db = adminDb();
  const existing = (await db.from('roles').select('id,description').eq('code', 'owner_role')).data as any[];
  if (existing?.length) return null;
  const res = await db.from('roles').insert({ name: 'M5P Test owner role', code: 'owner_role', description: TEST_ROLE_DESCRIPTION, is_system: false, is_active: true }).select('id,code,name').single();
  if (res.error) return null;
  return res.data;
}
export async function deleteAdminLevelRole() {
  const db = adminDb();
  const rows = ((await db.from('roles').select('id').eq('code', 'owner_role').eq('description', TEST_ROLE_DESCRIPTION)).data || []) as any[];
  for (const r of rows) {
    await db.from('user_roles').delete().eq('role_id', r.id);
    await db.from('role_permissions').delete().eq('role_id', r.id);
    await db.from('roles').delete().eq('id', r.id);
  }
}
export async function userRoleRows(userId: string, roleId?: string) {
  let q = adminDb().from('user_roles').select('id,role_id,is_active,expires_at').eq('user_id', userId);
  if (roleId) q = q.eq('role_id', roleId);
  return must(await q, '讀取使用者角色') as any[];
}
export async function grantRole(userId: string, roleId: string, over: { is_active?: boolean; expires_at?: string | null } = {}) {
  must(await adminDb().from('user_roles').insert({ user_id: userId, role_id: roleId, is_active: over.is_active ?? true, expires_at: over.expires_at ?? null }), '指派角色');
}
export async function profileRole(userId: string): Promise<string | null> {
  return (must(await adminDb().from('profiles').select('role').eq('id', userId).single(), '讀取 profile') as any).role ?? null;
}

/** 單位名稱互為前綴（A、A1）時，用「後面不能接英數字或 -」比對，避免多筆符合。 */
export const orgNameRe = (tag: string) => new RegExp(`${orgName(tag).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`);
