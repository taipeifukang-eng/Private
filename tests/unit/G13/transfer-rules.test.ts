import { describe, expect, it } from 'vitest';
import {
  ACTIONS, AWAITING_RECEIPT, DEFAULT_OVERDUE_DAYS, EXCEPTION_TYPES, isOverdue, maskEvent, maskTransfer, missingPermissions, OPEN_STATUSES, overdueCutoff, overdueDaysCount,
  parsePrefill, permissionProblem, reportSummary, resolvePrefillUnit, toRequestUnit, transferAbilities, transferNextStep, transferSearchable, validateActionPayload,
  validateCreatePayload, validateOverdueDays,
} from '@/lib/workspace/general-affairs/inventory-transfer-rules';
import { orIlike } from '@/lib/workspace/general-affairs/rules';

// G13 調撥規則（Q12 至 Q15、C8 至 C12）：同一份純函式伺服端與頁面共用。
const S = '11111111-1111-4111-8111-111111111111';
const D = '22222222-2222-4222-8222-222222222222';
const P = '33333333-3333-4333-8333-333333333333';
const base = { source_location_id: S, destination_location_id: D, part_id: P, quantity: 3, input_unit_type: 'BASE', reason: '支援門市', idempotency_key: 'k-1' };
const act = { action: 'receive', expected_updated_at: '2026-11-11T04:00:00.123456+00:00', idempotency_key: 'k-2' };
const all = { transferManage: true, transactionManage: true, partView: true, destinationStoreManager: false };

describe('建單輸入驗證（一張單一個料件）', () => {
  it('合法輸入：單位轉大寫、文字去空白、空備註與運送方式變 null', () => {
    const p = validateCreatePayload({ ...base, input_unit_type: 'purchase', reason: ' 補貨 ', notes: ' ', shipping_method: '', quantity: '2.5' });
    expect(p).toMatchObject({ input_unit_type: 'PURCHASE', reason: '補貨', notes: null, shipping_method: null, quantity: 2.5, request_id: null });
  });
  it('錯誤：來源、目的、同位置、料件、數量、原因、運送方式、需求單、識別碼', () => {
    expect(() => validateCreatePayload({ ...base, source_location_id: 'x' })).toThrow('請選擇來源位置');
    expect(() => validateCreatePayload({ ...base, destination_location_id: '' })).toThrow('請選擇目的位置');
    expect(() => validateCreatePayload({ ...base, destination_location_id: S })).toThrow('不可相同');
    expect(() => validateCreatePayload({ ...base, part_id: '' })).toThrow('請選擇料件');
    expect(() => validateCreatePayload({ ...base, quantity: 0 })).toThrow('數量');
    expect(() => validateCreatePayload({ ...base, quantity: '1.23456' })).toThrow('4 位小數');
    expect(() => validateCreatePayload({ ...base, quantity: 'abc' })).toThrow('數量');
    expect(() => validateCreatePayload({ ...base, reason: '  ' })).toThrow('請輸入調撥原因');
    expect(() => validateCreatePayload({ ...base, reason: 'x'.repeat(201) })).toThrow('200 字');
    expect(() => validateCreatePayload({ ...base, notes: 'x'.repeat(501) })).toThrow('500 字');
    expect(() => validateCreatePayload({ ...base, shipping_method: '飛機' })).toThrow('運送方式錯誤');
    expect(() => validateCreatePayload({ ...base, request_id: 'x' })).toThrow('需求單');
    expect(() => validateCreatePayload({ ...base, idempotency_key: '' })).toThrow('防重複識別碼');
    expect(() => validateCreatePayload({ ...base, idempotency_key: 'k'.repeat(61) })).toThrow('過長');
    expect(() => validateCreatePayload({ ...base, input_unit_type: 'BOX' })).toThrow('單位類型錯誤');
  });
  it('不接受白名單以外的欄位（狀態、單號、建立人都不能由使用者指定）', () => {
    for (const k of ['status', 'transfer_no', 'created_by', 'items']) expect(() => validateCreatePayload({ ...base, [k]: 'x' })).toThrow('不支援的欄位');
    expect(() => validateCreatePayload(null)).toThrow('格式錯誤');
    expect(() => validateCreatePayload([])).toThrow('格式錯誤');
  });
});

