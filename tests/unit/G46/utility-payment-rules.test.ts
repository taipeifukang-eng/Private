import { describe, expect, it } from 'vitest';
import {
  EXCLUDED_LABELS, NO_BILLS_MESSAGE, UTILITY_PRINT_HEADERS, afterManualPaidChange, amountProblem, amountProblemMessage, autoMarkPlan, autoPickBills, billEligibility, billLabel,
  buildUtilityExportCsv, excludedStats, identifierHeader, isFieldLocked, isSourceValue, isUtilityRequest, lockMessage, lockedChanges, lockedFields, maskUtilityRequest,
  missingAttachmentBills, missingAttachmentMessage, noPayeeNotice, normalizeBillMonth, parseCandidateParams, parseSourceParam, parseUtilityBillExtraFilters, pickPayeeField, sourceName, sourceOf, sumClaims,
  utilityActionAllowed, utilityErrorMessage, utilityExportColumns, utilityExportFileName, utilityPaymentAbilities, utilityPrintRow, validateSetPayee, validateUtilityCreatePayload,
  validateUtilityUpdatePayload, voidPaidWarning, type BillState,
} from '@/lib/workspace/general-affairs/utility-payment-rules';
import { PR_SOURCES, PR_SOURCE_LABELS, parseRequestFilters, payErrorMessage } from '@/lib/workspace/general-affairs/payment-request-rules';

// G46 水電話費請款（單元）：候選條件與原因（刪除、單位不符、無單位、月份不符、已繳、小數、0 元、在別單）與順序、自動帶入排除、缺附件計算、鎖定判斷（D7）、
// 自動標記與回復規則表（勾選／不勾選、手動標記不動、退回、作廢、已付款後作廢）、繳費日期＝台北日期（跨午夜、UTC 邊界）、金額整數與合計、來源標籤與篩選、
// CSV 欄位與公式注入與文字格式與整欄省略、列印欄位、錯誤白話、權限矩陣（兩個權限缺一的組合）。
const V = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const PR = '33333333-3333-4333-8333-333333333333';
const ctx = { vendorId: V, month: '2038-03', payeeName: '台灣電力公司' };
const bill = (over: Record<string, unknown> = {}) => ({ id: 'b1', deleted_at: null, payee_vendor_id: V, billing_month: '2038-03-01', paid_at: null, amount: 1000, ...over }) as any;
const perms = (...codes: string[]) => ({ has: (c: string) => codes.includes(c) });
const PAYM = 'general_affairs.purchase_payment.manage';
const PAYV = 'general_affairs.purchase_payment.view';
const UBM = 'general_affairs.utility_bill.manage';
const UBV = 'general_affairs.utility_bill.view';
const VENV = 'general_affairs.vendor.view';

describe('來源', () => {
  it('來源名稱與標籤、沒有來源的舊資料當採購', () => {
    expect(PR_SOURCES).toEqual(['PURCHASE', 'UTILITY']);
    expect(PR_SOURCE_LABELS).toEqual({ PURCHASE: '採購', UTILITY: '水電話費' });
    expect(sourceOf({})).toBe('PURCHASE');
    expect(sourceOf({ source: 'UTILITY' })).toBe('UTILITY');
    expect(sourceOf({ source: 'x' })).toBe('PURCHASE');
    expect(sourceName({ source: 'UTILITY' })).toBe('水電話費');
    expect(isUtilityRequest({ source: 'UTILITY' })).toBe(true);
    expect(isUtilityRequest(null)).toBe(false);
    expect(isSourceValue('PURCHASE')).toBe(true);
    expect(isSourceValue('purchase')).toBe(false);
  });
  it('來源篩選：空＝全部、大小寫不拘、其他值錯誤；列表篩選整形帶 source', () => {
    expect(parseSourceParam('')).toBeNull();
    expect(parseSourceParam(null)).toBeNull();
    expect(parseSourceParam('utility')).toBe('UTILITY');
    expect(parseSourceParam(' PURCHASE ')).toBe('PURCHASE');
    expect(() => parseSourceParam('FOO')).toThrow('來源篩選值錯誤');
    expect(parseRequestFilters(new URLSearchParams('source=utility&status=draft'))).toMatchObject({ source: 'UTILITY', status: 'DRAFT' });
    expect(parseRequestFilters(new URLSearchParams('status=draft'))).toEqual({ status: 'DRAFT' });
    expect(() => parseRequestFilters(new URLSearchParams('source=zzz'))).toThrow();
  });
});

