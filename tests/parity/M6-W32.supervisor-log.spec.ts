import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { adminDb, apiForUser, cleanupM6Supervisor, runIdOrThrow, setupM6Users, slName, testStoreIds, type M6User } from '../support/m6-fixtures';
import { assertNoUnlistedDiffs, ParityRecorder, type Diff } from '../support/parity';
import { addDays, taipeiDate } from '../../lib/supervisor-management-log/workspace-rules';

/**
 * M6 第三批 3b W32 對等：舊 /api/supervisor-management-log/** 與新 /api/workspace/supervisor-management/** 對同一份資料各跑一遍。
 *  - 一致：案件清單（各角色逐筆與順序）、案件詳情、今日工作台（指定日期）、分類與選項（分類、門市）、寫入後資料表內容（案件、紀錄、追蹤）、各角色權限狀態碼；
 *  - 已登記差異：E1（應用層判斷可見範圍，語意為正式區 has_permission）、E2（本人可刪案件、規劃、紀錄與追蹤；舊版只有管理者）、
 *    E3（今日預設日期改台北時間）、結案欄位、含紀錄的案件刪除、關鍵字跳脫、分頁超出、員工選項、AI 確認人。
 * 測試資料：標題 `ZT2038 M6W32 <runId> …`，門市只用 VW001／VW002，只刪自己的。
 */
const recorder = new ParityRecorder('supervisor-log');
const db = adminDb();
const L = '/api/supervisor-management-log';
const N = '/api/workspace/supervisor-management';
const KEYS = ['sl_sup_a', 'sl_sup_b', 'sl_team', 'sl_follow', 'sl_manager', 'sl_viewer', 'sl_creator'];
let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
let sid: Record<string, string>;
const apis: Record<string, APIRequestContext> = {};

test.beforeAll(async () => {
  runIdOrThrow();
  await cleanupM6Supervisor();
  ({ users, teardown } = await setupM6Users(KEYS));
  sid = await testStoreIds();
  apis.admin = await apiAs('admin');
  for (const k of Object.keys(users)) apis[k] = await apiForUser(users[k]);
});
test.afterAll(async () => {
  for (const a of Object.values(apis)) await a.dispose();
  await cleanupM6Supervisor(db, Object.values(users || {}).map((u) => u.id));
  const left = await teardown();
  expect(left, `清除臨時帳號：${left.join('; ')}`).toEqual([]);
});

