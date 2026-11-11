// 總務庫存（M7/M8 第 3 批）G12 共用規則：餘額、流水、過帳、持有狀態。純函式，無相依，單元測試直接引用，Next API 與 Vue 頁面共用同一份。
// 涵蓋：過帳輸入驗證（Q14 不可填未來、固定識別）、單位換算、風險判斷（C6 出庫／調減／會變負才確認）、低庫存標示（C7）、
//      CSV 匯出（C5，含公式注入防護）、日期區間（台北時間）、持有狀態輸入驗證（C4）、C12 內部欄位遮蔽。

export const POST_TYPES = ["RECEIPT", "ISSUE", "ADJUST_IN", "ADJUST_OUT"] as const;
export type PostType = (typeof POST_TYPES)[number];
export const POST_TYPE_LABEL: Record<PostType, string> = { RECEIPT: "入庫", ISSUE: "出庫", ADJUST_IN: "調增", ADJUST_OUT: "調減" };
export const POST_TYPE_HELP: Record<PostType, string> = {
  RECEIPT: "新進貨或調入的料件，增加庫存。",
  ISSUE: "領用或發放給門市、同仁，減少庫存。",
  ADJUST_IN: "盤點發現帳面比實際少，補上差額，增加庫存。",
  ADJUST_OUT: "盤點發現帳面比實際多、或報廢損耗，扣掉差額，減少庫存。",
};
/** 流水的類型標籤（含舊資料可能出現的其他代碼）。 */
export const TRANSACTION_TYPE_LABEL: Record<string, string> = { ...POST_TYPE_LABEL };
export const INCREASING: readonly PostType[] = ["RECEIPT", "ADJUST_IN"];
export const UNIT_TYPES = ["BASE", "PURCHASE"] as const;
export const UNIT_TYPE_LABEL: Record<string, string> = { BASE: "基本單位", PURCHASE: "採購單位" };

export const STOCK_LEVEL_LABEL = { red: "低於安全庫存", yellow: "低於補貨點" } as const;
export const HOLDING_FILTERS = ["IN_USE", "IDLE", "UNCLASSIFIED"] as const;
export const HOLDING_LABEL: Record<string, string> = { IN_USE: "使用中", IDLE: "閒置可調撥", UNCLASSIFIED: "待確認" };
export const BALANCE_SORTS = new Set(["quantity_base", "last_transaction_at", "updated_at", "idle_quantity", "part_name", "location_name"]);
export const TRANSACTION_SORTS = new Set(["occurred_at", "created_at", "transaction_no"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POST_FIELDS = ["transaction_type", "location_id", "part_id", "quantity", "input_unit_type", "reason", "notes", "idempotency_key", "occurred_at"] as const;
export const MAX_QTY = 999_999_999;
/** 發生時間可比現在晚的容許秒數（時鐘誤差），超過就是「未來」（與資料庫函式一致：1 分鐘）。 */
export const FUTURE_TOLERANCE_MS = 60_000;

const text = (v: unknown) => String(v ?? "").trim();
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export type PostPayload = {
  transaction_type: PostType; location_id: string; part_id: string; quantity: number; input_unit_type: "BASE" | "PURCHASE";
  reason: string; notes: string | null; idempotency_key: string; occurred_at: string | null;
};

/** 過帳輸入驗證（伺服端與畫面共用）。只接受白名單欄位；參考單據、系統欄位一律拒絕（不可由使用者指定）。 */
export function validatePostPayload(input: unknown, now: Date = new Date()): PostPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("送出的內容格式錯誤");
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!(POST_FIELDS as readonly string[]).includes(key)) throw new Error(`不支援的欄位：${key}`);
  const type = text(raw.transaction_type).toUpperCase();
  if (!(POST_TYPES as readonly string[]).includes(type)) throw new Error("交易類型錯誤，請選擇入庫、出庫、調增或調減");
  const unit = text(raw.input_unit_type || "BASE").toUpperCase();
  if (!(UNIT_TYPES as readonly string[]).includes(unit)) throw new Error("單位類型錯誤");
  const location = text(raw.location_id);
  if (!UUID.test(location)) throw new Error("請選擇庫存位置");
  const part = text(raw.part_id);
  if (!UUID.test(part)) throw new Error("請選擇料件");
  const quantity = parseQuantity(raw.quantity);
  const reason = text(raw.reason);
  if (!reason) throw new Error("請輸入交易原因");
  if (reason.length > 300) throw new Error("交易原因不可超過 300 字");
  const notes = text(raw.notes) || null;
  if (notes && notes.length > 500) throw new Error("備註不可超過 500 字");
  const key = text(raw.idempotency_key);
  if (!key) throw new Error("缺少防重複識別碼，請重新整理畫面後再送出");
  if (key.length > 120) throw new Error("防重複識別碼不可超過 120 字");
  let occurred: string | null = null;
  if (has(raw, "occurred_at") && raw.occurred_at !== null && text(raw.occurred_at) !== "") {
    const ms = Date.parse(text(raw.occurred_at));
    if (!Number.isFinite(ms)) throw new Error("發生時間格式錯誤");
    if (ms > now.getTime() + FUTURE_TOLERANCE_MS) throw new Error("發生時間不可晚於現在");
    occurred = new Date(ms).toISOString();
  }
  return { transaction_type: type as PostType, location_id: location, part_id: part, quantity, input_unit_type: unit as "BASE" | "PURCHASE", reason, notes, idempotency_key: key, occurred_at: occurred };
}