describe('帳單能不能請款（順序與資料庫 ga_pay_ub_eligible 相同）', () => {
  it('可請款', () => expect(billEligibility(bill(), ctx)).toEqual({ eligible: true }));
  it.each([
    ['已刪除', { deleted_at: '2038-01-01' }, 'BILL_DELETED', '已被刪除'],
    ['沒有繳費單位', { payee_vendor_id: null }, 'BILL_NO_PAYEE', '還沒有指定繳費單位'],
    ['別的繳費單位', { payee_vendor_id: V2 }, 'BILL_PAYEE_MISMATCH', '繳費單位不是 台灣電力公司'],
    ['別的月份', { billing_month: '2038-04-01' }, 'BILL_MONTH_MISMATCH', '2038-04 月，不能放進 2038-03 月'],
    ['已繳', { paid_at: '2038-03-05' }, 'BILL_ALREADY_PAID', '已標記已繳（2038-03-05）'],
    ['金額有小數', { amount: 1000.5 }, 'BILL_AMOUNT_INVALID', '金額有小數，請先到水電帳單修正'],
    ['0 元', { amount: 0 }, 'BILL_AMOUNT_INVALID', '0 元帳單不需要請款'],
  ])('%s', (_n, over, code, msg) => {
    const r = billEligibility(bill(over as any), ctx) as any;
    expect(r.eligible).toBe(false);
    expect(r.code).toBe(code);
    expect(r.message).toContain(msg);
  });
  it('在別張請款單：附單號', () => {
    const r = billEligibility(bill(), { ...ctx, otherRequestNo: 'PY-20381201-001' }) as any;
    expect(r).toMatchObject({ eligible: false, code: 'BILL_IN_OTHER_REQUEST', pr_no: 'PY-20381201-001' });
    expect(r.message).toContain('PY-20381201-001');
  });
  it('順序：刪除 > 無單位 > 單位不符 > 月份不符 > 已繳 > 金額 > 別張請款單', () => {
    expect((billEligibility(bill({ deleted_at: 'x', payee_vendor_id: null, paid_at: 'y', amount: 0 }), { ...ctx, otherRequestNo: 'P' }) as any).code).toBe('BILL_DELETED');
    expect((billEligibility(bill({ payee_vendor_id: V2, billing_month: '2038-09-01', paid_at: 'y', amount: 0 }), ctx) as any).code).toBe('BILL_PAYEE_MISMATCH');
    expect((billEligibility(bill({ billing_month: '2038-09-01', paid_at: 'y', amount: 0 }), ctx) as any).code).toBe('BILL_MONTH_MISMATCH');
    expect((billEligibility(bill({ paid_at: 'y', amount: 0 }), ctx) as any).code).toBe('BILL_ALREADY_PAID');
    expect((billEligibility(bill({ amount: 0.5 }), { ...ctx, otherRequestNo: 'P' }) as any).code).toBe('BILL_AMOUNT_INVALID');
  });
  it('金額：正整數才能請款；字串金額與科學記號也照數值判斷', () => {
    expect(amountProblem(1)).toBeNull();
    expect(amountProblem('2500')).toBeNull();
    expect(amountProblem('2500.00')).toBeNull();
    expect(amountProblem(0)).toBe('BILL_AMOUNT_INVALID');
    expect(amountProblem(-5)).toBe('BILL_AMOUNT_INVALID');
    expect(amountProblem(10.01)).toBe('BILL_AMOUNT_INVALID');
    expect(amountProblem(null)).toBe('BILL_AMOUNT_INVALID');
    expect(amountProblem('abc')).toBe('BILL_AMOUNT_INVALID');
    expect(amountProblemMessage(5)).toBeNull();
    expect(sumClaims([{ claim_total: 100 }, { claim_total: '250' }, { amount: 50 }])).toBe(400);
  });
  it('自動帶入：只含同單位同月份可請款、依 id 排序；排除原因統計不含已刪除', () => {
    const bills = [
      bill({ id: 'c' }), bill({ id: 'a' }), bill({ id: 'b', amount: 1.5 }), bill({ id: 'd', paid_at: '2038-03-01' }), bill({ id: 'e', payee_vendor_id: V2 }), bill({ id: 'f', billing_month: '2038-04-01' }),
      bill({ id: 'g' }), bill({ id: 'h', deleted_at: 'x' }), bill({ id: 'i', payee_vendor_id: null }),
    ];
    expect(autoPickBills(bills, ctx, (id) => (id === 'g' ? 'PY-1' : null))).toEqual(['a', 'c']);
    const st = excludedStats(bills, ctx, (b) => (b.id === 'g' ? 'PY-1' : null));
    expect(st).toEqual({ BILL_AMOUNT_INVALID: 1, BILL_ALREADY_PAID: 1, BILL_PAYEE_MISMATCH: 1, BILL_MONTH_MISMATCH: 1, BILL_IN_OTHER_REQUEST: 1, BILL_NO_PAYEE: 1 });
    expect(Object.keys(st).every((k) => k in EXCLUDED_LABELS)).toBe(true);
    expect(NO_BILLS_MESSAGE('台電', '2038-03-01')).toBe('台電 2038-03 月沒有可以請款的帳單');
    expect(noPayeeNotice(3)).toContain('3 張帳單沒有指定繳費單位');
    expect(noPayeeNotice(0)).toBe('');
  });
});

