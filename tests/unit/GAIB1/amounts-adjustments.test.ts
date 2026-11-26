import { describe, expect, it } from 'vitest';
import {
  ADJ_KINDS, ADJ_KIND_LABELS, MAX_ADJUSTMENTS, PRICE_MODES, adjustmentSignOk, carrierReceiptIndex, computeTotals, computeTotalsV2, inclItem, receiptAmounts, roundYuan, validateAdjustments,
  validateHeader,
} from '@/lib/workspace/general-affairs/purchase-order-rules';

// ga-improve-b1（單元）G2 含稅單價與 G3 調整列：金額與資料庫 ga_po_refresh_totals、ga_ib1_receipt_calc、ga_ib1_adjustments_apply 逐條對齊。
//   未稅模式沒有調整列時與舊的 computeTotals 逐位相同（1000 組隨機對照）；含稅模式以含稅總額為準、稅額用減的；負數進位（-2.5 → -3）；折扣超過品項金額擋下；
//   進貨單金額（含稅分支、承接調整列）；承接進貨單判斷；調整列驗證（正負號、金額、上限、欄位）；採購單表頭多收 price_mode、buyer_company_id、adjustments。
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('computeTotalsV2：未稅模式', () => {
  it('沒有調整列時與舊算式逐位相同（1000 組隨機品項與稅率）', () => {
    const r = rng(20261125);
    for (let n = 0; n < 1000; n += 1) {
      const items = Array.from({ length: 1 + Math.floor(r() * 5) }, () => ({ quantity: Math.round(r() * 9990 + 10) / 10, unit_price: Math.round(r() * 99999) / 100 }));
      const rate = [0, 0.05, 0.1, 0.03][Math.floor(r() * 4)];
      const old = computeTotals(items, rate);
      const v2 = computeTotalsV2({ items, tax_rate: rate, price_mode: 'EXCL' });
      expect({ subtotal: v2.subtotal, tax_amount: v2.tax_amount, total_amount: v2.total_amount }).toEqual(old);
      expect(v2.adjustment_total).toBe(0);
      expect(computeTotalsV2({ items, tax_rate: rate })).toEqual(v2);
    }
  });
  it('運費與折扣算進小計與稅基：1000 ＋ 100 − 200 → 小計 900、稅 45、含稅 945', () => {
    const t = computeTotalsV2({ items: [{ quantity: 10, unit_price: 100 }], adjustments: [{ amount: 100 }, { amount: -200 }], tax_rate: 0.05 });
    expect(t).toEqual({ subtotal: 900, tax_amount: 45, total_amount: 945, adjustment_total: -100 });
  });
  it('負數進位：稅額 round(-2.5)=-3 的情境（小計 -50 時被擋，所以以調整額為負的稅額邊界驗證）', () => {
    expect(roundYuan(-2.5)).toBe(-3);
    expect(roundYuan(2.5)).toBe(3);
    expect(roundYuan(-0.4)).toBe(-0);
  });
  it('折扣與折抵超過品項金額擋下（含稅、未稅都一樣）', () => {
    expect(() => computeTotalsV2({ items: [{ quantity: 1, unit_price: 100 }], adjustments: [{ amount: -101 }] })).toThrow('折扣與折抵超過品項金額');
    expect(() => computeTotalsV2({ items: [{ quantity: 1, unit_price: 100 }], adjustments: [{ amount: -101 }], price_mode: 'INCL' })).toThrow('折扣與折抵超過品項金額');
    expect(computeTotalsV2({ items: [{ quantity: 1, unit_price: 100 }], adjustments: [{ amount: -100 }] }).total_amount).toBe(0);
  });
});

describe('computeTotalsV2：含稅模式（以含稅總額為準，稅額用減的）', () => {
  it('含稅總額永遠等於輸入合計（1000 組隨機），未稅＋稅額＝含稅總額', () => {
    const r = rng(77);
    for (let n = 0; n < 1000; n += 1) {
      const items = Array.from({ length: 1 + Math.floor(r() * 4) }, () => ({ quantity: Math.round(r() * 500 + 1), unit_price: Math.round(r() * 99999) / 100 }));
      const adj = r() < 0.5 ? [{ amount: Math.round(r() * 200) }, { amount: -Math.round(r() * 100) }] : [];
      const lines = items.reduce((s, i) => s + roundYuan(i.quantity * i.unit_price), 0) + adj.reduce((s, a) => s + a.amount, 0);
      if (lines < 0) continue;
      const t = computeTotalsV2({ items, adjustments: adj, tax_rate: 0.05, price_mode: 'INCL' });
      expect(t.total_amount).toBe(lines);
      expect(t.subtotal + t.tax_amount).toBe(t.total_amount);
      expect(t.subtotal).toBe(roundYuan(lines / 1.05));
    }
  });
  it('3 × 100（含稅）= 300：未稅 286、稅額 14', () => {
    expect(computeTotalsV2({ items: [{ quantity: 3, unit_price: 100 }], price_mode: 'INCL' })).toEqual({ subtotal: 286, tax_amount: 14, total_amount: 300, adjustment_total: 0 });
  });
  it('含稅品項推算：未稅單價四位小數、未稅品項金額四捨五入，含稅金額不變', () => {
    expect(inclItem(3, 100)).toEqual({ unit_price_gross: 100, line_gross: 300, unit_price: 95.2381, line_amount: 286 });
    expect(inclItem(10, 105).line_amount).toBe(1000);
  });
});

