import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { apiAs, TEST_ORIGIN } from '../support/auth';
import { adminDb, apiForUser, cleanupM6Stockout, runIdOrThrow, setupM6Users, stockoutCode, testStoreIds, type M6User } from '../support/m6-fixtures';
import { addDays, taipeiDate } from '../../lib/stockout/response';

/**
 * M6 第二批 W29：商品部缺貨回報 workspace API 的角色、權限與規則（正式區 has_permission 語意）。
 * 帳號（臨時，m6-test-*）：so_store_a（提交，管轄 VW001）、so_store_b（提交，管轄 VW002）、so_nostore（提交，沒有管轄門市）、
 *   so_responder（只有回覆）、so_viewer（只有查看全部）、so_plain（沒有任何缺貨權限）；另用 admin（應用層後備）。
 * 資料：ZT2038-<runId>-… 商品編號，只刪自己的；門市只用 VW001／VW002。
 */
const API = '/api/workspace/stockout';
const db = adminDb();
const today = () => taipeiDate(new Date());
let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
let sid: Record<string, string>;
const apis: Record<string, APIRequestContext> = {};

test.beforeAll(async () => {
  runIdOrThrow();
  await cleanupM6Stockout();
  ({ users, teardown } = await setupM6Users(['so_store_a', 'so_store_b', 'so_nostore', 'so_responder', 'so_viewer', 'so_plain']));
  sid = await testStoreIds();
  apis.admin = await apiAs('admin');
  for (const k of Object.keys(users)) apis[k] = await apiForUser(users[k]);
});
test.afterAll(async () => {
  for (const a of Object.values(apis)) await a.dispose();
  await cleanupM6Stockout();
  const left = await teardown();
  expect(left, `清除臨時帳號：${left.join('; ')}`).toEqual([]);
});

const code = (t: string) => stockoutCode(t);
const seedReport = async (c: string, storeKey: string, by: string, over: Record<string, unknown> = {}) => {
  const r = await db.from('stockout_reports').insert({ store_id: sid[storeKey], product_code: c, product_name: `名稱-${c.slice(-6)}`, required_qty: 2, reported_by: users[by].id, status: 'pending', ...over }).select().single();
  expect(r.error, JSON.stringify(r.error)).toBeNull();
  return r.data as { id: string; created_at: string; status: string };
};
const seedResponse = async (c: string, eta: string | null, by = 'so_responder') => {
  const r = await db.from('stockout_product_responses').upsert({ product_code: c, product_name: `名稱-${c.slice(-6)}`, response_content: `回覆-${c.slice(-6)}`, eta_date: eta, responded_by: users[by].id, responded_at: new Date().toISOString() }, { onConflict: 'product_code' }).select().single();
  expect(r.error, JSON.stringify(r.error)).toBeNull();
  return r.data;
};
const list = async (key: string, params: Record<string, string> = {}) => {
  const res = await apis[key].get(API, { params });
  return { status: res.status(), body: await res.json() };
};
const post = async (key: string, data: Record<string, unknown>) => {
  const res = await apis[key].post(API, { data });
  return { status: res.status(), body: await res.json() };
};
const respond = async (key: string, data: Record<string, unknown>) => {
  const res = await apis[key].post(`${API}/respond`, { data });
  return { status: res.status(), body: await res.json() };
};
const reportRows = async (c: string) => ((await db.from('stockout_reports').select('*').eq('product_code', c)).data || []) as any[];
const responseRow = async (c: string) => (await db.from('stockout_product_responses').select('*').eq('product_code', c).maybeSingle()).data as any;
const historyRows = async (c: string) => ((await db.from('stockout_product_response_history').select('*').eq('product_code', c).order('responded_at')).data || []) as any[];
const body = (c: string, store = 'VW001', over: Record<string, unknown> = {}) => ({ store_id: sid[store], product_code: c, product_name: `名稱-${c.slice(-6)}`, required_qty: 3, ...over });
const itemsFor = (b: any, prefix: string) => (b.items as any[]).filter((r) => String(r.product_code).startsWith(prefix));

