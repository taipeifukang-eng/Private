import crypto from 'node:crypto';
import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { TEST_ORIGIN } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name } from '../support/m7m8-fixtures';
import { taipeiToday } from '../support/m7m8-po-fixtures';
import { ga6Name } from '../support/m7m8-ga6-fixtures';
import { seedGa45Vendor, setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';
import { makePng } from '../support/png';
import { multipartBody } from '../support/multipart';

// 第 4.5 批 G45-att-inv（API 層）：進貨發票 /purchase-invoices/**、進貨憑證與請款摘要 /purchase-orders/:id/receipts/:rid/voucher、/payment-summary、
// 附件新資源類型 PURCHASE_INVOICE（G45-att，含水電帳單附件回歸）、廠商銀行欄位（伺服端遮蔽）。
// 每支寫入都驗：未登入 401、Origin 不符 403、權限矩陣（資料庫語意；profiles.role=admin 無角色被擋）、400 輸入驗證、409（STALE、重複號碼、發票使用中、最後一張圖鎖定）、固定識別冪等，
// 並用 service role 回讀資料庫。測試資料：廠商 QA-GA45- 標記、採購單 [自動測試]M7M8 標記、年份 2038、只用 DEV；結束只清自己的。
const P = '/api/workspace/general-affairs';
const INV = `${P}/purchase-invoices`;
const PO = `${P}/purchase-orders`;
const ATT = `${P}/attachments`;
const KEYS: Ga45Key[] = ['clerk', 'accountant', 'viewer', 'novendor', 'purchaser', 'payonly', 'vendor_mgr', 'vendor_view', 'util_mgr', 'nobody', 'admin'];
let users: Record<string, Ga45User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const apis: Record<string, APIRequestContext> = {};
let anon: APIRequestContext;
let seq = 0;
const db = () => adminDb();
const key = () => crypto.randomUUID();
const j = async (r: any) => ({ status: r.status(), body: await r.json().catch(() => ({})) });
const get = async (k: string, p: string) => j(await apis[k].get(p));
const send = async (k: string, method: 'post' | 'patch' | 'delete', p: string, data?: unknown) => j(await (apis[k] as any)[method](p, { data: data ?? {} }));
const today = () => {
  const d = taipeiToday();
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
};
const rpcOk = async (who: Ga45Key, name: string, args: Record<string, unknown>) => {
  const r: any = await callFn(users[who].client, name, args);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
};
let invSeq = 0;
const invNo = () => `QA${String(Date.now()).slice(-6)}${String((invSeq += 1)).padStart(3, '0')}`;

let vendor: any;
let po: any;
let receipt: any;
const itemId = (p: any, line: number) => p.items.find((i: any) => i.line_no === line).id as string;
const mk = (over: Record<string, unknown> = {}) => ({ invoice_type: 'TRIPLE', invoice_no: invNo(), invoice_date: today(), vendor_id: vendor.id, amount_untaxed: 1000, receipts: [{ receipt_id: receipt.id }], idempotency_key: key(), ...over });
async function createInv(who: string, over: Record<string, unknown> = {}) {
  const r = await send(who, 'post', INV, mk(over));
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data as any;
}
const dbInv = async (id: string) => (await db().from('ga_purchase_invoices').select('*').eq('id', id).single()).data as any;
async function upload(who: string, id: string, over: Record<string, string> = {}, type = 'image/png') {
  const mp = multipartBody([{ name: 'inv.png', mimeType: type, buffer: makePng({ width: 40, height: 40, colorful: true }) }], { resource_type: 'PURCHASE_INVOICE', resource_id: id, purpose: 'INVOICE_IMAGE', ...over });
  return j(await apis[who].post(ATT, { data: mp.data, headers: mp.headers }));
}

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
  anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN, extraHTTPHeaders: { Origin: TEST_ORIGIN } });
  vendor = await seedGa45Vendor(`API${(seq += 1)}`);
  const hdr = { notes: m7Name(`INV${(seq += 1)}`), vendor_id: vendor.id };
  const draft = await rpcOk('clerk', 'ga_ws_po_create', { p_header: hdr, p_items: [{ item_name: 'QA-GA45 品項一', unit: '個', quantity: 10, unit_price: 100 }], p_create_key: key() });
  po = await rpcOk('clerk', 'ga_ws_po_action', { p_id: draft.id, p_action: 'place_order', p_expected_updated_at: draft.updated_at, p_note: null });
  receipt = await rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [{ po_item_id: itemId(po, 1), delivered_qty: 10 }], p_key: key() });
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  await anon?.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號與臨時角色').toEqual([]);
  const v = await db().from('ga_vendors').select('id', { count: 'exact', head: true }).like('name', 'QA-GA45-%');
  expect(v.count, '測試廠商殘留').toBe(0);
});