describe('動作輸入驗證', () => {
  it('合法動作與必填版本、識別碼', () => {
    expect(validateActionPayload(act)).toMatchObject({ action: 'receive', return_stock: false, exception_type: null, note: null });
    expect(() => validateActionPayload({ ...act, expected_updated_at: '' })).toThrow('expected_updated_at');
    expect(() => validateActionPayload({ ...act, expected_updated_at: 'not-a-date' })).toThrow('版本資訊格式錯誤');
    expect(() => validateActionPayload({ ...act, idempotency_key: '' })).toThrow('防重複識別碼');
    expect(() => validateActionPayload({ ...act, action: 'reopen' })).toThrow('調撥動作錯誤');
  });
  it('C9：沒有 reopen 動作；「未收」是 mark_unreceived（只註記）', () => {
    expect(ACTIONS).not.toContain('reopen');
    expect(ACTIONS).toContain('mark_unreceived');
    expect(validateActionPayload({ ...act, action: 'mark_unreceived', note: '門市說還沒到' }).action).toBe('mark_unreceived');
  });
  it('取消：一般取消要原因；異常終結要類型，其他要說明；退回庫存必須是布林', () => {
    expect(() => validateActionPayload({ ...act, action: 'cancel' })).toThrow('必須填寫原因');
    expect(validateActionPayload({ ...act, action: 'cancel', note: '不需要了', return_stock: true })).toMatchObject({ return_stock: true, exception_type: null });
    expect(validateActionPayload({ ...act, action: 'cancel', exception_type: 'damaged' })).toMatchObject({ exception_type: 'DAMAGED' });
    expect(() => validateActionPayload({ ...act, action: 'cancel', exception_type: 'OTHER' })).toThrow('其他');
    expect(() => validateActionPayload({ ...act, action: 'cancel', exception_type: 'NOT_RECEIVED' })).toThrow('異常類型錯誤');
    expect(() => validateActionPayload({ ...act, action: 'cancel', note: 'x', return_stock: 'yes' })).toThrow('退回來源庫存');
    for (const t of EXCEPTION_TYPES) expect(validateActionPayload({ ...act, action: 'cancel', exception_type: t, note: '說明' }).exception_type).toBe(t);
  });
  it('退回庫存與異常類型只能用在取消；問題類型只能用在門市回報', () => {
    expect(() => validateActionPayload({ ...act, return_stock: true })).toThrow('只能用在取消');
    expect(() => validateActionPayload({ ...act, exception_type: 'LOST' })).toThrow('只能用在取消');
    expect(() => validateActionPayload({ ...act, report_type: 'DAMAGED' })).toThrow('只能用在門市回報');
  });
  it('C10 門市回報：要類型，其他要說明', () => {
    expect(() => validateActionPayload({ ...act, action: 'store_report' })).toThrow('請選擇問題類型');
    expect(() => validateActionPayload({ ...act, action: 'store_report', report_type: 'OTHER' })).toThrow('其他');
    expect(validateActionPayload({ ...act, action: 'store_report', report_type: 'not_arrived' })).toMatchObject({ report_type: 'NOT_ARRIVED' });
    expect(() => validateActionPayload({ ...act, action: 'store_report', report_type: 'X' })).toThrow('問題類型錯誤');
  });
  it('備註長度與運送方式、白名單欄位', () => {
    expect(() => validateActionPayload({ ...act, note: 'x'.repeat(501) })).toThrow('500 字');
    expect(() => validateActionPayload({ ...act, shipping_method: '飛機' })).toThrow('運送方式錯誤');
    expect(() => validateActionPayload({ ...act, status: 'RECEIVED' })).toThrow('不支援的欄位');
  });
});