describe('送出前缺附件（U5）', () => {
  const rows = [
    { bill_id: 'a', attachment_count: 0, location_name: 'ZT 測試門市 01', expense_type: 'ELECTRICITY', identifier: '01-23-4567-89-0', amount: 100 },
    { bill_id: 'b', attachment_count: 2, location_name: 'VW', expense_type: 'WATER', identifier: 'W1' },
    { bill_id: 'c', attachment_count: '0', location_name: 'VW', expense_type: 'PHONE', identifier: null },
    { bill_id: 'd', attachment_count: null, location_name: 'VW', expense_type: 'INTERNET', identifier: 'N1' },
  ];
  it('0、空值、字串 0 都算缺；有附件不算', () => {
    expect(missingAttachmentBills(rows).map((r) => r.bill_id)).toEqual(['a', 'c', 'd']);
    expect(missingAttachmentBills([])).toEqual([]);
  });
  it('訊息與資料庫相同、最多列 10 張', () => {
    const m = missingAttachmentMessage(missingAttachmentBills(rows))!;
    expect(m).toBe('有 3 張帳單還沒有附件（帳單照片或 PDF），請先上傳：ZT 測試門市 01 電費 01-23-4567-89-0、VW 電話費、VW 網路費 N1');
    expect(missingAttachmentMessage([])).toBeNull();
    const many = Array.from({ length: 12 }, (_, i) => ({ attachment_count: 0, location_name: `店${i}`, expense_type: 'WATER', identifier: `${i}` }));
    expect(missingAttachmentMessage(many)).toMatch(/有 12 張.*等$/);
    expect(billLabel({ location_name: 'A', expense_type: 'WATER', identifier: '' })).toBe('A 水費');
  });
});

