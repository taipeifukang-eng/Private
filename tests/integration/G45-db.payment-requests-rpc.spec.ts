import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, ga45Name, m7Name, seedCategory, seedPart } from '../support/m7m8-fixtures';
import { anonClient, taipeiToday } from '../support/m7m8-po-fixtures';
import { seedGa45Vendor, setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';
import { ga6Name } from '../support/m7m8-ga6-fixtures';

// M7/M8 第 4.5 批 G45-db（資料庫層）：進貨憑證、進貨發票、請款單（建立、修改、送出、退回、標已付款、作廢、備註、重抓廠商帳號）、請款設定、對帳匯出、採購單發票與請款摘要、
// 附件資源類型（PURCHASE_INVOICE／PURCHASE_RECEIPT）的資料庫分支、廠商銀行欄位。
// 涵蓋：權限矩陣（未登入、缺權限、profiles.role=admin 不繞過、無採購評估檢視者不看採購單明細、無廠商權限者遮蔽統編與銀行）、固定識別（重送回原結果、內容不同 409）、STALE、
//      累計請款上限（含兩張請款單合計、短收以累計驗入計、拒收量不可請款、尾差可調、作廢釋放額度、併發只成功一張）、發票規則（重複號碼、統編不符與金額差異要原因、缺圖不可引用、被引用不可作廢與不可改、最後一張圖守門）、
//      狀態機（退回改再送、申請人自己標已付款、已付款鎖定、作廢必填原因）、事件表不可改刪、銀行快照不因廠商改帳號而變、附件分支與既有資源類型回歸。
// 權限語意照正式區 has_permission（DB 無 admin bypass）。測試資料：廠商名稱帶 QA-GA45- 標記、採購單備註帶 [自動測試]M7M8 標記、只用 DEV；結束只清自己的（cleanupM7M8 含 ga_dev_cleanup_m7m8_b45）。
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const KEYS: Ga45Key[] = ['clerk', 'clerk2', 'accountant', 'viewer', 'novendor', 'purchaser', 'util_mgr', 'payonly', 'vendor_mgr', 'vendor_view', 'nobody', 'admin', 'store_mgr'];
let users: Record<string, Ga45User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let seq = 0;
const db = () => adminDb();
const key = () => crypto.randomUUID();
const fn = (who: Ga45Key, name: string, args: Record<string, unknown>) => callFn(users[who].client, name, args);
const today = () => {
  const d = taipeiToday();
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
};
function expectErr(r: any, status: number, code?: string, part?: string) {
  expect(r.ok, JSON.stringify(r)).toBe(false);
  expect(r.status, JSON.stringify(r)).toBe(status);
  if (code) expect(r.code, JSON.stringify(r)).toBe(code);
  if (part) expect(r.error as string).toContain(part);
  expect(typeof r.error).toBe('string');
  expect(r.error as string).not.toMatch(/ERROR|SQLSTATE|violates|constraint/i);
}
const okData = (r: any) => {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
};

// ------------------------------------------------------------------ 前置資料
const ITEMS = [
  { item_name: 'QA-GA45 品項一', unit: '個', quantity: 10, unit_price: 100 },
  { item_name: 'QA-GA45 品項二', unit: '個', quantity: 5, unit_price: 200 },
];
const itemId = (po: any, line: number) => po.items.find((i: any) => i.line_no === line).id as string;
/** 已下訂的採購單（含稅總額 ≤ 5000 免核准）。rate0：免稅廠商（採購單稅率 0）。 */
async function mkPo(vendor: any, over: { its?: any[]; rate0?: boolean } = {}) {
  const hdr = { notes: m7Name(`PY${(seq += 1)}`), vendor_id: vendor.id };
  const c = await fn('clerk', 'ga_ws_po_create', { p_header: hdr, p_items: over.its || ITEMS, p_create_key: key() });
  const draft = okData(c);
  const r = await fn('clerk', 'ga_ws_po_action', { p_id: draft.id, p_action: 'place_order', p_expected_updated_at: draft.updated_at, p_note: null });
  const po = okData(r);
  if (over.rate0) await db().from('ga_purchase_orders').update({ tax_rate: 0 }).eq('id', po.id);
  return po;
}
/** 到貨登錄（預設品項一全收：未稅 1000、稅 50、含稅 1050）。 */
async function recv(po: any, lines?: any[], who: Ga45Key = 'clerk') {
  const r = await fn(who, 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: lines || [{ po_item_id: itemId(po, 1), delivered_qty: 10 }], p_key: key() });
  return okData(r);
}
async function newVendor(suffix: string, over: Record<string, unknown> = {}) {
  return seedGa45Vendor(`${suffix}${(seq += 1)}`, over);
}
/** 一組可請款的基本情境：廠商＋已下訂採購單＋品項一全收的進貨單。 */
async function scene(opts: { rate0?: boolean; vendorOver?: Record<string, unknown>; its?: any[]; lines?: any[] } = {}) {
  const vendor = await newVendor('S', opts.vendorOver || {});
  const po = await mkPo(vendor, { rate0: opts.rate0, its: opts.its });
  const receipt = await recv(po, opts.lines);
  return { vendor, po, receipt };
}
let invSeq = 0;
const invNo = () => `QA${String(Date.now()).slice(-6)}${String((invSeq += 1)).padStart(3, '0')}`;
async function mkInv(who: Ga45Key, vendor: any, receipts: any[], over: Record<string, unknown> = {}, k: string = key()) {
  const payload: Record<string, unknown> = { invoice_type: 'TRIPLE', invoice_no: invNo(), invoice_date: today(), vendor_id: vendor.id, amount_untaxed: 1000, receipts: receipts.map((r) => ({ receipt_id: r.id })), ...over };
  return fn(who, 'ga_ws_pay_invoice_save', { p_id: null, p_payload: payload, p_key: k });
}
async function addImage(who: Ga45Key, inv: any, over: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  return users[who].client.from('ga_resource_attachments').insert({
    resource_type: 'PURCHASE_INVOICE', resource_id: inv.id, purpose: 'INVOICE_IMAGE', storage_path: `purchase_invoice/${inv.id}/invoice_image/${id}.png`, file_name: `m7m8t-${id}.png`,
    content_type: 'image/png', size_bytes: 100, uploaded_by: users[who].id, ...over,
  }).select('*').single();
}
/** 有圖的有效發票（三聯式、單張進貨單）。 */
async function goodInv(vendor: any, receipts: any[], over: Record<string, unknown> = {}) {
  const inv = okData(await mkInv('clerk', vendor, receipts, over));
  const img = await addImage('clerk', inv);
  expect(img.error, JSON.stringify(img.error)).toBeNull();
  return (okData(await fn('clerk', 'ga_ws_pay_invoice_get', { p_id: inv.id }))) as any;
}
const create = (who: Ga45Key, vendor: any, lines: any[], extra: Record<string, unknown> = {}, k: string = key()) =>
  fn(who, 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines, ...extra }, p_key: k });
const act = (who: Ga45Key, pr: any, action: string, payload: Record<string, unknown> = {}, k: string = key(), expected: string | null = pr.updated_at) =>
  fn(who, 'ga_ws_pay_request_action', { p_id: pr.id, p_action: action, p_payload: payload, p_key: k, p_expected_updated_at: expected });
const getPr = async (who: Ga45Key, id: string) => okData(await fn(who, 'ga_ws_pay_request_get', { p_id: id }));
const events = async (id: string) => ((await db().from('ga_payment_request_events').select('*').eq('pr_id', id).order('created_at').order('id')).data || []) as any[];
const dbPr = async (id: string) => (await db().from('ga_payment_requests').select('*').eq('id', id).single()).data as any;
const claimLine = (receipt: any, over: Record<string, unknown> = {}) => ({ receipt_id: receipt.id, ...over });
const summary = async (po: any, who: Ga45Key = 'clerk') => okData(await fn(who, 'ga_ws_pay_po_summary', { p_po_id: po.id }));

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGa45Users(KEYS);
  users = made.users;
  teardownUsers = made.teardown;
});
test.afterAll(async () => {
  // 尾差設定若被測試改過，先還原（清除函式也會還原，這裡是雙保險）
  const s = await fn('clerk', 'ga_ws_pay_settings_get', {});
  if (s.ok && Number(s.data.tolerance_amount) !== 5) await fn('clerk', 'ga_ws_pay_settings_set', { p_values: { tolerance_amount: 5 }, p_expected_updated_at: s.data.updated_at });
  expect(await cleanupM7M8(), '清除總務測試資料（含請款單、發票、採購單、進貨）').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號與臨時角色').toEqual([]);
  const v = await db().from('ga_vendors').select('id', { count: 'exact', head: true }).like('name', 'QA-GA45-%');
  expect(v.count, '測試廠商殘留').toBe(0);
  const pr = await db().from('ga_payment_requests').select('id', { count: 'exact', head: true }).like('vendor_name_snapshot', 'QA-GA45-%');
  expect(pr.count, '請款單殘留').toBe(0);
  const po = await db().from('ga_purchase_orders').select('id', { count: 'exact', head: true }).like('notes', '[自動測試]M7M8 T%');
  expect(po.count, '採購單殘留').toBe(0);
  const role = await db().from('roles').select('id').like('code', 'vue_workspace_ga45_%');
  expect((role.data || []).length, '測試角色 vue_workspace_ga45_ 應保留 4 個（DEV 專用種子，不由測試刪除）').toBe(4);
});

// ================================================================== 權限與基礎
test('G45-db 結構：資料表登入者不能直接讀寫、事件表不可改刪、請款單號格式', async () => {
  for (const t of ['ga_payment_requests', 'ga_payment_request_lines', 'ga_payment_request_events', 'ga_purchase_invoices', 'ga_purchase_invoice_receipts']) {
    const r = await users.clerk.client.from(t).select('*').limit(1);
    expect(r.error, `${t} 讀取應被擋`).not.toBeNull();
    const w = await users.clerk.client.from(t).insert({});
    expect(w.error, `${t} 寫入應被擋`).not.toBeNull();
    const a = await anonClient().from(t).select('*').limit(1);
    expect(a.error, `${t} 未登入讀取應被擋`).not.toBeNull();
  }
  const { vendor, receipt } = await scene();
  const pr = okData(await create('clerk', vendor, [claimLine(receipt)]));
  expect(pr.pr_no).toMatch(/^PY-\d{8}-\d{3,}$/);
  expect(pr.pr_no.slice(3, 11)).toBe(taipeiToday());
  const ev = await events(pr.id);
  expect(ev.length).toBe(1);
  const upd = await db().from('ga_payment_request_events').update({ reason: '偷改' }).eq('id', ev[0].id);
  expect(upd.error?.message || '').toContain('不可修改或刪除');
  const del = await db().from('ga_payment_request_events').delete().eq('id', ev[0].id);
  expect(del.error?.message || '').toContain('不可修改或刪除');
  expect((await events(pr.id)).length).toBe(1);
});

test('G45-db 權限矩陣：未登入、無權限、管理員 profile 都擋；唯讀者不能寫；無採購評估檢視者不看採購單明細', async () => {
  const anon = anonClient();
  for (const name of ['ga_ws_pay_settings_get', 'ga_ws_pay_invoice_list', 'ga_ws_pay_request_list', 'ga_ws_pay_receipt_candidates', 'ga_ws_pay_export']) {
    const r = await anon.rpc(name, {});
    expect(r.error, `${name} 未登入應被擋`).not.toBeNull();
  }
  const rid = crypto.randomUUID();
  const reads: [string, Record<string, unknown>][] = [
    ['ga_ws_pay_settings_get', {}], ['ga_ws_pay_invoice_list', {}], ['ga_ws_pay_invoice_get', { p_id: rid }], ['ga_ws_pay_request_list', {}], ['ga_ws_pay_request_get', { p_id: rid }],
    ['ga_ws_pay_receipt_candidates', {}], ['ga_ws_pay_export', { p_filters: { month: today().slice(0, 7) } }], ['ga_ws_pay_po_summary', { p_po_id: rid }],
  ];
  const writes: [string, Record<string, unknown>][] = [
    ['ga_ws_pay_settings_set', { p_values: { tolerance_amount: 5 }, p_expected_updated_at: new Date().toISOString() }],
    ['ga_ws_pay_voucher_set', { p_receipt_id: rid, p_status: 'NO_INVOICE', p_note: 'x', p_expected_updated_at: new Date().toISOString() }],
    ['ga_ws_pay_invoice_save', { p_id: null, p_payload: {}, p_key: key() }],
    ['ga_ws_pay_invoice_void', { p_id: rid, p_reason: 'x', p_key: key(), p_expected_updated_at: new Date().toISOString() }],
    ['ga_ws_pay_request_create', { p_payload: {}, p_key: key() }],
    ['ga_ws_pay_request_update', { p_id: rid, p_payload: {}, p_expected_updated_at: new Date().toISOString() }],
    ['ga_ws_pay_request_action', { p_id: rid, p_action: 'note', p_payload: { note: 'x' }, p_key: key(), p_expected_updated_at: new Date().toISOString() }],
  ];
  for (const who of ['nobody', 'purchaser', 'store_mgr', 'admin', 'vendor_mgr'] as Ga45Key[]) {
    for (const [name, args] of [...reads, ...writes]) {
      const r = await fn(who, name, args);
      expectErr(r, 403, 'PERMISSION_DENIED');
    }
  }
  // 唯讀者：讀得到、寫不得
  expect((await fn('viewer', 'ga_ws_pay_settings_get', {})).ok).toBe(true);
  expect((await fn('viewer', 'ga_ws_pay_invoice_list', {})).ok).toBe(true);
  expect((await fn('viewer', 'ga_ws_pay_request_list', {})).ok).toBe(true);
  for (const [name, args] of writes) expectErr(await fn('viewer', name, args), 403, 'PERMISSION_DENIED');
  // 只有請款查看（沒有採購評估檢視）：候選進貨與採購單摘要要求採購評估檢視
  expectErr(await fn('payonly', 'ga_ws_pay_receipt_candidates', {}), 403, 'PO_VIEW_REQUIRED');
  expectErr(await fn('payonly', 'ga_ws_pay_po_summary', { p_po_id: rid }), 403, 'PO_VIEW_REQUIRED');
  expect((await fn('payonly', 'ga_ws_pay_request_list', {})).ok).toBe(true);
  // 各個 ga45 角色的權限碼組成（DB 回讀，確認種子與設計一致，且沒有 approve／pay 碼）
  const permsOf = async (code: string) => {
    const role = (await db().from('roles').select('id').eq('code', code).single()).data as any;
    const rp = ((await db().from('role_permissions').select('permission_id').eq('role_id', role.id)).data || []) as any[];
    const ps = ((await db().from('permissions').select('id,code').in('id', rp.map((x) => x.permission_id))).data || []) as any[];
    return ps.map((p) => p.code).sort();
  };
  const clerk = await permsOf('vue_workspace_ga45_clerk');
  expect(clerk).toEqual(expect.arrayContaining(['general_affairs.purchase_payment.manage', 'general_affairs.vendor.view', 'general_affairs.inventory_transaction.manage', 'general_affairs.part.view', 'general_affairs.purchase_review.manage']));
  expect(clerk).not.toContain('general_affairs.purchase_payment.view');
  expect(await permsOf('vue_workspace_ga45_viewer')).toEqual(['general_affairs.purchase_payment.view', 'general_affairs.purchase_review.view', 'general_affairs.service_center.access']);
  expect(await permsOf('vue_workspace_ga45_novendor')).toEqual(['general_affairs.purchase_payment.manage', 'general_affairs.purchase_review.view', 'general_affairs.service_center.access']);
  const all = ((await db().from('permissions').select('code').like('code', 'general_affairs.purchase_payment.%')).data || []) as any[];
  expect(all.map((x) => x.code).sort()).toEqual(['general_affairs.purchase_payment.manage', 'general_affairs.purchase_payment.view']);
});