const rec = (entry: string, title: string, role: string, diffs: Diff[], compared: Record<string, number | string | boolean>, mechanism: 'api-read' | 'write-readback' = 'api-read') => {
  const r = recorder.record({ entry, mechanism, role, title, legacy: { endpoint: `${L}（舊）` }, native: { endpoint: `${N}（新）` }, compared, diffs });
  assertNoUnlistedDiffs(r);
  expect(['pass', 'allowed', 'pending-approval'], `${entry}：${JSON.stringify(r.diffs)}`).toContain(r.status);
  return r;
};
const same = (key: string, l: unknown, n: unknown): Diff[] => (JSON.stringify(l) === JSON.stringify(n) ? [] : [{ kind: 'changed', key, legacy: l, native: n }]);
const status = (key: string, l: number, n: number): Diff[] => (l === n ? [] : [{ kind: 'status', key, legacy: l, native: n }]);
type Res = { status: number; body: any };
const go = async (key: string, method: 'get' | 'post' | 'patch' | 'delete', url: string, data?: unknown): Promise<Res> => {
  const res = await apis[key][method](url, data === undefined ? undefined : method === 'get' ? { params: data as Record<string, string> } : { data });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
};
const caseBody = (tag: string, store: 'VW001' | 'VW002', over: Record<string, unknown> = {}) => ({ title: slName(tag), target_type: 'STORE', store_id: sid[store], target_name_snapshot: `${store} 測試門市`, priority: 'NORMAL', ...over });
const seedCase = async (key: string, tag: string, store: 'VW001' | 'VW002' = 'VW001', over: Record<string, unknown> = {}) => {
  const r = await go(key, 'post', `${N}/cases`, caseBody(tag, store, over));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data.id as string;
};
const recBody = (tag: string, over: Record<string, unknown> = {}) => ({ target_name_snapshot: 'VW001 測試門市', observation: `發現${tag}`, judgment: `判斷${tag}`, action_summary: `動作${tag}`, ...over });
const seedRecord = async (key: string, caseId: string, tag: string, over: Record<string, unknown> = {}) => {
  const r = await go(key, 'post', `${N}/cases/${caseId}/records`, recBody(tag, over));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data.id as string;
};
const reason = { deletion_reason: '對等測試刪除' };
test.beforeEach(() => test.setTimeout(300_000));
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('案件清單：各角色看到的案件、順序、總數與分頁，新舊逐筆相同（E1 三層可見範圍）', async () => {
  const tag = 'LIST';
  const ids: string[] = [];
  for (const [key, store] of [['sl_sup_a', 'VW001'], ['sl_sup_b', 'VW002'], ['sl_manager', 'VW001'], ['sl_sup_a', 'VW002']] as const) {
    ids.push(await seedCase(key, `${tag}-${key}-${store}`, store, key === 'sl_sup_a' && store === 'VW001' ? { assigned_user_id: users.sl_viewer.id, priority: 'HIGH' } : {}));
    await delay(30);
  }
  const diffs: Diff[] = [];
  for (const who of ['sl_sup_a', 'sl_sup_b', 'sl_team', 'sl_follow', 'sl_manager', 'sl_viewer', 'admin']) {
    for (const extra of [{}, ...(['sl_manager', 'admin'].includes(who) ? [{ page: '2', pageSize: '2' }] : []), { status: 'open' }, { storeId: sid.VW002 }, { targetType: 'store', sortBy: 'title', sortOrder: 'asc' }]) {
      const params = { search: slName(tag), pageSize: '100', ...extra };
      const l = await go(who, 'get', `${L}/cases`, params);
      const n = await go(who, 'get', `${N}/cases`, params);
      diffs.push(...status(`${who}:${JSON.stringify(extra)}:status`, l.status, n.status));
      if (l.status === 200 && n.status === 200) {
        const pick = (r: any) => [r.id, r.case_no, r.title, r.status, r.priority, r.owner_user_id, r.assigned_user_id, r.target_name_snapshot, r.store_id, r.next_follow_up_at];
        diffs.push(...same(`${who}:${JSON.stringify(extra)}:items`, l.body.data.map(pick), n.body.data.map(pick)));
        diffs.push(...same(`${who}:${JSON.stringify(extra)}:meta`, l.body.meta, n.body.meta));
      }
    }
  }
  rec('list-cases', '案件清單：各角色、各篩選與分頁，新舊逐筆相同', 'multi', diffs, { roles: 7, combos: 5, cases: ids.length });
});

test('案件詳情：欄位、紀錄、追蹤、事件相同；看不到的案件新舊都 404', async () => {
  const id = await seedCase('sl_sup_a', 'DETAIL', 'VW001');
  const r1 = await seedRecord('sl_sup_a', id, '詳情一', { action_options: ['現場說明'] });
  await go('sl_sup_a', 'post', `${N}/cases/${id}/followups`, { result_status: 'IMPROVING', result_notes: '詳情追蹤' });
  await go('sl_manager', 'delete', `${N}/cases/${id}/records/${r1}`, reason); // 先刪一筆：兩邊都不該再看到
  await seedRecord('sl_sup_a', id, '詳情二');
  const diffs: Diff[] = [];
  const embedDiffs: Diff[] = [];
  for (const who of ['sl_sup_a', 'sl_team', 'sl_manager', 'sl_follow', 'sl_viewer', 'sl_sup_b']) {
    const l = await go(who, 'get', `${L}/cases/${id}`);
    const n = await go(who, 'get', `${N}/cases/${id}`);
    diffs.push(...status(`${who}:status`, l.status, n.status));
    if (l.status !== 200 || n.status !== 200) continue;
    const base = (r: any) => [r.id, r.title, r.status, r.priority, r.owner_user_id, r.target_name_snapshot, r.store_id];
    diffs.push(...same(`${who}:case`, base(l.body.data), base(n.body.data)));
    const embeds = (r: any) => [r.store?.store_code ?? null, r.owner?.full_name ?? null];
    embedDiffs.push(...same(`${who}:embeds`, embeds(l.body.data), embeds(n.body.data)));
    const rr = (r: any) => [r.id, r.record_type, r.record_date, r.observation, r.judgment, r.action_summary, r.action_options, r.requires_follow_up];
    diffs.push(...same(`${who}:records`, l.body.data.records.map(rr), n.body.data.records.map(rr)));
    const ff = (f: any) => [f.id, f.follow_up_date, f.result_status, f.result_notes];
    diffs.push(...same(`${who}:followups`, l.body.data.followups.map(ff), n.body.data.followups.map(ff)));
    const ee = (e: any) => [e.id, e.event_type, e.title, e.body];
    diffs.push(...same(`${who}:events`, l.body.data.events.map(ee), n.body.data.events.map(ee)));
  }
  rec('case-detail', '案件詳情：各角色欄位、紀錄、追蹤、事件相同，看不到的案件都是 404', 'multi', diffs, { roles: 6 });
  rec('case-detail-embeds', '案件詳情的門市與建立者名稱：舊版靠資料表政策，看不到別人的資料時為空白；新版一律顯示', 'multi', embedDiffs, { roles: 6 });
});

