import { describe, expect, it } from 'vitest';
import {
  BALANCE_CSV_COLUMNS, buildCsv, csvCell, holdingProblem, likeTerm, maskHolding, maskTransaction, parseQuantity, postPermissionText, previewPost,
  stockLevel, taipeiDayRange, toBaseQuantity, TRANSACTION_CSV_COLUMNS, transactionSource, unitChoices, validateHoldingPayload, validatePostPayload,
} from '@/lib/workspace/general-affairs/inventory-stock-rules';

// G12 庫存過帳與餘額規則（Q14、C4 至 C7、C12）：同一份純函式伺服端與頁面共用。
const L = '11111111-1111-4111-8111-111111111111';
const P = '22222222-2222-4222-8222-222222222222';
const base = { transaction_type: 'RECEIPT', location_id: L, part_id: P, quantity: 3, input_unit_type: 'BASE', reason: '到貨', idempotency_key: 'k-1' };
const NOW = new Date('2026-11-11T04:00:00.000Z');

describe('過帳輸入驗證', () => {
  it('合法輸入：類型轉大寫、文字去空白、發生時間轉 ISO', () => {
    const p = validatePostPayload({ ...base, transaction_type: 'issue', reason: ' 領用 ', notes: ' ', occurred_at: '2026-11-10T08:00:00+08:00' }, NOW);
    expect(p).toMatchObject({ transaction_type: 'ISSUE', reason: '領用', notes: null, occurred_at: '2026-11-10T00:00:00.000Z', input_unit_type: 'BASE' });
  });
  it('錯誤：類型、位置、料件、單位、原因、識別碼', () => {
    expect(() => validatePostPayload({ ...base, transaction_type: 'MOVE' }, NOW)).toThrow('交易類型錯誤');
    expect(() => validatePostPayload({ ...base, location_id: 'x' }, NOW)).toThrow('請選擇庫存位置');
    expect(() => validatePostPayload({ ...base, part_id: '' }, NOW)).toThrow('請選擇料件');
    expect(() => validatePostPayload({ ...base, input_unit_type: 'BOX' }, NOW)).toThrow('單位類型錯誤');
    expect(() => validatePostPayload({ ...base, reason: '  ' }, NOW)).toThrow('請輸入交易原因');
    expect(() => validatePostPayload({ ...base, reason: 'x'.repeat(301) }, NOW)).toThrow('300 字');
    expect(() => validatePostPayload({ ...base, idempotency_key: '' }, NOW)).toThrow('防重複識別碼');
    expect(() => validatePostPayload({ ...base, idempotency_key: 'k'.repeat(121) }, NOW)).toThrow('120 字');
    expect(() => validatePostPayload({ ...base, notes: 'n'.repeat(501) }, NOW)).toThrow('500 字');
  });
  it('發生時間不可晚於現在（容許 1 分鐘誤差）；格式錯誤擋下', () => {
    expect(() => validatePostPayload({ ...base, occurred_at: '2026-11-11T05:00:00Z' }, NOW)).toThrow('不可晚於現在');
    expect(validatePostPayload({ ...base, occurred_at: '2026-11-11T04:00:30Z' }, NOW).occurred_at).toBe('2026-11-11T04:00:30.000Z');
    expect(() => validatePostPayload({ ...base, occurred_at: 'yesterday' }, NOW)).toThrow('格式錯誤');
  });
  it('白名單：系統欄位、參考單據、未知欄位一律拒絕', () => {
    for (const key of ['quantity_base', 'balance_after', 'created_by', 'reference_type', 'reference_id', 'metadata', 'foo']) {
      expect(() => validatePostPayload({ ...base, [key]: 'x' }, NOW), key).toThrow('不支援的欄位');
    }
    expect(() => validatePostPayload(null, NOW)).toThrow('格式錯誤');
    expect(() => validatePostPayload([], NOW)).toThrow('格式錯誤');
  });
});

