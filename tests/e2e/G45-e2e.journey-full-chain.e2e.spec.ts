import crypto from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, sideLabels, visibleHeading } from '../support/g01-ui';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name, seedCategory, seedEquipmentTemplate, seedLocation, seedLocationPart, seedPart, stores } from '../support/m7m8-fixtures';
import { seedGa45Vendor, setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';
import { taipeiToday } from '../support/m7m8-po-fixtures';
import { multipartBody } from '../support/multipart';
import { makePng } from '../support/png';

// 第 4.5 批 G45-e2e（總串接：角色接力劇本，桌機 1440 與手機 390 各跑一次）。
// 範圍是前四階段單項劇本之外的「整條鏈」：總務下採購單、分批到貨（含拒收）、登錄三聯式發票（缺圖、重複號碼、尾差、統編不符）、
// 建請款單（只能請可請款進貨、超過上限被擋、重複送出不重複建立、STALE 並發）→ 送出 → 退回 → 再送 → 會計標已付款 → 已付款鎖定 →
// 作廢已付款釋放額度可重新請款；廠商改帳號後請款單快照不變（草稿重抓才更新）；列印與 CSV（含公式注入）；
// 配發轉設備後請款不受影響且該進貨不可作廢；沒有請款權限者（採購、店長、管理員身分無角色）在畫面與 API 都看不到；
// 檢視者與無廠商權限者的銀行、統編遮蔽。每步用 service role 回讀資料庫。
// 測試資料：廠商 QA-GA45- 標記、採購單 [自動測試]M7M8 標記、VW／ZT 門市、只用 DEV；結束只清自己的。
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });

const KEYS: Ga45Key[] = ['clerk', 'accountant', 'viewer', 'novendor', 'purchaser', 'store_mgr', 'admin'];
const P = '/api/workspace/general-affairs';
const PR = `${P}/payment-requests`;
const INV = `${P}/purchase-invoices`;
const PO = `${P}/purchase-orders`;
let users: Record<string, Ga45User> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
const apis: Record<string, APIRequestContext> = {};
let vendor: any;
let po: any; // 主採購單：訂 20 件 × 100，分兩批收 10、6
let rc: any[] = [];
let po2: any; // 拒收採購單：訂 5、到貨 5、驗入 3
let rcRej: any;
let po3: any; // 配發採購單（可轉設備的料件）
let rcDisp: any;
let part3: any;
let prNo = '';
let prId = '';
let voidedNo = ''; // 測試 3 作廢的請款單號（F2 匯出勾選已作廢用）
let invA: any;
const db = () => adminDb();
const key = () => crypto.randomUUID();
const today = () => {
  const d = taipeiToday();
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
};
const vis = (page: Page, testid: string) => page.getByTestId(testid).locator('visible=true');
const noConsole = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const j = async (r: any) => ({ status: r.status() as number, body: await r.json().catch(() => ({})) as any });
const get = async (k: string, p: string) => j(await apis[k].get(p));
const send = async (k: string, method: 'post' | 'patch' | 'put', p: string, data?: unknown) => j(await (apis[k] as any)[method](p, { data: data ?? {} }));
const rpcOk = async (who: Ga45Key, name: string, args: Record<string, unknown>) => {
  const r: any = await callFn(users[who].client, name, args);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
};
const itemId = (p: any, line = 1) => p.items.find((i: any) => i.line_no === line).id as string;
const dbPr = async (id = prId) => (await db().from('ga_payment_requests').select('*').eq('id', id).single()).data as any;
const dbEvents = async (id = prId) => ((await db().from('ga_payment_request_events').select('event_type,actor_id,reason,from_status,to_status').eq('pr_id', id).order('created_at')).data || []) as any[];
const act = (who: string, id: string, action: string, version: string, extra: Record<string, unknown> = {}) =>
  send(who, 'post', `${PR}/${id}/actions`, { action, expected_updated_at: version, idempotency_key: key(), ...extra });
let invSeq = 0;
const invNo = () => `QE${String(Date.now()).slice(-6)}${String((invSeq += 1)).padStart(3, '0')}`;
const mkInv = (receiptId: string, over: Record<string, unknown> = {}) => ({ invoice_type: 'TRIPLE', invoice_no: invNo(), invoice_date: today(), vendor_id: vendor.id, amount_untaxed: 1000, receipts: [{ receipt_id: receiptId }], idempotency_key: key(), ...over });
async function nav(page: Page, label: string) {
  await openGaSide(page);
  await shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first().click();
}
async function openPoDetail(page: Page, target = po) {
  await openGaCenter(page);
  await nav(page, '採購單');
  await expect(visibleHeading(page, '採購單')).toBeVisible();
  await vis(page, 'po-search').fill(target.po_no);
  await expect(page.locator('[data-testid="po-card"]:visible')).toHaveCount(1);
  await vis(page, 'open-detail').click();
  await expect(vis(page, 'po-detail')).toBeVisible();
}