describe('帳單鎖定（D7）', () => {
  it('草稿與沒有請款單不鎖；已送出、已付款鎖七項；勾自動標記另鎖繳費日期', () => {
    expect(lockedFields(null)).toEqual([]);
    expect(lockedFields({ status: 'DRAFT', auto_mark_paid: true })).toEqual([]);
    expect(lockedFields({ status: 'VOID', auto_mark_paid: true })).toEqual([]);
    expect(lockedFields({ status: 'SUBMITTED', auto_mark_paid: false })).toEqual(['amount', 'payee_vendor_id', 'billing_month', 'expense_type', 'location', 'identifier', 'delete']);
    expect(lockedFields({ status: 'PAID', auto_mark_paid: true })).toContain('paid_at');
    expect(lockedFields({ status: 'SUBMITTED', auto_mark_paid: false })).not.toContain('paid_at');
    expect(isFieldLocked('amount', lockedFields({ status: 'PAID' }))).toBe(true);
    expect(isFieldLocked('notes', lockedFields({ status: 'PAID' }))).toBe(false);
    expect(isFieldLocked('amount', null)).toBe(false);
  });
  it('這次修改碰到的鎖定欄位與訊息；備註與到期日不鎖', () => {
    const req = { status: 'SUBMITTED', auto_mark_paid: true };
    expect(lockedChanges(['amount', 'notes', 'due_date', 'paid_at'], req)).toEqual(['amount', 'paid_at']);
    expect(lockedChanges(['notes', 'due_date', 'reference_no'], req)).toEqual([]);
    expect(lockedChanges(['paid_at'], { status: 'SUBMITTED', auto_mark_paid: false })).toEqual([]);
    expect(lockMessage('PY-1', 'SUBMITTED', true, ['amount'])).toBe('這筆帳單已在請款單 PY-1 內（已送出），金額、繳費單位與刪除已鎖定；請先請款單退回或作廢');
    expect(lockMessage('PY-1', 'PAID', true, ['paid_at'])).toContain('繳費狀態由請款單管理');
    expect(lockMessage('PY-1', 'PAID', false, ['paid_at'])).toBeNull();
    expect(lockMessage('PY-1', 'PAID', true, ['notes'])).toBeNull();
  });
});

describe('自動標記已繳與回復（U6）', () => {
  const bills: BillState[] = [
    { id: 'auto1', paid_at: '2038-03-05', paid_by_pr_id: PR },
    { id: 'manual', paid_at: '2038-03-06', paid_by_pr_id: null },
    { id: 'other', paid_at: '2038-03-07', paid_by_pr_id: '99999999-9999-4999-8999-999999999999' },
    { id: 'unpaid', paid_at: null, paid_by_pr_id: null },
  ];
  it('送出且勾選：全部標已繳，日期＝台北今天，記錄 paid_by_pr_id', () => {
    const p = autoMarkPlan('submit', PR, true, [{ id: 'x', paid_at: null, paid_by_pr_id: null }], new Date('2038-03-10T02:00:00Z'));
    expect(p.mark).toEqual([{ id: 'x', paid_at: '2038-03-10', paid_by_pr_id: PR }]);
    expect(p.revert).toEqual([]);
    expect(p.release).toBe(false);
  });
  it('台北日期：UTC 前一天 16:00 起已是台北隔天（跨午夜與 UTC 邊界）', () => {
    const at = (iso: string) => autoMarkPlan('submit', PR, true, [{ id: 'x', paid_at: null, paid_by_pr_id: null }], new Date(iso)).mark[0].paid_at;
    expect(at('2038-03-09T15:59:59Z')).toBe('2038-03-09');
    expect(at('2038-03-09T16:00:00Z')).toBe('2038-03-10');
    expect(at('2038-12-31T16:30:00Z')).toBe('2039-01-01');
    expect(at('2038-03-10T00:00:00Z')).toBe('2038-03-10');
    expect(at('2038-03-10T23:59:59Z')).toBe('2038-03-11');
  });
  it('送出不勾：帳單不動', () => {
    expect(autoMarkPlan('submit', PR, false, bills)).toEqual({ mark: [], revert: [], release: false, revertReason: null });
  });
  it('退回：只回復因這張請款單自動標記的；手動標記與別張請款單標的不動；明細保留（不釋放）', () => {
    const p = autoMarkPlan('return', PR, true, bills);
    expect(p.revert).toEqual(['auto1']);
    expect(p.release).toBe(false);
    expect(p.revertReason).toBe('RETURN');
    expect(p.mark).toEqual([]);
  });
  it('作廢（含已付款後作廢）：同退回，並釋放明細', () => {
    const p = autoMarkPlan('void', PR, true, bills);
    expect(p.revert).toEqual(['auto1']);
    expect(p.release).toBe(true);
    expect(p.revertReason).toBe('VOID');
    expect(autoMarkPlan('void', PR, false, [{ id: 'm', paid_at: '2038-03-01', paid_by_pr_id: null }]).revert).toEqual([]);
    expect(autoMarkPlan('void', PR, false, [{ id: 'm', paid_at: '2038-03-01', paid_by_pr_id: null }]).release).toBe(true);
  });
  it('會計標已付款：帳單不動', () => {
    expect(autoMarkPlan('mark_paid', PR, true, bills)).toEqual({ mark: [], revert: [], release: false, revertReason: null });
  });
  it('手動標記、改回待繳、改日期一律清掉 paid_by_pr_id；沒變就保留', () => {
    const before = { paid_at: '2038-03-05', paid_by_pr_id: PR };
    expect(afterManualPaidChange(before, null)).toBeNull();
    expect(afterManualPaidChange(before, '2038-03-09')).toBeNull();
    expect(afterManualPaidChange(before, '2038-03-05')).toBe(PR);
    expect(afterManualPaidChange({ paid_at: null, paid_by_pr_id: null }, '2038-03-05')).toBeNull();
  });
  it('作廢已付款單的確認文字（D6）', () => expect(voidPaidWarning).toContain('款項已付'));
});