/** 數量：大於 0、最多 4 位小數、不接受科學記號。 */
export function parseQuantity(v: unknown): number {
  if (typeof v === "string" && /e/i.test(v)) throw new Error("數量格式錯誤");
  if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) throw new Error("請輸入數量");
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) throw new Error("數量必須是有效數字");
  if (n <= 0) throw new Error("數量必須大於 0");
  if (n > MAX_QTY) throw new Error("數量太大");
  if (Math.round(n * 10000) / 10000 !== n) throw new Error("數量最多 4 位小數");
  return n;
}

export type PartUnits = { base_unit?: string | null; purchase_unit?: string | null; purchase_to_base_rate?: number | string | null };

/** 換算成基本單位數量；採購單位沒有有效換算率回 null（不可用）。結果最多 4 位小數，超過也回 null。 */
export function toBaseQuantity(quantity: number, unitType: "BASE" | "PURCHASE", part: PartUnits | null | undefined): number | null {
  if (!Number.isFinite(quantity)) return null;
  if (unitType === "BASE") return quantity;
  const rate = Number(part?.purchase_to_base_rate);
  if (!part?.purchase_unit || !Number.isFinite(rate) || rate <= 0) return null;
  const base = quantity * rate;
  const rounded = Math.round(base * 10000) / 10000;
  return Math.abs(rounded - base) < 1e-9 ? rounded : null;
}

/** 這個料件可選的單位（沒有採購單位或換算率就只有基本單位）。 */
export function unitChoices(part: PartUnits | null | undefined): { value: "BASE" | "PURCHASE"; label: string }[] {
  const out: { value: "BASE" | "PURCHASE"; label: string }[] = [{ value: "BASE", label: `基本單位（${part?.base_unit || "—"}）` }];
  const rate = Number(part?.purchase_to_base_rate);
  if (part?.purchase_unit && Number.isFinite(rate) && rate > 0) out.push({ value: "PURCHASE", label: `採購單位（${part.purchase_unit}，1 = ${rate} ${part.base_unit || ""}）` });
  return out;
}

export type PostPreview = {
  /** 要不要先顯示摘要並要使用者再按一次確認（C6：只有出庫、調減、或會變成負庫存）。 */
  risky: boolean;
  reasons: string[];
  baseQuantity: number | null;
  before: number;
  after: number | null;
  negative: boolean;
  /** 會變成負數、但這個位置不允許負庫存：過帳一定會失敗，畫面直接擋。 */
  blocked: boolean;
};

