import { describe, expect, it } from 'vitest';
import {
  PAYEE_PAY_METHODS, PAYEE_TYPES, PAYEE_TYPE_LABELS, PAY_METHODS, PAY_METHOD_LABELS, PR_KINDS, PR_KIND_LABELS, buildExportCsv, claimAfterOffset, exportColumns, isPayMethod, maskRequest, parseRequestFilters,
  payMethodAllowed, pickPayeeBuyer, prepayAmount, prepayApply, prepayBalance, prepayBlocksClose, prepayCap, prepayOffsetFor, prepayOverdue, prepaySplit, selfPayeeBlocked, validateActionPayload,
  validateCreatePayload, validatePrepayCreatePayload, validatePrepaySettlePayload, validateUpdatePayload,
} from '@/lib/workspace/general-affairs/payment-request-rules';
import { BUYER_TAX_ID_RE, buyerTaxIdMatches, defaultCompany, normalizeTaxId, resolveBuyer, selectableCompanies, validateBuyerCompanyPayload } from '@/lib/workspace/general-affairs/buyer-company-rules';
import { PAYOUT_ACCOUNT_RE, accountLast4, canSeePayoutAccount, maskPayoutAccount, pickMyReimbursement, validatePayoutAccountPayload } from '@/lib/workspace/general-affairs/payee-rules';
import { validateUtilityCreatePayload, validateUtilityUpdatePayload } from '@/lib/workspace/general-affairs/utility-payment-rules';
import { UTILITY_BILL_MANAGE_LABEL, utilityBillAbilities } from '@/lib/workspace/general-affairs/utility-bill-rules';

// ga-improve-b1（單元）G1 預付款、G4 付款方式與同仁代墊、G11 買受人公司、G12 權限顯示名稱。
const U1 = '11111111-2222-4333-8444-555555555555';
const U2 = '66666666-7777-4888-8999-aaaaaaaaaaaa';

