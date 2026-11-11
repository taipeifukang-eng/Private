// 總務庫存調撥（M7/M8 第 3 批 G13）共用規則：純函式，無相依，單元測試直接引用，Next API 與 Vue 頁面共用同一份。
// 涵蓋：狀態與標籤、建單與動作輸入驗證（固定識別、expected_updated_at）、abilities（按鈕與 API 預檢共用，缺哪個權限講清楚 Q13）、
//      逾期判斷（C11）、預填參數解析與單位換算（「未能帶入」）、C12 內部欄位遮蔽、下一步提示。

export const TRANSFER_STATUSES = ["REQUESTED", "SOURCE_CONFIRMED", "IN_TRANSIT", "RECEIVED", "CANCELED"] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
export const STATUS_LABEL: Record<string, string> = {
  REQUESTED: "待來源確認交出", SOURCE_CONFIRMED: "來源已交出", IN_TRANSIT: "運送中 / 待收貨", RECEIVED: "已收貨", CANCELED: "已取消",
};
/** 還沒走完的狀態（G11 位置守衛也以這三個狀態判斷）。 */
export const OPEN_STATUSES: readonly string[] = ["REQUESTED", "SOURCE_CONFIRMED", "IN_TRANSIT"];
/** 已交出、等待目的位置收貨（逾期與「未收」註記只看這兩個狀態）。 */
export const AWAITING_RECEIPT: readonly string[] = ["SOURCE_CONFIRMED", "IN_TRANSIT"];

export const SHIPPING_METHODS = ["總務配送", "門市人員帶回", "物流寄送", "廠商直送"] as const;
/** 取消時的結構化異常類型（C9：「未收」不在這裡，它只是註記）。 */
export const EXCEPTION_TYPES = ["SHORT_RECEIVED", "DAMAGED", "WRONG_ITEM", "LOST", "OTHER"] as const;
export const EXCEPTION_LABEL: Record<string, string> = { SHORT_RECEIVED: "少收", DAMAGED: "損壞", WRONG_ITEM: "品項錯誤", LOST: "遺失", OTHER: "其他" };
/** 店長回報的問題類型（C10）。 */
export const REPORT_TYPES = ["NOT_ARRIVED", "DAMAGED", "WRONG_ITEM", "SHORT_QUANTITY", "OTHER"] as const;
export const REPORT_LABEL: Record<string, string> = { NOT_ARRIVED: "還沒收到", DAMAGED: "到貨損壞", WRONG_ITEM: "品項錯誤", SHORT_QUANTITY: "數量不足", OTHER: "其他" };

export const ACTIONS = ["confirm_source", "ship", "receive", "cancel", "mark_unreceived", "store_report"] as const;
export type TransferAction = (typeof ACTIONS)[number];
export const ACTION_LABEL: Record<string, string> = {
  create: "建立調撥單", confirm_source: "確認交出", ship: "標記運送中", receive: "確認收貨", cancel: "取消調撥", mark_unreceived: "註記未收", store_report: "門市回報問題",
};
export const DEFAULT_OVERDUE_DAYS = 3;
export const EVENT_PAGE_MAX = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (v: unknown) => String(v ?? "").trim();
const hasKey = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function qty(v: unknown): number {
  const s = text(v);
  if (!s || !/^\d+(\.\d{1,4})?$/.test(s.replace(/,/g, ""))) throw new Error("數量必須是大於 0 的數字，最多 4 位小數");
  const n = Number(s.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) throw new Error("數量必須大於 0");
  if (n > 999_999_999) throw new Error("數量過大");
  return n;
}

// ---------------------------------------------------------------- 建單（一張單一個料件，Q13）
export type CreatePayload = {
  source_location_id: string; destination_location_id: string; part_id: string; quantity: number; input_unit_type: "BASE" | "PURCHASE";
  reason: string; notes: string | null; shipping_method: string | null; request_id: string | null; idempotency_key: string;
};
const CREATE_FIELDS = ["source_location_id", "destination_location_id", "part_id", "quantity", "input_unit_type", "reason", "notes", "shipping_method", "request_id", "idempotency_key"] as const;

