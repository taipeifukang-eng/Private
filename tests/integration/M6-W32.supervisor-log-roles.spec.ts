import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { adminDb, apiForUser, cleanupM6Supervisor, runIdOrThrow, setupM6Users, slCategoryCode, slName, testStoreIds, userDb, type M6User } from '../support/m6-fixtures';
import { addDays, caseVisible, taipeiDate, type Viewer } from '../../lib/supervisor-management-log/workspace-rules';

/**
 * M6 第三批 3b W32：督導管理日誌 workspace API 的角色、權限與規則（正式區 has_permission 語意）。
 * 帳號（臨時 m6-test-sl-*）：sl_sup_a（督導 A，建立／改自己／追蹤，管轄 VW001）、sl_sup_b（督導 B，管轄 VW002）、sl_team（只有看團隊，VW001）、
 *   sl_follow（看自己加追蹤，管轄 VW001）、sl_manager（只有管理）、sl_viewer（只有看自己）、sl_creator（只有建立）、sl_none（無權限）；另用 admin（應用層後備）。
 * 資料：標題 `ZT2038 M6W32 <runId> …`，只刪自己的；門市只用 VW001／VW002。
 */
const API = '/api/workspace/supervisor-management';
const db = adminDb();
const KEYS = ['sl_sup_a', 'sl_sup_b', 'sl_team', 'sl_follow', 'sl_manager', 'sl_viewer', 'sl_creator', 'sl_none'];
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

const caseBody = (tag: string, store: 'VW001' | 'VW002', over: Record<string, unknown> = {}) => ({
  title: slName(tag), target_type: 'STORE', store_id: sid[store], target_name_snapshot: `${store} 測試門市`, priority: 'NORMAL', ...over,
});
const call = async (key: string, method: 'get' | 'post' | 'patch' | 'delete', path: string, data?: unknown) => {
  const res = await apis[key][method](`${API}/${path}`, data === undefined ? undefined : method === 'get' ? { params: data as Record<string, string> } : { data });
  return { status: res.status(), body: await res.json().catch(() => ({})) as any };
};
const makeCase = async (key: string, tag: string, store: 'VW001' | 'VW002', over: Record<string, unknown> = {}) => {
  const r = await call(key, 'post', 'cases', caseBody(tag, store, over));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data.id as string;
};
const recordBody = (tag: string, over: Record<string, unknown> = {}) => ({ observation: `發現${tag}`, judgment: `判斷${tag}`, action_summary: `動作${tag}`, ...over });
const reason = { deletion_reason: '測試刪除原因' };
const dbCase = async (id: string) => (await db.from('supervisor_management_cases').select('*').eq('id', id).single()).data as any;
const events = async (id: string) => ((await db.from('supervisor_management_case_events').select('*').eq('case_id', id).order('event_at')).data || []) as any[];
const ids = (b: any) => (b.data as any[]).map((r) => r.id);

test('導覽與 capabilities：有任一督導日誌權限者看得到入口（kind supervisor-log）；沒有權限者沒有入口', async () => {
  const expected: Record<string, boolean> = { admin: true, sl_sup_a: true, sl_sup_b: true, sl_team: true, sl_follow: true, sl_manager: true, sl_viewer: true, sl_creator: true, sl_none: false };
  for (const [key, ok] of Object.entries(expected)) {
    const session = await (await apis[key].get('/api/workspace/session')).json();
    expect(session.capabilities.supervisorLog, `${key} capabilities.supervisorLog`).toBe(ok);
    const items = session.navigation.flatMap((g: { items: { href: string; kind?: string }[] }) => g.items);
    const item = items.find((i: { href: string }) => i.href === '/supervisor-management-log');
    expect(!!item, `${key} 導覽「督導管理日誌」`).toBe(ok);
    if (item) expect(item.kind).toBe('supervisor-log');
  }
});

test('未登入全部 401；寫入 API 檢查 Origin（403）', async () => {
  const bare = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  try {
    for (const p of ['cases', 'today', 'daily-plans', 'options', 'categories']) expect((await bare.get(`${API}/${p}`)).status(), p).toBe(401);
    expect((await bare.post(`${API}/cases`, { data: {} })).status()).toBe(401);
  } finally {
    await bare.dispose();
  }
  const bad = await pwRequest.newContext({ baseURL: TEST_ORIGIN, storageState: await apis.sl_sup_a.storageState(), extraHTTPHeaders: { Origin: 'http://invalid.test' } });
  try {
    expect((await bad.post(`${API}/cases`, { data: caseBody('ORIGIN', 'VW001') })).status()).toBe(403);
    expect((await bad.post(`${API}/daily-plans`, { data: {} })).status()).toBe(403);
    expect((await bad.delete(`${API}/cases/00000000-0000-4000-8000-000000000000`, { data: reason })).status()).toBe(403);
  } finally {
    await bad.dispose();
  }
  expect(((await db.from('supervisor_management_cases').select('id').eq('title', slName('ORIGIN'))).data || []).length).toBe(0);
});

