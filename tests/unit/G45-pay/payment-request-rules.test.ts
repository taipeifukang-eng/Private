import { describe, expect, it } from 'vitest';
import {
  EXPORT_MAX_ROWS, PAY_METHODS, PR_ACTIONS, PR_STATUSES, availableActions, buildCsv, buildExportCsv, canTransition, checkClaimLimit, csvCell, exportColumns, exportFileName, formatPrNo,
  holdsQuota, isEditable, isLocked, isPrNo, lineDiffReasonRequired, maskRequest, nextStatus, parseRequestFilters, validateActionPayload, validateCreatePayload, validateLines,
  validateSettings, validateUpdatePayload, voidReasonRequired, type PrAction, type PrStatus,
} from '@/lib/workspace/general-affairs/payment-request-rules';

// 第 4.5 批 G45-unit（請款部分）：狀態轉移合法表與非法轉移、累計上限與尾差邊界（5 免、6 要原因、可調整）、短收以累計驗入計、請款單號格式、
// CSV 公式注入與欄位、已付款鎖定規則、輸入驗證、機密遮蔽。沒有核准關卡（P3），申請人可自己標已付款（P4）。
const U = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';

describe('狀態機', () => {
  const legal: Array<[PrStatus, PrAction, PrStatus]> = [
    ['DRAFT', 'submit', 'SUBMITTED'], ['SUBMITTED', 'return', 'DRAFT'], ['SUBMITTED', 'mark_paid', 'PAID'],
    ['DRAFT', 'void', 'VOID'], ['SUBMITTED', 'void', 'VOID'], ['PAID', 'void', 'VOID'],
    ['DRAFT', 'note', 'DRAFT'], ['SUBMITTED', 'note', 'SUBMITTED'], ['PAID', 'note', 'PAID'], ['DRAFT', 'refresh_bank', 'DRAFT'],
  ];
  it.each(legal)('%s + %s -> %s', (from, action, to) => {
    expect(nextStatus(from, action)).toBe(to);
    expect(canTransition(from, action)).toBe(true);
  });
  it('其餘組合全部非法（共 24 組，合法 10 組）', () => {
    let illegal = 0;
    for (const s of PR_STATUSES) for (const a of PR_ACTIONS) {
      const ok = legal.some(([f, ac]) => f === s && ac === a);
      expect(canTransition(s, a)).toBe(ok);
      if (!ok) illegal += 1;
    }
    expect(illegal).toBe(14);
  });
  it('沒有核准關卡：草稿不能直接標已付款，已作廢什麼都不能做', () => {
    expect(canTransition('DRAFT', 'mark_paid')).toBe(false);
    for (const a of PR_ACTIONS) expect(canTransition('VOID', a)).toBe(false);
    expect((PR_ACTIONS as readonly string[]).includes('approve')).toBe(false);
  });
  it('已付款鎖定：不能退回、不能重付、不能改內容，只能備註與作廢', () => {
    expect(isLocked('PAID')).toBe(true);
    expect(isEditable('PAID')).toBe(false);
    expect(availableActions('PAID', true).sort()).toEqual(['note', 'void']);
    expect(canTransition('PAID', 'return')).toBe(false);
    expect(canTransition('PAID', 'mark_paid')).toBe(false);
  });
  it('只有草稿可編輯；已送出要先退回', () => {
    expect(isEditable('DRAFT')).toBe(true);
    expect(isEditable('SUBMITTED')).toBe(false);
    expect(availableActions('SUBMITTED', true).sort()).toEqual(['mark_paid', 'note', 'return', 'void']);
    expect(availableActions('DRAFT', true).sort()).toEqual(['note', 'refresh_bank', 'submit', 'void']);
  });
  it('沒有管理權限一律沒有動作（P4：只分 view 與 manage）', () => {
    for (const s of PR_STATUSES) expect(availableActions(s, false)).toEqual([]);
  });
  it('作廢原因：已送出與已付款必填，草稿可不填；作廢釋放額度', () => {
    expect(voidReasonRequired('DRAFT')).toBe(false);
    expect(voidReasonRequired('SUBMITTED')).toBe(true);
    expect(voidReasonRequired('PAID')).toBe(true);
    expect(holdsQuota('VOID')).toBe(false);
    for (const s of ['DRAFT', 'SUBMITTED', 'PAID'] as const) expect(holdsQuota(s)).toBe(true);
  });
});

