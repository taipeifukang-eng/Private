import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name } from '../support/m7m8-fixtures';
import { taipeiToday } from '../support/m7m8-po-fixtures';
import { seedGa45Vendor, setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';

// 第 4.5 批審查修正（資料庫層）：
//   稅額逐張進位（分批進貨的累計上限與請款預設稅額同口徑）、請款單狀態機與明細守門觸發器（直接改表也擋）、無廠商權限者填賣方統編一律忽略（猜不到統編）、
//   已被請款單引用的收據不可清掉「沒有圖片的原因」、發票連結與作廢進貨互斥（併發）、請款引用發票與作廢發票互斥（併發）、最後一張圖併發刪除只放行一張、
//   作廢進貨重送換原因回 409、進貨單回傳不含 void_key、DEV 清除函式把尾差還原成測試前的值（不是寫死 5）。
// 測試資料：廠商名稱帶 QA-GA45- 標記、採購單備註帶 [自動測試]M7M8 標記、只用 DEV；結束只清自己的。
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const KEYS: Ga45Key[] = ['clerk', 'accountant', 'novendor'];
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
function expectErr(r: any, status: number, code?: string) {
  expect(r.ok, JSON.stringify(r)).toBe(false);
  expect(r.status, JSON.stringify(r)).toBe(status);
  if (code) expect(r.code, JSON.stringify(r)).toBe(code);
}
const okData = (r: any) => {
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
};
const ITEMS = [{ item_name: 'QA-GA45 審查品項', unit: '個', quantity: 10, unit_price: 100 }];
const itemId = (po: any, line: number) => po.items.find((i: any) => i.line_no === line).id as string;
async function mkPo(vendor: any, its: any[] = ITEMS) {
  const c = await fn('clerk', 'ga_ws_po_create', { p_header: { notes: m7Name(`RF${(seq += 1)}`), vendor_id: vendor.id }, p_items: its, p_create_key: key() });
  const draft = okData(c);
  return okData(await fn('clerk', 'ga_ws_po_action', { p_id: draft.id, p_action: 'place_order', p_expected_updated_at: draft.updated_at, p_note: null }));
}
async function recv(po: any, qty = 10) {
  return okData(await fn('clerk', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [{ po_item_id: itemId(po, 1), delivered_qty: qty }], p_key: key() }));
}
async function scene(its: any[] = ITEMS, qty = 10) {
  const vendor = await seedGa45Vendor(`RF${(seq += 1)}`);
  const po = await mkPo(vendor, its);
  const receipt = await recv(po, qty);
  return { vendor, po, receipt };
}
let invSeq = 0;
const invNo = () => `QR${String(Date.now()).slice(-6)}${String((invSeq += 1)).padStart(3, '0')}`;
const mkInv = (who: Ga45Key, vendor: any, receipts: any[], over: Record<string, unknown> = {}) =>
  fn(who, 'ga_ws_pay_invoice_save', {
    p_id: null,
    p_payload: { invoice_type: 'TRIPLE', invoice_no: invNo(), invoice_date: today(), vendor_id: vendor.id, amount_untaxed: 1000, receipts: receipts.map((r) => ({ receipt_id: r.id })), ...over },
    p_key: key(),
  });
async function addImage(inv: any) {
  const id = crypto.randomUUID();
  const r = await users.clerk.client.from('ga_resource_attachments').insert({
    resource_type: 'PURCHASE_INVOICE', resource_id: inv.id, purpose: 'INVOICE_IMAGE', storage_path: `purchase_invoice/${inv.id}/invoice_image/${id}.png`, file_name: `m7m8t-${id}.png`,
    content_type: 'image/png', size_bytes: 100, uploaded_by: users.clerk.id,
  }).select('*').single();
  expect(r.error, JSON.stringify(r.error)).toBeNull();
  return r.data as any;
}
const create = (who: Ga45Key, vendor: any, lines: any[], extra: Record<string, unknown> = {}) => fn(who, 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines, ...extra }, p_key: key() });
const act = (who: Ga45Key, pr: any, action: string, payload: Record<string, unknown> = {}) =>
  fn(who, 'ga_ws_pay_request_action', { p_id: pr.id, p_action: action, p_payload: payload, p_key: key(), p_expected_updated_at: pr.updated_at });