test('未登入 401、Origin 不符 403、不支援的方法 405、不存在的路徑 404', async () => {
  const noAuth = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  try {
    expect((await noAuth.get(INV)).status()).toBe(401);
    expect((await noAuth.get(`${INV}/meta`)).status()).toBe(401);
    expect((await noAuth.post(INV, { data: {}, headers: { Origin: TEST_ORIGIN } })).status()).toBe(401);
  } finally {
    await noAuth.dispose();
  }
  const evil = await apis.clerk.post(INV, { data: mk(), headers: { Origin: 'https://evil.example' } });
  expect(evil.status()).toBe(403);
  const evilPatch = await apis.clerk.patch(`${INV}/${crypto.randomUUID()}`, { data: {}, headers: { Origin: 'https://evil.example' } });
  expect(evilPatch.status()).toBe(403);
  expect((await db().from('ga_purchase_invoices').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id)).count).toBe(0);
  expect((await send('clerk', 'delete', `${INV}/${crypto.randomUUID()}`)).status).toBe(405);
  expect((await get('clerk', `${INV}/not-a-uuid`)).status).toBe(400);
  expect((await send('clerk', 'post', `${INV}/${crypto.randomUUID()}/nothing`)).status).toBe(404);
  expect((await send('clerk', 'post', `${INV}/${crypto.randomUUID()}/actions`, { action: 'explode', reason: 'x', expected_updated_at: new Date().toISOString(), idempotency_key: key() })).status).toBe(400);
});

test('權限矩陣（資料庫語意）：總務採購、會計、檢視者、無廠商權限者可讀；採購角色、純請款檢視以外的角色、管理員身分無角色、無權限者 403', async () => {
  for (const who of ['clerk', 'accountant', 'viewer', 'novendor']) {
    for (const p of [INV, `${INV}/meta`]) expect((await get(who, p)).status, `${who} ${p}`).toBe(200);
  }
  for (const who of ['purchaser', 'nobody', 'admin', 'util_mgr', 'vendor_mgr', 'vendor_view']) {
    for (const p of [INV, `${INV}/meta`, `${INV}/receipt-options`]) expect((await get(who, p)).status, `${who} ${p}`).toBe(403);
  }
  const meta = await get('clerk', `${INV}/meta`);
  expect(meta.body.permissions).toMatchObject({ canView: true, canManage: true });
  expect(meta.body.settings.tolerance_amount).toBe(5);
  expect((await get('viewer', `${INV}/meta`)).body.permissions).toMatchObject({ canView: true, canManage: false, vendorVisible: false });
  expect((await get('accountant', `${INV}/meta`)).body.permissions).toMatchObject({ canManage: true, vendorVisible: true });
  // 寫入：只有請款管理（accountant、clerk、novendor）；檢視者與其他角色 403 且資料庫沒有新增
  for (const who of ['viewer', 'purchaser', 'nobody', 'admin']) expect((await send(who, 'post', INV, mk())).status, who).toBe(403);
  expect((await db().from('ga_purchase_invoices').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id)).count).toBe(0);
});

test('新增發票：201、資料庫回讀、缺圖警示；同識別重送回原結果（replay）不重複建立；不同內容同識別 409', async () => {
  const body = mk({ amount_untaxed: 1000, notes: '第一張' });
  const r = await send('clerk', 'post', INV, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const inv = r.body.data;
  expect(inv).toMatchObject({ invoice_type: 'TRIPLE', amount_untaxed: 1000, tax_amount: 50, amount_total: 1050, status: 'ACTIVE', missing_image: true, image_count: 0 });
  expect(r.body.warnings.map((w: any) => w.code)).toContain('MISSING_IMAGE');
  expect(inv.receipts).toHaveLength(1);
  const row = await dbInv(inv.id);
  expect(row).toMatchObject({ invoice_no: body.invoice_no, vendor_id: vendor.id, amount_total: 1050, created_by: users.clerk.id });
  const again = await send('clerk', 'post', INV, body);
  expect(again.status).toBe(200);
  expect(again.body.replay).toBe(true);
  expect(again.body.data.id).toBe(inv.id);
  expect((await db().from('ga_purchase_invoices').select('id', { count: 'exact', head: true }).eq('invoice_no', body.invoice_no)).count).toBe(1);
  const clash = await send('clerk', 'post', INV, { ...body, amount_untaxed: 2000 });
  expect(clash.status).toBe(409);
  expect(clash.body.code).toBe('IDEMPOTENCY_CONFLICT');
  // 憑證狀態已同步為「已連發票」
  const rc = (await db().from('ga_purchase_receipts').select('voucher_status').eq('id', receipt.id).single()).data as any;
  expect(rc.voucher_status).toBe('LINKED');
});

test('新增發票的 400 驗證：缺識別、類型錯、未來日期、金額格式、統編格式、不支援欄位、日期不存在，且都沒有寫入', async () => {
  const before = (await db().from('ga_purchase_invoices').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id)).count;
  const noKey = mk(); delete (noKey as any).idempotency_key;
  expect((await send('clerk', 'post', INV, noKey)).body.error).toContain('識別');
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ invoice_type: 'XXX' }, '發票類型'],
    [{ invoice_date: '2999-01-01' }, '未來'],
    [{ invoice_date: '2038-02-30' }, '格式'],
    [{ amount_untaxed: -5 }, '整數'],
    [{ amount_untaxed: '12.5' }, '整數'],
    [{ amount_untaxed: undefined }, '未稅金額'],
    [{ invoice_no: '' }, '發票號碼'],
    [{ seller_tax_id: '123' }, '8 碼'],
    [{ receipts: 'abc' }, '格式'],
    [{ receipts: [{ receipt_id: 'bad' }] }, '格式'],
    [{ notes: 'x'.repeat(501) }, '500'],
    [{ status: 'VOID' }, '不支援的欄位'],
    [{ id: crypto.randomUUID() }, '不支援的欄位'],
  ];
  for (const [over, part] of cases) {
    const r = await send('clerk', 'post', INV, mk(over));
    expect(r.status, JSON.stringify(over)).toBe(400);
    expect(r.body.error as string, JSON.stringify(over)).toContain(part);
    expect(r.body.error as string).not.toMatch(/SQLSTATE|violates|constraint|ERROR/);
  }
  const dup = await send('clerk', 'post', INV, mk({ receipts: [{ receipt_id: receipt.id }, { receipt_id: receipt.id }] }));
  expect(dup.status).toBe(400);
  expect((await db().from('ga_purchase_invoices').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id)).count).toBe(before);
});

