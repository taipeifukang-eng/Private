// 水電話費總表：年度逐月矩陣與 Excel 工作表內容的純函式（伺服端參數檢查與頁面共用；不依賴 xlsx，工作表以二維陣列表示）。
// 注意：根目錄 tsconfig 的 target 較低，這裡不對 Set/Map 用展開或 for-of。
import { EXPENSE_TYPES, EXPENSE_TYPE_LABELS, type ExpenseType } from "./utility-bill-rules";

export type MatrixCell = { WATER: number; ELECTRICITY: number; PHONE: number; INTERNET: number; total: number; bill_count: number };
export type MatrixRow = { store_id: string | null; store_code: string | null; location_name: string; months: MatrixCell[] };
export type MatrixData = { year: number; rows: MatrixRow[]; month_totals: MatrixCell[] };
export type MatrixKind = "ALL" | ExpenseType;
export const MATRIX_KINDS: MatrixKind[] = ["ALL", ...EXPENSE_TYPES];
export const MATRIX_KIND_LABELS: Record<MatrixKind, string> = { ALL: "全部", ...EXPENSE_TYPE_LABELS };
/** 工作表（分頁）名稱：全部費用類型叫「合計」，其他沿用費用類型名稱。 */
export const MATRIX_SHEET_NAMES: Record<MatrixKind, string> = { ALL: "合計", WATER: EXPENSE_TYPE_LABELS.WATER, ELECTRICITY: EXPENSE_TYPE_LABELS.ELECTRICITY, PHONE: EXPENSE_TYPE_LABELS.PHONE, INTERNET: EXPENSE_TYPE_LABELS.INTERNET };

export type SheetCell = string | number;
export type SheetSpec = { name: string; aoa: SheetCell[][] };

export function parseMatrixYear(params: URLSearchParams): number {
  const year = Number(params.get("year"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("請選擇正確年度");
  return year;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const emptyCell = (): MatrixCell => ({ WATER: 0, ELECTRICITY: 0, PHONE: 0, INTERNET: 0, total: 0, bill_count: 0 });
const cellOf = (months: MatrixCell[] | undefined, i: number): MatrixCell => (months && months[i]) || emptyCell();

/** 取某格要顯示的金額：全部＝合計，其餘依費用類型。 */
export function matrixValue(cell: MatrixCell | undefined, kind: MatrixKind): number {
  const c = cell || emptyCell();
  return round2(kind === "ALL" ? c.total : c[kind]);
}

export type MatrixTableRow = { key: string; store_id: string | null; label: string; months: number[]; sum: number };
export type MatrixTable = { rows: MatrixTableRow[]; monthTotals: number[]; grandTotal: number };

/** 年度逐月表：每家據點一列、1～12 月金額與全年合計；最後的合計列由各月合計（與逐列相加相同口徑）算出。 */
export function matrixTable(data: MatrixData, kind: MatrixKind): MatrixTable {
  const rows: MatrixTableRow[] = [];
  const monthTotals: number[] = [];
  let i: number;
  for (i = 0; i < 12; i += 1) monthTotals.push(0);
  let grand = 0;
  for (let r = 0; r < data.rows.length; r += 1) {
    const src = data.rows[r];
    const months: number[] = [];
    let sum = 0;
    for (i = 0; i < 12; i += 1) {
      const v = matrixValue(cellOf(src.months, i), kind);
      months.push(v);
      sum += v;
      monthTotals[i] += v;
    }
    sum = round2(sum);
    grand += sum;
    rows.push({ key: (src.store_id || "") + "|" + src.location_name, store_id: src.store_id, label: src.location_name, months, sum });
  }
  for (i = 0; i < 12; i += 1) monthTotals[i] = round2(monthTotals[i]);
  return { rows, monthTotals, grandTotal: round2(grand) };
}

const MONTH_HEAD: string[] = (() => {
  const out: string[] = [];
  for (let m = 1; m <= 12; m += 1) out.push(`${m}月`);
  return out;
})();

/** 年度逐月的工作表內容：第 1 列標題（據點、1月…12月、全年合計），其後每據點一列，最後一列「合計」。 */
export function matrixSheet(data: MatrixData, kind: MatrixKind): SheetSpec {
  const t = matrixTable(data, kind);
  const aoa: SheetCell[][] = [["據點"].concat(MONTH_HEAD, ["全年合計"]) as SheetCell[]];
  for (let r = 0; r < t.rows.length; r += 1) aoa.push(([t.rows[r].label] as SheetCell[]).concat(t.rows[r].months, [t.rows[r].sum]));
  aoa.push((["合計"] as SheetCell[]).concat(t.monthTotals, [t.grandTotal]));
  return { name: MATRIX_SHEET_NAMES[kind], aoa };
}

/** 年度逐月 Excel：合計頁＋水、電、電話、網路各一頁。 */
export function matrixWorkbookSheets(data: MatrixData): SheetSpec[] {
  const out: SheetSpec[] = [];
  for (let k = 0; k < MATRIX_KINDS.length; k += 1) out.push(matrixSheet(data, MATRIX_KINDS[k]));
  return out;
}

export type PeriodRow = { store_id: string | null; store_code: string | null; location_name: string; WATER: number; ELECTRICITY: number; PHONE: number; INTERNET: number; total: number; bill_count: number };
export type PeriodTotals = { WATER: number; ELECTRICITY: number; PHONE: number; INTERNET: number; total: number; bill_count: number };

/** 月／季／年檢視目前這張表（每據點一列、橫向各費用類型）的工作表內容。 */
export function periodSheet(rows: PeriodRow[], totals: PeriodTotals | null, name: string): SheetSpec {
  const aoa: SheetCell[][] = [["據點", EXPENSE_TYPE_LABELS.WATER, EXPENSE_TYPE_LABELS.ELECTRICITY, EXPENSE_TYPE_LABELS.PHONE, EXPENSE_TYPE_LABELS.INTERNET, "合計", "筆數"]];
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    aoa.push([r.location_name, round2(r.WATER), round2(r.ELECTRICITY), round2(r.PHONE), round2(r.INTERNET), round2(r.total), Number(r.bill_count) || 0]);
  }
  if (totals) aoa.push(["合計", round2(totals.WATER), round2(totals.ELECTRICITY), round2(totals.PHONE), round2(totals.INTERNET), round2(totals.total), Number(totals.bill_count) || 0]);
  return { name, aoa };
}

/** 檔名（含期間）。period：月 "2038-03"、季 "1"、年度逐月與年報表不帶。 */
export function reportFileName(kind: "matrix" | "month" | "quarter" | "year", year: number, period?: string | null): string {
  if (kind === "matrix") return `水電話費總表_${year}年度逐月.xlsx`;
  if (kind === "month") return `水電話費報表_${period || year}月報表.xlsx`;
  if (kind === "quarter") return `水電話費報表_${year}年第${period || ""}季.xlsx`;
  return `水電話費報表_${year}年報表.xlsx`;
}
