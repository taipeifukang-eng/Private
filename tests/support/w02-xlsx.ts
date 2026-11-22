import { createRequire } from 'node:module';
import type { Diff } from './parity';

const nodeRequire = createRequire(__filename);

/**
 * W02：Excel 逐工作表、逐欄、逐格比對（舊版輸出 vs 新版輸出）。
 * 環境沒有 openpyxl／exceljs，改用 SheetJS 以「儲存格層級」讀取：每格的型別（t）、原始值（v）、數字格式（z），
 * 另比對工作表名稱與順序、範圍（!ref）、欄寬（!cols）、合併儲存格（!merges）。不比對 docProps（建立時間每次不同）。
 */

export interface CanonicalCell {
  t: string;
  v: unknown;
  z?: string;
}
export interface CanonicalSheet {
  name: string;
  ref: string;
  rowCount: number;
  columnCount: number;
  headers: string[];
  cells: Record<string, CanonicalCell>;
  colWidths: (number | null)[];
  merges: string[];
}
export interface CanonicalWorkbook {
  sheetNames: string[];
  sheets: CanonicalSheet[];
}

export function canonicalWorkbook(buf: Buffer | Uint8Array): CanonicalWorkbook {
  const XLSX = nodeRequire('xlsx') as typeof import('xlsx');
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, cellNF: true, cellStyles: true });
  const sheets: CanonicalSheet[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const ref = ws['!ref'] || '';
    const range = ref ? XLSX.utils.decode_range(ref) : null;
    const cells: Record<string, CanonicalCell> = {};
    for (const addr of Object.keys(ws)) {
      if (addr.startsWith('!')) continue;
      const cell = ws[addr] as import('xlsx').CellObject;
      cells[addr] = { t: cell.t, v: cell.v, ...(cell.z ? { z: String(cell.z) } : {}) };
    }
    const headers: string[] = [];
    if (range) for (let c = range.s.c; c <= range.e.c; c += 1) headers.push(String(ws[XLSX.utils.encode_cell({ r: range.s.r, c })]?.v ?? ''));
    const colWidths = ((ws['!cols'] || []) as { wch?: number; wpx?: number; width?: number }[]).map((c) => (c ? (c.wch ?? c.width ?? c.wpx ?? null) : null));
    return {
      name,
      ref,
      rowCount: range ? range.e.r - range.s.r + 1 : 0,
      columnCount: range ? range.e.c - range.s.c + 1 : 0,
      headers,
      cells,
      colWidths,
      merges: ((ws['!merges'] || []) as import('xlsx').Range[]).map((m) => XLSX.utils.encode_range(m)),
    };
  });
  return { sheetNames: wb.SheetNames.slice(), sheets };
}

/** 回傳所有差異（空陣列 = 逐格相同）。 */
export function compareCanonical(legacy: CanonicalWorkbook, native: CanonicalWorkbook): Diff[] {
  const diffs: Diff[] = [];
  if (JSON.stringify(legacy.sheetNames) !== JSON.stringify(native.sheetNames)) {
    diffs.push({ kind: 'changed', key: 'workbook#sheetNames', legacy: legacy.sheetNames, native: native.sheetNames, detail: '工作表名稱或順序不同' });
  }
  const names = Array.from(new Set([...legacy.sheetNames, ...native.sheetNames]));
  for (const name of names) {
    const l = legacy.sheets.find((s) => s.name === name);
    const n = native.sheets.find((s) => s.name === name);
    if (!l || !n) {
      diffs.push({ kind: l ? 'only-legacy' : 'only-native', key: `sheet:${name}`, detail: '工作表只存在於其中一邊' });
      continue;
    }
    if (l.ref !== n.ref) diffs.push({ kind: 'changed', key: `sheet:${name}#ref`, legacy: l.ref, native: n.ref, detail: '資料範圍不同' });
    if (l.rowCount !== n.rowCount) diffs.push({ kind: 'count', key: `sheet:${name}#rows`, legacy: l.rowCount, native: n.rowCount, detail: '列數不同' });
    if (JSON.stringify(l.headers) !== JSON.stringify(n.headers)) diffs.push({ kind: 'changed', key: `sheet:${name}#headers`, legacy: l.headers, native: n.headers, detail: '表頭順序或內容不同' });
    if (JSON.stringify(l.colWidths) !== JSON.stringify(n.colWidths)) diffs.push({ kind: 'changed', key: `sheet:${name}#colWidths`, legacy: l.colWidths, native: n.colWidths, detail: '欄寬不同' });
    if (JSON.stringify(l.merges) !== JSON.stringify(n.merges)) diffs.push({ kind: 'changed', key: `sheet:${name}#merges`, legacy: l.merges, native: n.merges, detail: '合併儲存格不同' });
    const addrs = Array.from(new Set([...Object.keys(l.cells), ...Object.keys(n.cells)])).sort();
    for (const addr of addrs) {
      const lc = l.cells[addr];
      const nc = n.cells[addr];
      if (!lc || !nc) {
        diffs.push({ kind: lc ? 'only-legacy' : 'only-native', key: `sheet:${name}#${addr}`, legacy: lc?.v, native: nc?.v, detail: '儲存格只存在於其中一邊' });
      } else if (lc.t !== nc.t || lc.v !== nc.v || (lc.z || '') !== (nc.z || '')) {
        diffs.push({ kind: 'changed', key: `sheet:${name}#${addr}`, legacy: lc, native: nc, detail: '儲存格內容不同' });
      }
    }
  }
  return diffs;
}

export function compareWorkbooks(legacy: Buffer | Uint8Array, native: Buffer | Uint8Array): { diffs: Diff[]; stats: { sheets: number; cells: number; rows: number } } {
  const l = canonicalWorkbook(legacy);
  const n = canonicalWorkbook(native);
  return {
    diffs: compareCanonical(l, n),
    stats: {
      sheets: l.sheets.length,
      cells: l.sheets.reduce((s, x) => s + Object.keys(x.cells).length, 0),
      rows: l.sheets.reduce((s, x) => s + x.rowCount, 0),
    },
  };
}