describe('receiptAmounts：進貨單金額', () => {
  it('未稅：未稅＝品項加調整，稅額＝round(未稅×稅率)；沒調整列時與原式相同', () => {
    expect(receiptAmounts({ items: [{ amount: 200 }, { amount: 205 }], tax_rate: 0.05 })).toEqual({ untaxed: 405, tax: 20, total: 425 });
    expect(receiptAmounts({ items: [{ amount: 400 }], adjustments: [{ amount: 100 }, { amount: -300 }] })).toEqual({ untaxed: 200, tax: 10, total: 210 });
  });
  it('含稅：以含稅為準，未稅＝round(含稅÷1.05)，稅額用減的（分批收貨各自進位）', () => {
    expect(receiptAmounts({ items: [{ amount: 100 }], price_mode: 'INCL' })).toEqual({ untaxed: 95, tax: 5, total: 100 });
    expect(receiptAmounts({ items: [{ amount: 200 }], price_mode: 'INCL' })).toEqual({ untaxed: 190, tax: 10, total: 200 });
    expect(receiptAmounts({ items: [{ amount: 1050 }], adjustments: [{ amount: 105 }, { amount: -105 }], price_mode: 'INCL' })).toEqual({ untaxed: 1000, tax: 50, total: 1050 });
  });
});

describe('carrierReceiptIndex：承接調整列的進貨單', () => {
  it('第一張「品項額加調整額大於 0」的有效進貨單承接；不夠的延後', () => {
    expect(carrierReceiptIndex([{ itemsAmount: 200 }, { itemsAmount: 400 }, { itemsAmount: 400 }], -200)).toBe(1);
    expect(carrierReceiptIndex([{ itemsAmount: 100 }], -100)).toBe(-1);
    expect(carrierReceiptIndex([], 50)).toBe(-1);
  });
  it('作廢承接進貨單後轉給下一張符合條件者；已作廢的不算', () => {
    const rs = [{ itemsAmount: 200, voided: false }, { itemsAmount: 400, voided: true }, { itemsAmount: 400, voided: false }];
    expect(carrierReceiptIndex(rs, -200)).toBe(2);
    expect(carrierReceiptIndex(rs.map((r) => ({ ...r, voided: true })), -200)).toBe(-1);
  });
  it('只有運費（正數）時，任何有金額的進貨單都承接', () => {
    expect(carrierReceiptIndex([{ itemsAmount: 1 }, { itemsAmount: 50 }], 100)).toBe(0);
  });
});