test('今日工作台（指定日期）：規劃、追蹤佇列分桶、今日紀錄、摘要，新舊相同；可見範圍同案件規則', async () => {
  const t = taipeiDate(new Date());
  const over = await seedCase('sl_sup_a', 'TD-OVER', 'VW001', { next_follow_up_at: addDays(t, -3) });
  await seedCase('sl_sup_a', 'TD-TODAY', 'VW001', { next_follow_up_at: t });
  await seedCase('sl_sup_b', 'TD-B', 'VW002', { next_follow_up_at: addDays(t, 2) });
  await seedCase('sl_manager', 'TD-FAR', 'VW001', { next_follow_up_at: addDays(t, 9) });
  const closed = await seedCase('sl_sup_a', 'TD-CLOSED', 'VW001', { next_follow_up_at: addDays(t, -1) });
  await go('sl_manager', 'patch', `${N}/cases/${closed}`, { status: 'CANCELLED' });
  await seedRecord('sl_sup_a', over, '今日', { record_date: t });
  await go('sl_sup_a', 'post', `${N}/daily-plans`, { title: slName('TD-PLAN'), target_type: 'STORE', store_id: sid.VW001, target_name_snapshot: 'VW001', plan_date: t, linked_case_id: over });
  await go('sl_sup_b', 'post', `${N}/daily-plans`, { title: slName('TD-PLAN-B'), target_type: 'OTHER', target_name_snapshot: '其他', plan_date: t });
  const diffs: Diff[] = [];
  for (const who of ['sl_sup_a', 'sl_sup_b', 'sl_team', 'sl_follow', 'sl_manager', 'sl_viewer']) {
    const l = await go(who, 'get', `${L}/today`, { date: t });
    const n = await go(who, 'get', `${N}/today`, { date: t });
    diffs.push(...status(`${who}:status`, l.status, n.status));
    if (l.status !== 200 || n.status !== 200) continue;
    const mine = (x: any) => String(x.title ?? x.target_name_snapshot ?? '').startsWith('ZT2038 M6W32') || String(x.case?.title ?? '').startsWith('ZT2038 M6W32');
    const sortIds = (list: any[]) => list.filter(mine).map((x) => x.id).sort();
    diffs.push(...same(`${who}:plans`, sortIds(l.body.data.plans), sortIds(n.body.data.plans)));
    diffs.push(...same(`${who}:queue`, l.body.data.followUpQueue.filter(mine).map((c: any) => [c.id, c.bucket, c.latest_record?.id ?? null]).sort(), n.body.data.followUpQueue.filter(mine).map((c: any) => [c.id, c.bucket, c.latest_record?.id ?? null]).sort()));
    diffs.push(...same(`${who}:records`, sortIds(l.body.data.todayRecords), sortIds(n.body.data.todayRecords)));
    diffs.push(...same(`${who}:date`, l.body.data.date, n.body.data.date));
  }
  rec('today-workspace', '今日工作台：指定日期，規劃、追蹤佇列、今日紀錄各角色相同', 'multi', diffs, { roles: 6 });
  // 預設日期：舊版用 UTC 日期，新版用台北日期（台北 00:00 到 08:00 之間兩者不同）
  const dd: Diff[] = [];
  const l = await go('sl_sup_a', 'get', `${L}/today`);
  const n = await go('sl_sup_a', 'get', `${N}/today`);
  dd.push(...same('default-date', l.body.data.date, n.body.data.date));
  rec('today-default-date', '今日預設日期：舊版 UTC、新版台北時間', 'sl_sup_a', dd, { legacy: l.body.data.date, native: n.body.data.date });
});

