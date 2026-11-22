import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiAs } from '../support/auth';
import { adminDb, apiForUser, cleanupM6Stockout, runIdOrThrow, setupM6Users, stockoutCode, testStoreIds, type M6User } from '../support/m6-fixtures';
import { assertNoUnlistedDiffs, ParityRecorder, type Diff } from '../support/parity';
import { addDays, taipeiDate } from '../../lib/stockout/response';

/**
 * M6 第二批 W29 對等：舊 /api/stockout-reports、/api/stockout-responses 與新 /api/workspace/stockout 對同一份資料各跑一遍。
 *  - 一致：回報清單（同門市、同關鍵字，逐筆與順序）、回覆查詢、回覆歷程、新增回報、商品部回覆（回覆與歷程）、刪除回報（含最後一筆清回覆）、各角色權限狀態碼；
 *  - 已登記差異：狀態改為即時衍生（C3）、7 天內重複回報提示（C6）、POST 與 GET 的門市範圍檢查、特殊字元搜尋跳脫、月份分組用台北時間。
 * 測試商品 ZT2038-<runId>-…，門市只用 VW001／VW002，只刪自己的。
 */
const recorder = new ParityRecorder('merchandise');
const db = adminDb();
const LR = '/api/stockout-reports';
const LS = '/api/stockout-responses';
const NATIVE = '/api/workspace/stockout';
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

const rec = (entry: string, title: string, role: string, diffs: Diff[], compared: Record<string, number | string | boolean>, mechanism: 'api-read' | 'write-readback' = 'api-read') => {
  const r = recorder.record({ entry, mechanism, role, title, legacy: { endpoint: `${LR} ${LS}（舊）` }, native: { endpoint: `${NATIVE}（新）` }, compared, diffs });
  assertNoUnlistedDiffs(r);
  expect(['pass', 'allowed', 'pending-approval'], `${entry}：${JSON.stringify(r.diffs)}`).toContain(r.status);
  return r;
};
const same = (key: string, l: unknown, n: unknown): Diff[] => (JSON.stringify(l) === JSON.stringify(n) ? [] : [{ kind: 'changed', key, legacy: l, native: n }]);
const seed = async (c: string, storeKey: string, by: string, over: Record<string, unknown> = {}) => {
  const r = await db.from('stockout_reports').insert({ store_id: sid[storeKey], product_code: c, product_name: `對等-${c.slice(-8)}`, required_qty: 2, reported_by: users[by].id, status: 'pending', ...over }).select().single();
  expect(r.error, JSON.stringify(r.error)).toBeNull();
  return r.data as { id: string };
};
const seedResponse = async (c: string, eta: string | null, by = 'so_responder') => {
  const r = await db.from('stockout_product_responses').upsert({ product_code: c, product_name: `對等-${c.slice(-8)}`, response_content: `回覆-${c.slice(-8)}`, eta_date: eta, responded_by: users[by].id, responded_at: new Date().toISOString() }, { onConflict: 'product_code' });
  expect(r.error).toBeNull();
};
const rows = async (table: string, c: string) => ((await db.from(table).select('*').eq('product_code', c)).data || []) as any[];

