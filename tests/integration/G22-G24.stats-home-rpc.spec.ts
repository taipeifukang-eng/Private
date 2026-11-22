import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name, seedLocation, seedLocationPart, seedBalance, seedPart, seedCategory, seedWorkOrder, stores } from '../support/m7m8-fixtures';
import { anonClient, seedReview, seedRequest } from '../support/m7m8-po-fixtures';
import { seedGa6Vendor, setupGa6Users, ga6Name, type Ga6Key, type Ga6User } from '../support/m7m8-ga6-fixtures';
import { dayOffset, hoursAgo, oracle, seedAttention, seedPo, transferDays, type AttentionSeed, type Counts } from '../support/m7m8-ga6-home-fixtures';
import { isOverdue } from '../../lib/workspace/general-affairs/inventory-transfer-rules';
import { shiftMonth, taipeiToday } from '../../lib/workspace/general-affairs/utility-bill-rules';

// M7/M8 第 6 批 G22 廠商績效與採購分析、G24 首頁與導覽徽章（資料庫層）整合：ga_ws_vendor_perf／ga_ws_purchase_analysis／ga_ws_home_badges／ga_ws_home_summary／ga_ws_po_list attention。
// 涵蓋：績效完成數定義（COMPLETED＋STORE_CONFIRMED；強制結案與未記完成方式另計、不入平均天數）、平均天數、未指定另列、資料累積中、區間驗證 400；
//      採購分析確定與預估分開、月份依下訂日（台北）邊界、舊採購評估只列預估且已有採購單的不重複、超過 500 筆完整彙總與分頁讀完；
//      九項待辦計數對照獨立計算（oracle，直接查表、不呼叫被測函式）、每項只對有權限者回傳（權限矩陣）、店長只算自己門市、調撥逾期與前端 isOverdue 逐筆一致、
//      採購單 attention 篩選（有核准權限＝待核准＋逾期；沒有＝只有逾期）、工單 store_rejected 焦點與徽章一致、首頁前 5 筆與完整計數、庫存提醒（負庫存完整計數、允許負庫存位置不算異常）。
// 測試資料：只放 VW／ZT 測試門市與保留年份 2038，名稱帶 QA-GA6-／[自動測試]M7M8 標記；結束只清自己的（cleanupM7M8）。權限語意與正式區 has_permission 相同（不檢查 roles.is_active、沒有管理員後備）。
test.describe.configure({ mode: 'serial' });

const KEYS: Ga6Key[] = ['ga_all', 'approver', 'coop_only', 'cat_only', 'store_mgr', 'store_req', 'util_view', 'util_mgr', 'rq_manager', 'wo_works', 'purchaser', 'vendor_mgr', 'nobody', 'admin', 'txn_only', 'loc_mgr'];
let users: Record<string, Ga6User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let seed: AttentionSeed;
let st: Awaited<ReturnType<typeof stores>>;
const db = () => adminDb();
const fn = (who: Ga6Key, name: string, args: Record<string, unknown> = {}) => callFn(users[who].client, name, args);
const today = taipeiToday();
const must = <T>(res: { data: T; error: { message: string } | null }, what: string): T => {
  if (res.error) throw new Error(`${what} 失敗：${res.error.message}`);
  return res.data;
};