test('同廠商同號碼 409（不分大小寫）；稅額可手改；金額差異超過尾差要原因、5 元內免；統編不符要原因', async () => {
  const no = invNo();
  const first = await createInv('clerk', { invoice_no: no, tax_amount: 55 }); // 稅額手改：未稅 1000、稅 55 ⇒ 含稅 1055（與進貨 1050 差 5，剛好在尾差內）
  expect(first.amount_total).toBe(1055);
  expect(first.diff_reason).toBeNull();
  const dup = await send('clerk', 'post', INV, mk({ invoice_no: no.toLowerCase() }));
  expect(dup.status).toBe(409);
  expect(dup.body.code).toBe('INVOICE_NO_DUPLICATE');
  // 6 元差異：要差異原因（400 DIFF_REASON_REQUIRED），填了就能存
  const need = await send('clerk', 'post', INV, mk({ tax_amount: 56 }));
  expect(need.status).toBe(400);
  expect(need.body.code).toBe('DIFF_REASON_REQUIRED');
  expect(need.body.error).toContain('尾差');
  const okDiff = await send('clerk', 'post', INV, mk({ tax_amount: 56, diff_reason: '廠商多收運費稅' }));
  expect(okDiff.status, JSON.stringify(okDiff.body)).toBe(201);
  expect(okDiff.body.data.diff_reason).toBe('廠商多收運費稅');
  expect(okDiff.body.warnings.map((w: any) => w.code)).toContain('AMOUNT_DIFF');
  // 賣方統編與採購單下訂時的廠商統編不同：要原因
  const wrongTax = vendor.tax_id === '12345678' ? '87654321' : '12345678';
  const mm = await send('clerk', 'post', INV, mk({ seller_tax_id: wrongTax }));
  expect(mm.status).toBe(400);
  expect(mm.body.code).toBe('TAX_MISMATCH_REASON_REQUIRED');
  const okMm = await send('clerk', 'post', INV, mk({ seller_tax_id: wrongTax, tax_mismatch_reason: '廠商換了公司統編', diff_reason: undefined }));
  expect(okMm.status, JSON.stringify(okMm.body)).toBe(201);
  expect(okMm.body.data.tax_mismatch_reason).toBe('廠商換了公司統編');
});

test('收據與免開發票：只填含稅金額、稅額 0；收據沒有圖片又沒原因視為缺圖，填原因後不缺；免開發票永遠不缺圖；稅額欄位無效', async () => {
  const rec = await createInv('clerk', { invoice_type: 'RECEIPT', invoice_no: undefined, amount_untaxed: undefined, amount_total: 1050 });
  expect(rec).toMatchObject({ invoice_type: 'RECEIPT', amount_untaxed: 1050, tax_amount: 0, amount_total: 1050, missing_image: true });
  const upd = await send('clerk', 'patch', `${INV}/${rec.id}`, { no_image_reason: '對方只開手寫收據不給影本', expected_updated_at: rec.updated_at });
  expect(upd.status, JSON.stringify(upd.body)).toBe(200);
  expect(upd.body.data.missing_image).toBe(false);
  const noi = await createInv('clerk', { invoice_type: 'NO_INVOICE', invoice_no: undefined, invoice_date: undefined, amount_untaxed: undefined, amount_total: 1050 });
  expect(noi).toMatchObject({ invoice_type: 'NO_INVOICE', invoice_no: null, missing_image: false, tax_amount: 0 });
  const both = await send('clerk', 'post', INV, mk({ invoice_type: 'RECEIPT', invoice_no: undefined, amount_untaxed: 400, amount_total: 500 }));
  expect(both.status).toBe(400);
});