test('回報清單：同門市、同關鍵字，新舊逐筆（含順序）相同；各分頁參數結果相同', async () => {
  const p = stockoutCode('LST-');
  const base = Date.now() - 3 * 3600_000;
  for (let i = 0; i < 7; i++) await seed(`${p}${i}`, i % 2 ? 'VW001' : 'VW001', 'so_store_a', { created_at: new Date(base + i * 600_000).toISOString(), required_qty: i + 1 });
  await seed(`${p}x`, 'VW002', 'so_store_b');
  const diffs: Diff[] = [];
  for (const who of ['so_store_a', 'so_responder']) {
    for (const extra of [{}, { page: '2', pageSize: '3' }, { pageSize: '100' }, { q: `${p}1` }]) {
      const lp = { store_id: sid.VW001, q: p, ...extra };
      const np = { store_id: sid.VW001, q: p, status: 'all', ...extra };
      const l = await (await apis[who].get(LR, { params: lp })).json();
      const n = await (await apis[who].get(NATIVE, { params: { tab: who === 'so_store_a' ? 'my-store' : 'all', ...np } })).json();
      const pick = (r: any) => [r.id, r.product_code, r.product_name, r.required_qty, r.reported_by];
      diffs.push(...same(`${who}:${JSON.stringify(extra)}:items`, l.data.map(pick), n.items.map(pick)));
      diffs.push(...same(`${who}:${JSON.stringify(extra)}:total`, [l.pagination.total, l.pagination.pageSize], [n.pagination.total, n.pagination.pageSize]));
    }
  }
  rec('list-reports', '缺貨回報清單：同門市同關鍵字，新舊逐筆相同', 'so_store_a/so_responder', diffs, { combos: 8 });
  // 門市代號與名稱：舊版用呼叫者自己的身分讀 stores，商品部帳號讀不到（欄位為空）；新版以伺服端讀取，兩種角色都有
  const storeOf = async (who: string, legacy: boolean) => {
    const b = await (await apis[who].get(legacy ? LR : NATIVE, { params: legacy ? { store_id: sid.VW001, q: p } : { tab: who === 'so_store_a' ? 'my-store' : 'all', store_id: sid.VW001, q: p, status: 'all' } })).json();
    return (legacy ? b.data : b.items).map((r: any) => r.store?.store_code ?? null).slice(0, 1);
  };
  const sd: Diff[] = [...same('store-embed:so_store_a', await storeOf('so_store_a', true), await storeOf('so_store_a', false)), ...same('store-embed:so_responder', await storeOf('so_responder', true), await storeOf('so_responder', false))];
  rec('list-store-embed', '回報清單的門市代號與名稱：舊版商品部帳號讀不到（空白），新版都顯示', 'so_store_a/so_responder', sd, { roles: 2 });
});

test('狀態：舊版讀資料欄位（回覆時由資料庫觸發器改寫），新版由目前有效回覆即時算出——過期回覆的商品舊版仍顯示已回覆', async () => {
  const live = stockoutCode('STA-LIVE');
  const stale = stockoutCode('STA-STALE');
  await seed(live, 'VW001', 'so_store_a');
  await seed(stale, 'VW001', 'so_store_a');
  await seedResponse(live, addDays(today(), 4));
  await seedResponse(stale, addDays(today(), -16));
  const l = await (await apis.so_responder.get(LR, { params: { store_id: sid.VW001, q: stockoutCode('STA-') } })).json();
  const n = await (await apis.so_responder.get(NATIVE, { params: { tab: 'all', store_id: sid.VW001, q: stockoutCode('STA-'), status: 'all' } })).json();
  const st = (items: any[]) => Object.fromEntries(items.map((r) => [r.product_code, r.status]));
  const diffs: Diff[] = [];
  // 有效回覆：兩邊都是已回覆
  expect(st(n.items)[live]).toBe('responded');
  diffs.push(...same('status:live', st(l.data)[live], st(n.items)[live]));
  // 過期回覆：舊版資料欄位仍是 responded，新版衍生為 pending
  expect(st(n.items)[stale]).toBe('pending');
  diffs.push(...same('status:stale', st(l.data)[stale], st(n.items)[stale]));
  const r = rec('list-status', '回報狀態：過期回覆的商品，舊版（資料欄位）已回覆，新版（即時衍生）待回覆', 'so_responder', diffs, { checked: 2 });
  expect(r.diffs.some((d) => d.key === 'status:stale')).toBe(true);
});