export function validateCreatePayload(input: unknown): CreatePayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("送出的內容格式錯誤");
  const raw = input as Record<string, unknown>;
  for (const k of Object.keys(raw)) if (!(CREATE_FIELDS as readonly string[]).includes(k)) throw new Error(`不支援的欄位：${k}`);
  const source = text(raw.source_location_id);
  const dest = text(raw.destination_location_id);
  if (!UUID.test(source)) throw new Error("請選擇來源位置");
  if (!UUID.test(dest)) throw new Error("請選擇目的位置");
  if (source === dest) throw new Error("來源位置與目的位置不可相同");
  const part = text(raw.part_id);
  if (!UUID.test(part)) throw new Error("請選擇料件");
  const unit = text(raw.input_unit_type || "BASE").toUpperCase();
  if (unit !== "BASE" && unit !== "PURCHASE") throw new Error("單位類型錯誤");
  const quantity = qty(raw.quantity);
  const reason = text(raw.reason);
  if (!reason) throw new Error("請輸入調撥原因");
  if (reason.length > 200) throw new Error("調撥原因不可超過 200 字");
  const notes = text(raw.notes) || null;
  if (notes && notes.length > 500) throw new Error("備註不可超過 500 字");
  const ship = text(raw.shipping_method) || null;
  if (ship && !(SHIPPING_METHODS as readonly string[]).includes(ship)) throw new Error("運送方式錯誤");
  const requestId = text(raw.request_id) || null;
  if (requestId && !UUID.test(requestId)) throw new Error("來源需求單格式錯誤");
  const key = text(raw.idempotency_key);
  if (!key) throw new Error("缺少防重複識別碼，請重新整理畫面後再送出");
  if (key.length > 60) throw new Error("防重複識別碼過長");
  return { source_location_id: source, destination_location_id: dest, part_id: part, quantity, input_unit_type: unit as "BASE" | "PURCHASE", reason, notes, shipping_method: ship, request_id: requestId, idempotency_key: key };
}

// ---------------------------------------------------------------- 動作
export type ActionPayload = {
  action: TransferAction; expected_updated_at: string; idempotency_key: string; note: string | null; shipping_method: string | null;
  return_stock: boolean; exception_type: string | null; report_type: string | null;
};
const ACTION_FIELDS = ["action", "expected_updated_at", "idempotency_key", "note", "shipping_method", "return_stock", "exception_type", "report_type"] as const;

export function validateActionPayload(input: unknown): ActionPayload {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("送出的內容格式錯誤");
  const raw = input as Record<string, unknown>;
  for (const k of Object.keys(raw)) if (!(ACTION_FIELDS as readonly string[]).includes(k)) throw new Error(`不支援的欄位：${k}`);
  const action = text(raw.action).toLowerCase();
  if (!(ACTIONS as readonly string[]).includes(action)) throw new Error("調撥動作錯誤");
  const expected = text(raw.expected_updated_at);
  if (!expected) throw new Error("缺少版本資訊（expected_updated_at），請重新載入畫面");
  if (Number.isNaN(Date.parse(expected))) throw new Error("版本資訊格式錯誤，請重新載入畫面");
  const key = text(raw.idempotency_key);
  if (!key) throw new Error("缺少防重複識別碼，請重新整理畫面後再送出");
  if (key.length > 60) throw new Error("防重複識別碼過長");
  const note = text(raw.note) || null;
  if (note && note.length > 500) throw new Error("備註不可超過 500 字");
  const ship = text(raw.shipping_method) || null;
  if (ship && !(SHIPPING_METHODS as readonly string[]).includes(ship)) throw new Error("運送方式錯誤");
  if (hasKey(raw, "return_stock") && typeof raw.return_stock !== "boolean") throw new Error("「退回來源庫存」格式錯誤");
  const returnStock = raw.return_stock === true;
  const exception = text(raw.exception_type).toUpperCase() || null;
  if (exception && !(EXCEPTION_TYPES as readonly string[]).includes(exception)) throw new Error("異常類型錯誤");
  const report = text(raw.report_type).toUpperCase() || null;
  if (report && !(REPORT_TYPES as readonly string[]).includes(report)) throw new Error("問題類型錯誤");
  if (action !== "cancel" && (returnStock || exception)) throw new Error("「退回來源庫存」與異常類型只能用在取消");
  if (action === "cancel" && !exception && !note) throw new Error("取消調撥必須填寫原因");
  if (action === "cancel" && exception === "OTHER" && !note) throw new Error("異常類型選「其他」時必須填寫說明");
  if (action === "store_report") {
    if (!report) throw new Error("請選擇問題類型");
    if (report === "OTHER" && !note) throw new Error("問題類型選「其他」時必須填寫說明");
  } else if (report) throw new Error("問題類型只能用在門市回報");
  return { action: action as TransferAction, expected_updated_at: expected, idempotency_key: key, note, shipping_method: ship, return_stock: returnStock, exception_type: exception, report_type: report };
}