test('權限矩陣：讀取、建立、今日工作台、選項與分類', async () => {
  const m: Record<string, { read: number; create: number }> = {
    sl_none: { read: 403, create: 403 },
    sl_viewer: { read: 200, create: 403 },
    sl_creator: { read: 200, create: 201 },
    sl_sup_a: { read: 200, create: 201 },
    sl_team: { read: 200, create: 403 },
    sl_follow: { read: 200, create: 403 },
    sl_manager: { read: 200, create: 201 },
    admin: { read: 200, create: 201 },
  };
  for (const [key, want] of Object.entries(m)) {
    for (const p of ['cases', 'today', 'daily-plans', 'options', 'categories']) expect((await apis[key].get(`${API}/${p}`)).status(), `${key} GET ${p}`).toBe(want.read);
    expect((await apis[key].post(`${API}/cases`, { data: caseBody(`MX-${key}`, 'VW001') })).status(), `${key} 建立案件`).toBe(want.create);
  }
});

test('E1 三層可見範圍：督導看自己、看團隊看管轄門市、管理者看全部；與純函式逐列一致', async () => {
  const a = await makeCase('sl_sup_a', 'E1-A', 'VW001', { assigned_user_id: users.sl_viewer.id });
  const b = await makeCase('sl_sup_b', 'E1-B', 'VW002');
  const m = await makeCase('sl_manager', 'E1-M', 'VW001');
  const all = [a, b, m];
  const seen = async (key: string) => { const r = await call(key, 'get', 'cases', { search: slName('E1'), pageSize: '100' }); expect(r.status, key).toBe(200); return ids(r.body).filter((i: string) => all.includes(i)).sort(); };
  expect(await seen('sl_sup_a'), 'A 只看自己建立的（含管轄 VW001 但 follow_up 權限讓 VW001 的案件也看得到）').toEqual([a, m].sort());
  expect(await seen('sl_sup_b')).toEqual([b]);
  expect(await seen('sl_team'), '看團隊：只有管轄門市 VW001 的案件').toEqual([a, m].sort());
  expect(await seen('sl_viewer'), '被指派者看得到指派給自己的案件').toEqual([a]);
  expect(await seen('sl_creator'), '只有建立者沒有案件').toEqual([]);
  expect(await seen('sl_follow'), 'follow_up 加管轄 VW001').toEqual([a, m].sort());
  expect(await seen('sl_manager')).toEqual(all.sort());
  expect(await seen('admin')).toEqual(all.sort());
  // 畫面層級
  expect((await call('sl_team', 'get', 'cases')).body.viewer.tier).toBe('team');
  expect((await call('sl_manager', 'get', 'cases')).body.viewer.tier).toBe('all');
  expect((await call('sl_sup_b', 'get', 'cases')).body.viewer.tier).toBe('own');
  // 純函式與資料庫實際資料逐列一致：每個角色對每筆案件，可見與否同 caseVisible
  const rows = (await db.from('supervisor_management_cases').select('id,owner_user_id,assigned_user_id,store_id,status,deleted_at').in('id', all)).data as any[];
  const caps = (key: string) => ({ viewOwn: false, viewTeam: false, create: false, updateOwn: false, followUp: false, manage: false, ...{
    sl_sup_a: { viewOwn: true, create: true, updateOwn: true, followUp: true }, sl_sup_b: { viewOwn: true, create: true, updateOwn: true, followUp: true }, sl_team: { viewTeam: true },
    sl_follow: { viewOwn: true, followUp: true }, sl_manager: { manage: true }, sl_viewer: { viewOwn: true }, sl_creator: { create: true },
  }[key as 'sl_sup_a'] });
  const managed: Record<string, string[]> = { sl_sup_a: [sid.VW001], sl_sup_b: [sid.VW002], sl_team: [sid.VW001], sl_follow: [sid.VW001] };
  for (const key of ['sl_sup_a', 'sl_sup_b', 'sl_team', 'sl_follow', 'sl_manager', 'sl_viewer', 'sl_creator']) {
    const v: Viewer = { userId: users[key].id, managedStoreIds: managed[key] || [], caps: caps(key) };
    const got = new Set(await seen(key));
    for (const row of rows) expect(got.has(row.id), `${key} 看 ${row.id}`).toBe(caseVisible(row, v));
  }
  // 看不到的案件：詳情一律 404，不洩漏存在與否
  expect((await call('sl_sup_b', 'get', `cases/${a}`)).status).toBe(404);
  expect((await call('sl_sup_a', 'get', `cases/${b}`)).status).toBe(404);
  expect((await call('sl_manager', 'get', `cases/${b}`)).status).toBe(200);
});

test('列表：關鍵字（含特殊字元）與可見範圍同時生效、分頁超出回最後一頁、pageSize 上限 100', async () => {
  const id = await makeCase('sl_sup_a', '搜尋%_,(特殊)', 'VW001', { summary: '摘要 abc,def' });
  const other = await makeCase('sl_sup_b', '搜尋%_,(特殊)', 'VW002');
  const r = await call('sl_sup_a', 'get', 'cases', { search: '搜尋%_,(特殊)' });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(ids(r.body)).toContain(id);
  expect(ids(r.body), '可見範圍仍然生效：看不到督導 B 的案件').not.toContain(other);
  // % 與 _ 是字面字元，不是萬用字元
  const lit = await call('sl_sup_a', 'get', 'cases', { search: '%' });
  expect(lit.status).toBe(200);
  for (const row of lit.body.data) expect(JSON.stringify(row)).toContain('%');
  const big = await call('sl_manager', 'get', 'cases', { pageSize: '1000' });
  expect(big.body.meta.pageSize).toBe(100);
  const beyond = await call('sl_manager', 'get', 'cases', { page: '9999', pageSize: '5' });
  expect(beyond.status).toBe(200);
  expect(beyond.body.meta.page).toBe(beyond.body.meta.totalPages);
  expect(beyond.body.data.length).toBeGreaterThan(0);
  expect((await call('sl_manager', 'get', 'cases', { storeId: 'not-a-uuid' })).status).toBe(400);
  const filtered = await call('sl_manager', 'get', 'cases', { storeId: sid.VW002, status: 'open', search: slName('搜尋') });
  expect(ids(filtered.body)).toEqual([other]);
});

