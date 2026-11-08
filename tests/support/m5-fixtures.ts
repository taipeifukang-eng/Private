import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { apiForUser, type CvUser } from './cv01-fixtures';

/**
 * M5（W19 活動排程、P05 活動列表／特殊日期／活動設定）測試共用工具。
 * 規則：只用 DEV、只用 VW/ZT 測試門市；活動名稱與特殊日期說明都帶「[自動測試]M5 <runId>」標記，
 * 特殊日期一律在保留年度 2099。測試只刪「自己建立（帶標記）」的列；sweeper 以同一標記作後備清除（sweep-targets.cjs）。
 * 帳號與角色以 m5p-test-* / m5p_test_* 標記建立，teardown 與下次 setup 開頭依標記清除；密碼隨機、只存在記憶體。
 */
const nodeRequire = createRequire(path.join(__dirname, 'm5-fixtures.ts'));
const ROOT = path.resolve(__dirname, '..', '..');
const { RUN_ID_RE } = nodeRequire('./registry.cjs') as { RUN_ID_RE: RegExp };

export { apiForUser };
export type M5User = CvUser;
export const M5_EMAIL_PREFIX = 'm5p-test-';
export const M5_ROLE_PREFIX = 'm5p_test_';
export const PAGE_PERM = 'monthly.status.view_own';

export function runIdOrThrow(): string {
  const runId = process.env.TEST_RUN_ID || '';
  if (!RUN_ID_RE.test(runId)) throw new Error('必須由 run-all 啟動（需要 TEST_RUN_ID）');
  return runId;
}
export const m5Prefix = () => `[自動測試]M5 ${runIdOrThrow()}`;
export const m5Name = (tag: string) => `${m5Prefix()} ${tag}`;

