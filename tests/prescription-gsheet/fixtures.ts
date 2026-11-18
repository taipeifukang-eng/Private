import * as XLSX from 'xlsx';

// 用程式產生模擬 Google Sheet 下載的 xlsx：A 欄店別（合併儲存格）、每月一組「標籤／張數／金額」、千分位逗號、加總列。
type Pair = [string | number, string | number];
export type FixtureStore = { alias: string; months: Record<string, { regular: Pair; chronic: Pair; total: Pair }> };

/** monthLabels 例如 ['八月','九月','十月']；每組佔 3 欄（標籤、張數、金額），A 欄店別。 */
export function gsheetBuffer(opts: { monthLabels: string[]; stores: FixtureStore[]; leadingColumn?: boolean; mergeMonth?: boolean; sheetName?: string; extraSheetFirst?: boolean }): Buffer {
  const lead = opts.leadingColumn ? 1 : 0; // 最前面不屬於任何月份的欄
  const width = 1 + lead + opts.monthLabels.length * 3;
  const aoa: (string | number | null)[][] = [];
  const monthRow: (string | null)[] = new Array(width).fill(null);
  const subRow: (string | null)[] = new Array(width).fill(null);
  subRow[0] = '店別';
  if (lead) { monthRow[1] = '備註'; subRow[1] = '類型'; }
  opts.monthLabels.forEach((label, i) => {
    const c = 1 + lead + i * 3;
    monthRow[c] = label;
    subRow[c + 1] = '張數';
    subRow[c + 2] = '金額';
  });
  aoa.push(['處方箋統計表'], monthRow, subRow);
  const merges: XLSX.Range[] = [];
  const headerRows = aoa.length;
  opts.stores.forEach((store, si) => {
    const base = headerRows + si * 3;
    (['一般', '連續', '加總'] as const).forEach((kind, ki) => {
      const row: (string | number | null)[] = new Array(width).fill(null);
      if (ki === 0) row[0] = store.alias;
      opts.monthLabels.forEach((label, i) => {
        const data = store.months[label];
        const c = 1 + lead + i * 3;
        row[c] = kind;
        const key = kind === '一般' ? 'regular' : kind === '連續' ? 'chronic' : 'total';
        if (data) { row[c + 1] = data[key][0]; row[c + 2] = data[key][1]; }
      });
      aoa.push(row);
    });
    merges.push({ s: { r: base, c: 0 }, e: { r: base + 2, c: 0 } });
  });
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  if (opts.mergeMonth !== false) {
    opts.monthLabels.forEach((_, i) => {
      const c = 1 + lead + i * 3;
      merges.push({ s: { r: 1, c }, e: { r: 1, c: c + 2 } });
    });
  }
  sheet['!merges'] = merges;
  const wb = XLSX.utils.book_new();
  if (opts.extraSheetFirst) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['說明'], ['這張不是處方箋']]), '說明');
  XLSX.utils.book_append_sheet(wb, sheet, opts.sheetName || '處方箋');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function legacyBuffer(rows: (string | number)[][]): Buffer {
  const aoa = [['年月', '門市代號', '門市名稱', '一般箋張數', '一般箋點值', '慢箋張數', '慢箋點值'], ...rows];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), '處方箋月報');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export const read = (buf: Buffer) => XLSX.read(buf, { type: 'buffer', cellDates: true });