/** C6：過帳預覽。before = 目前帳面庫存（基本單位）。 */
export function previewPost(c: { type: PostType; quantity: number; unitType: "BASE" | "PURCHASE"; part: PartUnits | null | undefined; before: number; allowNegative: boolean }): PostPreview {
  const base = toBaseQuantity(c.quantity, c.unitType, c.part);
  if (base === null) return { risky: false, reasons: [], baseQuantity: null, before: c.before, after: null, negative: false, blocked: false };
  const after = Math.round((c.before + ((INCREASING as readonly string[]).includes(c.type) ? base : -base)) * 10000) / 10000;
  const negative = after < 0;
  const reasons: string[] = [];
  if (c.type === "ISSUE" || c.type === "ADJUST_OUT") reasons.push("這是減少庫存的交易，過帳後不能直接撤銷（記錯只能再補一筆調整）。");
  if (negative) reasons.push(c.allowNegative ? "過帳後庫存會變成負數。" : "過帳後庫存會變成負數，而這個位置不允許負庫存。");
  return { risky: reasons.length > 0, reasons, baseQuantity: base, before: c.before, after, negative, blocked: negative && !c.allowNegative };
}

/** C7：低庫存標示。低於安全庫存 = red，否則低於補貨點 = yellow（與資料庫 ga_ws_inv_balance_page 同一規則）。 */
export function stockLevel(qty: number | string | null | undefined, safety: number | string | null | undefined, reorder: number | string | null | undefined): "red" | "yellow" | null {
  const q = Number(qty);
  if (!Number.isFinite(q)) return null;
  if (safety !== null && safety !== undefined && safety !== "" && Number.isFinite(Number(safety)) && q < Number(safety)) return "red";
  if (reorder !== null && reorder !== undefined && reorder !== "" && Number.isFinite(Number(reorder)) && q < Number(reorder)) return "yellow";
  return null;
}

// ---------------------------------------------------------------- 篩選參數
/** 台北時間的 YYYY-MM-DD 轉成當天起訖（含）的 ISO 時間。 */
export function taipeiDayRange(date: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("日期格式錯誤（請用 YYYY-MM-DD）");
  const from = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(from.getTime())) throw new Error("日期不存在");
  // 防「2026-02-31」被 JS 進位成 3 月：回推日期要一致
  const back = new Date(from.getTime() + 8 * 3600_000).toISOString().slice(0, 10);
  if (back !== date) throw new Error("日期不存在");
  return { from: from.toISOString(), to: new Date(from.getTime() + 86_400_000 - 1).toISOString() };
}

/** LIKE 關鍵字：跳脫 % _ \，限制長度（用在 .ilike，值不會被當成 PostgREST 語法）。 */
export function likeTerm(term: string): string {
  return `%${term.trim().slice(0, 100).replace(/[\\%_]/g, (c) => "\\" + c)}%`;
}

// ---------------------------------------------------------------- CSV（C5）
export type CsvColumn<T> = { header: string; value: (row: T) => unknown };