test('賣方統編遮蔽：廠商檢視者看得到；請款檢視者（無廠商權限）、無廠商權限的管理者拿到 null 並標記遮蔽（詳情、清單、新增回應都一樣）', async () => {
  const inv = await createInv('accountant', { seller_tax_id: vendor.tax_id });
  const d = (who: string) => get(who, `${INV}/${inv.id}`);
  expect((await d('clerk')).body.data.seller_tax_id_snapshot).toBe(vendor.tax_id);
  expect((await d('accountant')).body.data.seller_tax_id_snapshot).toBe(vendor.tax_id);
  for (const who of ['viewer', 'novendor']) {
    const r = await d(who);
    expect(r.status).toBe(200);
    expect(r.body.data.seller_tax_id_snapshot, who).toBeNull();
    expect(r.body.data.seller_tax_masked, who).toBe(true);
    expect(r.body.data.amount_total).toBe(1050);
    expect(JSON.stringify(r.body), who).not.toContain(vendor.tax_id);
    const l = await get(who, `${INV}?pageSize=100`);
    expect(JSON.stringify(l.body), who).not.toContain(vendor.tax_id);
  }
  const created = await send('novendor', 'post', INV, mk({ seller_tax_id: vendor.tax_id }));
  expect(created.status).toBe(201);
  expect(JSON.stringify(created.body)).not.toContain(vendor.tax_id);
  expect((await db().from('ga_purchase_invoices').select('seller_tax_id_snapshot').eq('id', created.body.data.id).single()).data).toMatchObject({ seller_tax_id_snapshot: vendor.tax_id });
});

test('編輯發票：缺版本 400、版本不符 409 STALE、成功後版本更新；未帶的欄位維持原值；作廢後不可改', async () => {
  const inv = await createInv('clerk', { notes: '原備註' });
  expect((await send('clerk', 'patch', `${INV}/${inv.id}`, { notes: 'x' })).status).toBe(400);
  expect((await send('clerk', 'patch', `${INV}/${inv.id}`, { notes: 'x', expected_updated_at: 'abc' })).status).toBe(400);
  const stale = await send('clerk', 'patch', `${INV}/${inv.id}`, { notes: 'x', expected_updated_at: '2000-01-01T00:00:00Z' });
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('STALE');
  const ok = await send('clerk', 'patch', `${INV}/${inv.id}`, { notes: '新備註', expected_updated_at: inv.updated_at });
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(ok.body.data).toMatchObject({ notes: '新備註', amount_untaxed: 1000, invoice_no: inv.invoice_no });
  expect(ok.body.data.updated_at).not.toBe(inv.updated_at);
  const again = await send('clerk', 'patch', `${INV}/${inv.id}`, { notes: '舊版本再改', expected_updated_at: inv.updated_at });
  expect(again.status).toBe(409);
  expect((await send('viewer', 'patch', `${INV}/${inv.id}`, { notes: 'x', expected_updated_at: ok.body.data.updated_at })).status).toBe(403);
  expect((await dbInv(inv.id)).notes).toBe('新備註');
  expect((await send('clerk', 'patch', `${INV}/${crypto.randomUUID()}`, { notes: 'x', expected_updated_at: ok.body.data.updated_at })).status).toBe(404);
});

test('清單：{data,total}、pageSize 上限 100、篩選（缺圖、未請款、類型、狀態）、搜尋的 % 與 _ 當一般字元、格式錯誤 400', async () => {
  const big = await get('clerk', `${INV}?pageSize=9999&page=1`);
  expect(big.status).toBe(200);
  expect(Array.isArray(big.body.data)).toBe(true);
  expect(big.body.data.length).toBeLessThanOrEqual(100);
  expect(typeof big.body.total).toBe('number');
  expect(big.body.meta).toBeTruthy();
  const triple = await get('clerk', `${INV}?type=TRIPLE&vendorId=${vendor.id}&pageSize=100`);
  expect(triple.body.data.every((i: any) => i.invoice_type === 'TRIPLE' && i.vendor_id === vendor.id)).toBe(true);
  expect(triple.body.total).toBe(triple.body.data.length);
  const missing = await get('clerk', `${INV}?missingImage=1&vendorId=${vendor.id}&pageSize=100`);
  expect(missing.body.data.length).toBeGreaterThan(0);
  expect(missing.body.data.every((i: any) => i.missing_image === true && i.status === 'ACTIVE')).toBe(true);
  const noMatch = await get('clerk', `${INV}?q=%25&pageSize=100`);
  expect(noMatch.status).toBe(200);
  expect(noMatch.body.total).toBe(0);
  expect((await get('clerk', `${INV}?q=_`)).body.total).toBe(0);
  const byNo = await get('clerk', `${INV}?q=${encodeURIComponent('QA')}&vendorId=${vendor.id}&pageSize=100`);
  expect(byNo.body.total).toBeGreaterThan(0);
  for (const bad of ['status=NOPE', 'type=NOPE', 'vendorId=x', 'dateFrom=2038-02-30']) expect((await get('clerk', `${INV}?${bad}`)).status, bad).toBe(400);
  const page2 = await get('clerk', `${INV}?vendorId=${vendor.id}&pageSize=2&page=2`);
  expect(page2.status).toBe(200);
  expect(page2.body.data.length).toBeLessThanOrEqual(2);
});

