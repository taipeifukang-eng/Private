import { describe, expect, it } from 'vitest';
import * as X from 'xlsx';
import {
  numberValue,
  parseSalesRows,
  planSalesDedupe,
  REQUIRED_HEADERS,
  saleDateValue,
  salesDedupeKey,
  validateSalesSheet,
} from '../../../lib/relationships/sales-import';
import { importResultMessage, lastFkrsNumber, relationshipPageCount, salesTotals } from '../../../vue-workspace/src/relationship-members';

describe('M6-P07 銷售日期驗證（YYYY/MM/DD HH:MM，含不存在日期）', () => {
  it.each([
    ['2038/03/01 14:30', '2038-03-01T14:30:00+08:00'],
    ['2038/12/31 23:59', '2038-12-31T23:59:00+08:00'],
    ['2040/02/29 00:00', '2040-02-29T00:00:00+08:00'],
    [' 2038/03/01 14:30 ', '2038-03-01T14:30:00+08:00'],
  ])('合法 %s', (input, expected) => {
    expect(saleDateValue(input)).toBe(expected);
  });
  it.each([
    '2038/02/30 10:00', // 不存在的日
    '2038/02/29 10:00', // 2038 不是閏年
    '2038/13/01 10:00', // 不存在的月
    '2038/00/10 10:00',
    '2038/03/01 24:00', // 沒有 24 點
    '2038/03/01 12:60',
    '2038-03-01 14:30', // 斜線格式才合法
    '2038/3/1 14:30', // 要補零
    '2038/03/01', // 沒有時間
    '2038/03/01 14:30:15',
    '',
    'abc',
  ])('不合法 %s', (input) => {
    expect(saleDateValue(input)).toBeNull();
  });
  it('Excel 日期序號：換成台北時間字串', () => {
    // 2038-03-01 14:30 的序號
    const serial = (Date.UTC(2038, 2, 1, 14, 30) - Date.UTC(1899, 11, 30)) / 86400000;
    expect(saleDateValue(serial)).toBe('2038-03-01T14:30:00+08:00');
  });
});

describe('M6-P07 數量與金額', () => {
  it.each([[5, 5], ['1,234.5', 1234.5], [' 7 ', 7], ['-3', -3]])('%s', (v, e) => expect(numberValue(v)).toBe(e));
  it.each(['', '   ', 'abc', '12x'])('非數字 %s', (v) => expect(Number.isNaN(numberValue(v))).toBe(true));
});

describe('M6-P07 檔案欄位驗證與逐列驗證（舊版訊息）', () => {
  const header = Object.fromEntries(REQUIRED_HEADERS.map((h) => [h, 'x']));
  it('沒有資料、缺欄位、欄位順序錯誤', () => {
    expect(validateSalesSheet([])).toBe('Excel 中沒有資料');
    const { 品名: _omit, ...missing } = header;
    expect(validateSalesSheet([missing])).toBe('缺少欄位：品名');
    expect(validateSalesSheet([{ 會員編號: 1, 門市代號: 1, 銷售日期: 1, 品號: 1, 品名: 1, 數量: 1, 金額: 1 }])).toBe('欄位順序錯誤，前七欄必須依序為：門市代號、銷售日期、會員編號、品號、品名、數量、金額');
    expect(validateSalesSheet([header])).toBeNull();
  });
  it('逐列錯誤：第 N 列從 2 起算，訊息與舊版相同', () => {
    const good = { 門市代號: 'VW001', 銷售日期: '2038/03/01 14:30', 會員編號: 'M1', 品號: 'P1', 品名: 'n', 數量: 1, 金額: 10 };
    const { validRows, errors } = parseSalesRows([good, { ...good, 銷售日期: '2038/02/30 10:00' }, { ...good, 數量: 'x' }, { ...good, 品名: '' }]);
    expect(validRows).toHaveLength(4);
    expect(errors).toEqual([2, 3, 4].map((n) => `第 ${n + 1} 列資料不完整，銷售日期須為 YYYY/MM/DD HH:MM，數量與金額須為數字`));
  });
});

