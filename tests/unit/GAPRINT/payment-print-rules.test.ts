import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPANY_TITLE, MIN_ROWS, SIGN_NOTE, SIGN_ROWS, buildPaperPrint, dayOf, dueDateOf, moneyCell, payMethodBoxes, payeeLabel, rocDate, rocDateCn, rocMonthLabel, validatePrintFieldsPayload,
} from '@/lib/workspace/general-affairs/payment-print-rules';

// 請款單紙本格式列印：純函式對應（多門市合併列與電號數、民國日期、付款方式打勾、到期日回退、補空白列到 7 列、營業稅列、抬頭預設、可編輯欄位驗證）。
const bill = (n: number, store: string | null, name: string, amount: number, extra: Record<string, unknown> = {}) => ({
  id: `b${n}`, line_no: n, store_id: store, location_name: name, expense_type: 'ELECTRICITY', billing_month: '2026-11-01', due_date: '2026-11-30', claim_total: amount, active: true, ...extra,
});
const utilityPr = (lines: ReturnType<typeof bill>[], extra: Record<string, unknown> = {}) => ({
  pr_no: 'PY-1', source: 'UTILITY', bill_month: '2026-11-01', created_at: '2026-11-24T02:00:00Z', amount_total: lines.reduce((s, l) => s + l.claim_total, 0), tax_amount: 0,
  vendor_name_snapshot: '台灣電力公司', bill_lines: lines, ...extra,
});

describe('民國日期', () => {
  it('rocDate 115/11/24、rocDateCn 115年11月30日', () => {
    expect(rocDate('2026-11-24')).toBe('115/11/24');
    expect(rocDateCn('2026-11-30')).toBe('115年11月30日');
    expect(rocDateCn('2026-01-05')).toBe('115年1月5日');
    expect(rocDate(null)).toBe('');
    expect(rocDate('不是日期')).toBe('');
  });
  it('時間戳記依台北時區換算（UTC 16:30 已是台北隔天）', () => {
    expect(dayOf('2026-11-23T16:30:00Z')).toBe('2026-11-24');
    expect(rocDate('2026-11-23T16:30:00Z')).toBe('115/11/24');
  });
  it('rocMonthLabel 帳單月份', () => {
    expect(rocMonthLabel('2026-11-01')).toBe('115年11月');
    expect(rocMonthLabel('2026-03')).toBe('115年3月');
    expect(rocMonthLabel(undefined)).toBe('');
  });
});

describe('付款方式打勾', () => {
  it('匯款、支票、零用金各打一個勾', () => {
    expect(payMethodBoxes('TRANSFER')).toMatchObject({ transfer: true, check: false, cash: false, other: false });
    expect(payMethodBoxes('CHECK')).toMatchObject({ transfer: false, check: true, cash: false, other: false });
    expect(payMethodBoxes('CASH')).toMatchObject({ transfer: false, check: false, cash: true, other: false });
  });
  it('信用卡與網購平台打「其他」並寫名稱', () => {
    expect(payMethodBoxes('CREDIT_CARD')).toMatchObject({ other: true, otherText: '信用卡', transfer: false });
    expect(payMethodBoxes('ONLINE_PLATFORM', '蝦皮')).toMatchObject({ other: true, otherText: '蝦皮' });
    expect(payMethodBoxes('ONLINE_PLATFORM')).toMatchObject({ other: true, otherText: '網購平台' });
  });
  it('未設定全部空白', () => {
    expect(payMethodBoxes(null)).toEqual({ transfer: false, check: false, cash: false, other: false, otherText: '' });
    expect(payMethodBoxes('')).toEqual({ transfer: false, check: false, cash: false, other: false, otherText: '' });
  });
});