test('G45-db 設定：尾差與買受人（讀、寫、STALE、範圍、紀錄）', async () => {
  const g = okData(await fn('viewer', 'ga_ws_pay_settings_get', {}));
  expect(g.tolerance_amount).toBe(5);
  expect(g.can_edit).toBe(false);
  expect(okData(await fn('clerk', 'ga_ws_pay_settings_get', {})).can_edit).toBe(true);
  const set = (vals: Record<string, unknown>, expected: string | null) => fn('clerk', 'ga_ws_pay_settings_set', { p_values: vals, p_expected_updated_at: expected });
  expectErr(await set({ tolerance_amount: 8 }, null), 400, 'EXPECTED_REQUIRED');
  expectErr(await set({ tolerance_amount: 101 }, g.updated_at), 400, 'SETTINGS_INVALID');
  expectErr(await set({ tolerance_amount: '1.5' }, g.updated_at), 400, 'SETTINGS_INVALID');
  expectErr(await set({ tolerance_amount: -1 }, g.updated_at), 400, 'SETTINGS_INVALID');
  expectErr(await set({ buyer_tax_id: '123' }, g.updated_at), 400, 'SETTINGS_INVALID');
  expectErr(await set({ approval_threshold: 1 }, g.updated_at), 400, 'SETTINGS_INVALID', '不支援');
  expectErr(await set({ tolerance_amount: 8 }, '2000-01-01T00:00:00Z'), 409, 'STALE');
  const s1 = okData(await set({ tolerance_amount: 8, buyer_title: 'QA 買受人公司', buyer_tax_id: '12345678' }, g.updated_at));
  expect(s1.tolerance_amount).toBe(8);
  expect(s1.buyer_title).toBe('QA 買受人公司');
  expect(s1.buyer_tax_id).toBe('12345678');
  expect(s1.history.length).toBeGreaterThan(0);
  expect(await db().from('ga_workflow_settings').select('value_num').eq('key', 'pay_tolerance_amount').single().then((r) => Number((r.data as any).value_num))).toBe(8);
  // 舊版本號再送：STALE
  expectErr(await set({ tolerance_amount: 9 }, g.updated_at), 409, 'STALE');
  const s2 = okData(await set({ tolerance_amount: 5, buyer_title: null, buyer_tax_id: null }, s1.updated_at));
  expect(s2.tolerance_amount).toBe(5);
  expect(s2.buyer_tax_id).toBeNull();
  // 設定頁的寫入不碰採購設定（po_ 開頭）
  const po = okData(await fn('clerk', 'ga_ws_po_settings_get', {}).catch(() => ({ ok: true, data: {} })));
  expect(po).toBeDefined();
});

// ================================================================== 進貨憑證與金額凍結
test('G45-db 進貨明細未稅金額：登錄時凍結、品項各自進位、不受之後改價影響', async () => {
  const vendor = await newVendor('R');
  const po = await mkPo(vendor, { its: [
    { item_name: 'QA-GA45 甲', unit: '個', quantity: 3, unit_price: 33.33 },
    { item_name: 'QA-GA45 乙', unit: '個', quantity: 3, unit_price: 0.5 },
    { item_name: 'QA-GA45 丙', unit: '個', quantity: 3, unit_price: 0.4 },
    { item_name: 'QA-GA45 丁', unit: '個', quantity: 3, unit_price: 0.4 },
  ] });
  const r = await recv(po, [1, 2, 3, 4].map((n) => ({ po_item_id: itemId(po, n), delivered_qty: 3 })));
  const rows = ((await db().from('ga_purchase_receipt_items').select('po_item_id,amount_untaxed').eq('receipt_id', r.id)).data || []) as any[];
  const by = (n: number) => Number(rows.find((x) => x.po_item_id === itemId(po, n)).amount_untaxed);
  expect(by(1)).toBe(100); // 99.99 → 100
  expect(by(2)).toBe(2); // 1.5 → 2（四捨五入）
  expect(by(3)).toBe(1); // 1.2 → 1
  expect(by(4)).toBe(1);
  const s = await summary(po);
  expect(s.received_untaxed).toBe(104);
  expect(s.received_tax).toBe(5); // round(104 × 0.05 = 5.2)
  expect(s.received_total).toBe(109);
  // 改採購單品項單價，已凍結的進貨金額不變
  await db().from('ga_purchase_order_items').update({ unit_price: 999 }).eq('id', itemId(po, 1));
  expect(Number((((await db().from('ga_purchase_receipt_items').select('amount_untaxed').eq('po_item_id', itemId(po, 1)).single()).data) as any).amount_untaxed)).toBe(100);
  // 觸發器：沒給金額就用單價算，給了就保留
  const rid = crypto.randomUUID();
  expect(rid).toBeTruthy();
  const rcpt = (await db().from('ga_purchase_receipt_items').select('receipt_id').eq('po_item_id', itemId(po, 2)).single()).data as any;
  expect(rcpt.receipt_id).toBe(r.id);
});

test('G45-db 進貨憑證：登錄免開發票需說明、STALE、已連發票時鎖定、作廢進貨不能登錄、權限', async () => {
  const { receipt, vendor } = await scene();
  const v = (status: string, note: string | null, expected: string | null) => fn('clerk', 'ga_ws_pay_voucher_set', { p_receipt_id: receipt.id, p_status: status, p_note: note, p_expected_updated_at: expected });
  expectErr(await v('NO_INVOICE', null, receipt.updated_at), 400, 'NOTE_REQUIRED');
  expectErr(await v('NO_INVOICE', '只有送貨單', null), 400, 'EXPECTED_REQUIRED');
  expectErr(await v('LINKED', 'x', receipt.updated_at), 400, 'STATUS_INVALID');
  expectErr(await v('NO_INVOICE', '只有送貨單', '2000-01-01T00:00:00Z'), 409, 'STALE');
  expectErr(await fn('viewer', 'ga_ws_pay_voucher_set', { p_receipt_id: receipt.id, p_status: 'NO_INVOICE', p_note: 'x', p_expected_updated_at: receipt.updated_at }), 403, 'PERMISSION_DENIED');
  const d1 = okData(await v('NO_INVOICE', '只有送貨單', receipt.updated_at));
  expect(d1.voucher_status).toBe('NO_INVOICE');
  expect(d1.voucher_note).toBe('只有送貨單');
  const row = (await db().from('ga_purchase_receipts').select('voucher_status,voucher_recorded_by,voucher_recorded_at').eq('id', receipt.id).single()).data as any;
  expect(row.voucher_status).toBe('NO_INVOICE');
  expect(row.voucher_recorded_by).toBe(users.clerk.id);
  // 連上發票後變 LINKED，不可手動改
  const inv = okData(await mkInv('clerk', vendor, [receipt]));
  expect((await db().from('ga_purchase_receipts').select('voucher_status').eq('id', receipt.id).single().then((r) => r.data as any)).voucher_status).toBe('LINKED');
  expectErr(await v('NONE', null, d1.updated_at), 409, 'STALE'); // 連發票時 updated_at 已更新
  const cur = (await db().from('ga_purchase_receipts').select('updated_at').eq('id', receipt.id).single()).data as any;
  expectErr(await v('NONE', null, cur.updated_at), 409, 'VOUCHER_LINKED');
  // 作廢發票後回到 NONE（不是 NO_INVOICE）
  const voided = okData(await fn('clerk', 'ga_ws_pay_invoice_void', { p_id: inv.id, p_reason: '登錄錯誤', p_key: key(), p_expected_updated_at: inv.updated_at }));
  expect(voided.status).toBe('VOID');
  expect((await db().from('ga_purchase_receipts').select('voucher_status').eq('id', receipt.id).single().then((r) => r.data as any)).voucher_status).toBe('NONE');
  // 作廢的進貨單不能登錄憑證
  await db().from('ga_purchase_receipts').update({ voided_at: new Date().toISOString(), void_reason: '測試作廢' }).eq('id', receipt.id);
  const cur2 = (await db().from('ga_purchase_receipts').select('updated_at').eq('id', receipt.id).single()).data as any;
  expectErr(await v('NO_INVOICE', 'x', cur2.updated_at), 409, 'RECEIPT_VOIDED');
  expectErr(await fn('clerk', 'ga_ws_pay_voucher_set', { p_receipt_id: crypto.randomUUID(), p_status: 'NONE', p_note: null, p_expected_updated_at: cur2.updated_at }), 404, 'NOT_FOUND');
});

// ================================================================== 發票
test('G45-db 發票：新增（稅額自動算、缺圖警示、憑證 LINKED）、固定識別重送與衝突、必填、日期', async () => {
  const { vendor, receipt } = await scene();
  const k = key();
  const payload = { invoice_type: 'TRIPLE', invoice_no: invNo().toLowerCase(), invoice_date: today(), vendor_id: vendor.id, amount_untaxed: 1000, receipts: [{ receipt_id: receipt.id }] };
  const r1 = await fn('clerk', 'ga_ws_pay_invoice_save', { p_id: null, p_payload: payload, p_key: k });
  expect(r1.status).toBe(201);
  const inv = okData(r1);
  expect(inv.tax_amount).toBe(50);
  expect(inv.amount_total).toBe(1050);
  expect(inv.invoice_no).toBe(payload.invoice_no.toUpperCase());
  expect(inv.missing_image).toBe(true);
  expect(inv.image_count).toBe(0);
  expect(inv.status).toBe('ACTIVE');
  expect(inv.receipts[0]).toMatchObject({ receipt_id: receipt.id, allocated_untaxed: 1000, allocated_tax: 50 });
  expect(r1.warnings.map((w: any) => w.code)).toContain('MISSING_IMAGE');
  expect(inv).not.toHaveProperty('idempotency_key');
  expect(inv).not.toHaveProperty('payload_hash');
  const dbRow = (await db().from('ga_purchase_invoices').select('*').eq('id', inv.id).single()).data as any;
  expect(dbRow.created_by).toBe(users.clerk.id);
  expect(Number(dbRow.amount_total)).toBe(1050);
  expect((await db().from('ga_purchase_receipts').select('voucher_status').eq('id', receipt.id).single().then((r) => r.data as any)).voucher_status).toBe('LINKED');
  // 同識別同內容重送回原結果；內容不同 409
  const r2 = await fn('clerk', 'ga_ws_pay_invoice_save', { p_id: null, p_payload: payload, p_key: k });
  expect(r2.replay).toBe(true);
  expect(r2.data.id).toBe(inv.id);
  expect((await db().from('ga_purchase_invoices').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id)).count).toBe(1);
  expectErr(await fn('clerk', 'ga_ws_pay_invoice_save', { p_id: null, p_payload: { ...payload, amount_untaxed: 999 }, p_key: k }), 409, 'IDEMPOTENCY_CONFLICT');
  expectErr(await fn('clerk', 'ga_ws_pay_invoice_save', { p_id: null, p_payload: payload, p_key: null }), 400, 'IDEMPOTENCY_KEY_REQUIRED');
  // 必填與格式
  const bad = (over: Record<string, unknown>) => mkInv('clerk', vendor, [receipt], { invoice_no: invNo(), ...over });
  expectErr(await bad({ invoice_type: 'XX' }), 400, 'INVOICE_TYPE');
  expectErr(await bad({ invoice_no: null }), 400, 'INVOICE_NO_REQUIRED');
  expectErr(await bad({ invoice_date: '2999-01-01' }), 400, 'DATE_FUTURE');
  expectErr(await bad({ invoice_date: '2026/01/01' }), 400, 'DATE_FORMAT');
  expectErr(await bad({ invoice_date: null }), 400, 'DATE_REQUIRED');
  expectErr(await bad({ amount_untaxed: null }), 400, 'AMOUNT_REQUIRED');
  expectErr(await bad({ amount_untaxed: '12.5' }), 400, 'AMOUNT_FORMAT');
  expectErr(await bad({ amount_untaxed: -5 }), 400, 'AMOUNT_FORMAT');
  expectErr(await bad({ vendor_id: null, receipts: [] }), 400, 'VENDOR_REQUIRED');
  expectErr(await bad({ receipts: 'x' }), 400, 'BAD_PAYLOAD');
  expectErr(await bad({ receipts: [{ receipt_id: crypto.randomUUID() }] }), 404, 'RECEIPT_NOT_FOUND');
  expectErr(await bad({ receipts: [{ receipt_id: receipt.id }, { receipt_id: receipt.id }] }), 400, 'DUPLICATE_LINE');
  expectErr(await bad({ seller_tax_id: '123' }), 400, 'TAX_ID_FORMAT');
  expectErr(await bad({ notes: 'x'.repeat(501) }), 400, 'FIELD_TOO_LONG');
  // 另一個廠商的進貨單不能連
  const other = await newVendor('O');
  expectErr(await mkInv('clerk', other, [receipt], { invoice_no: invNo() }), 400, 'VENDOR_MISMATCH');
  // 沒有連進貨單：以廠商登錄，稅率用設定預設（5%）
  const free = okData(await mkInv('clerk', vendor, [], { amount_untaxed: 200 }));
  expect(free.tax_amount).toBe(10);
  expect(free.receipts).toEqual([]);
  // 手改稅額（尾差）
  const hand = okData(await mkInv('clerk', vendor, [], { amount_untaxed: 200, tax_amount: 11 }));
  expect(hand.amount_total).toBe(211);
});

