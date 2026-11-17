import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { assertGaBaseline, cleanupM7M8, stores } from '../support/m7m8-fixtures';
import { seedRequest, seedReview } from '../support/m7m8-po-fixtures';
import { setupGa6Users, type Ga6User } from '../support/m7m8-ga6-fixtures';

// M7/M8 第 6 批 G22.parity：同一個登入者（採購評估管理）、同一個月份，舊版 GET /api/general-affairs/purchase-reviews/cost-summary
// 與新版 GET /api/workspace/general-affairs/purchase-analysis 逐項比對。
//  - 只有舊採購評估（沒有對應採購單）時，新版「預估：舊採購評估」的金額、筆數、未填金額筆數必須與舊版相同（舊版以最終、議價、報價、預估順序取第一個非 0 的金額）。
//  - 結構差異（以採購單為主、確定與預估分開、排名可展開全部、已下訂清單、回應格式）都登記在 tests/parity/allowlist.json（page: ga-purchase-analysis，id 以 m7m8-b6-pa- 開頭）。
//  - 權限差異（舊版含需求單管理、新版只認採購評估檢視／管理）與月份邊界（舊版 UTC、新版台北）各一項。
// 測試資料：需求單與評估掛在 VW 測試門市，月份用 2038；結束只清自己的。
const map = loadMap('ga-purchase-analysis');
const rec = new ParityRecorder('ga-purchase-analysis');
const record = (input: Parameters<typeof rec.record>[0]) => rec.record({ ...input, diffs: input.diffs.map((d) => ({ ...d, detail: d.detail ?? JSON.stringify({ legacy: d.legacy, native: d.native }).slice(0, 220) })) });
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const L = '/api/general-affairs/purchase-reviews/cost-summary';
const N = '/api/workspace/general-affairs/purchase-analysis';
let users: Record<string, Ga6User> = {};
let teardown: () => Promise<string[]> = async () => [];
const apis: Record<string, APIRequestContext> = {};
let st: Awaited<ReturnType<typeof stores>>;
const j = async (r: any) => r.json().catch(() => ({}));
const num = (v: unknown) => Number(v ?? 0);

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  st = await stores();
  const made = await setupGa6Users(['purchaser', 'rq_manager']);
  users = made.users;
  teardown = made.teardown;
  for (const k of Object.keys(users)) apis[k] = await apiForUser(users[k] as any);
});
test.afterAll(async () => {
  for (const a of Object.values(apis)) await a.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('採購分析：只有舊採購評估時，金額、筆數、未填金額筆數與舊版相同；結構差異（以採購單為主、確定與預估分開、排名、清單、回應格式）逐項登記', async () => {
  const e = entry('cost-summary-read');
  const diffs: Diff[] = [];
  const uid = users.purchaser.id;
  const mk = async (suffix: string, over: Record<string, unknown>) => {
    const rq = await seedRequest(st.VW001.id, uid, `par-${suffix}`);
    return seedReview(rq.id, uid, { created_at: '2038-12-10T04:00:00Z', ...over });
  };
  await mk('a', { final_amount: 1000, quoted_amount: 700 }); // 最終金額優先
  await mk('b', { estimated_amount: 500, quoted_amount: 800 }); // 報價優先於預估
  await mk('c', { estimated_amount: 300 }); // 只有預估
  await mk('d', {}); // 沒填金額（未填金額 1 筆）
  const lr = await apis.purchaser.get(`${L}?yearMonth=2038-12`);
  const nr = await apis.purchaser.get(`${N}?yearMonth=2038-12`);
  if (lr.status() !== nr.status()) diffs.push({ kind: 'status', key: 'list-status', legacy: lr.status(), native: nr.status() });
  expect(lr.status()).toBe(200);
  expect(nr.status()).toBe(200);
  const lb = await j(lr);
  const nb = await j(nr);
  const l = lb.data;
  const n = nb.data;
  const legacyReviews = n.estimated.legacy_reviews;
  const pairs: Array<[string, unknown, unknown]> = [
    ['yearMonth', l.yearMonth, n.year_month], ['totalAmount', num(l.totalAmount), num(legacyReviews.total_amount)], ['purchaseCount', num(l.purchaseCount), num(legacyReviews.count)],
    ['missingAmountCount', num(l.missingAmountCount), num(legacyReviews.missing_amount_count)],
  ];
  for (const [k, a, b] of pairs) if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ kind: 'changed', key: `summary#${k}`, legacy: a, native: b });
  expect(num(l.totalAmount)).toBe(2100); // 1000 + 800 + 300 + 0
  expect(num(l.purchaseCount)).toBe(4);
  // 結構差異：舊版有、新版沒有（或改名）的欄位，與新版多出的欄位
  // 已知的結構差異：
  //   舊版有、新版沒有：amountFilledCount（新版用筆數減未填金額筆數就算得出來）、topStores／topVendors（只有前 5 名、依採購評估）、body 的 success。
  //   新版多出：confirmed、by_vendor、by_store、orders（可展開全部、分頁）、generated_at、orders_total、page、page_size、body 的 meta。
  //   名稱不同的欄位對照：yearMonth↔year_month、totalAmount↔estimated.legacy_reviews.total_amount、purchaseCount↔count、missingAmountCount↔missing_amount_count。
  const mapped = new Set(['yearMonth', 'totalAmount', 'purchaseCount', 'missingAmountCount']);
  const knownLegacyOnly = new Set(['amountFilledCount', 'topStores', 'topVendors']);
  const knownNativeOnly = new Set(['confirmed', 'by_vendor', 'by_store', 'orders', 'generated_at', 'orders_total', 'page', 'page_size']);
  for (const k of Object.keys(l)) if (!mapped.has(k) && !knownLegacyOnly.has(k)) diffs.push({ kind: 'only-legacy', key: `top#${k}` }); // 未知的新欄位：不登記就失敗
  for (const k of Object.keys(n)) if (k !== 'year_month' && k !== 'estimated' && !knownNativeOnly.has(k)) diffs.push({ kind: 'only-native', key: `top#${k}` });
  for (const k of Object.keys(nb)) if (!(k in lb) && k !== 'meta') diffs.push({ kind: 'only-native', key: `body#${k}` });
  for (const k of Object.keys(lb)) if (!(k in nb) && k !== 'success') diffs.push({ kind: 'only-legacy', key: `body#${k}` });
  diffs.push({ kind: 'only-legacy', key: 'top#topVendors' }, { kind: 'only-legacy', key: 'top#topStores' });
  diffs.push({ kind: 'only-native', key: 'top#confirmed' }, { kind: 'only-native', key: 'top#by_vendor' }, { kind: 'only-native', key: 'top#by_store' }, { kind: 'only-native', key: 'top#orders' });
  diffs.push({ kind: 'changed', key: 'shape', legacy: 'yearMonth／totalAmount／purchaseCount／amountFilledCount／missingAmountCount／success', native: 'year_month／estimated.legacy_reviews／generated_at／orders_total／page／page_size／meta' });
  // 舊版排名是採購評估的廠商／門市前 5 名；新版排名來自採購單（這個月沒有採購單，所以是空的）
  diffs.push({ kind: 'changed', key: 'basis', legacy: '採購評估（依建立日）', native: '採購單為主（確定依下訂日；預估另列）' });
  expect((l.topVendors as any[]).length).toBeGreaterThan(0);
  expect(n.by_vendor).toEqual([]);
  expect(n.confirmed).toMatchObject({ count: 0, total_amount: 0 });
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '採購分析', legacy: { endpoint: `GET ${L}?yearMonth=2038-12`, status: lr.status() }, native: { endpoint: `GET ${N}?yearMonth=2038-12`, status: nr.status() }, compared: { reviews: 4 }, diffs }));
});