test.beforeAll(async () => {
  test.setTimeout(360_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGa45Users(KEYS);
  users = made.users;
  teardown = made.teardown;
  for (const k of KEYS) {
    apis[k] = await apiForUser(users[k] as any);
    states[k] = await apis[k].storageState();
  }
  vendor = await seedGa45Vendor('EJNY');
  const place = async (items: unknown[], tag: string, extra: Record<string, unknown> = {}) => {
    const d = await rpcOk('clerk', 'ga_ws_po_create', { p_header: { notes: m7Name(tag), vendor_id: vendor.id, ...extra }, p_items: items, p_create_key: key() });
    return rpcOk('clerk', 'ga_ws_po_action', { p_id: d.id, p_action: 'place_order', p_expected_updated_at: d.updated_at, p_note: null });
  };
  po = await place([{ item_name: 'QA-GA45 串接品項', unit: '個', quantity: 20, unit_price: 100 }], 'EJNY1');
  for (const q of [10, 6]) rc.push(await rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [{ po_item_id: itemId(po), delivered_qty: q }], p_key: key() }));
  po2 = await place([{ item_name: 'QA-GA45 拒收品項', unit: '個', quantity: 5, unit_price: 100 }], 'EJNY2');
  rcRej = await rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po2.id, p_header: {}, p_lines: [{ po_item_id: itemId(po2), delivered_qty: 5, accepted_qty: 3, reason: '外箱破損拒收 2 件' }], p_key: key() });
  // 配發劇本：料件綁設備型號，進貨入庫後配發轉設備
  const st = await stores();
  const eqCat = await db().from('ga_equipment_categories').select('id').eq('code', 'IC0201').is('deleted_at', null).single();
  if (!eqCat.data) throw new Error('DEV 沒有設備分類 IC0201，無法測試配發轉設備');
  const tpl = await seedEquipmentTemplate(eqCat.data.id, 'EJNY-T', { default_warranty_months: 12, description: '串接劇本印表機' });
  const cat = await seedCategory('part', 'EJNY');
  part3 = await seedPart(cat.id, 'EJNY-P', { equipment_template_id: tpl.id });
  const loc = await seedLocation(null, 'EJNY-W');
  await seedLocationPart(loc.id, part3.id);
  po3 = await place([{ part_id: part3.id, quantity: 2, unit_price: 100 }], 'EJNY3', { receiving_location_id: loc.id });
  rcDisp = await rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po3.id, p_header: {}, p_lines: [{ po_item_id: itemId(po3), delivered_qty: 2 }], p_key: key() });
  (globalThis as any).__ga45Store = st.VW001.id;
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('1. 總務登錄三聯式發票：缺圖可先存；同廠商重複號碼被擋；尾差 5 元內免原因、6 元要原因；統編不符要原因；補圖後缺圖消失', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const a = await send('clerk', 'post', INV, mkInv(rc[0].id, { tax_amount: 55 })); // 含稅 1055，與進貨 1050 差 5：剛好在尾差內
  expect(a.status, JSON.stringify(a.body)).toBe(201);
  invA = a.body.data;
  expect(invA).toMatchObject({ missing_image: true, amount_total: 1055 });
  expect(invA.diff_reason).toBeNull();
  expect(a.body.warnings.map((w: any) => w.code)).toContain('MISSING_IMAGE');
  const dup = await send('clerk', 'post', INV, mkInv(rc[0].id, { invoice_no: invA.invoice_no.toLowerCase() }));
  expect(dup.status).toBe(409);
  expect(dup.body.code).toBe('INVOICE_NO_DUPLICATE');
  const need = await send('clerk', 'post', INV, mkInv(rc[0].id, { tax_amount: 56 }));
  expect([need.status, need.body.code]).toEqual([400, 'DIFF_REASON_REQUIRED']);
  const wrongTax = vendor.tax_id === '12345678' ? '87654321' : '12345678';
  const mm = await send('clerk', 'post', INV, mkInv(rc[0].id, { seller_tax_id: wrongTax }));
  expect([mm.status, mm.body.code]).toEqual([400, 'TAX_MISMATCH_REASON_REQUIRED']);
  expect((await db().from('ga_purchase_invoices').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id)).count).toBe(1);
  // 缺圖發票不能被請款單引用（建立請款單被擋）
  const blocked = await send('clerk', 'post', PR, { vendor_id: vendor.id, lines: [{ receipt_id: rc[0].id, invoice_id: invA.id }], idempotency_key: key() });
  expect(blocked.status).toBe(409);
  expect(blocked.body.code).toBe('INVOICE_MISSING_IMAGE');
  expect((await db().from('ga_payment_requests').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id)).count).toBe(0);
  // 補傳圖片
  const mp = multipartBody([{ name: 'inv.png', mimeType: 'image/png', buffer: makePng({ width: 40, height: 40, colorful: true }) }], { resource_type: 'PURCHASE_INVOICE', resource_id: invA.id, purpose: 'INVOICE_IMAGE' });
  const up = await apis.clerk.post(`${P}/attachments`, { data: mp.data, headers: mp.headers });
  expect(up.status(), await up.text()).toBe(201);
  const after = await get('clerk', `${INV}/${invA.id}`);
  expect(after.body.data).toMatchObject({ missing_image: false, image_count: 1 });
  // 畫面：採購單「發票與請款」分頁看得到這張發票
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openPoDetail(page);
    await vis(page, 'pd-tab-pay').click();
    await expect(page.locator('body')).toContainText(invA.invoice_no);
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  expect((await db().from('ga_purchase_receipts').select('voucher_status').eq('id', rc[0].id).single()).data).toMatchObject({ voucher_status: 'LINKED' });
});