const getInv = async (id: string) => okData(await fn('clerk', 'ga_ws_pay_invoice_get', { p_id: id }));

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
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號與臨時角色').toEqual([]);
  const v = await db().from('ga_vendors').select('id', { count: 'exact', head: true }).like('name', 'QA-GA45-%');
  expect(v.count, '測試廠商殘留').toBe(0);
});

// ------------------------------------------------------------------ 稅額進位
test('審查修正 稅額逐張進位：12 次進貨各 10 元（稅 0.5 進位成 1），逐張預設請款合計 132 元，累計驗入同口徑不被 OVER_CLAIM 擋', async () => {
  const vendor = await seedGa45Vendor(`RF${(seq += 1)}`);
  const po = await mkPo(vendor, [{ item_name: 'QA-GA45 小額分批', unit: '個', quantity: 12, unit_price: 10 }]);
  const receipts: any[] = [];
  for (let n = 0; n < 12; n += 1) receipts.push(await recv(po, 1));
  const pr = okData(await create('clerk', vendor, receipts.map((r) => ({ receipt_id: r.id }))));
  // 每張進貨預設請款 10 + 稅 1 = 11，12 張共 132；舊口徑累計驗入只算 120 + round(6) = 126，加尾差 5 元為 131 會硬擋
  expect(Number(pr.amount_total)).toBe(132);
  expect(Number(pr.tax_amount)).toBe(12);
  const rcv = await db().rpc('ga_pay_po_received', { p_po: po.id });
  expect(rcv.error, JSON.stringify(rcv.error)).toBeNull();
  expect(Number((rcv.data as any).total)).toBe(132);
  expect(Number((rcv.data as any).tax)).toBe(12);
  // 全部請完後不再出現在「待請款」
  const cand = okData(await fn('clerk', 'ga_ws_pay_receipt_candidates', { p_filters: { po_id: po.id, only_claimable: true }, p_page: 1, p_page_size: 50 }));
  expect(cand.rows.length).toBe(0);
  // 單張進貨的行為不變：一般採購單（1000 + 50）
  const s = await scene();
  const pr2 = okData(await create('clerk', s.vendor, [{ receipt_id: s.receipt.id }]));
  expect(Number(pr2.amount_total)).toBe(1050);
});