describe('數量與單位換算', () => {
  it('數量：大於 0、最多 4 位小數、不收科學記號與非數字', () => {
    expect(parseQuantity('12.5')).toBe(12.5);
    expect(parseQuantity(0.0001)).toBe(0.0001);
    for (const bad of ['', '  ', 'abc', '0', '-1', '1e3', '1.00001', 1e12, NaN]) expect(() => parseQuantity(bad as any), String(bad)).toThrow();
  });
  it('換算：基本單位原樣；採購單位乘換算率；沒有採購單位或換算率無效回 null；超過 4 位小數回 null', () => {
    const part = { base_unit: '個', purchase_unit: '箱', purchase_to_base_rate: 12 };
    expect(toBaseQuantity(2, 'BASE', part)).toBe(2);
    expect(toBaseQuantity(2, 'PURCHASE', part)).toBe(24);
    expect(toBaseQuantity(0.5, 'PURCHASE', part)).toBe(6);
    expect(toBaseQuantity(1, 'PURCHASE', { base_unit: '個' })).toBeNull();
    expect(toBaseQuantity(1, 'PURCHASE', { base_unit: '個', purchase_unit: '箱', purchase_to_base_rate: 0 })).toBeNull();
    expect(toBaseQuantity(1, 'PURCHASE', { base_unit: '個', purchase_unit: '箱', purchase_to_base_rate: 0.00001 })).toBeNull();
  });
  it('單位選項：沒有有效採購單位換算就只有基本單位', () => {
    expect(unitChoices({ base_unit: '個' }).map((c) => c.value)).toEqual(['BASE']);
    expect(unitChoices({ base_unit: '個', purchase_unit: '箱', purchase_to_base_rate: 12 }).map((c) => c.value)).toEqual(['BASE', 'PURCHASE']);
  });
});

describe('C6 過帳風險確認（出庫、調減、會變負才確認）', () => {
  const part = { base_unit: '個' };
  it('入庫、調增：不需要確認', () => {
    expect(previewPost({ type: 'RECEIPT', quantity: 5, unitType: 'BASE', part, before: 3, allowNegative: false })).toMatchObject({ risky: false, after: 8, negative: false, blocked: false });
    expect(previewPost({ type: 'ADJUST_IN', quantity: 1, unitType: 'BASE', part, before: 2, allowNegative: false })).toMatchObject({ risky: false, after: 3 });
    // 補帳後仍是負數：還是要確認（會變成負庫存）
    expect(previewPost({ type: 'ADJUST_IN', quantity: 1, unitType: 'BASE', part, before: -2, allowNegative: true })).toMatchObject({ risky: true, after: -1, negative: true });
  });
  it('出庫、調減：一律確認並算出過帳後餘額', () => {
    const p = previewPost({ type: 'ISSUE', quantity: 2, unitType: 'BASE', part, before: 5, allowNegative: false });
    expect(p).toMatchObject({ risky: true, after: 3, negative: false, blocked: false });
    expect(p.reasons[0]).toContain('減少庫存');
    expect(previewPost({ type: 'ADJUST_OUT', quantity: 1, unitType: 'BASE', part, before: 1, allowNegative: false }).risky).toBe(true);
  });
  it('會變負數：允許負庫存的位置要確認；不允許的位置直接擋（blocked）', () => {
    const allow = previewPost({ type: 'ISSUE', quantity: 9, unitType: 'BASE', part, before: 5, allowNegative: true });
    expect(allow).toMatchObject({ risky: true, after: -4, negative: true, blocked: false });
    expect(allow.reasons.join('')).toContain('變成負數');
    expect(previewPost({ type: 'ISSUE', quantity: 9, unitType: 'BASE', part, before: 5, allowNegative: false })).toMatchObject({ negative: true, blocked: true });
  });
  it('採購單位先換算；換算不了回 baseQuantity null', () => {
    const box = { base_unit: '個', purchase_unit: '箱', purchase_to_base_rate: 10 };
    expect(previewPost({ type: 'ISSUE', quantity: 2, unitType: 'PURCHASE', part: box, before: 25, allowNegative: false })).toMatchObject({ baseQuantity: 20, after: 5 });
    expect(previewPost({ type: 'ISSUE', quantity: 2, unitType: 'PURCHASE', part, before: 25, allowNegative: false }).baseQuantity).toBeNull();
  });
  it('小數浮點誤差：0.1 + 0.2 這類結果收斂到 4 位小數', () => {
    expect(previewPost({ type: 'RECEIPT', quantity: 0.2, unitType: 'BASE', part, before: 0.1, allowNegative: false }).after).toBe(0.3);
  });
});

