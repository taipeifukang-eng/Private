import { describe, expect, it } from 'vitest';
import {
  acceptedBase, allocateFifo, baseRatio, dispatchableTotal, duplicateSerials, isSerialSame, isValidDate, isWholeUnits, MAX_DISPATCH_QTY, normalizeEquipmentTemplateId, normalizeSerials,
  receiptLineProblem, remainingReceivable, resolveTemplate, serialChangeProblem, statusAfterReceipt, unitPricePerBase, validateDispatchPayload, validateReceiptPayload,
  validateSerialPayload, warrantyEnd, warrantyFor, type ReceiptLineContext, type ReceiptLineInput,
} from '@/lib/workspace/general-affairs/purchase-receipt-rules';
import { validatePartPayload } from '@/lib/general-affairs/parts/validation';

// G26 到貨驗入與配發轉設備（D12、D13、D14、D15、D16、D3）：伺服端、頁面與資料庫函式共用同一套語意。
const ITEM = '33333333-3333-4333-8333-333333333333';
const LOC = '44444444-4444-4444-8444-444444444444';
const LOC2 = '55555555-5555-4555-8555-555555555555';
const PART = '66666666-6666-4666-8666-666666666666';
const PART2 = '77777777-7777-4777-8777-777777777777';
const STORE = '88888888-8888-4888-8888-888888888888';
const TPL = '99999999-9999-4999-8999-999999999999';
const TPL2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const ctx = (over: Partial<ReceiptLineContext> = {}): ReceiptLineContext => ({ item_name: '雷射印表機', ordered_qty: 5, received_qty: 0, fulfil_mode: 'STOCK', po_location_id: LOC, po_part_id: PART, ...over });
const line = (over: Partial<ReceiptLineInput> = {}): ReceiptLineInput => ({ po_item_id: ITEM, delivered_qty: 5, accepted_qty: 5, reason: null, location_id: null, received_part_id: null, change_reason: null, ...over });

describe('剩餘可收量：以已驗入量計', () => {
  it('訂購減已驗入，不為負，4 位小數', () => {
    expect(remainingReceivable(5, 0)).toBe(5);
    expect(remainingReceivable(5, 3)).toBe(2);
    expect(remainingReceivable(5, 5)).toBe(0);
    expect(remainingReceivable(5, 7)).toBe(0);
    expect(remainingReceivable(0.3, 0.1)).toBe(0.2);
    expect(remainingReceivable(1.0003, 0.0001)).toBe(1.0002);
  });
  it('破損拒收的不算已收：驗入 3 到貨 5 → 剩餘仍是 2（供應商補送可再收）', () => {
    expect(remainingReceivable(5, 3)).toBe(2);
  });
});