describe('到期日回退', () => {
  it('有預計付款日就用它', () => {
    expect(dueDateOf({ expected_pay_date: '2026-12-05', bill_lines: [bill(1, 's1', 'A', 10)] })).toBe('2026-12-05');
  });
  it('沒填取所含有效帳單最早的繳費期限（略過已失效的明細）', () => {
    const lines = [bill(1, 's1', 'A', 10, { due_date: '2026-11-30' }), bill(2, 's2', 'B', 10, { due_date: '2026-11-20' }), bill(3, 's3', 'C', 10, { due_date: '2026-11-01', active: false })];
    expect(dueDateOf({ expected_pay_date: null, bill_lines: lines })).toBe('2026-11-20');
  });
  it('採購單沒有帳單也沒填＝空白', () => {
    expect(dueDateOf({ expected_pay_date: null })).toBe('');
    expect(buildPaperPrint({ source: 'PURCHASE', lines: [] }, null).dueDate).toBe('');
  });
  it('紙面格式是民國年月日', () => {
    expect(buildPaperPrint(utilityPr([bill(1, 's1', 'A', 100)]), null).dueDate).toBe('115年11月30日');
  });
});

describe('水電：同門市合併一列、電號數、使用單位', () => {
  const extra = {
    creator: { name: '張品萱', department: '人資部' },
    bill_lines: [
      { line_id: 'b1', store_short_name: '景鏵', store_name: '景鏵藥局' },
      { line_id: 'b2', store_short_name: '中鏵', store_name: '中鏵藥局' }, { line_id: 'b3', store_short_name: '中鏵', store_name: '中鏵藥局' },
      { line_id: 'b4', store_short_name: '中鏵', store_name: '中鏵藥局' }, { line_id: 'b5', store_short_name: '中鏵', store_name: '中鏵藥局' },
      { line_id: 'b6', store_short_name: '建恭', store_name: '建恭藥局', notes: '新地址614號' },
    ],
  };
  const lines = [bill(1, 'S1', '景鏵', 11454), bill(2, 'S2', '中鏵', 4000), bill(3, 'S2', '中鏵', 4000), bill(4, 'S2', '中鏵', 4000), bill(5, 'S2', '中鏵', 4344), bill(6, 'S3', '建恭', 74)];
  const p = buildPaperPrint(utilityPr(lines), extra);
  it('同一門市多張帳單合併一列、金額加總；單張不加後綴', () => {
    expect(p.rows.filter((r) => r.no !== null)).toHaveLength(3);
    expect(p.rows[0]).toMatchObject({ no: 1, unit: '景鏵', reason: '115年11月電費', amount: 11454 });
    expect(p.rows[1]).toMatchObject({ no: 2, unit: '中鏵', reason: '115年11月電費（共 4 個電號）', amount: 16344 });
  });
  it('帳單備註用括號接在使用單位後面', () => {
    expect(p.rows[2]).toMatchObject({ unit: '建恭（新地址614號）', amount: 74 });
  });
  it('水費合併寫水號、類型混雜寫張數', () => {
    const w = buildPaperPrint(utilityPr([bill(1, 'S1', 'A', 10, { expense_type: 'WATER' }), bill(2, 'S1', 'A', 20, { expense_type: 'WATER' })]), null);
    expect(w.rows[0].reason).toBe('115年11月水費（共 2 個水號）');
    const mixed = buildPaperPrint(utilityPr([bill(1, 'S1', 'A', 10), bill(2, 'S1', 'A', 20, { expense_type: 'WATER' })]), null);
    expect(mixed.rows[0].reason).toBe('115年11月電費、水費（共 2 張帳單）');
  });
  it('沒有門市簡稱就退回門市全名，再退回帳單上的名稱', () => {
    const only = buildPaperPrint(utilityPr([bill(1, 'S1', '帳單名稱', 10)]), { bill_lines: [{ line_id: 'b1', store_short_name: null, store_name: '全名藥局' }] });
    expect(only.rows[0].unit).toBe('全名藥局');
    expect(buildPaperPrint(utilityPr([bill(1, 'S1', '帳單名稱', 10)]), null).rows[0].unit).toBe('帳單名稱');
  });
  it('已失效（作廢釋放）的明細不計入', () => {
    const q = buildPaperPrint(utilityPr([bill(1, 'S1', 'A', 10), bill(2, 'S1', 'A', 20, { active: false })]), null);
    expect(q.rows[0]).toMatchObject({ amount: 10, reason: '115年11月電費' });
  });
  it('申請事由覆寫：每列都用它，不加後綴', () => {
    const o = buildPaperPrint(utilityPr(lines, { reason_override: '11月店面電費' }), extra);
    expect(o.rows.filter((r) => r.no !== null).map((r) => r.reason)).toEqual(['11月店面電費', '11月店面電費', '11月店面電費']);
  });
  it('水電內部訂單空白、營業稅 0、合計＝請款單應付總額', () => {
    expect(p.rows.every((r) => r.order === '')).toBe(true);
    expect(p.tax).toBe(0);
    expect(p.taxLabel).toBe('5% 營業稅');
    expect(p.total).toBe(11454 + 16344 + 74);
  });
  it('沒有水電檢視權限（明細遮蔽）合成一列只印張數', () => {
    const m = buildPaperPrint({ source: 'UTILITY', bill_month: '2026-11-01', amount_total: 500, bills_masked: true, bill_count: 3 }, null);
    expect(m.rows[0]).toMatchObject({ no: 1, unit: '', reason: '115年11月水電話費（共 3 張帳單）', amount: 500 });
  });
});