describe('輸入驗證', () => {
  it('帳單月份：YYYY-MM 或 YYYY-MM-01', () => {
    expect(normalizeBillMonth('2038-03')).toBe('2038-03-01');
    expect(normalizeBillMonth('2038-03-01')).toBe('2038-03-01');
    expect(normalizeBillMonth('2038-03-15')).toBeNull();
    expect(normalizeBillMonth('2038-13')).toBeNull();
    expect(normalizeBillMonth('')).toBeNull();
    expect(normalizeBillMonth(null)).toBeNull();
  });
  it('建立：必填單位與月份；bill_ids 去重、最多 200、須為 uuid；自動標記必須是布林；欄位白名單', () => {
    const ok = validateUtilityCreatePayload({ source: 'UTILITY', vendor_id: V, bill_month: '2038-03', notes: ' 備註 ' });
    expect(ok).toEqual({ vendor_id: V, bill_month: '2038-03', notes: '備註' });
    expect(validateUtilityCreatePayload({ vendor_id: V, bill_month: '2038-03-01', bill_ids: [V2, V2, V], auto_mark_paid: false, expected_pay_date: '2038-04-10' })).toMatchObject({ bill_ids: [V2, V], auto_mark_paid: false, expected_pay_date: '2038-04-10' });
    expect(() => validateUtilityCreatePayload({ bill_month: '2038-03' })).toThrow('請選擇繳費單位');
    expect(() => validateUtilityCreatePayload({ vendor_id: V })).toThrow('帳單月份');
    expect(() => validateUtilityCreatePayload({ vendor_id: V, bill_month: '2038-03', bill_ids: [] })).toThrow('至少選擇一張');
    expect(() => validateUtilityCreatePayload({ vendor_id: V, bill_month: '2038-03', bill_ids: ['x'] })).toThrow('格式錯誤');
    expect(() => validateUtilityCreatePayload({ vendor_id: V, bill_month: '2038-03', bill_ids: Array.from({ length: 201 }, () => V) })).toThrow('200');
    expect(() => validateUtilityCreatePayload({ vendor_id: V, bill_month: '2038-03', auto_mark_paid: 'yes' })).toThrow('格式錯誤');
    expect(() => validateUtilityCreatePayload({ vendor_id: V, bill_month: '2038-03', lines: [] })).toThrow('不支援的欄位：lines');
    expect(() => validateUtilityCreatePayload({ vendor_id: V, bill_month: '2038-03', expected_pay_date: '2038-02-31' })).toThrow('預計付款日');
    expect(() => validateUtilityCreatePayload({ vendor_id: V, bill_month: '2038-03', notes: 'x'.repeat(501) })).toThrow('不可超過 500');
  });
  it('修改：至少一項、欄位白名單、refresh 與 auto_mark_paid 必須是布林', () => {
    expect(validateUtilityUpdatePayload({ bill_ids: [V], auto_mark_paid: false, notes: '', expected_pay_date: '' })).toEqual({ bill_ids: [V], auto_mark_paid: false, notes: null, expected_pay_date: null });
    expect(validateUtilityUpdatePayload({ refresh: true })).toEqual({ refresh: true });
    expect(() => validateUtilityUpdatePayload({})).toThrow('沒有要修改');
    expect(() => validateUtilityUpdatePayload({ lines: [] })).toThrow('不支援的欄位');
    expect(() => validateUtilityUpdatePayload({ bill_ids: [] })).toThrow('至少選擇一張');
    expect(() => validateUtilityUpdatePayload({ refresh: 'x' })).toThrow('格式錯誤');
  });
  it('候選參數與補填繳費單位與帳單列表新篩選', () => {
    expect(parseCandidateParams(new URLSearchParams(`month=2038-03&vendor_id=${V}&pr_id=${PR}`))).toEqual({ month: '2038-03', vendor_id: V, pr_id: PR });
    expect(parseCandidateParams(new URLSearchParams('month=2038-03'))).toEqual({ month: '2038-03' });
    expect(() => parseCandidateParams(new URLSearchParams(''))).toThrow('帳單月份');
    expect(() => parseCandidateParams(new URLSearchParams('month=2038-03&vendor_id=zz'))).toThrow('繳費單位格式錯誤');
    expect(validateSetPayee({ ids: [V, V, V2], vendor_id: PR })).toEqual({ ids: [V, V2], vendor_id: PR });
    expect(() => validateSetPayee({ ids: [], vendor_id: PR })).toThrow('請選擇要補填');
    expect(() => validateSetPayee({ ids: [V] })).toThrow('請選擇繳費單位');
    expect(() => validateSetPayee({ ids: Array.from({ length: 201 }, () => V), vendor_id: PR })).toThrow('200');
    expect(parseUtilityBillExtraFilters(new URLSearchParams(`request=none&payee=${V}`))).toEqual({ request: 'none', payee: V });
    expect(parseUtilityBillExtraFilters(new URLSearchParams('request=in_request&payee=none'))).toEqual({ request: 'in_request', payee: 'none' });
    expect(parseUtilityBillExtraFilters(new URLSearchParams(''))).toEqual({});
    expect(() => parseUtilityBillExtraFilters(new URLSearchParams('request=x'))).toThrow('請款狀態');
    expect(() => parseUtilityBillExtraFilters(new URLSearchParams('payee=x'))).toThrow('繳費單位');
  });
});