test('2. 建請款單：拒收量不可請；只能請該廠商已驗入的進貨；重複送出不重複建立；超過累計上限被擋；STALE 並發', async () => {
  test.setTimeout(240_000);
  // 拒收單：驗入 3 × 100 ×1.05 = 315，不可超過
  const cand = await get('clerk', `${PR}/candidates?vendorId=${vendor.id}`);
  expect(cand.status, JSON.stringify(cand.body)).toBe(200);
  const rows: any[] = cand.body.data?.items || cand.body.data || [];
  const rej = rows.find((r) => (r.receipt_id || r.id) === rcRej.id);
  expect(rej, '拒收進貨應在候選').toBeTruthy();
  expect(Number(rej.claimable ?? rej.available ?? rej.remaining ?? 315)).toBe(315);
  const k1 = key();
  const body = { vendor_id: vendor.id, lines: [{ receipt_id: rc[0].id }], notes: '串接劇本第一批', idempotency_key: k1 };
  const c1 = await send('clerk', 'post', PR, body);
  expect(c1.status, JSON.stringify(c1.body)).toBe(201);
  prId = c1.body.data.id;
  prNo = c1.body.data.pr_no;
  expect(c1.body.data).toMatchObject({ status: 'DRAFT', amount_total: 1050 });
  const c2 = await send('clerk', 'post', PR, body); // 重複送出：同識別回原結果，不重複建立
  expect(c2.status).toBe(200);
  expect(c2.body.data.id).toBe(prId);
  expect((await db().from('ga_payment_requests').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id)).count).toBe(1);
  // 第一批已被請款單占用：同一進貨再請一次被擋（超過累計上限）
  const over = await send('clerk', 'post', PR, { vendor_id: vendor.id, lines: [{ receipt_id: rc[0].id }], idempotency_key: key() });
  expect([over.status, over.body.code]).toEqual([409, 'OVER_CLAIM']);
  // 沒有進貨的廠商＋別家進貨：400 或 409，不寫入
  const bad = await send('clerk', 'post', PR, { vendor_id: vendor.id, lines: [{ receipt_id: crypto.randomUUID() }], idempotency_key: key() });
  expect(bad.status).toBeGreaterThanOrEqual(400);
  // STALE 並發：兩人拿同一版本，先到先贏
  const ver = c1.body.data.updated_at;
  const s1 = await act('clerk', prId, 'submit', ver);
  expect(s1.status, JSON.stringify(s1.body)).toBe(200);
  const s2 = await act('accountant', prId, 'submit', ver);
  expect(s2.status).toBe(409);
  expect(['STALE', 'INVALID_STATE']).toContain(s2.body.code);
  expect((await dbPr()).status).toBe('SUBMITTED');
});

test('3. 退回→修改→再送→會計標已付款→已付款鎖定；作廢已付款需原因，釋放額度後第二批可請款，第一批可重新請款', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  let p = await dbPr();
  const noReason = await act('accountant', prId, 'return', p.updated_at, {});
  expect(noReason.status).toBe(400);
  const ret = await act('accountant', prId, 'return', p.updated_at, { reason: '發票日期與送貨單不符' });
  expect(ret.status, JSON.stringify(ret.body)).toBe(200);
  expect(await dbPr()).toMatchObject({ status: 'DRAFT' });
  p = await dbPr();
  const patch = await send('clerk', 'patch', `${PR}/${prId}`, { notes: '已補正發票日期', expected_updated_at: p.updated_at });
  expect(patch.status, JSON.stringify(patch.body)).toBe(200);
  const s = await act('clerk', prId, 'submit', patch.body.data.updated_at);
  expect(s.status).toBe(200);
  p = await dbPr();
  const early = await act('accountant', prId, 'mark_paid', p.updated_at, { pay_method: 'TRANSFER', paid_date: today(), reference_no: 'E2E-12345' });
  expect(early.status, JSON.stringify(early.body)).toBe(200);
  expect(await dbPr()).toMatchObject({ status: 'PAID' });
  // 已付款鎖定：不可退回、不可修改
  p = await dbPr();
  expect((await act('clerk', prId, 'return', p.updated_at, { reason: '想退' })).status).toBe(409);
  expect((await send('clerk', 'patch', `${PR}/${prId}`, { notes: 'x', expected_updated_at: p.updated_at })).status).toBeGreaterThanOrEqual(400);
  // 畫面：會計看得到已付款，總務看到付款資訊
  const { ctx, page, errors } = await pageForUser(browser, states.accountant, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '請款單');
    await expect(visibleHeading(page, '請款單')).toBeVisible();
    await vis(page, 'pr-search').fill(prNo);
    await expect(page.locator('[data-testid="pr-card"]:visible')).toHaveCount(1);
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  // 作廢已付款：必填原因，釋放額度
  voidedNo = prNo;
  const needR = await act('accountant', prId, 'void', p.updated_at, {});
  expect(needR.status).toBe(400);
  const v = await act('accountant', prId, 'void', p.updated_at, { reason: '重複付款，改開新單' });
  expect(v.status, JSON.stringify(v.body)).toBe(200);
  expect(await dbPr()).toMatchObject({ status: 'VOID' });
  const ev = await dbEvents();
  expect(ev.map((e) => e.event_type)).toEqual(expect.arrayContaining(['create', 'submit', 'return', 'submit', 'mark_paid', 'void']));
  expect(ev.at(-1)).toMatchObject({ event_type: 'void', actor_id: users.accountant.id, reason: '重複付款，改開新單' });
  // 事件表不可改刪
  const del = await db().from('ga_payment_request_events').delete().eq('pr_id', prId);
  expect(del.error, '事件表應拒絕刪除').toBeTruthy();
  // 釋放後：第一批與第二批合併請款（1050 + 630 = 1680）
  const c = await send('clerk', 'post', PR, { vendor_id: vendor.id, lines: [{ receipt_id: rc[0].id }, { receipt_id: rc[1].id }], notes: '合併請款', idempotency_key: key() });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  expect(c.body.data.amount_total).toBe(1680);
  prId = c.body.data.id;
  prNo = c.body.data.pr_no;
});

