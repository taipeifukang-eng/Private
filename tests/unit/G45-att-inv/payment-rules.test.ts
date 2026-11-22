import { describe, expect, it } from 'vitest';
import {
  buyerMismatch, calcTax, claimLimit, diffReasonRequired, findDuplicateInvoice, invoiceDateNotFuture, invoiceMissingImage, invoiceNoKey, isRealDate, lineUntaxed, maskInvoice,
  normalizeTaxNo, overClaim, parseInvoiceFilters, paymentAbilities, PAY, receiptTotal, roundHalfUp, sellerMismatch, taipeiToday, taxMismatchReasonRequired, totalsConsistent,
  validateInvoicePayload, withinTolerance, INVOICE_TYPES, VENDOR_BANK_FIELDS,
} from '@/lib/workspace/general-affairs/payment-rules';
import { VENDOR_SECRET_FIELDS, maskVendor } from '@/lib/workspace/general-affairs/vendor-rules';
import { PAYMENT_RESOURCE_PURPOSES, RESOURCE_TYPES, isPaymentResourceType, isResourceType, storagePath } from '@/lib/workspace/general-affairs/upload-rules';

// 第 4.5 批 G45-unit（發票部分）：稅額進位、含稅等式、尾差邊界、發票類型與圖片必傳、統編核對、台北日期、重複號碼、權限與機密遮蔽、輸入驗證、upload-rules 新資源類型。
const set = (...codes: string[]) => new Set(codes);

describe('權限（資料庫語意：只認權限碼，管理員身分不放行）', () => {
  it('manage 涵蓋 view；只有 view 不能寫；沒有權限都 false', () => {
    expect(paymentAbilities(set(PAY.manage))).toMatchObject({ canView: true, canManage: true });
    expect(paymentAbilities(set(PAY.view))).toMatchObject({ canView: true, canManage: false });
    expect(paymentAbilities(set())).toMatchObject({ canView: false, canManage: false, vendorVisible: false, canPickReceipts: false });
  });
  it('賣方統編與銀行只給廠商檢視／管理；挑進貨單需採購評估檢視（或管理、核准）', () => {
    expect(paymentAbilities(set(PAY.view)).vendorVisible).toBe(false);
    expect(paymentAbilities(set(PAY.view, PAY.vendorView)).vendorVisible).toBe(true);
    expect(paymentAbilities(set(PAY.manage, PAY.vendorManage)).vendorVisible).toBe(true);
    expect(paymentAbilities(set(PAY.manage)).canPickReceipts).toBe(false);
    expect(paymentAbilities(set(PAY.manage, PAY.reviewView)).canPickReceipts).toBe(true);
    expect(paymentAbilities(set(PAY.reviewView)).canPickReceipts).toBe(false);
  });
});

describe('稅額進位與含稅等式', () => {
  it('四捨五入遠離零；5% 稅率邊界（0.5 進位）', () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(2.49)).toBe(2);
    expect(calcTax(10, 0.05)).toBe(1); // 0.5 -> 1
    expect(calcTax(9, 0.05)).toBe(0); // 0.45
    expect(calcTax(70, 0.05)).toBe(4); // 3.5 -> 4
    expect(calcTax(1000, 0.05)).toBe(50);
    expect(calcTax(33, 0.05)).toBe(2); // 1.65
  });
  it('稅率 0（免稅廠商）稅額 0', () => {
    expect(calcTax(123456, 0)).toBe(0);
    expect(receiptTotal(1000, 0)).toBe(1000);
  });
  it('進貨單含稅＝未稅＋round(未稅×稅率)；品項各自進位後再加總', () => {
    expect(receiptTotal(1000, 0.05)).toBe(1050);
    // 兩個品項各自進位（單價×驗入量）：33.3×3＝99.9→100；12.5×3＝37.5→38，未稅合計 138，稅 round(6.9)=7
    const u = lineUntaxed(33.3, 3) + lineUntaxed(12.5, 3);
    expect(u).toBe(138);
    expect(receiptTotal(u, 0.05)).toBe(145);
  });
  it('部分到貨：單價×實收量', () => {
    expect(lineUntaxed(100, 4)).toBe(400);
    expect(lineUntaxed(100, 0)).toBe(0);
    expect(receiptTotal(400, 0.05)).toBe(420);
  });
  it('含稅等式', () => {
    expect(totalsConsistent(1000, 50, 1050)).toBe(true);
    expect(totalsConsistent(1000, 50, 1051)).toBe(false);
  });
});