describe('到貨明細規則（D12、D13）', () => {
  it('全數到貨且全數驗入：通過', () => {
    expect(receiptLineProblem(line(), ctx())).toBeNull();
  });
  it('超過剩餘可收量：擋（D13），訊息含訂購與已驗入', () => {
    const p = receiptLineProblem(line({ delivered_qty: 6, accepted_qty: 6 }), ctx());
    expect(p?.code).toBe('OVER_RECEIVE');
    expect(p?.message).toContain('超過剩餘可收量 5');
    expect(receiptLineProblem(line({ delivered_qty: 3, accepted_qty: 3, reason: '分批' }), ctx({ received_qty: 3 }))?.code).toBe('OVER_RECEIVE');
  });
  it('補送：先前破損少收 2，這次到貨 2 剛好補滿，不需原因', () => {
    expect(receiptLineProblem(line({ delivered_qty: 2, accepted_qty: 2 }), ctx({ received_qty: 3 }))).toBeNull();
  });
  it('驗入量不可大於到貨量', () => {
    expect(receiptLineProblem(line({ delivered_qty: 3, accepted_qty: 4 }), ctx())?.code).toBe('ACCEPTED_EXCEEDS_DELIVERED');
  });
  it('破損或拒收（驗入小於到貨）必須原因；有原因就通過', () => {
    expect(receiptLineProblem(line({ accepted_qty: 4 }), ctx())?.code).toBe('REASON_REQUIRED');
    expect(receiptLineProblem(line({ accepted_qty: 4, reason: '1 台外箱破損' }), ctx())).toBeNull();
    expect(receiptLineProblem(line({ accepted_qty: 0, reason: '整批退回' }), ctx())).toBeNull();
  });
  it('分批到貨（到貨小於剩餘可收量、驗入等於到貨）不用填原因（2026-11-16 驗收決定）', () => {
    expect(receiptLineProblem(line({ delivered_qty: 3, accepted_qty: 3 }), ctx())).toBeNull();
    expect(receiptLineProblem(line({ delivered_qty: 3, accepted_qty: 3, reason: '分兩批到' }), ctx())).toBeNull();
    // 分批但同時有破損：仍要原因
    expect(receiptLineProblem(line({ delivered_qty: 3, accepted_qty: 2 }), ctx())?.code).toBe('REASON_REQUIRED');
  });
  it('到貨量必須大於 0；驗入量不可為負', () => {
    expect(receiptLineProblem(line({ delivered_qty: 0, accepted_qty: 0 }), ctx())?.code).toBe('INVALID_QUANTITY');
    expect(receiptLineProblem(line({ accepted_qty: -1 }), ctx())?.code).toBe('INVALID_QUANTITY');
  });
  it('改收貨位置、改收替代料：須變更原因；同位置同料件不需要', () => {
    expect(receiptLineProblem(line({ location_id: LOC }), ctx())).toBeNull();
    expect(receiptLineProblem(line({ location_id: LOC2 }), ctx())?.code).toBe('CHANGE_REASON_REQUIRED');
    expect(receiptLineProblem(line({ location_id: LOC2, change_reason: '倉庫 A 滿了' }), ctx())).toBeNull();
    expect(receiptLineProblem(line({ received_part_id: PART2 }), ctx())?.code).toBe('CHANGE_REASON_REQUIRED');
    expect(receiptLineProblem(line({ received_part_id: PART2, change_reason: '廠商缺貨改出替代型號' }), ctx())).toBeNull();
  });
  it('不入庫存的品項（直接建設備、只登錄）不能指定位置或料件', () => {
    expect(receiptLineProblem(line({ location_id: LOC2, change_reason: 'x' }), ctx({ fulfil_mode: 'DIRECT_ASSET' }))?.code).toBe('LINE_INVALID');
    expect(receiptLineProblem(line({ received_part_id: PART2, change_reason: 'x' }), ctx({ fulfil_mode: 'NO_STOCK' }))?.code).toBe('LINE_INVALID');
    expect(receiptLineProblem(line(), ctx({ fulfil_mode: 'NO_STOCK' }))).toBeNull();
  });
});

describe('到貨後的採購單狀態', () => {
  it('全部品項達訂購量 = 全部到貨；部分 = 部分到貨；都沒驗入維持原狀', () => {
    expect(statusAfterReceipt('ORDERED', [{ quantity: 5, received_qty: 5 }, { quantity: 2, received_qty: 2 }])).toBe('RECEIVED');
    expect(statusAfterReceipt('ORDERED', [{ quantity: 5, received_qty: 3 }, { quantity: 2, received_qty: 2 }])).toBe('PARTIALLY_RECEIVED');
    expect(statusAfterReceipt('ORDERED', [{ quantity: 5, received_qty: 0 }])).toBe('ORDERED');
    expect(statusAfterReceipt('PARTIALLY_RECEIVED', [{ quantity: 5, received_qty: 0 }])).toBe('PARTIALLY_RECEIVED');
    expect(statusAfterReceipt('ORDERED', [])).toBe('ORDERED');
  });
});

describe('單位換算', () => {
  it('採購單位 12 個一箱：訂 2 箱 = 24 基本單位，比例 12；驗入 0.5 箱 = 6', () => {
    const r = baseRatio(2, 24);
    expect(r).toBe(12);
    expect(acceptedBase(0.5, r)).toBe(6);
    expect(isWholeUnits(acceptedBase(0.5, r))).toBe(true);
    expect(isWholeUnits(acceptedBase(0.55, r))).toBe(false);
  });
  it('每台購價：箱價 ÷ 12，取到分', () => {
    expect(unitPricePerBase(1200, 12)).toBe(100);
    expect(unitPricePerBase(1000, 3)).toBe(333.33);
    expect(unitPricePerBase(500, 1)).toBe(500);
  });
});