describe('abilities：每張單我能做什麼（Q13 缺哪個權限講清楚）', () => {
  it('三個權限都有：依狀態決定能做什麼', () => {
    expect(transferAbilities(all, { status: 'REQUESTED' })).toMatchObject({ confirm_source: true, ship: false, receive: false, cancel: true, mark_unreceived: false, store_report: false, problem: '' });
    expect(transferAbilities(all, { status: 'SOURCE_CONFIRMED' })).toMatchObject({ confirm_source: false, ship: true, receive: true, cancel: true, mark_unreceived: true });
    expect(transferAbilities(all, { status: 'IN_TRANSIT' })).toMatchObject({ ship: false, receive: true, cancel: true, mark_unreceived: true });
    expect(transferAbilities(all, { status: 'RECEIVED' })).toMatchObject({ receive: false, cancel: false });
    expect(transferAbilities(all, { status: 'CANCELED' })).toMatchObject({ confirm_source: false, receive: false, cancel: false });
  });
  it('缺權限：所有操作都不行，並說明缺哪個', () => {
    for (const [who, missing] of [
      [{ ...all, transferManage: false }, ['調撥管理']],
      [{ ...all, transactionManage: false }, ['庫存交易管理']],
      [{ ...all, partView: false }, ['料件查看']],
      [{ ...all, transferManage: false, transactionManage: false, partView: false }, ['調撥管理', '庫存交易管理', '料件查看']],
    ] as const) {
      const a = transferAbilities(who, { status: 'SOURCE_CONFIRMED' });
      expect([a.confirm_source, a.ship, a.receive, a.cancel, a.mark_unreceived]).toEqual([false, false, false, false, false]);
      for (const m of missing) expect(a.problem).toContain(m);
      expect(missingPermissions(who)).toEqual(missing);
    }
    expect(permissionProblem(all)).toBe('');
  });
  it('C10：只有目的門市店長可以回報，且單子已交出或已收貨；與調撥三權限無關', () => {
    const sm = { transferManage: false, transactionManage: false, partView: false, destinationStoreManager: true };
    expect(transferAbilities(sm, { status: 'SOURCE_CONFIRMED' }).store_report).toBe(true);
    expect(transferAbilities(sm, { status: 'IN_TRANSIT' }).store_report).toBe(true);
    expect(transferAbilities(sm, { status: 'RECEIVED' }).store_report).toBe(true);
    expect(transferAbilities(sm, { status: 'REQUESTED' }).store_report).toBe(false);
    expect(transferAbilities(sm, { status: 'CANCELED' }).store_report).toBe(false);
    expect(transferAbilities({ ...sm, destinationStoreManager: false }, { status: 'IN_TRANSIT' }).store_report).toBe(false);
    expect(transferAbilities(sm, { status: 'IN_TRANSIT' })).toMatchObject({ receive: false, cancel: false, confirm_source: false });
  });
  it('取消時能不能勾「退回來源庫存」：只有已交出且還沒收貨的明細才有庫存可退', () => {
    expect(transferAbilities(all, { status: 'REQUESTED', items: [{ source_transaction_id: null, receipt_transaction_id: null }] }).returnStockAvailable).toBe(false);
    expect(transferAbilities(all, { status: 'IN_TRANSIT', items: [{ source_transaction_id: 'x', receipt_transaction_id: null }] }).returnStockAvailable).toBe(true);
    expect(transferAbilities(all, { status: 'RECEIVED', items: [{ source_transaction_id: 'x', receipt_transaction_id: 'y' }] }).returnStockAvailable).toBe(false);
  });
  it('狀態集合：進行中三種、等待收貨兩種', () => {
    expect(OPEN_STATUSES).toEqual(['REQUESTED', 'SOURCE_CONFIRMED', 'IN_TRANSIT']);
    expect(AWAITING_RECEIPT).toEqual(['SOURCE_CONFIRMED', 'IN_TRANSIT']);
  });
});

describe('C11 逾期判斷', () => {
  const now = new Date('2026-11-11T00:00:00.000Z');
  const issued = (daysAgo: number, status = 'IN_TRANSIT') => ({ status, source_confirmed_at: new Date(now.getTime() - daysAgo * 86_400_000 - 1000).toISOString() });
  it('已交出超過 N 天還沒收貨才算逾期；剛好 N 天整不算', () => {
    expect(isOverdue(issued(4), 3, now)).toBe(true);
    expect(isOverdue(issued(2), 3, now)).toBe(false);
    expect(isOverdue({ status: 'IN_TRANSIT', source_confirmed_at: new Date(now.getTime() - 3 * 86_400_000).toISOString() }, 3, now)).toBe(false);
    expect(isOverdue(issued(4, 'SOURCE_CONFIRMED'), 3, now)).toBe(true);
  });
  it('已收貨、已取消、還沒交出、沒有交出時間：不算逾期', () => {
    expect(isOverdue(issued(10, 'RECEIVED'), 3, now)).toBe(false);
    expect(isOverdue(issued(10, 'CANCELED'), 3, now)).toBe(false);
    expect(isOverdue({ status: 'REQUESTED', source_confirmed_at: null }, 3, now)).toBe(false);
    expect(isOverdue({ status: 'IN_TRANSIT', source_confirmed_at: 'bad' }, 3, now)).toBe(false);
  });
  it('設定天數改變判斷隨之改變；分界時間與天數計算', () => {
    expect(isOverdue(issued(4), 7, now)).toBe(false);
    expect(isOverdue(issued(4), 1, now)).toBe(true);
    expect(overdueCutoff(3, now)).toBe('2026-11-08T00:00:00.000Z');
    expect(overdueDaysCount(issued(4), now)).toBe(4);
    expect(overdueDaysCount({ source_confirmed_at: null }, now)).toBe(0);
    expect(DEFAULT_OVERDUE_DAYS).toBe(3);
  });
  it('設定值驗證：1 到 90 的整數', () => {
    expect(validateOverdueDays('5')).toBe(5);
    for (const bad of ['0', '91', '1.5', 'abc', '', null]) expect(() => validateOverdueDays(bad)).toThrow('1 到 90');
  });
});