export function adminDb(): any {
  const guard = nodeRequire('./env-guard.cjs') as { assertDevEnvironment: (o: { root: string }) => { env: Record<string, string> } };
  const { env } = guard.assertDevEnvironment({ root: ROOT });
  const { createClient } = nodeRequire('@supabase/supabase-js') as { createClient: (u: string, k: string, o: unknown) => any };
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}
function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what} 失敗：${res.error.message}`);
  return res.data;
}

const TEST_STORES = ['VW001', 'VW002', 'ZT01', 'ZT02', 'ZT03', 'ZT04', 'ZT05'];
export async function stores(): Promise<Record<string, { id: string; name: string }>> {
  const rows = must(await adminDb().from('stores').select('id,store_code,store_name').in('store_code', TEST_STORES), '讀取測試門市') as any[];
  const out: Record<string, { id: string; name: string }> = {};
  for (const r of rows) out[r.store_code] = { id: r.id, name: r.store_name };
  for (const c of TEST_STORES) if (!out[c]) throw new Error(`DEV 缺少測試門市 ${c}`);
  return out;
}

// ------------------------------------------------------------------ 活動資料
export type SeedCampaign = {
  tag: string;
  start: string;
  end: string;
  type?: 'promotion' | 'inventory';
  active?: boolean;
  publish?: { sup?: boolean; sm?: boolean; inv?: boolean };
};
export async function seedCampaign(c: SeedCampaign): Promise<{ id: string; name: string; version: number }> {
  const row = must(
    await adminDb()
      .from('campaigns')
      .insert({
        name: m5Name(c.tag),
        start_date: c.start,
        end_date: c.end,
        campaign_type: c.type || 'promotion',
        is_active: c.active !== false,
        published_to_supervisors: !!c.publish?.sup,
        published_to_store_managers: !!c.publish?.sm,
        published_to_inventory_team: !!c.publish?.inv,
      })
      .select('id,name,workspace_version')
      .single(),
    `建立活動 ${c.tag}`,
  ) as any;
  return { id: row.id, name: row.name, version: row.workspace_version };
}
export async function seedSchedules(campaignId: string, rows: [string, string][]) {
  const s = await stores();
  must(await adminDb().from('campaign_schedules').insert(rows.map(([code, date]) => ({ campaign_id: campaignId, store_id: s[code].id, activity_date: date }))), '排程');
}
export async function scheduleRows(campaignId: string): Promise<Record<string, string>> {
  const s = await stores();
  const byId: Record<string, string> = {};
  for (const [code, v] of Object.entries(s)) byId[v.id] = code;
  const rows = must(await adminDb().from('campaign_schedules').select('store_id,activity_date').eq('campaign_id', campaignId), '讀取排程') as any[];
  return Object.fromEntries(rows.map((r) => [byId[r.store_id] || r.store_id, String(r.activity_date).slice(0, 10)]));
}
/** 給刪除筆數測試用：每張子表各放固定筆數。 */
export async function seedChildren(campaignId: string) {
  const db = adminDb();
  const s = await stores();
  must(await db.from('campaign_schedules').insert([{ campaign_id: campaignId, store_id: s.VW001.id, activity_date: '2099-05-06' }, { campaign_id: campaignId, store_id: s.ZT01.id, activity_date: '2099-05-09' }]), '排程');
  must(await db.from('campaign_store_details').insert([{ campaign_id: campaignId, store_id: s.VW001.id, notes: 'm5' }]), '門市細節');
  must(await db.from('campaign_store_headcount').insert([{ campaign_id: campaignId, store_id: s.VW001.id, extra_support_count: 0, supervisor_count: 0 }]), '人力');
  must(await db.from('campaign_store_own_staff').insert([{ campaign_id: campaignId, store_id: s.VW001.id, employee_code: 'M5P001', employee_name: 'm5', sort_order: 0 }, { campaign_id: campaignId, store_id: s.VW001.id, employee_code: 'M5P002', employee_name: 'm5', sort_order: 1 }]), '自有人員');
  const items = must(await db.from('campaign_checklist_items').insert([{ campaign_id: campaignId, task_name: 'M5 item 1', item_order: 1 }, { campaign_id: campaignId, task_name: 'M5 item 2', item_order: 2 }]).select('id'), '檢核項目') as any[];
  must(await db.from('campaign_checklist_completions').insert([{ checklist_item_id: items[0].id, store_id: s.VW001.id, is_completed: true }, { checklist_item_id: items[0].id, store_id: s.ZT01.id, is_completed: false }, { checklist_item_id: items[1].id, store_id: s.VW001.id, is_completed: false }]), '勾選紀錄');
  must(await db.from('campaign_equipment_trips').insert([{ campaign_id: campaignId, set_number: 1, trip_date: '2099-05-06', from_location: 'a', to_location: 'b' }]), '設備車次');
  must(await db.from('campaign_support_requests').insert([{ campaign_id: campaignId, requesting_store_id: s.VW001.id, supporting_store_id: s.ZT02.id, requested_count: 1 }]), '支援需求');
  return { schedules: 2, details: 1, headcount: 1, ownStaff: 2, checklist: 2, completions: 3, trips: 1, requests: 1, supportStaff: 0, departments: 0 };
}
export async function readDepartmentImageNames(campaignId: string): Promise<string[]> {
  const r = must(await adminDb().from('campaign_department_publish').select('marketing_image_names').eq('campaign_id', campaignId).maybeSingle(), '讀取行銷圖片') as any;
  const v = r?.marketing_image_names;
  return Array.isArray(v) ? v : v ? JSON.parse(v) : [];
}
export async function campaignRow(id: string): Promise<any | null> {
  return must(await adminDb().from('campaigns').select('*').eq('id', id).maybeSingle(), '讀取活動');
}
export async function countRows(table: string, campaignId: string): Promise<number> {
  const r = await adminDb().from(table).select('id', { count: 'exact', head: true }).eq('campaign_id', campaignId);
  if (r.error) throw new Error(`計數 ${table} 失敗：${r.error.message}`);
  return r.count || 0;
}

// 特殊日期：只用保留年度 2099 的日期，說明帶標記。
export async function seedEvent(date: string, e: { type?: string; blocked?: boolean; tag?: string } = {}): Promise<string> {
  if (!date.startsWith('2099-')) throw new Error('特殊日期測試只能用 2099 年');
  const row = must(
    await adminDb().from('event_dates').upsert({ event_date: date, description: m5Name(e.tag || 'event'), event_type: e.type || 'holiday', is_blocked: e.blocked !== false }, { onConflict: 'event_date' }).select('id').single(),
    '特殊日期',
  ) as any;
  return row.id;
}
export async function eventOn(date: string): Promise<any | null> {
  return must(await adminDb().from('event_dates').select('*').eq('event_date', date).maybeSingle(), '讀取特殊日期');
}

/**
 * W20 活動檢視用：已發布給督導、店長、盤點組的活動，排程 VW001／ZT01／ZT02，一個前置工作項目，三筆支援需求（VW001←ZT02、ZT01←ZT03、ZT02←VW001）。
 * 全部帶 m5Name 標記，由 deleteRunData 依標記清除。
 */
export async function seedW20Campaign(tag: string, over: Partial<SeedCampaign> = {}) {
  const db = adminDb();
  const s = await stores();
  const c = await seedCampaign({ tag, start: '2099-05-01', end: '2099-05-31', publish: { sup: true, sm: true, inv: true }, ...over });
  await seedSchedules(c.id, [['VW001', '2099-05-06'], ['ZT01', '2099-05-09'], ['ZT02', '2099-05-10']]);
  const item = must(await db.from('campaign_checklist_items').insert({ campaign_id: c.id, task_name: 'W20 前置項目', item_order: 1 }).select('id').single(), '檢核項目') as any;
  const reqs = must(
    await db.from('campaign_support_requests').insert([
      { campaign_id: c.id, requesting_store_id: s.VW001.id, supporting_store_id: s.ZT02.id, requested_count: 2 },
      { campaign_id: c.id, requesting_store_id: s.ZT01.id, supporting_store_id: s.ZT03.id, requested_count: 1 },
      { campaign_id: c.id, requesting_store_id: s.ZT02.id, supporting_store_id: s.VW001.id, requested_count: 1 },
    ]).select('id,requesting_store_id'),
    '支援需求',
  ) as any[];
  const reqOf = (code: string) => reqs.find((r) => r.requesting_store_id === s[code].id).id as string;
  // requestVW001：VW001 請求支援；requestZT01：ZT01 請求支援；requestFromVW001：ZT02 請求、由 VW001 出人（舊版「支援請求」視窗列的就是這種）。
  return { ...c, itemId: item.id as string, requestVW001: reqOf('VW001'), requestZT01: reqOf('ZT01'), requestFromVW001: reqOf('ZT02'), stores: s };
}

/** 刪除本次 run 建立的活動（子表 cascade）與特殊日期。只依標記刪，不用日期大量刪除。 */
export async function deleteRunData() {
  const db = adminDb();
  const prefix = `${m5Prefix()}%`;
  // 行銷圖片：先把本次活動上傳到儲存空間的檔案刪掉（資料庫列隨活動 cascade 刪除，儲存檔不會）。
  const mine = ((await db.from('campaigns').select('id').like('name', prefix)).data || []).map((r: any) => r.id);
  if (mine.length) {
    const pubs = ((await db.from('campaign_department_publish').select('marketing_image_paths').in('campaign_id', mine)).data || []) as any[];
    const paths = pubs.flatMap((r) => (Array.isArray(r.marketing_image_paths) ? r.marketing_image_paths : []));
    if (paths.length) await db.storage.from('campaign-department-assets').remove(paths);
  }
  const c = await db.from('campaigns').delete().like('name', prefix);
  if (c.error) throw new Error(`清除活動失敗：${c.error.message}`);
  const e = await db.from('event_dates').delete().like('description', prefix);
  if (e.error) throw new Error(`清除特殊日期失敗：${e.error.message}`);
}

/** 門市活動設定（store_activity_settings）：記下原內容，結束時還原（原本沒有就刪除）。 */
export async function withStoreSetting<T>(code: string, setting: { allowed_days: number[]; forbidden_days: number[] } | null, fn: (storeId: string) => Promise<T>): Promise<T> {
  const db = adminDb();
  const s = await stores();
  const id = s[code].id;
  const before = must(await db.from('store_activity_settings').select('*').eq('store_id', id).maybeSingle(), '讀取門市設定') as any;
  try {
    if (setting) must(await db.from('store_activity_settings').upsert({ store_id: id, allowed_days: setting.allowed_days, forbidden_days: setting.forbidden_days, notes: '' }, { onConflict: 'store_id' }), '寫入門市設定');
    return await fn(id);
  } finally {
    if (before) await db.from('store_activity_settings').upsert(before, { onConflict: 'store_id' });
    else await db.from('store_activity_settings').delete().eq('store_id', id);
  }
}

// ------------------------------------------------------------------ 帳號（Q1、Q2 權限矩陣）
export type M5Scenario = { desc: string; perms: string[]; profileRole: 'member' | 'manager' | 'admin'; appts: [string, 'store_manager' | 'supervisor' | 'area_manager'][] };
export const P = {
  edit: 'activity.campaign.edit',
  manage: 'activity.manage',
  viewAll: 'activity.campaign.view_all',
  viewOwn: 'activity.campaign.view_own',
  storeDetail: 'activity.store_detail.edit',
  supportAssign: 'activity.support_assign.edit',
  overview: 'activity.staff_overview.view',
  checklistEdit: 'activity.checklist.edit',
} as const;
export const M5_SCENARIOS: Record<string, M5Scenario> = {
  // Q1：持活動編輯權、舊式身分是一般成員（營業助理類）。舊版寫入被擋、新版放行。
  editor_member: { desc: '有活動編輯權（另有檢視全部，與正式區營業助理角色相同）、舊式身分一般成員', perms: [P.edit, P.viewAll], profileRole: 'member', appts: [['VW001', 'area_manager']] },
  // Q1：舊式身分是經理、角色只有檢視全部。舊版寫入放行、新版擋下。
  manager_viewer: { desc: '舊式身分經理、角色只有檢視全部', perms: [P.viewAll], profileRole: 'manager', appts: [['VW001', 'area_manager']] },
  // 一般檢視端：只有檢視全部。
  viewer: { desc: '只有檢視全部', perms: [P.viewAll], profileRole: 'member', appts: [['VW001', 'area_manager']] },
  // 店長：被任命 VW001，只有檢視自己的。
  store_manager: { desc: '店長（VW001）只有檢視自己的', perms: [P.viewOwn], profileRole: 'member', appts: [['VW001', 'store_manager']] },
  // 督導：被任命 ZT01 督導。
  supervisor: { desc: '督導（ZT01）只有檢視自己的', perms: [P.viewOwn], profileRole: 'member', appts: [['ZT01', 'supervisor']] },
  // 只有門市細節編輯權（排程入口要出現，活動新增不行）。
  store_detail: { desc: '門市細節編輯權（另有檢視全部）', perms: [P.storeDetail, P.viewAll], profileRole: 'member', appts: [['VW001', 'area_manager']] },
  // W20（Q6、Q7）：店長／督導在活動檢視的填報與按鈕範圍。
  w20_mgr_support: { desc: '店長（VW001）：檢視自己的＋支援指派', perms: [P.viewOwn, P.supportAssign], profileRole: 'member', appts: [['VW001', 'store_manager']] },
  w20_mgr_overview: { desc: '店長（VW001）：檢視自己的＋人力查看', perms: [P.viewOwn, P.overview], profileRole: 'member', appts: [['VW001', 'store_manager']] },
  w20_mgr_full: { desc: '店長（VW001）：檢視自己的＋支援指派＋人力查看＋門市細節編輯', perms: [P.viewOwn, P.supportAssign, P.overview, P.storeDetail], profileRole: 'member', appts: [['VW001', 'store_manager']] },
  w20_sup_full: { desc: '督導（ZT01）：檢視自己的＋支援指派＋人力查看＋門市細節編輯', perms: [P.viewOwn, P.supportAssign, P.overview, P.storeDetail], profileRole: 'member', appts: [['ZT01', 'supervisor']] },
  // W21（Q9）：部門管理頁進入條件與資料讀取的權限組合。appts 為空陣列（不需要門市任命）。
  org_view: { desc: '只有公司組織檢視', perms: ['organization.organization.view'], profileRole: 'member', appts: [] },
  org_member_view: { desc: '只有成員檢視', perms: ['organization.member.view'], profileRole: 'member', appts: [] },
  org_manager_view: { desc: '只有主管檢視', perms: ['organization.manager.view'], profileRole: 'member', appts: [] },
  dept_view: { desc: '只有部門檢視', perms: ['organization.department.view'], profileRole: 'member', appts: [] },
  dept_ws_view: { desc: '只有部門工作檢視', perms: ['organization.department_workspace.view'], profileRole: 'member', appts: [] },
  dept_ws_manage: { desc: '只有部門工作管理', perms: ['organization.department_workspace.manage'], profileRole: 'member', appts: [] },
  dept_member_manage: { desc: '只有成員管理', perms: ['organization.member.manage'], profileRole: 'member', appts: [] },
  org_full: {
    desc: '組織與部門全部權限',
    perms: ['organization.organization.view', 'organization.department.view', 'organization.department.create', 'organization.department.edit', 'organization.member.view', 'organization.member.manage', 'organization.manager.view', 'organization.manager.manage', 'organization.department_workspace.view', 'organization.department_workspace.manage'],
    profileRole: 'member',
    appts: [],
  },
  // W23／W24：年度行事曆的三個獨立權限與 Google 管理（appts 為空；PAGE_PERM 會另外加入，所以不是「待開通」帳號）。
  cal_plain: { desc: '沒有任何行事曆權限（一般同仁）', perms: [], profileRole: 'member', appts: [] },
  cal_creator: { desc: '只能新增公司行事', perms: ['organization.calendar.company.create'], profileRole: 'member', appts: [] },
  cal_editor: { desc: '可修改或取消公司行事（另可新增）', perms: ['organization.calendar.company.create', 'organization.calendar.company.edit'], profileRole: 'member', appts: [] },
  cal_holiday: { desc: '只能維護政府假日', perms: ['organization.calendar.holiday.manage'], profileRole: 'member', appts: [] },
  cal_google: { desc: '只能管理 Google 同步', perms: ['organization.calendar.google.manage'], profileRole: 'member', appts: [] },
  cal_all: { desc: '四個行事曆權限都有', perms: ['organization.calendar.company.create', 'organization.calendar.company.edit', 'organization.calendar.holiday.manage', 'organization.calendar.google.manage'], profileRole: 'member', appts: [] },
  // 舊式身分是管理員、但角色沒有被授予任何行事曆權限（資料庫規則：管理員也不能編）。
  cal_admin_ungranted: { desc: '舊式身分管理員，沒有被授予行事曆權限', perms: [], profileRole: 'admin', appts: [] },
  // P06：使用者管理與角色管理。
  user_viewer: { desc: '只能查看使用者', perms: ['user.user.view'], profileRole: 'member', appts: [] },
  user_editor: { desc: '使用者查看／編輯／變更角色／建立／刪除，舊式身分一般成員', perms: ['user.user.view', 'user.user.edit', 'user.user.change_role', 'user.user.create', 'user.user.delete'], profileRole: 'member', appts: [] },
  user_admin: { desc: '舊式身分管理員，使用者查看／變更角色', perms: ['user.user.view', 'user.user.change_role'], profileRole: 'admin', appts: [] },
  role_viewer: { desc: '只能查看角色', perms: ['role.role.view', 'role.permission.view', 'role.user_role.view'], profileRole: 'member', appts: [] },
  role_assigner: { desc: '角色查看＋指派／移除使用者', perms: ['role.role.view', 'role.permission.view', 'role.user_role.view', 'role.user_role.assign', 'role.user_role.revoke'], profileRole: 'member', appts: [] },
};

export async function cleanupM5Users(db: any = adminDb()): Promise<string[]> {
  const log: string[] = [];
  const { data: profs } = await db.from('profiles').select('id').like('email', `${M5_EMAIL_PREFIX}%@example.test`);
  const uids = (profs || []).map((p: { id: string }) => p.id);
  if (uids.length) {
    await db.from('store_managers').delete().in('user_id', uids);
    await db.from('user_roles').delete().in('user_id', uids);
  }
  const { data: roles } = await db.from('roles').select('id').like('code', `${M5_ROLE_PREFIX}%`);
  const roleIds = (roles || []).map((r: { id: string }) => r.id);
  if (roleIds.length) {
    await db.from('user_roles').delete().in('role_id', roleIds);
    await db.from('role_permissions').delete().in('role_id', roleIds);
    const r = await db.from('roles').delete().in('id', roleIds);
    if (r.error) log.push(`roles: ${r.error.message}`);
  }
  for (let page = 1; ; page += 1) {
    const r = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (r.error) {
      log.push(`listUsers: ${r.error.message}`);
      break;
    }
    const users = r.data.users || [];
    for (const u of users) {
      if (u.email && u.email.startsWith(M5_EMAIL_PREFIX) && u.email.endsWith('@example.test')) {
        const d = await db.auth.admin.deleteUser(u.id);
        if (d.error) log.push(`deleteUser: ${d.error.message}`);
      }
    }
    if (users.length < 200) break;
  }
  return log;
}

export async function setupM5Users(keys: string[] = Object.keys(M5_SCENARIOS)): Promise<{ users: Record<string, M5User>; teardown: () => Promise<string[]> }> {
  runIdOrThrow();
  const db = adminDb();
  const left = await cleanupM5Users(db);
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const s = await stores();
  const codes = Array.from(new Set([...keys.flatMap((k) => M5_SCENARIOS[k].perms), PAGE_PERM]));
  const permIds: Record<string, string> = {};
  for (const p of must(await db.from('permissions').select('id,code').in('code', codes), '讀取 permissions') as any[]) permIds[p.code] = p.id;
  for (const c of codes) if (!permIds[c]) throw new Error(`DEV 缺少權限 ${c}`);
  const users: Record<string, M5User> = {};
  for (const key of keys) {
    const sc = M5_SCENARIOS[key];
    const role = must(await db.from('roles').insert({ name: `M5P Test ${key}`, code: `${M5_ROLE_PREFIX}${key}`, description: 'm5 campaign test role', is_system: false, is_active: true }).select('id').single(), `建立角色 ${key}`) as { id: string };
    must(await db.from('role_permissions').insert([...sc.perms, PAGE_PERM].map((c) => ({ role_id: role.id, permission_id: permIds[c], is_allowed: true }))), `角色權限 ${key}`);
    const email = `${M5_EMAIL_PREFIX}${key.replace(/_/g, '-')}@example.test`;
    const password = `${crypto.randomBytes(18).toString('base64url')}aA1!`;
    const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `M5P ${key}` } });
    if (created.error) throw new Error(`建立帳號 ${key} 失敗：${created.error.message}`);
    const uid = created.data.user.id as string;
    users[key] = { key, id: uid, email, password };
    must(await db.from('profiles').update({ role: sc.profileRole, job_title: '測試', department: null }).eq('id', uid), `profile ${key}`);
    must(await db.from('user_roles').insert({ user_id: uid, role_id: role.id, is_active: true }), `user_roles ${key}`);
    if (sc.appts.length) must(await db.from('store_managers').insert(sc.appts.map(([code, type], i) => ({ user_id: uid, store_id: s[code].id, role_type: type, is_primary: i === 0 }))), `store_managers ${key}`);
  }
  return { users, teardown: () => cleanupM5Users(db) };
}
