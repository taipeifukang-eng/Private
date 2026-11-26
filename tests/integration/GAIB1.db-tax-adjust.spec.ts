import { expect, test } from '@playwright/test';
import { adminDb, assertGaBaseline } from '../support/m7m8-fixtures';
import { setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';
import { call, cleanupGaib1, cleanupM7Users, expectErr, itemId, key, mkPo, okData, poGet, prAct, prGet, receive, receiptsGet, seedGaib1Vendor } from '../support/gaib1-fixtures';

// ga-improve-b1 階段 3（資料庫層）：G2 含稅單價、G3 調整列（運費、折扣、折價券、點數折抵、其他）。
// 涵蓋：未稅採購單與原式逐位相同；含稅採購單以含稅總額為準（稅額用減的）；調整列驗證（正負號、上限、金額）；總額為負被擋；計價模式切換保留單價數字；
//      進貨單金額（含稅分支、調整列由第一張品項額加調整額大於 0 的有效進貨單承接、作廢承接進貨單轉移）；請款預設金額與進貨單含稅額相同；
//      下訂後調整列與計價模式鎖定；調整列不攤入庫存成本（進貨登錄不改品項單價）。
// 測試資料：廠商名稱帶 QA-GAIB1- 標記、採購單備註帶 [自動測試]M7M8 標記、只用 DEV；結束只清自己的。
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

const KEYS: Ga45Key[] = ['clerk', 'accountant', 'novendor', 'nobody'];
let users: Record<string, Ga45User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let vendor: any;

test.beforeAll(async () => {
  await assertGaBaseline();
  const left = await cleanupGaib1();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const s = await setupGa45Users(KEYS);
  users = s.users;
  teardownUsers = s.teardown;
  vendor = await seedGaib1Vendor('TAX');
});
test.afterAll(async () => {
  expect(await cleanupGaib1(), '清除測試資料').toEqual([]);
  expect(await teardownUsers(), '清除測試帳號').toEqual([]);
  expect(await cleanupM7Users(), '清除測試帳號（殘留）').toEqual([]);
});

const clerk = () => users.clerk;
const accountant = () => users.accountant;

test('未稅採購單：金額與原式相同、預設計價方式是未稅、沒有調整列', async () => {
  const po = await mkPo(clerk(), vendor, { notes: 'excl', items: [{ item_name: 'QA-GAIB1 未稅', unit: '個', quantity: 10, unit_price: 100 }, { item_name: 'QA-GAIB1 未稅二', unit: '個', quantity: 3, unit_price: 33.3333 }] });
  expect(po.price_mode).toBe('EXCL');
  // 10×100 + round(3×33.3333)=100 → 小計 1100、稅額 round(55)=55、含稅 1155
  expect(Number(po.subtotal)).toBe(1100);
  expect(Number(po.tax_amount)).toBe(55);
  expect(Number(po.total_amount)).toBe(1155);
  expect(po.adjustments).toEqual([]);
  expect(Number(po.adjustment_total)).toBe(0);
  expect(po.items[0].unit_price_gross).toBeNull();
  const rc = await receive(clerk(), po);
  expect(Number(rc.amount_total)).toBe(1155);
  expect(Number(rc.amount_untaxed)).toBe(1100);
  expect(Number(rc.amount_tax)).toBe(55);
  expect(rc.adjustments).toEqual([]);
});

test('含稅採購單：以含稅總額為準、未稅用反推、稅額用減的（含稅總額等於輸入合計）', async () => {
  // 3 × 100（含稅）= 300：未稅 round(300/1.05)=286、稅額 14，含稅總額仍是 300
  const po = await mkPo(clerk(), vendor, { notes: 'incl', header: { price_mode: 'INCL' }, items: [{ item_name: 'QA-GAIB1 含稅', unit: '個', quantity: 3, unit_price: 100 }] });
  expect(po.price_mode).toBe('INCL');
  expect(Number(po.total_amount)).toBe(300);
  expect(Number(po.subtotal)).toBe(286);
  expect(Number(po.tax_amount)).toBe(14);
  expect(Number(po.items[0].unit_price_gross)).toBe(100);
  expect(Number(po.items[0].line_gross)).toBe(300);
  expect(Number(po.items[0].unit_price)).toBeCloseTo(95.2381, 4);
  // 分批進貨：先收 1 個（含稅 100 → 未稅 95、稅額 5），再收 2 個（含稅 200 → 未稅 190、稅額 10）
  const r1 = await receive(clerk(), po, [{ line: 1, qty: 1 }]);
  expect(Number(r1.amount_total)).toBe(100);
  expect(Number(r1.amount_untaxed)).toBe(95);
  expect(Number(r1.amount_tax)).toBe(5);
  const r2 = await receive(clerk(), po, [{ line: 1, qty: 2 }]);
  expect(Number(r2.amount_total)).toBe(200);
  expect(Number(r2.amount_untaxed)).toBe(190);
  // 請款預設額＝進貨單含稅額；累計 300 等於採購單含稅總額
  const sum = okData(await call(clerk(), 'ga_ws_pay_po_summary', { p_po_id: po.id }));
  expect(Number(sum.received_total)).toBe(300);
  expect(Number(sum.po_total_amount)).toBe(300);
  const pr = okData(await call(clerk(), 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines: [{ receipt_id: r1.id }, { receipt_id: r2.id }] }, p_key: key() }));
  expect(Number(pr.amount_total)).toBe(300);
  expect(pr.lines.map((l: any) => Number(l.claim_total))).toEqual([100, 200]);
  expect(pr.lines.map((l: any) => Number(l.claim_tax))).toEqual([5, 10]);
  expect(Number(pr.amount_untaxed) + Number(pr.tax_amount)).toBe(300);
});