describe('G1 預付款純函式', () => {
  it('拆稅：含稅額永遠等於輸入、未稅 round(含稅÷1.05)、稅額用減的', () => {
    expect(prepaySplit(400)).toEqual({ untaxed: 381, tax: 19, total: 400 });
    expect(prepaySplit(600)).toEqual({ untaxed: 571, tax: 29, total: 600 });
    expect(prepaySplit(1055).untaxed + prepaySplit(1055).tax).toBe(1055);
    expect(prepaySplit(105, 0.05)).toEqual({ untaxed: 100, tax: 5, total: 105 });
  });
  it('金額驗證：大於 0 的整數元', () => {
    expect(prepayAmount('1,200')).toBe(1200);
    for (const bad of [0, '0', -5, '12.5', '', 'abc', '1234567890']) expect(() => prepayAmount(bad)).toThrow('預付金額必須是大於 0 的整數元');
  });
  it('上限：預付＋一般請款＋這次 ≤ 採購單含稅總額＋尾差（剛好在尾差內可以，超過 1 元就不行）', () => {
    expect(prepayCap(1050, 0, 0, 1055, 5)).toEqual({ ok: true, remaining: 1055, overBy: 0 });
    expect(prepayCap(1050, 0, 0, 1056, 5)).toMatchObject({ ok: false, overBy: 1 });
    expect(prepayCap(1050, 500, 400, 155, 5)).toMatchObject({ ok: true, remaining: 155 });
    expect(prepayCap(1050, 500, 400, 156, 5).ok).toBe(false);
    expect(prepayCap(1000, 1200, 0, 0, 5).remaining).toBe(0);
  });
  it('餘額：只有已送出與已付款有餘額；扣核銷與退款', () => {
    expect(prepayBalance('DRAFT', 500, 0, 0)).toBe(0);
    expect(prepayBalance('VOID', 500, 0, 0)).toBe(0);
    expect(prepayBalance('SUBMITTED', 500, 200, 0)).toBe(300);
    expect(prepayBalance('PAID', 500, 200, 100)).toBe(200);
  });
  it('單張核銷額 = min(進貨單含稅額 − 已請款與核銷, 餘額)，不為負', () => {
    expect(prepayOffsetFor(525, 0, 400)).toBe(400);
    expect(prepayOffsetFor(525, 0, 900)).toBe(525);
    expect(prepayOffsetFor(525, 525, 100)).toBe(0);
    expect(prepayOffsetFor(525, 600, 100)).toBe(0);
    expect(prepayOffsetFor(525, 0, 0)).toBe(0);
  });
  it('核銷順序：進貨單依序、預付單依建立先後；已請款與已核銷的不再核銷', () => {
    const rs = [{ id: 'r1', total: 420, claimed: 0, offset: 0 }, { id: 'r2', total: 105, claimed: 0, offset: 0 }, { id: 'r3', total: 105, claimed: 105, offset: 0 }];
    const ps = [{ id: 'p1', balance: 200 }, { id: 'p2', balance: 300 }];
    expect(prepayApply(rs, ps)).toEqual([
      { receipt_id: 'r1', prepay_id: 'p1', amount: 200 }, { receipt_id: 'r1', prepay_id: 'p2', amount: 220 }, { receipt_id: 'r2', prepay_id: 'p2', amount: 80 },
    ]);
    expect(prepayApply([{ id: 'r', total: 100, claimed: 0, offset: 100 }], ps)).toEqual([]);
    expect(prepayApply(rs, [{ id: 'p', balance: 0 }])).toEqual([]);
  });
  it('一般請款預設扣核銷：稅額 = 含稅額 − round(含稅額÷1.05)；扣完為 0 代表免再請款；沒有核銷回 null（走原本算式）', () => {
    expect(claimAfterOffset(525, 400)).toEqual({ covered: false, untaxed: 119, tax: 6, total: 125 });
    expect(claimAfterOffset(525, 525)).toMatchObject({ covered: true, total: 0 });
    expect(claimAfterOffset(525, 600)).toMatchObject({ covered: true, total: 0, untaxed: 0, tax: 0 });
    expect(claimAfterOffset(525, 0)).toBeNull();
  });
  it('逾期：已下訂、預計到貨日早於今天（台北）、餘額大於 0 才算；回逾期天數', () => {
    const po = (status: string, d: string | null) => ({ status, expected_delivery_date: d });
    expect(prepayOverdue(po('ORDERED', '2026-11-20'), 400, '2026-11-25')).toEqual({ overdue: true, days: 5 });
    expect(prepayOverdue(po('PARTIALLY_RECEIVED', '2026-11-24'), 1, '2026-11-25')).toEqual({ overdue: true, days: 1 });
    expect(prepayOverdue(po('ORDERED', '2026-11-25'), 400, '2026-11-25').overdue).toBe(false);
    expect(prepayOverdue(po('ORDERED', '2026-11-20'), 0, '2026-11-25').overdue).toBe(false);
    expect(prepayOverdue(po('RECEIVED', '2026-11-20'), 400, '2026-11-25').overdue).toBe(false);
    expect(prepayOverdue(po('ORDERED', null), 400, '2026-11-25').overdue).toBe(false);
  });
  it('結案守門：預付餘額大於尾差才擋', () => {
    expect(prepayBlocksClose(6, 5)).toBe(true);
    expect(prepayBlocksClose(5, 5)).toBe(false);
    expect(prepayBlocksClose(0)).toBe(false);
  });
  it('建立與退款的 payload 驗證', () => {
    expect(validatePrepayCreatePayload({ po_id: U1, amount: '500', notes: ' 訂金 ', payee_type: 'EMPLOYEE', payee_profile_id: U2 })).toMatchObject({ po_id: U1, amount: 500, notes: '訂金', payee_type: 'EMPLOYEE', payee_profile_id: U2 });
    expect(() => validatePrepayCreatePayload({ amount: 5 })).toThrow('請選擇採購單');
    expect(() => validatePrepayCreatePayload({ po_id: U1, amount: 0 })).toThrow('預付金額');
    expect(() => validatePrepayCreatePayload({ po_id: U1, amount: 5, lines: [] })).toThrow('不支援的欄位：lines');
    expect(validatePrepaySettlePayload({ amount: '200', reason: '廠商退款', expected_updated_at: 'x', idempotency_key: 'k' })).toEqual({ amount: 200, reason: '廠商退款' });
    expect(() => validatePrepaySettlePayload({ amount: 200 })).toThrow('請填寫退款或轉抵的說明');
    expect(() => validatePrepaySettlePayload({ amount: 0, reason: 'x' })).toThrow('退款金額');
    expect(() => validatePrepaySettlePayload({ amount: 5, reason: 'x'.repeat(201) })).toThrow('不可超過 200');
    expect(PR_KINDS).toEqual(['NORMAL', 'PREPAY']);
    expect(PR_KIND_LABELS).toEqual({ NORMAL: '一般請款', PREPAY: '預付款' });
  });
  it('請款單列表篩選：付款對象、類型、預付逾期', () => {
    expect(parseRequestFilters(new URLSearchParams('payeeType=employee&payKind=prepay&prepayOverdue=1'))).toEqual({ payee_type: 'EMPLOYEE', pay_kind: 'PREPAY', prepay_overdue: true });
    expect(() => parseRequestFilters(new URLSearchParams('payKind=x'))).toThrow('類型篩選值錯誤');
    expect(() => parseRequestFilters(new URLSearchParams('payeeType=x'))).toThrow('付款對象篩選值錯誤');
  });
});