test('每日計畫清單與詳情：各角色新舊相同', async () => {
  const t = taipeiDate(new Date());
  const a = await go('sl_sup_a', 'post', `${N}/daily-plans`, { title: slName('PL-A'), target_type: 'STORE', store_id: sid.VW001, target_name_snapshot: 'VW001', plan_date: '2038-04-04' });
  const b = await go('sl_sup_b', 'post', `${N}/daily-plans`, { title: slName('PL-B'), target_type: 'STORE', store_id: sid.VW002, target_name_snapshot: 'VW002', plan_date: '2038-04-04' });
  const c = await go('sl_manager', 'post', `${N}/daily-plans`, { title: slName('PL-M'), target_type: 'OTHER', target_name_snapshot: '其他', plan_date: '2038-04-04', notes: t });
  expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
  const diffs: Diff[] = [];
  for (const who of ['sl_sup_a', 'sl_sup_b', 'sl_team', 'sl_manager', 'sl_viewer', 'admin']) {
    for (const extra of [{}, { status: 'planned' }, { storeId: sid.VW001 }, ...(['sl_manager', 'admin'].includes(who) ? [{ pageSize: '2', page: '2' }] : [])]) {
      const params = { date: '2038-04-04', search: slName('PL-'), pageSize: '100', ...extra };
      const l = await go(who, 'get', `${L}/daily-plans`, params);
      const n = await go(who, 'get', `${N}/daily-plans`, params);
      diffs.push(...status(`${who}:${JSON.stringify(extra)}:status`, l.status, n.status));
      if (l.status === 200 && n.status === 200) {
        const pick = (p: any) => [p.id, p.plan_date, p.title, p.status, p.owner_user_id, p.target_type, p.store_id, p.notes];
        diffs.push(...same(`${who}:${JSON.stringify(extra)}:items`, l.body.data.map(pick), n.body.data.map(pick)));
        diffs.push(...same(`${who}:${JSON.stringify(extra)}:meta`, l.body.meta, n.body.meta));
      }
    }
  }
  for (const [who, id] of [['sl_sup_a', a.body.data.id], ['sl_sup_b', a.body.data.id], ['sl_team', a.body.data.id], ['sl_manager', b.body.data.id]] as const) {
    const l = await go(who, 'get', `${L}/daily-plans/${id}`);
    const n = await go(who, 'get', `${N}/daily-plans/${id}`);
    diffs.push(...status(`${who}:${id}:detail-status`, l.status, n.status));
    if (l.status === 200 && n.status === 200) diffs.push(...same(`${who}:${id}:detail`, [l.body.data.id, l.body.data.title, l.body.data.status], [n.body.data.id, n.body.data.title, n.body.data.status]));
  }
  rec('list-plans', '每日計畫清單與詳情：各角色各篩選新舊相同', 'multi', diffs, { roles: 6 });
});

test('分類與選項：分類、門市相同；員工選項舊版回前 300 筆、新版只在指定門市或搜尋時回傳', async () => {
  const diffs: Diff[] = [];
  const empDiffs: Diff[] = [];
  const storeDiffs: Diff[] = [];
  for (const who of ['sl_sup_a', 'sl_manager', 'sl_viewer']) {
    const lc = await go(who, 'get', `${L}/categories`);
    const nc = await go(who, 'get', `${N}/categories`);
    diffs.push(...status(`${who}:categories-status`, lc.status, nc.status));
    diffs.push(...same(`${who}:categories`, lc.body.data, nc.body.data));
    const lo = await go(who, 'get', `${L}/options`);
    const no = await go(who, 'get', `${N}/options`);
    diffs.push(...status(`${who}:options-status`, lo.status, no.status));
    const s = (b: any) => (b.data.stores as any[]).map((x) => [x.id, x.store_code, x.store_name, x.short_name]).filter((x) => ['VW001', 'VW002', 'ZT01'].includes(x[1] as string));
    storeDiffs.push(...same(`${who}:stores`, s(lo.body), s(no.body)));
    diffs.push(...same(`${who}:option-categories`, lo.body.data.categories, no.body.data.categories));
    empDiffs.push(...same(`${who}:employees-count`, (lo.body.data.employees as any[]).length > 0, (no.body.data.employees as any[]).length > 0));
  }
  rec('options', '選項：分類新舊相同', 'multi', diffs, { roles: 3 });
  rec('options-stores', '門市選項：舊版靠資料表政策（DEV 只有管轄門市），新版管理者全部、其他人只有管轄門市', 'multi', storeDiffs, { roles: 3 });
  rec('options-employees', '員工選項：舊版固定回前 300 筆，新版需指定門市或搜尋', 'multi', empDiffs, { roles: 3 });
});