describe('帳單儲存的繳費單位欄位（不動 G23 的 15 個欄位白名單）', () => {
  it('沒帶就不處理；空值清空；uuid 保留；格式錯誤擋下', () => {
    expect(pickPayeeField({ amount: 5 })).toEqual({});
    expect(pickPayeeField({ payee_vendor_id: null })).toEqual({ payee_vendor_id: null });
    expect(pickPayeeField({ payee_vendor_id: '  ' })).toEqual({ payee_vendor_id: null });
    expect(pickPayeeField({ payee_vendor_id: ` ${V} ` })).toEqual({ payee_vendor_id: V });
    expect(() => pickPayeeField({ payee_vendor_id: 'abc' })).toThrow('繳費單位格式錯誤');
  });
});

describe('權限矩陣（U7）：建立、修改、送出需請款管理＋水電管理；退回、作廢、標已付款只要請款管理；明細需水電檢視；統編銀行需廠商檢視；管理員身分不放行', () => {
  const cases: Array<[string, string[], Record<string, unknown>]> = [
    ['總務（兩個管理）', [PAYM, PAYV, UBM, UBV, VENV], { canCreateUtility: true, billsVisible: true, vendorVisible: true, canView: true }],
    ['只有請款管理', [PAYM], { canCreateUtility: false, billsVisible: false, vendorVisible: false, canView: true }],
    ['只有水電管理', [UBM], { canCreateUtility: false, billsVisible: true, canView: false, canManage: false }],
    ['會計（請款管理＋水電檢視＋廠商檢視）', [PAYM, PAYV, UBV, VENV], { canCreateUtility: false, billsVisible: true, vendorVisible: true, canManage: true }],
    ['只有請款檢視', [PAYV], { canCreateUtility: false, canView: true, canManage: false, billsVisible: false }],
    ['只有水電檢視', [UBV], { canView: false, billsVisible: true, canCreateUtility: false }],
    ['無任何權限（管理員身分、店長）', [], { canView: false, canManage: false, billsVisible: false, canCreateUtility: false }],
  ];
  it.each(cases)('%s', (_n, codes, expected) => expect(utilityPaymentAbilities(perms(...codes))).toMatchObject(expected));
  it('缺哪個（給畫面反灰說明）', () => {
    expect(utilityPaymentAbilities(perms(PAYM)).missingForCreate).toEqual(['水電話網費管理']);
    expect(utilityPaymentAbilities(perms(UBM)).missingForCreate).toEqual(['請款管理']);
    expect(utilityPaymentAbilities(perms()).missingForCreate).toEqual(['請款管理', '水電話網費管理']);
    expect(utilityPaymentAbilities(perms(PAYM, UBM)).missingForCreate).toEqual([]);
  });
  it('動作權限：送出需兩個；退回、作廢、標已付款、備註只要請款管理', () => {
    expect(utilityActionAllowed('submit', perms(PAYM, UBM))).toEqual({ ok: true, missing: [] });
    expect(utilityActionAllowed('submit', perms(PAYM))).toEqual({ ok: false, missing: ['水電話網費管理'] });
    expect(utilityActionAllowed('submit', perms(UBM))).toEqual({ ok: false, missing: ['請款管理', '水電話網費管理'].filter((x) => x === '請款管理') });
    for (const a of ['return', 'void', 'mark_paid', 'note', 'refresh_bank']) {
      expect(utilityActionAllowed(a, perms(PAYM)).ok, a).toBe(true);
      expect(utilityActionAllowed(a, perms(UBM)).ok, a).toBe(false);
      expect(utilityActionAllowed(a, perms(PAYV, UBV)).ok, a).toBe(false);
    }
  });
});

