import { expect, request as pwRequest, test, type APIRequestContext } from '@playwright/test';
import { TEST_ORIGIN } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import { adminDb, assertGaBaseline, cleanupM7M8, stores } from '../support/m7m8-fixtures';
import { ga6Name, seedGa6Vendor, setupGa6Users, type Ga6Key, type Ga6User } from '../support/m7m8-ga6-fixtures';
import { dayOffset, oracle, seedAttention, seedPo, transferDays, type AttentionSeed } from '../support/m7m8-ga6-home-fixtures';
import { callFn } from '../support/m7m8-fixtures';
import { shiftMonth, taipeiToday } from '../../lib/workspace/general-affairs/utility-bill-rules';

// M7/M8 第 6 批 G22／G24（API 層）：/api/workspace/general-affairs/vendor-stats、purchase-analysis、home/summary、home/badges，
// 以及九項待辦的列表 attention 篩選（需求單、我的追蹤、採購單、待簽核、工單、廠商、帳單、調撥、貼標複核）。
// 涵蓋：未登入 401、權限矩陣 403、輸入驗證 400、不支援的方法 405、分頁 meta 與上限 100、回應不含帳務機密欄位與評價、
//      「徽章數字＝點進去列表總筆數」九項逐一用真實 API 比對（總務全套、核准人、採購人員、店長各自）、不合法的 attention 值 400、
//      導覽旗標與側欄項目（合作紀錄、採購分析只對有權限者出現，並與 API 放行條件一致）。
// 測試資料只放 VW／ZT 測試門市與 2038 年，名稱帶 QA-GA6- 標記；結束只清自己的。與其他整合檔一樣循序執行。
const B = '/api/workspace/general-affairs';
const KEYS: Ga6Key[] = ['ga_all', 'approver', 'coop_only', 'cat_only', 'store_mgr', 'store_req', 'util_mgr', 'rq_manager', 'wo_works', 'purchaser', 'vendor_mgr', 'nobody', 'admin'];
let users: Record<string, Ga6User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let st: Awaited<ReturnType<typeof stores>>;
let seed: AttentionSeed;
const apis: Record<string, APIRequestContext> = {};
const today = taipeiToday();
const j = async (r: any) => ({ status: r.status() as number, body: await r.json().catch(() => ({})), text: await r.text().catch(() => '') });
const get = async (k: string, p: string) => j(await apis[k].get(B + p));
const fn = (who: Ga6Key, name: string, args: Record<string, unknown> = {}) => callFn(users[who].client, name, args);

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(420_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  st = await stores();
  const made = await setupGa6Users(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
  for (const k of KEYS) apis[k] = await apiForUser(users[k] as any);
  seed = await seedAttention(users.ga_all.id, 'API');
  const PAST = shiftMonth(`${today.slice(0, 7)}-01`, -3);
  void PAST;
  for (const [i, over] of [{ due_date: dayOffset(-3) }, { due_date: dayOffset(-1), expense_type: 'ELECTRICITY', electricity_kwh: 10 }, { due_date: today, expense_type: 'PHONE' }].entries()) {
    const r = await fn('util_mgr', 'ga_ws_ub_save', { p_id: null, p_payload: { store_id: st.VW001.id, expense_type: 'WATER', billing_month: '2038-09', provider_name: ga6Name('AB'), service_identifier: `QA-GA6-AB-${i}`, amount: 800, ...over }, p_expected_updated_at: null, p_confirm_paid_change: false });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  for (const a of Object.values(apis)) await a.dispose();
  const a = await cleanupM7M8();
  const b = await teardownUsers();
  const rest = [...a, ...b];
  if (rest.length) throw new Error(`清除殘留：${rest.join('; ')}`);
});

test('未登入一律 401（績效、採購分析、首頁、徽章）；不支援的方法 405、未知路徑 404', async () => {
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  for (const p of ['/vendor-stats', '/purchase-analysis', '/home/summary', '/home/badges']) expect((await anon.get(B + p)).status(), p).toBe(401);
  await anon.dispose();
  for (const [p, who] of [['/vendor-stats', 'ga_all'], ['/purchase-analysis', 'ga_all'], ['/home/summary', 'ga_all'], ['/home/badges', 'ga_all']] as const) {
    const r = await j(await apis[who].post(B + p, { data: {}, headers: { Origin: TEST_ORIGIN } }));
    expect(r.status, `POST ${p}`).toBe(405);
  }
  expect((await get('ga_all', '/home/other')).status).toBe(404);
  expect((await get('ga_all', '/vendor-stats/extra')).status).toBe(404);
  expect((await get('ga_all', '/purchase-analysis/extra')).status).toBe(404);
});

test('績效 API：合作紀錄檢視者 200（只有名稱與統計、沒有帳務機密與評價欄位）；其他一律 403；區間格式 400、起迄顛倒 400、超過 36 個月 400', async () => {
  const v = await seedGa6Vendor('apiperf', { tax_id: '04595257', payment_terms: '月結 30 天', billing_title: '帳務抬頭' });
  await seedPo('api-perf', { status: 'ORDERED', vendor_id: v.id, vendor_name_snapshot: v.name, ordered_at: '2038-02-10T02:00:00Z', total_amount: 1234 });
  for (const who of ['ga_all', 'coop_only']) {
    const r = await get(who, '/vendor-stats?from=2038-01&to=2038-03');
    expect(r.status, `${who} ${r.text}`).toBe(200);
    const row = (r.body.data.rows as any[]).find((x) => x.vendor_id === v.id);
    if (who === 'ga_all') {
      expect(r.body.data.can_view_po_amount).toBe(true);
      expect(row).toMatchObject({ po_amount: 1234, insufficient: true });
    } else {
      // 決定 3（2026-11-18）：沒有採購單檢視權限者，只有採購單的廠商不列出，金額由資料庫回 null
      expect(r.body.data.can_view_po_amount).toBe(false);
      expect(row).toBeUndefined();
      expect(r.text).not.toMatch(/"po_(amount|amount_total)":\s*-?\d/);
    }
    for (const k of ['tax_id', 'billing_title', 'payment_terms', 'invoice_type', 'rating', 'review_count', 'work_order_count']) expect(r.text, `${who} ${k}`).not.toContain(`"${k}"`);
    expect(r.text).not.toContain('04595257');
  }
  for (const who of ['approver', 'cat_only', 'store_mgr', 'store_req', 'util_mgr', 'rq_manager', 'wo_works', 'purchaser', 'vendor_mgr', 'nobody', 'admin']) {
    expect((await get(who, '/vendor-stats')).status, who).toBe(403);
  }
  for (const q of ['from=2038-13', 'to=abc', 'from=2038-05&to=2038-04', 'from=2030-01&to=2038-04']) expect((await get('ga_all', `/vendor-stats?${q}`)).status, q).toBe(400);
  const def = await get('ga_all', '/vendor-stats');
  expect(def.status).toBe(200);
  expect(def.body.data.to).toBe(today.slice(0, 7));
});

test('採購分析 API：採購評估檢視／管理者 200（含 meta 分頁）；核准人、需求單管理與其他一律 403；月份格式 400；pageSize 上限 100', async () => {
  const v = await seedGa6Vendor('apipa');
  for (let i = 0; i < 3; i += 1) await seedPo(`api-pa-${i}`, { status: i === 2 ? 'RECEIVED' : 'ORDERED', vendor_id: v.id, vendor_name_snapshot: v.name, ordered_at: `2038-09-0${i + 1}T02:00:00Z`, total_amount: 100 * (i + 1), subtotal: 100 * (i + 1) });
  for (const who of ['ga_all', 'purchaser']) {
    const r = await get(who, '/purchase-analysis?yearMonth=2038-09&pageSize=2&page=1');
    expect(r.status, `${who} ${r.text}`).toBe(200);
    expect(r.body.data.confirmed).toMatchObject({ count: 3, total_amount: 600 });
    expect(r.body.data.orders).toHaveLength(2);
    expect(r.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    const p2 = await get(who, '/purchase-analysis?yearMonth=2038-09&pageSize=2&page=2');
    expect(p2.body.data.orders).toHaveLength(1);
  }
  expect((await get('ga_all', '/purchase-analysis?yearMonth=2038-09&pageSize=999')).body.meta.pageSize).toBe(100);
  for (const who of ['approver', 'rq_manager', 'coop_only', 'cat_only', 'store_mgr', 'store_req', 'util_mgr', 'vendor_mgr', 'wo_works', 'nobody', 'admin']) {
    expect((await get(who, '/purchase-analysis')).status, who).toBe(403);
  }
  for (const q of ['yearMonth=2038-13', 'yearMonth=2038', 'month=abc']) expect((await get('ga_all', `/purchase-analysis?${q}`)).status, q).toBe(400);
});

test('首頁與徽章 API：只回呼叫者有權看的項目；沒有權限的人拿到空清單（不是 403）；回應不含帳務機密欄位', async () => {
  const exp = await oracle([st.VW001.id], await transferDays());
  const g = await get('ga_all', '/home/badges');
  expect(g.status, g.text).toBe(200);
  expect(Object.keys(g.body.data.items).sort()).toEqual(['bill_overdue', 'contract_due', 'onboarding_review', 'po_overdue', 'request_intake', 'transfer_overdue', 'wo_store_rejected']);
  expect(g.body.data.items.request_intake).toBe(exp.request_intake);
  const s = await get('ga_all', '/home/summary');
  expect(s.status, s.text).toBe(200);
  expect(s.body.data.total).toBe(g.body.data.total);
  expect(s.body.data.inventory).toBeTruthy();
  for (const k of ['tax_id', 'billing_title', 'payment_terms']) expect(s.text).not.toContain(`"${k}"`);
  for (const who of ['coop_only', 'cat_only', 'nobody', 'admin', 'store_mgr']) {
    const r = await get(who, '/home/badges');
    expect(r.status, `${who} ${r.text}`).toBe(200);
    expect(r.body.data.items, who).toEqual({});
    expect(r.body.data.total).toBe(0);
    const h = await get(who, '/home/summary');
    expect(h.status, who).toBe(200);
    expect(h.body.data.items).toEqual([]);
  }
  expect((await get('store_req', '/home/badges')).body.data.items.store_wait).toBe(exp.store_wait);
  // 店長只算自己門市：另一間門市（VW002）那張待確認的需求單不算
  expect(seed.requests.otherStore.store_id).toBe(st.VW002.id);
});

async function listTotal(who: string, path: string) {
  const r = await get(who, path);
  expect(r.status, `${who} ${path} ${r.text.slice(0, 200)}`).toBe(200);
  return r.body.total ?? r.body.data?.total;
}

test('徽章數字＝點進去列表總筆數（九項逐一，用真實列表 API 比對）', async () => {
  const gaB = (await get('ga_all', '/home/badges')).body.data;
  expect(await listTotal('ga_all', '/requests?attention=1&pageSize=1')).toBe(gaB.items.request_intake);
  expect(await listTotal('ga_all', '/utility-bills?overdue=1&pageSize=1')).toBe(gaB.items.bill_overdue);
  expect(await listTotal('ga_all', '/vendors?contract_due=1&pageSize=1')).toBe(gaB.items.contract_due);
  expect(await listTotal('ga_all', '/inventory/transfers?overdue=true&pageSize=1')).toBe(gaB.items.transfer_overdue);
  expect(await listTotal('ga_all', '/work-orders?attention=store_rejected&pageSize=1')).toBe(gaB.items.wo_store_rejected);
  expect(await listTotal('ga_all', '/onboarding/review?pageSize=1')).toBe(gaB.items.onboarding_review);
  expect(await listTotal('ga_all', '/purchase-orders?overdue=true&pageSize=1')).toBe(gaB.items.po_overdue);
  expect(await listTotal('ga_all', '/purchase-orders?attention=1&pageSize=1')).toBe(gaB.menu.purchase_orders);
  const apB = (await get('approver', '/home/badges')).body.data;
  expect(await listTotal('approver', '/purchase-orders?view=approvals&pageSize=1')).toBe(apB.items.po_pending);
  expect(await listTotal('approver', '/purchase-orders?overdue=true&pageSize=1')).toBe(apB.items.po_overdue);
  expect(await listTotal('approver', '/purchase-orders?attention=1&pageSize=1')).toBe(apB.menu.purchase_orders);
  expect(apB.menu.purchase_orders).toBe(apB.items.po_pending + apB.items.po_overdue);
  const puB = (await get('purchaser', '/home/badges')).body.data;
  expect(await listTotal('purchaser', '/purchase-orders?attention=1&pageSize=1')).toBe(puB.items.po_overdue);
  const smB = (await get('store_req', '/home/badges')).body.data;
  expect(await listTotal('store_req', '/reports/mine?attention=1&pageSize=1')).toBe(smB.items.store_wait);
  // 其他人用同一個篩選也只會看到自己權限範圍內的（需求工作台的待受理只給需求單管理）
  expect(await listTotal('rq_manager', '/requests?attention=1&pageSize=1')).toBe(gaB.items.request_intake);
});

test('列表 attention 的邊界：不合法的工單待辦值 400；attention 關閉時筆數回到全部；店長的待辦只含自己門市', async () => {
  expect((await get('ga_all', '/work-orders?attention=bogus')).status).toBe(400);
  const all = await listTotal('ga_all', '/requests?pageSize=1');
  const att = await listTotal('ga_all', '/requests?attention=1&pageSize=1');
  expect(all).toBeGreaterThan(att);
  const mine = await get('store_req', '/reports/mine?attention=1&pageSize=100');
  const ids = (mine.body.data as any[]).map((r) => r.id);
  expect(ids).toEqual(expect.arrayContaining([seed.requests.confirmA.id, seed.requests.confirmB.id, seed.requests.supp.id]));
  expect(ids).not.toContain(seed.requests.otherStore.id);
  expect(ids).not.toContain(seed.requests.intake0.id);
  expect(ids).not.toContain(seed.requests.gaReview.id);
});

test('導覽：合作紀錄與採購分析只對有權限者出現（旗標、側欄項目與 API 放行一致）；首頁側欄項目不再外連舊版', async () => {
  const want: Record<string, { stats: boolean; analysis: boolean }> = {
    ga_all: { stats: true, analysis: true }, coop_only: { stats: true, analysis: false }, purchaser: { stats: false, analysis: true }, approver: { stats: false, analysis: false },
    rq_manager: { stats: false, analysis: false }, cat_only: { stats: false, analysis: false }, store_mgr: { stats: false, analysis: false },
  };
  for (const [who, w] of Object.entries(want)) {
    const r = await j(await apis[who].get('/api/workspace/session'));
    expect(r.status, who).toBe(200);
    const caps = r.body.capabilities;
    expect(caps.gaVendorStats, `${who} gaVendorStats`).toBe(w.stats);
    expect(caps.gaPurchaseAnalysis, `${who} gaPurchaseAnalysis`).toBe(w.analysis);
    const kinds: string[] = [];
    const walk = (items: any[]) => items.forEach((i) => { if (i.kind) kinds.push(i.kind); if (i.children) walk(i.children); });
    for (const g of r.body.gaNavigation || []) walk(g.items);
    expect(kinds.includes('ga-vendor-stats'), `${who} 側欄合作紀錄`).toBe(w.stats);
    expect(kinds.includes('ga-purchase-analysis'), `${who} 側欄採購分析`).toBe(w.analysis);
    // API 放行與入口一致（看得到就打得開、看不到就被擋）
    expect((await get(who, '/vendor-stats')).status, `${who} vendor-stats API`).toBe(w.stats ? 200 : 403);
    expect((await get(who, '/purchase-analysis')).status, `${who} purchase-analysis API`).toBe(w.analysis ? 200 : 403);
  }
});
