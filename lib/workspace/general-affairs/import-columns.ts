// Q29 Excel 匯入既有設備與設施：欄位定義、Excel 讀取（伺服端用 xlsx）、中文值轉資料庫值。純函式，不碰資料庫。
// 資料庫規則（分類必填欄位、保固規則、編號唯一…）由 ga_ws_import_assets 在預檢與正式寫入時一起檢查；這裡只做格式與對照。
import * as XLSX from "xlsx";

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const IMPORT_SHEET_NAME = "匯入資料";

export type ImportKind = "EQUIPMENT" | "FACILITY";

export type ImportColumn = { key: string; header: string; required?: boolean; hint: string; text?: boolean };

/** 欄位順序即範本順序；第一列表頭必須與 header 完全相同。 */
export const IMPORT_COLUMNS: ImportColumn[] = [
  { key: "kind", header: "類型", required: true, hint: "設備 或 設施" },
  { key: "store_code", header: "門市代碼", required: true, hint: "例如 ZT01（見「代碼對照」分頁）", text: true },
  { key: "category_code", header: "分類代碼", required: true, hint: "啟用中的設備或設施分類代碼（見「代碼對照」分頁）；設備要自動產生資產編號時，分類須是 4 碼代碼如 IC01", text: true },
  { key: "name", header: "名稱", required: true, hint: "最長 200 字" },
  { key: "brand", header: "品牌", hint: "只有設備用" },
  { key: "model", header: "型號", hint: "只有設備用" },
  { key: "serial_number", header: "序號", hint: "只有設備用", text: true },
  { key: "asset_code", header: "資產編號", hint: "只有設備用；留空且有填購置日期時，系統自動產生", text: true },
  { key: "facility_code", header: "設施代碼", hint: "只有設施用；可留空", text: true },
  { key: "status", header: "狀態", hint: "設備：使用中／暫停使用／備品／退役／報廢；設施：使用中／部分損壞／停用中／整修中／退役；留空視為使用中" },
  { key: "criticality", header: "重要程度", hint: "低／一般／高／關鍵；留空視為一般" },
  { key: "area", header: "區域", hint: "例如 前場營業區" },
  { key: "location_detail", header: "位置說明", hint: "例如 收銀台左側" },
  { key: "installed_at", header: "安裝日期", hint: "YYYY-MM-DD 或 Excel 日期" },
  { key: "purchased_at", header: "購置日期", hint: "YYYY-MM-DD 或 Excel 日期；設備沒填就不自動產生資產編號" },
  { key: "purchase_amount", header: "購置金額", hint: "數字，不可為負" },
  { key: "has_warranty", header: "是否保固", hint: "是 或 否（留空視為否）" },
  { key: "warranty_end_date", header: "保固到期日", hint: "有保固時填 YYYY-MM-DD" },
  { key: "quantity", header: "數量", hint: "只有設施用；與單位要一起填" },
  { key: "unit", header: "單位", hint: "只有設施用；例如 座、組" },
  { key: "notes", header: "備註", hint: "最長 1000 字" },
];

export const EQUIPMENT_STATUS_BY_LABEL: Record<string, string> = { 使用中: "ACTIVE", 暫停使用: "TEMPORARILY_STOPPED", 備品: "SPARE", 退役: "RETIRED", 報廢: "SCRAPPED" };
export const FACILITY_STATUS_BY_LABEL: Record<string, string> = { 使用中: "ACTIVE", 部分損壞: "PARTIALLY_DAMAGED", 停用中: "OUT_OF_SERVICE", 整修中: "UNDER_RENOVATION", 退役: "RETIRED" };
export const CRITICALITY_BY_LABEL: Record<string, string> = { 低: "LOW", 一般: "NORMAL", 高: "HIGH", 關鍵: "CRITICAL" };

const EQUIPMENT_ONLY = ["brand", "model", "serial_number", "asset_code"] as const;
const FACILITY_ONLY = ["facility_code", "quantity", "unit"] as const;
const LABEL_OF = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, c.header])) as Record<string, string>;
const MAX_LEN: Record<string, number> = { name: 200, brand: 100, model: 100, serial_number: 100, asset_code: 60, facility_code: 60, area: 100, location_detail: 200, unit: 20, notes: 1000 };

export type RawRow = { row_no: number; cells: Record<string, string> };
export type DbRow = Record<string, string | number | boolean | null>;
export type MappedRow = { row_no: number; row: DbRow | null; errors: string[]; kind: ImportKind | null; store_code: string; category_code: string; name: string };