test.beforeAll(async () => {
  test.setTimeout(420_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  st = await stores();
  const made = await setupGa6Users(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
  seed = await seedAttention(users.ga_all.id);
  // 帳單（寫入一定走函式）：逾期 2、到期當天 1、未來 1、沒填到期日 1、過去月份已繳逾期日 1
  const PAST = shiftMonth(`${today.slice(0, 7)}-01`, -3);
  const mkBill = async (over: Record<string, unknown>, i: number) => {
    const r = await fn('util_mgr', 'ga_ws_ub_save', { p_id: null, p_payload: { store_id: st.VW001.id, expense_type: 'WATER', billing_month: '2038-06', provider_name: ga6Name('HB'), service_identifier: `QA-GA6-HB-${i}`, amount: 1000, ...over }, p_expected_updated_at: null, p_confirm_paid_change: false });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    return r.data;
  };
  await mkBill({ due_date: dayOffset(-3) }, 0);
  await mkBill({ due_date: dayOffset(-1), expense_type: 'ELECTRICITY', electricity_kwh: 10 }, 1);
  await mkBill({ due_date: today, expense_type: 'PHONE' }, 2);
  await mkBill({ due_date: dayOffset(7), expense_type: 'INTERNET' }, 3);
  await mkBill({ due_date: null, store_id: st.VW002.id }, 4);
  const paid = await mkBill({ billing_month: PAST, due_date: dayOffset(-2), store_id: st.VW002.id, service_identifier: 'QA-GA6-HB-5' }, 5);
  const pr = await fn('util_mgr', 'ga_ws_ub_pay', { p_id: paid.id, p_paid_at: today, p_expected_updated_at: paid.updated_at });
  expect(pr.ok, JSON.stringify(pr)).toBe(true);
});
test.afterAll(async () => {
  test.setTimeout(300_000);
  const a = await cleanupM7M8();
  const b = await teardownUsers();
  const rest = [...a, ...b];
  if (rest.length) throw new Error(`清除殘留：${rest.join('; ')}`);
});

// ================================================================ 九項計數與徽章
const ALL_KEYS: Array<keyof Counts> = ['request_intake', 'bill_overdue', 'contract_due', 'transfer_overdue', 'store_wait', 'po_pending', 'po_overdue', 'wo_store_rejected', 'onboarding_review'];
/** 每個帳號應該看到哪幾項（沒有權限的鍵不會出現）。 */
const EXPECTED_KEYS: Record<string, Array<keyof Counts>> = {
  ga_all: ['request_intake', 'bill_overdue', 'contract_due', 'transfer_overdue', 'po_overdue', 'wo_store_rejected', 'onboarding_review'],
  approver: ['po_pending', 'po_overdue'],
  coop_only: [],
  cat_only: [],
  util_view: ['bill_overdue'],
  util_mgr: ['bill_overdue'],
  rq_manager: ['request_intake'],
  wo_works: ['wo_store_rejected'],
  purchaser: ['po_overdue'],
  vendor_mgr: ['contract_due'],
  nobody: [],
  admin: [],
  store_mgr: [], // DEV 真實 store_manager 角色沒有需求單權限（只有報修與工單查看自己門市），所以沒有任何徽章
  store_req: ['store_wait'],
};

test('九項計數對照獨立計算：總務全套、核准人、店長各自的數字；店長只算自己門市；邊界（到期當天不逾期、剛好 30 天算、31 天不算、已繳不算、沒到期日不算）', async () => {
  const days = await transferDays();
  const exp = await oracle([st.VW001.id], days);
  const ga = (await fn('ga_all', 'ga_ws_home_badges')).data;
  for (const k of EXPECTED_KEYS.ga_all) expect(ga.items[k], `ga_all ${k}`).toBe(exp[k]);
  const ap = (await fn('approver', 'ga_ws_home_badges')).data;
  expect(ap.items.po_pending).toBe(exp.po_pending);
  expect(ap.items.po_overdue).toBe(exp.po_overdue);
  const sm = (await fn('store_req', 'ga_ws_home_badges')).data;
  expect(sm.items.store_wait).toBe(exp.store_wait);
  // 種子本身的下限（別人的資料會讓數字更大，但至少要有我們種的）
  expect(exp.request_intake).toBeGreaterThanOrEqual(3);
  expect(exp.store_wait).toBeGreaterThanOrEqual(3); // confirmA、confirmB、supp；VW002 那張不算
  expect(exp.bill_overdue).toBeGreaterThanOrEqual(2);
  expect(exp.contract_due).toBeGreaterThanOrEqual(3); // +10、已過期、剛好 30 天
  expect(exp.transfer_overdue).toBeGreaterThanOrEqual(2);
  expect(exp.po_pending).toBeGreaterThanOrEqual(2);
  expect(exp.po_overdue).toBeGreaterThanOrEqual(3);
  expect(exp.wo_store_rejected).toBeGreaterThanOrEqual(2);
  expect(exp.onboarding_review).toBeGreaterThanOrEqual(3);
});

test('權限矩陣：每項只對有權限者回傳（沒有權限的鍵不出現）；沒有權限的人拿到空的徽章；未登入被擋', async () => {
  for (const [who, keys] of Object.entries(EXPECTED_KEYS)) {
    const r = await fn(who as Ga6Key, 'ga_ws_home_badges');
    expect(r.ok, `${who} ${JSON.stringify(r)}`).toBe(true);
    expect(Object.keys(r.data.items).sort(), `${who} items`).toEqual([...keys].sort());
    const s = await fn(who as Ga6Key, 'ga_ws_home_summary');
    expect(s.ok, `${who} summary`).toBe(true);
    expect(s.data.items.map((i: any) => i.key).sort(), `${who} summary items`).toEqual([...keys].sort());
  }
  const anon = anonClient();
  for (const name of ['ga_ws_home_badges', 'ga_ws_home_summary']) {
    const r = await callFn(anon, name, {});
    expect(r.ok === false || r.status === 401 || r.code, `${name} anon`).toBeTruthy();
  }
  for (const name of ['ga_ws_vendor_perf', 'ga_ws_purchase_analysis']) {
    const r = await callFn(anon, name, {});
    expect(r.ok, `${name} anon`).toBe(false);
  }
  // 內部述詞函式不開放直接呼叫
  const direct = await callFn(users.ga_all.client, 'ga_hm_counts', {});
  expect(direct.ok === false || direct.code === '42501' || direct.status === 0).toBe(true);
});

test('徽章結構：items 為九項、menu 各選單合計（採購單選單是待核准與逾期的聯集，不重複加）、total 是九項加總；首頁合計與徽章一致', async () => {
  const b = (await fn('approver', 'ga_ws_home_badges')).data;
  expect(b.menu.purchase_orders).toBe(b.items.po_pending + b.items.po_overdue);
  expect(b.menu.purchase_approvals).toBe(b.items.po_pending);
  expect(b.total).toBe(b.items.po_pending + b.items.po_overdue);
  const g = (await fn('ga_all', 'ga_ws_home_badges')).data;
  expect(g.total).toBe(Object.values(g.items as Record<string, number>).reduce((a, n) => a + n, 0));
  const s = (await fn('ga_all', 'ga_ws_home_summary')).data;
  expect(s.total).toBe(g.total);
  for (const it of s.items) {
    expect(it.count, it.key).toBe(g.items[it.key]);
    expect(it.top.length).toBeLessThanOrEqual(5);
    expect(it.top.length).toBe(Math.min(5, it.count));
  }
  expect(g.menu.requests).toBe(g.items.request_intake);
  expect(g.menu.work_orders).toBe(g.items.wo_store_rejected);
  expect(g.menu.vendors).toBe(g.items.contract_due);
  expect(g.menu.utility_bills).toBe(g.items.bill_overdue);
  expect(g.menu.transfers).toBe(g.items.transfer_overdue);
  expect(g.menu.onboarding).toBe(g.items.onboarding_review);
});

test('調撥逾期與前端 isOverdue 逐筆一致：資料庫計數＝所有調撥單用 TS 規則算出的逾期筆數；剛好 N 天整不算逾期（邊界）', async () => {
  const days = await transferDays();
  const rows = must(await db().from('ga_inventory_transfers').select('id,status,source_confirmed_at').is('deleted_at', null), '讀取調撥單') as any[];
  const now = new Date();
  const ts = rows.filter((r) => isOverdue(r, days, now)).length;
  const dbCount = (await fn('ga_all', 'ga_ws_home_badges')).data.items.transfer_overdue;
  expect(dbCount).toBe(ts);
  // 邊界：交出時間比現在早 N 天又 1 分鐘 → 逾期；早 N 天少 1 分鐘 → 不逾期
  const edge = (min: number) => ({ status: 'SOURCE_CONFIRMED', source_confirmed_at: new Date(Date.now() - days * 86_400_000 - min * 60_000).toISOString() });
  expect(isOverdue(edge(1), days)).toBe(true);
  expect(isOverdue(edge(-5), days)).toBe(false);
});

test('採購單 attention 篩選：有核准權限＝待核准＋逾期未到貨；沒有核准權限＝只有逾期；筆數等於徽章；待簽核清單等於待核准徽章', async () => {
  const ap = (await fn('approver', 'ga_ws_home_badges')).data;
  const l1 = await fn('approver', 'ga_ws_po_list', { p_filters: { attention: true }, p_page: 1, p_page_size: 100 });
  expect(l1.ok, JSON.stringify(l1)).toBe(true);
  expect(l1.total).toBe(ap.menu.purchase_orders);
  const l2 = await fn('approver', 'ga_ws_po_list', { p_filters: { approvals: true }, p_page: 1, p_page_size: 100 });
  expect(l2.total).toBe(ap.items.po_pending);
  const l3 = await fn('approver', 'ga_ws_po_list', { p_filters: { overdue: true }, p_page: 1, p_page_size: 100 });
  expect(l3.total).toBe(ap.items.po_overdue);
  // 沒有核准權限（採購人員）：attention 只剩逾期
  const pu = (await fn('purchaser', 'ga_ws_home_badges')).data;
  const l4 = await fn('purchaser', 'ga_ws_po_list', { p_filters: { attention: true }, p_page: 1, p_page_size: 100 });
  expect(l4.total).toBe(pu.menu.purchase_orders);
  expect(l4.total).toBe(pu.items.po_overdue);
  const ids = new Set((l1.data as any[]).map((r) => r.id));
  for (const p of [seed.pos[0], seed.pos[1], seed.pos[2], seed.pos[3], seed.pos[4]]) expect(ids.has(p.id), p.po_no).toBe(true);
  for (const p of [seed.pos[5], seed.pos[6], seed.pos[7], seed.pos[8]]) expect(ids.has(p.id), `${p.po_no} 不該出現`).toBe(false);
  // 審查補強：預計到貨日為 NULL 的採購單不算逾期（ORDERED 與 PARTIALLY_RECEIVED 都一樣），attention／overdue 清單與徽章都不計
  const noDateOrdered = seed.pos[7];
  expect(noDateOrdered.expected_delivery_date).toBeNull();
  const noDatePartial = await seedPo('AT-nodate-partial', { status: 'PARTIALLY_RECEIVED', ordered_at: hoursAgo(80) });
  expect(noDatePartial.expected_delivery_date).toBeNull();
  for (const who of ['approver', 'purchaser'] as Ga6Key[]) {
    const bd = (await fn(who, 'ga_ws_home_badges')).data;
    for (const filters of [{ attention: true }, { overdue: true }]) {
      const l = await fn(who, 'ga_ws_po_list', { p_filters: filters, p_page: 1, p_page_size: 100 });
      expect(l.ok, JSON.stringify(l)).toBe(true);
      const got = new Set((l.data as any[]).map((r) => r.id));
      expect(got.has(noDateOrdered.id), `${who} ${JSON.stringify(filters)} 不該含沒有預計到貨日的已下訂單`).toBe(false);
      expect(got.has(noDatePartial.id), `${who} ${JSON.stringify(filters)} 不該含沒有預計到貨日的部分到貨單`).toBe(false);
    }
    expect((await fn(who, 'ga_ws_po_list', { p_filters: { attention: true }, p_page: 1, p_page_size: 100 })).total, who).toBe(bd.menu.purchase_orders);
  }
  // 述詞本身（內部輔助函式只有 service role 可呼叫）：NULL 預計日為 false；昨天為 true；今天為 false
  const ov = async (status: string, d: string | null) => (await db().rpc('ga_att_po_overdue', { p_status: status, p_expected: d })).data;
  expect(await ov('ORDERED', null)).toBe(false);
  expect(await ov('PARTIALLY_RECEIVED', null)).toBe(false);
  expect(await ov('ORDERED', dayOffset(-1))).toBe(true);
  expect(await ov('ORDERED', today)).toBe(false);
});

test('調撥逾期述詞：p_days 為 NULL 時以 3 天為準（剛好 3 天整不算逾期、多 1 分鐘才算）；明確傳入天數時以傳入為準；非待收貨狀態與沒有交出時間不算', async () => {
  const att = async (status: string, at: string | null, days: number | null) => {
    const r = await db().rpc('ga_att_transfer_overdue', { p_status: status, p_source_confirmed_at: at, p_days: days });
    expect(r.error, JSON.stringify(r.error)).toBeNull();
    return r.data;
  };
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const D3 = 3 * 24 * 60;
  expect(await att('SOURCE_CONFIRMED', ago(D3 + 1), null)).toBe(true);
  expect(await att('IN_TRANSIT', ago(D3 + 1), null)).toBe(true);
  expect(await att('SOURCE_CONFIRMED', ago(D3 - 5), null)).toBe(false);
  expect(await att('SOURCE_CONFIRMED', ago(2 * 24 * 60), null)).toBe(false); // 2 天：預設 3 天不算
  expect(await att('SOURCE_CONFIRMED', ago(2 * 24 * 60), 1)).toBe(true); // 明確 1 天：算
  expect(await att('SOURCE_CONFIRMED', ago(D3 + 1), 7)).toBe(false); // 明確 7 天：不算
  expect(await att('RECEIVED', ago(D3 + 100), null)).toBe(false);
  expect(await att('REQUESTED', ago(D3 + 100), null)).toBe(false);
  expect(await att('SOURCE_CONFIRMED', null, null)).toBe(false);
});

test('工單：store_rejected 焦點的筆數＝徽章；門市退回只算 PROCESSING＋REOPENED，進行中與已完成不算', async () => {
  const g = (await fn('ga_all', 'ga_ws_home_badges')).data;
  const l = await fn('ga_all', 'ga_ws_wo_list', { p_filters: { focus: 'store_rejected' }, p_page: 1, p_page_size: 100 });
  expect(l.ok, JSON.stringify(l)).toBe(true);
  expect(l.data.total).toBe(g.items.wo_store_rejected);
  const ids = new Set((l.data.rows as any[]).map((r) => r.id));
  expect(ids.has(seed.wos[0].id)).toBe(true);
  expect(ids.has(seed.wos[1].id)).toBe(true);
  expect(ids.has(seed.wos[2].id)).toBe(false);
  expect(ids.has(seed.wos[3].id)).toBe(false);
});

test('貼標待複核：徽章＝貼標待辦列表（待複核）總筆數（設備與設施合計）', async () => {
  const g = (await fn('ga_all', 'ga_ws_home_badges')).data;
  const l = await fn('ga_all', 'ga_ws_onboarding_list', { p_statuses: ['PENDING_GA_REVIEW'], p_asset_type: null, p_store_id: null, p_search: null, p_limit: 1, p_offset: 0 });
  expect(l.data.total).toBe(g.items.onboarding_review);
});

test('廠商合約到期：徽章＝廠商列表 contract_due 篩選總筆數；種子的七種邊界只有三筆計入', async () => {
  const g = (await fn('ga_all', 'ga_ws_home_badges')).data;
  const l = await fn('ga_all', 'ga_ws_vendor_list', { p_filters: { contract_due: true }, p_page: 1, p_page_size: 100 });
  expect(l.data.total).toBe(g.items.contract_due);
  const names = new Set((l.data.rows as any[]).map((r) => r.name));
  const [d10, dexp, d30, d31, noreq, paused, nodate] = seed.vendorDue;
  for (const v of [d10, dexp, d30]) expect(names.has(v.name), v.name).toBe(true);
  for (const v of [d31, noreq, paused, nodate]) expect(names.has(v.name), `${v.name} 不該出現`).toBe(false);
});

test('帳單逾期：徽章＝帳單列表 overdue 篩選總筆數（到期當天不逾期、沒到期日不逾期、已繳不逾期）', async () => {
  const g = (await fn('util_mgr', 'ga_ws_home_badges')).data;
  const l = await fn('util_mgr', 'ga_ws_ub_list', { p_filters: { overdue: true }, p_page: 1, p_page_size: 100 });
  expect(l.data.total).toBe(g.items.bill_overdue);
  const idents = new Set((l.data.rows as any[]).map((r) => r.service_identifier));
  expect(idents.has('QA-GA6-HB-0')).toBe(true);
  expect(idents.has('QA-GA6-HB-1')).toBe(true);
  for (const n of [2, 3, 4, 5]) expect(idents.has(`QA-GA6-HB-${n}`), `HB-${n} 不該逾期`).toBe(false);
});

test('首頁前 5 筆：每項最多 5 筆且依各自的急迫程度排序；等門市回覆（總務）唯讀不計入徽章；需求單待總務複核不計入', async () => {
  const s = (await fn('ga_all', 'ga_ws_home_summary')).data;
  const intake = s.items.find((i: any) => i.key === 'request_intake');
  expect(intake.top.length).toBe(Math.min(5, intake.count));
  expect(s.waiting_reply).toBeGreaterThanOrEqual(4); // confirmA、confirmB、supp、otherStore
  const exp = await oracle([st.VW001.id], await transferDays());
  expect(s.waiting_reply).toBeGreaterThanOrEqual(exp.store_wait + 1);
  // WAITING_GA_REVIEW 不計入任何一項
  expect(s.items.map((i: any) => i.key)).not.toContain('ga_review');
  const kpi = Object.fromEntries(s.kpi.map((k: any) => [k.key, k.value]));
  expect(kpi.open_requests).toBeGreaterThanOrEqual(5);
  expect(kpi.open_work_orders).toBeGreaterThanOrEqual(3);
  expect(kpi.unpaid_bills).toBeGreaterThanOrEqual(5);
  expect(s.kpi.find((k: any) => k.key === 'unpaid_bills').amount).toBeGreaterThanOrEqual(5000);
});

test('庫存提醒：負庫存完整計數（不允許負庫存的位置才算異常、允許的另列）、低庫存紅黃分開；沒有庫存權限的人沒有這一區', async () => {
  const cat = await seedCategory('part', 'invc');
  const p1 = await seedPart(cat.id, 'inv-p1');
  const p2 = await seedPart(cat.id, 'inv-p2');
  const p3 = await seedPart(cat.id, 'inv-p3');
  const strict = await seedLocation('VW001', 'inv-strict', { allow_negative_stock: false });
  const loose = await seedLocation('VW002', 'inv-loose', { allow_negative_stock: true });
  await seedLocationPart(strict.id, p1.id, { safety_stock_qty: 10, reorder_point_qty: 20 });
  await seedLocationPart(strict.id, p2.id, { safety_stock_qty: 5, reorder_point_qty: 15 });
  await seedLocationPart(strict.id, p3.id, { safety_stock_qty: 1, reorder_point_qty: 50 });
  await seedBalance(strict.id, p1.id, -3); // 負庫存（不允許）＋低於安全庫存
  await seedBalance(strict.id, p2.id, 7); // 低於補貨點（>= 安全庫存 5、< 補貨點 15）
  await seedBalance(strict.id, p3.id, 30); // 低於補貨點（>= 安全庫存 1、< 補貨點 50）
  await seedBalance(loose.id, p1.id, -9); // 允許負庫存：預期，不算異常
  const before = (await fn('ga_all', 'ga_ws_home_summary')).data.inventory;
  expect(before).toBeTruthy();
  expect(before.negative_count).toBeGreaterThanOrEqual(1);
  expect(before.negative_allowed_count).toBeGreaterThanOrEqual(1);
  expect(before.low_red_count).toBeGreaterThanOrEqual(1);
  expect(before.low_yellow_count).toBeGreaterThanOrEqual(2);
  expect(before.negative_top.some((r: any) => r.location_name.includes('inv-strict'))).toBe(true);
  expect(before.negative_top.some((r: any) => r.location_name.includes('inv-loose'))).toBe(false);
  // 審查 A7：允許負庫存的位置（預期負數）紅燈與黃燈用同一套排除條件——這裡的位置只設補貨點（黃燈）、餘額為負，黃燈計數不能增加。
  const yellowBase = before.low_yellow_count;
  await seedLocationPart(loose.id, p2.id, { reorder_point_qty: 100 });
  await seedBalance(loose.id, p2.id, -4);
  const afterLoose = (await fn('ga_all', 'ga_ws_home_summary')).data.inventory;
  expect(afterLoose.low_yellow_count).toBe(yellowBase);
  expect(afterLoose.low_top.some((r: any) => r.location_name.includes('inv-loose'))).toBe(false);
  // 獨立計算：直接查餘額
  const bal = must(await db().from('ga_inventory_balances').select('quantity_base,location_id').in('location_id', [strict.id, loose.id]), '讀取餘額') as any[];
  expect(bal.filter((b) => Number(b.quantity_base) < 0 && b.location_id === strict.id)).toHaveLength(1);
  // 庫存提醒不計入徽章
  const badge = (await fn('ga_all', 'ga_ws_home_badges')).data;
  expect(Object.keys(badge.items)).not.toContain('negative_count');
  for (const who of ['util_mgr', 'approver', 'store_mgr', 'store_req', 'coop_only'] as Ga6Key[]) {
    expect((await fn(who, 'ga_ws_home_summary')).data.inventory, who).toBeNull();
  }
});

test('庫存提醒：停用（deleted_at 非空）位置上的負庫存不計入；只有庫存交易管理（沒有餘額檢視）的角色也看得到提醒且數字正確', async () => {
  // 先確認這個角色真的沒有 inventory_balance.view，只有交易管理
  const ur = must(await db().from('user_roles').select('role_id').eq('user_id', users.txn_only.id), '讀取角色') as any[];
  const rp = must(await db().from('role_permissions').select('is_allowed,permissions(code)').in('role_id', ur.map((r) => r.role_id)), '讀取角色權限') as any[];
  const codes = rp.filter((r) => r.is_allowed).map((r) => r.permissions.code);
  expect(codes).toEqual(['general_affairs.inventory_transaction.manage']);
  const cat = await seedCategory('part', 'invd');
  const p1 = await seedPart(cat.id, 'invd-p1');
  const live = await seedLocation('VW001', 'invd-live', { allow_negative_stock: false });
  const gone = await seedLocation('VW002', 'invd-gone', { allow_negative_stock: false });
  const inv = async (who: Ga6Key) => (await fn(who, 'ga_ws_home_summary')).data.inventory;
  const a0 = await inv('ga_all');
  const t0 = await inv('txn_only');
  expect(t0, '只有交易管理的角色也要有庫存提醒區').toBeTruthy();
  expect(t0.negative_count).toBe(a0.negative_count);
  // 位置的軟刪除只能走 ga_ws_inv_delete_location（要設軟刪除旗標與原因），且資料庫不允許刪除仍有庫存的位置（HAS_STOCK）：所以先用函式刪除空位置，再以 service role 直接補一筆負餘額，模擬「停用位置上殘留的負庫存」
  const del = await fn('loc_mgr', 'ga_ws_inv_delete_location', { p_location_id: gone.id, p_reason: 'QA-GA6 庫存提醒測試', p_expected_updated_at: null });
  expect(del.ok, JSON.stringify(del)).toBe(true);
  const goneRow = (await db().from('ga_inventory_locations').select('deleted_at').eq('id', gone.id).single()).data as any;
  expect(goneRow.deleted_at, '位置確實已軟刪除').not.toBeNull();
  await seedBalance(live.id, p1.id, -4);
  await seedBalance(gone.id, p1.id, -7);
  const names = (r: any) => (r.negative_top as any[]).map((x) => x.location_name as string);
  // 啟用位置的負庫存計入（+1）；停用位置上的負庫存不計入（總共只 +1，不是 +2），也不在前幾筆名單
  for (const who of ['ga_all', 'txn_only'] as Ga6Key[]) {
    const r = await inv(who);
    expect(r.negative_count, who).toBe(a0.negative_count + 1);
    expect(names(r).some((n) => n.includes('invd-live')), `${who} 啟用位置要在負庫存名單`).toBe(true);
    expect(names(r).some((n) => n.includes('invd-gone')), `${who} 停用位置不該在負庫存名單`).toBe(false);
  }
  // 沒有任何庫存權限的人仍然沒有這一區
  expect(await inv('util_mgr')).toBeNull();
});

// ================================================================ 績效
test('績效：完成數只算 COMPLETED＋STORE_CONFIRMED；強制結案與未記完成方式另計且不入平均天數；平均天數＝受理到完成；未指定另列；區間外不算；採購單確定金額只算已下訂起', async () => {
  const vA = await seedGa6Vendor('perfA');
  const vB = await seedGa6Vendor('perfB');
  const uid = users.ga_all.id;
  const at = (iso: string) => `2038-02-${iso}Z`;
  const wo = (s: string, over: Record<string, unknown>) => seedWorkOrder('VW001', `perf-${s}`, uid, { vendor_id: vA.id, reported_at: at('05T02:00:00'), ...over });
  await wo('w1', { status: 'COMPLETED', progress_stage: 'WAITING_STORE_CONFIRMATION', completion_method: 'STORE_CONFIRMED', accepted_at: at('01T00:00:00'), completed_at: at('03T00:00:00') });
  await wo('w2', { status: 'COMPLETED', progress_stage: 'WAITING_STORE_CONFIRMATION', completion_method: 'STORE_CONFIRMED', accepted_at: at('01T00:00:00'), completed_at: at('05T00:00:00') });
  await wo('w3', { status: 'COMPLETED', progress_stage: 'WAITING_STORE_CONFIRMATION', completion_method: 'ADMIN_FORCE_CLOSED', accepted_at: at('01T00:00:00'), completed_at: at('11T00:00:00') });
  await wo('w4', { status: 'COMPLETED', progress_stage: 'WAITING_STORE_CONFIRMATION', completion_method: null, accepted_at: at('01T00:00:00'), completed_at: at('09T00:00:00') });
  await wo('w5', { status: 'PROCESSING', progress_stage: 'VENDOR_WORKING', accepted_at: at('01T00:00:00') });
  await wo('w6', { vendor_id: null, status: 'UNACCEPTED' });
  await wo('w7', { reported_at: '2038-05-10T02:00:00Z' }); // 區間外
  await seedPo('perfA-1', { status: 'ORDERED', vendor_id: vA.id, vendor_name_snapshot: vA.name, ordered_at: at('10T02:00:00'), total_amount: 1050, subtotal: 1000, tax_amount: 50 });
  await seedPo('perfA-2', { status: 'RECEIVED', vendor_id: vA.id, vendor_name_snapshot: vA.name, ordered_at: at('20T02:00:00'), total_amount: 2100, subtotal: 2000, tax_amount: 100 });
  await seedPo('perfA-3', { status: 'DRAFT', vendor_id: vA.id, vendor_name_snapshot: vA.name, total_amount: 999, created_at: at('12T02:00:00') });
  await seedPo('perfA-4', { status: 'ORDERED', vendor_id: vA.id, vendor_name_snapshot: vA.name, ordered_at: '2038-06-10T02:00:00Z', total_amount: 777 });
  await seedPo('perfB-1', { status: 'CLOSED', vendor_id: vB.id, vendor_name_snapshot: vB.name, ordered_at: at('15T02:00:00'), total_amount: 500 });

  const r = await fn('ga_all', 'ga_ws_vendor_perf', { p_from: '2038-01', p_to: '2038-03' });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const d = r.data;
  const a = d.rows.find((x: any) => x.vendor_id === vA.id);
  expect(a).toMatchObject({ wo_count: 5, completed_count: 2, force_closed_count: 1, unknown_method_count: 1, open_count: 1, avg_days: 3, days_sample: 2, po_count: 2, po_amount: 3150, insufficient: false });
  const b = d.rows.find((x: any) => x.vendor_id === vB.id);
  expect(b).toMatchObject({ wo_count: 0, completed_count: 0, po_count: 1, po_amount: 500, insufficient: true, avg_days: null });
  expect(d.unassigned).toMatchObject({ wo_count: 1, completed_count: 0, open_count: 1 });
  expect(d.from).toBe('2038-01');
  expect(d.to).toBe('2038-03');
  expect(d.summary.wo_total).toBe(6);
  expect(d.summary.wo_with_vendor).toBe(5);
  expect(d.summary.po_amount_total).toBe(3650);
  expect(d.accumulating).toBe(false);
  expect(d.can_view_po_amount).toBe(true);
  // 決定 3（2026-11-18）：沒有採購單檢視權限（只有合作紀錄）者，金額、張數與合計由資料庫函式回 null、不列只有採購單的廠商；工單統計不受影響。
  const lim = await fn('coop_only', 'ga_ws_vendor_perf', { p_from: '2038-01', p_to: '2038-03' });
  expect(lim.ok, JSON.stringify(lim)).toBe(true);
  expect(lim.data.can_view_po_amount).toBe(false);
  const limA = lim.data.rows.find((x: any) => x.vendor_id === vA.id);
  expect(limA).toMatchObject({ wo_count: 5, completed_count: 2, force_closed_count: 1, unknown_method_count: 1, open_count: 1, avg_days: 3, days_sample: 2, po_count: null, po_amount: null, insufficient: false });
  expect(lim.data.rows.find((x: any) => x.vendor_id === vB.id), '只有採購單、沒有工單的廠商不列出').toBeUndefined();
  expect(lim.data.summary).toMatchObject({ wo_total: 6, wo_with_vendor: 5, po_amount_total: null });
  expect(lim.data.rows).toHaveLength(d.rows.length - 1);
  for (const x of lim.data.rows) expect(x.po_amount).toBeNull();
  expect(JSON.stringify(lim.data)).not.toMatch(/"po_(amount|amount_total|count)":\s*-?\d/);
  // 不含任何帳務機密欄位與評價
  const text = JSON.stringify(d);
  for (const k of ['tax_id', 'billing_title', 'payment_terms', 'rating', 'review_count']) expect(text, k).not.toContain(`"${k}"`);
  // 一個沒有工單的區間：資料累積中
  const empty = await fn('ga_all', 'ga_ws_vendor_perf', { p_from: '2038-10', p_to: '2038-11' });
  expect(empty.data.accumulating).toBe(true);
  expect(empty.data.rows).toEqual([]);
  // 預設區間：近 12 個月到本月
  const def = await fn('ga_all', 'ga_ws_vendor_perf', {});
  expect(def.data.to).toBe(today.slice(0, 7));
  expect(def.data.from).toBe(shiftMonth(`${today.slice(0, 7)}-01`, -11).slice(0, 7));
  // 台北時區邊界：2038-03-31T16:30Z＝2038-04-01 00:30（台北）落在 4 月、不在 3 月
  const wB = await seedWorkOrder('VW001', 'perf-edge', uid, { vendor_id: vB.id, reported_at: '2038-03-31T16:30:00Z' });
  const mar = await fn('ga_all', 'ga_ws_vendor_perf', { p_from: '2038-03', p_to: '2038-03' });
  const apr = await fn('ga_all', 'ga_ws_vendor_perf', { p_from: '2038-04', p_to: '2038-04' });
  expect(mar.data.rows.find((x: any) => x.vendor_id === vB.id)?.wo_count ?? 0).toBe(0);
  expect(apr.data.rows.find((x: any) => x.vendor_id === vB.id)?.wo_count).toBe(1);
  void wB;
});

test('績效：權限只給合作紀錄檢視（其他人 403）；區間輸入驗證 400（格式、起迄顛倒、超過 36 個月）', async () => {
  for (const who of ['ga_all', 'coop_only'] as Ga6Key[]) expect((await fn(who, 'ga_ws_vendor_perf', {})).ok, who).toBe(true);
  for (const who of ['approver', 'cat_only', 'store_mgr', 'store_req', 'util_mgr', 'vendor_mgr', 'purchaser', 'wo_works', 'rq_manager', 'nobody', 'admin'] as Ga6Key[]) {
    expect(await fn(who, 'ga_ws_vendor_perf', {}), who).toMatchObject({ ok: false, status: 403, code: 'PERMISSION_DENIED' });
  }
  expect(await fn('ga_all', 'ga_ws_vendor_perf', { p_from: '2038-13', p_to: '2038-12' })).toMatchObject({ ok: false, status: 400, code: 'BAD_RANGE' });
  expect(await fn('ga_all', 'ga_ws_vendor_perf', { p_from: '2038-05', p_to: '2038-04' })).toMatchObject({ ok: false, status: 400, code: 'BAD_RANGE' });
  expect(await fn('ga_all', 'ga_ws_vendor_perf', { p_from: '2030-01', p_to: '2038-04' })).toMatchObject({ ok: false, status: 400, code: 'RANGE_TOO_LONG' });
  expect((await fn('ga_all', 'ga_ws_vendor_perf', { p_from: '2038-01', p_to: '2040-12' })).ok).toBe(true); // 剛好 36 個月
  expect((await fn('ga_all', 'ga_ws_vendor_perf', { p_from: '2038-01', p_to: '2041-01' })).code).toBe('RANGE_TOO_LONG');
});

// ================================================================ 採購分析
test('採購分析：確定（已下訂起）與預估分開；月份依下訂日（台北）；廠商用快照名稱；門市由來源需求單；舊採購評估只列預估、已有採購單的不重複', async () => {
  const uid = users.ga_all.id;
  const vC = await seedGa6Vendor('paC');
  const vD = await seedGa6Vendor('paD');
  const rq = await seedRequest(st.VW001.id, uid, 'pa-rq');
  const rq2 = await seedRequest(st.VW002.id, uid, 'pa-rq2');
  const m = (d: string) => `2038-03-${d}`;
  const p1 = await seedPo('pa1', { status: 'ORDERED', vendor_id: vC.id, vendor_name_snapshot: '快照名稱甲', source_request_id: rq.id, ordered_at: `${m('10')}T02:00:00Z`, total_amount: 1050, subtotal: 1000, tax_amount: 50 },
    [{ quantity: 10, quantity_base: 10, unit_price: 100, line_amount: 1000, received_qty: 4 }]);
  const p2 = await seedPo('pa2', { status: 'RECEIVED', vendor_id: vD.id, vendor_name_snapshot: vD.name, source_request_id: rq2.id, ordered_at: `${m('15')}T02:00:00Z`, total_amount: 2100, subtotal: 2000, tax_amount: 100 },
    [{ quantity: 20, quantity_base: 20, unit_price: 100, line_amount: 2000, received_qty: 20 }]);
  await seedPo('pa3', { status: 'DRAFT', vendor_id: vC.id, vendor_name_snapshot: vC.name, total_amount: 300, created_at: `${m('05')}T02:00:00Z` });
  await seedPo('pa4', { status: 'APPROVED', vendor_id: vC.id, vendor_name_snapshot: vC.name, total_amount: 200, created_at: `${m('06')}T02:00:00Z` });
  await seedPo('pa5', { status: 'ORDERED', vendor_id: vC.id, vendor_name_snapshot: vC.name, ordered_at: '2038-03-31T16:30:00Z', total_amount: 9999 }); // 台北 4/1，不在 3 月
  await seedPo('pa6', { status: 'CANCELED', vendor_id: vC.id, vendor_name_snapshot: vC.name, total_amount: 888, created_at: `${m('07')}T02:00:00Z` });
  // 舊採購評估：一筆沒有採購單（列預估，報價優先於預估）、一筆已有採購單（不重複）
  const rv1 = await seedReview(rq.id, uid, { vendor_name: '舊評估廠商', estimated_amount: 500, quoted_amount: 800, created_at: `${m('12')}T02:00:00Z` });
  const rq3 = await seedRequest(st.VW001.id, uid, 'pa-rq3');
  const rv2 = await seedReview(rq3.id, uid, { estimated_amount: 4000, created_at: `${m('13')}T02:00:00Z` });
  await seedPo('pa7', { status: 'DRAFT', purchase_review_id: rv2.id, total_amount: 4000, created_at: `${m('13')}T03:00:00Z` });
  void rv1;
  const r = await fn('purchaser', 'ga_ws_purchase_analysis', { p_year_month: '2038-03', p_page: 1, p_page_size: 10 });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const d = r.data;
  expect(d.confirmed).toMatchObject({ count: 2, total_amount: 3150, subtotal: 3000, tax_amount: 150, received_amount: 2400 });
  expect(d.by_vendor.map((x: any) => [x.label, x.amount, x.count])).toEqual([[vD.name, 2100, 1], ['快照名稱甲', 1050, 1]]);
  expect(d.by_store.map((x: any) => x.amount)).toEqual([2100, 1050]);
  // 預估：草稿 300＋已核准 200＋草稿（有舊評估連結）4000；已取消不算
  expect(d.estimated.orders).toMatchObject({ count: 3, total_amount: 4500 });
  expect(d.estimated.legacy_reviews).toMatchObject({ count: 1, total_amount: 800, missing_amount_count: 0 });
  expect(d.orders_total).toBe(2);
  expect(d.orders.map((o: any) => o.po_no).sort()).toEqual([p1.po_no, p2.po_no].sort());
  // 4 月：只有台北 4/1 的那一張
  const apr = await fn('purchaser', 'ga_ws_purchase_analysis', { p_year_month: '2038-04' });
  expect(apr.data.confirmed).toMatchObject({ count: 1, total_amount: 9999 });
  // 沒帶月份：本月（測試資料不在本月，回 0 也要成功）
  const cur = await fn('ga_all', 'ga_ws_purchase_analysis', {});
  expect(cur.ok).toBe(true);
  expect(cur.data.year_month).toBe(today.slice(0, 7));
});

test('採購分析：權限只給採購評估檢視／管理（核准人、需求單管理、其他一律 403）；月份格式 400', async () => {
  for (const who of ['ga_all', 'purchaser'] as Ga6Key[]) expect((await fn(who, 'ga_ws_purchase_analysis', {})).ok, who).toBe(true);
  for (const who of ['approver', 'rq_manager', 'coop_only', 'cat_only', 'store_mgr', 'store_req', 'util_mgr', 'vendor_mgr', 'wo_works', 'nobody', 'admin'] as Ga6Key[]) {
    expect(await fn(who, 'ga_ws_purchase_analysis', {}), who).toMatchObject({ ok: false, status: 403, code: 'PERMISSION_DENIED' });
  }
  for (const bad of ['2038-13', '2038', 'abc', '2038-1']) expect(await fn('ga_all', 'ga_ws_purchase_analysis', { p_year_month: bad }), bad).toMatchObject({ ok: false, status: 400, code: 'BAD_MONTH' });
});

test('採購分析：超過 500 筆完整彙總（不受舊版上限影響），分頁讀完每一頁不重複不漏；每頁最多 100 筆', async () => {
  test.setTimeout(240_000);
  const v = await seedGa6Vendor('paBig');
  const rows = Array.from({ length: 520 }, (_, i) => ({
    po_no: `PO-M7M8-G22BIG-${Date.now().toString(36)}-${i}`.toUpperCase(), status: 'ORDERED', vendor_id: v.id, vendor_name_snapshot: v.name, ordered_at: `2038-08-${String((i % 27) + 1).padStart(2, '0')}T02:00:00Z`,
    total_amount: 10, subtotal: 10, tax_amount: 0, notes: m7Name('paBig'),
  }));
  for (let i = 0; i < rows.length; i += 200) must(await db().from('ga_purchase_orders').insert(rows.slice(i, i + 200)), '建立大量採購單');
  const first = await fn('ga_all', 'ga_ws_purchase_analysis', { p_year_month: '2038-08', p_page: 1, p_page_size: 100 });
  expect(first.data.confirmed).toMatchObject({ count: 520, total_amount: 5200 });
  expect(first.data.orders_total).toBe(520);
  expect(first.data.by_vendor).toHaveLength(1);
  expect(first.data.by_vendor[0]).toMatchObject({ amount: 5200, count: 520 });
  const seen = new Set<string>();
  for (let p = 1; p <= 6; p += 1) {
    const r = await fn('ga_all', 'ga_ws_purchase_analysis', { p_year_month: '2038-08', p_page: p, p_page_size: 100 });
    expect(r.data.orders.length).toBe(p < 6 ? 100 : 20);
    for (const o of r.data.orders) seen.add(o.id);
  }
  expect(seen.size).toBe(520);
  const over = await fn('ga_all', 'ga_ws_purchase_analysis', { p_year_month: '2038-08', p_page: 1, p_page_size: 999 });
  expect(over.data.orders.length).toBe(100);
});

test('超過 100 筆種子仍正確：需求單待受理 130 筆，徽章與資料庫實際筆數一致（不被 100 筆上限截斷）', async () => {
  test.setTimeout(240_000);
  const base = (await fn('rq_manager', 'ga_ws_home_badges')).data.items.request_intake;
  const rows = Array.from({ length: 130 }, (_, i) => ({ store_id: st.VW001.id, created_by: users.ga_all.id, request_type: 'PURCHASE_SUPPLEMENT', title: m7Name(`bulk-${i}`), description: 'm7m8 大量', resource_type: 'PART', desired_quantity: 1, main_status: 'PENDING_INTAKE' }));
  for (let i = 0; i < rows.length; i += 100) must(await db().from('ga_service_requests').insert(rows.slice(i, i + 100)), '建立大量需求單');
  const after = (await fn('rq_manager', 'ga_ws_home_badges')).data;
  expect(after.items.request_intake).toBe(base + 130);
  expect(after.total).toBe(base + 130);
  const exp = await oracle([], await transferDays());
  expect(after.items.request_intake).toBe(exp.request_intake);
  const s = (await fn('rq_manager', 'ga_ws_home_summary')).data;
  expect(s.items[0].count).toBe(base + 130);
  expect(s.items[0].top).toHaveLength(5);
});

test('辦完一項即時減少：受理一張待受理需求單後，資料庫計數立刻少 1', async () => {
  const before = (await fn('rq_manager', 'ga_ws_home_badges')).data.items.request_intake;
  const target = seed.requests.intake0;
  const done = await db().from('ga_service_requests').update({ main_status: 'ACCEPTED' }).eq('id', target.id);
  expect(done.error).toBeNull();
  const after = (await fn('rq_manager', 'ga_ws_home_badges')).data.items.request_intake;
  expect(after).toBe(before - 1);
  void hoursAgo; void seedPo; void seedLocation;
});
