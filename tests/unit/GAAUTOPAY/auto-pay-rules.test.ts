import { describe, expect, it } from 'vitest';
import {
  AUTO_PAY_DEFAULT_METHOD, AUTO_PAY_REASON, autoPayDateSource, autoPayHint, autoPayMethod, autoPaidLabel, canCancelAutoPay, isAutoPaid, isAutoPayDue, planAutoPay, resolveAutoPayDate, validateCancelAutoPayPayload,
  type AutoPayInput,
} from '@/lib/workspace/general-affairs/auto-pay-rules';

// 付款日到期自動標記已付款（純函式；與資料庫 ga_pay_auto_pay_date／ga_apply_due_payment_requests／ga_ws_pay_request_cancel_auto_pay 逐條對齊）。
const util = (extra: Partial<AutoPayInput> = {}): AutoPayInput => ({ status: 'SUBMITTED', source: 'UTILITY', expected_pay_date: null, bill_due_dates: ['2038-03-20', '2038-03-10', '2038-03-31'], auto_pay_off: false, pay_method: null, ...extra });
const purchase = (extra: Partial<AutoPayInput> = {}): AutoPayInput => ({ status: 'SUBMITTED', source: 'PURCHASE', expected_pay_date: null, ...extra });

describe('日期判定', () => {
  it('有 expected_pay_date 就用它（水電與採購都一樣，不看帳單期限）', () => {
    expect(resolveAutoPayDate(util({ expected_pay_date: '2038-03-25' }))).toBe('2038-03-25');
    expect(resolveAutoPayDate(purchase({ expected_pay_date: '2038-04-01' }))).toBe('2038-04-01');
    expect(autoPayDateSource(util({ expected_pay_date: '2038-03-25' }))).toBe('expected_pay_date');
  });
  it('水電沒填預計付款日：用所含帳單最早的繳費期限', () => {
    expect(resolveAutoPayDate(util())).toBe('2038-03-10');
    expect(autoPayDateSource(util())).toBe('bill_due_date');
  });
  it('水電帳單有些沒期限（null、空字串、不合法日期）就略過，只看有期限的', () => {
    expect(resolveAutoPayDate(util({ bill_due_dates: [null, '', undefined, '2038-02-30', '2038-03-15'] }))).toBe('2038-03-15');
  });
  it('水電帳單全部沒期限且沒填預計付款日：沒有付款日（不自動）', () => {
    expect(resolveAutoPayDate(util({ bill_due_dates: [null, null] }))).toBeNull();
    expect(resolveAutoPayDate(util({ bill_due_dates: [] }))).toBeNull();
    expect(resolveAutoPayDate(util({ bill_due_dates: undefined }))).toBeNull();
  });
  it('採購沒有 expected_pay_date：不處理（就算帶了帳單期限也不採用）', () => {
    expect(resolveAutoPayDate(purchase())).toBeNull();
    expect(resolveAutoPayDate({ source: 'PURCHASE', expected_pay_date: null, bill_due_dates: ['2038-01-01'] })).toBeNull();
    expect(resolveAutoPayDate({ expected_pay_date: '' })).toBeNull();
    expect(autoPayDateSource(purchase())).toBeNull();
  });
});