describe('G4 付款方式與同仁代墊', () => {
  it('付款方式五種；原有三種順序不變；同仁代墊只能轉帳、現金、支票', () => {
    expect([...PAY_METHODS]).toEqual(['TRANSFER', 'CASH', 'CHECK', 'CREDIT_CARD', 'ONLINE_PLATFORM']);
    expect(PAY_METHOD_LABELS.CREDIT_CARD).toBe('信用卡');
    expect(PAY_METHOD_LABELS.ONLINE_PLATFORM).toBe('網購平台／第三方支付');
    expect([...PAYEE_PAY_METHODS]).toEqual(['TRANSFER', 'CASH', 'CHECK']);
    expect(isPayMethod('CREDIT_CARD')).toBe(true);
    expect(isPayMethod('BITCOIN')).toBe(false);
    expect(payMethodAllowed('CREDIT_CARD', 'EMPLOYEE')).toBe(false);
    expect(payMethodAllowed('ONLINE_PLATFORM', 'EMPLOYEE')).toBe(false);
    expect(payMethodAllowed('CASH', 'EMPLOYEE')).toBe(true);
    expect(payMethodAllowed('CREDIT_CARD', 'VENDOR')).toBe(true);
    expect(payMethodAllowed('CREDIT_CARD', null)).toBe(true);
  });
  it('標已付款：信用卡末四碼與平台名稱的互斥與格式', () => {
    const now = new Date('2026-11-25T04:00:00Z');
    expect(validateActionPayload('mark_paid', 'SUBMITTED', { pay_method: 'credit_card', card_last4: '4321' }, now)).toMatchObject({ pay_method: 'CREDIT_CARD', card_last4: '4321' });
    expect(validateActionPayload('mark_paid', 'SUBMITTED', { pay_method: 'ONLINE_PLATFORM', platform: '蝦皮' }, now)).toMatchObject({ pay_method: 'ONLINE_PLATFORM', platform: '蝦皮' });
    expect(validateActionPayload('mark_paid', 'SUBMITTED', { pay_method: 'TRANSFER' }, now)).toEqual({ pay_method: 'TRANSFER', paid_date: null, paid_ref: null });
    expect(() => validateActionPayload('mark_paid', 'SUBMITTED', { pay_method: 'TRANSFER', card_last4: '1234' }, now)).toThrow('只有信用卡付款可以填卡號末四碼');
    expect(() => validateActionPayload('mark_paid', 'SUBMITTED', { pay_method: 'CREDIT_CARD', platform: 'x' }, now)).toThrow('只有網購平台');
    expect(() => validateActionPayload('mark_paid', 'SUBMITTED', { pay_method: 'CREDIT_CARD', card_last4: '12ab' }, now)).toThrow('4 位數字');
    expect(() => validateActionPayload('mark_paid', 'SUBMITTED', { pay_method: 'CREDIT_CARD', card_last4: '1234567890123456' }, now)).toThrow('4 位數字');
    expect(() => validateActionPayload('mark_paid', 'SUBMITTED', { pay_method: 'ONLINE_PLATFORM', platform: 'x'.repeat(41) }, now)).toThrow('平台名稱不可超過 40');
    expect(() => validateActionPayload('mark_paid', 'SUBMITTED', { pay_method: 'BITCOIN' }, now)).toThrow('付款方式只能是');
  });
  it('代墊單：付款方式限制與付款人不可是本人', () => {
    const now = new Date('2026-11-25T04:00:00Z');
    expect(() => validateActionPayload('mark_paid', 'SUBMITTED', { pay_method: 'CREDIT_CARD' }, now, { payeeType: 'EMPLOYEE' })).toThrow('同仁代墊的款項只能用轉帳、現金或支票');
    expect(validateActionPayload('mark_paid', 'SUBMITTED', { pay_method: 'CHECK' }, now, { payeeType: 'EMPLOYEE' }).pay_method).toBe('CHECK');
    expect(selfPayeeBlocked({ payee_type: 'EMPLOYEE', payee_profile_id: U1 }, U1)).toBe(true);
    expect(selfPayeeBlocked({ payee_type: 'EMPLOYEE', payee_profile_id: U1 }, U2)).toBe(false);
    expect(selfPayeeBlocked({ payee_type: 'VENDOR', payee_profile_id: null }, U1)).toBe(false);
    expect([...PAYEE_TYPES]).toEqual(['VENDOR', 'EMPLOYEE']);
    expect(PAYEE_TYPE_LABELS.EMPLOYEE).toBe('同仁代墊');
  });
  it('付款對象與買受人欄位整形：有同仁 id 視為代墊；改回廠商不能帶同仁；沒帶不動', () => {
    expect(pickPayeeBuyer({})).toEqual({});
    expect(pickPayeeBuyer({ payee_profile_id: U1 })).toEqual({ payee_type: 'EMPLOYEE', payee_profile_id: U1 });
    expect(pickPayeeBuyer({ payee_type: 'vendor' })).toEqual({ payee_type: 'VENDOR' });
    expect(() => pickPayeeBuyer({ payee_type: 'VENDOR', payee_profile_id: U1 })).toThrow('廠商付款不能指定同仁');
    expect(() => pickPayeeBuyer({ payee_type: 'EMPLOYEE' })).toThrow('請選擇代墊的同仁');
    expect(() => pickPayeeBuyer({ payee_type: 'FRIEND' })).toThrow('廠商或同仁代墊');
    expect(pickPayeeBuyer({ buyer_company_id: '' })).toEqual({ buyer_company_id: null });
    expect(() => pickPayeeBuyer({ buyer_company_id: 'x' })).toThrow('買受人抬頭格式錯誤');
  });
  it('採購、水電請款單的建立與修改都接受付款對象與買受人欄位；其他未知欄位照舊擋', () => {
    expect(validateCreatePayload({ vendor_id: U1, lines: [{ receipt_id: U2 }], payee_profile_id: U2, buyer_company_id: U1 })).toMatchObject({ payee_type: 'EMPLOYEE', payee_profile_id: U2, buyer_company_id: U1 });
    expect(() => validateCreatePayload({ vendor_id: U1, lines: [{ receipt_id: U2 }], foo: 1 })).toThrow('不支援的欄位：foo');
    expect(validateUpdatePayload({ payee_type: 'VENDOR' })).toEqual({ payee_type: 'VENDOR' });
    expect(validateUpdatePayload({ amount: '300' })).toEqual({ amount: 300 });
    expect(validateUtilityCreatePayload({ vendor_id: U1, bill_month: '2038-05', payee_profile_id: U2 })).toMatchObject({ payee_type: 'EMPLOYEE', payee_profile_id: U2 });
    expect(validateUtilityUpdatePayload({ payee_type: 'VENDOR', buyer_company_id: U1 })).toEqual({ payee_type: 'VENDOR', buyer_company_id: U1 });
  });
  it('遮蔽：沒有廠商帳務檢視者看不到同仁帳戶本文（只露末四碼）；同仁本人看得到；廠商請款單原行為不變', () => {
    const row = { payee_type: 'EMPLOYEE', payee_profile_id: U1, payee_account_snapshot: { bank_account: '123-456-789012' }, bank_snapshot: { bank_account: '1' }, vendor_tax_id_snapshot: '12345678' };
    const masked = maskRequest(row, false, U2) as any;
    expect(masked.payee_account_snapshot).toEqual({});
    expect(masked.payee_account_masked).toBe(true);
    expect(masked.payee_account_last4).toBe('9012');
    expect(masked.bank_snapshot).toEqual({});
    expect(maskRequest(row, true, U2)).toBe(row);
    const own = maskRequest(row, false, U1) as any;
    expect(own.payee_account_snapshot).toEqual({ bank_account: '123-456-789012' });
    expect(own.vendor_masked).toBe(true);
    const plain = { payee_type: 'VENDOR', bank_snapshot: { a: 1 }, vendor_tax_id_snapshot: '1' };
    expect(maskRequest(plain, false)).toEqual({ ...plain, vendor_tax_id_snapshot: null, bank_snapshot: {}, vendor_masked: true });
  });
  it('對帳 CSV：預設欄位與順序完全不動；extended 才追加類型、付款對象類型、付款對象、抬頭、信用卡末四碼、平台', () => {
    const base = exportColumns(true).map((c) => c.header);
    expect(exportColumns(true, false).map((c) => c.header)).toEqual(base);
    expect(exportColumns(true, true).map((c) => c.header).slice(0, base.length)).toEqual(base);
    expect(exportColumns(true, true).map((c) => c.header).slice(base.length)).toEqual(['類型', '付款對象類型', '付款對象', '抬頭', '信用卡末四碼', '平台', '同仁銀行', '同仁帳號']);
    expect(exportColumns(false, true).map((c) => c.header).slice(-6)).toEqual(['類型', '付款對象類型', '付款對象', '抬頭', '信用卡末四碼', '平台']);
    const row = { pr_no: 'PY-20261125-001', status: 'PAID', created_at: '2026-11-25T01:00:00Z', vendor_name: '廠商甲', po_no: 'PO-1', amount_total: 300, pay_method: 'CREDIT_CARD', card_last4: '0123', pay_kind: 'PREPAY', payee_type: 'EMPLOYEE', payee_name: '同仁甲', platform: null };
    const csv = buildExportCsv([row], false, true);
    expect(csv.split('\r\n')[0].endsWith('類型,付款對象類型,付款對象,抬頭,信用卡末四碼,平台')).toBe(true);
    expect(csv).toContain('信用卡');
    expect(csv).toContain('預付款,同仁代墊,同仁甲');
    expect(csv).toContain('"=""0123"""'); // 末四碼輸出成文字，保留前導 0
    expect(buildExportCsv([row], false)).toBe(buildExportCsv([row], false, false));
    expect(buildExportCsv([row], false)).not.toContain('預付款');
  });
});