// ------------------------------------------------------------------ 狀態機與明細守門
test('審查修正 請款單狀態機與明細守門：直接改表（service role）也不能做出非法轉移、改金額、改已鎖定的明細', async () => {
  const { vendor, receipt } = await scene();
  const pr = okData(await create('clerk', vendor, [{ receipt_id: receipt.id }]));
  const upd = (patch: Record<string, unknown>) => db().from('ga_payment_requests').update(patch).eq('id', pr.id);
  // 草稿不能直接跳成已付款或把金額以外的規則破壞；草稿可以直接改備註
  expect((await upd({ status: 'PAID', pay_method: 'CASH', paid_date: today(), paid_by: users.clerk.id, paid_at: new Date().toISOString() })).error?.message || '').toContain('不能從 DRAFT 改成 PAID');
  expect((await upd({ notes: '草稿可改' })).error).toBeNull();
  // 已送出：金額、廠商資料鎖定；明細不能新增、修改、刪除
  const sent = okData(await act('clerk', pr, 'submit'));
  expect((await upd({ amount_total: 1, amount_untaxed: 1, tax_amount: 0 })).error?.message || '').toContain('不能修改');
  expect((await upd({ bank_snapshot: { bank_account: '000' } })).error?.message || '').toContain('不能修改');
  const lineDel = await db().from('ga_payment_request_lines').delete().eq('pr_id', pr.id);
  expect(lineDel.error?.message || '').toContain('只有草稿');
  const lineUpd = await db().from('ga_payment_request_lines').update({ claim_untaxed: 1, claim_tax: 0, claim_total: 1 }).eq('pr_id', pr.id);
  expect(lineUpd.error?.message || '').toContain('只有草稿');
  expect((await db().from('ga_payment_request_lines').select('id', { count: 'exact', head: true }).eq('pr_id', pr.id)).count).toBe(1);
  // 已送出不能直接改成不存在的路徑以外的狀態（SUBMITTED→DRAFT 合法但這裡是函式的工作；SUBMITTED→SUBMITTED 無變更可）
  const paid = okData(await act('clerk', sent, 'mark_paid', { pay_method: 'TRANSFER', paid_date: today(), paid_ref: 'R1' }));
  expect(paid.status).toBe('PAID');
  expect((await upd({ status: 'DRAFT' })).error?.message || '').toContain('不能從 PAID 改成 DRAFT');
  expect((await upd({ status: 'SUBMITTED' })).error?.message || '').toContain('不能從 PAID 改成 SUBMITTED');
  expect((await upd({ paid_ref: '改過了' })).error?.message || '').toContain('付款資訊');
  // 已作廢：什麼都不能改，也不能復活
  const voided = okData(await act('clerk', paid, 'void', { reason: '測試作廢' }));
  expect(voided.status).toBe('VOID');
  expect((await upd({ status: 'PAID' })).error?.message || '').toContain('已作廢');
  expect((await upd({ notes: '作廢後改備註' })).error?.message || '').toContain('已作廢');
  const row = (await db().from('ga_payment_requests').select('status,paid_ref,notes').eq('id', pr.id).single()).data as any;
  expect(row.status).toBe('VOID');
  expect(row.paid_ref).toBe('R1');
  expect(row.notes).toBe('草稿可改');
  // 正常流程不受影響：退回草稿再改明細（函式路徑）
  const s2 = await scene();
  const pr2 = okData(await create('clerk', s2.vendor, [{ receipt_id: s2.receipt.id }]));
  const sent2 = okData(await act('clerk', pr2, 'submit'));
  const back = okData(await act('clerk', sent2, 'return', { reason: '改一下' }));
  const edited = await fn('clerk', 'ga_ws_pay_request_update', { p_id: back.id, p_payload: { lines: [{ receipt_id: s2.receipt.id, claim_untaxed: 900 }] }, p_expected_updated_at: back.updated_at });
  expect(Number(okData(edited).amount_untaxed)).toBe(900);
});

// ------------------------------------------------------------------ 統編猜測
test('審查修正 沒有廠商權限者填的賣方統編一律忽略：猜錯猜對回應相同，也不留下他填的統編', async () => {
  const { vendor, receipt } = await scene();
  const wrong = await mkInv('novendor', vendor, [receipt], { seller_tax_id: '99999999' });
  // 舊行為：猜錯 400 TAX_MISMATCH_REASON_REQUIRED、猜對 200，可用來枚舉統編；現在不論填什麼都用預期統編，不會回「不符」
  const inv1 = okData(wrong);
  expect(inv1.seller_tax_masked).toBe(true);
  const stored = (await db().from('ga_purchase_invoices').select('seller_tax_id_snapshot,tax_mismatch_reason').eq('id', inv1.id).single()).data as any;
  expect(stored.seller_tax_id_snapshot).toBe(vendor.tax_id);
  expect(stored.tax_mismatch_reason).toBeNull();
  const s2 = await scene();
  const right = okData(await mkInv('novendor', s2.vendor, [s2.receipt], { seller_tax_id: s2.vendor.tax_id }));
  expect(right.seller_tax_masked).toBe(true);
  // 有廠商權限者行為不變：填錯要原因
  const s3 = await scene();
  expectErr(await mkInv('clerk', s3.vendor, [s3.receipt], { seller_tax_id: '99999999' }), 400, 'TAX_MISMATCH_REASON_REQUIRED');
});