test('回覆查詢與歷程：新舊相同（回覆內容、預計到貨日、歷程順序與分頁）', async () => {
  const c = stockoutCode('RSP');
  await seedResponse(c, addDays(today(), 2));
  const hist = Array.from({ length: 12 }, (_, i) => ({ product_code: c, product_name: 'n', response_content: `h${i}`, eta_date: i % 2 ? addDays(today(), i) : null, responded_by: users.so_responder.id, responded_at: new Date(Date.UTC(2038, 0, 1, 0, i)).toISOString() }));
  expect((await db.from('stockout_product_response_history').insert(hist)).error).toBeNull();
  const diffs: Diff[] = [];
  const submitOnly: Diff[] = []; // 只有提交權限者的歷程：舊版被資料表權限擋成空，另列一條
  for (const who of ['so_store_a', 'so_responder', 'so_viewer']) {
    const l = await (await apis[who].get(LS, { params: { product_codes: `${c},${stockoutCode('RSP-NONE')}` } })).json();
    const n = await (await apis[who].get(`${NATIVE}/responses`, { params: { product_codes: `${c},${stockoutCode('RSP-NONE')}` } })).json();
    const pick = (r: any) => [r.product_code, r.product_name, r.response_content, r.eta_date, r.responded_by];
    diffs.push(...same(`${who}:responses`, l.data.map(pick), n.data.map(pick)));
    for (const params of [{}, { page: '2' }, { pageSize: '5', page: '3' }, { pageSize: '999' }]) {
      const lh = await (await apis[who].get(LS, { params: { history: '1', product_code: c, ...params } })).json();
      const nh = await (await apis[who].get(`${NATIVE}/history`, { params: { product_code: c, ...params } })).json();
      const h = (b: any) => (b.data ? [b.data.map((x: any) => [x.id, x.response_content, x.eta_date]), b.pagination] : ['ERR', b.error]);
      (who === 'so_store_a' ? submitOnly : diffs).push(...same(`${who}:history:${JSON.stringify(params)}`, h(lh), h(nh)));
    }
  }
  rec('responses-history', '商品部回覆查詢（所有角色）與回覆歷程（商品部角色）：新舊逐筆相同', 'so_store_a/so_responder/so_viewer', diffs, { roles: 3 });
  const rs = rec('history-visible-submit', '只有提交權限（店長）的回覆歷程：舊版被資料表權限擋成空，新版看得到', 'so_store_a', submitOnly, { checked: 4 });
  expect(rs.diffs.length).toBeGreaterThan(0);
});

test('新增回報：同門市送出的資料相同；舊版不驗門市範圍、不提示重複（兩項為已登記差異）', async () => {
  const L = stockoutCode('PST-L');
  const N = stockoutCode('PST-N');
  const send = async (who: string, legacy: boolean, c: string, store: string, extra: Record<string, unknown> = {}) => {
    const res = await apis[who].post(legacy ? LR : NATIVE, { data: { store_id: sid[store], product_code: c, product_name: `對等-${c.slice(-8)}`, required_qty: 4, ...extra } });
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  };
  const diffs: Diff[] = [];
  const l1 = await send('so_store_a', true, L, 'VW001');
  const n1 = await send('so_store_a', false, N, 'VW001');
  expect([l1.status, n1.status]).toEqual([200, 201]);
  const pick = (r: any, code: string) => [r.store_id === sid.VW001, r.product_code === code, r.product_name.replace(code.slice(-8), '#'), r.required_qty, r.reported_by === users.so_store_a.id, r.status];
  diffs.push(...same('post:data', pick(l1.body.data, L), pick(n1.body.data, N)));
  // 缺欄位：兩邊訊息相同
  const lm = await send('so_store_a', true, '', 'VW001');
  const nm = await send('so_store_a', false, '', 'VW001');
  diffs.push(...same('post:missing', [lm.status, lm.body.error], [nm.status, nm.body.error]));
  // 沒有權限
  const lp = await send('so_plain', true, L + '-X', 'VW001');
  const np = await send('so_plain', false, N + '-X', 'VW001');
  diffs.push(...same('post:no-permission', lp.status, np.status));
  rec('post-report', '新增缺貨回報：資料與缺欄位、無權限結果相同', 'so_store_a/so_plain', diffs, { checked: 3 }, 'write-readback');

  // 已回報過的商品 7 天內再送：舊版直接寫入，新版回 409 要確認
  const l2 = await send('so_store_a', true, L, 'VW001');
  const n2 = await send('so_store_a', false, N, 'VW001');
  const d2: Diff[] = same('post-duplicate-warning', l2.status === 200 ? '直接新增' : `HTTP ${l2.status}`, n2.status === 409 ? '先提示、確認後才新增' : `HTTP ${n2.status}`);
  expect(n2.status).toBe(409);
  expect(l2.status).toBe(200);
  const r2 = rec('post-duplicate-warning', '同門市同商品 7 天內再次回報：舊版直接新增，新版先提示、確認後才新增', 'so_store_a', d2, { legacyRows: (await rows('stockout_reports', L)).length, nativeRows: (await rows('stockout_reports', N)).length });
  expect(r2.diffs).toHaveLength(1);

  // 別間門市：舊版不驗證（寫入成功），新版 403
  const l3 = await send('so_store_a', true, L + '-S', 'VW002');
  const n3 = await send('so_store_a', false, N + '-S', 'VW002');
  expect(l3.status).toBe(200);
  expect(n3.status).toBe(403);
  const r3 = rec('post-store-scope', '提交者替自己沒管轄的門市回報：舊版成功寫入，新版擋下', 'so_store_a', same('post-store-scope', l3.status, n3.status), { legacy: l3.status, native: n3.status });
  expect(r3.diffs).toHaveLength(1);
  // 商品部可替任何門市回報：兩邊相同
  const l4 = await send('so_responder', true, L + '-R', 'VW002');
  const n4 = await send('so_responder', false, N + '-R', 'VW002');
  rec('post-report-staff', '商品部替任一門市回報：新舊相同', 'so_responder', same('post:staff', [l4.status, l4.body.data.status], [200, n4.body.data.status]), { checked: 1 }, 'write-readback');
  expect(n4.status).toBe(201);
});