test('建立案件：欄位驗證沿用舊版（門市目標必須選門市、系統欄位不可指定）；建立者是登入者', async () => {
  expect((await call('sl_sup_a', 'post', 'cases', { ...caseBody('V1', 'VW001'), store_id: null })).status).toBe(400);
  expect((await call('sl_sup_a', 'post', 'cases', { ...caseBody('V2', 'VW001'), owner_user_id: users.sl_sup_b.id, created_by: users.sl_sup_b.id })).status).toBe(400);
  expect((await call('sl_sup_a', 'post', 'cases', { ...caseBody('V3', 'VW001'), title: '  ' })).status).toBe(400);
  expect((await call('sl_sup_a', 'post', 'cases', { ...caseBody('V4', 'VW001'), assigned_user_id: '00000000-0000-4000-8000-000000000000' })).status, '指派人員不存在').toBe(400);
  const id = await makeCase('sl_sup_a', 'OWNER', 'VW001');
  const row = await dbCase(id);
  expect(row.owner_user_id).toBe(users.sl_sup_a.id);
  expect(row.created_by).toBe(users.sl_sup_a.id);
  expect(row.status).toBe('OPEN');
});

test('E2 修改：自己的未結案案件可改；沒有 update_own 不能改自己的；管理者可改全部並留「他人修改」事件；無權限看不到者 404', async () => {
  const a = await makeCase('sl_sup_a', 'E2-A', 'VW001');
  const c = await makeCase('sl_creator', 'E2-C', 'VW001');
  expect((await call('sl_sup_a', 'patch', `cases/${a}`, { title: slName('E2-A 改'), priority: 'HIGH' })).status).toBe(200);
  expect((await dbCase(a)).priority).toBe('HIGH');
  expect((await call('sl_creator', 'patch', `cases/${c}`, { title: slName('E2-C 改') })).status, '只有 create 不能改自己的').toBe(403);
  expect((await call('sl_sup_b', 'patch', `cases/${a}`, { priority: 'LOW' })).status, '看不到').toBe(404);
  expect((await call('sl_viewer', 'patch', `cases/${a}`, { priority: 'LOW' })).status, '沒有任何編輯權限').toBe(403);
  // follow_up 加管轄門市：舊版規則允許編輯 VW001 的案件
  expect((await call('sl_follow', 'patch', `cases/${a}`, { summary: '追蹤者補充' })).status).toBe(200);
  // 指派人員只有建立者或管理者能更換
  expect((await call('sl_follow', 'patch', `cases/${a}`, { assigned_user_id: users.sl_viewer.id })).status).toBe(403);
  // 管理者改別人的
  expect((await call('sl_manager', 'patch', `cases/${a}`, { title: slName('E2-A 管理者改') })).status).toBe(200);
  const evs = await events(a);
  expect(evs.some((e) => e.event_type === 'MANAGER_EDIT' && e.actor_user_id === users.sl_manager.id)).toBe(true);
  expect((await dbCase(a)).title).toBe(slName('E2-A 管理者改'));
  // 驗證錯誤
  expect((await call('sl_sup_a', 'patch', `cases/${a}`, { status: 'BOGUS' })).status).toBe(400);
  expect((await call('sl_sup_a', 'patch', 'cases/not-a-uuid', {})).status).toBe(400);
});

test('結案：狀態改成已改善或已結案會寫入 resolved_at／closed_at（舊版會被資料庫限制擋下）；結案後只有管理者能改，可重新開啟', async () => {
  const a = await makeCase('sl_sup_a', 'CLOSE', 'VW001');
  expect((await call('sl_sup_a', 'patch', `cases/${a}`, { status: 'RESOLVED' })).status).toBe(200);
  let row = await dbCase(a);
  expect(row.status).toBe('RESOLVED');
  expect(row.resolved_at).not.toBeNull();
  expect(row.closed_at).toBeNull();
  expect((await call('sl_sup_a', 'patch', `cases/${a}`, { status: 'CLOSED' })).status).toBe(200);
  row = await dbCase(a);
  expect(row.closed_at).not.toBeNull();
  expect((await events(a)).filter((e) => e.event_type === 'STATUS_CHANGE').length).toBe(2);
  expect((await call('sl_sup_a', 'patch', `cases/${a}`, { priority: 'LOW' })).status, '結案後本人不能再改').toBe(403);
  expect((await call('sl_sup_a', 'delete', `cases/${a}`, reason)).status, '結案後本人不能刪除').toBe(403);
  expect((await call('sl_sup_a', 'post', `cases/${a}/records`, recordBody('結案後'))).status, '結案後不能新增紀錄').toBe(403);
  expect((await call('sl_manager', 'patch', `cases/${a}`, { status: 'OPEN' })).status).toBe(200);
  row = await dbCase(a);
  expect([row.status, row.resolved_at, row.closed_at]).toEqual(['OPEN', null, null]);
});