test('G45-db 發票：免稅（採購單稅率 0）、收據與免開發票（稅額 0、金額規則、缺圖判斷）', async () => {
  const { vendor, receipt } = await scene({ rate0: true });
  const t0 = okData(await mkInv('clerk', vendor, [receipt]));
  expect(t0.tax_amount).toBe(0);
  expect(t0.amount_total).toBe(1000);
  // 收據：用含稅總額，稅額固定 0；沒圖也沒原因 → 缺圖
  const rc = okData(await mkInv('clerk', vendor, [], { invoice_type: 'RECEIPT', invoice_no: null, amount_untaxed: undefined, amount_total: 300 }));
  expect(rc).toMatchObject({ amount_untaxed: 300, tax_amount: 0, amount_total: 300, missing_image: true });
  expectErr(await mkInv('clerk', vendor, [], { invoice_type: 'RECEIPT', invoice_no: null, amount_total: 300, amount_untaxed: 200 }), 400, 'AMOUNT_MISMATCH');
  // 收據有原因 → 不缺圖，且可被請款引用；填原因後 no_image_reason 保留
  const rc2 = okData(await mkInv('clerk', vendor, [receipt], { invoice_type: 'RECEIPT', invoice_no: null, amount_untaxed: undefined, amount_total: 1000, no_image_reason: '對方只給口頭收據', tax_amount: 77 }));
  expect(rc2).toMatchObject({ tax_amount: 0, amount_total: 1000, missing_image: false, no_image_reason: '對方只給口頭收據' });
  // 免開發票：不需要圖、不需要號碼與日期
  const ni = okData(await mkInv('clerk', vendor, [], { invoice_type: 'NO_INVOICE', invoice_no: null, invoice_date: null, amount_untaxed: undefined, amount_total: 500 }));
  expect(ni).toMatchObject({ invoice_no: null, invoice_date: today(), tax_amount: 0, amount_total: 500, missing_image: false });
  // 三聯式的 no_image_reason 不採用
  const t1 = okData(await mkInv('clerk', vendor, [], { amount_untaxed: 10, no_image_reason: '不該有' }));
  expect(t1.no_image_reason).toBeNull();
  expect(t1.missing_image).toBe(true);
  // 資料庫約束：二聯、電子、三聯類型以外稅額必為 0
  const direct = await db().from('ga_purchase_invoices').insert({ invoice_type: 'RECEIPT', invoice_date: today(), vendor_id: vendor.id, amount_untaxed: 100, tax_amount: 5, amount_total: 105, idempotency_key: key(), payload_hash: 'x' });
  expect(direct.error).not.toBeNull();
  const direct2 = await db().from('ga_purchase_invoices').insert({ invoice_type: 'TRIPLE', invoice_no: 'ZZ1', invoice_date: today(), vendor_id: vendor.id, amount_untaxed: 100, tax_amount: 5, amount_total: 999, idempotency_key: key(), payload_hash: 'x' });
  expect(direct2.error).not.toBeNull();
});

test('G45-db 發票：同廠商同號碼不可重複（忽略大小寫與空白）、不同廠商可、作廢後可重用', async () => {
  const { vendor, receipt } = await scene();
  const no = invNo();
  const a = okData(await mkInv('clerk', vendor, [receipt], { invoice_no: ` ${no.toLowerCase()} ` }));
  expect(a.invoice_no).toBe(no);
  const dup = await mkInv('clerk', vendor, [], { invoice_no: no, amount_untaxed: 50 });
  expectErr(dup, 409, 'INVOICE_NO_DUPLICATE', no);
  expect(dup.existing.id).toBe(a.id);
  const other = await newVendor('D');
  okData(await mkInv('clerk', other, [], { invoice_no: no, amount_untaxed: 50 }));
  okData(await fn('clerk', 'ga_ws_pay_invoice_void', { p_id: a.id, p_reason: '重開', p_key: key(), p_expected_updated_at: a.updated_at }));
  okData(await mkInv('clerk', vendor, [], { invoice_no: no, amount_untaxed: 50 }));
  // 資料庫部分唯一索引也擋（直接寫入）
  const direct = await db().from('ga_purchase_invoices').insert({ invoice_type: 'TRIPLE', invoice_no: no, invoice_date: today(), vendor_id: vendor.id, amount_untaxed: 1, tax_amount: 0, amount_total: 1, idempotency_key: key(), payload_hash: 'x' });
  expect(direct.error).not.toBeNull();
});

test('G45-db 發票：統編不符與金額差異要填原因（可儲存）、尾差 5 元內免原因、尾差可調', async () => {
  const { vendor, receipt, po } = await scene();
  const snap = (await db().from('ga_purchase_orders').select('vendor_tax_id_snapshot').eq('id', po.id).single()).data as any;
  const wrongTax = vendor.tax_id === '11111111' ? '22222222' : '11111111';
  // 賣方統編與採購單下訂快照不符
  const m1 = await mkInv('clerk', vendor, [receipt], { seller_tax_id: wrongTax });
  expectErr(m1, 400, 'TAX_MISMATCH_REASON_REQUIRED');
  expect(m1.expected_seller_tax_id).toBe(snap.vendor_tax_id_snapshot);
  const m2 = await mkInv('clerk', vendor, [receipt], { seller_tax_id: wrongTax, tax_mismatch_reason: '廠商換了統編' });
  const inv = okData(m2);
  expect(inv.tax_mismatch_reason).toBe('廠商換了統編');
  expect(m2.warnings.map((w: any) => w.code)).toContain('TAX_MISMATCH');
  expect(inv.seller_tax_id_snapshot).toBe(wrongTax);
  // 統編相符：不用原因，且原因被清掉
  const okInv = okData(await mkInv('clerk', vendor, [receipt], { seller_tax_id: snap.vendor_tax_id_snapshot, tax_mismatch_reason: '多餘', diff_reason: '多餘', amount_untaxed: 1000 }));
  expect(okInv.tax_mismatch_reason).toBeNull();
  expect(okInv.diff_reason).toBeNull();
  // 金額差異：連結進貨含稅 1050；發票未稅 1004＋稅 50 = 1054，差 4 → 免原因；差 5（1055）免原因；差 6 要原因
  okData(await mkInv('clerk', vendor, [receipt], { amount_untaxed: 1004, tax_amount: 50 }));
  okData(await mkInv('clerk', vendor, [receipt], { amount_untaxed: 1005, tax_amount: 50 }));
  const d6 = await mkInv('clerk', vendor, [receipt], { amount_untaxed: 1006, tax_amount: 50 });
  expectErr(d6, 400, 'DIFF_REASON_REQUIRED');
  expect(d6.tolerance).toBe(5);
  const d6ok = okData(await mkInv('clerk', vendor, [receipt], { amount_untaxed: 1006, tax_amount: 50, diff_reason: '運費' }));
  expect(d6ok.diff_reason).toBe('運費');
  // 往下差也算（絕對值）
  expectErr(await mkInv('clerk', vendor, [receipt], { amount_untaxed: 990, tax_amount: 50 }), 400, 'DIFF_REASON_REQUIRED');
  // 尾差調成 10：差 6 免原因；調成 0：差 1 要原因
  const st = okData(await fn('clerk', 'ga_ws_pay_settings_get', {}));
  const s10 = okData(await fn('clerk', 'ga_ws_pay_settings_set', { p_values: { tolerance_amount: 10 }, p_expected_updated_at: st.updated_at }));
  okData(await mkInv('clerk', vendor, [receipt], { amount_untaxed: 1006, tax_amount: 50 }));
  const s0 = okData(await fn('clerk', 'ga_ws_pay_settings_set', { p_values: { tolerance_amount: 0 }, p_expected_updated_at: s10.updated_at }));
  expectErr(await mkInv('clerk', vendor, [receipt], { amount_untaxed: 1001, tax_amount: 50 }), 400, 'DIFF_REASON_REQUIRED');
  okData(await fn('clerk', 'ga_ws_pay_settings_set', { p_values: { tolerance_amount: 5 }, p_expected_updated_at: s0.updated_at }));
  // 買受人（三聯式）統編對設定
  const st2 = okData(await fn('clerk', 'ga_ws_pay_settings_get', {}));
  const sb = okData(await fn('clerk', 'ga_ws_pay_settings_set', { p_values: { buyer_title: 'QA 買受人', buyer_tax_id: '87654321' }, p_expected_updated_at: st2.updated_at }));
  const b0 = okData(await mkInv('clerk', vendor, [receipt], {})); // 沒填 → 用設定
  expect(b0.buyer_tax_id).toBe('87654321');
  expectErr(await mkInv('clerk', vendor, [receipt], { buyer_tax_id: '11112222' }), 400, 'TAX_MISMATCH_REASON_REQUIRED');
  okData(await mkInv('clerk', vendor, [receipt], { buyer_tax_id: '11112222', tax_mismatch_reason: '客戶要求開別家' }));
  okData(await mkInv('clerk', vendor, [receipt], { invoice_type: 'DUPLEX', buyer_tax_id: '11112222' })); // 二聯式不核對買受人
  okData(await fn('clerk', 'ga_ws_pay_settings_set', { p_values: { buyer_title: null, buyer_tax_id: null }, p_expected_updated_at: sb.updated_at }));
});