export class ImportFileError extends Error {}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

/** Excel 日期（序號或文字）-> YYYY-MM-DD；無法解析回 null。 */
export function importDate(value: unknown, date1904 = false): string | null {
  if (typeof value === "number") {
    const d = XLSX.SSF.parse_date_code(value, { date1904 });
    if (!d) return null;
    return valid(d.y, d.m, d.d);
  }
  const text = cellText(value);
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  return m ? valid(+m[1], +m[2], +m[3]) : null;
}
function valid(y: number, mo: number, day: number): string | null {
  const d = new Date(Date.UTC(y, mo - 1, day));
  if (y < 1900 || y > 2099 || d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== day) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export const MAX_UNZIPPED_BYTES = 30 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 200;

/** 解析前先看壓縮檔目錄：檔案數與解壓後總大小過大（壓縮炸彈）、目錄毀損或使用 ZIP64 都直接拒絕，不交給解析套件。 */
export function assertSafeZip(buffer: Buffer): void {
  const bad = () => new ImportFileError("這個 Excel 檔的內容不合規定（解壓後過大或結構異常），請重新下載範本填寫");
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw bad();
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || offset === 0xffffffff || entries > MAX_ZIP_ENTRIES) throw bad();
  let total = 0;
  for (let n = 0; n < entries; n += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw bad();
    const size = buffer.readUInt32LE(offset + 24);
    if (size === 0xffffffff) throw bad();
    total += size;
    if (total > MAX_UNZIPPED_BYTES) throw bad();
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}

/** 讀 Excel 第一個工作表：第一列為表頭，空白列略過。回傳每列（含 Excel 列號）的原始文字。檔案層級的問題丟 ImportFileError。 */
export function parseImportWorkbook(buffer: Buffer): RawRow[] {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new ImportFileError("檔案不是 Excel（.xlsx）格式，請下載範本後填寫");
  assertSafeZip(buffer);
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(buffer, { type: "buffer", cellDates: false, sheetRows: MAX_IMPORT_ROWS * 2 + 2 });
  } catch {
    throw new ImportFileError("無法讀取這個 Excel 檔，請確認檔案沒有損毀，或重新下載範本");
  }
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new ImportFileError("檔案中沒有工作表");
  const date1904 = !!book.Workbook?.WBProps?.date1904;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: true, raw: true });
  const headers = (matrix[0] || []).map(cellText);
  const required = IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.header);
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length) throw new ImportFileError(`第一列必須是欄位標題，缺少：${missing.join("、")}。請使用下載的範本`);
  const dup = IMPORT_COLUMNS.map((c) => c.header).filter((h) => headers.filter((x) => x === h).length > 1);
  if (dup.length) throw new ImportFileError(`欄位標題重複：${dup.join("、")}`);
  const index = new Map<string, number>();
  for (const c of IMPORT_COLUMNS) {
    const i = headers.indexOf(c.header);
    if (i >= 0) index.set(c.key, i);
  }
  const out: RawRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const cells: Record<string, string> = {};
    let any = false;
    for (const c of IMPORT_COLUMNS) {
      const i = index.get(c.key);
      const raw = i === undefined ? "" : (matrix[r] || [])[i];
      const isDate = c.key === "installed_at" || c.key === "purchased_at" || c.key === "warranty_end_date";
      let text: string;
      if (isDate && typeof raw === "number") text = importDate(raw, date1904) ?? String(raw);
      else text = cellText(raw);
      cells[c.key] = text;
      if (text) any = true;
    }
    if (any) out.push({ row_no: r + 1, cells });
  }
  if (!out.length) throw new ImportFileError("檔案裡沒有任何資料列（第二列起填入設備或設施）");
  if (out.length > MAX_IMPORT_ROWS) throw new ImportFileError(`單次最多匯入 ${MAX_IMPORT_ROWS} 列，這個檔案有 ${out.length} 列，請分成多個檔案`);
  return out;
}