describe('尾差（預設 5 元）與累計請款上限', () => {
  it('5 元整算尾差免原因，6 元超過要原因', () => {
    expect(withinTolerance(5)).toBe(true);
    expect(withinTolerance(-5)).toBe(true);
    expect(withinTolerance(6)).toBe(false);
    expect(withinTolerance(-6)).toBe(false);
    expect(withinTolerance(0)).toBe(true);
  });
  it('可調整尾差：0 元表示一分都不能差；100 元為上限', () => {
    expect(withinTolerance(1, 0)).toBe(false);
    expect(withinTolerance(100, 100)).toBe(true);
    expect(withinTolerance(101, 100)).toBe(false);
  });
  it('差異原因：發票對進貨合計與對分攤合計任一超過尾差就要填；沒連進貨單不用', () => {
    expect(diffReasonRequired(1055, 1050, 1050)).toBe(false);
    expect(diffReasonRequired(1056, 1050, 1050)).toBe(true);
    expect(diffReasonRequired(1050, 1050, 1044)).toBe(true);
    expect(diffReasonRequired(9999, 1050, 1050, 5, 0)).toBe(false);
  });
  it('累計請款超過累計驗入含稅額＋尾差直接擋；剛好等於上限可以', () => {
    expect(claimLimit(1050)).toBe(1055);
    expect(overClaim(1055, 1050)).toBe(false);
    expect(overClaim(1056, 1050)).toBe(true);
    expect(overClaim(1056, 1050, 6)).toBe(false);
  });
});

describe('發票類型與圖片必傳（P10）', () => {
  it('五種類型', () => {
    expect([...INVOICE_TYPES]).toEqual(['TRIPLE', 'DUPLEX', 'E_INVOICE', 'RECEIPT', 'NO_INVOICE']);
  });
  it('三聯、二聯、電子沒有圖片就缺圖（填原因也不行）；有圖不缺', () => {
    for (const t of ['TRIPLE', 'DUPLEX', 'E_INVOICE']) {
      expect(invoiceMissingImage(t, null, 0), t).toBe(true);
      expect(invoiceMissingImage(t, '有原因也不行', 0), t).toBe(true);
      expect(invoiceMissingImage(t, null, 1), t).toBe(false);
    }
  });
  it('收據可不傳圖但要填原因；免開發票不需要', () => {
    expect(invoiceMissingImage('RECEIPT', null, 0)).toBe(true);
    expect(invoiceMissingImage('RECEIPT', '  ', 0)).toBe(true);
    expect(invoiceMissingImage('RECEIPT', '對方只給口頭收據', 0)).toBe(false);
    expect(invoiceMissingImage('RECEIPT', null, 2)).toBe(false);
    expect(invoiceMissingImage('NO_INVOICE', null, 0)).toBe(false);
  });
});