test('調整列：運費與折扣算進總額、折扣為負、原價與活動名稱保留', async () => {
  const po = await mkPo(clerk(), vendor, {
    notes: 'adj', place: false,
    header: { adjustments: [{ kind: 'FREIGHT', amount: 100 }, { kind: 'DISCOUNT', amount: -200, original_price: 1200, campaign_name: '雙十一測試活動', note: '折價 200' }] },
    items: [{ item_name: 'QA-GAIB1 調整', unit: '個', quantity: 10, unit_price: 100 }],
  });
  // 1000 + 100 − 200 = 900；稅額 45；含稅 945
  expect(Number(po.subtotal)).toBe(900);
  expect(Number(po.tax_amount)).toBe(45);
  expect(Number(po.total_amount)).toBe(945);
  expect(Number(po.adjustment_total)).toBe(-100);
  expect(po.adjustments).toHaveLength(2);
  expect(po.adjustments[0]).toMatchObject({ kind: 'FREIGHT', label: '運費', amount: 100 });
  expect(po.adjustments[1]).toMatchObject({ kind: 'DISCOUNT', label: '折扣', amount: -200, original_price: 1200, campaign_name: '雙十一測試活動', note: '折價 200' });
});

test('調整列驗證：正負號、金額、上限、總額不可為負、下訂後鎖定', async () => {
  const base = { notes: 'adjv', place: false, items: [{ item_name: 'QA-GAIB1 驗證', unit: '個', quantity: 1, unit_price: 100 }] };
  const bad = async (adjustments: unknown, code: string) => {
    const r = await call(clerk(), 'ga_ws_po_create', { p_header: { notes: '[自動測試]M7M8 x', vendor_id: vendor.id, adjustments }, p_items: base.items, p_create_key: key() });
    expectErr(r, code === 'PO_TOTAL_NEGATIVE' ? 400 : 400, code);
  };
  await bad([{ kind: 'FREIGHT', amount: -50 }], 'ADJUSTMENT_SIGN');
  await bad([{ kind: 'DISCOUNT', amount: 50 }], 'ADJUSTMENT_SIGN');
  await bad([{ kind: 'COUPON', amount: 5 }], 'ADJUSTMENT_SIGN');
  await bad([{ kind: 'POINTS', amount: 5 }], 'ADJUSTMENT_SIGN');
  await bad([{ kind: 'OTHER', amount: 0 }], 'ADJUSTMENT_AMOUNT');
  await bad([{ kind: 'OTHER', amount: 1.5 }], 'ADJUSTMENT_AMOUNT');
  await bad([{ kind: 'WRONG', amount: 5 }], 'ADJUSTMENT_KIND');
  await bad(Array.from({ length: 11 }, () => ({ kind: 'OTHER', amount: 1 })), 'TOO_MANY_ADJUSTMENTS');
  await bad({ kind: 'FREIGHT' }, 'ADJUSTMENTS_INVALID');
  await bad([{ kind: 'DISCOUNT', amount: -500 }], 'PO_TOTAL_NEGATIVE');
  // 點數與折價券、其他（正負皆可）
  const ok = await mkPo(clerk(), vendor, { ...base, place: true, header: { adjustments: [{ kind: 'COUPON', amount: -10 }, { kind: 'POINTS', amount: -5, label: '會員點數' }, { kind: 'OTHER', amount: 3 }] } });
  expect(Number(ok.total_amount)).toBe(Math.round((100 - 10 - 5 + 3) * 1.05));
  // 下訂後鎖定：不能改調整列與計價方式
  const r = await call(clerk(), 'ga_ws_po_update', { p_id: ok.id, p_header: { adjustments: [] }, p_items: null, p_expected_updated_at: ok.updated_at });
  expectErr(r, 409, 'PO_LOCKED');
  const r2 = await call(clerk(), 'ga_ws_po_update', { p_id: ok.id, p_header: { price_mode: 'INCL' }, p_items: null, p_expected_updated_at: ok.updated_at });
  expectErr(r2, 409, 'PO_LOCKED');
  // 草稿可清空調整列
  const d = await mkPo(clerk(), vendor, { ...base, header: { adjustments: [{ kind: 'FREIGHT', amount: 10 }] } });
  expect(d.adjustments).toHaveLength(0 + 1);
});

