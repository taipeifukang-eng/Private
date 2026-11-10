import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { IMPORT_COLUMNS, ImportFileError, MAX_IMPORT_ROWS, importDate, mapImportRow, parseImportWorkbook, type RawRow } from '@/lib/workspace/general-affairs/import-columns';

// Q29 Excel 匯入：欄位定義、Excel 讀取、中文值轉資料庫值（純函式）。
const headers = IMPORT_COLUMNS.map((c) => c.header);
function book(rows: unknown[][], head: string[] = headers) {
  const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '匯入資料');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
const line = (over: Record<string, unknown>) => IMPORT_COLUMNS.map((c) => (c.header in over ? over[c.header] : ''));
const raw = (over: Record<string, string>, row_no = 2): RawRow => ({ row_no, cells: { ...Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, ''])), ...over } });

describe('importDate', () => {
  it('接受 YYYY-MM-DD、YYYY/M/D、Excel 日期序號', () => {
    expect(importDate('2026-01-05')).toBe('2026-01-05');
    expect(importDate('2026/1/5')).toBe('2026-01-05');
    expect(importDate(46027)).toBe('2026-01-05');
  });
  it('拒絕不存在的日期與亂字', () => {
    expect(importDate('2026-02-30')).toBeNull();
    expect(importDate('明天')).toBeNull();
    expect(importDate('')).toBeNull();
  });
});

describe('parseImportWorkbook', () => {
  it('讀第一個工作表、列號是 Excel 列號、空白列略過', () => {
    const rows = parseImportWorkbook(book([line({ 類型: '設備', 門市代碼: 'ZT01', 分類代碼: 'AB', 名稱: 'x' }), line({}), line({ 類型: '設施', 門市代碼: 'ZT01', 分類代碼: 'CD', 名稱: 'y' })]));
    expect(rows.map((r) => r.row_no)).toEqual([2, 4]);
    expect(rows[0].cells.store_code).toBe('ZT01');
  });
  it('壓縮檔目錄宣告解壓後過大（壓縮炸彈）或目錄毀損：解析前就拒絕', () => {
    const buf = Buffer.from(book([line({ 類型: '設備', 門市代碼: 'A', 分類代碼: 'B', 名稱: 'x' })]));
    const cd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(cd).toBeGreaterThan(0);
    const bomb = Buffer.from(buf);
    bomb.writeUInt32LE(40 * 1024 * 1024, cd + 24);
    expect(() => parseImportWorkbook(bomb)).toThrow(ImportFileError);
    const broken = Buffer.from(buf);
    broken.writeUInt32LE(0, buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])));
    expect(() => parseImportWorkbook(broken)).toThrow(ImportFileError);
  });
  it('日期格是 Excel 序號時轉成 YYYY-MM-DD 文字', () => {
    const rows = parseImportWorkbook(book([line({ 類型: '設備', 門市代碼: 'A', 分類代碼: 'B', 名稱: 'x', 購置日期: 46027 })]));
    expect(rows[0].cells.purchased_at).toBe('2026-01-05');
  });
  it('不是 xlsx、缺必要欄位、欄位重複、沒有資料列、超過 500 列：丟 ImportFileError', () => {
    expect(() => parseImportWorkbook(Buffer.from('hello world'))).toThrow(ImportFileError);
    expect(() => parseImportWorkbook(book([line({ 類型: '設備' })], ['類型', '名稱']))).toThrow(/缺少：門市代碼、分類代碼/);
    expect(() => parseImportWorkbook(book([line({ 類型: '設備' })], [...headers, '名稱']))).toThrow(/重複/);
    expect(() => parseImportWorkbook(book([]))).toThrow(/沒有任何資料列/);
    const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => line({ 類型: '設備', 門市代碼: 'A', 分類代碼: 'B', 名稱: `n${i}` }));
    expect(() => parseImportWorkbook(book(many))).toThrow(/最多匯入 500 列/);
    expect(parseImportWorkbook(book(many.slice(0, MAX_IMPORT_ROWS)))).toHaveLength(MAX_IMPORT_ROWS);
  });
  it('可選欄位整欄不存在也能讀（視為空白）', () => {
    const rows = parseImportWorkbook(book([['設備', 'ZT01', 'AB', 'x']], ['類型', '門市代碼', '分類代碼', '名稱']));
    expect(rows[0].cells.brand).toBe('');
  });
});