test('紀錄：三欄必填、AI 草稿一律記錄由登入者人工確認、自己的可改可刪、他人與無權限被擋、管理者可改可刪全部', async () => {
  const a = await makeCase('sl_sup_a', 'REC', 'VW001');
  for (const k of ['observation', 'judgment', 'action_summary']) expect((await call('sl_sup_a', 'post', `cases/${a}/records`, recordBody('x', { [k]: ' ' }))).status, k).toBe(400);
  expect((await call('sl_sup_a', 'post', `cases/${a}/records`, recordBody('x', { requires_follow_up: true }))).status, '需追蹤要日期與預期結果').toBe(400);
  const r1 = await call('sl_sup_a', 'post', `cases/${a}/records`, recordBody('一', { record_type: 'MANAGEMENT', action_options: ['現場說明'], ai_generated: true, ai_confirmed_by: users.sl_sup_b.id }));
  expect(r1.status, JSON.stringify(r1.body)).toBe(201);
  const rec1 = (await db.from('supervisor_management_records').select('*').eq('id', r1.body.data.id).single()).data as any;
  expect(rec1.created_by).toBe(users.sl_sup_a.id);
  expect(rec1.ai_generated).toBe(true);
  expect(rec1.ai_confirmed_by, '不接受前端指定的確認人，一律是送出的登入者').toBe(users.sl_sup_a.id);
  expect(rec1.target_name_snapshot, '缺的對象欄位從案件帶入').toBe('VW001 測試門市');
  expect(rec1.store_id).toBe(sid.VW001);
  const r2 = await call('sl_sup_a', 'post', `cases/${a}/records`, recordBody('二', { requires_follow_up: true, follow_up_date: addDays(taipeiDate(new Date()), 3), expected_result: '改善', follow_up_method: 'phone' }));
  expect(r2.status, JSON.stringify(r2.body)).toBe(201);
  const rec2 = (await db.from('supervisor_management_records').select('*').eq('id', r2.body.data.id).single()).data as any;
  expect(rec2.follow_up_owner_id, '追蹤負責人預設為建立者').toBe(users.sl_sup_a.id);
  expect(rec2.follow_up_method).toBe('PHONE');
  // 非 AI 紀錄不得帶確認人
  expect(rec2.ai_confirmed_by).toBeNull();
  // 清單與可操作旗標
  const list = await call('sl_sup_a', 'get', `cases/${a}/records`);
  expect(list.body.data.length).toBe(2);
  expect(list.body.data.every((r: any) => r.can_edit && r.can_delete)).toBe(true);
  // sl_follow（管轄 VW001，非建立者）：能新增紀錄、不能改別人的
  const r3 = await call('sl_follow', 'post', `cases/${a}/records`, recordBody('追蹤者'));
  expect(r3.status).toBe(201);
  expect((await call('sl_follow', 'patch', `cases/${a}/records/${r1.body.data.id}`, { observation: '偷改' })).status).toBe(403);
  expect((await call('sl_follow', 'delete', `cases/${a}/records/${r1.body.data.id}`, reason)).status).toBe(403);
  expect((await call('sl_sup_b', 'post', `cases/${a}/records`, recordBody('b'))).status, '看不到的案件').toBe(404);
  expect((await call('sl_viewer', 'post', `cases/${a}/records`, recordBody('v'))).status).toBe(403);
  // 自己改
  expect((await call('sl_sup_a', 'patch', `cases/${a}/records/${r1.body.data.id}`, { judgment: '改過的判斷' })).status).toBe(200);
  expect(((await db.from('supervisor_management_records').select('judgment,observation').eq('id', r1.body.data.id).single()).data as any)).toEqual({ judgment: '改過的判斷', observation: '發現一' });
  expect((await call('sl_sup_a', 'patch', `cases/${a}/records/${r1.body.data.id}`, { observation: '' })).status).toBe(400);
  // 管理者改別人的
  expect((await call('sl_manager', 'patch', `cases/${a}/records/${r3.body.data.id}`, { action_summary: '管理者改' })).status).toBe(200);
  // 刪除：軟刪除、留事件、清單不再出現、時間線保留刪除事件
  expect((await call('sl_sup_a', 'delete', `cases/${a}/records/${r1.body.data.id}`, {})).status, '刪除原因必填').toBe(400);
  expect((await call('sl_sup_a', 'delete', `cases/${a}/records/${r1.body.data.id}`, reason)).status).toBe(200);
  const gone = (await db.from('supervisor_management_records').select('deleted_at,deleted_by,deletion_reason').eq('id', r1.body.data.id).single()).data as any;
  expect(gone.deleted_at).not.toBeNull();
  expect(gone.deleted_by).toBe(users.sl_sup_a.id);
  expect(gone.deletion_reason).toBe('測試刪除原因');
  expect((await call('sl_sup_a', 'get', `cases/${a}/records`)).body.data.map((r: any) => r.id)).not.toContain(r1.body.data.id);
  expect((await call('sl_sup_a', 'delete', `cases/${a}/records/${r1.body.data.id}`, reason)).status, '重複刪除').toBe(404);
  const tl = await call('sl_sup_a', 'get', `cases/${a}/timeline`);
  expect(tl.status).toBe(200);
  expect(tl.body.data.some((t: any) => t.type === 'RECORD_SOFT_DELETE' && t.body === '測試刪除原因' && t.actor_user_id === users.sl_sup_a.id)).toBe(true);
  expect(tl.body.data.some((t: any) => t.type === 'RECORD_EDIT')).toBe(true);
  expect(tl.body.data[tl.body.data.length - 1].type).toBe('CASE_CREATED');
  // 管理者刪別人的
  expect((await call('sl_manager', 'delete', `cases/${a}/records/${r3.body.data.id}`, reason)).status).toBe(200);
});