// ---------------------------------------------------------------- abilities（Q13）：每張單「我能做什麼」
export type Who = { transferManage: boolean; transactionManage: boolean; partView: boolean; destinationStoreManager: boolean };
/** 調撥操作需要的三個權限：缺哪個講清楚。 */
export function missingPermissions(w: Pick<Who, "transferManage" | "transactionManage" | "partView">): string[] {
  const out: string[] = [];
  if (!w.transferManage) out.push("調撥管理");
  if (!w.transactionManage) out.push("庫存交易管理");
  if (!w.partView) out.push("料件查看");
  return out;
}
export function permissionProblem(w: Pick<Who, "transferManage" | "transactionManage" | "partView">): string {
  const m = missingPermissions(w);
  return m.length ? `調撥需要「調撥管理」、「庫存交易管理」與「料件查看」三個權限，您缺少：${m.join("、")}` : "";
}

export type Abilities = Record<"confirm_source" | "ship" | "receive" | "cancel" | "mark_unreceived" | "store_report", boolean> & { problem: string; returnStockAvailable: boolean };
export function transferAbilities(who: Who, t: { status: string; items?: { source_transaction_id?: string | null; receipt_transaction_id?: string | null }[] }): Abilities {
  const problem = permissionProblem(who);
  const ok = problem === "";
  const s = t.status;
  const issued = (t.items || []).some((i) => i.source_transaction_id && !i.receipt_transaction_id);
  return {
    confirm_source: ok && s === "REQUESTED",
    ship: ok && s === "SOURCE_CONFIRMED",
    receive: ok && AWAITING_RECEIPT.includes(s),
    cancel: ok && OPEN_STATUSES.includes(s),
    mark_unreceived: ok && AWAITING_RECEIPT.includes(s),
    store_report: who.destinationStoreManager && (AWAITING_RECEIPT.includes(s) || s === "RECEIVED"),
    problem,
    returnStockAvailable: issued && OPEN_STATUSES.includes(s),
  };
}

// ---------------------------------------------------------------- 逾期（C11）
/** 已交出、超過 N 天還沒收貨 → 逾期。以「交出時間」起算，剛好 N 天整不算逾期（超過才算）。 */
export function isOverdue(t: { status: string; source_confirmed_at?: string | null }, overdueDays: number, now: Date = new Date()): boolean {
  if (!AWAITING_RECEIPT.includes(t.status) || !t.source_confirmed_at) return false;
  const at = Date.parse(t.source_confirmed_at);
  if (Number.isNaN(at)) return false;
  return now.getTime() - at > overdueDays * 86_400_000;
}
/** 逾期的分界時間：交出時間早於這個時間的就是逾期（API 篩選與統計用）。 */
export function overdueCutoff(overdueDays: number, now: Date = new Date()): string {
  return new Date(now.getTime() - overdueDays * 86_400_000).toISOString();
}
export function overdueDaysCount(t: { source_confirmed_at?: string | null }, now: Date = new Date()): number {
  const at = Date.parse(t.source_confirmed_at || "");
  return Number.isNaN(at) ? 0 : Math.max(0, Math.floor((now.getTime() - at) / 86_400_000));
}
export function validateOverdueDays(v: unknown): number {
  const n = Number(text(v));
  if (!Number.isInteger(n) || n < 1 || n > 90) throw new Error("逾期天數必須是 1 到 90 的整數");
  return n;
}