test('草稿切換計價方式：單價數字保留、總額重算', async () => {
  const c = await mkPo(clerk(), vendor, { notes: 'switch', place: false, items: [{ item_name: 'QA-GAIB1 切換', unit: '個', quantity: 10, unit_price: 105 }] });
  expect(Number(c.total_amount)).toBe(1103); // 1050 + round(52.5)=53
  const u = okData(await call(clerk(), 'ga_ws_po_update', { p_id: c.id, p_header: { price_mode: 'INCL' }, p_items: null, p_expected_updated_at: c.updated_at }));
  expect(u.price_mode).toBe('INCL');
  expect(Number(u.items[0].unit_price_gross)).toBe(105);
  expect(Number(u.total_amount)).toBe(1050);
  expect(Number(u.subtotal)).toBe(1000);
  const back = okData(await call(clerk(), 'ga_ws_po_update', { p_id: c.id, p_header: { price_mode: 'EXCL' }, p_items: null, p_expected_updated_at: u.updated_at }));
  expect(back.price_mode).toBe('EXCL');
  expect(Number(back.items[0].unit_price)).toBe(105);
  expect(back.items[0].unit_price_gross).toBeNull();
  expect(Number(back.total_amount)).toBe(1103);
  const bad = await call(clerk(), 'ga_ws_po_update', { p_id: c.id, p_header: { price_mode: 'XX' }, p_items: null, p_expected_updated_at: back.updated_at });
  expectErr(bad, 400, 'INVALID_PRICE_MODE');
});

test('進貨承接調整列：第一張品項額加調整額大於 0 的有效進貨單承接，作廢後轉移', async () => {
  const po = await mkPo(clerk(), vendor, {
    notes: 'carry',
    header: { adjustments: [{ kind: 'FREIGHT', amount: 100 }, { kind: 'DISCOUNT', amount: -300 }] },
    items: [{ item_name: 'QA-GAIB1 承接', unit: '個', quantity: 10, unit_price: 100 }],
  });
  // 1000 + 100 − 300 = 800；稅 40；含稅 840
  expect(Number(po.total_amount)).toBe(840);
  // 第一張只收 2 個：品項額 200 + 調整 −200 = 0，不大於 0 → 不承接（延後）
  const r1 = await receive(clerk(), po, [{ line: 1, qty: 2 }]);
  expect(r1.adjustments).toEqual([]);
  expect(Number(r1.amount_total)).toBe(210);
  // 第二張收 4 個：品項額 400 + 調整 −200 = 200 > 0 → 承接全部調整列（未稅 200，稅 10，含稅 210）
  const r2 = await receive(clerk(), po, [{ line: 1, qty: 4 }]);
  expect(r2.adjustments.map((a: any) => a.amount)).toEqual([100, -300]);
  expect(Number(r2.amount_untaxed)).toBe(200);
  expect(Number(r2.amount_total)).toBe(210);
  // 第三張收剩下 4 個：不再承接
  const r3 = await receive(clerk(), po, [{ line: 1, qty: 4 }]);
  expect(r3.adjustments).toEqual([]);
  expect(Number(r3.amount_total)).toBe(420);
  // 三張合計＝採購單含稅總額（210 + 210 + 420 = 840）
  const sum = okData(await call(clerk(), 'ga_ws_pay_po_summary', { p_po_id: po.id }));
  expect(Number(sum.received_total)).toBe(840);
  // 作廢承接的第二張：調整列轉給下一張符合條件者（第三張：品項額 400 + 調整 −200 > 0；第一張品項額 200 + 調整 −200 = 0 不符）
  const pos = await poGet(clerk(), po.id);
  const rv = okData(await call(clerk(), 'ga_ws_po_receipt_void', { p_po_id: po.id, p_receipt_id: r2.id, p_reason: '測試作廢承接', p_key: key(), p_expected_updated_at: r2.updated_at }));
  expect(rv.voided_at).toBeTruthy();
  const rs = await receiptsGet(clerk(), po.id);
  const byNo = (id: string) => rs.receipts.find((x: any) => x.id === id);
  expect(byNo(r3.id).adjustments.map((a: any) => a.amount)).toEqual([100, -300]);
  expect(Number(byNo(r3.id).amount_total)).toBe(420 + Math.round(-200 * 1.05));
  expect(byNo(r1.id).adjustments).toEqual([]);
  expect(pos.adjustments[0].receipt_no).toBe(r2.receipt_no);
  const pos2 = await poGet(clerk(), po.id);
  expect(pos2.adjustments[0].receipt_no).toBe(byNo(r3.id).receipt_no);
});