describe('累計請款上限與尾差', () => {
  it('剛好等於累計驗入含稅額可以；加 5 元尾差仍可；超過 1 元擋下', () => {
    expect(checkClaimLimit(1000, 0, 1000).ok).toBe(true);
    expect(checkClaimLimit(1000, 0, 1005, 5).ok).toBe(true);
    const over = checkClaimLimit(1000, 0, 1006, 5);
    expect(over.ok).toBe(false);
    expect(over.overBy).toBe(1);
  });
  it('分批請款：已請款累計計入，剩餘額度不低於 0', () => {
    expect(checkClaimLimit(1000, 400, 600).ok).toBe(true);
    expect(checkClaimLimit(1000, 400, 606).ok).toBe(false);
    expect(checkClaimLimit(1000, 400, 0).remaining).toBe(605);
    expect(checkClaimLimit(1000, 2000, 0).remaining).toBe(0);
  });
  it('短收以累計驗入計：訂 10 只收 6，累計驗入含稅額 630，最多請 635', () => {
    const received = 630; // 6 件 x 100 x 1.05
    expect(checkClaimLimit(received, 0, 635).ok).toBe(true);
    expect(checkClaimLimit(received, 0, 1050).ok).toBe(false);
  });
  it('尾差可調整：調成 0 不容許，調成 100 容許到 100', () => {
    expect(checkClaimLimit(1000, 0, 1001, 0).ok).toBe(false);
    expect(checkClaimLimit(1000, 0, 1100, 100).ok).toBe(true);
    expect(checkClaimLimit(1000, 0, 1101, 100).ok).toBe(false);
  });
  it('明細差異原因：5 元內免填、6 元要填、可調整', () => {
    expect(lineDiffReasonRequired(1000, 1005)).toBe(false);
    expect(lineDiffReasonRequired(1000, 995)).toBe(false);
    expect(lineDiffReasonRequired(1000, 1006)).toBe(true);
    expect(lineDiffReasonRequired(1000, 994)).toBe(true);
    expect(lineDiffReasonRequired(1000, 1010, 10)).toBe(false);
    expect(lineDiffReasonRequired(1000, 1011, 10)).toBe(true);
  });
});

describe('請款單號', () => {
  it('格式 PY-YYYYMMDD-NNN，三位數補零，超過 999 照實際位數', () => {
    expect(formatPrNo('2038-03-05', 1)).toBe('PY-20380305-001');
    expect(formatPrNo('2038-03-05', 42)).toBe('PY-20380305-042');
    expect(formatPrNo('2038-03-05', 999)).toBe('PY-20380305-999');
    expect(formatPrNo('2038-03-05', 1000)).toBe('PY-20380305-1000');
  });
  it('isPrNo 只認正確格式', () => {
    expect(isPrNo('PY-20380305-001')).toBe(true);
    expect(isPrNo('PY-20380305-1000')).toBe(true);
    for (const bad of ['PY-2038305-001', 'py-20380305-001', 'PY-20380305-01', 'PO-20380305-001', '', null]) expect(isPrNo(bad)).toBe(false);
  });
});