test('寫入對等：同樣的案件、紀錄、追蹤，新舊寫入後資料表內容相同', async () => {
  const t = taipeiDate(new Date());
  const lc = await go('sl_sup_a', 'post', `${L}/cases`, caseBody('WR-L', 'VW001', { summary: '摘要', next_follow_up_at: addDays(t, 3), priority: 'HIGH' }));
  const nc = await go('sl_sup_a', 'post', `${N}/cases`, caseBody('WR-N', 'VW001', { summary: '摘要', next_follow_up_at: addDays(t, 3), priority: 'HIGH' }));
  expect([lc.status, nc.status]).toEqual([201, 201]);
  const getCase = async (title: string) => (await db.from('supervisor_management_cases').select('*').eq('title', slName(title)).single()).data as any;
  const lrow = await getCase('WR-L');
  const nrow = await getCase('WR-N');
  const cols = (r: any) => [r.target_type, r.store_id, r.target_name_snapshot, r.status, r.priority, r.next_follow_up_at, r.summary, r.owner_user_id, r.created_by, r.updated_by, r.assigned_user_id, r.category_id, r.deleted_at, r.resolved_at, r.closed_at];
  const diffs: Diff[] = same('case-row', cols(lrow), cols(nrow));
  rec('create-case', '建立案件：新舊寫入的資料列相同', 'sl_sup_a', diffs, { columns: 15 }, 'write-readback');

  const rbody = recBody('寫入', { record_date: t, action_options: ['現場說明', '持續追蹤'], requires_follow_up: true, follow_up_date: addDays(t, 2), expected_result: '改善', follow_up_method: 'PHONE', follow_up_owner_id: users.sl_sup_a.id, target_name_snapshot: 'VW001 測試門市', store_id: sid.VW001 });
  const lr = await go('sl_sup_a', 'post', `${L}/cases/${lrow.id}/records`, rbody);
  const nr = await go('sl_sup_a', 'post', `${N}/cases/${nrow.id}/records`, rbody);
  expect([lr.status, nr.status]).toEqual([201, 201]);
  const recRow = async (cid: string) => (await db.from('supervisor_management_records').select('*').eq('case_id', cid).single()).data as any;
  const rc = (r: any) => [r.record_type, r.record_date, r.store_id, r.target_name_snapshot, r.observation, r.judgment, r.action_summary, r.action_options, r.requires_follow_up, r.follow_up_date, r.follow_up_owner_id, r.expected_result, r.follow_up_method, r.ai_generated, r.ai_confirmed_by, r.created_by, r.deleted_at];
  rec('create-record', '新增紀錄：新舊寫入的資料列相同', 'sl_sup_a', same('record-row', rc(await recRow(lrow.id)), rc(await recRow(nrow.id))), { columns: 17 }, 'write-readback');

  const fbody = { follow_up_date: t, result_status: 'IMPROVING', result_notes: '追蹤', next_follow_up_date: addDays(t, 4) };
  const lf = await go('sl_sup_a', 'post', `${L}/cases/${lrow.id}/followups`, fbody);
  const nf = await go('sl_sup_a', 'post', `${N}/cases/${nrow.id}/followups`, fbody);
  expect([lf.status, nf.status]).toEqual([201, 201]);
  const fRow = async (cid: string) => (await db.from('supervisor_management_followups').select('*').eq('case_id', cid).single()).data as any;
  const fc = (r: any) => [r.follow_up_date, r.result_status, r.result_notes, r.next_follow_up_date, r.created_by, r.deleted_at];
  rec('create-followup', '新增追蹤：新舊寫入的資料列相同', 'sl_sup_a', same('followup-row', fc(await fRow(lrow.id)), fc(await fRow(nrow.id))), { columns: 6 }, 'write-readback');

  // 修改案件（一般欄位）
  const patch = { title: slName('WR-PATCH'), priority: 'URGENT', summary: '改摘要', next_follow_up_at: null };
  const lp = await go('sl_sup_a', 'patch', `${L}/cases/${lrow.id}`, { ...patch, title: slName('WR-PATCH-L') });
  const np = await go('sl_sup_a', 'patch', `${N}/cases/${nrow.id}`, { ...patch, title: slName('WR-PATCH-N') });
  expect([lp.status, np.status]).toEqual([200, 200]);
  const pc = (r: any) => [r.priority, r.summary, r.next_follow_up_at, r.status, r.updated_by];
  rec('patch-case', '修改案件：新舊寫入的資料列相同', 'sl_sup_a', same('patch-row', pc((await db.from('supervisor_management_cases').select('*').eq('id', lrow.id).single()).data), pc((await db.from('supervisor_management_cases').select('*').eq('id', nrow.id).single()).data)), { columns: 5 }, 'write-readback');

  // 每日計畫
  const pbody = (n: string) => ({ title: slName(n), target_type: 'STORE', store_id: sid.VW001, target_name_snapshot: 'VW001', plan_date: '2038-05-05', notes: '備註' });
  const lpl = await go('sl_sup_a', 'post', `${L}/daily-plans`, pbody('WR-PL-L'));
  const npl = await go('sl_sup_a', 'post', `${N}/daily-plans`, pbody('WR-PL-N'));
  expect([lpl.status, npl.status]).toEqual([201, 201]);
  const plRow = async (n: string) => (await db.from('supervisor_management_daily_plans').select('*').eq('title', slName(n)).single()).data as any;
  const plc = (r: any) => [r.plan_date, r.target_type, r.store_id, r.target_name_snapshot, r.status, r.notes, r.owner_user_id, r.created_by, r.started_at];
  rec('create-plan', '建立每日計畫：新舊寫入的資料列相同', 'sl_sup_a', same('plan-row', plc(await plRow('WR-PL-L')), plc(await plRow('WR-PL-N'))), { columns: 9 }, 'write-readback');
  for (const who of ['legacy', 'native']) {
    const row = await plRow(who === 'legacy' ? 'WR-PL-L' : 'WR-PL-N');
    const r = await go('sl_sup_a', 'patch', `${who === 'legacy' ? L : N}/daily-plans/${row.id}`, { status: 'IN_PROGRESS', started_at: '2038-05-05T01:00:00.000Z' });
    expect(r.status).toBe(200);
  }
  const prc = (r: any) => [r.status, r.started_at, r.completed_at];
  rec('patch-plan', '修改每日計畫狀態：新舊寫入的資料列相同', 'sl_sup_a', same('plan-status', prc(await plRow('WR-PL-L')), prc(await plRow('WR-PL-N'))), { columns: 3 }, 'write-readback');
});