describe('先進先出分配（D15）', () => {
  const c = (id: string, date: string, available: number, created = `${date}T09:00:00Z`) => ({ id, received_date: date, created_at: created, available });
  it('由舊到新分配，一次可跨多個進貨明細', () => {
    const out = allocateFifo([c('b', '2038-02-01', 5), c('a', '2038-01-01', 2)], 4);
    expect(out).toEqual([{ id: 'a', received_date: '2038-01-01', quantity: 2 }, { id: 'b', received_date: '2038-02-01', quantity: 2 }]);
  });
  it('同一天依登錄時間，再依 id', () => {
    const out = allocateFifo([c('z', '2038-01-01', 1, '2038-01-01T10:00:00Z'), c('y', '2038-01-01', 1, '2038-01-01T09:00:00Z')], 2);
    expect(out?.map((x) => x.id)).toEqual(['y', 'z']);
    const same = allocateFifo([c('b', '2038-01-01', 1), c('a', '2038-01-01', 1)], 2);
    expect(same?.map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('可配發量不足整筆回 null；沒有可配發的明細也是 null；已配發完的略過', () => {
    expect(allocateFifo([c('a', '2038-01-01', 2)], 3)).toBeNull();
    expect(allocateFifo([], 1)).toBeNull();
    expect(allocateFifo([c('a', '2038-01-01', 0), c('b', '2038-01-02', 3)], 3)).toEqual([{ id: 'b', received_date: '2038-01-02', quantity: 3 }]);
  });
  it('數量必須是正整數', () => {
    expect(allocateFifo([c('a', '2038-01-01', 5)], 0)).toBeNull();
    expect(allocateFifo([c('a', '2038-01-01', 5)], 1.5)).toBeNull();
  });
  it('可配發量加總', () => {
    expect(dispatchableTotal([{ available: 2 }, { available: 3 }, { available: -1 }])).toBe(5);
  });
});

describe('保固起算與到期日', () => {
  it('到期日 = 起算日加預設月數；月底取當月最後一天', () => {
    expect(warrantyEnd('2038-01-15', 12)).toBe('2039-01-15');
    expect(warrantyEnd('2038-01-31', 1)).toBe('2038-02-28');
    expect(warrantyEnd('2040-01-31', 1)).toBe('2040-02-29');
    expect(warrantyEnd('2038-11-30', 3)).toBe('2039-02-28');
    expect(warrantyEnd('2038-12-31', 24)).toBe('2040-12-31');
  });
  it('沒有月數（空、0）就沒有保固；起算日仍記錄', () => {
    expect(warrantyEnd('2038-01-15', null)).toBeNull();
    expect(warrantyEnd('2038-01-15', 0)).toBeNull();
    expect(warrantyFor('2038-01-15', 12)).toEqual({ has_warranty: true, warranty_start_date: '2038-01-15', warranty_end_date: '2039-01-15' });
    expect(warrantyFor('2038-01-15', null)).toEqual({ has_warranty: false, warranty_start_date: '2038-01-15', warranty_end_date: null });
  });
  it('起算日格式錯誤丟錯', () => {
    expect(() => warrantyEnd('2038/01/15', 12)).toThrow();
  });
  it('每台設備帶自己那批的保固起算日：跨進貨明細配發', () => {
    const out = allocateFifo([{ id: 'a', received_date: '2038-01-10', created_at: '1', available: 1 }, { id: 'b', received_date: '2038-03-10', created_at: '2', available: 1 }], 2)!;
    const ends = out.map((o) => warrantyEnd(o.received_date, 12));
    expect(ends).toEqual(['2039-01-10', '2039-03-10']);
  });
});

describe('序號與型號', () => {
  it('序號清單正規化：去空白、空字串與 null = 先不填、補滿 N 個位置', () => {
    expect(normalizeSerials([' SN1 ', '', null], 4)).toEqual(['SN1', null, null, null]);
    expect(normalizeSerials(undefined, 2)).toEqual([null, null]);
    expect(() => normalizeSerials(['a', 'b', 'c'], 2)).toThrow('不可超過配發數量');
    expect(() => normalizeSerials('x', 2)).toThrow();
    expect(() => normalizeSerials(['x'.repeat(101)], 2)).toThrow('100');
  });
  it('清單內重複（不分大小寫）', () => {
    expect(duplicateSerials(['sn1', 'SN1', null, 'sn2'])).toEqual(['SN1']);
    expect(duplicateSerials([null, null, 'a'])).toEqual([]);
  });
  it('型號決定：有手選就用手選，與料件對應不同要原因；沒手選用對應；都沒有要手選', () => {
    expect(resolveTemplate(TPL, null, null)).toEqual({ template_id: TPL, error: null });
    expect(resolveTemplate(TPL, TPL, null).error).toBeNull();
    expect(resolveTemplate(TPL, TPL2, null).error?.code).toBe('TEMPLATE_REASON_REQUIRED');
    expect(resolveTemplate(TPL, TPL2, '改買別款').error).toBeNull();
    expect(resolveTemplate(null, TPL2, null)).toEqual({ template_id: TPL2, error: null });
    expect(resolveTemplate(null, null, null).error?.code).toBe('TEMPLATE_REQUIRED');
  });
  it('序號補填：已有序號要改須原因；相同內容不算變更；空白不行', () => {
    expect(serialChangeProblem(null, 'SN1', null)).toBeNull();
    expect(serialChangeProblem('SN1', 'sn1', null)).toBeNull();
    expect(serialChangeProblem('SN1', 'SN2', null)?.code).toBe('REASON_REQUIRED');
    expect(serialChangeProblem('SN1', 'SN2', '貼錯')).toBeNull();
    expect(serialChangeProblem(null, '  ', null)?.code).toBe('SERIAL_REQUIRED');
    expect(isSerialSame('SN1', ' sn1 ')).toBe(true);
    expect(isSerialSame(null, 'sn1')).toBe(false);
  });
});

describe('輸入驗證：登錄到貨', () => {
  const ok = { idempotency_key: 'k1', header: { received_date: '2038-05-01' }, lines: [{ po_item_id: ITEM, delivered_qty: '5' }] };
  it('驗入量預設等於到貨量；日期、單號、備註正規化', () => {
    const p = validateReceiptPayload({ ...ok, header: { received_date: '2038-05-01', delivery_note_no: ' D-1 ', notes: ' ok ' } });
    expect(p.lines[0]).toMatchObject({ delivered_qty: 5, accepted_qty: 5, reason: null });
    expect(p.header).toEqual({ received_date: '2038-05-01', delivery_note_no: 'D-1', notes: 'ok' });
  });
  it('缺識別、識別過長、沒有品項、未知欄位', () => {
    expect(() => validateReceiptPayload({ ...ok, idempotency_key: '' })).toThrow('防重複識別碼');
    expect(() => validateReceiptPayload({ ...ok, idempotency_key: 'x'.repeat(65) })).toThrow('過長');
    expect(() => validateReceiptPayload({ ...ok, lines: [] })).toThrow('至少');
    expect(() => validateReceiptPayload({ ...ok, extra: 1 })).toThrow('不支援');
    expect(() => validateReceiptPayload({ ...ok, lines: [{ po_item_id: ITEM, delivered_qty: 1, hack: 1 }] })).toThrow('不支援');
  });
  it('日期：必須有效、可選擇限制不可未來', () => {
    expect(() => validateReceiptPayload({ ...ok, header: { received_date: '2038-02-30' } })).toThrow('有效');
    expect(() => validateReceiptPayload({ ...ok, header: { received_date: '2038-05-01' } }, '2026-11-12')).toThrow('不可晚於今天');
    expect(validateReceiptPayload({ ...ok, header: { received_date: '2026-11-12' } }, '2026-11-12').header.received_date).toBe('2026-11-12');
    expect(isValidDate('2040-02-29')).toBe(true);
    expect(isValidDate('2039-02-29')).toBe(false);
  });
  it('數量：到貨量要大於 0、最多 4 位小數；驗入量不可大於到貨量；品項不可重複', () => {
    expect(() => validateReceiptPayload({ ...ok, lines: [{ po_item_id: ITEM, delivered_qty: 0 }] })).toThrow('大於 0');
    expect(() => validateReceiptPayload({ ...ok, lines: [{ po_item_id: ITEM, delivered_qty: '1.23456' }] })).toThrow('4 位小數');
    expect(() => validateReceiptPayload({ ...ok, lines: [{ po_item_id: ITEM, delivered_qty: 2, accepted_qty: 3 }] })).toThrow('不可大於');
    expect(() => validateReceiptPayload({ ...ok, lines: [{ po_item_id: ITEM, delivered_qty: 1 }, { po_item_id: ITEM, delivered_qty: 1 }] })).toThrow('重複');
    expect(() => validateReceiptPayload({ ...ok, lines: [{ po_item_id: 'nope', delivered_qty: 1 }] })).toThrow('格式錯誤');
    expect(validateReceiptPayload({ ...ok, lines: [{ po_item_id: ITEM, delivered_qty: 5, accepted_qty: 0, reason: '整批退' }] }).lines[0].accepted_qty).toBe(0);
  });
});

describe('輸入驗證：配發與序號', () => {
  const ok = { idempotency_key: 'k1', po_item_id: ITEM, store_id: STORE, quantity: 3 };
  it('數量必須是 1 至 200 的整數；序號依數量補滿', () => {
    expect(validateDispatchPayload({ ...ok, serials: ['A', ''] }).serials).toEqual(['A', null, null]);
    expect(() => validateDispatchPayload({ ...ok, quantity: 0 })).toThrow('整數');
    expect(() => validateDispatchPayload({ ...ok, quantity: 1.5 })).toThrow('整數');
    expect(() => validateDispatchPayload({ ...ok, quantity: MAX_DISPATCH_QTY + 1 })).toThrow('整數');
    expect(() => validateDispatchPayload({ ...ok, serials: ['a', 'b', 'c', 'd'] })).toThrow('不可超過');
  });
  it('缺識別、缺門市、缺品項、未知欄位', () => {
    expect(() => validateDispatchPayload({ ...ok, idempotency_key: undefined })).toThrow('識別碼');
    expect(() => validateDispatchPayload({ ...ok, store_id: '' })).toThrow('門市');
    expect(() => validateDispatchPayload({ ...ok, po_item_id: '' })).toThrow('品項');
    expect(() => validateDispatchPayload({ ...ok, evil: 1 })).toThrow('不支援');
  });
  it('型號與原因、來源位置可選', () => {
    const p = validateDispatchPayload({ ...ok, equipment_template_id: TPL, template_change_reason: ' 改款 ', source_location_id: LOC });
    expect(p).toMatchObject({ equipment_template_id: TPL, template_change_reason: '改款', source_location_id: LOC });
    expect(() => validateDispatchPayload({ ...ok, equipment_template_id: 'bad' })).toThrow('格式錯誤');
  });
  it('序號補填內容', () => {
    expect(validateSerialPayload({ serial: ' SN1 ', reason: ' 貼錯 ' })).toEqual({ serial: 'SN1', reason: '貼錯' });
    expect(() => validateSerialPayload({ serial: '' })).toThrow('請輸入序號');
    expect(() => validateSerialPayload({ serial: 'x', other: 1 })).toThrow('不支援');
  });
});

describe('料件對應設備型號（D14）的欄位驗證，可清空', () => {
  it('空白 = 清空；有值必須是 uuid', () => {
    expect(normalizeEquipmentTemplateId('')).toBeNull();
    expect(normalizeEquipmentTemplateId(null)).toBeNull();
    expect(normalizeEquipmentTemplateId(TPL)).toBe(TPL);
    expect(() => normalizeEquipmentTemplateId('abc')).toThrow('格式錯誤');
  });
  it('料件表單驗證：新增與修改都接受 equipment_template_id；空白轉 null；格式錯誤擋；沒帶就不出現', () => {
    const base = { category_id: PART, name: 'x', base_unit: '個' };
    expect((validatePartPayload({ ...base, equipment_template_id: TPL }) as any).equipment_template_id).toBe(TPL);
    expect((validatePartPayload({ ...base, equipment_template_id: '' }) as any).equipment_template_id).toBeNull();
    expect((validatePartPayload({ equipment_template_id: null }, { partial: true }) as any).equipment_template_id).toBeNull();
    expect(() => validatePartPayload({ ...base, equipment_template_id: 'zzz' })).toThrow('格式錯誤');
    expect('equipment_template_id' in (validatePartPayload(base) as any)).toBe(false);
    expect('equipment_template_id' in (validatePartPayload({ name: 'y' }, { partial: true }) as any)).toBe(false);
  });
});