describe('mapImportRow', () => {
  const eq = { kind: '設備', store_code: 'ZT01', category_code: 'AB01', name: '冰箱' };
  it('設備：中文狀態、重要程度、保固、日期、金額轉成資料庫值', () => {
    const m = mapImportRow(raw({ ...eq, brand: 'B', status: '備品', criticality: '關鍵', has_warranty: '是', warranty_end_date: '2027-01-31', purchased_at: '2026-03-01', purchase_amount: '12,000', asset_code: 'X1' }));
    expect(m.errors).toEqual([]);
    expect(m.row).toMatchObject({ kind: 'EQUIPMENT', status: 'SPARE', criticality: 'CRITICAL', has_warranty: true, warranty_end_date: '2027-01-31', purchased_at: '2026-03-01', purchase_amount: 12000, asset_code: 'X1', brand: 'B' });
  });
  it('預設：狀態使用中、重要程度一般、無保固', () => {
    expect(mapImportRow(raw(eq)).row).toMatchObject({ status: 'ACTIVE', criticality: 'NORMAL', has_warranty: false, warranty_end_date: null });
  });
  it('設施：數量與單位一起填、設施狀態中文', () => {
    const m = mapImportRow(raw({ kind: '設施', store_code: 'ZT01', category_code: 'CD01', name: '招牌', status: '整修中', quantity: '2', unit: '座', facility_code: 'F-1' }));
    expect(m.row).toMatchObject({ kind: 'FACILITY', status: 'UNDER_RENOVATION', quantity: 2, unit: '座', facility_code: 'F-1' });
  });
  it('錯誤：用欄位名說明，可一次回報多個', () => {
    const m = mapImportRow(raw({ kind: '機器', store_code: '', category_code: 'X', name: '', status: '亂填', purchased_at: '2026-13-01', purchase_amount: '-5' }));
    expect(m.row).toBeNull();
    const all = m.errors.join('|');
    expect(all).toMatch(/「類型」只能填/);
    expect(all).toMatch(/「門市代碼」必填/);
    expect(all).toMatch(/「名稱」必填/);
    expect(all).toMatch(/「購置日期」「2026-13-01」不是有效日期/);
    expect(all).toMatch(/「購置金額」/);
  });
  it('設備不能填設施欄位、設施不能填設備欄位；設備狀態不接受設施狀態', () => {
    expect(mapImportRow(raw({ ...eq, unit: '座' })).errors[0]).toMatch(/「單位」只有設施使用/);
    expect(mapImportRow(raw({ kind: '設施', store_code: 'Z', category_code: 'C', name: 'n', brand: 'B' })).errors[0]).toMatch(/「品牌」只有設備使用/);
    expect(mapImportRow(raw({ ...eq, status: '整修中' })).errors[0]).toMatch(/不是設備的狀態/);
  });
  it('數量與單位要一起；保固日要搭配「是否保固」；是否保固只能是/否', () => {
    expect(mapImportRow(raw({ kind: '設施', store_code: 'Z', category_code: 'C', name: 'n', quantity: '2' })).errors[0]).toMatch(/數量與單位要一起填/);
    expect(mapImportRow(raw({ ...eq, warranty_end_date: '2027-01-01' })).errors[0]).toMatch(/「是否保固」要填「是」/);
    expect(mapImportRow(raw({ ...eq, has_warranty: '也許' })).errors[0]).toMatch(/只能填「是」或「否」/);
  });
  it('長度上限', () => {
    expect(mapImportRow(raw({ ...eq, name: 'x'.repeat(201) })).errors[0]).toMatch(/最長 200 字/);
  });
  it('資料庫值（英文代碼）也接受', () => {
    expect(mapImportRow(raw({ kind: 'EQUIPMENT', store_code: 'Z', category_code: 'C', name: 'n', status: 'SPARE', criticality: 'HIGH' })).row).toMatchObject({ status: 'SPARE', criticality: 'HIGH' });
  });
});