describe('遮蔽', () => {
  it('沒有水電檢視：去掉明細並標 bills_masked；採購單與有權限者原樣', () => {
    const row = { source: 'UTILITY', id: 'x', bill_lines: [{ id: 1 }], amount_total: 10 };
    expect(maskUtilityRequest(row, false)).toEqual({ source: 'UTILITY', id: 'x', amount_total: 10, bills_masked: true });
    expect(maskUtilityRequest(row, true)).toBe(row);
    const p = { source: 'PURCHASE', lines: [1] };
    expect(maskUtilityRequest(p, false)).toBe(p);
  });
});

describe('對帳 CSV（水電話費）', () => {
  const row = {
    pr_no: 'PY-20381201-001', status: 'PAID', vendor_name: '台灣電力公司', vendor_tax_id: '03000000', bill_month: '2038-03-01', location_name: 'VW 測試門市', expense_type: 'ELECTRICITY',
    identifier: '00123', amount_total: 1250, paid_date: '2038-03-20', pay_method: 'TRANSFER', paid_ref: 'REF', submitted_by_name: '王總務', submitted_at: '2038-03-10T02:00:00Z', paid_by_name: '陳會計', paid_at: '2038-03-20T05:00:00Z', auto_mark_paid: true,
  };
  it('欄位順序與有權限時多統編欄', () => {
    expect(utilityExportColumns(false).map((c) => c.header)).toEqual(['請款單號', '狀態', '繳費單位', '帳單月份', '門市', '費用類型', '電號／水號／用戶號碼', '帳單金額', '付款日期', '付款方式', '付款參考號', '總務請款人', '請款時間', '付款人', '付款時間', '送出後自動標記已繳']);
    expect(utilityExportColumns(true).map((c) => c.header).slice(0, 5)).toEqual(['請款單號', '狀態', '繳費單位', '統編', '帳單月份']);
  });
  it('內容：UTF-8 BOM、狀態與費用類型中文、金額數字、識別號碼與統編輸出文字格式（保留前導 0）、自動標記是否', () => {
    const csv = buildUtilityExportCsv([row], true);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('PY-20381201-001,已付款,台灣電力公司,"=""03000000""",2038-03,VW 測試門市,電費,"=""00123""",1250,2038-03-20,轉帳,REF,王總務,2038-03-10 10:00,陳會計,2038-03-20 13:00,是');
  });
  it('沒有廠商權限：整欄省略（不是留空欄）；統編不出現在任何位置', () => {
    const csv = buildUtilityExportCsv([row], false);
    expect(csv).not.toContain('統編');
    expect(csv).not.toContain('03000000');
    expect(csv.split('\r\n')[0].split(',')).toHaveLength(16);
  });
  it('公式注入：以 = + - @ 開頭的文字前補單引號；沒有帳單明細的列（遮蔽）欄位留空', () => {
    const csv = buildUtilityExportCsv([{ ...row, vendor_name: '=HYPERLINK("x")', location_name: '+cmd', paid_ref: '@x', submitted_by_name: '-1+1' }, { pr_no: 'PY-2', status: 'DRAFT', vendor_name: 'A', amount_total: 5, bills_masked: true }], false);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'@x");
    expect(csv).toContain("'-1+1");
    expect(csv.trim().split('\r\n')[2]).toMatch(/^PY-2,草稿,A,,,,,5,/);
    expect(utilityExportFileName('2038-03')).toBe('水電話費請款對帳-2038-03.csv');
  });
});

