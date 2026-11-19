import crypto from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name } from '../support/m7m8-fixtures';
import { seedGa45Vendor, setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';

// 第 4.5 批 G45-stat（API＋資料庫回讀）：已請款、已付款、未請款驗入數字；待請款、待付款的徽章與首頁待辦與列表筆數一致；已作廢進貨不計入任何統計。
// 驗：採購分析 /purchase-analysis（claimed_amount、paid_amount、unclaimed_received_amount、can_view_payment；沒有請款權限者欄位不存在）、
//   廠商績效 /vendor-stats（po_paid_amount、po_paid_total、can_view_pay_amount）、徽章 /home/badges（pay_unclaimed、pay_submitted、選單 payment_requests 與採購單選單聯集）、
//   首頁 /home/summary、採購單列表 attention 與 payUnclaimed 篩選、請款單列表待付款。數字全部與 service role 直接查資料庫、自己用 JS 算出的結果比對。
// 測試資料：廠商 QA-GA45- 標記、採購單 [自動測試]M7M8 標記並把下訂日改到 2038-03（隔離採購分析的月份）；只用 DEV，結束只清自己的。
const P = '/api/workspace/general-affairs';
const PO_API = `${P}/purchase-orders`;
const PR = `${P}/payment-requests`;
const SET = `${P}/payment-settings`;
const MONTH = '2038-03';
const KEYS: Ga45Key[] = ['clerk', 'accountant', 'viewer', 'purchaser', 'nobody', 'perf_pay', 'perf_nopay'];
let users: Record<string, Ga45User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const apis: Record<string, APIRequestContext> = {};
let seq = 0;
const db = () => adminDb();
const key = () => crypto.randomUUID();
const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
const get = async (k: string, p: string) => j(await apis[k].get(p));
const send = async (k: string, method: 'post' | 'patch' | 'put', p: string, data?: unknown) => j(await (apis[k] as any)[method](p, { data: data ?? {} }));
const rpcOk = async (who: Ga45Key, name: string, args: Record<string, unknown>) => {
  const r: any = await callFn(users[who].client, name, args);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
};
const itemId = (p: any, line: number) => p.items.find((i: any) => i.line_no === line).id as string;

let vendor: any;
const pos: Record<string, any> = {};
const rcs: Record<string, any[]> = {};

async function orderedPo(tag: string, qty: number, price: number) {
  const draft = await rpcOk('clerk', 'ga_ws_po_create', {
    p_header: { notes: m7Name(`STAT${(seq += 1)}${tag}`), vendor_id: vendor.id },
    p_items: [{ item_name: m7Name(`品項${tag}`), unit: '個', quantity: qty, unit_price: price, fulfil_mode: 'NO_STOCK' }],
    p_create_key: key(),
  });
  return rpcOk('clerk', 'ga_ws_po_action', { p_id: draft.id, p_action: 'place_order', p_expected_updated_at: draft.updated_at, p_note: null });
}
const receive = (po: any, qty: number) => rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [{ po_item_id: itemId(po, 1), delivered_qty: qty }], p_key: key() });
const mkPr = async (receiptId: string, over: Record<string, unknown> = {}) => {
  const r = await send('clerk', 'post', PR, { vendor_id: vendor.id, lines: [{ receipt_id: receiptId }], idempotency_key: key(), ...over });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as any;
};
const act = (p: any, action: string, extra: Record<string, unknown> = {}, who = 'clerk') =>
  send(who, 'post', `${PR}/${p.id}/actions`, { action, expected_updated_at: p.updated_at, idempotency_key: key(), ...extra });
const fresh = async (id: string) => (await get('clerk', `${PR}/${id}`)).body.data as any;
const voidUrl = (poId: string, rid: string) => `${PO_API}/${poId}/receipts/${rid}/void`;