describe('G4 同仁匯款帳戶規則', () => {
  it('帳戶欄位：銀行、帳號、戶名必填，帳號只能數字空白連字號 6 到 30 碼', () => {
    expect(validatePayoutAccountPayload({ bank_name: '測試銀行', bank_account: '123-456-789012', bank_account_name: '王小明' })).toEqual({ bank_name: '測試銀行', bank_account: '123-456-789012', bank_account_name: '王小明', bank_branch: null });
    expect(() => validatePayoutAccountPayload({ bank_name: '銀行' })).toThrow('請填寫帳號');
    expect(() => validatePayoutAccountPayload({ bank_name: '銀行', bank_account: 'ABC123', bank_account_name: 'x' })).toThrow('帳號只能是數字');
    expect(() => validatePayoutAccountPayload({ bank_name: '銀行', bank_account: '1'.repeat(31), bank_account_name: 'x' })).toThrow('帳號只能是數字');
    expect(() => validatePayoutAccountPayload({ bank_name: '銀行', bank_account: '123', bank_account_name: 'x' })).toThrow('帳號只能是數字');
    expect(() => validatePayoutAccountPayload({ x: 1 } as any)).toThrow('不支援的欄位');
    expect(validatePayoutAccountPayload({ bank_account: '999-888-777666' }, false)).toEqual({ bank_account: '999-888-777666' });
    expect(PAYOUT_ACCOUNT_RE.test('123 456-789012')).toBe(true);
  });
  it('末四碼、誰看得到完整帳戶、遮蔽輸出', () => {
    expect(accountLast4('123-456-789012')).toBe('9012');
    expect(accountLast4('')).toBeNull();
    expect(canSeePayoutAccount({ id: U1, canManagePay: false, vendorView: false }, U1)).toBe(true);
    expect(canSeePayoutAccount({ id: U2, canManagePay: true, vendorView: true }, U1)).toBe(true);
    expect(canSeePayoutAccount({ id: U2, canManagePay: true, vendorView: false }, U1)).toBe(false);
    expect(canSeePayoutAccount({ id: U2, canManagePay: false, vendorView: true }, U1)).toBe(false);
    const acc = { bank_name: 'B', bank_account: '123-456-789012', bank_account_name: 'N', bank_branch: null };
    expect(maskPayoutAccount(acc, true)).toEqual({ account: acc, masked: false, last4: '9012' });
    expect(maskPayoutAccount(acc, false)).toEqual({ account: null, masked: true, last4: '9012' });
  });
  it('我的代墊款只留這幾個欄位（不含廠商帳戶與統編）', () => {
    expect(pickMyReimbursement({ id: 'a', pr_no: 'PY', vendor_tax_id_snapshot: '1', bank_snapshot: { a: 1 }, status: 'PAID', amount_total: 5 })).toEqual({
      amount_total: 5, created_at: null, id: 'a', paid_date: null, pr_no: 'PY', source: null, status: 'PAID', vendor_name: null,
    });
  });
});

