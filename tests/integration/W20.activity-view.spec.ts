import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { adminDb, apiForUser, deleteRunData, seedW20Campaign, setupM5Users, stores, type M5User } from '../support/m5-fixtures';

// W20 整合層（M5 Q2、Q6、Q7）：新版活動檢視 API（/api/workspace/activity-view）與填報（campaign-tools）。
//  Q2 停用的活動檢視端一律隱藏、Q7 三顆按鈕與管轄門市照舊版、Q6 店長只能寫自己被任命的門市（督導依活動檢視範圍）。
// 資料：VW/ZT 測試門市、2099 年活動，名稱帶「[自動測試]M5 <runId>」，只刪自己建立的資料。

let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const clients: Record<string, APIRequestContext> = {};
async function as(key: string): Promise<APIRequestContext> {
  if (!clients[key]) clients[key] = await apiForUser(users[key]);
  return clients[key];
}
let main: Awaited<ReturnType<typeof seedW20Campaign>>;
let off: Awaited<ReturnType<typeof seedW20Campaign>>;
let draft: Awaited<ReturnType<typeof seedW20Campaign>>;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const s = await setupM5Users(['store_manager', 'supervisor', 'viewer', 'w20_mgr_support', 'w20_mgr_overview', 'w20_mgr_full', 'w20_sup_full']);
  users = s.users;
  teardownUsers = s.teardown;
  main = await seedW20Campaign('w20-main');
  off = await seedW20Campaign('w20-off', { active: false });
  draft = await seedW20Campaign('w20-draft', { publish: {} });
});
test.afterAll(async () => {
  for (const c of Object.values(clients)) await c.dispose();
  await deleteRunData();
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const list = async (api: APIRequestContext) => api.get('/api/workspace/activity-view');
const detail = async (api: APIRequestContext, id: string) => api.get(`/api/workspace/activity-view?id=${id}`);
const idsOf = async (res: Awaited<ReturnType<typeof list>>) => new Set<string>(((await res.json()).data as any[]).map((c) => c.id));

test('列表（Q2）：停用的活動對店長、督導、檢視全部者都隱藏；舊 API 仍會給（證明這是新版的刻意差異）', async () => {
  for (const key of ['store_manager', 'supervisor', 'viewer']) {
    const api = await as(key);
    const nat = await list(api);
    expect(nat.status(), `${key} 列表`).toBe(200);
    const ids = await idsOf(nat);
    expect(ids.has(off.id), `${key} 不該看到停用的活動`).toBe(false);
    expect(ids.has(main.id), `${key} 看得到已發布的活動`).toBe(true);
    const legacy = new Set<string>(((await (await api.get('/api/campaigns/published')).json()).data as any[]).map((c) => c.id));
    expect(legacy.has(off.id), `${key} 舊版仍會列出停用的活動`).toBe(true);
  }
});

test('列表：發布對象——督導與店長各看到發布給自己的；未發布草稿只有「查看全部」看得到', async () => {
  const sm = await idsOf(await list(await as('store_manager')));
  const sup = await idsOf(await list(await as('supervisor')));
  const all = await idsOf(await list(await as('viewer')));
  expect(sm.has(draft.id)).toBe(false);
  expect(sup.has(draft.id)).toBe(false);
  expect(all.has(draft.id)).toBe(true);
  expect(all.has(main.id)).toBe(true);
  const body = await (await list(await as('viewer'))).json();
  expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const row = (body.data as any[]).find((c) => c.id === draft.id);
  expect(row.published_to_supervisors || row.published_to_store_managers || row.published_to_inventory_team).toBeFalsy();
});

test('列表：身分旗標（督導／店長標題用）', async () => {
  const sm = await (await list(await as('store_manager'))).json();
  expect(sm.isStoreManager).toBe(true);
  expect(sm.isSupervisor).toBe(false);
  const sup = await (await list(await as('supervisor'))).json();
  expect(sup.isSupervisor).toBe(true);
});

test('明細（Q2）：停用的活動連直接帶編號也讀不到（404）；未發布草稿對店長讀不到（資料庫 RLS 回 404，舊 API 若放行則 403）；無權限帳號 403；壞編號 400；未登入 401', async () => {
  const sm = await as('store_manager');
  expect((await detail(sm, off.id)).status()).toBe(404);
  expect([403, 404]).toContain((await detail(sm, draft.id)).status());
  expect((await detail(sm, 'not-a-uuid')).status()).toBe(400);
  expect((await detail(sm, randomUUID())).status()).toBe(404);
  const denied = await apiAs('denied');
  try {
    expect((await detail(denied, main.id)).status()).toBe(403);
    expect((await list(denied)).status()).toBe(403);
  } finally {
    await denied.dispose();
  }
  const anon = await (await import('@playwright/test')).request.newContext({ baseURL: 'http://localhost:3002' });
  try {
    expect((await anon.get('/api/workspace/activity-view')).status()).toBe(401);
  } finally {
    await anon.dispose();
  }
  // 活動管理端（有「查看全部」）仍能讀未發布草稿，停用的一樣不行（檢視端一律隱藏）
  const viewer = await as('viewer');
  expect((await detail(viewer, draft.id)).status()).toBe(200);
  expect((await detail(viewer, off.id)).status()).toBe(404);
});

test('明細：店長只看到被任命的門市排程；督導看全部；總門市數是全部門市數（照舊版）', async () => {
  const s = await stores();
  const codeById = Object.fromEntries(Object.entries(s).map(([c, v]) => [v.id, c]));
  const mgr = await (await detail(await as('store_manager'), main.id)).json();
  expect(mgr.schedules.map((x: any) => codeById[x.store_id]).sort()).toEqual(['VW001']);
  expect(mgr.plan.details === undefined || mgr.plan.details.every((d: any) => codeById[d.store_id] === 'VW001')).toBe(true);
  const sup = await (await detail(await as('supervisor'), main.id)).json();
  expect(sup.schedules.map((x: any) => codeById[x.store_id]).sort()).toEqual(['VW001', 'ZT01', 'ZT02']);
  // 舊版「總門市數」= /api/stores-with-supervisors 的筆數（資料庫 RLS 決定能看到幾間），新版必須相同
  const legacyStores = await (await (await as('supervisor')).get('/api/stores-with-supervisors')).json();
  expect(sup.totalStores).toBe((legacyStores.data || []).length);
  expect(sup.totalStores).toBeGreaterThan(0);
  expect(sup.plan.errors).toEqual({});
  // 門市名稱由資料庫 RLS 決定能不能讀（與舊版 stores 查詢相同）：自己管轄的 ZT01 一定讀得到
  const zt01 = sup.schedules.find((x: any) => codeById[x.store_id] === 'ZT01');
  expect(zt01.store.store_name).toBeTruthy();
});

test('Q7 按鈕與管轄門市：照舊版（支援請求需支援指派權、人力查看需人力查看權、Check List 需有管轄門市）', async () => {
  const expected: Record<string, { managed: string[]; support: boolean; staff: boolean; checklist: boolean }> = {
    store_manager: { managed: [], support: false, staff: false, checklist: false }, // 只有 view_own：舊版不載入管轄門市，Check List 也不出現
    viewer: { managed: [], support: false, staff: false, checklist: false },
    w20_mgr_support: { managed: ['VW001'], support: true, staff: false, checklist: true },
    w20_mgr_overview: { managed: ['VW001'], support: false, staff: true, checklist: true },
    w20_mgr_full: { managed: ['VW001'], support: true, staff: true, checklist: true },
    w20_sup_full: { managed: ['ZT01'], support: true, staff: true, checklist: true },
  };
  const s = await stores();
  const codeById = Object.fromEntries(Object.entries(s).map(([c, v]) => [v.id, c]));
  for (const [key, want] of Object.entries(expected)) {
    const res = await detail(await as(key), main.id);
    expect(res.status(), `${key} 明細`).toBe(200);
    const v = (await res.json()).viewer;
    expect(v.managedStores.map((m: any) => codeById[m.id]).sort(), `${key} 管轄門市`).toEqual(want.managed);
    expect({ support: v.showSupport, staff: v.showStaffOverview, checklist: v.showChecklist }, `${key} 按鈕`).toEqual({ support: want.support, staff: want.staff, checklist: want.checklist });
  }
});

test('Q7 管理員帳號：按鈕條件與管轄門市互相一致（有按鈕就有管轄門市）', async () => {
  const api = await apiAs('admin');
  try {
    const res = await detail(api, main.id);
    expect(res.status()).toBe(200);
    const v = (await res.json()).viewer;
    if (v.showSupport || v.showStaffOverview || v.showChecklist) expect(v.managedStores.length).toBeGreaterThan(0);
    else expect(v.managedStores).toEqual([]);
  } finally {
    await api.dispose();
  }
});

// ---- Q6：填報寫入（新版 campaign-tools 由舊 handler 與 authorizeCampaignStoreWrite 判斷範圍） ----
const tools = (resource: string, q = '') => `/api/workspace/campaign-tools?resource=${resource}${q}`;
const headcount = (cid: string, storeId: string, extra: number, notes: string) => ({ campaign_id: cid, store_id: storeId, extra_support_count: extra, supervisor_count: 1, notes });

test('Q6 人力預估：要有門市細節編輯權才能寫（持有者與舊版相同，不受任命門市限制）；只有人力查看權的人不能寫', async () => {
  const s = await stores();
  const db = adminDb();
  const mgr = await as('w20_mgr_full');
  const ok = await mgr.post(tools('headcount'), { data: headcount(main.id, s.VW001.id, 2, 'w20 店長填報') });
  expect(ok.status()).toBe(200);
  const row = (await db.from('campaign_store_headcount').select('extra_support_count,supervisor_count,notes').eq('campaign_id', main.id).eq('store_id', s.VW001.id).maybeSingle()).data;
  expect(row).toMatchObject({ extra_support_count: 2, supervisor_count: 1, notes: 'w20 店長填報' });
  // 舊 API（campaign-store-headcount）把 activity.store_detail.edit 同時當成「寫全部門市」的編輯權：持有者不受任命門市限制（照舊版，不是新版放寬）。
  const other = await mgr.post(tools('headcount'), { data: headcount(main.id, s.ZT01.id, 5, 'w20 持編輯權') });
  expect(other.status()).toBe(200);
  // 只有人力查看權、沒有門市細節編輯權：資料庫寫入規則擋下
  const overview = await as('w20_mgr_overview');
  expect((await overview.post(tools('headcount'), { data: headcount(main.id, s.VW001.id, 9, 'w20 無權') })).status()).toBe(403);
  const after = (await db.from('campaign_store_headcount').select('extra_support_count').eq('campaign_id', main.id).eq('store_id', s.VW001.id).maybeSingle()).data;
  expect(after.extra_support_count).toBe(2);
  // 督導依活動檢視範圍可寫全部門市
  const sup = await as('w20_sup_full');
  for (const code of ['ZT01', 'ZT02', 'VW001']) expect((await sup.post(tools('headcount'), { data: headcount(main.id, s[code].id, 1, 'w20 督導') })).status(), `督導寫 ${code}`).toBe(200);
});

test('Q6 本店活動人員：整批儲存帶版本，店長只能寫自己任命的門市', async () => {
  const s = await stores();
  const db = adminDb();
  const mgr = await as('w20_mgr_full');
  const get = await mgr.get(tools('ownStaff', `&campaign_id=${main.id}&store_id=${s.VW001.id}`));
  expect(get.status()).toBe(200);
  const version = (await get.json()).version;
  const put = await mgr.put(tools('ownStaff'), { data: { campaign_id: main.id, scope: s.VW001.id, rows: [{ employee_code: 'W20P001', employee_name: 'W20 測試人員', position: '店員' }], version, requestId: randomUUID() } });
  expect(put.status()).toBe(200);
  const rows = (await db.from('campaign_store_own_staff').select('employee_code,employee_name').eq('campaign_id', main.id).eq('store_id', s.VW001.id)).data || [];
  expect(rows).toEqual([{ employee_code: 'W20P001', employee_name: 'W20 測試人員' }]);
  // 過期版本不能覆蓋
  const stale = await mgr.put(tools('ownStaff'), { data: { campaign_id: main.id, scope: s.VW001.id, rows: [], version, requestId: randomUUID() } });
  expect(stale.status()).toBe(409);
  const zt = await mgr.put(tools('ownStaff'), { data: { campaign_id: main.id, scope: s.ZT01.id, rows: [{ employee_code: 'W20P002', employee_name: '越權', position: '' }], version: 0, requestId: randomUUID() } });
  expect(zt.status()).toBe(403);
  expect(((await db.from('campaign_store_own_staff').select('id').eq('campaign_id', main.id).eq('store_id', s.ZT01.id)).data || []).length).toBe(0);
});

test('Q6 Check List 勾選與備註：店長只能寫自己任命的門市；督導可寫全部', async () => {
  const s = await stores();
  const db = adminDb();
  const mgr = await as('w20_mgr_support');
  const body = (storeId: string, note: string) => ({ checklist_item_id: main.itemId, store_id: storeId, is_completed: true, manager_note: note, store_assigned_person: 'W20 負責人' });
  const ok = await mgr.post(tools('completions'), { data: body(s.VW001.id, 'w20 已完成') });
  expect(ok.status()).toBe(200);
  const row = (await db.from('campaign_checklist_completions').select('is_completed,manager_note,store_assigned_person').eq('checklist_item_id', main.itemId).eq('store_id', s.VW001.id).maybeSingle()).data;
  expect(row).toMatchObject({ is_completed: true, manager_note: 'w20 已完成', store_assigned_person: 'W20 負責人' });
  const zt = await mgr.post(tools('completions'), { data: body(s.ZT01.id, 'w20 越權') });
  expect(zt.status()).toBe(403);
  expect((await db.from('campaign_checklist_completions').select('id').eq('checklist_item_id', main.itemId).eq('store_id', s.ZT01.id).maybeSingle()).data).toBeNull();
  const sup = await as('w20_sup_full');
  expect((await sup.post(tools('completions'), { data: body(s.ZT02.id, 'w20 督導代填') })).status()).toBe(200);
});

test('Q6 支援指派：請求門市或支援門市任一是自己任命的門市才能指派；與自己無關的請求被擋', async () => {
  const db = adminDb();
  const mgr = await as('w20_mgr_support');
  const get = await mgr.get(tools('supportStaff', `&campaign_id=${main.id}&support_request_id=${main.requestVW001}`));
  expect(get.status()).toBe(200);
  const version = (await get.json()).version;
  const put = await mgr.put(tools('supportStaff'), { data: { campaign_id: main.id, scope: main.requestVW001, rows: [{ employee_code: 'W20S001', employee_name: 'W20 支援人員', position: '藥師' }], version, requestId: randomUUID() } });
  expect(put.status()).toBe(200);
  const rows = (await db.from('campaign_support_staff').select('employee_code').eq('support_request_id', main.requestVW001)).data || [];
  expect(rows.map((r: any) => r.employee_code)).toEqual(['W20S001']);
  const other = await mgr.put(tools('supportStaff'), { data: { campaign_id: main.id, scope: main.requestZT01, rows: [{ employee_code: 'W20S002', employee_name: '越權', position: '' }], version: 0, requestId: randomUUID() } });
  expect(other.status()).toBe(403);
  expect(((await db.from('campaign_support_staff').select('id').eq('support_request_id', main.requestZT01)).data || []).length).toBe(0);
  // 「請求我管轄門市出人」的清單：舊 SupportRequestModal 用 supporting_store_id 查，列的是由 VW001 出人的需求（ZT02 請求、VW001 支援）
  const s = await stores();
  const asSupporting = await mgr.get(tools('requests', `&campaign_id=${main.id}&supporting_store_id=${s.VW001.id}`));
  expect(asSupporting.status()).toBe(200);
  expect(((await asSupporting.json()).data as any[]).map((r) => r.id)).toEqual([main.requestFromVW001]);
  // 支援門市是自己任命的門市時同樣能指派
  const g2 = await mgr.get(tools('supportStaff', `&campaign_id=${main.id}&support_request_id=${main.requestFromVW001}`));
  const ok2 = await mgr.put(tools('supportStaff'), { data: { campaign_id: main.id, scope: main.requestFromVW001, rows: [{ employee_code: 'W20S003', employee_name: 'W20 出人', position: '店員' }], version: (await g2.json()).version, requestId: randomUUID() } });
  expect(ok2.status()).toBe(200);
  expect((((await db.from('campaign_support_staff').select('employee_code').eq('support_request_id', main.requestFromVW001)).data || []) as any[]).map((r) => r.employee_code)).toEqual(['W20S003']);
});

test('Q6 只有 view_own 的店長（沒有門市細節與支援指派權）不能寫人力預估與本店人員', async () => {
  const s = await stores();
  const mgr = await as('store_manager');
  expect((await mgr.post(tools('headcount'), { data: headcount(main.id, s.VW001.id, 1, 'w20 無權') })).status()).toBe(403);
  const get = await mgr.get(tools('ownStaff', `&campaign_id=${main.id}&store_id=${s.VW001.id}`));
  const version = get.ok() ? (await get.json()).version : 0;
  const put = await mgr.put(tools('ownStaff'), { data: { campaign_id: main.id, scope: s.VW001.id, rows: [], version, requestId: randomUUID() } });
  expect(put.status()).toBe(403);
});

test('停用的活動：填報相關讀取也一樣讀不到（檢視端一律隱藏）', async () => {
  const mgr = await as('w20_mgr_support'); // 沒有任何編輯權：停用的活動讀不到（有編輯／發布權限者例外，與活動列表相同）
  for (const resource of ['headcount', 'checklist', 'completions', 'requests', 'ownStaff']) {
    const res = await mgr.get(tools(resource, `&campaign_id=${off.id}`));
    expect(res.status(), `${resource} 停用的活動`).toBe(404);
  }
});