/** 直接查資料庫、用 JS 算每張採購單的驗入含稅額、有效請款額、已付款額（與資料庫函式獨立）。 */
async function dbAmounts(tol = 5) {
  const poRows = ((await db().from('ga_purchase_orders').select('id,tax_rate,total_amount,status,vendor_id,ordered_at')).data || []) as any[];
  const rc = ((await db().from('ga_purchase_receipts').select('id,po_id,voided_at')).data || []) as any[];
  const items = ((await db().from('ga_purchase_receipt_items').select('receipt_id,amount_untaxed')).data || []) as any[];
  const reqs = ((await db().from('ga_payment_requests').select('id,status')).data || []) as any[];
  const lines = ((await db().from('ga_payment_request_lines').select('po_id,pr_id,claim_total')).data || []) as any[];
  const reqStatus = new Map(reqs.map((r) => [r.id, r.status]));
  const live = new Set(rc.filter((r) => !r.voided_at).map((r) => r.id));
  const rcPo = new Map(rc.map((r) => [r.id, r.po_id]));
  const out = new Map<string, { received: number; claimed: number; paid: number; unclaimed: boolean; po: any }>();
  for (const p of poRows) {
    let u = 0;
    for (const it of items) if (live.has(it.receipt_id) && rcPo.get(it.receipt_id) === p.id) u += Number(it.amount_untaxed);
    const received = u + Math.round(u * Number(p.tax_rate));
    let claimed = 0, paid = 0;
    for (const l of lines) {
      if (l.po_id !== p.id) continue;
      const st = reqStatus.get(l.pr_id);
      if (st !== 'VOID') claimed += Number(l.claim_total);
      if (st === 'PAID') paid += Number(l.claim_total);
    }
    out.set(p.id, { received, claimed, paid, unclaimed: received - claimed > tol, po: p });
  }
  return out;
}
const unclaimedCount = async (tol = 5) => [...(await dbAmounts(tol)).values()].filter((x) => x.unclaimed).length;
const submittedCount = async () => ((await db().from('ga_payment_requests').select('id', { count: 'exact', head: true }).eq('status', 'SUBMITTED')).count || 0) as number;
const badges = async (who: string) => (await get(who, `${P}/home/badges`)).body.data as any;
const summary = async (who: string) => (await get(who, `${P}/home/summary`)).body.data as any;
const poTotal = async (who: string, q: string) => (await get(who, `${PO_API}?pageSize=5&${q}`)).body.total as number;
const prTotal = async (who: string, q: string) => (await get(who, `${PR}?pageSize=5&${q}`)).body.total as number;
const analysis = async (who: string) => (await get(who, `${P}/purchase-analysis?yearMonth=${MONTH}&pageSize=100`)).body.data as any;
const perf = async (who: string) => (await get(who, `${P}/vendor-stats?from=${MONTH}&to=${MONTH}`)).body.data as any;
const mine = (o: Map<string, any>) => Object.values(pos).map((p: any) => o.get(p.id)!);

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGa45Users(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
  for (const k of KEYS) apis[k] = await apiForUser(users[k] as any);
  vendor = await seedGa45Vendor(`STAT${(seq += 1)}`);
  // A：10×100 全收（含稅 1050）；B：10×200 只收 5（未稅 1000、含稅 1050）；C：10×100 分兩次收 3 與 7（含稅 315 + 735）；D：10×100 全收（尾差測試）
  pos.A = await orderedPo('A', 10, 100); rcs.A = [await receive(pos.A, 10)];
  pos.B = await orderedPo('B', 10, 200); rcs.B = [await receive(pos.B, 5)];
  pos.C = await orderedPo('C', 10, 100); rcs.C = [await receive(pos.C, 3), await receive(pos.C, 7)];
  pos.D = await orderedPo('D', 10, 100); rcs.D = [await receive(pos.D, 10)];
  // 把下訂日改到 2038-03（收貨後才改，避免到貨日早於下訂日被擋）；採購分析以下訂日（台北）歸月
  for (const p of Object.values(pos)) await db().from('ga_purchase_orders').update({ ordered_at: '2038-03-15T10:00:00+08:00' }).eq('id', p.id);
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號與臨時角色').toEqual([]);
  const v = await db().from('ga_vendors').select('id', { count: 'exact', head: true }).like('name', 'QA-GA45-%');
  expect(v.count, '測試廠商殘留').toBe(0);
});

test('基準：驗入含稅額與資料庫一致；沒有請款時四張採購單都是待請款', async () => {
  const o = await dbAmounts();
  expect(mine(o).map((x) => x.received)).toEqual([1050, 1050, 1050, 1050]);
  expect(mine(o).every((x) => x.claimed === 0 && x.unclaimed)).toBe(true);
  const viaFn = await db().rpc('ga_pay_po_amounts', { p_ids: Object.values(pos).map((p: any) => p.id) });
  expect(viaFn.error, JSON.stringify(viaFn.error)).toBeNull();
  for (const r of viaFn.data as any[]) {
    const exp = o.get(r.po_id)!;
    expect([Number(r.received_total), Number(r.claimed), Number(r.paid)]).toEqual([exp.received, exp.claimed, exp.paid]);
  }
});