test('導覽與 capabilities：有任一缺貨權限者看得到「商品部」（kind merchandise）；沒有權限者沒有入口', async () => {
  const expected: Record<string, boolean> = { admin: true, so_store_a: true, so_store_b: true, so_nostore: true, so_responder: true, so_viewer: true, so_plain: false };
  for (const [key, ok] of Object.entries(expected)) {
    const session = await (await apis[key].get('/api/workspace/session')).json();
    expect(session.capabilities.stockout, `${key} capabilities.stockout`).toBe(ok);
    const items = session.navigation.flatMap((g: { items: { href: string; kind?: string }[] }) => g.items);
    const item = items.find((i: { href: string }) => i.href === '/cross-dept/merchandise');
    expect(!!item, `${key} 導覽「商品部」`).toBe(ok);
    if (item) expect(item.kind).toBe('merchandise');
    for (const i of items) expect(JSON.stringify(i)).not.toContain('併購');
  }
});

test('未登入全部 401；寫入 API 檢查 Origin（403）', async () => {
  const bare = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  try {
    expect((await bare.get(API)).status()).toBe(401);
    expect((await bare.get(`${API}/responses`)).status()).toBe(401);
    expect((await bare.get(`${API}/history?product_code=x`)).status()).toBe(401);
    expect((await bare.post(API, { data: {} })).status()).toBe(401);
    expect((await bare.post(`${API}/respond`, { data: {} })).status()).toBe(401);
  } finally {
    await bare.dispose();
  }
  const bad = await pwRequest.newContext({ baseURL: TEST_ORIGIN, storageState: await apis.so_store_a.storageState(), extraHTTPHeaders: { Origin: 'http://invalid.test' } });
  try {
    const c = code('ORIGIN');
    expect((await bad.post(API, { data: body(c) })).status()).toBe(403);
    expect((await bad.post(`${API}/respond`, { data: { product_code: c } })).status()).toBe(403);
    expect((await bad.delete(`${API}/00000000-0000-4000-8000-000000000000`)).status()).toBe(403);
  } finally {
    await bad.dispose();
  }
  expect(await reportRows(code('ORIGIN'))).toEqual([]);
});

test('權限矩陣：清單、回覆查詢、歷程、回報、回覆、刪除回覆', async () => {
  const c = code('MATRIX');
  const matrix: Record<string, { list: number; listAll: number; responses: number; history: number; post: number; respond: number }> = {
    so_plain: { list: 403, listAll: 403, responses: 403, history: 403, post: 403, respond: 403 },
    so_store_a: { list: 200, listAll: 403, responses: 200, history: 200, post: 201, respond: 403 },
    so_nostore: { list: 200, listAll: 403, responses: 200, history: 200, post: 403, respond: 403 },
    so_responder: { list: 200, listAll: 200, responses: 200, history: 200, post: 201, respond: 200 },
    so_viewer: { list: 200, listAll: 200, responses: 200, history: 200, post: 201, respond: 200 },
    admin: { list: 200, listAll: 200, responses: 200, history: 200, post: 201, respond: 200 },
  };
  for (const [key, want] of Object.entries(matrix)) {
    const tag = key.replace('_', '-');
    expect((await apis[key].get(API)).status(), `${key} 清單（預設分頁）`).toBe(want.list);
    expect((await apis[key].get(API, { params: { tab: 'all' } })).status(), `${key} 全部門市`).toBe(want.listAll);
    expect((await apis[key].get(`${API}/responses`, { params: { product_codes: c } })).status(), `${key} 回覆查詢`).toBe(want.responses);
    expect((await apis[key].get(`${API}/history`, { params: { product_code: c } })).status(), `${key} 歷程`).toBe(want.history);
    expect((await apis[key].post(API, { data: body(code(`MX-${tag}`)) })).status(), `${key} 回報`).toBe(want.post);
    expect((await apis[key].post(`${API}/respond`, { data: { product_code: code(`MR-${tag}`), product_name: 'n', response_content: 'c', eta_date: addDays(today(), 3) } })).status(), `${key} 回覆`).toBe(want.respond);
    const del = await apis[key].delete(`${API}/responses/${encodeURIComponent(code(`MR-${tag}`))}`);
    expect(del.status(), `${key} 刪除回覆`).toBe(want.respond);
  }
});