/** 試算表會把 = + - @ 開頭的儲存格當公式；前面補單引號擋掉（數字本身不處理）。 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "number" ? String(value) : String(value);
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(c.value(r))).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
export const CSV_MAX_ROWS = 50_000;

const taipeiText = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 8 * 3600_000);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().replace("T", " ").slice(0, 16);
};
export const formatTaipei = taipeiText;

export type BalanceCsvRow = {
  location?: { name?: string; code?: string | null } | null; store?: { store_code?: string; store_name?: string; short_name?: string | null } | null;
  part?: { name?: string; part_code?: string | null; brand?: string | null; model?: string | null; specification?: string | null; base_unit?: string | null } | null;
  quantity_base: number | string; safety_stock_qty?: number | null; reorder_point_qty?: number | null; level?: "red" | "yellow" | null; last_transaction_at?: string | null;
  holding?: { in_use_quantity?: number; idle_quantity?: number; unclassified_quantity?: number } | null;
};
export const BALANCE_CSV_COLUMNS: CsvColumn<BalanceCsvRow>[] = [
  { header: "位置", value: (r) => r.location?.name },
  { header: "位置代碼", value: (r) => r.location?.code },
  { header: "門市", value: (r) => (r.store ? `${r.store.store_code || ""} ${r.store.short_name || r.store.store_name || ""}`.trim() : "") },
  { header: "料件", value: (r) => r.part?.name },
  { header: "料件代碼", value: (r) => r.part?.part_code },
  { header: "品牌", value: (r) => r.part?.brand },
  { header: "型號", value: (r) => r.part?.model },
  { header: "規格", value: (r) => r.part?.specification },
  { header: "庫存（基本單位）", value: (r) => Number(r.quantity_base) },
  { header: "基本單位", value: (r) => r.part?.base_unit },
  { header: "安全庫存", value: (r) => r.safety_stock_qty },
  { header: "補貨點", value: (r) => r.reorder_point_qty },
  { header: "庫存狀態", value: (r) => (r.level ? STOCK_LEVEL_LABEL[r.level] : "") },
  { header: "使用中", value: (r) => r.holding?.in_use_quantity },
  { header: "閒置可調撥", value: (r) => r.holding?.idle_quantity },
  { header: "待確認", value: (r) => r.holding?.unclassified_quantity },
  { header: "最後異動時間", value: (r) => taipeiText(r.last_transaction_at) },
];

export type TransactionCsvRow = {
  transaction_no: string; transaction_type: string; occurred_at: string;
  location?: { name?: string; code?: string | null } | null; part?: { name?: string; part_code?: string | null; base_unit?: string | null } | null;
  quantity_input: number; input_unit_type: string; quantity_base: number; balance_before: number; balance_after: number;
  source_label?: string | null; reason?: string | null; notes?: string | null; creator_name?: string | null;
};
export const TRANSACTION_CSV_COLUMNS: CsvColumn<TransactionCsvRow>[] = [
  { header: "交易單號", value: (r) => r.transaction_no },
  { header: "發生時間", value: (r) => taipeiText(r.occurred_at) },
  { header: "類型", value: (r) => TRANSACTION_TYPE_LABEL[r.transaction_type] || r.transaction_type },
  { header: "位置", value: (r) => r.location?.name },
  { header: "料件", value: (r) => r.part?.name },
  { header: "料件代碼", value: (r) => r.part?.part_code },
  { header: "輸入數量", value: (r) => Number(r.quantity_input) },
  { header: "輸入單位", value: (r) => UNIT_TYPE_LABEL[r.input_unit_type] || r.input_unit_type },
  { header: "異動數量（基本單位）", value: (r) => Number(r.quantity_base) },
  { header: "異動前", value: (r) => Number(r.balance_before) },
  { header: "異動後", value: (r) => Number(r.balance_after) },
  { header: "來源", value: (r) => r.source_label },
  { header: "原因", value: (r) => r.reason },
  { header: "備註", value: (r) => r.notes },
  { header: "記錄人", value: (r) => r.creator_name },
];

// ---------------------------------------------------------------- 流水來源與遮蔽
const returnAction = (a: unknown) => String(a ?? "").toLowerCase().replace(/-/g, "_") === "return_stock";
/** 流水的來源說明：調撥單、「調撥退回來源庫存」（Q12）、其他（手動過帳）。metadata 只在伺服端讀，不回傳給畫面。 */
export function transactionSource(row: { reference_type?: string | null; metadata?: Record<string, unknown> | null }): { label: string; transfer_no: string | null; return_stock: boolean } {
  const meta = (row.metadata || {}) as Record<string, unknown>;
  if (String(row.reference_type || "").toUpperCase() === "INVENTORY_TRANSFER") {
    const no = typeof meta.transfer_no === "string" ? meta.transfer_no : null;
    const back = returnAction(meta.action) || meta.return_stock === true;
    return { label: `${back ? "調撥退回來源庫存" : "調撥"}${no ? ` ${no}` : ""}`, transfer_no: no, return_stock: back };
  }
  if (row.reference_type) return { label: String(row.reference_type), transfer_no: null, return_stock: false };
  return { label: "手動過帳", transfer_no: null, return_stock: false };
}