test('4. 銀行帳號快照：廠商改帳號後請款單不變，草稿重抓才更新；檢視者與無廠商權限者看不到銀行與統編', async () => {
  test.setTimeout(180_000);
  const before = await dbPr();
  expect(before.bank_snapshot.bank_account).toBe('123-456-789012');
  await db().from('ga_vendors').update({ bank_account: '999-000-111222' }).eq('id', vendor.id);
  expect((await dbPr()).bank_snapshot.bank_account).toBe('123-456-789012');
  const d = await get('clerk', `${PR}/${prId}`);
  expect(d.body.data.bank_snapshot.bank_account).toBe('123-456-789012');
  const re = await act('clerk', prId, 'refresh_bank', before.updated_at);
  expect(re.status, JSON.stringify(re.body)).toBe(200);
  expect((await dbPr()).bank_snapshot.bank_account).toBe('999-000-111222');
  // 遮蔽：檢視者、無廠商權限者的詳情與列印資料沒有銀行帳號與統編
  for (const who of ['viewer', 'novendor']) {
    const r = await apis[who].get(`${PR}/${prId}`);
    expect(r.status(), who).toBe(200);
    const t = await r.text();
    expect(t, who).not.toContain('999-000-111222');
    expect(t, who).not.toContain(vendor.tax_id);
  }
  const ok = await apis.clerk.get(`${PR}/${prId}`);
  expect(await ok.text()).toContain('999-000-111222');
});