test('可連結的進貨單（receipt-options）：需請款檢視與採購評估檢視；純請款檢視者（無採購評估檢視）403 並說明；分頁上限 100', async () => {
  const ok = await get('clerk', `${INV}/receipt-options?vendorId=${vendor.id}`);
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(ok.body.data.some((r: any) => r.receipt_id === receipt.id)).toBe(true);
  const row = ok.body.data.find((r: any) => r.receipt_id === receipt.id);
  expect(row).toMatchObject({ receipt_untaxed: 1000, receipt_total: 1050, po_no: po.po_no });
  const noPo = await get('payonly', `${INV}/receipt-options`);
  expect(noPo.status).toBe(403);
  expect(noPo.body.error).toContain('採購評估檢視');
  expect((await get('clerk', `${INV}/receipt-options?vendorId=bad`)).status).toBe(400);
  expect((await get('clerk', `${INV}/receipt-options?pageSize=500`)).body.data.length).toBeLessThanOrEqual(100);
});

test('進貨憑證：登錄免開發票需原因；改回尚未登錄；版本不符 409；已連發票的進貨不能手動改；進貨單不屬於這張採購單 404；檢視者 403', async () => {
  // 另開一張沒有連發票的進貨單
  const draft = await rpcOk('clerk', 'ga_ws_po_create', { p_header: { notes: m7Name(`VC${(seq += 1)}`), vendor_id: vendor.id }, p_items: [{ item_name: 'QA-GA45 憑證', unit: '個', quantity: 4, unit_price: 50 }], p_create_key: key() });
  const po2 = await rpcOk('clerk', 'ga_ws_po_action', { p_id: draft.id, p_action: 'place_order', p_expected_updated_at: draft.updated_at, p_note: null });
  const rc = await rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po2.id, p_header: {}, p_lines: [{ po_item_id: itemId(po2, 1), delivered_qty: 4 }], p_key: key() });
  const V = (poId: string, rid: string) => `${PO}/${poId}/receipts/${rid}/voucher`;
  const rcRow = async () => (await db().from('ga_purchase_receipts').select('voucher_status,voucher_note,updated_at').eq('id', rc.id).single()).data as any;
  const ver = (await rcRow()).updated_at;
  expect((await send('clerk', 'patch', V(po2.id, rc.id), { status: 'NO_INVOICE', expected_updated_at: ver })).status).toBe(400); // 沒原因
  expect((await send('clerk', 'patch', V(po2.id, rc.id), { status: 'LINKED', note: 'x', expected_updated_at: ver })).status).toBe(400);
  expect((await send('clerk', 'patch', V(po2.id, rc.id), { status: 'NO_INVOICE', note: 'x'.repeat(201), expected_updated_at: ver })).status).toBe(400);
  expect((await send('clerk', 'patch', V(po2.id, rc.id), { status: 'NO_INVOICE', note: '只有送貨單' })).status).toBe(400); // 缺版本
  expect((await send('viewer', 'patch', V(po2.id, rc.id), { status: 'NO_INVOICE', note: '只有送貨單', expected_updated_at: ver })).status).toBe(403);
  expect((await send('clerk', 'patch', V(po.id, rc.id), { status: 'NO_INVOICE', note: '只有送貨單', expected_updated_at: ver })).status).toBe(404);
  const ok = await send('clerk', 'patch', V(po2.id, rc.id), { status: 'NO_INVOICE', note: '只有送貨單', expected_updated_at: ver });
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(await rcRow()).toMatchObject({ voucher_status: 'NO_INVOICE', voucher_note: '只有送貨單' });
  const stale = await send('clerk', 'patch', V(po2.id, rc.id), { status: 'NONE', expected_updated_at: ver });
  expect(stale.status).toBe(409);
  const back = await send('clerk', 'patch', V(po2.id, rc.id), { status: 'NONE', expected_updated_at: ok.body.data.updated_at });
  expect(back.status).toBe(200);
  expect((await rcRow()).voucher_status).toBe('NONE');
  // 已連發票的進貨：憑證由發票決定
  const rcLinked = (await db().from('ga_purchase_receipts').select('updated_at,voucher_status').eq('id', receipt.id).single()).data as any;
  expect(rcLinked.voucher_status).toBe('LINKED');
  const blocked = await send('clerk', 'patch', V(po.id, receipt.id), { status: 'NO_INVOICE', note: '改成免開發票', expected_updated_at: rcLinked.updated_at });
  expect(blocked.status).toBe(409);
  expect(blocked.body.code).toBe('VOUCHER_LINKED');
});