// ------------------------------------------------------------------ 沒有圖片的原因
test('審查修正 已被請款單引用的收據：不能清掉「沒有圖片的原因」（會變成缺圖被引用），改備註仍可', async () => {
  const { vendor, receipt } = await scene();
  const inv = okData(await mkInv('clerk', vendor, [receipt], { invoice_type: 'RECEIPT', amount_total: 1050, amount_untaxed: undefined, no_image_reason: '對方只給收據、沒有拍照' }));
  expect(inv.missing_image).toBe(false);
  const pr = okData(await create('clerk', vendor, [{ receipt_id: receipt.id, invoice_id: inv.id }]));
  const save = (payload: Record<string, unknown>, expected: string) => fn('clerk', 'ga_ws_pay_invoice_save', { p_id: inv.id, p_payload: payload, p_key: null, p_expected_updated_at: expected });
  const blocked = await save({ no_image_reason: null }, (await getInv(inv.id)).updated_at);
  expectErr(blocked, 409, 'INVOICE_IN_USE');
  expect((await getInv(inv.id)).no_image_reason).toBe('對方只給收據、沒有拍照');
  const ok = okData(await save({ notes: '補一個備註' }, (await getInv(inv.id)).updated_at));
  expect(ok.notes).toBe('補一個備註');
  // 有圖片後可以清掉原因
  await addImage(inv);
  const cleared = okData(await save({ no_image_reason: null }, (await getInv(inv.id)).updated_at));
  expect(cleared.missing_image).toBe(false);
  okData(await act('clerk', pr, 'void', {}));
});

// ------------------------------------------------------------------ 併發
test('審查修正 發票連結進貨與作廢進貨併發：不會出現「有效發票連到已作廢進貨」', async () => {
  for (let round = 0; round < 3; round += 1) {
    const { vendor, po, receipt } = await scene();
    const [a, b] = await Promise.all([
      mkInv('clerk', vendor, [receipt]),
      fn('clerk', 'ga_ws_po_receipt_void', { p_po_id: po.id, p_receipt_id: receipt.id, p_reason: '併發測試', p_key: key(), p_expected_updated_at: receipt.updated_at }),
    ]);
    const rc = (await db().from('ga_purchase_receipts').select('voided_at').eq('id', receipt.id).single()).data as any;
    const links = (await db().from('ga_purchase_invoice_receipts').select('invoice_id, ga_purchase_invoices!inner(status)').eq('receipt_id', receipt.id)).data as any[];
    const activeLinks = (links || []).filter((l) => l.ga_purchase_invoices.status === 'ACTIVE');
    expect(!(rc.voided_at && activeLinks.length > 0), `第 ${round + 1} 輪：作廢進貨=${JSON.stringify(b).slice(0, 120)}；發票=${JSON.stringify(a).slice(0, 120)}`).toBe(true);
    // 至少一邊成功、另一邊被擋（不是兩邊都失敗）
    expect([a.ok, b.ok].some(Boolean), JSON.stringify([a, b])).toBe(true);
  }
});

test('審查修正 請款單引用發票與作廢發票併發：不會出現「有效請款單引用已作廢發票」', async () => {
  for (let round = 0; round < 3; round += 1) {
    const { vendor, receipt } = await scene();
    const inv = okData(await mkInv('clerk', vendor, [receipt]));
    await addImage(inv);
    const cur = await getInv(inv.id);
    const [a, b] = await Promise.all([
      create('clerk', vendor, [{ receipt_id: receipt.id, invoice_id: inv.id }]),
      fn('clerk', 'ga_ws_pay_invoice_void', { p_id: inv.id, p_reason: '併發測試', p_key: key(), p_expected_updated_at: cur.updated_at }),
    ]);
    const row = (await db().from('ga_purchase_invoices').select('status').eq('id', inv.id).single()).data as any;
    const refs = (await db().from('ga_payment_request_lines').select('pr_id, ga_payment_requests!inner(status)').eq('invoice_id', inv.id)).data as any[];
    const live = (refs || []).filter((l) => l.ga_payment_requests.status !== 'VOID');
    expect(!(row.status === 'VOID' && live.length > 0), `第 ${round + 1} 輪：請款=${JSON.stringify(a).slice(0, 120)}；作廢=${JSON.stringify(b).slice(0, 120)}`).toBe(true);
    expect([a.ok, b.ok].some(Boolean), JSON.stringify([a, b])).toBe(true);
  }
});