test('徽章、首頁、列表三處筆數一致：待請款（有請款權限者）；沒有請款權限者看不到也不被影響', async () => {
  const expected = await unclaimedCount();
  expect(expected).toBeGreaterThanOrEqual(4);
  for (const who of ['clerk', 'accountant', 'viewer', 'perf_pay']) {
    const b = await badges(who);
    expect(b.items.pay_unclaimed, `${who} 徽章`).toBe(expected);
    expect(await poTotal(who, 'payUnclaimed=1'), `${who} 待請款列表`).toBe(expected);
    // 採購單選單徽章＝待我處理聯集（含待請款）＝列表 attention 筆數
    expect(await poTotal(who, 'attention=1'), `${who} attention 列表`).toBe(b.menu.purchase_orders);
    expect(b.menu.purchase_orders, `${who} 選單`).toBeGreaterThanOrEqual(expected);
    const s = await summary(who);
    const item = (s.items as any[]).find((x) => x.key === 'pay_unclaimed');
    expect(item, `${who} 首頁`).toBeTruthy();
    expect(item).toMatchObject({ label: '待請款採購單', menu: 'purchase_orders', count: expected });
    expect(item.top.length).toBeLessThanOrEqual(5);
    expect(item.top[0].sub).toContain('尚未請款');
  }
  // 沒有請款權限：鍵不存在、待請款篩選沒有結果、選單數字只含原本的待核准與逾期
  for (const who of ['purchaser', 'perf_nopay']) {
    const b = await badges(who);
    if (who === 'perf_nopay') expect(b.items.pay_unclaimed).toBeUndefined();
    else expect(b.items.pay_unclaimed, who).toBeUndefined();
    expect(b.items.pay_submitted, who).toBeUndefined();
    expect(b.menu.payment_requests, who).toBeUndefined();
    expect(await poTotal(who, 'payUnclaimed=1'), `${who} 待請款列表`).toBe(0);
    expect(await poTotal(who, 'attention=1'), `${who} attention`).toBe(b.menu.purchase_orders ?? 0);
    const s = await summary(who);
    expect((s.items as any[]).some((x) => x.key === 'pay_unclaimed' || x.key === 'pay_submitted'), who).toBe(false);
  }
});

test('請款後待請款減少：草稿算已請款；部分請款仍待請款；作廢請款單額度釋放後又回到待請款；徽章與列表同步', async () => {
  const before = await unclaimedCount();
  const a = await mkPr(rcs.A[0].id); // A 全額請款（草稿也佔額度）
  expect(await unclaimedCount()).toBe(before - 1);
  expect((await badges('clerk')).items.pay_unclaimed).toBe(before - 1);
  expect(await poTotal('clerk', 'payUnclaimed=1')).toBe(before - 1);
  // C 只請第一次進貨（315）：還有 735 沒請，仍是待請款
  const c1 = await mkPr(rcs.C[0].id);
  expect(await unclaimedCount()).toBe(before - 1);
  const c2 = await mkPr(rcs.C[1].id);
  expect(await unclaimedCount()).toBe(before - 2); // C 兩次進貨都請了
  expect((await badges('viewer')).items.pay_unclaimed).toBe(before - 2);
  // 作廢 A 的請款單：額度釋放，回到待請款
  const va = await act(a, 'void', {});
  expect(va.status, JSON.stringify(va.body)).toBe(200);
  expect(await unclaimedCount()).toBe(before - 1);
  expect(await poTotal('clerk', 'payUnclaimed=1')).toBe(before - 1);
  expect((await badges('accountant')).items.pay_unclaimed).toBe(before - 1);
  // 清理：C 的兩張請款單留給後面測試用（c1 送出、c2 草稿）
  const sub = await act(c1, 'submit', {});
  expect(sub.status).toBe(200);
  void c2;
});