test('採購單發票與請款摘要：請款檢視者可看（金額）；無採購評估檢視 403；採購角色與無權限 403；摘要含進貨憑證與發票', async () => {
  const s = await get('viewer', `${PO}/${po.id}/payment-summary`);
  expect(s.status, JSON.stringify(s.body)).toBe(200);
  expect(s.body.data).toMatchObject({ received_total: 1050, claimed_total: 0, paid_total: 0, tolerance: 5 });
  expect(s.body.data.receipts.find((r: any) => r.receipt_id === receipt.id).invoices.length).toBeGreaterThan(0);
  expect(s.body.permissions.canManage).toBe(false);
  expect((await get('clerk', `${PO}/${po.id}/payment-summary`)).body.data.can_manage).toBe(true);
  expect((await get('payonly', `${PO}/${po.id}/payment-summary`)).status).toBe(403);
  for (const who of ['purchaser', 'nobody', 'admin']) expect((await get(who, `${PO}/${po.id}/payment-summary`)).status, who).toBe(403);
  expect((await get('clerk', `${PO}/not-a-uuid/payment-summary`)).status).toBe(400);
  expect((await get('clerk', `${PO}/${crypto.randomUUID()}/payment-summary`)).status).toBe(404);
});

test('G45-att 附件：請款管理者可傳發票圖、請款檢視者只能看；採購角色與無權限 403；用途固定；資源不存在 404；傳圖後不再缺圖；刪除只標記', async () => {
  const inv = await createInv('clerk');
  expect(inv.missing_image).toBe(true);
  const q = `${ATT}?resourceType=PURCHASE_INVOICE&resourceId=${inv.id}&purpose=INVOICE_IMAGE`;
  // 寫入
  expect((await upload('viewer', inv.id)).status).toBe(403);
  expect((await upload('purchaser', inv.id)).status).toBe(403);
  expect((await upload('admin', inv.id)).status).toBe(403);
  expect((await upload('clerk', inv.id, { purpose: 'GENERAL' })).status).toBe(400);
  expect((await upload('clerk', crypto.randomUUID())).status).toBe(404);
  expect((await upload('clerk', inv.id, {}, 'text/plain')).status).toBe(400);
  const up = await upload('clerk', inv.id);
  expect(up.status, JSON.stringify(up.body)).toBe(201);
  expect(up.body.data).toHaveLength(1);
  const att = up.body.data[0];
  expect(att).toMatchObject({ resource_type: 'PURCHASE_INVOICE', resource_id: inv.id, purpose: 'INVOICE_IMAGE' });
  expect((await get('clerk', `${INV}/${inv.id}`)).body.data).toMatchObject({ image_count: 1, missing_image: false });
  // 讀取
  for (const who of ['clerk', 'viewer', 'accountant']) expect((await get(who, q)).status, who).toBe(200);
  for (const who of ['purchaser', 'nobody', 'admin', 'util_mgr']) expect((await get(who, q)).status, who).toBe(403);
  const list = await get('viewer', q);
  expect(list.body.data).toHaveLength(1);
  expect(list.body.data[0].signed_url).toBeTruthy();
  expect((await get('viewer', `${ATT}/${att.id}/url`)).status).toBe(200);
  expect((await get('purchaser', `${ATT}/${att.id}/url`)).status).toBe(403);
  // 刪除：檢視者 403、缺原因 400、標記後實體檔保留；發票缺圖狀態回來
  expect((await send('viewer', 'delete', `${ATT}/${att.id}`, { deletion_reason: '想刪' })).status).toBe(403);
  expect((await send('clerk', 'delete', `${ATT}/${att.id}`, {})).status).toBe(400);
  expect((await send('clerk', 'delete', `${ATT}/${att.id}`, { deletion_reason: '傳錯張' })).status).toBe(200);
  const after = (await db().from('ga_resource_attachments').select('deleted_at,deletion_reason,storage_path').eq('id', att.id).single()).data as any;
  expect(after.deleted_at).toBeTruthy();
  expect((await db().storage.from('general-affairs-attachments').download(after.storage_path)).error).toBeNull();
  expect((await get('clerk', `${INV}/${inv.id}`)).body.data).toMatchObject({ image_count: 0, missing_image: true });
});