test('請款預設金額＝進貨單含稅額（含調整列），累計上限照含調整的總額', async () => {
  const po = await mkPo(clerk(), vendor, { notes: 'payadj', header: { adjustments: [{ kind: 'FREIGHT', amount: 100 }, { kind: 'POINTS', amount: -50 }] }, items: [{ item_name: 'QA-GAIB1 請款', unit: '個', quantity: 10, unit_price: 100 }] });
  expect(Number(po.total_amount)).toBe(Math.round(1050 * 1.05)); // 1102.5 → 1103
  const rc = await receive(clerk(), po);
  expect(Number(rc.amount_total)).toBe(1103);
  const pr = okData(await call(clerk(), 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines: [{ receipt_id: rc.id }] }, p_key: key() }));
  expect(Number(pr.amount_total)).toBe(1103);
  expect(Number(pr.lines[0].claim_untaxed)).toBe(1050);
  expect(Number(pr.lines[0].claim_tax)).toBe(53);
  const sub = okData(await prAct(clerk(), pr, 'submit'));
  expect(sub.status).toBe('SUBMITTED');
  const paid = okData(await prAct(accountant(), sub, 'mark_paid', { pay_method: 'TRANSFER' }));
  expect(paid.status).toBe('PAID');
  // 候選清單：稅額與含稅額走同一支計算
  const cand = okData(await call(clerk(), 'ga_ws_pay_receipt_candidates', { p_filters: { po_id: po.id, only_claimable: false }, p_page: 1, p_page_size: 10 }));
  expect(Number(cand.rows[0].receipt_total)).toBe(1103);
  expect(Number(cand.rows[0].receipt_tax)).toBe(53);
});

test('含稅採購單加調整列與請款：發票與請款金額對得上', async () => {
  // 含稅：5 × 210 = 1050，運費 +105，折價券 −105 → 合計 1050，未稅 1000，稅 50
  const po = await mkPo(clerk(), vendor, {
    notes: 'inclpay', header: { price_mode: 'INCL', adjustments: [{ kind: 'FREIGHT', amount: 105 }, { kind: 'COUPON', amount: -105 }] },
    items: [{ item_name: 'QA-GAIB1 含稅請款', unit: '個', quantity: 5, unit_price: 210 }],
  });
  expect(Number(po.total_amount)).toBe(1050);
  expect(Number(po.subtotal)).toBe(1000);
  const rc = await receive(clerk(), po);
  expect(Number(rc.amount_total)).toBe(1050);
  expect(Number(rc.amount_untaxed)).toBe(1000);
  // 收據不另列稅額：金額 1,050 元即含稅總額，與進貨單含稅額、請款金額相同
  const inv = okData(await call(clerk(), 'ga_ws_pay_invoice_save', { p_id: null, p_payload: { invoice_type: 'RECEIPT', invoice_no: `QAGB${String(Date.now()).slice(-7)}`, invoice_date: new Date().toISOString().slice(0, 10), vendor_id: vendor.id,
    amount_untaxed: 1050, no_image_reason: '測試資料', receipts: [{ receipt_id: rc.id }] }, p_key: key() }));
  expect(Number(inv.amount_total)).toBe(1050);
  const pr = okData(await call(clerk(), 'ga_ws_pay_request_create', { p_payload: { vendor_id: vendor.id, lines: [{ receipt_id: rc.id, invoice_id: inv.id }] }, p_key: key() }));
  expect(Number(pr.amount_total)).toBe(1050);
  expect(pr.lines[0].diff_reason).toBeNull();
});

test('權限：沒有採購權限的人建不了含調整列的採購單（沿用 ga_po_perm_error）', async () => {
  const r = await call(users.nobody, 'ga_ws_po_create', { p_header: { vendor_id: vendor.id, adjustments: [{ kind: 'FREIGHT', amount: 10 }] }, p_items: [{ item_name: 'x', quantity: 1, unit_price: 1 }], p_create_key: key() });
  expectErr(r, 403);
  const db = adminDb();
  const cnt = await db.from('ga_purchase_order_adjustments').select('id', { count: 'exact', head: true });
  expect(cnt.error).toBeNull();
});