describe('C7 低庫存紅黃標', () => {
  it('低於安全庫存 = 紅；否則低於補貨點 = 黃；等於不算低於', () => {
    expect(stockLevel(2, 5, 10)).toBe('red');
    expect(stockLevel(7, 5, 10)).toBe('yellow');
    expect(stockLevel(5, 5, 10)).toBe('yellow');
    expect(stockLevel(10, 5, 10)).toBeNull();
    expect(stockLevel(12, 5, 10)).toBeNull();
  });
  it('沒設定就不標；字串數字與負庫存也能判斷', () => {
    expect(stockLevel(0, null, null)).toBeNull();
    expect(stockLevel(1, undefined, 3)).toBe('yellow');
    expect(stockLevel('2', '5', '10')).toBe('red');
    expect(stockLevel(-1, 0, null)).toBe('red');
    expect(stockLevel(NaN, 1, 1)).toBeNull();
  });
});

describe('日期區間（台北時間）與搜尋跳脫', () => {
  it('一天的起訖 = 台北 00:00 到 23:59:59.999', () => {
    expect(taipeiDayRange('2026-11-11')).toEqual({ from: '2026-11-10T16:00:00.000Z', to: '2026-11-11T15:59:59.999Z' });
  });
  it('格式錯誤或不存在的日期擋下', () => {
    for (const bad of ['2026-2-1', '20261111', 'abc', '2026-02-31', '2026-13-01']) expect(() => taipeiDayRange(bad), bad).toThrow();
  });
  it('LIKE 跳脫：% _ \\ 保留原義；長度限制 100', () => {
    expect(likeTerm('50%_a\\b')).toBe('%50\\%\\_a\\\\b%');
    expect(likeTerm('x'.repeat(150)).length).toBe(102);
  });
});

describe('C5 CSV 匯出', () => {
  it('儲存格：逗號、引號、換行加引號；公式開頭補單引號；數字不處理', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('l1\nl2')).toBe('"l1\nl2"');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(null)).toBe('');
  });
  it('餘額 CSV：BOM、標題列、狀態與持有欄位、台北時間', () => {
    const csv = buildCsv([{ location: { name: '總倉', code: 'WH' }, part: { name: '燈泡,LED', base_unit: '個' }, quantity_base: 3, safety_stock_qty: 5, reorder_point_qty: 10, level: 'red' as const,
      last_transaction_at: '2026-11-10T16:30:00Z', holding: { in_use_quantity: 1, idle_quantity: 2, unclassified_quantity: 0 } }], BALANCE_CSV_COLUMNS);
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines[0]).toBe('位置,位置代碼,門市,料件,料件代碼,品牌,型號,規格,庫存（基本單位）,基本單位,安全庫存,補貨點,庫存狀態,使用中,閒置可調撥,待確認,最後異動時間');
    expect(lines[1]).toBe('總倉,WH,,"燈泡,LED",,,,,3,個,5,10,低於安全庫存,1,2,0,2026-11-11 00:30');
  });
  it('流水 CSV：類型與單位轉白話、來源與記錄人', () => {
    const csv = buildCsv([{ transaction_no: 'GAIT-1', transaction_type: 'ADJUST_OUT', occurred_at: '2026-11-11T00:00:00Z', location: { name: 'A' }, part: { name: 'P' }, quantity_input: 2, input_unit_type: 'PURCHASE', quantity_base: -24, balance_before: 30, balance_after: 6, source_label: '手動過帳', reason: '=bad', notes: null, creator_name: '王小明' }], TRANSACTION_CSV_COLUMNS);
    expect(csv.trim().split('\r\n')[1]).toBe("GAIT-1,2026-11-11 08:00,調減,A,P,,2,採購單位,-24,30,6,手動過帳,'=bad,,王小明");
  });
});