test('審查修正 最後一張圖併發刪除：被請款單引用的發票兩張圖同時各刪一張，只放行一張，發票至少留一張圖', async () => {
  for (let round = 0; round < 3; round += 1) {
    const { vendor, receipt } = await scene();
    const inv = okData(await mkInv('clerk', vendor, [receipt]));
    const i1 = await addImage(inv);
    const i2 = await addImage(inv);
    okData(await create('clerk', vendor, [{ receipt_id: receipt.id, invoice_id: inv.id }]));
    const softDel = (id: string) => users.clerk.client.rpc('ga_soft_delete_resource_attachment', { p_attachment_id: id, p_reason: '併發刪除' });
    const [a, b] = await Promise.all([softDel(i1.id), softDel(i2.id)]);
    const left = (await db().from('ga_resource_attachments').select('id', { count: 'exact', head: true }).eq('resource_id', inv.id).is('deleted_at', null)).count;
    expect(left, `第 ${round + 1} 輪 a=${a.error?.message} b=${b.error?.message}`).toBeGreaterThanOrEqual(1);
    expect([a.error, b.error].filter((e) => e === null).length, '兩次刪除恰好一次成功').toBe(1);
  }
});

// ------------------------------------------------------------------ 作廢進貨重送、回傳欄位
test('審查修正 作廢進貨：同識別換原因回 409（同原因才是重送）；進貨單回傳不含內部識別欄位 void_key', async () => {
  const { po, receipt } = await scene();
  const k = key();
  const args = { p_po_id: po.id, p_receipt_id: receipt.id, p_reason: '登錯了', p_key: k, p_expected_updated_at: receipt.updated_at };
  const first = await fn('clerk', 'ga_ws_po_receipt_void', args);
  expect(first.ok, JSON.stringify(first)).toBe(true);
  expect(first.data).toBeTruthy();
  expect(Object.keys(first.data)).not.toContain('void_key');
  expect(Object.keys(first.data)).not.toContain('payload_hash');
  expect(Object.keys(first.data)).not.toContain('idempotency_key');
  const same = await fn('clerk', 'ga_ws_po_receipt_void', args);
  expect(same.ok, JSON.stringify(same)).toBe(true);
  expect(same.idempotent_replay).toBe(true);
  const other = await fn('clerk', 'ga_ws_po_receipt_void', { ...args, p_reason: '其實是別的原因' });
  expectErr(other, 409, 'IDEMPOTENCY_CONFLICT');
  const row = (await db().from('ga_purchase_receipts').select('void_reason,voided_at').eq('id', receipt.id).single()).data as any;
  expect(row.void_reason).toBe('登錯了');
  // 讀取函式也不外露
  const rd = await db().rpc('ga_po_receipt_data', { p_id: receipt.id });
  expect(rd.error, JSON.stringify(rd.error)).toBeNull();
  expect(Object.keys(rd.data as any)).not.toContain('void_key');
});

// ------------------------------------------------------------------ 清除函式
test('審查修正 DEV 清除函式：尾差還原成測試帳號動它之前的值（不是寫死 5）', async () => {
  const before = (await db().from('ga_workflow_settings').select('value_num,updated_by').eq('key', 'pay_tolerance_amount').single()).data as any;
  const original = Number(before.value_num);
  // 先由「非測試帳號」把尾差設成 7（模擬別人調過的值），再讓測試帳號改成 9
  const set7 = await db().from('ga_workflow_settings').update({ value_num: 7, updated_by: null }).eq('key', 'pay_tolerance_amount');
  expect(set7.error).toBeNull();
  try {
    const cur = okData(await fn('clerk', 'ga_ws_pay_settings_get', {}));
    okData(await fn('clerk', 'ga_ws_pay_settings_set', { p_values: { tolerance_amount: 9 }, p_expected_updated_at: cur.updated_at }));
    expect(Number(okData(await fn('clerk', 'ga_ws_pay_settings_get', {})).tolerance_amount)).toBe(9);
    const left = await cleanupM7M8();
    expect(left).toEqual([]);
    const after = (await db().from('ga_workflow_settings').select('value_num').eq('key', 'pay_tolerance_amount').single()).data as any;
    expect(Number(after.value_num), '清除後尾差回到別人設的 7，而不是 5').toBe(7);
  } finally {
    await db().from('ga_workflow_settings').update({ value_num: original, updated_by: before.updated_by ?? null }).eq('key', 'pay_tolerance_amount');
  }
});
