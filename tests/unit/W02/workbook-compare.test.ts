import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { compareWorkbooks } from '../../support/w02-xlsx';

function book(sheets: Record<string, unknown[][]>, cols?: { wch: number }[]) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    if (cols) ws['!cols'] = cols;
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

describe('W02 逐工作表、逐欄、逐格比對工具', () => {
  const base = { 單品獎金: [['門市代號', '月份', '員編', '單品獎金總額'], ['ZT04', '2099-05', 'A1', 500], ['ZT05', '2099-05', 'B2', 0]] };

  it('相同內容 → 沒有差異，並回報比對量', () => {
    const r = compareWorkbooks(book(base, [{ wch: 12 }]), book(base, [{ wch: 12 }]));
    expect(r.diffs).toEqual([]);
    expect(r.stats).toEqual({ sheets: 1, cells: 12, rows: 3 });
  });

  it('偵測單格數字差 1 元', () => {
    const changed = { 單品獎金: [base.單品獎金[0], base.單品獎金[1], ['ZT05', '2099-05', 'B2', 1]] };
    const r = compareWorkbooks(book(base), book(changed));
    expect(r.diffs.map((d) => d.key)).toEqual(['sheet:單品獎金#D3']);
    expect(r.diffs[0]).toMatchObject({ kind: 'changed', legacy: { v: 0 }, native: { v: 1 } });
  });

  it('數字與字串即使顯示相同也視為不同（型別）', () => {
    const asText = { 單品獎金: [base.單品獎金[0], base.單品獎金[1], ['ZT05', '2099-05', 'B2', '0']] };
    expect(compareWorkbooks(book(base), book(asText)).diffs.map((d) => d.key)).toEqual(['sheet:單品獎金#D3']);
  });

  it('偵測工作表名稱、列數、表頭順序、欄寬', () => {
    const renamed = compareWorkbooks(book(base), book({ 別的名稱: base.單品獎金 }));
    expect(renamed.diffs.some((d) => d.key === 'workbook#sheetNames')).toBe(true);
    const fewer = compareWorkbooks(book(base), book({ 單品獎金: base.單品獎金.slice(0, 2) }));
    expect(fewer.diffs.some((d) => d.kind === 'count')).toBe(true);
    const reordered = compareWorkbooks(book(base), book({ 單品獎金: base.單品獎金.map((r) => [r[1], r[0], ...r.slice(2)]) }));
    expect(reordered.diffs.some((d) => d.key === 'sheet:單品獎金#headers')).toBe(true);
    const widths = compareWorkbooks(book(base, [{ wch: 12 }]), book(base, [{ wch: 20 }]));
    expect(widths.diffs.map((d) => d.key)).toEqual(['sheet:單品獎金#colWidths']);
  });

  it('偵測只存在於一邊的儲存格', () => {
    const extra = { 單品獎金: base.單品獎金.map((r, i) => (i === 1 ? [...r, 'extra'] : r)) };
    const r = compareWorkbooks(book(base), book(extra));
    expect(r.diffs.some((d) => d.kind === 'only-native' && d.key.endsWith('#E2'))).toBe(true);
  });
});
