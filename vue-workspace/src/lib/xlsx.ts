// 全站共用 Excel 工具（M6 W26 縮小版）：動態載入 xlsx、讀第一個工作表、欄位別名挑選、下載 .xlsx。
// 其他檔案（盤點離線工具、商品主檔匯入、關係會員範本）都接這裡，不再各自 import("xlsx")。
export type SheetRow = Record<string, any>;
export type XlsxModule = typeof import("xlsx");

let loading: Promise<XlsxModule> | null = null;
/** 動態載入 xlsx（只載一次；載入失敗時下次重試）。 */
export function loadXlsx(): Promise<XlsxModule> {
  if (!loading) loading = import("xlsx").catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

export type ReadSheetOptions = {
  /** 從第幾列（0 起算）開始當標題；DPOS 1F 檔第一列是空白合併儲存格，標題在第二列，傳 1。 */
  headerRow?: number;
  /** 空儲存格的預設值；預設 ""。 */
  defval?: any;
};
/** 把工作表轉成列物件（標題 -> 值）。 */
export function sheetToRows(X: any, sheet: any, options: ReadSheetOptions = {}): SheetRow[] {
  if (!sheet) throw new Error("檔案沒有工作表");
  return X.utils.sheet_to_json(sheet, { range: options.headerRow ?? 0, defval: options.defval ?? "" }) as SheetRow[];
}
/** 讀第一個工作表（舊版只讀第一個工作表）。回傳列物件；沒有工作表時丟錯，沒有資料列時回空陣列。 */
export async function readSheet(source: File | ArrayBuffer | Uint8Array, options: ReadSheetOptions = {}): Promise<SheetRow[]> {
  const X = await loadXlsx();
  const buffer = source instanceof File ? await source.arrayBuffer() : source;
  const book = X.read(buffer, { type: "array" });
  return sheetToRows(X, book.Sheets[book.SheetNames[0]], options);
}

/**
 * 依別名挑欄位：aliases 的每個欄位名稱對應一串可接受的標題，依序取第一個有值的（標題大小寫容忍、去前後空白）。
 * 例：pickColumns(row, { code: ["商品編號", "編號"], name: ["品名"] }) -> { code: "A1", name: "感冒糖漿" }；找不到回 ""。
 */
export function pickColumns<K extends string>(row: SheetRow, aliases: Record<K, readonly string[]>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const field of Object.keys(aliases) as K[]) {
    let value = "";
    for (const key of aliases[field]) {
      const v = row[key] ?? row[key.toLowerCase()] ?? row[key.toUpperCase()];
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        value = String(v).trim();
        break;
      }
    }
    out[field] = value;
  }
  return out;
}

export function buildWorkbook(X: any, rows: SheetRow[], sheetName = "Sheet1") {
  const book = X.utils.book_new();
  X.utils.book_append_sheet(book, X.utils.json_to_sheet(rows), sheetName);
  return book;
}
/** 下載 .xlsx（檔名沒有副檔名會自動補）。 */
export async function downloadXlsx(rows: SheetRow[], name: string, sheetName = "Sheet1") {
  const X = await loadXlsx();
  X.writeFile(buildWorkbook(X, rows, sheetName), name.toLowerCase().endsWith(".xlsx") ? name : `${name}.xlsx`);
}