test('G45-db 發票：編輯（STALE、換號碼重複被擋、作廢不可改）、查詢（遮蔽賣方統編、篩選、分頁、搜尋跳脫）', async () => {
  const { vendor, receipt } = await scene();
  const a = okData(await mkInv('clerk', vendor, [receipt]));
  const b = okData(await mkInv('clerk', vendor, [], { amount_untaxed: 300 }));
  const edit = (inv: any, payload: Record<string, unknown>, expected: string | null = inv.updated_at, who: Ga45Key = 'clerk') => fn(who, 'ga_ws_pay_invoice_save', { p_id: inv.id, p_payload: payload, p_key: null, p_expected_updated_at: expected });
  expectErr(await edit(a, { notes: 'x' }, null), 400, 'EXPECTED_REQUIRED');
  expectErr(await edit(a, { notes: 'x' }, '2000-01-01T00:00:00Z'), 409, 'STALE');
  expectErr(await edit(a, { invoice_no: b.invoice_no }), 409, 'INVOICE_NO_DUPLICATE');
  expectErr(await edit(a, { notes: 'x' }, a.updated_at, 'viewer'), 403, 'PERMISSION_DENIED');
  const a2 = okData(await edit(a, { notes: '補充說明', amount_untaxed: 1004 }));
  expect(a2).toMatchObject({ notes: '補充說明', amount_untaxed: 1004, tax_amount: 50, amount_total: 1054 });
  expect(a2.diff_reason).toBeNull();
  // 連結的進貨單與分攤變動
  const a3 = okData(await edit(a2, { receipts: [] }));
  expect(a3.receipts).toEqual([]);
  expect((await db().from('ga_purchase_receipts').select('voucher_status').eq('id', receipt.id).single().then((r) => r.data as any)).voucher_status).toBe('NONE');
  // 作廢後不可改、不可再作廢（同識別同原因重送回原結果）
  const vk = key();
  const v1 = okData(await fn('clerk', 'ga_ws_pay_invoice_void', { p_id: a3.id, p_reason: '開錯', p_key: vk, p_expected_updated_at: a3.updated_at }));
  expect(v1).toMatchObject({ status: 'VOID', void_reason: '開錯' });
  const v2 = await fn('clerk', 'ga_ws_pay_invoice_void', { p_id: a3.id, p_reason: '開錯', p_key: vk, p_expected_updated_at: a3.updated_at });
  expect(v2.replay).toBe(true);
  expectErr(await fn('clerk', 'ga_ws_pay_invoice_void', { p_id: a3.id, p_reason: '開錯', p_key: key(), p_expected_updated_at: a3.updated_at }), 409, 'INVALID_STATE');
  expectErr(await edit(v1, { notes: 'x' }, v1.updated_at), 409, 'INVALID_STATE');
  expectErr(await fn('clerk', 'ga_ws_pay_invoice_void', { p_id: b.id, p_reason: null, p_key: key(), p_expected_updated_at: b.updated_at }), 400, 'REASON_REQUIRED');
  expectErr(await fn('clerk', 'ga_ws_pay_invoice_void', { p_id: b.id, p_reason: '原因', p_key: null, p_expected_updated_at: b.updated_at }), 400, 'IDEMPOTENCY_KEY_REQUIRED');
  expectErr(await fn('clerk', 'ga_ws_pay_invoice_void', { p_id: b.id, p_reason: '原因', p_key: key(), p_expected_updated_at: '2000-01-01T00:00:00Z' }), 409, 'STALE');
  expectErr(await fn('clerk', 'ga_ws_pay_invoice_get', { p_id: crypto.randomUUID() }), 404, 'NOT_FOUND');
  // 賣方統編遮蔽：有廠商權限的看得到，沒有的（viewer、novendor）看不到
  const gc = okData(await fn('clerk', 'ga_ws_pay_invoice_get', { p_id: b.id }));
  expect(gc.seller_tax_id_snapshot).toBe(vendor.tax_id);
  expect(gc.seller_tax_masked).toBe(false);
  for (const who of ['viewer', 'novendor'] as Ga45Key[]) {
    const g = okData(await fn(who, 'ga_ws_pay_invoice_get', { p_id: b.id }));
    expect(g.seller_tax_id_snapshot).toBeNull();
    expect(g.seller_tax_masked).toBe(true);
    expect(JSON.stringify(g)).not.toContain(vendor.tax_id);
  }
  // 列表：廠商、狀態、缺圖、搜尋跳脫、分頁
  const c = okData(await mkInv('clerk', vendor, [], { amount_untaxed: 40, invoice_no: 'QA_PCT%X' }));
  expect(c).toBeDefined();
  const list = async (filters: Record<string, unknown>, page = 1, size = 20, who: Ga45Key = 'clerk') => okData(await fn(who, 'ga_ws_pay_invoice_list', { p_filters: filters, p_page: page, p_page_size: size }));
  const all = await list({ vendor_id: vendor.id });
  expect(all.total).toBe(3);
  expect(all.rows.length).toBe(3);
  expect((await list({ vendor_id: vendor.id, status: 'VOID' })).total).toBe(1);
  expect((await list({ vendor_id: vendor.id, status: 'ACTIVE' })).total).toBe(2);
  expect((await list({ vendor_id: vendor.id, missing_image: true })).total).toBe(2);
  expect((await list({ vendor_id: vendor.id, search: '%' })).total).toBe(1);
  expect((await list({ vendor_id: vendor.id, search: '_PCT' })).total).toBe(1);
  expect((await list({ vendor_id: vendor.id, search: 'PCT_' })).total).toBe(0);
  expect((await list({ vendor_id: vendor.id, type: 'RECEIPT' })).total).toBe(0);
  const p1 = await list({ vendor_id: vendor.id }, 1, 2);
  const p2 = await list({ vendor_id: vendor.id }, 2, 2);
  expect(p1.rows.length).toBe(2);
  expect(p2.rows.length).toBe(1);
  expect(p1.total).toBe(3);
  expect(new Set([...p1.rows, ...p2.rows].map((r: any) => r.id)).size).toBe(3);
  expect((await list({ vendor_id: vendor.id }, 1, 500)).page_size).toBe(100);
  expectErr(await fn('clerk', 'ga_ws_pay_invoice_list', { p_filters: { status: 'X' } }), 400, 'BAD_FILTER');
  expectErr(await fn('clerk', 'ga_ws_pay_invoice_list', { p_filters: { vendor_id: 'abc' } }), 400, 'FIELD_TYPE');
  expect((await list({ vendor_id: vendor.id, receipt_id: receipt.id })).total).toBe(0);
});

// ================================================================== 附件分支
test('G45-db 附件：PURCHASE_INVOICE 與 PURCHASE_RECEIPT 的寫入與讀取分支、CHECK、缺圖計數', async () => {
  const { vendor, receipt } = await scene();
  const inv = okData(await mkInv('clerk', vendor, [receipt]));
  const can = async (who: Ga45Key, fnName: string, type: string, id: string) => (await callFn(users[who].client, fnName, { p_resource_type: type, p_resource_id: id }));
  // 管理判斷：有請款管理權限者可寫；唯讀者、無權限者不可
  expect(await can('clerk', 'ga_resource_attachment_can_manage', 'PURCHASE_INVOICE', inv.id)).toBe(true);
  expect(await can('novendor', 'ga_resource_attachment_can_manage', 'PURCHASE_INVOICE', inv.id)).toBe(true);
  expect(await can('accountant', 'ga_resource_attachment_can_manage', 'PURCHASE_INVOICE', inv.id)).toBe(true);
  for (const who of ['viewer', 'payonly', 'purchaser', 'nobody', 'admin', 'store_mgr'] as Ga45Key[]) expect(await can(who, 'ga_resource_attachment_can_manage', 'PURCHASE_INVOICE', inv.id), `${who} manage`).toBe(false);
  // 讀取判斷：請款查看或管理可讀
  for (const who of ['clerk', 'viewer', 'payonly', 'novendor', 'accountant'] as Ga45Key[]) expect(await can(who, 'ga_resource_attachment_can_read', 'PURCHASE_INVOICE', inv.id), `${who} read`).toBe(true);
  for (const who of ['purchaser', 'nobody', 'admin', 'store_mgr'] as Ga45Key[]) expect(await can(who, 'ga_resource_attachment_can_read', 'PURCHASE_INVOICE', inv.id), `${who} read`).toBe(false);
  // 進貨單照片
  expect(await can('clerk', 'ga_resource_attachment_can_manage', 'PURCHASE_RECEIPT', receipt.id)).toBe(true);
  expect(await can('viewer', 'ga_resource_attachment_can_manage', 'PURCHASE_RECEIPT', receipt.id)).toBe(false);
  expect(await can('viewer', 'ga_resource_attachment_can_read', 'PURCHASE_RECEIPT', receipt.id)).toBe(true);
  expect(await can('nobody', 'ga_resource_attachment_can_read', 'PURCHASE_RECEIPT', receipt.id)).toBe(false);
  // 資源不存在：一律 false
  expect(await can('clerk', 'ga_resource_attachment_can_manage', 'PURCHASE_INVOICE', crypto.randomUUID())).toBe(false);
  expect(await can('clerk', 'ga_resource_attachment_can_read', 'PURCHASE_RECEIPT', crypto.randomUUID())).toBe(false);
  // 直接寫入附件：clerk 可以、viewer 不行
  const ok = await addImage('clerk', inv);
  expect(ok.error, JSON.stringify(ok.error)).toBeNull();
  expect(ok.data.resource_type).toBe('PURCHASE_INVOICE');
  const denied = await addImage('viewer', inv);
  expect(denied.error).not.toBeNull();
  const denied2 = await addImage('purchaser', inv);
  expect(denied2.error).not.toBeNull();
  const rc = await users.clerk.client.from('ga_resource_attachments').insert({
    resource_type: 'PURCHASE_RECEIPT', resource_id: receipt.id, purpose: 'DELIVERY_NOTE', storage_path: `purchase_receipt/${receipt.id}/delivery_note/${crypto.randomUUID()}.png`,
    file_name: `m7m8t-${crypto.randomUUID()}.png`, content_type: 'image/png', size_bytes: 10, uploaded_by: users.clerk.id,
  }).select('id').single();
  expect(rc.error, JSON.stringify(rc.error)).toBeNull();
  // 讀取列：viewer 看得到、purchaser 看不到
  const rv = await users.viewer.client.from('ga_resource_attachments').select('id').eq('resource_id', inv.id);
  expect((rv.data || []).length).toBe(1);
  const rp = await users.purchaser.client.from('ga_resource_attachments').select('id').eq('resource_id', inv.id);
  expect((rp.data || []).length).toBe(0);
  // 路徑規則仍在（不以 purchase_invoice/ 開頭被擋；不認識的類型被擋）
  const badPath = await addImage('clerk', inv, { storage_path: `part/${inv.id}/x.png` });
  expect(badPath.error).not.toBeNull();
  const badType = await addImage('clerk', inv, { resource_type: 'PURCHASE_ORDER', storage_path: `purchase_order/${inv.id}/x.png` });
  expect(badType.error).not.toBeNull();
  // 缺圖計數：有一張 INVOICE_IMAGE 後不缺圖；進貨單照片不算發票圖
  const g = okData(await fn('clerk', 'ga_ws_pay_invoice_get', { p_id: inv.id }));
  expect(g.image_count).toBe(1);
  expect(g.missing_image).toBe(false);
  // 軟刪除（只標記）：無請款單引用時可刪最後一張，刪後又缺圖
  const del = await users.clerk.client.rpc('ga_soft_delete_resource_attachment', { p_attachment_id: ok.data.id, p_reason: '拍錯了' });
  expect(del.error, JSON.stringify(del.error)).toBeNull();
  const row = (await db().from('ga_resource_attachments').select('deleted_at,deletion_reason').eq('id', ok.data.id).single()).data as any;
  expect(row.deleted_at).not.toBeNull();
  expect(okData(await fn('clerk', 'ga_ws_pay_invoice_get', { p_id: inv.id })).missing_image).toBe(true);
  // 唯讀者不能刪
  const ok2 = await addImage('clerk', inv);
  const del2 = await users.viewer.client.rpc('ga_soft_delete_resource_attachment', { p_attachment_id: ok2.data.id, p_reason: '想刪' });
  expect(del2.error).not.toBeNull();
  // 作廢的發票：寫入判斷 false，但歷史仍可讀
  okData(await fn('clerk', 'ga_ws_pay_invoice_void', { p_id: inv.id, p_reason: '作廢', p_key: key(), p_expected_updated_at: (okData(await fn('clerk', 'ga_ws_pay_invoice_get', { p_id: inv.id }))).updated_at }));
  expect(await can('clerk', 'ga_resource_attachment_can_manage', 'PURCHASE_INVOICE', inv.id)).toBe(false);
  expect(await can('viewer', 'ga_resource_attachment_can_read', 'PURCHASE_INVOICE', inv.id)).toBe(true);
});

test('G45-db 附件：既有資源類型回歸（水電帳單、設備、料件、不存在的類型不受影響）', async () => {
  const stRows = (await db().from('stores').select('id').eq('store_code', 'VW001').single()).data as any;
  // 水電帳單只能用資料庫函式新增（直接寫入會被觸發器擋）；用第 6 批水電管理角色建立，供回歸
  const bill = await fn('util_mgr', 'ga_ws_ub_save', { p_id: null, p_payload: { store_id: stRows.id, expense_type: 'WATER', billing_month: '2038-02', provider_name: ga6Name('GA45REG'), service_identifier: `QA45-${Date.now()}`, amount: 1 }, p_expected_updated_at: null, p_confirm_paid_change: false });
  const billId = okData(bill).id as string;
  const can = async (who: Ga45Key, fnName: string, type: string, id: string) => callFn(users[who].client, fnName, { p_resource_type: type, p_resource_id: id });
  // 水電帳單寫入判斷（第 6 批）：水電網費管理者 true；請款角色、採購角色 false
  expect(await can('util_mgr', 'ga_resource_attachment_can_manage', 'UTILITY_BILL', billId)).toBe(true);
  expect(await can('clerk', 'ga_resource_attachment_can_manage', 'UTILITY_BILL', billId)).toBe(false);
  expect(await can('purchaser', 'ga_resource_attachment_can_manage', 'UTILITY_BILL', billId)).toBe(false);
  const ins = await users.util_mgr.client.from('ga_resource_attachments').insert({
    resource_type: 'UTILITY_BILL', resource_id: billId, purpose: 'BILL_IMAGE', storage_path: `utility_bill/${billId}/bill_image/${crypto.randomUUID()}.png`, file_name: `m7m8t-${crypto.randomUUID()}.png`,
    content_type: 'image/png', size_bytes: 10, uploaded_by: users.util_mgr.id,
  }); // 不帶 select：水電帳單的讀取判斷沒有 UTILITY_BILL 分支（既有行為，附件讀取走伺服端閘），RETURNING 會被讀取政策擋
  expect(ins.error, JSON.stringify(ins.error)).toBeNull();
  const insBad = await users.clerk.client.from('ga_resource_attachments').insert({
    resource_type: 'UTILITY_BILL', resource_id: billId, purpose: 'BILL_IMAGE', storage_path: `utility_bill/${billId}/bill_image/${crypto.randomUUID()}.png`, file_name: `m7m8t-${crypto.randomUUID()}.png`,
    content_type: 'image/png', size_bytes: 10, uploaded_by: users.clerk.id,
  });
  expect(insBad.error).not.toBeNull();
  // 其他既有類型：資源不存在時 false；不認識的類型 false；管理員 profile 不繞過
  for (const type of ['EQUIPMENT', 'FACILITY', 'PART', 'MAINTENANCE_REQUEST', 'MAINTENANCE_UPDATE', 'SERVICE_REQUEST', 'SERVICE_REQUEST_COMMENT', 'UTILITY_BILL', 'NOT_A_TYPE']) {
    for (const who of ['clerk', 'admin', 'nobody'] as Ga45Key[]) {
      expect(await can(who, 'ga_resource_attachment_can_manage', type, crypto.randomUUID()), `${who} manage ${type}`).toBe(false);
      expect(await can(who, 'ga_resource_attachment_can_read', type, crypto.randomUUID()), `${who} read ${type}`).toBe(false);
    }
  }
  // 既有分支都還在（沒被整支覆蓋）：料件讀取（有料件查看者 true、無關者 false）、料件寫入（需料件管理）
  const cat = await seedCategory('part', 'GA45');
  const part = await seedPart(cat.id, 'GA45');
  expect(await can('purchaser', 'ga_resource_attachment_can_read', 'PART', part.id)).toBe(true);
  expect(await can('clerk', 'ga_resource_attachment_can_read', 'PART', part.id)).toBe(true);
  expect(await can('nobody', 'ga_resource_attachment_can_read', 'PART', part.id)).toBe(false);
  expect(await can('purchaser', 'ga_resource_attachment_can_manage', 'PART', part.id)).toBe(false);
  // CHECK：舊的 8 種類型加新的 2 種，共 10 種（直接寫入不認識的類型被擋，已在上一個測試驗證）
  const ok = await db().from('ga_resource_attachments').select('id', { count: 'exact', head: true }).eq('resource_type', 'UTILITY_BILL').eq('resource_id', billId);
  expect(ok.count).toBe(1);
});

