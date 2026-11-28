import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  MATRIX_KINDS, MATRIX_SHEET_NAMES, matrixSheet, matrixTable, matrixValue, matrixWorkbookSheets, parseMatrixYear, periodSheet, reportFileName,
  type MatrixCell, type MatrixData,
} from '@/lib/workspace/general-affairs/utility-report-matrix';
import { buildSheetsWorkbook } from '../../../vue-workspace/src/lib/xlsx';

// 水電話費總表：年度逐月矩陣彙整、Excel 工作表內容（含真的寫出 xlsx 再讀回來）。
const cell = (o: Partial<MatrixCell> = {}): MatrixCell => {
  const c = { WATER: 0, ELECTRICITY: 0, PHONE: 0, INTERNET: 0, total: 0, bill_count: 0, ...o };
  if (o.total === undefined) c.total = c.WATER + c.ELECTRICITY + c.PHONE + c.INTERNET;
  return c;
};
const months = (over: Record<number, Partial<MatrixCell>>): MatrixCell[] => Array.from({ length: 12 }, (_, i) => cell(over[i + 1] || {}));
const DATA: MatrixData = {
  year: 2038,
  rows: [
    { store_id: 'a', store_code: 'VW001', location_name: 'VW001 測試一店', months: months({ 3: { ELECTRICITY: 1000, WATER: 200, bill_count: 2 }, 5: { PHONE: 300.5, bill_count: 1 } }) },
    { store_id: 'b', store_code: 'ZT01', location_name: 'ZT01 測試二店', months: months({ 3: { ELECTRICITY: 500, INTERNET: 100 }, 12: { WATER: 50 } }) },
    { store_id: null, store_code: null, location_name: '倉庫', months: months({}) },
  ],
  month_totals: months({ 3: { ELECTRICITY: 1500, WATER: 200, INTERNET: 100 }, 5: { PHONE: 300.5 }, 12: { WATER: 50 } }),
};

describe('矩陣彙整', () => {
  it('費用類型切換：全部＝合計，其餘只取該類型', () => {
    const c = cell({ WATER: 1, ELECTRICITY: 2, PHONE: 3, INTERNET: 4 });
    expect(matrixValue(c, 'ALL')).toBe(10);
    expect(matrixValue(c, 'WATER')).toBe(1);
    expect(matrixValue(c, 'ELECTRICITY')).toBe(2);
    expect(matrixValue(c, 'PHONE')).toBe(3);
    expect(matrixValue(c, 'INTERNET')).toBe(4);
    expect(matrixValue(undefined, 'ALL')).toBe(0);
  });
  it('每據點一列、12 個月＋全年合計；沒帳單的據點全是 0', () => {
    const t = matrixTable(DATA, 'ALL');
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0].months).toHaveLength(12);
    expect(t.rows[0].months[2]).toBe(1200);
    expect(t.rows[0].months[4]).toBe(300.5);
    expect(t.rows[0].sum).toBe(1500.5);
    expect(t.rows[1].sum).toBe(650);
    expect(t.rows[2].sum).toBe(0);
    expect(t.rows[2].months.every((v) => v === 0)).toBe(true);
  });
  it('各月合計與全年總計：等於逐列相加', () => {
    const t = matrixTable(DATA, 'ALL');
    expect(t.monthTotals[2]).toBe(1800);
    expect(t.monthTotals[4]).toBe(300.5);
    expect(t.monthTotals[11]).toBe(50);
    expect(t.grandTotal).toBe(2150.5);
    expect(t.rows.reduce((s, r) => s + r.sum, 0)).toBe(t.grandTotal);
  });
  it('依費用類型：水、電、電話、網路各自只算自己', () => {
    expect(matrixTable(DATA, 'WATER').grandTotal).toBe(250);
    expect(matrixTable(DATA, 'ELECTRICITY').grandTotal).toBe(1500);
    expect(matrixTable(DATA, 'PHONE').grandTotal).toBe(300.5);
    expect(matrixTable(DATA, 'INTERNET').grandTotal).toBe(100);
    // 四類相加＝全部
    const sum = (['WATER', 'ELECTRICITY', 'PHONE', 'INTERNET'] as const).reduce((s, k) => s + matrixTable(DATA, k).grandTotal, 0);
    expect(sum).toBe(matrixTable(DATA, 'ALL').grandTotal);
  });
  it('小數相加不出現浮點誤差；月份資料不足 12 個也補 0', () => {
    const d: MatrixData = { year: 2038, month_totals: [], rows: [{ store_id: 'x', store_code: 'X', location_name: 'X', months: [cell({ WATER: 0.1 }), cell({ WATER: 0.2 })] }] };
    const t = matrixTable(d, 'WATER');
    expect(t.rows[0].months).toHaveLength(12);
    expect(t.rows[0].sum).toBe(0.3);
    expect(t.grandTotal).toBe(0.3);
  });
  it('年度參數檢查', () => {
    expect(parseMatrixYear(new URLSearchParams('year=2038'))).toBe(2038);
    for (const bad of ['', 'year=abc', 'year=1999', 'year=2101', 'year=2038.5']) expect(() => parseMatrixYear(new URLSearchParams(bad))).toThrow('請選擇正確年度');
  });
});