test('已被請款單引用的發票：最後一張圖不可刪（409 白話）、多一張後可刪舊的；不能改金額與作廢（INVOICE_IN_USE）；請款單作廢後可作廢發票；作廢重送冪等', async () => {
  // 全新的進貨單，避免與前面測試的累計請款互相影響
  const draft = await rpcOk('clerk', 'ga_ws_po_create', { p_header: { notes: m7Name(`LK${(seq += 1)}`), vendor_id: vendor.id }, p_items: [{ item_name: 'QA-GA45 鎖定', unit: '個', quantity: 10, unit_price: 100 }], p_create_key: key() });
  const po3 = await rpcOk('clerk', 'ga_ws_po_action', { p_id: draft.id, p_action: 'place_order', p_expected_updated_at: draft.updated_at, p_note: null });
  const rc = await rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po3.id, p_header: {}, p_lines: [{ po_item_id: itemId(po3, 1), delivered_qty: 10 }], p_key: key() });
  const inv = await createInv('clerk', { receipts: [{ receipt_id: rc.id }] });
  const a1 = (await upload('clerk', inv.id)).body.data[0];
  const pr = await rpcOk('clerk', 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines: [{ receipt_id: rc.id, invoice_id: inv.id }] }, p_key: key() });
  const del = await send('clerk', 'delete', `${ATT}/${a1.id}`, { deletion_reason: '想刪' });
  expect(del.status).toBe(409);
  expect(del.body.code).toBe('INVOICE_LAST_IMAGE_LOCKED');
  expect(del.body.error).toContain('最後一張');
  expect((await db().from('ga_resource_attachments').select('deleted_at').eq('id', a1.id).single()).data).toMatchObject({ deleted_at: null });
  const a2 = (await upload('clerk', inv.id)).body.data[0];
  expect((await send('clerk', 'delete', `${ATT}/${a1.id}`, { deletion_reason: '換更清楚的圖' })).status).toBe(200);
  expect((await send('clerk', 'delete', `${ATT}/${a2.id}`, { deletion_reason: '再刪就沒圖了' })).status).toBe(409);
  // 使用中的發票：改金額 409 INVOICE_IN_USE；只改備註可以；作廢被擋
  const cur = (await get('clerk', `${INV}/${inv.id}`)).body.data;
  expect(cur.referenced_by.map((r: any) => r.pr_no)).toContain(pr.pr_no);
  const chg = await send('clerk', 'patch', `${INV}/${inv.id}`, { amount_untaxed: 900, expected_updated_at: cur.updated_at });
  expect(chg.status).toBe(409);
  expect(chg.body.code).toBe('INVOICE_IN_USE');
  const note = await send('clerk', 'patch', `${INV}/${inv.id}`, { notes: '請款中只改備註', expected_updated_at: cur.updated_at });
  expect(note.status, JSON.stringify(note.body)).toBe(200);
  const vk = key();
  const blocked = await send('clerk', 'post', `${INV}/${inv.id}/actions`, { action: 'void', reason: '想作廢', expected_updated_at: note.body.data.updated_at, idempotency_key: vk });
  expect(blocked.status).toBe(409);
  expect(blocked.body.code).toBe('INVOICE_IN_USE');
  // 作廢請款單，釋放發票
  await rpcOk('clerk', 'ga_ws_pay_request_action', { p_id: pr.id, p_action: 'void', p_payload: { reason: '改請款方式' }, p_key: key(), p_expected_updated_at: pr.updated_at });
  const free = (await get('clerk', `${INV}/${inv.id}`)).body.data;
  expect(free.referenced_by).toEqual([]);
  // 作廢：缺原因 400、缺版本 400、缺識別 400、版本不符 409、成功、同識別同原因重送回原結果、別人不能（檢視者 403）
  expect((await send('clerk', 'post', `${INV}/${inv.id}/actions`, { action: 'void', reason: '', expected_updated_at: free.updated_at, idempotency_key: vk })).status).toBe(400);
  expect((await send('clerk', 'post', `${INV}/${inv.id}/actions`, { action: 'void', reason: '作廢', idempotency_key: vk })).status).toBe(400);
  expect((await send('clerk', 'post', `${INV}/${inv.id}/actions`, { action: 'void', reason: '作廢', expected_updated_at: free.updated_at })).status).toBe(400);
  expect((await send('clerk', 'post', `${INV}/${inv.id}/actions`, { action: 'void', reason: '作廢', expected_updated_at: '2000-01-01T00:00:00Z', idempotency_key: vk })).status).toBe(409);
  expect((await send('viewer', 'post', `${INV}/${inv.id}/actions`, { action: 'void', reason: '作廢', expected_updated_at: free.updated_at, idempotency_key: vk })).status).toBe(403);
  const v1 = await send('clerk', 'post', `${INV}/${inv.id}/actions`, { action: 'void', reason: '開錯了', expected_updated_at: free.updated_at, idempotency_key: vk });
  expect(v1.status, JSON.stringify(v1.body)).toBe(200);
  expect(v1.body.data).toMatchObject({ status: 'VOID', void_reason: '開錯了' });
  const v2 = await send('clerk', 'post', `${INV}/${inv.id}/actions`, { action: 'void', reason: '開錯了', expected_updated_at: free.updated_at, idempotency_key: vk });
  expect(v2.status).toBe(200);
  expect(v2.body.replay).toBe(true);
  expect(await dbInv(inv.id)).toMatchObject({ status: 'VOID', voided_by: users.clerk.id });
  // 作廢後：不能改、不能再傳圖、號碼可重用
  expect((await send('clerk', 'patch', `${INV}/${inv.id}`, { notes: 'x', expected_updated_at: v1.body.data.updated_at })).status).toBe(409);
  expect((await upload('clerk', inv.id)).status).toBe(403);
  const reuse = await send('clerk', 'post', INV, mk({ invoice_no: inv.invoice_no, receipts: [{ receipt_id: rc.id }] }));
  expect(reuse.status, JSON.stringify(reuse.body)).toBe(201);
  expect((await get('clerk', `${INV}?status=VOID&vendorId=${vendor.id}&pageSize=100`)).body.data.some((i: any) => i.id === inv.id)).toBe(true);
});