describe('排程判斷 planAutoPay', () => {
  it('付款日剛好是今天就到期（含當天）；明天才算還沒到期', () => {
    expect(planAutoPay(util({ expected_pay_date: '2038-03-10' }), '2038-03-10').mark).toBe(true);
    expect(planAutoPay(util({ expected_pay_date: '2038-03-10' }), '2038-03-09')).toMatchObject({ mark: false, skip: 'NOT_DUE' });
    expect(isAutoPayDue(util(), '2038-03-10')).toBe(true);
  });
  it('paid_date 是付款日，不是執行日（過了好幾天才執行也記付款日）', () => {
    const p = planAutoPay(util({ expected_pay_date: '2038-03-10' }), '2038-03-15');
    expect(p).toMatchObject({ mark: true, paid_date: '2038-03-10', reason: AUTO_PAY_REASON });
  });
  it('只處理 SUBMITTED：草稿、已付款、已作廢都不處理', () => {
    for (const status of ['DRAFT', 'PAID', 'VOID']) expect(planAutoPay(util({ status, expected_pay_date: '2038-03-01' }), '2038-03-10')).toMatchObject({ mark: false, skip: 'NOT_SUBMITTED' });
  });
  it('採購沒有預計付款日不處理；有預計付款日且到期就處理', () => {
    expect(planAutoPay(purchase(), '2038-12-31')).toMatchObject({ mark: false, skip: 'NO_DATE' });
    expect(planAutoPay(purchase({ expected_pay_date: '2038-03-10' }), '2038-03-10').mark).toBe(true);
  });
  it('pay_method 預設：單上已選就用，沒選（空、null、空白）記 TRANSFER', () => {
    expect(AUTO_PAY_DEFAULT_METHOD).toBe('TRANSFER');
    expect(autoPayMethod(null)).toBe('TRANSFER');
    expect(autoPayMethod('')).toBe('TRANSFER');
    expect(autoPayMethod('  ')).toBe('TRANSFER');
    expect(autoPayMethod('CASH')).toBe('CASH');
    expect(autoPayMethod('check')).toBe('CHECK');
    expect(planAutoPay(util({ pay_method: 'CHECK' }), '2038-03-10').pay_method).toBe('CHECK');
    expect(planAutoPay(util({ pay_method: null }), '2038-03-10').pay_method).toBe('TRANSFER');
  });
  it('冪等：標記成已付款後再跑一次不會再處理；同一個輸入重複判斷結果相同', () => {
    const before = util();
    const first = planAutoPay(before, '2038-03-10');
    expect(first.mark).toBe(true);
    const after = { ...before, status: 'PAID' };
    expect(planAutoPay(after, '2038-03-10').mark).toBe(false);
    expect(planAutoPay(after, '2038-03-11').mark).toBe(false);
    expect(planAutoPay(before, '2038-03-10')).toEqual(first);
  });
  it('取消自動付款後不會被立刻再標回：auto_pay_off 的單就算付款日早就過了也不處理', () => {
    const cancelled = util({ expected_pay_date: '2038-01-01', auto_pay_off: true });
    expect(planAutoPay(cancelled, '2038-03-10')).toMatchObject({ mark: false, skip: 'AUTO_OFF' });
    expect(planAutoPay(cancelled, '2039-01-01').mark).toBe(false);
    // 沒取消過的同一張單會被處理，證明是旗標在擋
    expect(planAutoPay({ ...cancelled, auto_pay_off: false }, '2038-03-10').mark).toBe(true);
  });
});

describe('取消自動付款', () => {
  it('只限系統自動標記的已付款單，且要有請款管理權限', () => {
    expect(canCancelAutoPay({ status: 'PAID', paid_auto: true }, true)).toBe(true);
    expect(canCancelAutoPay({ status: 'PAID', paid_auto: true }, false)).toBe(false);
    expect(canCancelAutoPay({ status: 'PAID', paid_auto: false }, true)).toBe(false);
    expect(canCancelAutoPay({ status: 'PAID' }, true)).toBe(false);
    expect(canCancelAutoPay({ status: 'SUBMITTED', paid_auto: true }, true)).toBe(false);
    expect(canCancelAutoPay({ status: 'VOID', paid_auto: true }, true)).toBe(false);
    expect(canCancelAutoPay(null, true)).toBe(false);
    expect(isAutoPaid({ status: 'PAID', paid_auto: true })).toBe(true);
    expect(isAutoPaid({ status: 'VOID', paid_auto: true })).toBe(false);
  });
  it('原因必填、最多 200 字', () => {
    expect(() => validateCancelAutoPayPayload({})).toThrow('請填寫取消自動付款的原因');
    expect(() => validateCancelAutoPayPayload({ reason: '   ' })).toThrow('請填寫取消自動付款的原因');
    expect(() => validateCancelAutoPayPayload({ reason: 'x'.repeat(201) })).toThrow('200');
    expect(validateCancelAutoPayPayload({ reason: '  還沒匯款  ' })).toEqual({ reason: '還沒匯款' });
    expect(validateCancelAutoPayPayload({ reason: 'x'.repeat(200) }).reason).toHaveLength(200);
  });
});

describe('畫面文字', () => {
  it('「系統自動標記（付款日 YYYY/MM/DD）」', () => {
    expect(autoPaidLabel({ paid_date: '2038-03-10' })).toBe('系統自動標記（付款日 2038/03/10）');
    expect(autoPaidLabel({ paid_date: '2038-03-10T00:00:00Z' })).toBe('系統自動標記（付款日 2038/03/10）');
    expect(autoPaidLabel({})).toBe('系統自動標記');
  });
  it('已送出的單提示：還沒到期、已到期、沒有付款日、已取消', () => {
    expect(autoPayHint(util({ expected_pay_date: '2038-03-25' }), '2038-03-01')).toBe('付款日 2038/03/25 到期後，系統會自動標記已付款。');
    expect(autoPayHint(util({ expected_pay_date: '2038-03-01' }), '2038-03-05')).toContain('已到期');
    expect(autoPayHint(purchase(), '2038-03-05')).toContain('沒有預計付款日');
    expect(autoPayHint(util({ auto_pay_off: true }), '2038-03-05')).toContain('已取消自動付款');
    expect(autoPayHint(util({ status: 'DRAFT' }), '2038-03-05')).toBeNull();
    expect(autoPayHint(util({ status: 'PAID' }), '2038-03-05')).toBeNull();
  });
});