describe('Excel 工作表內容', () => {
  it('五頁：合計、水費、電費、電話費、網路費', () => {
    const sheets = matrixWorkbookSheets(DATA);
    expect(sheets.map((s) => s.name)).toEqual(['合計', '水費', '電費', '電話費', '網路費']);
    expect(MATRIX_KINDS.map((k) => MATRIX_SHEET_NAMES[k])).toEqual(sheets.map((s) => s.name));
  });
  it('每頁標題列＝據點、1月…12月、全年合計；每據點一列；最後一列合計', () => {
    const s = matrixSheet(DATA, 'ALL');
    expect(s.aoa[0]).toEqual(['據點', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '全年合計']);
    expect(s.aoa).toHaveLength(1 + 3 + 1);
    expect(s.aoa[1]).toEqual(['VW001 測試一店', 0, 0, 1200, 0, 300.5, 0, 0, 0, 0, 0, 0, 0, 1500.5]);
    expect(s.aoa[2][0]).toBe('ZT01 測試二店');
    expect(s.aoa[2][3]).toBe(600);
    expect(s.aoa[2][12]).toBe(50);
    expect(s.aoa[3]).toEqual(['倉庫', ...Array(12).fill(0), 0]);
    expect(s.aoa[4]).toEqual(['合計', 0, 0, 1800, 0, 300.5, 0, 0, 0, 0, 0, 0, 50, 2150.5]);
  });
  it('水費頁只含水費；各頁的全年合計加起來等於合計頁', () => {
    const sheets = matrixWorkbookSheets(DATA);
    const grand = (i: number) => sheets[i].aoa[sheets[i].aoa.length - 1][13] as number;
    expect(grand(1)).toBe(250);
    expect(sheets[1].aoa[1][3]).toBe(200);
    expect(sheets[1].aoa[2][12]).toBe(50);
    expect(grand(1) + grand(2) + grand(3) + grand(4)).toBe(grand(0));
  });
  it('真的寫成 xlsx 再讀回來：工作表名稱與儲存格內容一致（金額是數字）', () => {
    const book = buildSheetsWorkbook(XLSX, matrixWorkbookSheets(DATA));
    const buf = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
    const back = XLSX.read(buf, { type: 'buffer' });
    expect(back.SheetNames).toEqual(['合計', '水費', '電費', '電話費', '網路費']);
    const rows = XLSX.utils.sheet_to_json<any[]>(back.Sheets['合計'], { header: 1 });
    expect(rows[0][0]).toBe('據點');
    expect(rows[0][13]).toBe('全年合計');
    expect(rows[1][0]).toBe('VW001 測試一店');
    expect(rows[1][3]).toBe(1200);
    expect(rows[rows.length - 1]).toEqual(['合計', 0, 0, 1800, 0, 300.5, 0, 0, 0, 0, 0, 0, 50, 2150.5]);
    const water = XLSX.utils.sheet_to_json<any[]>(back.Sheets['水費'], { header: 1 });
    expect(water[water.length - 1][13]).toBe(250);
  });
  it('月／季／年檢視目前這張表：標題、每據點一列、合計列', () => {
    const rows = [
      { store_id: 'a', store_code: 'VW001', location_name: 'VW001 測試一店', WATER: 200, ELECTRICITY: 1000, PHONE: 0, INTERNET: 0, total: 1200, bill_count: 2 },
      { store_id: 'b', store_code: 'ZT01', location_name: 'ZT01 測試二店', WATER: 0, ELECTRICITY: 500, PHONE: 0, INTERNET: 100, total: 600, bill_count: 2 },
    ];
    const totals = { WATER: 200, ELECTRICITY: 1500, PHONE: 0, INTERNET: 100, total: 1800, bill_count: 4 };
    const s = periodSheet(rows, totals, '03月');
    expect(s.name).toBe('03月');
    expect(s.aoa[0]).toEqual(['據點', '水費', '電費', '電話費', '網路費', '合計', '筆數']);
    expect(s.aoa[1]).toEqual(['VW001 測試一店', 200, 1000, 0, 0, 1200, 2]);
    expect(s.aoa[3]).toEqual(['合計', 200, 1500, 0, 100, 1800, 4]);
    expect(periodSheet([], null, 'x').aoa).toHaveLength(1);
  });
  it('檔名含期間', () => {
    expect(reportFileName('matrix', 2038)).toBe('水電話費總表_2038年度逐月.xlsx');
    expect(reportFileName('month', 2038, '2038-03')).toBe('水電話費報表_2038-03月報表.xlsx');
    expect(reportFileName('quarter', 2038, '2')).toBe('水電話費報表_2038年第2季.xlsx');
    expect(reportFileName('year', 2038)).toBe('水電話費報表_2038年報表.xlsx');
  });
});