test('G45-att 回歸：水電帳單附件規則不受影響（水電管理者可傳、請款管理者 403）；新資源類型之外的類型仍可用；不存在的類型 400', async () => {
  const st = (await db().from('stores').select('id').eq('store_code', 'VW001').single()).data as any;
  const bill = await callFn(users.util_mgr.client, 'ga_ws_ub_save', { p_id: null, p_payload: { store_id: st.id, expense_type: 'WATER', billing_month: '2038-02', provider_name: ga6Name('GA45ATT'), service_identifier: `QA45A-${Date.now()}`, amount: 1 }, p_expected_updated_at: null, p_confirm_paid_change: false } as any);
  expect((bill as any).ok, JSON.stringify(bill)).toBe(true);
  const billId = (bill as any).data.id as string;
  const mk2 = () => multipartBody([{ name: 'bill.png', mimeType: 'image/png', buffer: makePng({ width: 40, height: 40, colorful: true }) }], { resource_type: 'UTILITY_BILL', resource_id: billId, purpose: 'BILL_DOCUMENT' });
  const bad = mk2();
  expect((await apis.clerk.post(ATT, { data: bad.data, headers: bad.headers })).status()).toBe(403);
  const good = mk2();
  const up = await apis.util_mgr.post(ATT, { data: good.data, headers: good.headers });
  expect(up.status(), await up.text()).toBeLessThan(300);
  const q = `${ATT}?resourceType=UTILITY_BILL&resourceId=${billId}&purpose=BILL_DOCUMENT`;
  expect((await get('util_mgr', q)).body.data).toHaveLength(1);
  expect((await get('clerk', q)).status).toBe(403);
  const unk = multipartBody([{ name: 'x.png', mimeType: 'image/png', buffer: makePng({ width: 10, height: 10, colorful: true }) }], { resource_type: 'PURCHASE_ORDER', resource_id: billId, purpose: 'GENERAL' });
  expect((await apis.clerk.post(ATT, { data: unk.data, headers: unk.headers })).status()).toBe(400);
  expect((await get('clerk', `${ATT}?resourceType=PURCHASE_ORDER&resourceId=${billId}`)).status).toBe(400);
});

test('廠商銀行欄位（P8）：廠商管理者可寫入、廠商檢視者可讀、列表不含銀行欄位、請款檢視者（無廠商權限）整欄不存在、長度與格式驗證', async () => {
  const V = `${P}/vendors`;
  const v = await seedGa45Vendor(`BK${(seq += 1)}`, { bank_name: null, bank_branch: null, bank_account: null, bank_account_name: null });
  const detail = await get('vendor_mgr', `${V}/${v.id}`);
  expect(detail.status, JSON.stringify(detail.body)).toBe(200);
  const upd = await send('vendor_mgr', 'patch', `${V}/${v.id}`, { bank_name: '測試商業銀行', bank_branch: '信義分行', bank_account: '012-345-678901', bank_account_name: v.name, expected_updated_at: detail.body.data.updated_at });
  expect(upd.status, JSON.stringify(upd.body)).toBe(200);
  expect(upd.body.data).toMatchObject({ bank_name: '測試商業銀行', bank_branch: '信義分行', bank_account: '012-345-678901', bank_account_name: v.name });
  expect(await (async () => (await db().from('ga_vendors').select('bank_name,bank_account').eq('id', v.id).single()).data)()).toMatchObject({ bank_name: '測試商業銀行', bank_account: '012-345-678901' });
  const asView = await get('vendor_view', `${V}/${v.id}`);
  expect(asView.status).toBe(200);
  expect(asView.body.data).toMatchObject({ bank_name: '測試商業銀行', bank_account: '012-345-678901' });
  const row = (await get('vendor_view', `${V}?search=${encodeURIComponent(v.name)}&pageSize=100`)).body.data.find((r: any) => r.id === v.id);
  expect(row).toBeTruthy();
  for (const f of ['bank_name', 'bank_branch', 'bank_account', 'bank_account_name']) expect(Object.prototype.hasOwnProperty.call(row, f), f).toBe(false);
  // 沒有廠商權限者讀不到廠商資料（403），自然也看不到銀行欄位
  for (const who of ['viewer', 'novendor', 'payonly', 'nobody', 'admin']) {
    const r = await get(who, `${V}/${v.id}`);
    expect(r.status, who).toBe(403);
    expect(JSON.stringify(r.body), who).not.toContain('012-345-678901');
  }
  const toolong = await send('vendor_mgr', 'patch', `${V}/${v.id}`, { bank_account: 'x'.repeat(41), expected_updated_at: upd.body.data.updated_at });
  expect(toolong.status).toBe(400);
  expect(toolong.body.error).not.toMatch(/SQLSTATE|violates|constraint/);
  // 只有檢視權限者不能寫
  expect((await send('vendor_view', 'patch', `${V}/${v.id}`, { bank_name: '駭客銀行', expected_updated_at: upd.body.data.updated_at })).status).toBe(403);
  expect((await db().from('ga_vendors').select('bank_name').eq('id', v.id).single()).data).toMatchObject({ bank_name: '測試商業銀行' });
});