describe('調整列驗證', () => {
  it('種類與標籤', () => {
    expect([...ADJ_KINDS]).toEqual(['FREIGHT', 'DISCOUNT', 'COUPON', 'POINTS', 'OTHER']);
    expect(ADJ_KIND_LABELS).toEqual({ FREIGHT: '運費', DISCOUNT: '折扣', COUPON: '折價券', POINTS: '點數折抵', OTHER: '其他調整' });
    expect([...PRICE_MODES]).toEqual(['EXCL', 'INCL']);
    expect(MAX_ADJUSTMENTS).toBe(10);
  });
  it('正負號：運費為正；折扣、折價券、點數折抵為負；其他皆可；0 與小數不行', () => {
    expect(adjustmentSignOk('FREIGHT', 100)).toBe(true);
    expect(adjustmentSignOk('FREIGHT', -1)).toBe(false);
    for (const k of ['DISCOUNT', 'COUPON', 'POINTS']) {
      expect(adjustmentSignOk(k, -5)).toBe(true);
      expect(adjustmentSignOk(k, 5)).toBe(false);
    }
    expect(adjustmentSignOk('OTHER', 3)).toBe(true);
    expect(adjustmentSignOk('OTHER', -3)).toBe(true);
    expect(adjustmentSignOk('OTHER', 0)).toBe(false);
    expect(adjustmentSignOk('FREIGHT', 1.5)).toBe(false);
    expect(adjustmentSignOk('X', 5)).toBe(false);
  });
  it('正常輸入：預設名稱、原價、活動名稱與備註保留', () => {
    const r = validateAdjustments([{ kind: 'freight', amount: '100' }, { kind: 'DISCOUNT', amount: -200, original_price: '1,200', campaign_name: '雙十一', note: '折價', label: '會員折扣' }]);
    expect(r).toEqual([
      { kind: 'FREIGHT', label: '運費', amount: 100, original_price: null, campaign_name: null, note: null },
      { kind: 'DISCOUNT', label: '會員折扣', amount: -200, original_price: 1200, campaign_name: '雙十一', note: '折價' },
    ]);
    expect(validateAdjustments(null)).toEqual([]);
    expect(validateAdjustments([])).toEqual([]);
  });
  it('錯誤：上限 10 列、金額、正負號、欄位與長度', () => {
    expect(() => validateAdjustments({})).toThrow('必須是清單');
    expect(() => validateAdjustments(Array.from({ length: 11 }, () => ({ kind: 'OTHER', amount: 1 })))).toThrow('最多 10 列');
    expect(validateAdjustments(Array.from({ length: 10 }, () => ({ kind: 'OTHER', amount: 1 })))).toHaveLength(10);
    expect(() => validateAdjustments([{ kind: 'WRONG', amount: 5 }])).toThrow('種類錯誤');
    expect(() => validateAdjustments([{ kind: 'OTHER', amount: 0 }])).toThrow('不能是 0');
    expect(() => validateAdjustments([{ kind: 'OTHER', amount: '1.5' }])).toThrow('整數元');
    expect(() => validateAdjustments([{ kind: 'OTHER', amount: '' }])).toThrow('整數元');
    expect(() => validateAdjustments([{ kind: 'FREIGHT', amount: -5 }])).toThrow('運費必須是正數');
    expect(() => validateAdjustments([{ kind: 'COUPON', amount: 5 }])).toThrow('必須是負數');
    expect(() => validateAdjustments([{ kind: 'OTHER', amount: 5, extra: 1 }])).toThrow('不支援的欄位');
    expect(() => validateAdjustments([{ kind: 'OTHER', amount: 5, label: 'x'.repeat(61) }])).toThrow('名稱不可超過 60');
    expect(() => validateAdjustments([{ kind: 'OTHER', amount: 5, campaign_name: 'x'.repeat(101) }])).toThrow('活動名稱不可超過 100');
    expect(() => validateAdjustments([{ kind: 'OTHER', amount: 5, note: 'x'.repeat(201) }])).toThrow('備註不可超過 200');
    expect(() => validateAdjustments([{ kind: 'OTHER', amount: 5, original_price: '-5' }])).toThrow('原價');
    expect(() => validateAdjustments(['x'])).toThrow('格式錯誤');
  });
});

describe('採購單表頭多收計價方式、買受人抬頭與調整列（缺省視為不動）', () => {
  it('沒帶新欄位時輸出與原本相同', () => {
    expect(validateHeader({ notes: 'x' })).toEqual({ notes: 'x' });
  });
  it('price_mode 大小寫不拘、空白視為未稅；錯誤值擋下', () => {
    expect(validateHeader({ price_mode: 'incl' })).toEqual({ price_mode: 'INCL' });
    expect(validateHeader({ price_mode: '' })).toEqual({ price_mode: 'EXCL' });
    expect(() => validateHeader({ price_mode: 'GROSS' })).toThrow('未稅或含稅');
  });
  it('buyer_company_id 要 uuid（空白＝改回預設）；adjustments 走同一套驗證', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    expect(validateHeader({ buyer_company_id: id })).toEqual({ buyer_company_id: id });
    expect(validateHeader({ buyer_company_id: '' })).toEqual({ buyer_company_id: null });
    expect(() => validateHeader({ buyer_company_id: 'x' })).toThrow('買受人抬頭格式錯誤');
    expect(validateHeader({ adjustments: [{ kind: 'FREIGHT', amount: 10 }] }).adjustments).toHaveLength(1);
    expect(() => validateHeader({ adjustments: [{ kind: 'FREIGHT', amount: -10 }] })).toThrow('運費必須是正數');
    expect(() => validateHeader({ foo: 1 })).toThrow('不支援的欄位');
  });
});