describe('G11 買受人公司規則', () => {
  it('新增需名稱與 8 碼統編；修改只帶要改的欄位；統編去空白與連字號', () => {
    expect(validateBuyerCompanyPayload({ name: ' 富康測試公司甲 ', tax_id: '1234-5678' })).toEqual({ name: '富康測試公司甲', tax_id: '12345678' });
    expect(validateBuyerCompanyPayload({ id: U1, name: '新名' })).toEqual({ id: U1, name: '新名' });
    expect(validateBuyerCompanyPayload({ id: U1, is_default: 'true', is_active: false, sort_order: 3 })).toEqual({ id: U1, is_default: true, is_active: false, sort_order: 3 });
    expect(() => validateBuyerCompanyPayload({ name: '甲' })).toThrow('8 碼數字');
    expect(() => validateBuyerCompanyPayload({ tax_id: '12345678' })).toThrow('請填寫公司名稱');
    expect(() => validateBuyerCompanyPayload({ name: 'x'.repeat(101), tax_id: '12345678' })).toThrow('不可超過 100');
    expect(() => validateBuyerCompanyPayload({ name: '甲', tax_id: '1234567' })).toThrow('8 碼數字');
    expect(() => validateBuyerCompanyPayload({ id: 'x', name: '甲' })).toThrow('公司 id 格式錯誤');
    expect(() => validateBuyerCompanyPayload({ name: '甲', tax_id: '12345678', foo: 1 })).toThrow('不支援的欄位');
    expect(() => validateBuyerCompanyPayload({ id: U1, is_default: 'maybe' })).toThrow('預設公司必須是是或否');
    expect(BUYER_TAX_ID_RE.test('12345678')).toBe(true);
    expect(normalizeTaxId(' 12 34-5678 ')).toBe('12345678');
  });
  it('預設公司至多一家；下拉選單只列啟用中的，單據已選的停用公司仍顯示', () => {
    const rows = [
      { id: 'a', name: 'A', tax_id: '11111111', is_default: true, is_active: true },
      { id: 'b', name: 'B', tax_id: '22222222', is_default: false, is_active: true },
      { id: 'c', name: 'C', tax_id: '33333333', is_default: false, is_active: false },
    ];
    expect(defaultCompany(rows)?.id).toBe('a');
    expect(defaultCompany([{ ...rows[0], is_active: false }])).toBeNull();
    expect(selectableCompanies(rows).map((r) => r.id)).toEqual(['a', 'b']);
    expect(selectableCompanies(rows, 'c').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('抬頭解析順序：快照 → 所選公司 → 設定值（舊單 fallback 與改版前相同）', () => {
    const co = { name: '甲公司', tax_id: '11111111' };
    expect(resolveBuyer({ snapshot: { title: '快照公司', tax_id: '99999999' }, company: co, settings: { title: '設定', tax_id: '1' } })).toEqual({ title: '快照公司', tax_id: '99999999', source: 'SNAPSHOT' });
    expect(resolveBuyer({ snapshot: { title: null, tax_id: null }, company: co })).toEqual({ title: '甲公司', tax_id: '11111111', source: 'COMPANY' });
    expect(resolveBuyer({ settings: { title: '舊設定', tax_id: '22222222' } })).toEqual({ title: '舊設定', tax_id: '22222222', source: 'SETTINGS' });
    expect(resolveBuyer({})).toEqual({ title: null, tax_id: null, source: 'SETTINGS' });
  });
  it('三聯式發票買受人統編：等於任一啟用公司的統編；沒有任何啟用公司時不核對；停用公司的統編不算', () => {
    const rows = [{ tax_id: '11111111', is_active: true }, { tax_id: '22222222', is_active: true }, { tax_id: '33333333', is_active: false }];
    expect(buyerTaxIdMatches('22222222', rows)).toBe(true);
    expect(buyerTaxIdMatches('33333333', rows)).toBe(false);
    expect(buyerTaxIdMatches('99999999', rows)).toBe(false);
    expect(buyerTaxIdMatches('99999999', [])).toBe(true);
    expect(buyerTaxIdMatches('', rows)).toBe(true);
    expect(buyerTaxIdMatches('1111-1111', rows)).toBe(true);
  });
});

describe('G12 權限顯示名稱', () => {
  it('顯示名稱改為「水電話網費管理」，權限碼不變', () => {
    expect(UTILITY_BILL_MANAGE_LABEL).toBe('水電話網費管理');
    expect(UTILITY_BILL_MANAGE_LABEL).not.toBe('水電網費管理');
    const p = { has: (c: string) => c === 'general_affairs.utility_bill.manage' };
    expect(utilityBillAbilities(p)).toEqual({ canView: true, canManage: true });
  });
});