describe('M6-P07 去重規則（只略過資料庫已存在的相同明細）', () => {
  const row = (over: Record<string, unknown> = {}) => ({ storeCode: 'VW001', saleDatetime: '2038-03-01T14:30:00+08:00', memberNumber: 'M1', productCode: 'P1', quantity: 1, amount: 10, ...over });
  const counts = (rows: ReturnType<typeof row>[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(salesDedupeKey(r), (m.get(salesDedupeKey(r)) || 0) + 1);
    return m;
  };
  it('去重鍵：台北時間字串，不受時區表示影響；數量金額固定 2 位小數', () => {
    expect(salesDedupeKey(row())).toBe(salesDedupeKey(row({ saleDatetime: '2038-03-01T06:30:00+00:00' })));
    expect(salesDedupeKey(row({ quantity: 1 }))).toBe(salesDedupeKey(row({ quantity: '1.00' })));
    expect(salesDedupeKey(row({ amount: 10.5 }))).toBe(salesDedupeKey(row({ amount: '10.50' })));
    expect(salesDedupeKey(row({ productCode: 'P2' }))).not.toBe(salesDedupeKey(row()));
    expect(salesDedupeKey(row({ saleDatetime: '2038-03-01T14:31:00+08:00' }))).not.toBe(salesDedupeKey(row()));
  });
  it('首次匯入：全部新增', () => {
    const r = planSalesDedupe([row(), row({ productCode: 'P2' })], new Map());
    expect([r.fresh.length, r.skipped.length]).toEqual([2, 0]);
  });
  it('同檔重傳：全部略過', () => {
    const file = [row(), row({ productCode: 'P2' })];
    const r = planSalesDedupe(file, counts(file));
    expect([r.fresh.length, r.skipped.length]).toEqual([0, 2]);
  });
  it('部分重疊：新增與略過計數正確', () => {
    const existing = [row(), row({ productCode: 'P2' })];
    const r = planSalesDedupe([row(), row({ productCode: 'P3' }), row({ productCode: 'P2' }), row({ productCode: 'P4' })], counts(existing));
    expect([r.fresh.length, r.skipped.length]).toEqual([2, 2]);
    expect(r.fresh.map((x) => x.productCode)).toEqual(['P3', 'P4']);
  });
  it('同檔內相同列：資料庫沒有時都新增（不因同檔重複而略過）', () => {
    const r = planSalesDedupe([row(), row(), row()], new Map());
    expect([r.fresh.length, r.skipped.length]).toEqual([3, 0]);
  });
  it('資料庫已有 1 筆、檔案有 2 筆相同列：略過 1、新增 1；資料庫有 2 筆、重傳同檔：全略過', () => {
    const a = planSalesDedupe([row(), row()], counts([row()]));
    expect([a.fresh.length, a.skipped.length]).toEqual([1, 1]);
    const b = planSalesDedupe([row(), row()], counts([row(), row()]));
    expect([b.fresh.length, b.skipped.length]).toEqual([0, 2]);
  });
});

describe('M6-P07 畫面與統計純函式', () => {
  it('匯入結果訊息', () => {
    expect(importResultMessage({ imported: 5, skipped: 2 })).toBe('匯入 5 筆，略過重複 2 筆');
    expect(importResultMessage({ imported: 3, skipped: 0 })).toBe('匯入 3 筆，略過重複 0 筆');
    expect(importResultMessage({ imported: 0, skipped: 4 })).toContain('此檔案內容皆已匯入過');
  });
  it('銷售統計三個數字：筆數、數量合計、金額合計', () => {
    expect(salesTotals([{ quantity: '1', amount: 100 }, { quantity: 2, amount: '250.5' }, { quantity: null, amount: undefined }])).toEqual({ count: 3, quantity: 3, amount: 350.5 });
    expect(salesTotals([])).toEqual({ count: 0, quantity: 0, amount: 0 });
  });
  it('FKRS 最後編號：依數字大小，不分大小寫；沒有時回傳「尚無 FKRS 編號」', () => {
    expect(lastFkrsNumber([{ member_number: 'FKRS0009' }, { member_number: 'fkrs0100' }, { member_number: 'FKRS0020' }, { member_number: 'ABC1' }, { member_number: null }])).toBe('FKRS0100');
    expect(lastFkrsNumber([{ member_number: ' fkrs0007 ' }, { member_number: 'FKRS0007' }])).toBe('FKRS0007');
    expect(lastFkrsNumber([{ member_number: 'FKRS99' }, { member_number: 'FKRS100' }])).toBe('FKRS100');
    expect(lastFkrsNumber([{ member_number: 'ABC' }, {}])).toBe('尚無 FKRS 編號');
    expect(lastFkrsNumber([])).toBe('尚無 FKRS 編號');
  });
  it('分頁計數：每頁 50 筆，至少 1 頁', () => {
    expect([0, 1, 50, 51, 100, 101, 5000].map((n) => relationshipPageCount(n))).toEqual([1, 1, 1, 2, 2, 3, 100]);
    expect(relationshipPageCount(10, 5)).toBe(2);
  });
});