describe('CSV', () => {
  it('公式注入：以 = + - @ Tab CR 開頭的字串前補單引號；數字不處理', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(1234)).toBe('1234');
    expect(csvCell('正常廠商')).toBe('正常廠商');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
  it('含逗號、引號、換行的欄位加雙引號並跳脫', () => {
    expect(csvCell('甲,乙')).toBe('"甲,乙"');
    expect(csvCell('他說"好"')).toBe('"他說""好"""');
    expect(csvCell('一\n二')).toBe('"一\n二"');
  });
  it('buildCsv 以 UTF-8 BOM 開頭、CRLF 換行、結尾換行', () => {
    const csv = buildCsv([{ a: 1, b: '=x' }], [{ header: 'A', value: (r) => r.a }, { header: 'B', value: (r) => r.b }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe("A,B\r\n1,'=x\r\n");
  });
  const row = {
    pr_no: 'PY-20380305-001', status: 'PAID', created_at: '2038-03-05T01:00:00Z', vendor_name: '=惡意廠商', vendor_tax_id: '12345678', bank_name: '某銀行', bank_account: '000111222',
    po_no: 'PO-1', receipt_no: 'RC-1', invoice_no: 'AB99999999', amount_untaxed: 1000, tax_amount: 50, claim_total: 1050, paid_date: '2038-03-06', pay_method: 'TRANSFER', paid_ref: '88888',
    submitted_by_name: '總務甲', submitted_at: '2038-03-05T02:00:00Z', paid_by_name: '會計乙', paid_at: '2038-03-06T02:30:00Z',
  };
  it('有廠商權限：含統編與銀行欄；欄位與內容正確，台北時間', () => {
    const cols = exportColumns(true).map((c) => c.header);
    expect(cols).toEqual(expect.arrayContaining(['廠商統編', '銀行', '帳號', '請款金額', '總務請款人', '付款人']));
    const csv = buildExportCsv([row], true);
    const [head, line] = csv.slice(1).split('\r\n');
    expect(head.split(',')).toEqual(cols);
    expect(line).toContain("'=惡意廠商");
    expect(line).toContain('PY-20380305-001,已付款,2038-03-05');
    expect(line).toContain('"=""12345678""",某銀行,"=""000111222"""'); // 統編與帳號輸出成文字格式，保留前導 0
    expect(line).toContain('1050,2038-03-06,轉帳,88888,總務甲,2038-03-05 10:00,會計乙,2038-03-06 10:30');
  });
  it('沒有廠商權限：統編與銀行整欄省略，不是留空欄', () => {
    const cols = exportColumns(false).map((c) => c.header);
    for (const h of ['廠商統編', '銀行', '帳號']) expect(cols).not.toContain(h);
    const csv = buildExportCsv([{ ...row, vendor_tax_id: null, bank_name: null, bank_account: null }], false);
    expect(csv).not.toContain('12345678');
    expect(csv).not.toContain('某銀行');
  });
  it('檔名與上限', () => {
    expect(exportFileName('2038-03')).toBe('請款對帳-2038-03.csv');
    expect(EXPORT_MAX_ROWS).toBe(5000);
  });
});

describe('輸入驗證', () => {
  const line = { receipt_id: U };
  it('建立：廠商與明細必填；不認識的欄位 400', () => {
    expect(() => validateCreatePayload({ lines: [line] })).toThrow('請選擇廠商');
    expect(() => validateCreatePayload({ vendor_id: V, lines: [] })).toThrow('請至少選擇一筆進貨');
    expect(() => validateCreatePayload({ vendor_id: V, lines: [line], status: 'PAID' })).toThrow('不支援的欄位');
    const ok = validateCreatePayload({ vendor_id: V, lines: [line], notes: '  備註 ', expected_pay_date: '2038-03-31' });
    expect(ok).toMatchObject({ vendor_id: V, notes: '備註', expected_pay_date: '2038-03-31' });
    expect(() => validateCreatePayload({ vendor_id: V, lines: [line], expected_pay_date: '2038-02-30' })).toThrow('預計付款日格式錯誤');
  });
  it('明細：金額整數、最多 100 筆、不認識的欄位擋下', () => {
    expect(() => validateLines([{ receipt_id: 'x' }])).toThrow('進貨單格式錯誤');
    expect(() => validateLines([{ receipt_id: U, claim_untaxed: 1.5 }])).toThrow('必須是 0 以上的整數');
    expect(() => validateLines([{ receipt_id: U, claim_untaxed: -1 }])).toThrow('必須是 0 以上的整數');
    expect(() => validateLines([{ receipt_id: U, amount_total: 5 }])).toThrow('不支援的明細欄位');
    expect(() => validateLines(Array.from({ length: 101 }, () => line))).toThrow('最多 100 筆');
    expect(validateLines([{ receipt_id: U, invoice_id: V, claim_untaxed: '1,000', claim_tax: 50, diff_reason: ' 原因 ' }])[0]).toMatchObject({ claim_untaxed: 1000, claim_tax: 50, diff_reason: '原因', invoice_id: V });
  });
  it('修改：至少一項、lines 整批取代', () => {
    expect(() => validateUpdatePayload({})).toThrow('沒有要修改的內容');
    expect(() => validateUpdatePayload({ status: 'PAID' })).toThrow('不支援的欄位');
    expect(validateUpdatePayload({ notes: '' })).toEqual({ notes: null });
  });
  it('退回必填原因；作廢原因依狀態；備註必填', () => {
    expect(() => validateActionPayload('return', 'SUBMITTED', {})).toThrow('請填寫退回原因');
    expect(validateActionPayload('return', 'SUBMITTED', { reason: ' 金額錯 ' })).toEqual({ reason: '金額錯' });
    expect(() => validateActionPayload('void', 'PAID', {})).toThrow('請填寫作廢原因');
    expect(() => validateActionPayload('void', 'SUBMITTED', { reason: '' })).toThrow('請填寫作廢原因');
    expect(validateActionPayload('void', 'DRAFT', {})).toEqual({ reason: null });
    expect(() => validateActionPayload('note', 'PAID', {})).toThrow('請填寫備註內容');
    expect(() => validateActionPayload('return', 'SUBMITTED', { reason: 'x'.repeat(201) })).toThrow('不可超過 200');
  });
  it('標已付款：付款方式限三種、日期不可未來', () => {
    const now = new Date('2038-03-05T04:00:00Z');
    for (const m of PAY_METHODS) expect(validateActionPayload('mark_paid', 'SUBMITTED', { pay_method: m.toLowerCase() }, now).pay_method).toBe(m);
    expect(() => validateActionPayload('mark_paid', 'SUBMITTED', { pay_method: 'CREDIT' }, now)).toThrow('轉帳、現金或支票');
    expect(() => validateActionPayload('mark_paid', 'SUBMITTED', {}, now)).toThrow('轉帳、現金或支票');
    expect(() => validateActionPayload('mark_paid', 'SUBMITTED', { pay_method: 'CASH', paid_date: '2038-03-06' }, now)).toThrow('不能是未來');
    expect(validateActionPayload('mark_paid', 'SUBMITTED', { pay_method: 'CASH', paid_date: '2038-03-05', paid_ref: ' 123 ' }, now)).toEqual({ pay_method: 'CASH', paid_date: '2038-03-05', paid_ref: '123' });
    expect(validateActionPayload('mark_paid', 'SUBMITTED', { pay_method: 'CHECK' }, now).paid_date).toBeNull();
  });
  it('篩選：狀態、月份、uuid 格式', () => {
    expect(parseRequestFilters(new URLSearchParams('status=paid&month=2038-03&vendorId=' + V + '&mine=1&q=甲'))).toEqual({ status: 'PAID', month: '2038-03', vendor_id: V, mine: true, search: '甲' });
    expect(() => parseRequestFilters(new URLSearchParams('status=OK'))).toThrow('狀態篩選值錯誤');
    expect(() => parseRequestFilters(new URLSearchParams('month=2038-13'))).toThrow('YYYY-MM');
    expect(() => parseRequestFilters(new URLSearchParams('vendorId=abc'))).toThrow('格式錯誤');
  });
  it('設定：尾差 0 至 100 整數；統編 8 碼；沒有 approve 之類的設定', () => {
    expect(validateSettings({ tolerance_amount: '0' })).toEqual({ tolerance_amount: 0 });
    expect(validateSettings({ tolerance_amount: 100 })).toEqual({ tolerance_amount: 100 });
    for (const bad of ['101', '-1', '5.5', 'abc', '']) expect(() => validateSettings({ tolerance_amount: bad })).toThrow('0 到 100');
    expect(validateSettings({ buyer_title: ' 富康 ', buyer_tax_id: '12345678' })).toEqual({ buyer_title: '富康', buyer_tax_id: '12345678' });
    expect(validateSettings({ buyer_tax_id: '' })).toEqual({ buyer_tax_id: null });
    expect(() => validateSettings({ buyer_tax_id: '1234' })).toThrow('8 碼數字');
    expect(() => validateSettings({ approval_threshold: 1 })).toThrow('不支援的設定');
    expect(() => validateSettings({})).toThrow('沒有要修改的設定');
  });
});

describe('機密遮蔽', () => {
  const r = { id: 'a', vendor_tax_id_snapshot: '12345678', bank_snapshot: { bank_account: '1' }, vendor_masked: false };
  it('沒有廠商權限：統編置空、銀行清空並標記遮蔽；有權限原樣', () => {
    expect(maskRequest(r, true)).toBe(r);
    expect(maskRequest(r, false)).toEqual({ id: 'a', vendor_tax_id_snapshot: null, bank_snapshot: {}, vendor_masked: true });
  });
});