test('權限狀態碼：各角色、各操作，新舊對照（差異只有已登記的 E2 本人刪除、manage 追蹤與結案欄位）', async () => {
  const ops: { name: string; entry: string; roles: string[] }[] = [
    { name: 'patch-own', entry: 'status-patch-case', roles: ['sl_sup_a', 'sl_creator', 'sl_follow', 'sl_viewer', 'sl_team', 'sl_manager', 'sl_sup_b'] },
    { name: 'post-record', entry: 'status-post-record', roles: ['sl_sup_a', 'sl_creator', 'sl_follow', 'sl_viewer', 'sl_team', 'sl_manager', 'sl_sup_b'] },
    { name: 'post-followup', entry: 'status-post-followup', roles: ['sl_sup_a', 'sl_creator', 'sl_follow', 'sl_viewer', 'sl_team', 'sl_manager', 'sl_sup_b'] },
    { name: 'delete-case', entry: 'status-delete-case', roles: ['sl_sup_a', 'sl_follow', 'sl_viewer', 'sl_team', 'sl_manager', 'sl_sup_b'] },
    { name: 'create-case', entry: 'status-create-case', roles: ['sl_sup_a', 'sl_creator', 'sl_follow', 'sl_viewer', 'sl_team', 'sl_manager'] },
    { name: 'create-plan', entry: 'status-create-plan', roles: ['sl_sup_a', 'sl_creator', 'sl_follow', 'sl_viewer', 'sl_team', 'sl_manager'] },
    { name: 'delete-plan', entry: 'status-delete-plan', roles: ['sl_sup_a', 'sl_follow', 'sl_viewer', 'sl_manager'] },
  ];
  for (const op of ops) {
    const diffs: Diff[] = [];
    for (const who of op.roles) {
      const base = `PERM-${op.name}-${who}`;
      let ls: number;
      let ns: number;
      if (op.name === 'create-case') {
        ls = (await go(who, 'post', `${L}/cases`, caseBody(`${base}-L`, 'VW001'))).status;
        ns = (await go(who, 'post', `${N}/cases`, caseBody(`${base}-N`, 'VW001'))).status;
      } else if (op.name === 'create-plan') {
        const b = (s: string) => ({ title: slName(`${base}-${s}`), target_type: 'OTHER', target_name_snapshot: '其他' });
        ls = (await go(who, 'post', `${L}/daily-plans`, b('L'))).status;
        ns = (await go(who, 'post', `${N}/daily-plans`, b('N'))).status;
      } else if (op.name === 'delete-plan') {
        const lp = await go('sl_sup_a', 'post', `${N}/daily-plans`, { title: slName(`${base}-L`), target_type: 'OTHER', target_name_snapshot: '其他' });
        const np = await go('sl_sup_a', 'post', `${N}/daily-plans`, { title: slName(`${base}-N`), target_type: 'OTHER', target_name_snapshot: '其他' });
        ls = (await go(who, 'delete', `${L}/daily-plans/${lp.body.data.id}`, reason)).status;
        ns = (await go(who, 'delete', `${N}/daily-plans/${np.body.data.id}`, reason)).status;
      } else {
        // 兩份相同的案件（督導 A 建立、指派給 sl_viewer）：一份給舊版、一份給新版
        const lcid = await seedCase('sl_sup_a', `${base}-L`, 'VW001', { assigned_user_id: users.sl_viewer.id });
        const ncid = await seedCase('sl_sup_a', `${base}-N`, 'VW001', { assigned_user_id: users.sl_viewer.id });
        const fu = { result_status: 'IMPROVING', result_notes: '權限追蹤' };
        const run = async (root: string, id: string) => {
          if (op.name === 'patch-own') return (await go(who, 'patch', `${root}/cases/${id}`, { priority: 'HIGH' })).status;
          if (op.name === 'post-record') return (await go(who, 'post', `${root}/cases/${id}/records`, recBody('權限'))).status;
          if (op.name === 'post-followup') return (await go(who, 'post', `${root}/cases/${id}/followups`, fu)).status;
          return (await go(who, 'delete', `${root}/cases/${id}`, reason)).status;
        };
        ls = await run(L, lcid);
        ns = await run(N, ncid);
      }
      diffs.push(...status(`${who}`, ls, ns));
    }
    rec(op.entry, `${op.name}：各角色狀態碼，新舊對照`, 'multi', diffs, { roles: op.roles.length });
  }
});