function parseNumber(text: string): number | null {
  const t = text.replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** 單列：中文值轉資料庫值並檢查格式。回傳 errors 為空才會有 row。 */
export function mapImportRow(raw: RawRow): MappedRow {
  const c = raw.cells;
  const errors: string[] = [];
  const err = (field: string, message: string) => errors.push(`「${LABEL_OF[field]}」${message}`);
  const kindText = c.kind.trim();
  const kindUpper = kindText.toUpperCase();
  const kind: ImportKind | null = kindText === "設備" || kindUpper === "EQUIPMENT" ? "EQUIPMENT" : kindText === "設施" || kindUpper === "FACILITY" ? "FACILITY" : null;
  if (!kind) err("kind", kindText ? "只能填「設備」或「設施」" : "必填");
  for (const col of IMPORT_COLUMNS) {
    if (col.required && col.key !== "kind" && !c[col.key]) err(col.key, "必填");
  }
  for (const [k, max] of Object.entries(MAX_LEN)) if (c[k] && c[k].length > max) err(k, `最長 ${max} 字`);
  if (kind === "EQUIPMENT") for (const k of FACILITY_ONLY) if (c[k]) err(k, "只有設施使用，設備請留空");
  if (kind === "FACILITY") for (const k of EQUIPMENT_ONLY) if (c[k]) err(k, "只有設備使用，設施請留空");

  let status = "ACTIVE";
  if (c.status) {
    const map = kind === "FACILITY" ? FACILITY_STATUS_BY_LABEL : EQUIPMENT_STATUS_BY_LABEL;
    const hit = map[c.status] || (Object.values(map).includes(c.status.toUpperCase()) ? c.status.toUpperCase() : "");
    if (!hit) err("status", `「${c.status}」不是${kind === "FACILITY" ? "設施" : "設備"}的狀態（可填：${Object.keys(map).join("、")}）`);
    else status = hit;
  }
  let criticality = "NORMAL";
  if (c.criticality) {
    const hit = CRITICALITY_BY_LABEL[c.criticality] || (Object.values(CRITICALITY_BY_LABEL).includes(c.criticality.toUpperCase()) ? c.criticality.toUpperCase() : "");
    if (!hit) err("criticality", `「${c.criticality}」不是有效的重要程度（可填：低、一般、高、關鍵）`);
    else criticality = hit;
  }
  const dates: Record<string, string> = {};
  for (const k of ["installed_at", "purchased_at", "warranty_end_date"] as const) {
    if (!c[k]) continue;
    const d = importDate(c[k]);
    if (!d) err(k, `「${c[k]}」不是有效日期（請用 YYYY-MM-DD）`);
    else dates[k] = d;
  }
  let amount: number | null = null;
  if (c.purchase_amount) {
    amount = parseNumber(c.purchase_amount);
    if (amount === null || amount < 0) err("purchase_amount", `「${c.purchase_amount}」不是有效的金額（要是不小於 0 的數字）`);
  }
  let quantity: number | null = null;
  if (c.quantity) {
    quantity = parseNumber(c.quantity);
    if (quantity === null || quantity <= 0) err("quantity", `「${c.quantity}」不是有效的數量（要大於 0）`);
  }
  if (kind === "FACILITY" && (c.quantity ? !c.unit : !!c.unit)) err(c.quantity ? "unit" : "quantity", "數量與單位要一起填");
  let warranty = false;
  if (c.has_warranty) {
    if (["是", "有", "Y", "YES", "TRUE", "1"].includes(c.has_warranty.toUpperCase())) warranty = true;
    else if (!["否", "無", "N", "NO", "FALSE", "0"].includes(c.has_warranty.toUpperCase())) err("has_warranty", `「${c.has_warranty}」只能填「是」或「否」`);
  }
  if (!warranty && dates.warranty_end_date) err("warranty_end_date", "有填保固到期日時，「是否保固」要填「是」");

  const base = { row_no: raw.row_no, kind, store_code: c.store_code, category_code: c.category_code, name: c.name };
  if (errors.length) return { ...base, row: null, errors };
  const row: DbRow = {
    row_no: raw.row_no, kind: kind!, store_code: c.store_code, category_code: c.category_code, name: c.name,
    brand: c.brand || null, model: c.model || null, serial_number: c.serial_number || null, asset_code: c.asset_code || null, facility_code: c.facility_code || null,
    status, criticality, area: c.area || null, location_detail: c.location_detail || null,
    installed_at: dates.installed_at || null, purchased_at: dates.purchased_at || null, purchase_amount: amount,
    has_warranty: warranty, warranty_end_date: warranty ? dates.warranty_end_date || null : null,
    quantity, unit: c.unit || null, notes: c.notes || null,
  };
  return { ...base, row, errors: [] };
}

export function mapImportRows(rows: RawRow[]): MappedRow[] {
  return rows.map(mapImportRow);
}