describe('流水來源與 C12 遮蔽', () => {
  it('來源：手動、調撥單、調撥退回來源庫存（Q12）；metadata 只在伺服端讀', () => {
    expect(transactionSource({ reference_type: null })).toMatchObject({ label: '手動過帳', return_stock: false });
    expect(transactionSource({ reference_type: 'INVENTORY_TRANSFER', metadata: { transfer_no: 'GAT-1', action: 'ship' } })).toMatchObject({ label: '調撥 GAT-1', transfer_no: 'GAT-1' });
    expect(transactionSource({ reference_type: 'INVENTORY_TRANSFER', metadata: { transfer_no: 'GAT-1', action: 'return_stock' } })).toMatchObject({ label: '調撥退回來源庫存 GAT-1', return_stock: true });
    expect(transactionSource({ reference_type: 'INVENTORY_TRANSFER', metadata: { return_stock: true } }).return_stock).toBe(true);
    expect(transactionSource({ reference_type: 'OTHER_DOC' }).label).toBe('OTHER_DOC');
  });
  it('唯讀名單身分：原因與備註遮蔽成 null；內部身分原樣', () => {
    const row = { id: 1, reason: '盤點差異', notes: '內部', transaction_no: 'X' };
    expect(maskTransaction(row, false)).toEqual({ id: 1, transaction_no: 'X', reason: null, notes: null });
    expect(maskTransaction(row, true)).toBe(row);
    expect(maskHolding({ in_use_quantity: 1, notes: '內部原因' }, false)).toEqual({ in_use_quantity: 1, notes: null });
    expect(maskHolding({ in_use_quantity: 1, notes: '內部原因' }, true)).toEqual({ in_use_quantity: 1, notes: '內部原因' });
    expect(maskHolding(null, false)).toBeNull();
  });
});

describe('C4 持有狀態輸入', () => {
  const ok = { in_use_quantity: 2, idle_quantity: 1, expected_updated_at: null };
  it('合法：原因選填；expected_updated_at 必須提供（沒調整過傳 null）', () => {
    expect(validateHoldingPayload({ ...ok, reason: ' 盤點 ' })).toEqual({ in_use_quantity: 2, idle_quantity: 1, reason: '盤點', expected_updated_at: null });
    expect(validateHoldingPayload({ ...ok, expected_updated_at: '2026-11-11T00:00:00Z' }).expected_updated_at).toBe('2026-11-11T00:00:00Z');
    expect(() => validateHoldingPayload({ in_use_quantity: 1, idle_quantity: 1 })).toThrow('expected_updated_at');
    expect(() => validateHoldingPayload({ ...ok, expected_updated_at: 'bad' })).toThrow('格式錯誤');
  });
  it('數量：0 以上、最多 4 位小數；未知欄位、超長原因擋下', () => {
    for (const bad of [-1, 'x', '', '1e2', 1.00001]) expect(() => validateHoldingPayload({ ...ok, in_use_quantity: bad }), String(bad)).toThrow();
    expect(() => validateHoldingPayload({ ...ok, foo: 1 })).toThrow('不支援的欄位');
    expect(() => validateHoldingPayload({ ...ok, reason: 'x'.repeat(501) })).toThrow('500 字');
    expect(validateHoldingPayload({ ...ok, in_use_quantity: 0, idle_quantity: 0 }).in_use_quantity).toBe(0);
  });
  it('畫面檢查：合計不可超過持有量；持有量為負時視為 0', () => {
    expect(holdingProblem(3, 2, 5)).toBe('');
    expect(holdingProblem(3, 3, 5)).toContain('不可超過');
    expect(holdingProblem(1, 0, -2)).toContain('不可超過');
    expect(holdingProblem(-1, 0, 5)).toContain('0 以上');
  });
});

describe('兩個權限缺哪個講清楚（Q13）', () => {
  it('缺哪個列哪個；都有就是空字串', () => {
    expect(postPermissionText({ canPost: true, canPartView: true })).toBe('');
    expect(postPermissionText({ canPost: false, canPartView: true })).toContain('庫存交易管理');
    expect(postPermissionText({ canPost: true, canPartView: false })).toMatch(/缺少：料件查看。/);
    expect(postPermissionText({ canPost: false, canPartView: false })).toContain('庫存交易管理、料件查看');
  });
});