test('結案：舊版把狀態改成已改善或已結案會被資料庫限制擋下，新版寫入 resolved_at／closed_at', async () => {
  const lid = await seedCase('sl_sup_a', 'CLOSE-L');
  const nid = await seedCase('sl_sup_a', 'CLOSE-N');
  const l = await go('sl_sup_a', 'patch', `${L}/cases/${lid}`, { status: 'CLOSED' });
  const n = await go('sl_sup_a', 'patch', `${N}/cases/${nid}`, { status: 'CLOSED' });
  const lrow = (await db.from('supervisor_management_cases').select('status').eq('id', lid).single()).data as any;
  const nrow = (await db.from('supervisor_management_cases').select('status').eq('id', nid).single()).data as any;
  rec('close-case', '結案：舊版失敗（狀態維持），新版成功', 'sl_sup_a', [...status('status', l.status, n.status), ...same('row-status', lrow.status, nrow.status)], { legacy: l.status, native: n.status });
});

test('刪除含紀錄與追蹤的案件：管理者新舊對照', async () => {
  const lid = await seedCase('sl_sup_a', 'DELREC-L');
  const nid = await seedCase('sl_sup_a', 'DELREC-N');
  for (const id of [lid, nid]) {
    await seedRecord('sl_sup_a', id, '刪案紀錄');
    await go('sl_sup_a', 'post', `${N}/cases/${id}/followups`, { result_status: 'IMPROVING', result_notes: '刪案追蹤' });
  }
  const l = await go('sl_manager', 'delete', `${L}/cases/${lid}`, reason);
  const n = await go('sl_manager', 'delete', `${N}/cases/${nid}`, reason);
  const state = async (id: string) => {
    const c = (await db.from('supervisor_management_cases').select('deleted_at').eq('id', id).single()).data as any;
    const r = ((await db.from('supervisor_management_records').select('deleted_at').eq('case_id', id)).data || []) as any[];
    return [!!c.deleted_at, r.map((x) => !!x.deleted_at)];
  };
  rec('delete-case-with-records', '刪除含紀錄的案件：舊版先軟刪案件，之後紀錄觸發器拒絕', 'sl_manager', [...status('status', l.status, n.status), ...same('state', await state(lid), await state(nid))], { legacy: l.status, native: n.status });
});