describe('列印明細', () => {
  it('欄位：門市、費用類型、帳單月份、電號／水號／用戶號碼、金額（沒有採購單、進貨單、發票、未稅、稅額）', () => {
    expect(UTILITY_PRINT_HEADERS).toEqual(['門市', '費用類型', '帳單月份', '電號／水號／用戶號碼', '金額']);
    expect(utilityPrintRow({ location_name: 'ZT 測試門市 01', expense_type: 'WATER', billing_month: '2038-03-01', identifier: 'W-77', claim_total: '1234' })).toEqual(['ZT 測試門市 01', '水費', '2038-03', 'W-77', '1234']);
    expect(utilityPrintRow({})).toEqual(['', '', '', '', '0']);
    expect(identifierHeader('ELECTRICITY')).toBe('電號');
    expect(identifierHeader('WATER')).toBe('水號');
  });
});

describe('錯誤白話', () => {
  it('補上「下一步怎麼做」，已有就不重複；未知代碼原樣', () => {
    expect(utilityErrorMessage('BILL_MISSING_ATTACHMENT', '有 2 張帳單還沒有附件')).toContain('請先到水電帳單上傳帳單照片或 PDF');
    const once = utilityErrorMessage('BILL_CHANGED', '帳單金額已被修改');
    expect(utilityErrorMessage('BILL_CHANGED', once)).toBe(once);
    expect(utilityErrorMessage('STALE', '請重新載入')).toBe('請重新載入');
    expect(payErrorMessage('PAID_TOO_EARLY', 'x')).toBe('x');
  });
});