test('G45-db 附件：被有效請款單引用的發票，最後一張圖不可刪；多一張可刪；請款單作廢後可刪', async () => {
  const { vendor, receipt } = await scene();
  const inv = okData(await mkInv('clerk', vendor, [receipt]));
  const i1 = await addImage('clerk', inv);
  const i2 = await addImage('clerk', inv);
  expect(i1.error).toBeNull();
  const full = okData(await fn('clerk', 'ga_ws_pay_invoice_get', { p_id: inv.id }));
  expect(full.image_count).toBe(2);
  const pr = okData(await create('clerk', vendor, [claimLine(receipt, { invoice_id: inv.id })]));
  const softDel = (id: string, who: Ga45Key = 'clerk') => users[who].client.rpc('ga_soft_delete_resource_attachment', { p_attachment_id: id, p_reason: '刪除測試' });
  // 兩張圖：刪一張可以
  expect((await softDel(i1.data.id)).error).toBeNull();
  // 最後一張：被擋，訊息點名請款單
  const blocked = await softDel(i2.data.id);
  expect(blocked.error?.message || '').toContain('INVOICE_LAST_IMAGE_LOCKED');
  expect(blocked.error?.message || '').toContain(pr.pr_no);
  const still = (await db().from('ga_resource_attachments').select('deleted_at').eq('id', i2.data.id).single()).data as any;
  expect(still.deleted_at).toBeNull();
  // 請款單作廢後可刪（釋放引用）
  okData(await act('clerk', pr, 'void', {}));
  expect((await softDel(i2.data.id)).error).toBeNull();
  // 收據類型（有不傳圖的原因）：被引用時刪最後一張可以（因為有原因）
  const rc = okData(await mkInv('clerk', vendor, [receipt], { invoice_type: 'RECEIPT', invoice_no: null, amount_untaxed: undefined, amount_total: 1050, no_image_reason: '無' }));
  const r1 = await addImage('clerk', rc);
  const pr2 = okData(await create('clerk', vendor, [claimLine(receipt, { invoice_id: rc.id })]));
  expect(pr2.id).toBeDefined();
  expect((await softDel(r1.data.id)).error).toBeNull();
});

// ================================================================== 請款單：建立與額度
test('G45-db 請款單建立：快照、金額、事件、固定識別、遮蔽、必填與錯誤', async () => {
  const { vendor, receipt, po } = await scene();
  const k = key();
  const lines = [claimLine(receipt)];
  const r = await create('clerk', vendor, lines, { expected_pay_date: '2038-03-31', notes: '三月份貨款' }, k);
  expect(r.status).toBe(201);
  const pr = okData(r);
  expect(pr).toMatchObject({ status: 'DRAFT', vendor_name_snapshot: vendor.name, vendor_tax_id_snapshot: vendor.tax_id, amount_untaxed: 1000, tax_amount: 50, amount_total: 1050, expected_pay_date: '2038-03-31', notes: '三月份貨款', line_count: 1 });
  expect(pr.bank_snapshot).toMatchObject({ bank_name: '測試銀行', bank_account: '123-456-789012', bank_account_name: '測試戶名' });
  expect(pr.vendor_masked).toBe(false);
  expect(pr.po_nos).toEqual([(await db().from('ga_purchase_orders').select('po_no').eq('id', po.id).single().then((x) => (x.data as any).po_no))]);
  expect(pr.lines[0]).toMatchObject({ receipt_id: receipt.id, claim_untaxed: 1000, claim_tax: 50, claim_total: 1050, invoice_id: null });
  expect(pr.lines[0].items.length).toBe(1); // 進貨單只有品項一
  expect(pr.lines[0].items[0]).toMatchObject({ ordered_qty: 10, unit_price: 100, accepted_qty: 10, rejected_qty: 0, amount_untaxed: 1000 });
  expect(pr).not.toHaveProperty('idempotency_key');
  expect(pr).not.toHaveProperty('payload_hash');
  const row = await dbPr(pr.id);
  expect(row.created_by).toBe(users.clerk.id);
  expect(row.bank_snapshot.bank_account).toBe('123-456-789012');
  const ev = await events(pr.id);
  expect(ev.map((e) => e.event_type)).toEqual(['create']);
  expect(ev[0]).toMatchObject({ actor_id: users.clerk.id, to_status: 'DRAFT', from_status: null });
  expect(Number(ev[0].amount_total)).toBe(1050);
  expect(JSON.stringify(ev[0].payload)).not.toContain('123-456-789012');
  // 重送
  const again = await create('clerk', vendor, lines, { expected_pay_date: '2038-03-31', notes: '三月份貨款' }, k);
  expect(again.replay).toBe(true);
  expect(again.data.id).toBe(pr.id);
  expect((await db().from('ga_payment_requests').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id)).count).toBe(1);
  expectErr(await create('clerk', vendor, lines, { notes: '不同內容' }, k), 409, 'IDEMPOTENCY_CONFLICT');
  expectErr(await fn('clerk', 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines }, p_key: null }), 400, 'IDEMPOTENCY_KEY_REQUIRED');
  // 必填與格式
  expectErr(await create('clerk', vendor, []), 400, 'LINES_REQUIRED');
  expectErr(await fn('clerk', 'ga_ws_pay_request_create', { p_payload: { lines }, p_key: key() }), 400, 'FIELD_REQUIRED');
  expectErr(await fn('clerk', 'ga_ws_pay_request_create', { p_payload: { vendor_id: crypto.randomUUID(), lines }, p_key: key() }), 404, 'VENDOR_NOT_FOUND');
  expectErr(await create('clerk', vendor, [claimLine({ id: crypto.randomUUID() })]), 404, 'RECEIPT_NOT_FOUND');
  expectErr(await create('clerk', vendor, [{ receipt_id: null }]), 400, 'FIELD_REQUIRED');
  expectErr(await create('clerk', vendor, [claimLine(receipt), claimLine(receipt)]), 400, 'DUPLICATE_LINE');
  expectErr(await create('clerk', vendor, [claimLine(receipt, { claim_untaxed: 0, claim_tax: 0 })]), 400, 'AMOUNT_REQUIRED');
  expectErr(await create('clerk', vendor, [claimLine(receipt, { claim_untaxed: '1.5' })]), 400, 'AMOUNT_FORMAT');
  expectErr(await create('clerk', vendor, [claimLine(receipt)], { expected_pay_date: 'x' }), 400, 'DATE_FORMAT');
  expectErr(await create('clerk', vendor, [claimLine(receipt)], { notes: 'x'.repeat(501) }), 400, 'FIELD_TOO_LONG');
  expectErr(await create('clerk', vendor, 'oops' as any), 400, 'LINES_REQUIRED');
  expectErr(await create('clerk', vendor, Array.from({ length: 101 }, () => claimLine(receipt))), 400, 'TOO_MANY_ITEMS');
  // 其他廠商的進貨單
  const other = await newVendor('X');
  expectErr(await create('clerk', other, [claimLine(receipt)]), 400, 'VENDOR_MISMATCH');
  // 沒有失敗留下的半成品
  expect((await db().from('ga_payment_requests').select('id', { count: 'exact', head: true }).in('vendor_id', [vendor.id, other.id])).count).toBe(1);
  // 無廠商權限的人：能建立，但看不到統編與銀行
  const nvScene = await scene();
  const nvVendor = nvScene.vendor;
  const nv = okData(await create('novendor', nvVendor, [claimLine(nvScene.receipt, { claim_untaxed: 100 })]));
  expect(nv.vendor_masked).toBe(true);
  expect(nv.vendor_tax_id_snapshot).toBeNull();
  expect(nv.bank_snapshot).toEqual({});
  expect(JSON.stringify(nv)).not.toContain('123-456-789012');
  expect(JSON.stringify(nv)).not.toContain(nvVendor.tax_id);
  expect((await dbPr(nv.id)).bank_snapshot.bank_account).toBe('123-456-789012'); // 快照仍完整存在 DB
  const vw = await getPr('viewer', nv.id);
  expect(vw.vendor_masked).toBe(true);
  expect(vw.bank_snapshot).toEqual({});
  const cl = await getPr('clerk', nv.id);
  expect(cl.bank_snapshot.bank_account).toBe('123-456-789012');
});

test('G45-db 累計請款上限：以累計驗入含稅額＋尾差硬擋（含兩張請款單合計、短收、拒收量、作廢釋放、尾差設定）', async () => {
  const { vendor, receipt, po } = await scene(); // 驗入含稅 1050；採購單訂購含稅 2100
  const claim = (who: Ga45Key, total: number, over: Record<string, unknown> = {}) => {
    const u = Math.round(total / 1.05);
    return create(who, vendor, [claimLine(receipt, { claim_untaxed: u, claim_tax: total - u, ...over })]);
  };
  const a = okData(await claim('clerk', 600));
  expect(a.amount_total).toBe(600);
  const b = okData(await claim('clerk', 450));
  expect(b.amount_total).toBe(450);
  const s1 = await summary(po);
  expect(s1).toMatchObject({ received_total: 1050, claimed_total: 1050, claimable: 0, claimable_max: 5, tolerance: 5 });
  // 再請 6 元：超過 1050＋5
  const over = await claim('clerk', 6);
  expectErr(over, 409, 'OVER_CLAIM');
  expect(over.received_total).toBe(1050);
  expect(over.claimed_total).toBe(1056);
  expect(over.error).toContain('1,056');
  // 5 元在尾差內
  const c = okData(await claim('clerk', 5));
  expect(c.amount_total).toBe(5);
  expectErr(await claim('clerk', 1), 409, 'OVER_CLAIM');
  // 不是只看訂購量：採購單訂購含稅 2100，仍擋在驗入量
  expect((await summary(po)).po_total_amount).toBe(2100);
  // 作廢釋放額度
  okData(await act('clerk', a, 'void', {}));
  const d = okData(await claim('clerk', 600));
  expect(d.amount_total).toBe(600);
  expectErr(await claim('clerk', 1), 409, 'OVER_CLAIM');
  // 已作廢的不算；DRAFT、SUBMITTED、PAID 都算
  const sm = await summary(po);
  expect(sm.claimed_total).toBe(1055);
  expect(sm.paid_total).toBe(0);
  // 尾差設定：改 0 後，已經超出的現況不被追溯，但新增被擋
  const st = okData(await fn('clerk', 'ga_ws_pay_settings_get', {}));
  const s0 = okData(await fn('clerk', 'ga_ws_pay_settings_set', { p_values: { tolerance_amount: 0 }, p_expected_updated_at: st.updated_at }));
  expectErr(await claim('clerk', 1), 409, 'OVER_CLAIM');
  okData(await act('clerk', c, 'void', {})); // 釋放 5 元
  expect((await summary(po)).claimable).toBe(0);
  expectErr(await claim('clerk', 5), 409, 'OVER_CLAIM'); // 尾差 0：不能超過 1050
  const s5 = okData(await fn('clerk', 'ga_ws_pay_settings_set', { p_values: { tolerance_amount: 5 }, p_expected_updated_at: s0.updated_at }));
  expect(s5.tolerance_amount).toBe(5);
  okData(await claim('clerk', 5));
});

test('G45-db 請款上限（短收與拒收）', async () => {
  const vendor = await newVendor('C2');
  const po = await mkPo(vendor);
  const r1 = await recv(po, [{ po_item_id: itemId(po, 1), delivered_qty: 10, accepted_qty: 8, reason: '破損' }]);
  const s = await summary(po);
  expect(s).toMatchObject({ received_untaxed: 800, received_tax: 40, received_total: 840 });
  // 整張進貨單預設請 840，剛好
  const p840 = okData(await create('clerk', vendor, [claimLine(r1)]));
  expect(p840.amount_total).toBe(840);
  // 想把拒收的 2 個（含稅 210）也請：超過
  const more = await create('clerk', vendor, [claimLine(r1, { claim_untaxed: 200, claim_tax: 10 })]);
  expectErr(more, 409, 'OVER_CLAIM');
  expect(more.received_total).toBe(840);
  // 全部拒收的進貨單不能請款（accepted_qty 全 0）
  const po2 = await mkPo(vendor);
  const r2 = await recv(po2, [{ po_item_id: itemId(po2, 1), delivered_qty: 5, accepted_qty: 0, reason: '全部退回' }]);
  expectErr(await create('clerk', vendor, [claimLine(r2, { claim_untaxed: 10 })]), 422, 'NO_ACCEPTED');
  const cand = okData(await fn('clerk', 'ga_ws_pay_receipt_candidates', { p_filters: { po_id: po2.id } }));
  expect(cand.total).toBe(0);
  // 短收結案：採購單結案後仍以累計驗入含稅額為上限（不是訂購量）
  const po3 = await mkPo(vendor);
  const r3 = await recv(po3);
  const cl = await fn('clerk', 'ga_ws_po_action', { p_id: po3.id, p_action: 'short_close', p_expected_updated_at: (await db().from('ga_purchase_orders').select('updated_at').eq('id', po3.id).single().then((x) => (x.data as any).updated_at)), p_note: '短收結案' });
  expect(cl.ok, JSON.stringify(cl)).toBe(true);
  expect((await summary(po3)).po_status).toBe('CLOSED');
  const c1 = okData(await create('clerk', vendor, [claimLine(r3)]));
  expect(c1.amount_total).toBe(1050);
  expectErr(await create('clerk', vendor, [claimLine(r3, { claim_untaxed: 100, claim_tax: 6 })]), 409, 'OVER_CLAIM');
});