test('正式區 has_permission 語意：角色停用（roles.is_active=false）仍有權限；user_roles 失效即失去', async () => {
  const roleRow = (await db.from('roles').select('id').eq('code', 'm6_test_so_responder').single()).data;
  expect((await db.from('roles').update({ is_active: false }).eq('id', roleRow.id)).error).toBeNull();
  try {
    expect((await apis.so_responder.get(API, { params: { tab: 'all' } })).status()).toBe(200);
    expect((await respond('so_responder', { product_code: code('SEM'), product_name: 'n', response_content: 'c', eta_date: addDays(today(), 1) })).status).toBe(200);
  } finally {
    await db.from('roles').update({ is_active: true }).eq('id', roleRow.id);
  }
  expect((await db.from('user_roles').update({ is_active: false }).eq('user_id', users.so_viewer.id)).error).toBeNull();
  try {
    expect((await apis.so_viewer.get(API, { params: { tab: 'all' } })).status()).toBe(403);
  } finally {
    await db.from('user_roles').update({ is_active: true }).eq('user_id', users.so_viewer.id);
  }
});

test('預設分頁與門市範圍：提交者預設我的門市、看不到其他門市；商品部預設全部門市', async () => {
  const c1 = code('SCOPE-A');
  const c2 = code('SCOPE-B');
  await seedReport(c1, 'VW001', 'so_store_a');
  await seedReport(c2, 'VW002', 'so_store_b');
  const a = await list('so_store_a');
  expect(a.body.defaultTab).toBe('my-store');
  expect(a.body.capabilities).toEqual({ submit: true, viewAll: false, respond: false });
  expect(a.body.stores.map((s: any) => s.store_code)).toEqual(['VW001']);
  expect(itemsFor(a.body, c1.slice(0, -1)).map((r) => r.product_code).sort()).toEqual([c1]);
  // 想看別間門市（store_id）被擋；全部門市被擋
  expect((await list('so_store_a', { store_id: sid.VW002 })).status).toBe(403);
  expect((await list('so_store_a', { tab: 'all' })).status).toBe(403);
  // 沒有管轄門市的提交者：我的門市清單是空的
  const none = await list('so_nostore');
  expect(none.status).toBe(200);
  expect(none.body.items).toEqual([]);
  expect(none.body.stores).toEqual([]);
  // 商品部預設全部門市，看得到兩間
  for (const key of ['so_responder', 'so_viewer', 'admin']) {
    const r = await list(key, { tab: 'all', q: code('SCOPE-') });
    expect(r.body.defaultTab, key).toBe('all');
    expect(r.body.items.map((x: any) => x.product_code).sort(), key).toEqual([c1, c2]);
  }
  expect((await list('so_responder', { store_id: sid.VW002, q: code('SCOPE-') })).body.items.map((x: any) => x.product_code)).toEqual([c2]);
});