test('追蹤：需要 follow_up 權限（舊版資料表政策，manage 單獨不夠）；來源紀錄必須屬於該案件；建立者可刪、管理者可刪全部', async () => {
  const a = await makeCase('sl_sup_a', 'FU', 'VW001');
  const rec = await call('sl_sup_a', 'post', `cases/${a}/records`, recordBody('來源'));
  const other = await makeCase('sl_sup_a', 'FU-O', 'VW001');
  const otherRec = await call('sl_sup_a', 'post', `cases/${other}/records`, recordBody('別案'));
  const fu = { follow_up_date: taipeiDate(new Date()), result_status: 'IMPROVING', result_notes: '改善中' };
  expect((await call('sl_sup_a', 'post', `cases/${a}/followups`, { ...fu, result_notes: '' })).status).toBe(400);
  expect((await call('sl_sup_a', 'post', `cases/${a}/followups`, { ...fu, result_status: 'BOGUS' })).status).toBe(400);
  expect((await call('sl_sup_a', 'post', `cases/${a}/followups`, { ...fu, source_record_id: otherRec.body.data.id })).status, '別案的紀錄').toBe(400);
  const ok = await call('sl_sup_a', 'post', `cases/${a}/followups`, { ...fu, source_record_id: rec.body.data.id, next_follow_up_date: addDays(taipeiDate(new Date()), 5) });
  expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  expect((await call('sl_manager', 'post', `cases/${a}/followups`, fu)).status, '只有 manage 沒有 follow_up').toBe(403);
  expect((await call('sl_creator', 'post', `cases/${a}/followups`, fu)).status, '只有 create 沒有追蹤權限').toBe(403);
  expect((await call('sl_follow', 'post', `cases/${a}/followups`, fu)).status, 'follow_up 加管轄 VW001').toBe(201);
  const list = await call('sl_sup_a', 'get', `cases/${a}/followups`);
  expect(list.body.data.length).toBe(2);
  const mine = list.body.data.find((f: any) => f.id === ok.body.data.id);
  expect(mine.can_delete).toBe(true);
  const theirs = list.body.data.find((f: any) => f.id !== ok.body.data.id);
  expect(theirs.can_delete, '別人的追蹤本人不能刪').toBe(false);
  expect((await call('sl_sup_a', 'delete', `cases/${a}/followups/${theirs.id}`, reason)).status).toBe(403);
  expect((await call('sl_sup_a', 'delete', `cases/${a}/followups/${ok.body.data.id}`, reason)).status).toBe(200);
  expect((await call('sl_manager', 'delete', `cases/${a}/followups/${theirs.id}`, reason)).status, '管理者刪別人的').toBe(200);
  const evs = await events(a);
  expect(evs.filter((e) => e.event_type === 'FOLLOWUP_SOFT_DELETE').length).toBe(2);
  expect((await call('sl_sup_a', 'get', `cases/${a}/followups`)).body.data.length).toBe(0);
});

test('E2 軟刪除案件：自己的未結案案件可刪、他人與追蹤者不行；刪除留時間線事件、紀錄與追蹤一併標記；管理者可事後追查', async () => {
  const a = await makeCase('sl_sup_a', 'DEL', 'VW001');
  const rec = await call('sl_sup_a', 'post', `cases/${a}/records`, recordBody('刪案'));
  const fuRes = await call('sl_sup_a', 'post', `cases/${a}/followups`, { result_status: 'IMPROVING', result_notes: '一併標記' });
  expect(fuRes.status).toBe(201);
  expect((await call('sl_follow', 'delete', `cases/${a}`, reason)).status, '追蹤者不能刪別人的案件').toBe(403);
  expect((await call('sl_sup_b', 'delete', `cases/${a}`, reason)).status).toBe(404);
  expect((await call('sl_creator', 'delete', `cases/${a}`, reason)).status).toBe(404);
  expect((await call('sl_sup_a', 'delete', `cases/${a}`, {})).status, '刪除原因必填').toBe(400);
  const del = await call('sl_sup_a', 'delete', `cases/${a}`, reason);
  expect(del.status, JSON.stringify(del.body)).toBe(200);
  const row = await dbCase(a);
  expect([row.deleted_by, row.deletion_reason]).toEqual([users.sl_sup_a.id, '測試刪除原因']);
  expect(row.deleted_at).not.toBeNull();
  const recRow = (await db.from('supervisor_management_records').select('deleted_at').eq('id', rec.body.data.id).single()).data as any;
  expect(recRow.deleted_at).not.toBeNull();
  const fuRow = (await db.from('supervisor_management_followups').select('deleted_at').eq('id', fuRes.body.data.id).single()).data as any;
  expect(fuRow.deleted_at).not.toBeNull();
  const evs = await events(a);
  expect(evs.some((e) => e.event_type === 'SOFT_DELETE' && e.body === '測試刪除原因' && e.actor_user_id === users.sl_sup_a.id)).toBe(true);
  // 不再出現在清單與詳情
  expect(ids((await call('sl_manager', 'get', 'cases', { search: slName('DEL'), pageSize: '100' })).body)).not.toContain(a);
  expect((await call('sl_sup_a', 'get', `cases/${a}`)).status).toBe(404);
  expect((await call('sl_sup_a', 'delete', `cases/${a}`, reason)).status).toBe(404);
  // 管理者事後追查：看到刪除原因、被刪的紀錄與刪除事件
  expect((await call('sl_sup_a', 'get', `cases/${a}`, { deleted: '1' })).status, '非管理者不能看已刪除').toBe(403);
  const audit = await call('sl_manager', 'get', `cases/${a}`, { deleted: '1' });
  expect(audit.status, JSON.stringify(audit.body)).toBe(200);
  expect(audit.body.data.deletion_reason).toBe('測試刪除原因');
  expect(audit.body.data.records[0].deleted_at).not.toBeNull();
  expect(audit.body.data.events.some((e: any) => e.event_type === 'SOFT_DELETE')).toBe(true);
  // 管理者刪別人的（含已結案）
  const b = await makeCase('sl_sup_b', 'DEL-B', 'VW002');
  await call('sl_sup_b', 'patch', `cases/${b}`, { status: 'CLOSED' });
  expect((await call('sl_manager', 'delete', `cases/${b}`, reason)).status).toBe(200);
  expect((await events(b)).some((e) => e.event_type === 'SOFT_DELETE' && e.actor_user_id === users.sl_manager.id)).toBe(true);
});