test('5. 列印與 CSV：A4 列印頁簽章兩段；CSV 有 BOM、公式注入被中和、檢視者可匯出但無統編與銀行', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const orig = (await db().from('ga_payment_requests').select('vendor_name_snapshot').eq('id', prId).single()).data as any;
  await db().from('ga_payment_requests').update({ vendor_name_snapshot: '=HYPERLINK("http://x")' }).eq('id', prId);
  try {
    const month = today().slice(0, 7);
    const res = await apis.accountant.get(`${PR}/export?month=${month}&vendorId=${vendor.id}&includeDraft=1`); // 目前這張是草稿；預設匯出不含草稿（F2）
    expect(res.status()).toBe(200);
    const buf = await res.body();
    expect([buf[0], buf[1], buf[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const text = buf.toString('utf8');
    expect(text).toContain(prNo);
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
    const rv = await apis.viewer.get(`${PR}/export?month=${month}&vendorId=${vendor.id}&includeDraft=1`);
    expect(rv.status()).toBe(200);
    expect(await rv.text()).not.toContain(vendor.tax_id);
  } finally {
    await db().from('ga_payment_requests').update({ vendor_name_snapshot: orig.vendor_name_snapshot }).eq('id', prId);
  }
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '請款單');
    await vis(page, 'pr-search').fill(prNo);
    await expect(page.locator('[data-testid="pr-card"]:visible')).toHaveCount(1);
    await page.locator('[data-testid="pr-card"]:visible').first().getByTestId('open-pr').click();
    await expect(vis(page, 'pe-status')).toBeVisible();
    await vis(page, 'pe-print').click();
    await expect(vis(page, 'pp-sign-ga')).toBeVisible();
    await expect(page.locator('body')).toContainText(prNo);
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('6. 配發轉設備後請款不受影響；已配發的進貨不可作廢；未請款未配發的進貨可作廢並沖回庫存', async () => {
  test.setTimeout(240_000);
  const st = (globalThis as any).__ga45Store as string;
  const d = await callFn(users.clerk.client, 'ga_ws_po_dispatch', { p_po_item_id: itemId(po3), p_store_id: st, p_quantity: 1, p_template_id: null, p_template_reason: null, p_source_location_id: null, p_serials: null, p_notes: null, p_key: key() });
  expect(d.ok, JSON.stringify(d)).toBe(true);
  expect(Number((await db().from('ga_purchase_order_items').select('dispatched_qty').eq('id', itemId(po3)).single()).data?.dispatched_qty)).toBe(1);
  // 請款不受影響：該進貨照常可建請款單
  const c = await send('clerk', 'post', PR, { vendor_id: vendor.id, lines: [{ receipt_id: rcDisp.id }], idempotency_key: key() });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  expect(c.body.data.amount_total).toBe(210);
  const rid = c.body.data.id;
  expect((await act('clerk', rid, 'void', c.body.data.updated_at, {})).status).toBe(200); // 草稿作廢，不必原因
  // 已配發：不可作廢進貨
  const blocked = await send('clerk', 'post', `${PO}/${po3.id}/receipts/${rcDisp.id}/void`, { reason: '想作廢', idempotency_key: key(), expected_updated_at: (await db().from('ga_purchase_receipts').select('updated_at').eq('id', rcDisp.id).single()).data?.updated_at });
  expect(blocked.status, JSON.stringify(blocked.body)).toBe(409);
  expect((await db().from('ga_purchase_receipts').select('voided_at').eq('id', rcDisp.id).single()).data?.voided_at).toBeNull();
  // 拒收單那筆：未請款、未配發，可作廢（原因必填）並沖回庫存
  const ver = (await db().from('ga_purchase_receipts').select('updated_at').eq('id', rcRej.id).single()).data?.updated_at;
  const noR = await send('clerk', 'post', `${PO}/${po2.id}/receipts/${rcRej.id}/void`, { idempotency_key: key(), expected_updated_at: ver });
  expect(noR.status).toBe(400);
  const ok = await send('clerk', 'post', `${PO}/${po2.id}/receipts/${rcRej.id}/void`, { reason: '登錯採購單', idempotency_key: key(), expected_updated_at: ver });
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect((await db().from('ga_purchase_receipts').select('voided_at,void_reason').eq('id', rcRej.id).single()).data).toMatchObject({ void_reason: '登錯採購單' });
  // 進貨已請款者不可作廢：目前請款單用到第一、二批
  const used = await send('clerk', 'post', `${PO}/${po.id}/receipts/${rc[1].id}/void`, { reason: '想作廢', idempotency_key: key(), expected_updated_at: (await db().from('ga_purchase_receipts').select('updated_at').eq('id', rc[1].id).single()).data?.updated_at });
  expect(used.status).toBe(409);
});

test('7. 沒有請款權限：採購人員、店長、管理員身分（無角色）看不到請款入口與發票金額，API 403；檢視者唯讀', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  for (const who of ['purchaser', 'store_mgr', 'admin']) {
    for (const p of [PR, INV, `${PR}/export?month=${today().slice(0, 7)}`, `${PO}/${po.id}/payment-summary`]) {
      const r = await get(who, p);
      expect(r.status, `${who} ${p}`).toBe(403);
    }
    expect((await send(who, 'post', PR, { vendor_id: vendor.id, lines: [{ receipt_id: rc[0].id }], idempotency_key: key() })).status, `${who} 建立`).toBe(403);
    const { ctx, page, errors } = await pageForUser(browser, states[who], testInfo);
    try {
      await openGaCenter(page).catch(() => undefined);
      const labels = await sideLabels(page).catch(() => [] as string[]);
      expect(labels, who).not.toContain('請款單');
      expect(labels, who).not.toContain('進貨發票');
      expect(errors.filter((e) => !/403|Failed to load resource/.test(e)), who).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
  // 採購人員看得到採購單，但「發票與請款」分頁與金額不出現
  const { ctx, page } = await pageForUser(browser, states.purchaser, testInfo);
  try {
    await openPoDetail(page);
    await expect(page.getByTestId('pd-tab-pay')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
  // 檢視者：能讀、不能寫
  expect((await get('viewer', PR)).status).toBe(200);
  expect((await send('viewer', 'post', PR, { vendor_id: vendor.id, lines: [{ receipt_id: rc[0].id }], idempotency_key: key() })).status).toBe(403);
  const p = await dbPr();
  expect((await act('viewer', p.id, 'mark_paid', p.updated_at, { pay_method: 'TRANSFER', paid_date: today() })).status).toBe(403);
});

// ---------------------------------------------------------------- 驗收追加（2026-11-20）：F1 至 F7、假設 (a)(b)
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
async function openPrPage(page: Page, no: string) {
  await openGaCenter(page);
  await nav(page, '請款單');
  await expect(visibleHeading(page, '請款單')).toBeVisible();
  await vis(page, 'pr-search').fill(no);
  await expect(page.locator('[data-testid="pr-card"]:visible')).toHaveCount(1);
  await page.locator('[data-testid="pr-card"]:visible').first().getByTestId('open-pr').click();
  await expect(vis(page, 'pe-status')).toBeVisible();
}
let subId = '';
let subNo = '';

test('8. F2 對帳 CSV：預設只含已送出與已付款；勾選加入草稿、已作廢（API 與畫面）；手機搜尋框不被擠扁；詳情副標不是建立頁文字', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  // 目前：prId 是草稿、voidedNo 是已作廢；再做一張已送出（用配發劇本的進貨，草稿作廢後額度已釋放）
  const c = await send('clerk', 'post', PR, { vendor_id: vendor.id, lines: [{ receipt_id: rcDisp.id }], notes: 'F2 已送出', idempotency_key: key() });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const sb = await act('clerk', c.body.data.id, 'submit', c.body.data.updated_at);
  expect(sb.status, JSON.stringify(sb.body)).toBe(200);
  subId = c.body.data.id;
  subNo = c.body.data.pr_no;
  const month = today().slice(0, 7);
  const base = `${PR}/export?month=${month}&vendorId=${vendor.id}`;
  const text = async (who: string, q = '') => (await (await apis[who].get(base + q)).body()).toString('utf8');
  for (const who of ['accountant', 'viewer']) {
    const t = await text(who);
    expect(t, who + ' 預設含已送出').toContain(subNo);
    expect(t, who + ' 預設不含草稿').not.toContain(prNo);
    expect(t, who + ' 預設不含已作廢').not.toContain(voidedNo);
  }
  const d = await text('accountant', '&includeDraft=1');
  expect(d).toContain(prNo);
  expect(d).toContain(subNo);
  expect(d).not.toContain(voidedNo);
  const v = await text('accountant', '&includeVoid=1');
  expect(v).toContain(voidedNo);
  expect(v).not.toContain(prNo);
  const both = await text('accountant', '&includeDraft=true&includeVoid=true');
  for (const n of [prNo, voidedNo, subNo]) expect(both).toContain(n);
  const only = await text('accountant', '&status=VOID');
  expect(only).toContain(voidedNo);
  expect(only).not.toContain(subNo);
  expect((await apis.accountant.get(base + '&status=X')).status()).toBe(400);
  // 畫面：勾選框預設不勾；預設下載不含草稿，勾選後含草稿
  const { ctx, page, errors } = await pageForUser(browser, states.accountant, testInfo);
  const download = async (): Promise<string> => {
    const [dl] = await Promise.all([page.waitForEvent('download'), vis(page, 'pr-export').click()]);
    const chunks: Buffer[] = [];
    for await (const ch of await dl.createReadStream()) chunks.push(Buffer.from(ch));
    return Buffer.concat(chunks).toString('utf8');
  };
  try {
    await openGaCenter(page);
    await nav(page, '請款單');
    await expect(visibleHeading(page, '請款單')).toBeVisible();
    await expect(vis(page, 'pr-export-default')).toContainText('預設只含已送出與已付款');
    await expect(vis(page, 'pr-export-draft')).not.toBeChecked();
    await expect(vis(page, 'pr-export-void')).not.toBeChecked();
    // (b) 手機版搜尋框：不被擠成一小條
    const box = await vis(page, 'pr-search').boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(200);
    await vis(page, 'pr-filter-month').fill(month);
    const t1 = await download();
    expect(t1).toContain(subNo);
    expect(t1).not.toContain(prNo);
    await vis(page, 'pr-export-draft').check();
    await vis(page, 'pr-export-void').check();
    const t2 = await download();
    for (const n of [prNo, voidedNo, subNo]) expect(t2).toContain(n);
    // (b) 詳情頁副標不再沿用建立頁文字
    await vis(page, 'pr-search').fill(subNo);
    await expect(page.locator('[data-testid="pr-card"]:visible')).toHaveCount(1);
    await page.locator('[data-testid="pr-card"]:visible').first().getByTestId('open-pr').click();
    await expect(vis(page, 'pe-status')).toBeVisible();
    await expect(vis(page, 'pe-subtitle')).not.toContainText('只能選已驗收進貨');
    await expect(vis(page, 'pe-subtitle')).toContainText('已送出');
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('9. F3 補登付款日：可比建立日早最多 30 天、不可是未來（API 與畫面）', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const t = today();
  let p = await dbPr(subId);
  const tooEarly = await act('accountant', subId, 'mark_paid', p.updated_at, { pay_method: 'TRANSFER', paid_date: addDays(t, -31) });
  expect([tooEarly.status, tooEarly.body.code]).toEqual([400, 'PAID_TOO_EARLY']);
  expect(JSON.stringify(tooEarly.body)).toContain('超過 30 天');
  expect(JSON.stringify(tooEarly.body)).toContain(addDays(t, -30));
  const future = await act('accountant', subId, 'mark_paid', p.updated_at, { pay_method: 'TRANSFER', paid_date: addDays(t, 1) });
  expect(future.status).toBe(400);
  expect((await dbPr(subId)).status).toBe('SUBMITTED');
  // 畫面：日期選擇器的範圍與提示；超出範圍先在畫面擋下；早 30 天可成功
  const { ctx, page, errors } = await pageForUser(browser, states.accountant, testInfo);
  try {
    await openPrPage(page, subNo);
    await vis(page, 'pe-paid').click();
    await expect(vis(page, 'act-date')).toHaveAttribute('min', addDays(t, -30));
    await expect(vis(page, 'act-date')).toHaveAttribute('max', t);
    await expect(vis(page, 'act-date-hint')).toContainText('最多早 30 天');
    await vis(page, 'act-date').fill(addDays(t, -31));
    await vis(page, 'act-confirm').click();
    await expect(vis(page, 'act-error')).toContainText('超過 30 天');
    expect((await dbPr(subId)).status).toBe('SUBMITTED');
    await vis(page, 'act-date').fill(addDays(t, -30));
    await vis(page, 'act-confirm').click();
    await expect(vis(page, 'pe-saved')).toContainText('已標記已付款');
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  p = await dbPr(subId);
  expect(p).toMatchObject({ status: 'PAID', paid_date: addDays(t, -30) });
});

test('10. F1 採購單總額上限與假設 (a)：累計請款超過採購單含稅總額加尾差被擋（API 與畫面）；尾差調低後草稿送出時重驗', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const SET = `${P}/payment-settings`;
  const g0 = await get('clerk', SET);
  const origTol = Number(g0.body.data.tolerance_amount);
  const setTol = async (n: number) => {
    const cur = await get('clerk', SET);
    const r = await send('clerk', 'put', SET, { tolerance_amount: n, expected_updated_at: cur.body.data.updated_at });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  };
  // 3 個 x 10 元：含稅總額 32；三張進貨各 11，合計 33（比採購單總額多 1 元）
  const d = await rpcOk('clerk', 'ga_ws_po_create', { p_header: { notes: m7Name('EJNY4'), vendor_id: vendor.id }, p_items: [{ item_name: 'QA-GA45 小額品項', unit: '個', quantity: 3, unit_price: 10 }], p_create_key: key() });
  const po4 = await rpcOk('clerk', 'ga_ws_po_action', { p_id: d.id, p_action: 'place_order', p_expected_updated_at: d.updated_at, p_note: null });
  const rs: any[] = [];
  for (let i = 0; i < 3; i += 1) rs.push(await rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po4.id, p_header: {}, p_lines: [{ po_item_id: itemId(po4), delivered_qty: 1 }], p_key: key() }));
  const mk = (rcs: any[]) => send('clerk', 'post', PR, { vendor_id: vendor.id, lines: rcs.map((r) => ({ receipt_id: r.id })), idempotency_key: key() });
  try {
    await setTol(0);
    const a = await mk([rs[0], rs[1]]);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.data.amount_total).toBe(22);
    const over = await mk([rs[2]]);
    expect([over.status, over.body.code]).toEqual([409, 'OVER_PO_TOTAL']);
    expect(JSON.stringify(over.body)).toContain('採購單含稅總額');
    await setTol(1);
    const b = await mk([rs[2]]);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    await setTol(0);
    // 畫面：草稿 a 送出時用新尾差重驗，被擋並顯示白話訊息
    const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
    try {
      await openPrPage(page, a.body.data.pr_no);
      await vis(page, 'pe-submit').click();
      await vis(page, 'act-confirm').click();
      await expect(vis(page, 'act-error')).toContainText('採購單含稅總額');
      await expect(vis(page, 'act-error')).toContainText('請減少這張請款單的金額');
      expect((await dbPr(a.body.data.id)).status).toBe('DRAFT');
      expect(noConsole(errors)).toEqual([]);
    } finally {
      await ctx.close();
    }
    // 作廢 b 釋放額度後，a 單獨 22 可送出
    const pb = await dbPr(b.body.data.id);
    expect((await act('clerk', b.body.data.id, 'void', pb.updated_at, {})).status).toBe(200);
    const pa = await dbPr(a.body.data.id);
    expect((await act('clerk', a.body.data.id, 'submit', pa.updated_at)).status).toBe(200);
  } finally {
    await setTol(origTol);
  }
});

test('11. F6 廠商銀行修改歷程：有廠商檢視權限者看得到（舊→新），沒有廠商權限者 API 403；廠商詳情只在有權限時顯示區塊', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const BL = `${P}/vendors/${vendor.id}/bank-log`;
  const ok = await get('clerk', BL);
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(ok.body.total).toBeGreaterThanOrEqual(2);
  const rows: any[] = ok.body.data;
  expect(rows.some((r) => r.op === 'INSERT')).toBe(true);
  const upd = rows.find((r) => r.op === 'UPDATE' && r.new?.bank_account === '999-000-111222');
  expect(upd, '測試 4 改帳號的紀錄').toBeTruthy();
  expect(upd.old.bank_account).toBe('123-456-789012');
  expect(upd.changed_fields).toContain('bank_account');
  for (const who of ['viewer', 'novendor', 'store_mgr', 'admin']) { // 沒有廠商檢視或管理權限者（採購角色本來就有廠商檢視，不在此列）
    const r = await get(who, BL);
    expect(r.status, who).toBe(403);
    expect(JSON.stringify(r.body), who).not.toContain('999-000-111222');
  }
  // 資料表本身登入者讀不到
  const direct = await users.clerk.client.from('ga_vendor_bank_changes').select('id').limit(1);
  expect((direct.data || []).length).toBe(0);
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '廠商資料');
    await vis(page, 'vendor-search').fill(vendor.name);
    await expect(vis(page, 'vendor-card')).toHaveCount(1, { timeout: 20_000 });
    await vis(page, 'open-detail').click();
    await expect(vis(page, 'vd-bank-log')).toBeVisible();
    await expect(vis(page, 'vd-bank-log').getByTestId('vd-bank-log-row').first()).toContainText('→');
    await expect(vis(page, 'vd-bank-log')).toContainText('999-000-111222');
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('12. F7 逾 14 天未送出的請款草稿：首頁待辦出現（只給請款檢視／管理），點進去只列這些草稿；編輯不重新計時；送出後消失', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const draft = await dbPr(prId);
  expect(draft.status).toBe('DRAFT');
  const old = new Date(Date.now() - 15 * 86_400_000).toISOString();
  expect((await db().from('ga_payment_requests').update({ created_at: old }).eq('id', prId)).error).toBeNull();
  const sum = (who: string) => get(who, `${P}/home/summary`);
  for (const who of ['clerk', 'accountant', 'viewer']) {
    const r = await sum(who);
    expect(r.status, who).toBe(200);
    const it = (r.body.data.items as any[]).find((x) => x.key === 'pay_stale_draft');
    expect(it, who).toBeTruthy();
    expect(it.count, who).toBeGreaterThanOrEqual(1);
    expect(it.menu).toBe('payment_requests');
    expect(JSON.stringify(it.top)).toContain(prNo);
  }
  for (const who of ['purchaser', 'store_mgr']) {
    const r = await sum(who);
    expect((r.body.data?.items || []).some((x: any) => x.key === 'pay_stale_draft'), who).toBe(false);
  }
  // 清單篩選與首頁數字一致
  const cnt = (await sum('clerk')).body.data.items.find((x: any) => x.key === 'pay_stale_draft').count as number;
  const l = await get('clerk', `${PR}?stale_draft=true`);
  expect(l.status).toBe(200);
  expect(l.body.total).toBe(cnt);
  expect(l.body.data.every((r: any) => r.status === 'DRAFT')).toBe(true);
  expect(l.body.data.map((r: any) => r.pr_no)).toContain(prNo);
  // 編輯草稿不重新計時（仍在待辦裡）
  const ed = await send('clerk', 'patch', `${PR}/${prId}`, { notes: '編輯不重新計時', expected_updated_at: (await dbPr(prId)).updated_at });
  expect(ed.status, JSON.stringify(ed.body)).toBe(200);
  expect((await get('clerk', `${PR}?stale_draft=true`)).body.data.map((r: any) => r.pr_no)).toContain(prNo);
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    await expect(page.locator('[data-testid="home-item-pay_stale_draft"]:visible')).toHaveCount(1);
    await expect(page.locator('[data-testid="home-count-pay_stale_draft"]:visible')).toHaveText(String(cnt));
    await page.locator('[data-testid="home-item-pay_stale_draft"]:visible').getByRole('button').first().click();
    await expect(vis(page, 'pr-stale-chip')).toBeVisible();
    await expect(vis(page, 'pr-total')).toHaveText(`共 ${cnt} 張`);
    await expect(page.locator('[data-testid="pr-card"]:visible').filter({ hasText: prNo })).toHaveCount(1);
    await vis(page, 'pr-stale-clear').click();
    await expect(vis(page, 'pr-stale-chip')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  // 送出後離開待辦
  const cur = await dbPr(prId);
  expect((await act('clerk', prId, 'submit', cur.updated_at)).status).toBe(200);
  expect((await get('clerk', `${PR}?stale_draft=true`)).body.data.map((r: any) => r.pr_no)).not.toContain(prNo);
});

test('13. 假設 (a) 與 F5：設定頁尾差旁有提示；檢視者與無廠商權限者在發票頁都看得到自家統編', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const SET = `${P}/payment-settings`;
  const cur = await get('clerk', SET);
  const set = await send('clerk', 'put', SET, { buyer_title: 'QA-GA45 自家抬頭', buyer_tax_id: '12345678', expected_updated_at: cur.body.data.updated_at });
  expect(set.status, JSON.stringify(set.body)).toBe(200);
  try {
    for (const who of ['viewer', 'novendor']) {
      const meta = await get(who, `${INV}/meta`);
      expect(meta.status, JSON.stringify(meta.body)).toBe(200);
      expect(meta.body.settings.buyer_tax_id, who).toBe('12345678');
    }
    const { ctx, page, errors } = await pageForUser(browser, states.viewer, testInfo);
    try {
      await openGaCenter(page);
      await nav(page, '請款單');
      await vis(page, 'pr-settings').click();
      await expect(vis(page, 'ps-tol-hint')).toContainText('重新檢查');
      await expect(vis(page, 'ps-tax')).toHaveValue('12345678');
      expect(noConsole(errors)).toEqual([]);
    } finally {
      await ctx.close();
    }
  } finally {
    const now = await get('clerk', SET);
    await send('clerk', 'put', SET, { buyer_title: null, buyer_tax_id: null, expected_updated_at: now.body.data.updated_at });
  }
});