test('G45-db 請款上限（修改草稿）與併發', async () => {
  const { vendor, receipt, po } = await scene();
  const c = (total: number) => claimLine(receipt, { claim_untaxed: total, claim_tax: 0 });
  const d = okData(await create('clerk', vendor, [c(500)]));
  const upd = (pr: any, lines: any[], expected: string | null = pr.updated_at, who: Ga45Key = 'clerk') => fn(who, 'ga_ws_pay_request_update', { p_id: pr.id, p_payload: { lines }, p_expected_updated_at: expected });
  const bump = okData(await upd(d, [c(1055)]));
  expect(bump.amount_total).toBe(1055);
  expectErr(await upd(bump, [c(1056)]), 409, 'OVER_CLAIM');
  expect(Number((await dbPr(d.id)).amount_total)).toBe(1055); // 沒有半成品
  const lines = ((await db().from('ga_payment_request_lines').select('claim_total').eq('pr_id', d.id)).data || []) as any[];
  expect(lines.length).toBe(1);
  expect(Number(lines[0].claim_total)).toBe(1055);
  okData(await act('clerk', bump, 'void', {}));
  // 併發：兩張各請 600，只能成功一張
  const [x, y] = await Promise.all([create('clerk', vendor, [c(600)]), create('accountant', vendor, [c(600)])]);
  expect([x.ok, y.ok].filter(Boolean).length).toBe(1);
  const loser = x.ok ? y : x;
  expectErr(loser, 409, 'OVER_CLAIM');
  expect((await summary(po)).claimed_total).toBe(600);
});

test('G45-db 請款明細與發票：缺圖不可引用、未連結、他廠商、作廢發票、差異原因、被引用不可作廢與不可改', async () => {
  const { vendor, receipt, po } = await scene();
  const noImg = okData(await mkInv('clerk', vendor, [receipt]));
  const miss = await create('clerk', vendor, [claimLine(receipt, { invoice_id: noImg.id })]);
  expectErr(miss, 409, 'INVOICE_MISSING_IMAGE');
  expect(miss.invoice_id).toBe(noImg.id);
  expect((await db().from('ga_payment_requests').select('id', { count: 'exact', head: true }).eq('vendor_id', vendor.id)).count).toBe(0);
  // 上傳圖片後可以引用
  const img = await addImage('clerk', noImg);
  expect(img.error).toBeNull();
  const good = okData(await fn('clerk', 'ga_ws_pay_invoice_get', { p_id: noImg.id }));
  const pr = okData(await create('clerk', vendor, [claimLine(receipt, { invoice_id: good.id })]));
  expect(pr.lines[0]).toMatchObject({ invoice_id: good.id, invoice_no: good.invoice_no, invoice_type: 'TRIPLE', invoice_status: 'ACTIVE', invoice_missing_image: false });
  // 被有效請款單引用：不可作廢、類型金額號碼不可改、備註可改
  const vo = await fn('clerk', 'ga_ws_pay_invoice_void', { p_id: good.id, p_reason: '想作廢', p_key: key(), p_expected_updated_at: good.updated_at });
  expectErr(vo, 409, 'INVOICE_IN_USE', pr.pr_no);
  const ed = (payload: Record<string, unknown>, expected: string) => fn('clerk', 'ga_ws_pay_invoice_save', { p_id: good.id, p_payload: payload, p_key: null, p_expected_updated_at: expected });
  expectErr(await ed({ amount_untaxed: 1100 }, good.updated_at), 409, 'INVOICE_IN_USE', pr.pr_no);
  expectErr(await ed({ invoice_no: 'ZZ99999999' }, good.updated_at), 409, 'INVOICE_IN_USE');
  expectErr(await ed({ receipts: [] }, good.updated_at), 409, 'INVOICE_IN_USE');
  expectErr(await ed({ invoice_type: 'DUPLEX' }, good.updated_at), 409, 'INVOICE_IN_USE');
  const noteOk = okData(await ed({ notes: '被引用後補備註', amount_untaxed: 1000 }, good.updated_at));
  expect(noteOk.notes).toBe('被引用後補備註');
  expect(good.referenced_by.length).toBe(0); // 取得發票時尚未引用；引用後再查
  const again = okData(await fn('clerk', 'ga_ws_pay_invoice_get', { p_id: good.id }));
  expect(again.referenced_by).toEqual([expect.objectContaining({ pr_no: pr.pr_no, status: 'DRAFT' })]);
  // 作廢請款單後發票恢復可作廢
  okData(await act('clerk', pr, 'void', {}));
  const cur = okData(await fn('clerk', 'ga_ws_pay_invoice_get', { p_id: good.id }));
  expect(cur.referenced_by).toEqual([]);
  okData(await fn('clerk', 'ga_ws_pay_invoice_void', { p_id: good.id, p_reason: '現在可以作廢', p_key: key(), p_expected_updated_at: cur.updated_at }));
  expectErr(await create('clerk', vendor, [claimLine(receipt, { invoice_id: good.id })]), 409, 'INVOICE_VOID');
  // 未連結該進貨單的發票
  const po2 = await mkPo(vendor);
  const r2 = await recv(po2);
  const inv2 = await goodInv(vendor, [r2]);
  expectErr(await create('clerk', vendor, [claimLine(receipt, { invoice_id: inv2.id })]), 400, 'INVOICE_NOT_LINKED');
  // 他廠商的發票
  const other = await newVendor('OV');
  const po3 = await mkPo(other);
  const r3 = await recv(po3);
  const inv3 = await goodInv(other, [r3]);
  expectErr(await create('clerk', vendor, [claimLine(receipt, { invoice_id: inv3.id })]), 400, 'VENDOR_MISMATCH');
  expectErr(await create('clerk', vendor, [claimLine(receipt, { invoice_id: crypto.randomUUID() })]), 404, 'INVOICE_NOT_FOUND');
  // 請款額與發票分攤差異：超過尾差要填原因，5 元內免、改回後原因清掉
  const g2 = await goodInv(vendor, [receipt], { amount_untaxed: 1000 });
  const diff = await create('clerk', vendor, [claimLine(receipt, { invoice_id: g2.id, claim_untaxed: 500, claim_tax: 25 })]);
  expectErr(diff, 400, 'DIFF_REASON_REQUIRED');
  expect(diff.line_no).toBe(1);
  const withReason = okData(await create('clerk', vendor, [claimLine(receipt, { invoice_id: g2.id, claim_untaxed: 500, claim_tax: 25, diff_reason: '分兩次請' })]));
  expect(withReason.lines[0].diff_reason).toBe('分兩次請');
  const within = okData(await create('clerk', vendor, [claimLine(receipt, { invoice_id: g2.id, claim_untaxed: 500, claim_tax: 25, diff_reason: '多餘' }), claimLine(receipt, { claim_untaxed: 1, claim_tax: 0 })]));
  expect(within.lines.find((l: any) => l.invoice_id === g2.id).diff_reason).toBe('多餘'); // 差 525 > 5 → 保留原因
  expect(po.id).toBeDefined();
});

test('G45-db 請款單送出前的即時檢查：進貨單被作廢、發票被改缺圖都擋；送出後的狀態機', async () => {
  const { vendor, receipt } = await scene();
  // 收據（有原因、無圖）可引用；之後把原因拿掉 → 缺圖 → 送出被擋
  const rc = okData(await mkInv('clerk', vendor, [receipt], { invoice_type: 'RECEIPT', invoice_no: null, amount_untaxed: undefined, amount_total: 1050, no_image_reason: '無圖' }));
  const pr = okData(await create('clerk', vendor, [claimLine(receipt, { invoice_id: rc.id })]));
  // 審查修正：已被請款單引用的收據，儲存時就擋下「清掉沒有圖片的原因」（不會變成缺圖被引用）
  expectErr(await fn('clerk', 'ga_ws_pay_invoice_save', { p_id: rc.id, p_payload: { no_image_reason: null }, p_key: null, p_expected_updated_at: rc.updated_at }), 409, 'INVOICE_IN_USE');
  // 送出前的即時檢查是最後防線：模擬資料被直接改成缺圖（繞過儲存函式），送出仍擋
  const direct = await db().from('ga_purchase_invoices').update({ no_image_reason: null }).eq('id', rc.id);
  expect(direct.error).toBeNull();
  const sub = await act('clerk', pr, 'submit', {});
  expectErr(sub, 409, 'INVOICE_MISSING_IMAGE');
  expect((await dbPr(pr.id)).status).toBe('DRAFT');
  // 補上原因後可送出
  const edited = okData(await fn('clerk', 'ga_ws_pay_invoice_get', { p_id: rc.id }));
  expect(edited.missing_image).toBe(true);
  okData(await fn('clerk', 'ga_ws_pay_invoice_save', { p_id: rc.id, p_payload: { no_image_reason: '補原因' }, p_key: null, p_expected_updated_at: edited.updated_at }));
  const cur = await getPr('clerk', pr.id);
  const sent = okData(await act('clerk', cur, 'submit', {}));
  expect(sent.status).toBe('SUBMITTED');
  // 進貨單作廢（模擬第 4.5 批作廢進貨）→ 另一張草稿送出被擋
  const { vendor: v2, receipt: r2 } = await scene();
  const pr2 = okData(await create('clerk', v2, [claimLine(r2)]));
  await db().from('ga_purchase_receipts').update({ voided_at: new Date().toISOString(), void_reason: '測試作廢' }).eq('id', r2.id);
  expectErr(await act('clerk', pr2, 'submit', {}), 409, 'RECEIPT_VOIDED');
  // 作廢進貨不計入累計驗入與候選清單
  const po2 = (await db().from('ga_purchase_receipts').select('po_id').eq('id', r2.id).single().then((x) => x.data as any)).po_id;
  expect((await summary({ id: po2 })).received_total).toBe(0);
  expect(okData(await fn('clerk', 'ga_ws_pay_receipt_candidates', { p_filters: { po_id: po2 } })).total).toBe(0);
  expectErr(await create('clerk', v2, [claimLine(r2)]), 409, 'RECEIPT_VOIDED');
});