// ---------------------------------------------------------------- 預填（網址參數）
export const PREFILL_KEYS = ["fromRequestId", "requestNo", "partId", "quantity", "sourceLocationId", "destinationStoreId", "reason", "notes"] as const;
export type Prefill = Partial<Record<(typeof PREFILL_KEYS)[number], string>>;
/** 只取白名單鍵、轉成修剪過的字串；其餘鍵忽略。 */
export function parsePrefill(input: Record<string, unknown> | URLSearchParams | null | undefined): Prefill {
  const out: Prefill = {};
  if (!input) return out;
  const get = (k: string) => (input instanceof URLSearchParams ? input.get(k) : (input as Record<string, unknown>)[k]);
  for (const k of PREFILL_KEYS) {
    const v = get(k);
    const s = Array.isArray(v) ? text(v[0]) : text(v);
    if (s) out[k] = s.slice(0, 500);
  }
  return out;
}
export type Unresolved = { field: string; label: string; reason: string };

/** 需求單的單位（desired_unit）對照料件單位，決定建單用基本單位或採購單位；對不上時用基本單位並提醒。 */
export function resolvePrefillUnit(desiredUnit: string | null | undefined, part: { base_unit?: string | null; purchase_unit?: string | null; purchase_to_base_rate?: number | string | null }): { unit: "BASE" | "PURCHASE"; note: string | null } {
  const u = text(desiredUnit);
  const base = text(part.base_unit);
  const purchase = text(part.purchase_unit);
  const rate = Number(part.purchase_to_base_rate);
  if (!u || u === base) return { unit: "BASE", note: null };
  if (u === purchase && rate > 0) return { unit: "PURCHASE", note: null };
  return { unit: "BASE", note: `需求單的單位「${u}」和料件的單位（${base}${purchase ? "、" + purchase : ""}）對不上，已用基本單位帶入，請確認數量` };
}
/** 換算成需求單單位的數量（與資料庫的剩餘需求量比較一致）。 */
export function toRequestUnit(quantity: number, inputUnit: "BASE" | "PURCHASE", desiredUnit: string | null | undefined, part: { base_unit?: string | null; purchase_unit?: string | null; purchase_to_base_rate?: number | string | null }): number {
  const rate = Number(part.purchase_to_base_rate);
  const u = text(desiredUnit);
  if (!u || !(rate > 0)) return quantity;
  if (u === text(part.purchase_unit) && u !== text(part.base_unit) && inputUnit === "BASE") return quantity / rate;
  if (u === text(part.base_unit) && u !== text(part.purchase_unit) && inputUnit === "PURCHASE") return quantity * rate;
  return quantity;
}

// ---------------------------------------------------------------- 遮蔽（C12）與顯示
/** 唯讀名單身分（店長、督導、區經理）看不到內部備註、未收註記，時間軸只留動作與時間（店長自己的回報除外）。 */
export function maskTransfer<T extends Record<string, any>>(row: T, internal: boolean): T {
  if (internal) return row;
  // 取消原因是總務填的內部備註（與時間軸的遮蔽一致）：唯讀身分只留異常類型的標籤（「調撥異常：少收」），「｜」後的備註一律不給。
  const cancel = typeof row.cancel_reason === "string" && row.exception_type ? row.cancel_reason.split("｜")[0] : null;
  const out: Record<string, any> = { ...row, notes: null, unreceived_note: null, cancel_reason: cancel };
  if (Array.isArray(row.items)) out.items = row.items.map((i: any) => ({ ...i, notes: null }));
  return out as T;
}
export function maskEvent<T extends { action?: string; note?: string | null }>(e: T, internal: boolean): T {
  if (internal || e.action === "store_report") return e;
  return { ...e, note: null };
}
export const transferNextStep = (status: string): string => ({
  REQUESTED: "下一步：確認來源位置已交出料件，系統會扣來源庫存。",
  SOURCE_CONFIRMED: "下一步：標記運送中，或目的位置收到後直接確認收貨。",
  IN_TRANSIT: "下一步：目的位置收到料件後確認收貨，系統才會增加目的庫存。",
  RECEIVED: "已完成，目的位置庫存已增加。",
  CANCELED: "已取消。",
} as Record<string, string>)[status] || "";
export const reportSummary = (type?: string | null, note?: string | null) => (type ? `${REPORT_LABEL[type] || type}${note ? `：${note}` : ""}` : "");
export const transferSearchable = (internal: boolean): string[] => (internal ? ["transfer_no", "reason", "notes"] : ["transfer_no", "reason"]);