test('b：POST 回報伺服端驗證門市範圍；缺欄位與數量訊息沿用舊版', async () => {
  const c = code('POSTSCOPE');
  expect((await post('so_store_a', body(c, 'VW002'))).status).toBe(403);
  expect((await post('so_nostore', body(c, 'VW001'))).status).toBe(403);
  expect(await reportRows(c)).toEqual([]);
  const ok = await post('so_store_a', body(c, 'VW001'));
  expect(ok.status).toBe(201);
  expect(ok.body.data).toMatchObject({ store_id: sid.VW001, product_code: c, required_qty: 3, reported_by: users.so_store_a.id, status: 'pending' });
  // 商品部可替任一間門市回報；不存在的門市回 400
  expect((await post('so_responder', body(code('POSTSCOPE-B'), 'VW002'))).status).toBe(201);
  expect((await post('so_responder', { ...body(code('POSTSCOPE-C')), store_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
  expect((await post('so_store_a', { ...body(c), store_id: 'abc' })).status).toBe(400);
  // 欄位檢查
  const miss = await post('so_store_a', { ...body(code('POSTMISS')), product_name: '' });
  expect(miss.status).toBe(400);
  expect(miss.body.error).toBe('缺少必要欄位');
  expect((await post('so_store_a', { ...body(code('POSTMISS')), required_qty: 0 })).body.error).toBe('缺少必要欄位');
  expect((await post('so_store_a', { ...body(code('POSTMISS')), required_qty: 1.5 })).status).toBe(400);
  expect((await post('so_store_a', { ...body(code('POSTMISS')), required_qty: -2 })).status).toBe(400);
  expect(await reportRows(code('POSTMISS'))).toEqual([]);
});

test('C3：狀態與統計由目前有效回覆即時算出，不改寫資料；過期後自動回到待回覆', async () => {
  const prefix = code('DER-');
  const fresh = code('DER-FRESH'); // 預計到貨日在未來：有效
  const edge = code('DER-EDGE'); // 剛好 15 天：有效
  const stale = code('DER-STALE'); // 16 天：失效
  const none = code('DER-NONE'); // 沒有回覆
  const noEta = code('DER-NOETA'); // 回覆沒有預計到貨日：有效
  for (const c of [fresh, edge, stale, none, noEta]) await seedReport(c, 'VW001', 'so_store_a', { status: 'pending' }); // DB 欄位一律寫 pending
  await seedResponse(fresh, addDays(today(), 5));
  await seedResponse(edge, addDays(today(), -15));
  await seedResponse(stale, addDays(today(), -16));
  await seedResponse(noEta, null);
  const all = await list('so_responder', { tab: 'all', q: prefix, status: 'all' });
  const st = Object.fromEntries(all.body.items.map((r: any) => [r.product_code, r.status]));
  expect(st).toEqual({ [fresh]: 'responded', [edge]: 'responded', [stale]: 'pending', [none]: 'pending', [noEta]: 'responded' });
  expect(all.body.stats).toEqual({ reports: 5, pendingProducts: 2, respondedProducts: 3 });
  // 回應內帶有效旗標：過期回覆仍附在回報上（供「最近一次回覆」顯示），active=false
  expect(all.body.responses[stale]).toMatchObject({ active: false, reminder: true });
  expect(all.body.responses[fresh]).toMatchObject({ active: true, reminder: true });
  expect(all.body.responses[none]).toBeUndefined();
  // 篩選以衍生狀態為準
  const pending = await list('so_responder', { tab: 'all', q: prefix, status: 'pending' });
  expect(pending.body.items.map((r: any) => r.product_code).sort()).toEqual([none, stale]);
  const responded = await list('so_responder', { tab: 'all', q: prefix, status: 'responded' });
  expect(responded.body.items.map((r: any) => r.product_code).sort()).toEqual([edge, fresh, noEta]);
  // 資料欄位沒有被改寫（舊版的資料庫觸發器若存在，會在回覆時改寫；這裡以 seed 之後讀回確認新版 API 自己沒有寫）
  for (const r of await Promise.all([fresh, stale].map(reportRows))) expect(r.length).toBe(1);
  // 到貨日過期：把 fresh 的預計到貨日改成 16 天前，狀態自動回到待回覆
  await seedResponse(fresh, addDays(today(), -16));
  const after = await list('so_responder', { tab: 'all', q: fresh });
  expect(after.body.items[0].status).toBe('pending');
  // 店長視角看到同樣的狀態
  const mine = await list('so_store_a', { q: prefix, status: 'all' });
  expect(Object.fromEntries(mine.body.items.map((r: any) => [r.product_code, r.status]))[edge]).toBe('responded');
  // 超過 30 天不再提醒
  await seedResponse(edge, addDays(today(), -31));
  expect((await apis.so_store_a.get(`${API}/responses`, { params: { product_codes: edge } }).then((r) => r.json())).data[0]).toMatchObject({ active: false, reminder: false });
});

test('分頁：每頁 30、上限 100；超出頁碼收斂到最後一頁；關鍵字跳脫（逗號、括號、百分比、底線）', async () => {
  const prefix = code('PG-');
  const rows = Array.from({ length: 33 }, (_, i) => ({ store_id: sid.VW001, product_code: `${prefix}${String(i).padStart(2, '0')}`, product_name: i === 0 ? '含逗號,與(括號)100%_' : i === 1 ? '含逗號X與XX括號X100X_' : `分頁商品${i}`, required_qty: 1, reported_by: users.so_store_a.id, status: 'pending' }));
  expect((await db.from('stockout_reports').insert(rows)).error).toBeNull();
  const p1 = await list('so_store_a', { q: prefix, status: 'all' });
  expect(p1.body.pagination).toEqual({ page: 1, pageSize: 30, total: 33, totalPages: 2 });
  expect(p1.body.items.length).toBe(30);
  const p2 = await list('so_store_a', { q: prefix, status: 'all', page: '2' });
  expect(p2.body.items.length).toBe(3);
  const seen = new Set([...p1.body.items, ...p2.body.items].map((r: any) => r.id));
  expect(seen.size).toBe(33);
  // 超出頁碼收斂到最後一頁（與商品主檔一致）
  const p3 = await list('so_store_a', { q: prefix, status: 'all', page: '3' });
  expect(p3.body.pagination.page).toBe(2);
  expect(p3.body.items.length).toBe(3);
  expect((await list('so_store_a', { q: prefix, status: 'all', pageSize: '1000' })).body.pagination.pageSize).toBe(100);
  expect((await list('so_store_a', { q: prefix, status: 'all', pageSize: '10' })).body.pagination).toEqual({ page: 1, pageSize: 10, total: 33, totalPages: 4 });
  expect((await list('so_store_a', { q: prefix, status: 'all', pageSize: 'abc', page: '-1' })).body.pagination.page).toBe(1);
  // 跳脫：逗號、括號當一般文字；% 與 _ 是字面字元
  const hit = async (q: string) => (await list('so_store_a', { q, status: 'all' })).body.items.map((r: any) => r.product_code);
  expect(await hit('含逗號,與(括號)100%_')).toEqual([`${prefix}00`]);
  expect(await hit('100%')).toEqual([`${prefix}00`]);
  expect(await hit('x,product_name.ilike.%')).toEqual([]);
  expect((await list('so_store_a', { q: '),(product_code.ilike.%', status: 'all' })).status).toBe(200);
});

test('e：日期一律台北時間（月份分組、月份篩選）', async () => {
  const c = code('TZ');
  await seedReport(c, 'VW001', 'so_store_a', { created_at: '2038-02-28T16:30:00Z' }); // 台北 2038-03-01 00:30
  const mar = await list('so_store_a', { q: c, status: 'all', month: '2038-03' });
  expect(mar.body.items.map((r: any) => r.product_code)).toEqual([c]);
  expect((await list('so_store_a', { q: c, status: 'all', month: '2038-02' })).body.items).toEqual([]);
  // 月份彙總歸在台北月份（舊版取 UTC 前七碼會得到 2038-02）
  const all = await list('so_store_a', { q: c, status: 'all' });
  expect(all.body.monthBuckets).toEqual([{ month: '2038-03', count: 1 }]);
  // 近 30 天：過去的回報不在範圍內
  const old = code('TZ-OLD');
  await seedReport(old, 'VW001', 'so_store_a', { created_at: new Date(Date.now() - 45 * 86400000).toISOString() });
  const recent = await list('so_store_a', { q: old, status: 'all', date_range: 'recent_30' });
  expect(recent.body.items).toEqual([]);
  expect((await list('so_store_a', { q: old, status: 'all' })).body.items.length).toBe(1);
  expect((await list('so_store_a', { q: old, status: 'all', month: 'bad' })).body.items.length).toBe(1);
});

test('C6：同門市同商品 7 天內重複回報要確認；確認後仍可送出；不同門市不受影響', async () => {
  const c = code('DUP');
  const first = await post('so_store_a', body(c));
  expect(first.status).toBe(201);
  const second = await post('so_store_a', body(c));
  expect(second.status).toBe(409);
  expect(second.body.code).toBe('DUPLICATE_RECENT');
  expect(second.body.duplicate).toMatchObject({ required_qty: 3 });
  expect(second.body.error).toContain('7 天');
  expect(await reportRows(c)).toHaveLength(1);
  const confirmed = await post('so_store_a', { ...body(c, 'VW001', { required_qty: 9 }), confirm_duplicate: true });
  expect(confirmed.status).toBe(201);
  expect(await reportRows(c)).toHaveLength(2);
  // 另一間門市（商品部替 VW002 回報）不算重複
  expect((await post('so_responder', body(c, 'VW002'))).status).toBe(201);
  // 8 天前的回報不算重複
  const old = code('DUP-OLD');
  await seedReport(old, 'VW001', 'so_store_a', { created_at: new Date(Date.now() - 8 * 86400000 - 3600_000 * 12).toISOString() });
  expect((await post('so_store_a', body(old))).status).toBe(201);
  // confirm_duplicate 不是 true 就不算（字串 "true" 不行）
  expect((await post('so_store_a', { ...body(c), confirm_duplicate: 'true' })).status).toBe(409);
});

test('回報時若商品已有有效回覆，寫入的 status 為 responded（沿用舊版），沒有或過期為 pending', async () => {
  const live = code('ST-LIVE');
  const dead = code('ST-DEAD');
  await seedResponse(live, addDays(today(), 2));
  await seedResponse(dead, addDays(today(), -16));
  expect((await post('so_store_a', body(live))).body.data.status).toBe('responded');
  expect((await post('so_store_a', body(dead))).body.data.status).toBe('pending');
  expect((await post('so_store_a', body(code('ST-NONE')))).body.data.status).toBe('pending');
});

test('i：商品部回覆 upsert 與歷程在同一交易；重複回覆只留一筆目前回覆、歷程累加', async () => {
  const c = code('RESP');
  const eta = addDays(today(), 4);
  const first = await respond('so_responder', { product_code: c, product_name: '回覆商品', response_content: ' 第一次 ', eta_date: eta });
  expect(first.status).toBe(200);
  expect(first.body.data).toMatchObject({ product_code: c, response_content: '第一次', eta_date: eta, responded_by: users.so_responder.id });
  const second = await respond('so_viewer', { product_code: c, product_name: '回覆商品', response_content: '第二次', eta_date: addDays(today(), 6) });
  expect(second.status).toBe(200);
  expect(second.body.data.id).toBe(first.body.data.id);
  expect((await responseRow(c)).response_content).toBe('第二次');
  const hist = await historyRows(c);
  expect(hist.map((h) => h.response_content)).toEqual(['第一次', '第二次']);
  expect(hist.every((h) => h.response_id === first.body.data.id)).toBe(true);
  // 檢查訊息
  for (const bad of [{ response_content: '' }, { eta_date: '' }, { product_name: '' }, { product_code: '' }]) {
    const r = await respond('so_responder', { product_code: c, product_name: 'n', response_content: 'c', eta_date: eta, ...bad });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('缺少必要欄位');
  }
  expect((await respond('so_responder', { product_code: c, product_name: 'n', response_content: 'c', eta_date: '2038-02-30' })).status).toBe(400);
  expect((await historyRows(c)).length).toBe(2);
});

test('i：交易失敗不留半套資料（回覆者不存在或缺欄位時，回覆與歷程都不寫入）', async () => {
  const c = code('ATOMIC');
  const bad = await db.rpc('workspace_stockout_respond', { p_code: c, p_name: 'n', p_content: 'c', p_eta: addDays(today(), 1), p_user: '00000000-0000-4000-8000-000000000001' });
  expect(bad.error).not.toBeNull();
  expect(await responseRow(c)).toBeNull();
  expect(await historyRows(c)).toEqual([]);
  const missing = await db.rpc('workspace_stockout_respond', { p_code: c, p_name: 'n', p_content: 'c', p_eta: null, p_user: users.so_responder.id });
  expect(String(missing.error?.message)).toContain('MISSING_FIELDS');
  expect(await responseRow(c)).toBeNull();
  // 既有回覆時，失敗的更新不會改動原本的回覆
  await respond('so_responder', { product_code: c, product_name: 'n', response_content: '原回覆', eta_date: addDays(today(), 3) });
  const again = await db.rpc('workspace_stockout_respond', { p_code: c, p_name: 'n', p_content: '壞回覆', p_eta: addDays(today(), 9), p_user: '00000000-0000-4000-8000-000000000001' });
  expect(again.error).not.toBeNull();
  expect((await responseRow(c)).response_content).toBe('原回覆');
  expect((await historyRows(c)).length).toBe(1);
});

test('i：兩個商品部同時回覆同一商品，只留一筆目前回覆，歷程兩筆', async () => {
  const c = code('RACE');
  const eta = addDays(today(), 2);
  const [a, b] = await Promise.all([
    respond('so_responder', { product_code: c, product_name: 'n', response_content: 'A', eta_date: eta }),
    respond('so_viewer', { product_code: c, product_name: 'n', response_content: 'B', eta_date: eta }),
  ]);
  expect([a.status, b.status]).toEqual([200, 200]);
  expect((await db.from('stockout_product_responses').select('id').eq('product_code', c)).data).toHaveLength(1);
  expect(await historyRows(c)).toHaveLength(2);
});

test('回覆歷程分頁：預設每頁 10、上限 50；依時間新到舊', async () => {
  const c = code('HIST');
  const rows = Array.from({ length: 12 }, (_, i) => ({ product_code: c, product_name: 'n', response_content: `h${i}`, eta_date: null, responded_by: users.so_responder.id, responded_at: new Date(Date.UTC(2038, 0, 1, 0, i)).toISOString() }));
  expect((await db.from('stockout_product_response_history').insert(rows)).error).toBeNull();
  const get = async (params: Record<string, string>) => (await apis.so_store_a.get(`${API}/history`, { params: { product_code: c, ...params } })).json();
  const p1 = await get({});
  expect(p1.pagination).toEqual({ page: 1, pageSize: 10, total: 12, totalPages: 2 });
  expect(p1.data.map((h: any) => h.response_content)).toEqual(['h11', 'h10', 'h9', 'h8', 'h7', 'h6', 'h5', 'h4', 'h3', 'h2']);
  expect((await get({ page: '2' })).data.map((h: any) => h.response_content)).toEqual(['h1', 'h0']);
  expect((await get({ pageSize: '999' })).pagination.pageSize).toBe(50);
  expect((await apis.so_store_a.get(`${API}/history`)).status()).toBe(400);
});

test('刪除回報（d）：提交者只能刪自己的；商品部可刪任意；最後一筆刪除會清掉目前回覆，歷程保留', async () => {
  const c = code('DEL');
  const mine = await seedReport(c, 'VW001', 'so_store_a');
  const theirs = await seedReport(c, 'VW002', 'so_store_b');
  await seedResponse(c, addDays(today(), 3));
  await db.from('stockout_product_response_history').insert({ product_code: c, product_name: 'n', response_content: 'h', eta_date: null, responded_by: users.so_responder.id });
  const del = (key: string, id: string) => apis[key].delete(`${API}/${id}`);
  // 別人的：404；沒有任何缺貨權限者（與舊版相同，沒有另外的權限閘門）：不是他的回報，也是 404；壞 id：400
  expect((await del('so_store_a', theirs.id)).status()).toBe(404);
  expect((await del('so_plain', mine.id)).status()).toBe(404);
  expect(await reportRows(c)).toHaveLength(2);
  expect((await del('so_store_a', 'abc')).status()).toBe(400);
  expect((await del('so_store_a', '00000000-0000-4000-8000-000000000000')).status()).toBe(404);
  // 自己的（還剩別人的一筆）：不清回覆
  const r1 = await del('so_store_a', mine.id);
  expect(r1.status()).toBe(200);
  expect(await r1.json()).toMatchObject({ success: true, clearedResponse: false });
  expect(await responseRow(c)).not.toBeNull();
  // 商品部刪掉最後一筆：回覆被清掉，歷程保留
  const r2 = await del('so_responder', theirs.id);
  expect(await r2.json()).toMatchObject({ success: true, clearedResponse: true });
  expect(await responseRow(c)).toBeNull();
  expect(await reportRows(c)).toEqual([]);
  expect((await historyRows(c)).length).toBe(1);
  // 已刪除：再刪回 404
  expect((await del('so_responder', theirs.id)).status()).toBe(404);
  // viewer 與 admin 也可刪任意
  const x = await seedReport(code('DEL-X'), 'VW001', 'so_store_a');
  expect((await del('so_viewer', x.id)).status()).toBe(200);
  const y = await seedReport(code('DEL-Y'), 'VW002', 'so_store_b');
  expect((await del('admin', y.id)).status()).toBe(200);
});

test('刪除商品部目前回覆（API 與舊版相同，畫面沒有按鈕）：只有回覆或查看全部；歷程保留', async () => {
  const c = code('DELRESP');
  await respond('so_responder', { product_code: c, product_name: 'n', response_content: 'c', eta_date: addDays(today(), 3) });
  expect((await apis.so_store_a.delete(`${API}/responses/${encodeURIComponent(c)}`)).status()).toBe(403);
  expect(await responseRow(c)).not.toBeNull();
  expect((await apis.so_viewer.delete(`${API}/responses/${encodeURIComponent(c)}`)).status()).toBe(200);
  expect(await responseRow(c)).toBeNull();
  expect((await historyRows(c)).length).toBe(1);
});

test('回覆查詢：product_codes 批次；沒帶代表全部（同舊版）；回應帶 active／reminder 旗標', async () => {
  const a = code('RQ-A');
  const b = code('RQ-B');
  await seedResponse(a, addDays(today(), 3));
  await seedResponse(b, addDays(today(), -20));
  const res = await (await apis.so_store_a.get(`${API}/responses`, { params: { product_codes: `${a},${b},${code('RQ-NONE')}` } })).json();
  expect(res.success).toBe(true);
  const by = Object.fromEntries(res.data.map((r: any) => [r.product_code, r]));
  expect(Object.keys(by).sort()).toEqual([a, b]);
  expect(by[a]).toMatchObject({ active: true, reminder: true });
  expect(by[b]).toMatchObject({ active: false, reminder: true });
  const all = await (await apis.so_store_a.get(`${API}/responses`)).json();
  expect(all.data.length).toBeGreaterThanOrEqual(2);
});