test('商品部回覆：回覆、更新、歷程與資料表最後內容相同', async () => {
  const L = stockoutCode('RPY-L');
  const N = stockoutCode('RPY-N');
  const eta = addDays(today(), 5);
  const diffs: Diff[] = [];
  for (const [legacy, c] of [[true, L], [false, N]] as const) {
    for (const [content, d] of [['  第一次  ', eta], ['第二次', addDays(today(), 9)]] as const) {
      const res = await apis.so_responder.post(legacy ? LS : `${NATIVE}/respond`, { data: { product_code: c, product_name: '對等商品', response_content: content, eta_date: d } });
      expect(res.status(), `${legacy ? '舊' : '新'} 回覆`).toBe(200);
    }
  }
  const snap = async (c: string) => ({
    resp: (await rows('stockout_product_responses', c)).map((r) => [r.product_name, r.response_content, r.eta_date, r.responded_by]),
    hist: (await rows('stockout_product_response_history', c)).sort((a, b) => a.responded_at.localeCompare(b.responded_at)).map((r) => [r.response_content, r.eta_date, r.responded_by, !!r.response_id]),
  });
  const l = await snap(L);
  const n = await snap(N);
  diffs.push(...same('reply:response-row', l.resp, n.resp), ...same('reply:history-rows', l.hist, n.hist));
  expect(n.hist).toHaveLength(2);
  // 缺欄位與沒有權限：訊息與狀態碼相同
  const bad = { product_code: L, product_name: 'n', response_content: '', eta_date: eta };
  const lb = await apis.so_responder.post(LS, { data: bad });
  const nb = await apis.so_responder.post(`${NATIVE}/respond`, { data: bad });
  diffs.push(...same('reply:missing', [lb.status(), (await lb.json()).error], [nb.status(), (await nb.json()).error]));
  for (const who of ['so_store_a', 'so_plain', 'so_nostore']) {
    const lp = await apis[who].post(LS, { data: { product_code: L, product_name: 'n', response_content: 'c', eta_date: eta } });
    const np = await apis[who].post(`${NATIVE}/respond`, { data: { product_code: N, product_name: 'n', response_content: 'c', eta_date: eta } });
    diffs.push(...same(`reply:forbidden:${who}`, lp.status(), np.status()));
  }
  rec('reply-write', '商品部回覆：資料表與歷程最後內容相同（舊版兩次獨立寫入，新版同一交易）', 'so_responder', diffs, { replies: 4 }, 'write-readback');
});