test('詳情：permissions 旗標、時間線、紀錄與追蹤的可操作旗標，依登入者不同', async () => {
  const a = await makeCase('sl_sup_a', 'DETAIL', 'VW001', { assigned_user_id: users.sl_viewer.id });
  await call('sl_sup_a', 'post', `cases/${a}/records`, recordBody('詳'));
  const asOwner = (await call('sl_sup_a', 'get', `cases/${a}`)).body;
  expect(asOwner.data.permissions).toEqual({ edit: true, delete: true, add_record: true, add_followup: true });
  expect(asOwner.data.timeline.map((t: any) => t.type)).toEqual(['RECORD_ADDED', 'CASE_CREATED']);
  const asViewer = (await call('sl_viewer', 'get', `cases/${a}`)).body;
  expect(asViewer.data.permissions).toEqual({ edit: false, delete: false, add_record: false, add_followup: false });
  expect(asViewer.data.records[0].can_edit).toBe(false);
  const asTeam = (await call('sl_team', 'get', `cases/${a}`)).body;
  expect(asTeam.data.permissions).toEqual({ edit: false, delete: false, add_record: false, add_followup: false });
  const asManager = (await call('sl_manager', 'get', `cases/${a}`)).body;
  expect(asManager.data.permissions).toMatchObject({ edit: true, delete: true, add_record: true });
  expect(asManager.data.records[0].can_delete).toBe(true);
});

test('E3 今日工作台：規劃、追蹤佇列分桶（逾期、今天、七天內，已結案不列）、今日紀錄；日期預設台北今天；可見範圍同案件與規劃規則', async () => {
  const t = taipeiDate(new Date());
  const over = await makeCase('sl_sup_a', 'Q-OVER', 'VW001', { next_follow_up_at: addDays(t, -2) });
  const due = await makeCase('sl_sup_a', 'Q-TODAY', 'VW001', { next_follow_up_at: t });
  const soon = await makeCase('sl_sup_a', 'Q-SOON', 'VW001', { next_follow_up_at: addDays(t, 6) });
  const far = await makeCase('sl_sup_a', 'Q-FAR', 'VW001', { next_follow_up_at: addDays(t, 8) });
  const closed = await makeCase('sl_sup_a', 'Q-CLOSED', 'VW001', { next_follow_up_at: addDays(t, -1) });
  await call('sl_sup_a', 'patch', `cases/${closed}`, { status: 'CLOSED' });
  const otherStore = await makeCase('sl_sup_b', 'Q-OTHER', 'VW002', { next_follow_up_at: addDays(t, -1) });
  const rec = await call('sl_sup_a', 'post', `cases/${over}/records`, recordBody('今日紀錄'));
  expect(rec.status).toBe(201);
  const plan = await call('sl_sup_a', 'post', 'daily-plans', { title: slName('PLAN-T'), target_type: 'STORE', store_id: sid.VW001, target_name_snapshot: 'VW001 測試門市', linked_case_id: over });
  expect(plan.status, JSON.stringify(plan.body)).toBe(201);
  const res = await call('sl_sup_a', 'get', 'today');
  expect(res.status).toBe(200);
  const d = res.body.data;
  expect(d.date).toBe(t);
  const queue = Object.fromEntries((d.followUpQueue as any[]).filter((c) => c.title.startsWith(slName('Q-'))).map((c) => [c.id, c.bucket]));
  expect(queue[over]).toBe('overdue');
  expect(queue[due]).toBe('today');
  expect(queue[soon]).toBe('upcoming');
  expect(queue[far], '超過七天不列').toBeUndefined();
  expect(queue[closed], '已結案不列').toBeUndefined();
  expect(queue[otherStore], '別人的案件不列').toBeUndefined();
  expect((d.followUpQueue as any[]).find((c) => c.id === over).latest_record.action_summary).toBe('動作今日紀錄');
  expect(d.todayRecords.some((r: any) => r.id === rec.body.data.id && r.case.id === over)).toBe(true);
  expect(d.plans.some((p: any) => p.id === plan.body.data.id && p.can_edit)).toBe(true);
  expect(d.summary.plans.total).toBe(d.plans.length);
  expect(d.summary.followUps.total).toBe(d.followUpQueue.length);
  // 指定日期（舊日期沒有資料）與格式錯誤回退台北今天
  expect((await call('sl_sup_a', 'get', 'today', { date: '2038-01-05' })).body.data.date).toBe('2038-01-05');
  expect((await call('sl_sup_a', 'get', 'today', { date: 'bad' })).body.data.date).toBe(t);
  // 督導 B 看不到督導 A 的規劃與案件；看團隊的人看得到管轄門市的案件佇列，但看不到別人的規劃（規劃的看團隊以規劃門市為準：VW001 的規劃看得到）
  const asB = (await call('sl_sup_b', 'get', 'today')).body.data;
  expect(asB.plans.some((p: any) => p.id === plan.body.data.id)).toBe(false);
  expect((asB.followUpQueue as any[]).some((c) => c.id === over)).toBe(false);
  expect(asB.todayRecords.some((r: any) => r.id === rec.body.data.id)).toBe(false);
  const asTeam = (await call('sl_team', 'get', 'today')).body.data;
  expect((asTeam.followUpQueue as any[]).some((c) => c.id === over)).toBe(true);
  expect(asTeam.plans.some((p: any) => p.id === plan.body.data.id)).toBe(true);
  const asMgr = (await call('sl_manager', 'get', 'today')).body.data;
  expect((asMgr.followUpQueue as any[]).some((c) => c.id === otherStore)).toBe(true);
});