describe('網址參數預填與單位換算', () => {
  it('完整保留八個參數、修剪空白、忽略其他鍵、取陣列第一個', () => {
    const p = parsePrefill({ fromRequestId: ' r1 ', requestNo: 'SR-1', partId: 'p', quantity: '5', sourceLocationId: 's', destinationStoreId: 'd', reason: '原因', notes: '備註', evil: 'x' });
    expect(p).toEqual({ fromRequestId: 'r1', requestNo: 'SR-1', partId: 'p', quantity: '5', sourceLocationId: 's', destinationStoreId: 'd', reason: '原因', notes: '備註' });
    expect(parsePrefill(new URLSearchParams('partId=abc&quantity=&x=1'))).toEqual({ partId: 'abc' });
    expect(parsePrefill({ partId: ['a', 'b'] })).toEqual({ partId: 'a' });
    expect(parsePrefill(null)).toEqual({});
  });
  const part = { base_unit: '個', purchase_unit: '箱', purchase_to_base_rate: 12 };
  it('需求單單位對照料件單位：基本單位、採購單位、對不上（用基本單位並提醒）', () => {
    expect(resolvePrefillUnit('個', part)).toEqual({ unit: 'BASE', note: null });
    expect(resolvePrefillUnit('', part)).toEqual({ unit: 'BASE', note: null });
    expect(resolvePrefillUnit('箱', part)).toEqual({ unit: 'PURCHASE', note: null });
    const odd = resolvePrefillUnit('包', part);
    expect(odd.unit).toBe('BASE');
    expect(odd.note).toContain('包');
    expect(resolvePrefillUnit('箱', { base_unit: '個', purchase_unit: '箱', purchase_to_base_rate: 0 }).unit).toBe('BASE');
  });
  it('換算成需求單單位：箱需求用個調撥（÷12）、個需求用箱調撥（×12）、同單位不變', () => {
    expect(toRequestUnit(24, 'BASE', '箱', part)).toBe(2);
    expect(toRequestUnit(2, 'PURCHASE', '個', part)).toBe(24);
    expect(toRequestUnit(5, 'BASE', '個', part)).toBe(5);
    expect(toRequestUnit(5, 'PURCHASE', '箱', part)).toBe(5);
    expect(toRequestUnit(5, 'BASE', null, part)).toBe(5);
  });
});

describe('C12 遮蔽與顯示', () => {
  const row = { id: 'x', notes: '內部', unreceived_note: '內部未收', reason: '補貨', items: [{ id: 'i', notes: '內部明細', part_id: 'p' }] };
  it('唯讀名單身分：備註、未收註記、明細備註遮蔽，原因保留；內部身分原樣', () => {
    const m = maskTransfer(row, false);
    expect(m).toMatchObject({ notes: null, unreceived_note: null, reason: '補貨' });
    expect(m.items[0]).toMatchObject({ notes: null, part_id: 'p' });
    expect(maskTransfer(row, true)).toBe(row);
  });
  it('時間軸：唯讀身分看不到內部備註，但店長自己的回報說明保留', () => {
    expect(maskEvent({ action: 'receive', note: '內部' }, false).note).toBeNull();
    expect(maskEvent({ action: 'store_report', note: '破損' }, false).note).toBe('破損');
    expect(maskEvent({ action: 'receive', note: '內部' }, true).note).toBe('內部');
  });
  it('搜尋欄位：唯讀身分不能搜尋備註；搜尋字串跳脫，逗號與括號不會弄壞查詢', () => {
    expect(transferSearchable(true)).toContain('notes');
    expect(transferSearchable(false)).not.toContain('notes');
    expect(orIlike(transferSearchable(true), 'a,b)"c')).toBe('transfer_no.ilike."%a,b)\\"c%",reason.ilike."%a,b)\\"c%",notes.ilike."%a,b)\\"c%"');
  });
  it('下一步提示與回報摘要', () => {
    expect(transferNextStep('REQUESTED')).toContain('確認來源位置已交出');
    expect(transferNextStep('IN_TRANSIT')).toContain('確認收貨');
    expect(transferNextStep('BOGUS')).toBe('');
    expect(reportSummary('DAMAGED', '外箱破')).toBe('到貨損壞：外箱破');
    expect(reportSummary(null, 'x')).toBe('');
  });
});