test('刪除回報：本人與商品部的規則、最後一筆清回覆、歷程保留，新舊相同', async () => {
  const diffs: Diff[] = [];
  const run = async (legacy: boolean, c: string) => {
    const mine = await seed(c, 'VW001', 'so_store_a');
    const theirs = await seed(c, 'VW002', 'so_store_b');
    await seedResponse(c, addDays(today(), 3));
    await db.from('stockout_product_response_history').insert({ product_code: c, product_name: 'n', response_content: 'h', eta_date: null, responded_by: users.so_responder.id });
    const del = async (who: string, id: string) => {
      const res = await apis[who].delete(legacy ? `${LR}?id=${id}` : `${NATIVE}/${id}`);
      const b = await res.json().catch(() => ({}));
      return [res.status(), b.error ?? null, b.clearedResponse ?? null];
    };
    const out: unknown[] = [];
    out.push(await del('so_store_a', theirs.id)); // 別人的：404
    out.push(await del('so_plain', mine.id)); // 無權限
    out.push(await del('so_store_a', mine.id)); // 自己的，還有別人的：不清回覆
    out.push((await rows('stockout_product_responses', c)).length);
    out.push(await del('so_responder', theirs.id)); // 商品部刪最後一筆：清回覆
    out.push((await rows('stockout_product_responses', c)).length, (await rows('stockout_product_response_history', c)).length);
    out.push(await del('so_responder', theirs.id)); // 已不存在
    return out;
  };
  const l = await run(true, stockoutCode('DLR-L'));
  const n = await run(false, stockoutCode('DLR-N'));
  // 舊版刪除沒有權限與壞 id 的訊息，兩邊以狀態碼與結果比對
  diffs.push(...same('delete:flow', l, n));
  rec('delete-report', '刪除回報：本人／商品部規則、最後一筆清掉回覆、歷程保留，新舊相同', 'so_store_a/so_responder', diffs, { steps: l.length }, 'write-readback');
});

test('權限狀態碼：各角色打回覆查詢、歷程、回覆的結果，新舊相同', async () => {
  const c = stockoutCode('PRM');
  const diffs: Diff[] = [];
  const status = async (who: string, legacy: boolean) => {
    const out: number[] = [];
    out.push((await apis[who].get(legacy ? LS : `${NATIVE}/responses`, { params: { product_codes: c } })).status());
    out.push((await apis[who].get(legacy ? LS : `${NATIVE}/history`, { params: legacy ? { history: '1', product_code: c } : { product_code: c } })).status());
    out.push((await apis[who].post(legacy ? LS : `${NATIVE}/respond`, { data: { product_code: c, product_name: 'n', response_content: 'c', eta_date: addDays(today(), 3) } })).status());
    out.push((await apis[who].delete(legacy ? `${LS}?product_code=${encodeURIComponent(c)}` : `${NATIVE}/responses/${encodeURIComponent(c)}`)).status());
    return out;
  };
  for (const who of ['so_plain', 'so_store_a', 'so_nostore', 'so_responder', 'admin']) diffs.push(...same(`perm:${who}`, await status(who, true), await status(who, false)));
  rec('permission-status', '各角色對回覆查詢、歷程、回覆、刪除回覆的狀態碼：新舊相同', 'all', diffs, { roles: 5 });
  // 只有查看全部（view_all）：舊版 API 放行回覆，但資料表只允許回覆權限寫入（500）；新版 API 照舊版的權限判斷放行並寫入
  const lv = await status('so_viewer', true);
  const nv = await status('so_viewer', false);
  expect(nv).toEqual([200, 200, 200, 200]);
  const rv = rec('viewall-reply', '只有查看全部的帳號回覆：舊版被資料表擋下（500），新版可回覆', 'so_viewer', same('perm:so_viewer', lv, nv), { legacy: JSON.stringify(lv), native: JSON.stringify(nv) });
  expect(rv.diffs.length).toBeGreaterThan(0);
});