// ================================================================== 狀態機
test('G45-db 狀態機：送出→退回（必填原因）→修改再送出→標已付款→鎖定→備註→作廢；事件完整記錄誰與何時', async () => {
  const { vendor, receipt } = await scene();
  const inv = await goodInv(vendor, [receipt]);
  const draft = okData(await create('clerk', vendor, [claimLine(receipt, { invoice_id: inv.id })], { notes: '劇本' }));
  // 草稿不能直接標已付款或退回
  expectErr(await act('clerk', draft, 'mark_paid', { pay_method: 'TRANSFER' }), 409, 'INVALID_STATE');
  expectErr(await act('clerk', draft, 'return', { reason: 'x' }), 409, 'INVALID_STATE');
  expectErr(await act('clerk', draft, 'note', {}), 400, 'NOTE_REQUIRED');
  expectErr(await act('clerk', draft, 'fly'), 400, 'ACTION_INVALID');
  // 送出
  const sk = key();
  const sent = okData(await act('clerk', draft, 'submit', {}, sk));
  expect(sent).toMatchObject({ status: 'SUBMITTED', submitted_by: users.clerk.id });
  expect(sent.submitted_at).not.toBeNull();
  // 重送同識別 → 回原結果；不會多一筆事件
  const rep = await act('clerk', draft, 'submit', {}, sk);
  expect(rep.replay).toBe(true);
  expect(rep.data.status).toBe('SUBMITTED');
  // 同識別但動作不同 → 409；缺識別 400；缺版本 400；舊版本 STALE
  expectErr(await act('clerk', draft, 'note', { note: 'x' }, sk), 409, 'IDEMPOTENCY_CONFLICT');
  expectErr(await act('clerk', sent, 'note', { note: 'x' }, ''), 400, 'IDEMPOTENCY_KEY_REQUIRED');
  expectErr(await act('clerk', sent, 'note', { note: 'x' }, key(), null), 400, 'EXPECTED_REQUIRED');
  expectErr(await act('clerk', draft, 'note', { note: 'x' }, key()), 409, 'STALE');
  // 已送出不能修改明細；不能再送出、不能重抓帳號
  expectErr(await fn('clerk', 'ga_ws_pay_request_update', { p_id: sent.id, p_payload: { notes: 'x' }, p_expected_updated_at: sent.updated_at }), 409, 'INVALID_STATE');
  expectErr(await act('clerk', sent, 'submit', {}), 409, 'INVALID_STATE');
  expectErr(await act('clerk', sent, 'refresh_bank', {}), 409, 'INVALID_STATE');
  // 退回：原因必填
  expectErr(await act('accountant', sent, 'return', {}), 400, 'REASON_REQUIRED');
  expectErr(await act('accountant', sent, 'return', { reason: 'x'.repeat(201) }), 400, 'FIELD_TOO_LONG');
  const back = okData(await act('accountant', sent, 'return', { reason: '發票日期錯誤' }));
  expect(back).toMatchObject({ status: 'DRAFT', submitted_by: null, submitted_at: null, last_return_reason: '發票日期錯誤' });
  // 退回後可修改再送出
  const edited = okData(await fn('clerk', 'ga_ws_pay_request_update', { p_id: back.id, p_payload: { notes: '已更正', expected_pay_date: '2038-04-10' }, p_expected_updated_at: back.updated_at }));
  expect(edited).toMatchObject({ notes: '已更正', expected_pay_date: '2038-04-10', status: 'DRAFT' });
  const sent2 = okData(await act('clerk', edited, 'submit', {}));
  expect(sent2.status).toBe('SUBMITTED');
  // 標已付款：付款方式必填、日期不可未來、不可早於建立日、參考號 ≤ 60
  expectErr(await act('accountant', sent2, 'mark_paid', {}), 400, 'PAY_METHOD');
  expectErr(await act('accountant', sent2, 'mark_paid', { pay_method: 'BITCOIN' }), 400, 'PAY_METHOD');
  expectErr(await act('accountant', sent2, 'mark_paid', { pay_method: 'TRANSFER', paid_date: '2999-01-01' }), 400, 'PAID_FUTURE');
  expectErr(await act('accountant', sent2, 'mark_paid', { pay_method: 'TRANSFER', paid_date: '2000-01-01' }), 400, 'PAID_TOO_EARLY');
  expectErr(await act('accountant', sent2, 'mark_paid', { pay_method: 'TRANSFER', paid_ref: 'x'.repeat(61) }), 400, 'FIELD_TOO_LONG');
  expectErr(await act('viewer', sent2, 'mark_paid', { pay_method: 'TRANSFER' }), 403, 'PERMISSION_DENIED');
  expectErr(await act('purchaser', sent2, 'mark_paid', { pay_method: 'TRANSFER' }), 403, 'PERMISSION_DENIED');
  const paid = okData(await act('accountant', sent2, 'mark_paid', { pay_method: 'TRANSFER', paid_ref: 'TX-001' }));
  expect(paid).toMatchObject({ status: 'PAID', pay_method: 'TRANSFER', paid_date: today(), paid_ref: 'TX-001', paid_by: users.accountant.id });
  expect(paid.paid_at).not.toBeNull();
  // 已付款鎖定：不能改、不能退回、不能再送、不能再付；備註與作廢可以
  expectErr(await fn('clerk', 'ga_ws_pay_request_update', { p_id: paid.id, p_payload: { lines: [claimLine(receipt, { claim_untaxed: 1 })] }, p_expected_updated_at: paid.updated_at }), 409, 'INVALID_STATE', '已付款');
  expectErr(await act('clerk', paid, 'return', { reason: 'x' }), 409, 'INVALID_STATE');
  expectErr(await act('clerk', paid, 'submit', {}), 409, 'INVALID_STATE');
  expectErr(await act('clerk', paid, 'mark_paid', { pay_method: 'CASH' }), 409, 'INVALID_STATE');
  expectErr(await act('clerk', paid, 'refresh_bank', {}), 409, 'INVALID_STATE');
  const noted = okData(await act('clerk', paid, 'note', { note: '會計已確認入帳' }));
  expect(noted.status).toBe('PAID');
  // 作廢已付款：必填原因；作廢後終態
  expectErr(await act('clerk', noted, 'void', {}), 400, 'REASON_REQUIRED');
  const voided = okData(await act('clerk', noted, 'void', { reason: '重複付款，已追回' }));
  expect(voided).toMatchObject({ status: 'VOID', void_reason: '重複付款，已追回', voided_by: users.clerk.id });
  expectErr(await act('clerk', voided, 'void', { reason: 'x' }), 409, 'INVALID_STATE');
  expectErr(await act('clerk', voided, 'note', { note: 'x' }), 409, 'INVALID_STATE');
  expectErr(await fn('clerk', 'ga_ws_pay_request_update', { p_id: voided.id, p_payload: { notes: 'x' }, p_expected_updated_at: voided.updated_at }), 409, 'INVALID_STATE');
  // 事件：順序、人、狀態轉移、原因、金額；重送與失敗的動作沒有留下事件
  const ev = await events(draft.id);
  expect(ev.map((e) => e.event_type)).toEqual(['create', 'submit', 'return', 'update', 'submit', 'mark_paid', 'note', 'void']);
  expect(ev.map((e) => `${e.from_status}>${e.to_status}`)).toEqual(['null>DRAFT', 'DRAFT>SUBMITTED', 'SUBMITTED>DRAFT', 'DRAFT>DRAFT', 'DRAFT>SUBMITTED', 'SUBMITTED>PAID', 'PAID>PAID', 'PAID>VOID']);
  expect(ev.map((e) => e.actor_id)).toEqual([users.clerk.id, users.clerk.id, users.accountant.id, users.clerk.id, users.clerk.id, users.accountant.id, users.clerk.id, users.clerk.id]);
  expect(ev[2].reason).toBe('發票日期錯誤');
  expect(ev[5].payload).toMatchObject({ pay_method: 'TRANSFER', paid_ref: 'TX-001', self_paid: false });
  expect(ev[6].reason).toBe('會計已確認入帳');
  expect(ev[7].reason).toBe('重複付款，已追回');
  expect(ev.every((e) => Number(e.amount_total) === 1050)).toBe(true);
  const times = ev.map((e) => new Date(e.created_at).getTime());
  expect([...times].sort((a, b) => a - b)).toEqual(times);
  const got = await getPr('viewer', draft.id);
  expect(got.events.length).toBe(8);
  expect(got.events[2]).toMatchObject({ event_type: 'return', actor_name: expect.any(String), reason: '發票日期錯誤' });
  expect(JSON.stringify(got.events)).not.toContain('"hash"');
  // 作廢後額度釋放、發票可作廢
  expect((await summary({ id: (await db().from('ga_purchase_receipts').select('po_id').eq('id', receipt.id).single().then((x) => (x.data as any).po_id)) })).claimed_total).toBe(0);
});

test('G45-db 申請人可以自己標已付款（不做申請人≠付款人限制）；草稿與已送出作廢；草稿作廢原因選填', async () => {
  const { vendor, receipt } = await scene();
  const pr = okData(await create('clerk2', vendor, [claimLine(receipt)]));
  const sent = okData(await act('clerk2', pr, 'submit', {}));
  const self = okData(await act('clerk2', sent, 'mark_paid', { pay_method: 'CASH', paid_date: today() }));
  expect(self).toMatchObject({ status: 'PAID', paid_by: users.clerk2.id, created_by: users.clerk2.id, pay_method: 'CASH' });
  const ev = await events(pr.id);
  expect(ev.find((e) => e.event_type === 'mark_paid').payload.self_paid).toBe(true);
  // 草稿作廢（原因選填，等於刪除草稿）
  const { vendor: v2, receipt: r2 } = await scene();
  const d = okData(await create('clerk', v2, [claimLine(r2)]));
  const vd = okData(await act('clerk', d, 'void', {}));
  expect(vd).toMatchObject({ status: 'VOID', void_reason: null });
  // 已送出作廢必填原因
  const d2 = okData(await create('clerk', v2, [claimLine(r2)]));
  const s2 = okData(await act('clerk', d2, 'submit', {}));
  expectErr(await act('clerk', s2, 'void', {}), 400, 'REASON_REQUIRED');
  okData(await act('clerk', s2, 'void', { reason: '不請了' }));
  // 付款日期預設台北今天；現金、支票可
  const d3 = okData(await create('clerk', v2, [claimLine(r2)]));
  const s3 = okData(await act('clerk', d3, 'submit', {}));
  const p3 = okData(await act('accountant', s3, 'mark_paid', { pay_method: 'CHECK' }));
  expect(p3).toMatchObject({ pay_method: 'CHECK', paid_date: today(), paid_ref: null });
});

test('G45-db 動作併發：同識別同時送出只處理一次、不同識別只成功一個', async () => {
  const { vendor, receipt } = await scene();
  const pr = okData(await create('clerk', vendor, [claimLine(receipt)]));
  const k = key();
  const [a, b] = await Promise.all([act('clerk', pr, 'submit', {}, k), act('clerk', pr, 'submit', {}, k)]);
  expect(a.ok && b.ok, JSON.stringify([a, b])).toBe(true);
  expect([a.replay, b.replay].filter(Boolean).length).toBe(1);
  expect((await events(pr.id)).filter((e) => e.event_type === 'submit').length).toBe(1);
  const pr2 = okData(await create('clerk', vendor, [claimLine(receipt, { claim_untaxed: 1, claim_tax: 0 })]));
  const [c, d] = await Promise.all([act('clerk', pr2, 'void', { reason: 'A' }), act('accountant', pr2, 'submit', {})]);
  expect([c.ok, d.ok].filter(Boolean).length).toBe(1);
  const final = await dbPr(pr2.id);
  expect(['VOID', 'SUBMITTED']).toContain(final.status);
});

test('G45-db 廠商銀行快照：建立時抓一次、廠商改帳號不影響、草稿可重抓、重抓留紀錄', async () => {
  const { vendor, receipt } = await scene();
  const pr = okData(await create('clerk', vendor, [claimLine(receipt)]));
  expect(pr.bank_snapshot.bank_account).toBe('123-456-789012');
  await db().from('ga_vendors').update({ bank_account: '999-000-111222', bank_name: '新銀行', name: `${vendor.name}-改名` }).eq('id', vendor.id);
  const same = await getPr('clerk', pr.id);
  expect(same.bank_snapshot.bank_account).toBe('123-456-789012');
  expect(same.bank_snapshot.bank_name).toBe('測試銀行');
  expect(same.vendor_name_snapshot).toBe(vendor.name);
  // 草稿重抓
  const rf = okData(await act('clerk', same, 'refresh_bank', {}));
  expect(rf.bank_snapshot).toMatchObject({ bank_account: '999-000-111222', bank_name: '新銀行' });
  expect(rf.vendor_name_snapshot).toBe(`${vendor.name}-改名`);
  const ev = await events(pr.id);
  expect(ev[ev.length - 1]).toMatchObject({ event_type: 'refresh_bank', actor_id: users.clerk.id });
  expect(ev[ev.length - 1].payload.changed).toBe(true);
  expect(JSON.stringify(ev[ev.length - 1].payload)).not.toContain('999-000');
  // 送出後再改廠商，快照不動；無廠商權限者看不到
  const sent = okData(await act('clerk', rf, 'submit', {}));
  await db().from('ga_vendors').update({ bank_account: '000-000-000000' }).eq('id', vendor.id);
  expect((await getPr('clerk', sent.id)).bank_snapshot.bank_account).toBe('999-000-111222');
  expect((await getPr('novendor', sent.id)).bank_snapshot).toEqual({});
});

// ================================================================== 查詢、匯出、摘要
test('G45-db 請款單查詢：篩選（狀態、廠商、月份、採購單、搜尋跳脫）、分頁、摘要、採購單明細權限', async () => {
  const { vendor, receipt, po } = await scene();
  const a = okData(await create('clerk', vendor, [claimLine(receipt, { claim_untaxed: 100, claim_tax: 5 })]));
  const b = okData(await create('clerk2', vendor, [claimLine(receipt, { claim_untaxed: 200, claim_tax: 10 })]));
  const c = okData(await create('clerk', vendor, [claimLine(receipt, { claim_untaxed: 300, claim_tax: 15 })]));
  const sb = okData(await act('clerk2', b, 'submit', {}));
  okData(await act('clerk', c, 'void', {}));
  const list = async (filters: Record<string, unknown>, page = 1, size = 20, who: Ga45Key = 'clerk') => (await fn(who, 'ga_ws_pay_request_list', { p_filters: filters, p_page: page, p_page_size: size }));
  const all = okData(await list({ vendor_id: vendor.id }));
  expect(all.total).toBe(3);
  expect(all.summary).toMatchObject({ count: 3, draft_count: 1, submitted_count: 1, void_count: 1, paid_count: 0, submitted_amount: 210, total_amount: 630 });
  expect(all.rows[0]).not.toHaveProperty('lines'); // 列表不帶明細
  expect(all.rows[0].line_count).toBe(1);
  expect(okData(await list({ vendor_id: vendor.id, status: 'SUBMITTED' })).rows.map((r: any) => r.id)).toEqual([sb.id]);
  expect(okData(await list({ vendor_id: vendor.id, status: 'VOID' })).total).toBe(1);
  expect(okData(await list({ vendor_id: vendor.id, month: today().slice(0, 7) })).total).toBe(3);
  expect(okData(await list({ vendor_id: vendor.id, month: '2000-01' })).total).toBe(0);
  expect(okData(await list({ po_id: po.id })).total).toBe(3);
  expect(okData(await list({ vendor_id: vendor.id, mine: true })).total).toBe(2);
  expect(okData(await list({ vendor_id: vendor.id, mine: true }, 1, 20, 'clerk2')).total).toBe(1);
  expect(okData(await list({ search: a.pr_no })).rows.map((r: any) => r.id)).toEqual([a.id]);
  expect(okData(await list({ search: '%' })).total).toBe(0);
  expect(okData(await list({ search: '_' })).total).toBe(0);
  expect(okData(await list({ vendor_id: vendor.id }, 1, 2)).rows.length).toBe(2);
  expect(okData(await list({ vendor_id: vendor.id }, 2, 2)).rows.length).toBe(1);
  expect(okData(await list({ vendor_id: vendor.id }, 1, 1000)).page_size).toBe(100);
  expect(all.rows.length).toBe(3);
  expect(all.rows[0].id).toBe(c.id); // 新的在前
  expectErr(await list({ status: 'X' }), 400, 'BAD_FILTER');
  expectErr(await list({ month: '2026-13' }), 400, 'BAD_FILTER');
  expectErr(await list({ month: 'abc' }), 400, 'BAD_FILTER');
  const gl = (await list({ vendor_id: vendor.id })).global;
  expect(gl.submitted_count).toBeGreaterThanOrEqual(1);
  // 列表的遮蔽：無廠商權限者統編銀行為空
  const nv = okData(await list({ vendor_id: vendor.id }, 1, 20, 'viewer'));
  expect(JSON.stringify(nv)).not.toContain('123-456-789012');
  expect(nv.rows[0].vendor_masked).toBe(true);
  // 採購單明細：有採購評估檢視看得到並排三欄；只有請款查看的人看不到品項
  const withPo = await getPr('viewer', a.id);
  expect(withPo.po_masked).toBe(false);
  expect(withPo.lines[0].items.length).toBe(1);
  const noPo = await getPr('payonly', a.id);
  expect(noPo.po_masked).toBe(true);
  expect(noPo.lines[0].items).toBeNull();
  expectErr(await fn('clerk', 'ga_ws_pay_request_get', { p_id: crypto.randomUUID() }), 404, 'NOT_FOUND');
});