describe('補空白列到 7 列', () => {
  it('不足 7 列補空白，空白列沒有項次與金額', () => {
    const p = buildPaperPrint(utilityPr([bill(1, 'S1', 'A', 100)]), null);
    expect(p.rows).toHaveLength(MIN_ROWS);
    expect(p.rows[1]).toEqual({ no: null, unit: '', reason: '', amount: null, order: '' });
    expect(moneyCell(p.rows[1].amount)).toBe('');
    expect(moneyCell(11454)).toBe('11,454');
  });
  it('超過 7 列照長，不截斷', () => {
    const lines = Array.from({ length: 9 }, (_, i) => bill(i + 1, `S${i}`, `門市${i}`, 10));
    const p = buildPaperPrint(utilityPr(lines), null);
    expect(p.rows).toHaveLength(9);
    expect(p.rows[8].no).toBe(9);
  });
  it('剛好 7 列不多補', () => {
    const lines = Array.from({ length: 7 }, (_, i) => bill(i + 1, `S${i}`, `門市${i}`, 10));
    expect(buildPaperPrint(utilityPr(lines), null).rows).toHaveLength(7);
  });
});

describe('採購來源', () => {
  const purchase = {
    pr_no: 'PY-2', source: 'PURCHASE', created_at: '2026-11-24T02:00:00Z', amount_untaxed: 3000, tax_amount: 150, amount_total: 3150, vendor_name_snapshot: '某廠商',
    lines: [
      { line_no: 1, po_no: 'PO-001', claim_untaxed: 1000, items: [{ item_name: '影印紙' }, { item_name: '碳粉' }, { item_name: '墨水' }] },
      { line_no: 2, po_no: 'PO-001', claim_untaxed: 500, items: [{ item_name: '影印紙' }] },
      { line_no: 3, po_no: 'PO-002', claim_untaxed: 1500, items: [{ item_name: '掃把' }] },
    ],
  };
  const p = buildPaperPrint(purchase, null);
  it('同一採購單一列，內部訂單印採購單號，事由為單號加品名摘要，金額為未稅', () => {
    expect(p.rows[0]).toMatchObject({ no: 1, order: 'PO-001', amount: 1500, reason: 'PO-001 影印紙、碳粉等 3 項' });
    expect(p.rows[1]).toMatchObject({ no: 2, order: 'PO-002', amount: 1500, reason: 'PO-002 掃把' });
  });
  it('營業稅列印實際稅額，合計＝應付總額；檢附單據預設發票', () => {
    expect(p.tax).toBe(150);
    expect(p.total).toBe(3150);
    expect(p.attach).toBe('發票');
  });
  it('看不到品名（沒有採購檢視權限）只印採購單號', () => {
    const q = buildPaperPrint({ ...purchase, lines: [{ line_no: 1, po_no: 'PO-009', claim_untaxed: 10, items: null }] }, null);
    expect(q.rows[0].reason).toBe('PO-009');
  });
  it('預付款單沒有進貨明細：一列印採購單號與預付未稅金額', () => {
    const q = buildPaperPrint({ source: 'PURCHASE', pay_kind: 'PREPAY', prepay_po_no: 'PO-777', amount_untaxed: 952, tax_amount: 48, amount_total: 1000, lines: [] }, null);
    expect(q.rows[0]).toMatchObject({ no: 1, order: 'PO-777', amount: 952, reason: 'PO-777 預付款' });
    expect(q.tax).toBe(48);
  });
});