test('查看門市範圍：舊版任何有提交權限者可指定任一門市看回報，新版只看得到自己管轄的門市', async () => {
  const c = stockoutCode('SCP');
  await seed(c, 'VW002', 'so_store_b');
  const l = await apis.so_store_a.get(LR, { params: { store_id: sid.VW002, q: c } });
  const n = await apis.so_store_a.get(NATIVE, { params: { store_id: sid.VW002, q: c, status: 'all' } });
  expect(l.status()).toBe(200);
  expect((await l.json()).data).toHaveLength(1);
  expect(n.status()).toBe(403);
  const r = rec('list-store-scope', '提交者指定別間門市查看回報：舊版看得到，新版 403', 'so_store_a', same('list-store-scope', l.status(), n.status()), { legacy: l.status(), native: n.status() });
  expect(r.diffs).toHaveLength(1);
  // 沒有管轄門市的提交者：舊版（無門市條件）403；指定門市時舊版看得到，新版 403
  const l2 = await apis.so_nostore.get(LR, { params: { store_id: sid.VW002, q: c } });
  const n2 = await apis.so_nostore.get(NATIVE, { params: { store_id: sid.VW002, q: c, status: 'all' } });
  expect([l2.status(), n2.status()]).toEqual([200, 403]);
  rec('list-store-scope', '沒有管轄門市的提交者指定門市查看回報', 'so_nostore', same('list-store-scope', l2.status(), n2.status()), { legacy: l2.status(), native: n2.status() });
});

test('關鍵字：逗號、括號、百分比舊版改寫條件，新版當一般文字', async () => {
  const p = stockoutCode('ESC-');
  await seed(`${p}1`, 'VW001', 'so_store_a');
  await seed(`${p}2`, 'VW001', 'so_store_a', { product_name: '含逗號,與(括號)100%' });
  const diffs: Diff[] = [];
  for (const q of ['x,product_name.ilike.%', '),(product_code.ilike.%', '100%']) {
    const l = await apis.so_store_a.get(LR, { params: { store_id: sid.VW001, q } });
    const n = await apis.so_store_a.get(NATIVE, { params: { store_id: sid.VW001, q, status: 'all' } });
    expect(n.status(), `新 ${q}`).toBe(200);
    const lrows = l.status() === 200 ? (await l.json()).data.map((r: any) => r.product_code).filter((x: string) => x.startsWith(p)) : `HTTP ${l.status()}`;
    const nrows = (await n.json()).items.map((r: any) => r.product_code);
    diffs.push(...same(`escape:${q}`, lrows, nrows));
  }
  // 新版：% 是字面字元，只命中名稱含「100%」的那筆
  const hit = await (await apis.so_store_a.get(NATIVE, { params: { store_id: sid.VW001, q: '100%', status: 'all' } })).json();
  expect(hit.items.map((r: any) => r.product_code)).toEqual([`${p}2`]);
  const r = rec('search-escape', '關鍵字含特殊字元：舊版改寫條件，新版當一般文字', 'so_store_a', diffs, { queries: 3 });
  expect(r.diffs.length).toBeGreaterThan(0);
});

test('月份分組與篩選：舊版取 UTC 前七碼，新版用台北時間', async () => {
  const c = stockoutCode('MON');
  await seed(c, 'VW001', 'so_store_a', { created_at: '2038-02-28T16:30:00Z' }); // 台北 3/1 00:30
  const l = await (await apis.so_store_a.get(LR, { params: { store_id: sid.VW001, q: c } })).json();
  const n = await (await apis.so_store_a.get(NATIVE, { params: { store_id: sid.VW001, q: c, status: 'all' } })).json();
  const diffs = same('month-bucket', l.monthBuckets, n.monthBuckets);
  expect(l.monthBuckets).toEqual([{ month: '2038-02', count: 1 }]);
  expect(n.monthBuckets).toEqual([{ month: '2038-03', count: 1 }]);
  // 月份篩選：舊版用 +08:00，兩邊篩選相同（舊版的篩選本來就是台北時間，不一致的是分組）
  const lf = await (await apis.so_store_a.get(LR, { params: { store_id: sid.VW001, q: c, month: '2038-03' } })).json();
  const nf = await (await apis.so_store_a.get(NATIVE, { params: { store_id: sid.VW001, q: c, status: 'all', month: '2038-03' } })).json();
  diffs.push(...same('month-filter', lf.data.map((r: any) => r.id), nf.items.map((r: any) => r.id)));
  const r = rec('month-bucket', '月份分組：舊版 UTC，新版台北時間（篩選相同）', 'so_store_a', diffs, { buckets: 1 });
  expect(r.diffs.some((d) => d.key === 'month-bucket')).toBe(true);
});