test('E3 每日計畫：建立（需 create）、狀態流轉寫入開始與完成時間、本人未完成可改可刪、完成後只有管理者能改、關聯案件必須可見、列表篩選分頁', async () => {
  const t = taipeiDate(new Date());
  const b = await makeCase('sl_sup_b', 'PL-B', 'VW002');
  const body = (tag: string, over: Record<string, unknown> = {}) => ({ title: slName(tag), target_type: 'OTHER', target_name_snapshot: '其他事項', ...over });
  expect((await call('sl_viewer', 'post', 'daily-plans', body('PV'))).status, '只有看自己不能建立').toBe(403);
  expect((await call('sl_sup_a', 'post', 'daily-plans', body('P0', { title: ' ' }))).status).toBe(400);
  expect((await call('sl_sup_a', 'post', 'daily-plans', body('P0', { target_type: 'STORE' }))).status, '門市目標要選門市').toBe(400);
  expect((await call('sl_sup_a', 'post', 'daily-plans', body('P0', { linked_case_id: b }))).status, '關聯案件看不到').toBe(400);
  const p = await call('sl_sup_a', 'post', 'daily-plans', body('P1', { plan_date: t, notes: '備註' }));
  expect(p.status, JSON.stringify(p.body)).toBe(201);
  const id = p.body.data.id as string;
  const row = async () => (await db.from('supervisor_management_daily_plans').select('*').eq('id', id).single()).data as any;
  expect((await row()).owner_user_id).toBe(users.sl_sup_a.id);
  expect((await row()).status).toBe('PLANNED');
  expect((await call('sl_sup_a', 'patch', `daily-plans/${id}`, { status: 'IN_PROGRESS' })).status).toBe(200);
  expect((await row()).started_at, '進行中自動補開始時間').not.toBeNull();
  expect((await call('sl_sup_a', 'patch', `daily-plans/${id}`, { notes: '改備註' })).status).toBe(200);
  expect((await call('sl_sup_b', 'patch', `daily-plans/${id}`, { notes: '偷改' })).status, '別人的規劃看不到').toBe(404);
  expect((await call('sl_sup_b', 'get', `daily-plans/${id}`)).status).toBe(404);
  expect((await call('sl_team', 'get', `daily-plans/${id}`)).status, '看團隊：規劃沒有門市（OTHER）看不到').toBe(404);
  expect((await call('sl_sup_a', 'patch', `daily-plans/${id}`, { status: 'DONE' })).status).toBe(200);
  expect((await row()).completed_at).not.toBeNull();
  expect((await call('sl_sup_a', 'patch', `daily-plans/${id}`, { notes: '完成後再改' })).status, '完成後本人不能改').toBe(403);
  expect((await call('sl_sup_a', 'delete', `daily-plans/${id}`, reason)).status, '完成後本人不能刪').toBe(403);
  expect((await call('sl_manager', 'patch', `daily-plans/${id}`, { notes: '管理者改' })).status).toBe(200);
  // 本人刪除未完成的（E2：舊版只有管理者能刪）
  const p2 = await call('sl_sup_a', 'post', 'daily-plans', body('P2', { plan_date: t }));
  expect((await call('sl_sup_a', 'delete', `daily-plans/${p2.body.data.id}`, {})).status).toBe(400);
  expect((await call('sl_sup_a', 'delete', `daily-plans/${p2.body.data.id}`, reason)).status).toBe(200);
  const gone = (await db.from('supervisor_management_daily_plans').select('deleted_at,deleted_by,deletion_reason').eq('id', p2.body.data.id).single()).data as any;
  expect([gone.deleted_by, gone.deletion_reason]).toEqual([users.sl_sup_a.id, '測試刪除原因']);
  expect((await call('sl_sup_a', 'get', `daily-plans/${p2.body.data.id}`)).status).toBe(404);
  expect((await call('sl_manager', 'delete', `daily-plans/${id}`, reason)).status, '管理者刪已完成的').toBe(200);
  // 列表：本人只看自己的；篩選與分頁
  await call('sl_sup_a', 'post', 'daily-plans', body('P3', { plan_date: '2038-02-02' }));
  const list = await call('sl_sup_a', 'get', 'daily-plans', { search: slName('P'), pageSize: '100' });
  expect(list.status).toBe(200);
  expect((list.body.data as any[]).every((r) => r.owner_user_id === users.sl_sup_a.id)).toBe(true);
  expect((await call('sl_sup_a', 'get', 'daily-plans', { date: '2038-02-02', search: slName('P') })).body.data.length).toBe(1);
  expect((await call('sl_sup_a', 'get', 'daily-plans', { date: 'bad' })).status).toBe(400);
  expect((await call('sl_sup_a', 'get', 'daily-plans', { pageSize: '1000' })).body.meta.pageSize).toBe(100);
  expect((await call('sl_manager', 'get', 'daily-plans', { search: slName('P'), pageSize: '100' })).body.data.length).toBeGreaterThanOrEqual(2);
});