describe('統編核對', () => {
  it('只留數字；賣方只在雙方都有值且不同時不符', () => {
    expect(normalizeTaxNo(' 1234-5678 ')).toBe('12345678');
    expect(sellerMismatch('12345678', '12345678')).toBe(false);
    expect(sellerMismatch('12345678', '87654321')).toBe(true);
    expect(sellerMismatch('', '87654321')).toBe(false);
    expect(sellerMismatch('12345678', null)).toBe(false);
  });
  it('買受人統編只檢查三聯式，且設定有值才比對', () => {
    expect(buyerMismatch('TRIPLE', '11111111', '22222222')).toBe(true);
    expect(buyerMismatch('TRIPLE', '22222222', '22222222')).toBe(false);
    expect(buyerMismatch('DUPLEX', '11111111', '22222222')).toBe(false);
    expect(buyerMismatch('TRIPLE', '11111111', '')).toBe(false);
  });
  it('賣方或買受人不符都要填原因；非三聯式不檢查買受人', () => {
    expect(taxMismatchReasonRequired('TRIPLE', '12345678', '87654321', '', '')).toBe(true);
    expect(taxMismatchReasonRequired('TRIPLE', '12345678', '12345678', '11111111', '22222222')).toBe(true);
    expect(taxMismatchReasonRequired('E_INVOICE', '12345678', '12345678', '11111111', '22222222')).toBe(false);
    expect(taxMismatchReasonRequired('TRIPLE', '12345678', '12345678', '22222222', '22222222')).toBe(false);
  });
});

describe('日期（台北，不可未來）', () => {
  it('台北今天：UTC 16:00 之後已是台北隔天', () => {
    expect(taipeiToday(new Date('2038-03-01T16:30:00Z'))).toBe('2038-03-02');
    expect(taipeiToday(new Date('2038-03-01T15:59:00Z'))).toBe('2038-03-01');
  });
  it('今天可以、明天不行；台北已過午夜的 UTC 前一天也算今天', () => {
    const now = new Date('2038-03-01T10:00:00Z'); // 台北 3/1 18:00
    expect(invoiceDateNotFuture('2038-03-01', now)).toBe(true);
    expect(invoiceDateNotFuture('2038-03-02', now)).toBe(false);
    const late = new Date('2038-03-01T17:00:00Z'); // 台北 3/2 01:00
    expect(invoiceDateNotFuture('2038-03-02', late)).toBe(true);
  });
  it('isRealDate', () => {
    expect(isRealDate('2038-02-29')).toBe(false);
    expect(isRealDate('2036-02-29')).toBe(true);
    expect(isRealDate('2038-13-01')).toBe(false);
    expect(isRealDate('2038/01/01')).toBe(false);
  });
});

describe('同廠商重複號碼', () => {
  const rows = [
    { id: 'a', vendor_id: 'v1', invoice_no: 'AB12345678', status: 'ACTIVE' },
    { id: 'b', vendor_id: 'v1', invoice_no: 'CD00000001', status: 'VOID' },
    { id: 'c', vendor_id: 'v2', invoice_no: 'AB12345678', status: 'ACTIVE' },
  ];
  it('同廠商同號碼（不分大小寫與前後空白）重複；作廢的與別家的不算；自己不算', () => {
    expect(findDuplicateInvoice(rows, 'v1', ' ab12345678 ')?.id).toBe('a');
    expect(findDuplicateInvoice(rows, 'v1', 'CD00000001')).toBeNull();
    expect(findDuplicateInvoice(rows, 'v3', 'AB12345678')).toBeNull();
    expect(findDuplicateInvoice(rows, 'v1', 'AB12345678', 'a')).toBeNull();
    expect(findDuplicateInvoice(rows, 'v1', '')).toBeNull();
    expect(invoiceNoKey('v1', ' X ')).toBe('v1|x');
  });
});