describe('表頭預設值', () => {
  it('申請人與部門：請款單上的值優先，沒有就帶建立人', () => {
    const base = utilityPr([bill(1, 'S1', 'A', 10)]);
    const a = buildPaperPrint(base, { creator: { name: '張品萱', department: '人資部' } });
    expect(a).toMatchObject({ applicant: '張品萱', dept: '人資部', attach: '繳費單', applyDate: '115/11/24', register: '' });
    const b = buildPaperPrint({ ...base, applicant_name: '王小明', applicant_dept: '總務部', attach_docs: '繳費單、收據' }, { creator: { name: '張品萱', department: '人資部' } });
    expect(b).toMatchObject({ applicant: '王小明', dept: '總務部', attach: '繳費單、收據' });
  });
  it('沒有補充資料時用請款單的建立人姓名，部門空白', () => {
    const p = buildPaperPrint({ ...utilityPr([bill(1, 'S1', 'A', 10)]), created_by_name: '李四' }, null);
    expect(p).toMatchObject({ applicant: '李四', dept: '' });
  });
  it('抬頭：請款單快照 > 買受人公司（API）> 預設公司；副標請款單', () => {
    const base = utilityPr([bill(1, 'S1', 'A', 10)]);
    expect(buildPaperPrint({ ...base, buyer_title_snapshot: '快照公司' }, null, '預設公司').title).toBe('快照公司');
    expect(buildPaperPrint(base, null, '買受人公司').title).toBe('買受人公司');
    expect(buildPaperPrint(base, null, null).title).toBe(DEFAULT_COMPANY_TITLE);
    expect(buildPaperPrint(base, null).subtitle).toBe('請款單');
  });
  it('付款對象：廠商名稱；同仁代墊印同仁姓名', () => {
    expect(payeeLabel({ vendor_name_snapshot: '台灣電力公司' })).toBe('台灣電力公司');
    expect(payeeLabel({ payee_type: 'EMPLOYEE', payee_name_snapshot: '王小明', vendor_name_snapshot: '某廠商' })).toBe('王小明');
    expect(payeeLabel({ payee_type: 'EMPLOYEE', payee_name: '王小明' })).toBe('王小明');
  });
  it('簽核欄與附註與紙本相同；系統單號獨立回傳', () => {
    const p = buildPaperPrint(utilityPr([bill(1, 'S1', 'A', 10)]), null);
    expect(p.signRows).toBe(SIGN_ROWS);
    expect(SIGN_ROWS.flat()).toEqual(['董事長', '副董事長', '總經理/長級高階主管', '事業群主管', '部門主管', '直屬主管', '財會部']);
    expect(p.signNote).toBe(SIGN_NOTE);
    expect(SIGN_NOTE).toBe('註：依核決權限簽核完成再交由財會部入帳。');
    expect(p.prNo).toBe('PY-1');
  });
  it('付款方式帶進紙面（平台名稱優先用 pay_platform）', () => {
    const p = buildPaperPrint({ ...utilityPr([bill(1, 'S1', 'A', 10)]), pay_method: 'ONLINE_PLATFORM', pay_platform: '蝦皮' }, null);
    expect(p.pay).toMatchObject({ other: true, otherText: '蝦皮' });
  });
});

describe('列印欄位驗證', () => {
  it('只收四個欄位；空字串與 null 視為清除；前後空白去掉', () => {
    expect(validatePrintFieldsPayload({ applicant_name: '  王小明 ', applicant_dept: '', attach_docs: null, reason_override: '11月電費', junk: 1 }))
      .toEqual({ applicant_name: '王小明', applicant_dept: null, attach_docs: null, reason_override: '11月電費' });
  });
  it('超長、型別錯誤、沒有任何欄位都擋下', () => {
    expect(() => validatePrintFieldsPayload({ applicant_name: 'x'.repeat(51) })).toThrow('申請人不可超過 50 個字');
    expect(() => validatePrintFieldsPayload({ reason_override: 'x'.repeat(201) })).toThrow('申請事由不可超過 200 個字');
    expect(() => validatePrintFieldsPayload({ attach_docs: 5 })).toThrow('檢附單據格式錯誤');
    expect(() => validatePrintFieldsPayload({ other: 'x' })).toThrow('沒有要儲存的列印欄位');
  });
});