test('採購分析權限：舊版只要有需求單管理就放行，新版只認採購評估檢視／管理（需求單管理者新版 403）', async () => {
  const e = entry('cost-summary-permission');
  const diffs: Diff[] = [];
  for (const who of ['purchaser', 'rq_manager']) {
    const lr = await apis[who].get(`${L}?yearMonth=2038-12`);
    const nr = await apis[who].get(`${N}?yearMonth=2038-12`);
    if (lr.status() !== nr.status()) diffs.push({ kind: 'status', key: `status#${who}`, legacy: lr.status(), native: nr.status() });
  }
  const lq = await apis.rq_manager.get(`${L}?yearMonth=2038-12`);
  const nq = await apis.rq_manager.get(`${N}?yearMonth=2038-12`);
  expect(lq.status()).toBe(200);
  expect(nq.status()).toBe(403);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '採購分析權限', legacy: { endpoint: `GET ${L}`, status: lq.status() }, native: { endpoint: `GET ${N}`, status: nq.status() }, compared: { roles: 2 }, diffs }));
});

test('月份邊界：台北 1 月 1 日凌晨 1 點建立的評估，舊版（UTC）算 12 月、新版（台北）算 1 月', async () => {
  const e = entry('cost-summary-month-boundary');
  const diffs: Diff[] = [];
  const uid = users.purchaser.id;
  const rq = await seedRequest(st.VW001.id, uid, 'par-boundary');
  await seedReview(rq.id, uid, { created_at: '2038-12-31T17:00:00Z', estimated_amount: 4000 }); // 台北 2039-01-01 01:00
  const before = {
    legacy: num((await j(await apis.purchaser.get(`${L}?yearMonth=2038-12`))).data.purchaseCount),
    native: num((await j(await apis.purchaser.get(`${N}?yearMonth=2038-12`))).data.estimated.legacy_reviews.count),
  };
  expect(before.legacy - before.native).toBe(1); // 這一筆只被舊版算進 12 月
  diffs.push({ kind: 'changed', key: 'month-boundary#count', legacy: before.legacy, native: before.native });
  const jan = num((await j(await apis.purchaser.get(`${N}?yearMonth=2039-01`))).data.estimated.legacy_reviews.count);
  expect(jan).toBe(1);
  assertNoUnlistedDiffs(record({ entry: e.id, mechanism: 'api-read', title: '月份邊界', legacy: { endpoint: `GET ${L}?yearMonth=2038-12`, status: 200 }, native: { endpoint: `GET ${N}?yearMonth=2038-12`, status: 200 }, compared: { boundary: 1 }, diffs }));
});