describe('機密欄位遮蔽', () => {
  it('賣方統編：沒有廠商權限者 null 並標記遮蔽；有權限原樣', () => {
    const row = { id: '1', seller_tax_id_snapshot: '12345678', amount_total: 100 };
    expect(maskInvoice(row, true)).toEqual(row);
    const m: any = maskInvoice(row, false);
    expect(m.seller_tax_id_snapshot).toBeNull();
    expect(m.seller_tax_masked).toBe(true);
    expect(m.amount_total).toBe(100);
    expect((maskInvoice({ id: '2', seller_tax_id_snapshot: null }, false) as any).seller_tax_masked).toBe(false);
  });
  it('VENDOR_SECRET_FIELDS 含銀行四欄，沒有廠商權限時 12 欄完全不存在（不是 null）', () => {
    for (const f of VENDOR_BANK_FIELDS) expect((VENDOR_SECRET_FIELDS as readonly string[]).includes(f)).toBe(true);
    const row: Record<string, unknown> = { id: 'x', name: '甲' };
    for (const f of VENDOR_SECRET_FIELDS) row[f] = 'v';
    const m = maskVendor(row, false);
    for (const f of VENDOR_SECRET_FIELDS) expect(Object.prototype.hasOwnProperty.call(m, f), f).toBe(false);
    expect(m).toEqual({ id: 'x', name: '甲' });
    expect(maskVendor(row, true)).toEqual(row);
  });
});

describe('發票送出內容驗證', () => {
  const now = new Date('2038-03-01T04:00:00Z');
  const base = { invoice_type: 'TRIPLE', invoice_no: 'ab12345678', invoice_date: '2038-02-28', amount_untaxed: '1,000' };
  it('三聯式：號碼轉大寫、金額去逗號；沒帶的欄位不出現', () => {
    const p = validateInvoicePayload(base, { create: true, now });
    expect(p).toEqual({ invoice_type: 'TRIPLE', invoice_no: 'AB12345678', invoice_date: '2038-02-28', amount_untaxed: 1000 });
  });
  it('必填：類型、號碼（三聯二聯電子）、日期、金額', () => {
    expect(() => validateInvoicePayload({ ...base, invoice_type: 'X' }, { create: true, now })).toThrow('發票類型');
    expect(() => validateInvoicePayload({ ...base, invoice_no: '' }, { create: true, now })).toThrow('發票號碼');
    expect(() => validateInvoicePayload({ ...base, invoice_date: undefined }, { create: true, now })).toThrow('發票日期');
    expect(() => validateInvoicePayload({ ...base, amount_untaxed: undefined }, { create: true, now })).toThrow('未稅金額');
  });
  it('日期：未來日期與不存在的日期擋下，訊息帶台北今天', () => {
    expect(() => validateInvoicePayload({ ...base, invoice_date: '2038-03-05' }, { create: true, now })).toThrow('不能是未來');
    expect(() => validateInvoicePayload({ ...base, invoice_date: '2038-02-30' }, { create: true, now })).toThrow('格式錯誤');
  });
  it('金額：負數、小數、文字都擋', () => {
    for (const v of ['-1', '10.5', 'abc']) expect(() => validateInvoicePayload({ ...base, amount_untaxed: v }, { create: true, now }), v).toThrow('整數');
  });
  it('統編 8 碼數字；不足擋下；空白清成 null', () => {
    expect(() => validateInvoicePayload({ ...base, seller_tax_id: '1234' }, { create: true, now })).toThrow('8 碼');
    expect(validateInvoicePayload({ ...base, buyer_tax_id: ' 1234-5678 ' }, { create: true, now }).buyer_tax_id).toBe('12345678');
    expect(validateInvoicePayload({ ...base, buyer_tax_id: '' }, { create: true, now }).buyer_tax_id).toBeNull();
  });
  it('收據與免開發票：只填含稅；未稅與含稅同時給要相同；免開發票不需號碼與日期', () => {
    expect(validateInvoicePayload({ invoice_type: 'RECEIPT', invoice_date: '2038-02-28', amount_total: 500 }, { create: true, now }).amount_total).toBe(500);
    expect(() => validateInvoicePayload({ invoice_type: 'RECEIPT', invoice_date: '2038-02-28', amount_total: 500, amount_untaxed: 400 }, { create: true, now })).toThrow('相同');
    expect(validateInvoicePayload({ invoice_type: 'NO_INVOICE', amount_total: 100 }, { create: true, now })).toEqual({ invoice_type: 'NO_INVOICE', amount_total: 100 });
    expect(() => validateInvoicePayload({ invoice_type: 'RECEIPT', invoice_date: '2038-02-28' }, { create: true, now })).toThrow('金額');
  });
  it('原因與備註長度上限；連結進貨單格式、重複、上限', () => {
    expect(() => validateInvoicePayload({ ...base, diff_reason: 'x'.repeat(201) }, { create: true, now })).toThrow('200');
    expect(() => validateInvoicePayload({ ...base, notes: 'x'.repeat(501) }, { create: true, now })).toThrow('500');
    const id = '11111111-1111-4111-8111-111111111111';
    expect(validateInvoicePayload({ ...base, receipts: [{ receipt_id: id, allocated_untaxed: 10, allocated_tax: 1 }] }, { create: true, now }).receipts).toEqual([{ receipt_id: id, allocated_untaxed: 10, allocated_tax: 1 }]);
    expect(() => validateInvoicePayload({ ...base, receipts: [{ receipt_id: id }, { receipt_id: id }] }, { create: true, now })).toThrow('重複');
    expect(() => validateInvoicePayload({ ...base, receipts: [{ receipt_id: 'x' }] }, { create: true, now })).toThrow('格式');
    expect(() => validateInvoicePayload({ ...base, receipts: 'x' }, { create: true, now })).toThrow('格式');
  });
  it('編輯：沒帶的欄位維持原值（不出現在 payload）', () => {
    expect(validateInvoicePayload({ notes: ' 改備註 ' }, { create: false, now })).toEqual({ notes: '改備註' });
  });
});