test('搜尋特殊字元、分頁超出：舊版組字串（逗號會改寫條件）與超出頁回錯誤，新版跳脫與回最後一頁', async () => {
  await seedCase('sl_sup_a', 'SRCH,(x)%_', 'VW001');
  const keyword = `${slName('SRCH')},(x)`;
  const l = await go('sl_sup_a', 'get', `${L}/cases`, { search: keyword });
  const n = await go('sl_sup_a', 'get', `${N}/cases`, { search: keyword });
  rec('search-special-chars', '搜尋含逗號與括號：新舊結果數', 'sl_sup_a', [...status('status', l.status, n.status), ...same('count', (l.body.data || []).length, (n.body.data || []).length)], { legacy: l.status, native: n.status });
  const lb = await go('sl_manager', 'get', `${L}/cases`, { page: '9999', pageSize: '5' });
  const nb = await go('sl_manager', 'get', `${N}/cases`, { page: '9999', pageSize: '5' });
  rec('pagination-beyond', '頁碼超出總頁數：舊版回錯誤，新版回最後一頁', 'sl_manager', status('status', lb.status, nb.status), { legacy: lb.status, native: nb.status });
});

test('AI 確認人：舊版接受前端指定任意確認人，新版一律記錄登入者（人工確認）', async () => {
  const lid = await seedCase('sl_sup_a', 'AI-L');
  const nid = await seedCase('sl_sup_a', 'AI-N');
  const body = recBody('AI', { ai_generated: true, ai_confirmed_by: users.sl_sup_b.id });
  expect((await go('sl_sup_a', 'post', `${L}/cases/${lid}/records`, body)).status).toBe(201);
  expect((await go('sl_sup_a', 'post', `${N}/cases/${nid}/records`, body)).status).toBe(201);
  const confirmed = async (id: string) => (await db.from('supervisor_management_records').select('ai_confirmed_by').eq('case_id', id).single()).data.ai_confirmed_by;
  rec('record-ai-confirmed', 'AI 草稿的確認人', 'sl_sup_a', same('ai_confirmed_by', await confirmed(lid), await confirmed(nid)), { legacy: String(await confirmed(lid)), native: String(await confirmed(nid)) }, 'write-readback');
});

test('權限語意：角色停用（roles.is_active=false）時，舊版讀取靠資料表政策變空，新版仍可讀取', async () => {
  const id = await seedCase('sl_sup_a', 'SEM');
  const roleRow = (await db.from('roles').select('id').eq('code', 'm6_test_sl_sup_a').single()).data;
  expect((await db.from('roles').update({ is_active: false }).eq('id', roleRow.id)).error).toBeNull();
  try {
    const l = await go('sl_sup_a', 'get', `${L}/cases`, { search: slName('SEM') });
    const n = await go('sl_sup_a', 'get', `${N}/cases`, { search: slName('SEM') });
    rec('permission-semantics', '角色停用時的可見範圍：舊版 RLS 檢查 roles.is_active，新版不檢查', 'sl_sup_a', [...status('status', l.status, n.status), ...same('visible', (l.body.data || []).map((r: any) => r.id).includes(id), (n.body.data || []).map((r: any) => r.id).includes(id))], { legacy: l.status, native: n.status });
  } finally {
    await db.from('roles').update({ is_active: true }).eq('id', roleRow.id);
  }
});