test('選項與分類：分類（用有管理權限者的身分建立種子）、門市、員工只在指定門市或搜尋時回傳', async () => {
  const mgr = await userDb(users.sl_manager);
  const code = slCategoryCode('OPT');
  const created = await mgr.from('supervisor_management_categories').insert({ code, name: slName('分類') }).select('id').single();
  expect(created.error, JSON.stringify(created.error)).toBeNull();
  const cats = await call('sl_sup_a', 'get', 'categories');
  expect(cats.status).toBe(200);
  expect((cats.body.data as any[]).some((c) => c.code === code)).toBe(true);
  const opts = await call('sl_sup_a', 'get', 'options');
  expect(opts.status).toBe(200);
  expect(opts.body.data.employees, '沒有指定門市與搜尋字串：不回傳員工').toEqual([]);
  expect((opts.body.data.stores as any[]).some((s) => s.store_code === 'VW001')).toBe(true);
  expect((opts.body.data.categories as any[]).some((c) => c.code === code)).toBe(true);
  const byStore = await call('sl_sup_a', 'get', 'options', { store_id: sid.VW001 });
  expect(byStore.status).toBe(200);
  expect(Array.isArray(byStore.body.data.employees)).toBe(true);
  expect((await call('sl_sup_a', 'get', 'options', { store_id: 'bad' })).status).toBe(400);
  expect((await call('sl_sup_a', 'get', 'options', { q: '%,(x)' })).status).toBe(200);
  // 案件帶分類
  const id = await makeCase('sl_sup_a', 'CAT', 'VW001', { category_id: created.data.id });
  expect((await call('sl_sup_a', 'get', `cases/${id}`)).body.data.category.code).toBe(code);
});

test('正式區 has_permission 語意：角色停用（roles.is_active=false）仍可讀取；user_roles 失效即失去；寫入另受舊版資料表觸發器檢查', async () => {
  const a = await makeCase('sl_sup_a', 'SEM', 'VW001');
  const roleRow = (await db.from('roles').select('id').eq('code', 'm6_test_sl_sup_a').single()).data;
  expect((await db.from('roles').update({ is_active: false }).eq('id', roleRow.id)).error).toBeNull();
  try {
    expect((await call('sl_sup_a', 'get', 'cases', { search: slName('SEM') })).status, '讀取走應用層權限（不檢查 roles.is_active）').toBe(200);
    expect(ids((await call('sl_sup_a', 'get', 'cases', { search: slName('SEM') })).body)).toContain(a);
    // 寫入仍受舊版資料表觸發器（supervisor_management_current_user_has_permission 檢查 roles.is_active）擋下：回 403 與說明，不是 500
    const w = await call('sl_sup_a', 'patch', `cases/${a}`, { priority: 'LOW' });
    expect(w.status).toBe(403);
    expect(String(w.body.error)).toContain('權限');
  } finally {
    await db.from('roles').update({ is_active: true }).eq('id', roleRow.id);
  }
  expect((await call('sl_sup_a', 'patch', `cases/${a}`, { priority: 'LOW' })).status).toBe(200);
  expect((await db.from('user_roles').update({ is_active: false }).eq('user_id', users.sl_sup_a.id)).error).toBeNull();
  try {
    expect((await call('sl_sup_a', 'get', 'cases')).status).toBe(403);
  } finally {
    await db.from('user_roles').update({ is_active: true }).eq('user_id', users.sl_sup_a.id);
  }
});

test('不存在的路徑 404；POST 內容不是 JSON 物件 400', async () => {
  expect((await call('sl_sup_a', 'get', 'nope')).status).toBe(404);
  const res = await apis.sl_sup_a.post(`${API}/cases`, { data: '[]', headers: { 'Content-Type': 'application/json' } });
  expect(res.status()).toBe(400);
});