/** C12：只有「庫存查看／管理權限」的人看得到原因、備註與調整原因；只憑門市名單身分的唯讀者由伺服端遮蔽，改顯示白話標籤。 */
export function maskTransaction<T extends Record<string, any>>(row: T, internal: boolean): T {
  if (internal) return row;
  const { reason: _r, notes: _n, ...rest } = row;
  return { ...rest, reason: null, notes: null } as unknown as T;
}
export function maskHolding<T extends Record<string, any>>(holding: T | null | undefined, internal: boolean) {
  if (!holding || internal) return holding ?? null;
  const { notes: _n, ...rest } = holding;
  return { ...rest, notes: null };
}

// ---------------------------------------------------------------- 持有狀態（C4）
export type HoldingPayload = { in_use_quantity: number; idle_quantity: number; reason: string | null; expected_updated_at: string | null };
export function validateHoldingPayload(input: unknown): HoldingPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("送出的內容格式錯誤");
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (!["in_use_quantity", "idle_quantity", "reason", "expected_updated_at"].includes(key)) throw new Error(`不支援的欄位：${key}`);
  const q = (v: unknown, label: string) => {
    if (typeof v === "string" && /e/i.test(v)) throw new Error(`${label}格式錯誤`);
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) throw new Error(`請輸入${label}`);
    const n = typeof v === "number" ? v : Number(String(v).trim());
    if (!Number.isFinite(n) || n < 0) throw new Error(`${label}必須是 0 以上的數字`);
    if (n > MAX_QTY) throw new Error(`${label}太大`);
    if (Math.round(n * 10000) / 10000 !== n) throw new Error(`${label}最多 4 位小數`);
    return n;
  };
  const reason = text(raw.reason) || null;
  if (reason && reason.length > 500) throw new Error("調整原因不可超過 500 字");
  if (!has(raw, "expected_updated_at")) throw new Error("缺少 expected_updated_at（請重新載入後再操作）");
  let expected: string | null = null;
  if (raw.expected_updated_at !== null) {
    const e = text(raw.expected_updated_at);
    if (!e || Number.isNaN(Date.parse(e))) throw new Error("expected_updated_at 格式錯誤");
    expected = e;
  }
  return { in_use_quantity: q(raw.in_use_quantity, "使用中數量"), idle_quantity: q(raw.idle_quantity, "閒置數量"), reason, expected_updated_at: expected };
}

/** 持有狀態調整前的檢查（畫面用）：合計不可超過持有量。 */
export function holdingProblem(inUse: number, idle: number, held: number): string {
  if (!(inUse >= 0) || !(idle >= 0)) return "使用中與閒置數量必須是 0 以上的數字";
  if (inUse + idle > Math.max(held, 0) + 1e-9) return `使用中（${inUse}）加閒置（${idle}）不可超過目前的實際持有量（${Math.max(held, 0)}）`;
  return "";
}

/** 角色分工：兩個權限缺哪個講清楚（Q13）。 */
export function postPermissionText(c: { canPost: boolean; canPartView: boolean }): string {
  const missing = [!c.canPost ? "庫存交易管理" : "", !c.canPartView ? "料件查看" : ""].filter(Boolean);
  return missing.length ? `過帳需要「庫存交易管理」與「料件查看」兩個權限，您目前缺少：${missing.join("、")}。請聯絡總務管理者。` : "";
}