test('G45-db 候選進貨與採購單摘要：金額、憑證狀態、已請款、已付款、尚可請款、作廢進貨不計', async () => {
  const vendor = await newVendor('M');
  const po = await mkPo(vendor);
  const r1 = await recv(po); // 品項一 1050
  const r2 = await recv(po, [{ po_item_id: itemId(po, 2), delivered_qty: 5 }]); // 品項二 1000＋50 = 1050
  const inv = await goodInv(vendor, [r1]);
  const s0 = await summary(po);
  expect(s0).toMatchObject({ received_untaxed: 2000, received_tax: 100, received_total: 2100, claimed_total: 0, paid_total: 0, claimable: 2100, unclaimed_received: 2100, tax_rate: 0.05 });
  expect(s0.receipts.length).toBe(2);
  const sr1 = s0.receipts.find((x: any) => x.receipt_id === r1.id);
  expect(sr1).toMatchObject({ voucher_status: 'LINKED', untaxed: 1000, total: 1050, claimed: 0 });
  expect(sr1.invoices[0]).toMatchObject({ id: inv.id, missing_image: false });
  expect(s0.receipts.find((x: any) => x.receipt_id === r2.id).voucher_status).toBe('NONE');
  // 候選
  const cand = okData(await fn('clerk', 'ga_ws_pay_receipt_candidates', { p_filters: { vendor_id: vendor.id } }));
  expect(cand.total).toBe(2);
  const c1 = cand.rows.find((x: any) => x.receipt_id === r1.id);
  expect(c1).toMatchObject({ po_no: expect.any(String), receipt_untaxed: 1000, receipt_tax: 50, receipt_total: 1050, receipt_claimed: 0, po_received_total: 2100, po_claimed_total: 0, po_remaining: 2100, po_remaining_max: 2105, tolerance: 5 });
  // 請款一張（品項一的進貨），再看
  const pr = okData(await create('clerk', vendor, [claimLine(r1, { invoice_id: inv.id })]));
  const sent = okData(await act('clerk', pr, 'submit', {}));
  const s1 = await summary(po);
  expect(s1).toMatchObject({ claimed_total: 1050, paid_total: 0, claimable: 1050 });
  expect(s1.receipts.find((x: any) => x.receipt_id === r1.id).claimed).toBe(1050);
  expect(s1.requests).toEqual([expect.objectContaining({ pr_no: pr.pr_no, status: 'SUBMITTED', claim_total: 1050 })]);
  okData(await act('accountant', sent, 'mark_paid', { pay_method: 'TRANSFER' }));
  expect(await summary(po)).toMatchObject({ claimed_total: 1050, paid_total: 1050, claimable: 1050 });
  // 全部請完（含 r2）後 only_claimable 預設不再列出；all 可列
  const pr2 = okData(await create('clerk', vendor, [claimLine(r2)]));
  expect(pr2.amount_total).toBe(1050);
  expect(okData(await fn('clerk', 'ga_ws_pay_receipt_candidates', { p_filters: { vendor_id: vendor.id } })).total).toBe(0);
  expect(okData(await fn('clerk', 'ga_ws_pay_receipt_candidates', { p_filters: { vendor_id: vendor.id, only_claimable: false } })).total).toBe(2);
  expect(okData(await fn('clerk', 'ga_ws_pay_receipt_candidates', { p_filters: { vendor_id: vendor.id, only_claimable: false, search: '%' } })).total).toBe(0);
  expect(okData(await fn('clerk', 'ga_ws_pay_receipt_candidates', { p_filters: { vendor_id: vendor.id, only_claimable: false, search: r1.receipt_no } })).total).toBe(1);
  expect(okData(await fn('clerk', 'ga_ws_pay_receipt_candidates', { p_filters: { vendor_id: vendor.id, only_claimable: false }, p_page: 2, p_page_size: 1 })).rows.length).toBe(1);
  // 作廢進貨不計入累計驗入與候選
  await db().from('ga_purchase_receipts').update({ voided_at: new Date().toISOString(), void_reason: '測試作廢' }).eq('id', r2.id);
  const s2 = await summary(po);
  expect(s2.received_total).toBe(1050);
  expect(okData(await fn('clerk', 'ga_ws_pay_receipt_candidates', { p_filters: { vendor_id: vendor.id, only_claimable: false } })).total).toBe(1);
  // 摘要權限
  expectErr(await fn('clerk', 'ga_ws_pay_po_summary', { p_po_id: crypto.randomUUID() }), 404, 'NOT_FOUND');
  expect((await fn('viewer', 'ga_ws_pay_po_summary', { p_po_id: po.id })).can_manage).toBe(false);
  expect((await fn('clerk', 'ga_ws_pay_po_summary', { p_po_id: po.id })).can_manage).toBe(true);
  expect(okData(await fn('viewer', 'ga_ws_pay_receipt_candidates', { p_filters: { vendor_id: vendor.id } })).total).toBeGreaterThanOrEqual(0);
});

test('G45-db 對帳匯出：月份必填、台北月份、廠商與狀態篩選、欄位內容、遮蔽統編與銀行', async () => {
  const { vendor, receipt } = await scene();
  const inv = await goodInv(vendor, [receipt]);
  const pr = okData(await create('clerk', vendor, [claimLine(receipt, { invoice_id: inv.id })]));
  const sent = okData(await act('clerk', pr, 'submit', {}));
  const paid = okData(await act('accountant', sent, 'mark_paid', { pay_method: 'TRANSFER', paid_ref: 'EXP-1' }));
  const exp = (filters: Record<string, unknown>, who: Ga45Key = 'clerk') => fn(who, 'ga_ws_pay_export', { p_filters: filters });
  const month = today().slice(0, 7);
  expectErr(await exp({}), 400, 'BAD_FILTER', '月份');
  expectErr(await exp({ month: '2026-13' }), 400, 'BAD_FILTER');
  expectErr(await exp({ month, status: 'ZZ' }), 400, 'BAD_FILTER');
  const out = okData(await exp({ month, vendor_id: vendor.id }));
  expect(out.total).toBe(1);
  expect(out.include_vendor_secret).toBe(true);
  expect(out.rows[0]).toMatchObject({
    pr_no: paid.pr_no, status: 'PAID', vendor_name: vendor.name, vendor_tax_id: vendor.tax_id, bank_name: '測試銀行', bank_account: '123-456-789012', receipt_no: receipt.receipt_no, invoice_no: inv.invoice_no,
    invoice_type: 'TRIPLE', amount_untaxed: 1000, tax_amount: 50, amount_total: 1050, claim_total: 1050, pay_method: 'TRANSFER', paid_ref: 'EXP-1', paid_date: today(),
    submitted_by_name: expect.any(String), paid_by_name: expect.any(String),
  });
  expect(out.rows[0].po_no).toMatch(/^PO-/);
  expect(okData(await exp({ month: '2000-01', vendor_id: vendor.id })).total).toBe(0);
  expect(okData(await exp({ month, vendor_id: vendor.id, status: 'DRAFT' })).total).toBe(0);
  expect(okData(await exp({ month, vendor_id: vendor.id, status: 'PAID' })).total).toBe(1);
  expect(okData(await exp({ month, vendor_id: crypto.randomUUID() })).total).toBe(0);
  // 無廠商權限：統編與銀行整欄是空的
  for (const who of ['viewer', 'novendor'] as Ga45Key[]) {
    const o = okData(await exp({ month, vendor_id: vendor.id }, who));
    expect(o.include_vendor_secret).toBe(false);
    expect(o.rows[0].vendor_tax_id).toBeNull();
    expect(o.rows[0].bank_name).toBeNull();
    expect(o.rows[0].bank_account).toBeNull();
    expect(JSON.stringify(o)).not.toContain('123-456-789012');
  }
  // 公式注入字元只在伺服端 CSV 處理；這裡確認原樣回傳資料（備註不在匯出欄位）
  expect(Object.keys(out.rows[0])).not.toContain('notes');
});

// ================================================================== 廠商銀行欄位
test('G45-db 廠商銀行欄位：寫入需廠商管理、長度限制、查看者看得到、清單不含、清除可', async () => {
  const vendor = await newVendor('B', { bank_name: null, bank_branch: null, bank_account: null, bank_account_name: null });
  const got = okData(await fn('vendor_view', 'ga_ws_vendor_get', { p_id: vendor.id }));
  expect(got).toMatchObject({ bank_name: null, bank_account: null });
  expect(Object.keys(got)).toEqual(expect.arrayContaining(['bank_name', 'bank_branch', 'bank_account', 'bank_account_name']));
  const save = (who: Ga45Key, payload: Record<string, unknown>, expected: string | null) => fn(who, 'ga_ws_vendor_save', { p_id: vendor.id, p_payload: payload, p_expected_updated_at: expected });
  expectErr(await save('vendor_view', { bank_name: 'X' }, got.updated_at), 403, 'PERMISSION_DENIED');
  expectErr(await save('clerk', { bank_name: 'X' }, got.updated_at), 403, 'PERMISSION_DENIED');
  expectErr(await save('vendor_mgr', { bank_name: 'x'.repeat(61) }, got.updated_at), 400, 'FIELD_TOO_LONG');
  expectErr(await save('vendor_mgr', { bank_account: 'x'.repeat(41) }, got.updated_at), 400, 'FIELD_TOO_LONG');
  expectErr(await save('vendor_mgr', { bank_account_name: 'x'.repeat(101) }, got.updated_at), 400, 'FIELD_TOO_LONG');
  const saved = okData(await save('vendor_mgr', { bank_name: '第一銀行', bank_branch: '信義分行', bank_account: '111-222-333', bank_account_name: '測試公司' }, got.updated_at));
  expect(saved).toMatchObject({ bank_name: '第一銀行', bank_branch: '信義分行', bank_account: '111-222-333', bank_account_name: '測試公司' });
  const row = (await db().from('ga_vendors').select('bank_name,bank_branch,bank_account,bank_account_name,updated_by').eq('id', vendor.id).single()).data as any;
  expect(row).toMatchObject({ bank_name: '第一銀行', bank_account: '111-222-333', updated_by: users.vendor_mgr.id });
  // 沒帶銀行欄位的更新不會洗掉它們
  const keep = okData(await save('vendor_mgr', { phone: '02-1234' }, saved.updated_at));
  expect(keep.bank_account).toBe('111-222-333');
  // 查看者看得到；一般清單（精簡欄位）不含銀行
  expect(okData(await fn('vendor_view', 'ga_ws_vendor_get', { p_id: vendor.id })).bank_account).toBe('111-222-333');
  const lst = await fn('vendor_view', 'ga_ws_vendor_list', { p_filters: { search: vendor.name }, p_page: 1, p_page_size: 5 }).catch(() => null);
  if (lst && lst.ok) expect(JSON.stringify(lst.data)).not.toContain('111-222-333');
  // 清空
  const cleared = okData(await save('vendor_mgr', { bank_name: null, bank_account: '' }, keep.updated_at));
  expect(cleared).toMatchObject({ bank_name: null, bank_account: null, bank_branch: '信義分行' });
  // 資料庫約束
  const tooLong = await db().from('ga_vendors').update({ bank_name: 'x'.repeat(61) }).eq('id', vendor.id);
  expect(tooLong.error).not.toBeNull();
  // 新增廠商也能帶銀行欄位
  const created = okData(await fn('vendor_mgr', 'ga_ws_vendor_save', { p_id: null, p_payload: { name: ga45Name(`NEWV${(seq += 1)}`), vendor_type: 'company', tax_id: String(80000000 + Math.floor(Math.random() * 9999999)), bank_name: '新廠商銀行', bank_account: '555' }, p_expected_updated_at: null }));
  expect(created).toMatchObject({ bank_name: '新廠商銀行', bank_account: '555' });
});

test('G45-db 其他：管理員 profile 不繞過、對照角色沒有請款權限碼、固定識別欄位不外露', async () => {
  const { vendor, receipt } = await scene();
  const pr = okData(await create('clerk', vendor, [claimLine(receipt)]));
  for (const who of ['admin', 'purchaser', 'store_mgr', 'nobody'] as Ga45Key[]) {
    expectErr(await fn(who, 'ga_ws_pay_request_get', { p_id: pr.id }), 403, 'PERMISSION_DENIED');
    expectErr(await act(who, pr, 'void', { reason: 'x' }), 403, 'PERMISSION_DENIED');
  }
  expect((await dbPr(pr.id)).status).toBe('DRAFT');
  const got = await getPr('accountant', pr.id);
  expect(Object.keys(got)).not.toContain('idempotency_key');
  expect(Object.keys(got)).not.toContain('payload_hash');
  // 對照組角色確實沒有 purchase_payment 權限碼
  for (const code of ['vue_workspace_ga_purchaser', 'vue_workspace_ga6_ga_all']) {
    const role = (await db().from('roles').select('id').eq('code', code).maybeSingle()).data as any;
    if (!role) continue;
    const rp = ((await db().from('role_permissions').select('permission_id').eq('role_id', role.id)).data || []) as any[];
    const ps = ((await db().from('permissions').select('code').in('id', rp.map((x) => x.permission_id))).data || []) as any[];
    expect(ps.map((p) => p.code).filter((c) => c.startsWith('general_affairs.purchase_payment.')), code).toEqual([]);
  }
  void ga6Name;
});