describe('清單篩選', () => {
  const q = (s: string) => new URLSearchParams(s);
  it('合法篩選轉成資料庫格式', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(parseInvoiceFilters(q(`vendorId=${id}&status=void&type=triple&dateFrom=2038-01-01&missingImage=1&unreferenced=true&q=%20abc%20`))).toEqual({
      vendor_id: id, status: 'VOID', type: 'TRIPLE', date_from: '2038-01-01', missing_image: true, unreferenced: true, search: 'abc',
    });
  });
  it('格式錯誤丟中文錯誤', () => {
    expect(() => parseInvoiceFilters(q('vendorId=x'))).toThrow('篩選條件');
    expect(() => parseInvoiceFilters(q('status=bad'))).toThrow('狀態');
    expect(() => parseInvoiceFilters(q('type=bad'))).toThrow('類型');
    expect(() => parseInvoiceFilters(q('dateFrom=2038-02-30'))).toThrow('日期');
  });
  it('搜尋字串截斷 100 字', () => {
    expect((parseInvoiceFilters(q('q=' + 'a'.repeat(150))).search as string).length).toBe(100);
  });
});

describe('upload-rules 新資源類型', () => {
  it('RESOURCE_TYPES 含 PURCHASE_INVOICE、PURCHASE_RECEIPT，共 10 種（原 8 種不變）', () => {
    expect(RESOURCE_TYPES).toHaveLength(10);
    expect(isResourceType('PURCHASE_INVOICE')).toBe(true);
    expect(isResourceType('PURCHASE_RECEIPT')).toBe(true);
    expect(isResourceType('UTILITY_BILL')).toBe(true);
    expect(isResourceType('PURCHASE_ORDER')).toBe(false);
  });
  it('用途固定：發票圖片 INVOICE_IMAGE、送貨單 DELIVERY_NOTE；路徑以小寫資源類型開頭', () => {
    expect(PAYMENT_RESOURCE_PURPOSES).toEqual({ PURCHASE_INVOICE: 'INVOICE_IMAGE', PURCHASE_RECEIPT: 'DELIVERY_NOTE' });
    expect(isPaymentResourceType('PURCHASE_INVOICE')).toBe(true);
    expect(isPaymentResourceType('UTILITY_BILL')).toBe(false);
    expect(storagePath('PURCHASE_INVOICE', 'rid', 'INVOICE_IMAGE', 'u', 'png', 1)).toBe('purchase_invoice/rid/invoice_image/1-u.png');
  });
});