test('待付款：送出才算；徽章＝選單徽章＝請款單列表待付款頁籤筆數＝資料庫 SUBMITTED 筆數；標已付款後減少', async () => {
  const base = await submittedCount();
  const b0 = await badges('accountant');
  expect(b0.items.pay_submitted).toBe(base);
  expect(b0.menu.payment_requests).toBe(base);
  expect(await prTotal('accountant', 'status=SUBMITTED')).toBe(base);
  const item = ((await summary('accountant')).items as any[]).find((x) => x.key === 'pay_submitted');
  expect(item).toMatchObject({ label: '待付款請款單', menu: 'payment_requests', count: base });
  // 新送出一張
  const b = await mkPr(rcs.B[0].id);
  expect((await badges('accountant')).items.pay_submitted).toBe(base); // 草稿不算
  const sb = (await act(b, 'submit', {})).body.data;
  expect((await badges('accountant')).items.pay_submitted).toBe(base + 1);
  expect((await badges('accountant')).menu.payment_requests).toBe(base + 1);
  expect(await prTotal('accountant', 'status=SUBMITTED')).toBe(base + 1);
  expect(await submittedCount()).toBe(base + 1);
  // 沒有請款權限者：看不到
  expect((await badges('purchaser')).menu.payment_requests).toBeUndefined();
  // 標已付款（會計）：待付款減少；已付款不算待付款
  const paid = await act(sb, 'mark_paid', { pay_method: 'TRANSFER', paid_ref: 'QA-STAT' }, 'accountant');
  expect(paid.status, JSON.stringify(paid.body)).toBe(200);
  expect((await badges('accountant')).items.pay_submitted).toBe(base);
  expect(await prTotal('accountant', 'status=SUBMITTED')).toBe(base);
  // 退回草稿也不算待付款
  const c1 = (await get('clerk', `${PR}?pageSize=50&status=SUBMITTED&vendorId=${vendor.id}`)).body.data as any[];
  expect(c1).toHaveLength(1);
  const back = await act(await fresh(c1[0].id), 'return', { reason: '再確認' }, 'accountant');
  expect(back.status, JSON.stringify(back.body)).toBe(200);
  expect((await badges('accountant')).items.pay_submitted).toBe(base - 1);
});

test('尾差邊界：差 5 元不算待請款、差 6 元算；尾差設定調整立即影響徽章；列表筆數同步', async () => {
  // D：含稅 1050。請款 1044（差 6，要填原因）→ 仍待請款；請款 1045（差 5）→ 不再待請款
  const before = await unclaimedCount();
  const isD = async () => ((await dbAmounts()).get(pos.D.id)!.unclaimed);
  expect(await isD()).toBe(true);
  const d6 = await mkPr(rcs.D[0].id, { lines: [{ receipt_id: rcs.D[0].id, claim_untaxed: 1000, claim_tax: 44, diff_reason: '折讓 6 元' }] });
  expect(d6.amount_total).toBe(1044);
  expect(await isD()).toBe(true);
  expect(await unclaimedCount()).toBe(before);
  expect(await poTotal('clerk', 'payUnclaimed=1')).toBe(before);
  expect((await act(d6, 'void', {})).status).toBe(200);
  const d5 = await mkPr(rcs.D[0].id, { lines: [{ receipt_id: rcs.D[0].id, claim_untaxed: 1000, claim_tax: 45 }] });
  expect(d5.amount_total).toBe(1045);
  expect(await isD()).toBe(false);
  expect(await unclaimedCount()).toBe(before - 1);
  expect(await poTotal('clerk', 'payUnclaimed=1')).toBe(before - 1);
  expect((await badges('clerk')).items.pay_unclaimed).toBe(before - 1);
  // 尾差改 0：差 5 元也算待請款（資料庫與徽章同步）；改回 5
  const ver = (await get('clerk', SET)).body.data.updated_at as string;
  expect((await send('clerk', 'put', SET, { tolerance_amount: 0, expected_updated_at: ver })).status).toBe(200);
  try {
    expect((await badges('clerk')).items.pay_unclaimed).toBe(await unclaimedCount(0));
    expect(await poTotal('clerk', 'payUnclaimed=1')).toBe(await unclaimedCount(0));
    expect(await unclaimedCount(0)).toBeGreaterThan(before - 1);
  } finally {
    const cur = (await get('clerk', SET)).body.data.updated_at as string;
    expect((await send('clerk', 'put', SET, { tolerance_amount: 5, expected_updated_at: cur })).status).toBe(200);
  }
  expect((await badges('clerk')).items.pay_unclaimed).toBe(before - 1);
  expect((await act(d5, 'void', {})).status).toBe(200);
});

test('已作廢進貨不計入統計：作廢後待請款、驗入含稅額、採購分析已到貨實收與未請款驗入同步變少', async () => {
  // 先把 B、C、D 的請款單都作廢，只留乾淨的對照（A 沒有請款）
  const all = (await get('clerk', `${PR}?pageSize=100&vendorId=${vendor.id}`)).body.data as any[];
  for (const r of all.filter((x) => x.status !== 'VOID')) {
    const cur = await fresh(r.id);
    const res = await act(cur, 'void', { reason: '統計測試重置' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }
  const before = await analysis('clerk');
  const recvBefore = Number(before.confirmed.received_amount);
  expect(before.can_view_payment).toBe(true);
  expect(Number(before.confirmed.unclaimed_received_amount)).toBe(4200); // 四張各 1050
  expect(Number(before.confirmed.claimed_amount)).toBe(0);
  expect(Number(before.confirmed.paid_amount)).toBe(0);
  const unBefore = await unclaimedCount();
  // 作廢 C 的第二次進貨（735）
  const r = await send('clerk', 'post', voidUrl(pos.C.id, rcs.C[1].id), { reason: '登錯', idempotency_key: key(), expected_updated_at: (await db().from('ga_purchase_receipts').select('updated_at').eq('id', rcs.C[1].id).single()).data!.updated_at });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const after = await analysis('clerk');
  expect(Number(after.confirmed.received_amount)).toBe(recvBefore - 700); // 未稅 7 × 100（原本欄位口徑不變，只是進貨作廢後扣回）
  expect(Number(after.confirmed.unclaimed_received_amount)).toBe(4200 - 735);
  const o = await dbAmounts();
  expect(o.get(pos.C.id)!.received).toBe(315);
  expect(await unclaimedCount()).toBe(unBefore); // C 還剩 315 沒請，仍是待請款
  // 每張採購單的欄位：C 的驗入未請款變 315
  const rowC = (after.orders as any[]).find((x) => x.id === pos.C.id);
  expect(rowC).toMatchObject({ claimed_amount: 0, paid_amount: 0, unclaimed_received_amount: 315 });
  // 作廢第一次進貨也作廢：C 沒有任何驗入，不再待請款
  const r2 = await send('clerk', 'post', voidUrl(pos.C.id, rcs.C[0].id), { reason: '全部重登', idempotency_key: key(), expected_updated_at: (await db().from('ga_purchase_receipts').select('updated_at').eq('id', rcs.C[0].id).single()).data!.updated_at });
  expect(r2.status, JSON.stringify(r2.body)).toBe(200);
  expect(await unclaimedCount()).toBe(unBefore - 1);
  expect((await badges('clerk')).items.pay_unclaimed).toBe(unBefore - 1);
  expect(await poTotal('clerk', 'payUnclaimed=1')).toBe(unBefore - 1);
  expect((await dbAmounts()).get(pos.C.id)!.received).toBe(0);
  const rowC2 = ((await analysis('clerk')).orders as any[]).find((x) => x.id === pos.C.id);
  expect(rowC2).toMatchObject({ unclaimed_received_amount: 0, received_amount: 0 });
});

test('採購分析：已請款、已付款、未請款驗入與資料庫逐張比對；沒有請款權限者欄位不存在；原有欄位不變', async () => {
  // 請款：A 全額（PAID）、B 全額（SUBMITTED）、D 全額（DRAFT）；C 沒有驗入
  const a = await mkPr(rcs.A[0].id);
  const pa = await act(await act(a, 'submit', {}).then((r) => r.body.data), 'mark_paid', { pay_method: 'CASH' }, 'accountant');
  expect(pa.status, JSON.stringify(pa.body)).toBe(200);
  const b = await mkPr(rcs.B[0].id);
  expect((await act(b, 'submit', {})).status).toBe(200);
  await mkPr(rcs.D[0].id);
  const o = await dbAmounts();
  const mineRows = mine(o);
  const expClaimed = mineRows.reduce((s, x) => s + x.claimed, 0);
  const expPaid = mineRows.reduce((s, x) => s + x.paid, 0);
  const expUnclaimed = mineRows.reduce((s, x) => s + Math.max(0, x.received - x.claimed), 0);
  expect([expClaimed, expPaid, expUnclaimed]).toEqual([3150, 1050, 0]);
  const d = await analysis('viewer');
  expect(d.can_view_payment).toBe(true);
  expect(d.confirmed).toMatchObject({ claimed_amount: expClaimed, paid_amount: expPaid, unclaimed_received_amount: expUnclaimed });
  for (const p of Object.values(pos)) {
    const row = (d.orders as any[]).find((x) => x.id === p.id);
    const exp = o.get(p.id)!;
    expect(row, p.po_no).toMatchObject({ claimed_amount: exp.claimed, paid_amount: exp.paid, unclaimed_received_amount: Math.max(0, exp.received - exp.claimed) });
  }
  // 原有欄位口徑不動
  const total = mineRows.reduce((s, x) => s + Number(x.po.total_amount), 0);
  expect(Number(d.confirmed.total_amount)).toBe(total);
  expect(d.confirmed.count).toBe(4);
  // 沒有請款權限：欄位不存在（不是 0）
  for (const who of ['purchaser', 'perf_nopay']) {
    const n = await analysis(who);
    expect(n.can_view_payment, who).toBe(false);
    expect(n.confirmed, who).not.toHaveProperty('claimed_amount');
    expect(n.confirmed, who).not.toHaveProperty('paid_amount');
    expect(n.confirmed, who).not.toHaveProperty('unclaimed_received_amount');
    expect((n.orders as any[])[0], who).not.toHaveProperty('claimed_amount');
    expect(Number(n.confirmed.total_amount), who).toBe(total);
  }
  // 沒有採購評估檢視／管理（只有 nobody）：403
  expect((await get('nobody', `${P}/purchase-analysis?yearMonth=${MONTH}`)).status).toBe(403);
});

test('廠商績效：已付款金額只給有請款權限者；原有採購單金額與張數不變；沒有權限欄位為 null', async () => {
  const o = await dbAmounts();
  const expPaid = mine(o).reduce((s, x) => s + x.paid, 0);
  const total = mine(o).reduce((s, x) => s + Number(x.po.total_amount), 0);
  const p = await perf('perf_pay');
  expect(p.can_view_po_amount).toBe(true);
  expect(p.can_view_pay_amount).toBe(true);
  const row = (p.rows as any[]).find((x) => x.vendor_id === vendor.id);
  expect(row, '績效列').toBeTruthy();
  expect(Number(row.po_paid_amount)).toBe(expPaid);
  expect(Number(row.po_amount)).toBe(total);
  expect(row.po_count).toBe(4);
  expect(Number(p.summary.po_paid_total)).toBeGreaterThanOrEqual(expPaid);
  const n = await perf('perf_nopay');
  expect(n.can_view_po_amount).toBe(true);
  expect(n.can_view_pay_amount).toBe(false);
  const nrow = (n.rows as any[]).find((x) => x.vendor_id === vendor.id);
  expect(nrow.po_paid_amount).toBeNull();
  expect(Number(nrow.po_amount)).toBe(total);
  expect(n.summary.po_paid_total).toBeNull();
  // 已付款作廢後釋放：已付款金額跟著減少
  const paidReq = (await get('clerk', `${PR}?pageSize=50&status=PAID&vendorId=${vendor.id}`)).body.data as any[];
  expect(paidReq).toHaveLength(1);
  const vp = await act(await fresh(paidReq[0].id), 'void', { reason: '付款退回' }, 'accountant');
  expect(vp.status, JSON.stringify(vp.body)).toBe(200);
  const p2 = await perf('perf_pay');
  expect(Number((p2.rows as any[]).find((x) => x.vendor_id === vendor.id).po_paid_amount)).toBe(0);
  expect(Number((await analysis('clerk')).confirmed.paid_amount)).toBe(0);
});

test('資料庫權限：登入者不能直接讀寫請款相關表與呼叫內部述詞函式（避免繞過權限）', async () => {
  for (const who of ['clerk', 'perf_pay', 'nobody'] as Ga45Key[]) {
    for (const fn of ['ga_pay_unclaimed_po_ids', 'ga_pay_po_amounts']) {
      const args = fn === 'ga_pay_po_amounts' ? { p_ids: [] } : { p_tol: 5 };
      const r: any = await users[who].client.rpc(fn, args);
      expect(r.error, `${who} ${fn}`).toBeTruthy();
    }
  }
  const svc = await db().rpc('ga_pay_unclaimed_po_ids', { p_tol: 5 });
  expect(svc.error).toBeNull();
  expect((svc.data as any[]).length).toBe(await unclaimedCount());
});
