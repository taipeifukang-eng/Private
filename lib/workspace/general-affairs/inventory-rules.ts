// 總務庫存（M7/M8 第 3 批）共用規則：純函式，無相依，單元測試直接引用，Next API 與 Vue 頁面共用同一份。
// G11 位置與料件設定：位置與位置料件的輸入驗證與正規化、停用／刪除前的影響說明（C2）、鎖定判斷（C3）、內部欄位遮蔽（C12）。

export const LOCATION_TYPES = ["CENTRAL_WAREHOUSE", "STORE", "OFFICE", "TEMPORARY", "OTHER"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];
export const LOCATION_TYPE_LABEL: Record<LocationType, string> = {
  CENTRAL_WAREHOUSE: "總倉", STORE: "門市", OFFICE: "辦公室", TEMPORARY: "暫存", OTHER: "其他",
};
export const ISSUE_UNIT_TYPES = ["BASE", "PURCHASE"] as const;
export const ISSUE_UNIT_LABEL: Record<string, string> = { BASE: "基本單位", PURCHASE: "採購單位" };
/** 只有這兩種位置可以設為預設位置（每門市一個、全公司一個總倉）。 */
export const DEFAULT_ELIGIBLE_TYPES: readonly LocationType[] = ["CENTRAL_WAREHOUSE", "STORE"];

export const LOCATION_SORT_COLUMNS = new Set(["name", "code", "location_type", "updated_at", "created_at"]);
export const LOCATION_PART_BATCH_MAX = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCATION_FIELDS = ["code", "name", "location_type", "store_id", "description", "is_active", "allow_negative_stock", "is_default"] as const;
const PART_SETTING_FIELDS = ["safety_stock_qty", "reorder_point_qty", "maximum_stock_qty", "preferred_issue_unit_type", "notes", "is_active"] as const;
const MAX_QTY = 999_999_999;

const text = (v: unknown) => String(v ?? "").trim();
const optional = (v: unknown) => text(v) || null;
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

function rejectUnknown(input: Record<string, unknown>, allowed: readonly string[], extra: readonly string[]) {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key) && !extra.includes(key)) throw new Error(`不支援的欄位：${key}`);
  }
}

function bool(v: unknown, label: string): boolean {
  if (typeof v !== "boolean") throw new Error(`${label}必須是「是」或「否」`);
  return v;
}

/**
 * 位置輸入驗證（新增必填類型與名稱；修改只驗有傳的欄位）。
 * 回傳要送資料庫的欄位；代碼轉大寫；非預設資格的位置不可設預設；停用位置自動取消預設。
 * 類型與門市的組合在「新增」時檢查；「修改」只檢查本次有傳的欄位，其餘由資料庫函式用目前資料判斷。
 */
export function validateLocationPayload(input: unknown, options: { partial?: boolean; extraKeys?: readonly string[] } = {}): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("送出的內容格式錯誤");
  const raw = input as Record<string, unknown>;
  rejectUnknown(raw, LOCATION_FIELDS, options.extraKeys || []);
  const out: Record<string, unknown> = {};
  const partial = !!options.partial;
  if (has(raw, "code")) {
    const code = optional(raw.code);
    if (code && code.length > 40) throw new Error("位置代碼不可超過 40 字");
    out.code = code ? code.toUpperCase() : null;
  }
  if (!partial || has(raw, "name")) {
    const name = text(raw.name);
    if (!name) throw new Error("請輸入庫存位置名稱");
    if (name.length > 100) throw new Error("庫存位置名稱不可超過 100 字");
    out.name = name;
  }
  if (!partial || has(raw, "location_type")) {
    const type = text(raw.location_type).toUpperCase();
    if (!LOCATION_TYPES.includes(type as LocationType)) throw new Error("庫存位置類型錯誤");
    out.location_type = type;
  }
  if (has(raw, "store_id")) {
    const store = optional(raw.store_id);
    if (store && !UUID.test(store)) throw new Error("門市格式錯誤");
    out.store_id = store;
  }
  if (has(raw, "description")) {
    const d = optional(raw.description);
    if (d && d.length > 500) throw new Error("描述不可超過 500 字");
    out.description = d;
  }
  if (has(raw, "is_active")) out.is_active = bool(raw.is_active, "啟用狀態");
  if (has(raw, "allow_negative_stock")) out.allow_negative_stock = bool(raw.allow_negative_stock, "允許負庫存");
  if (has(raw, "is_default")) out.is_default = bool(raw.is_default, "預設位置");
  if (!partial) {
    if (!has(out, "is_active")) out.is_active = true;
    if (!has(out, "allow_negative_stock")) out.allow_negative_stock = false;
    if (!has(out, "is_default")) out.is_default = false;
    const type = out.location_type as LocationType;
    if (type === "STORE" && !out.store_id) throw new Error("「門市」類型的位置必須選擇門市");
    if (type !== "STORE" && out.store_id) throw new Error("只有「門市」類型的位置可以選擇門市");
  } else if (has(out, "location_type") && has(out, "store_id")) {
    if (out.location_type === "STORE" && !out.store_id) throw new Error("「門市」類型的位置必須選擇門市");
    if (out.location_type !== "STORE" && out.store_id) throw new Error("只有「門市」類型的位置可以選擇門市");
  }
  if (out.is_default === true) {
    const type = out.location_type as LocationType | undefined;
    if (type && !DEFAULT_ELIGIBLE_TYPES.includes(type)) throw new Error("只有「門市」與「總倉」可以設為預設位置");
    if (out.is_active === false) out.is_default = false;
  }
  if (out.is_active === false) out.is_default = false;
  return out;
}

function qty(v: unknown, label: string): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) throw new Error(`${label}必須是數字`);
  if (n < 0) throw new Error(`${label}不可小於 0`);
  if (n > MAX_QTY) throw new Error(`${label}太大`);
  if (Math.round(n * 10000) / 10000 !== n) throw new Error(`${label}最多 4 位小數`);
  return n;
}

/** 安全庫存 ≤ 補貨點 ≤ 最高庫存（舊版規則）。 */
export function checkStockOrder(s: number | null | undefined, r: number | null | undefined, m: number | null | undefined) {
  if (s != null && r != null && s > r) throw new Error("安全庫存不可大於補貨點");
  if (r != null && m != null && r > m) throw new Error("補貨點不可大於最高庫存");
  if (s != null && m != null && s > m) throw new Error("安全庫存不可大於最高庫存");
}

/** 位置料件設定欄位驗證（修改用，只驗有傳的欄位；料件與位置不可更換）。 */
export function validateLocationPartPayload(input: unknown, options: { extraKeys?: readonly string[]; allowPartId?: boolean } = {}): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("送出的內容格式錯誤");
  const raw = input as Record<string, unknown>;
  const allowed: string[] = [...PART_SETTING_FIELDS];
  if (options.allowPartId) allowed.push("part_id");
  if (!options.allowPartId && (has(raw, "part_id") || has(raw, "location_id"))) throw new Error("不能更換料件或位置；要換請先移除這筆設定，再重新加入");
  rejectUnknown(raw, allowed, options.extraKeys || []);
  const out: Record<string, unknown> = {};
  if (options.allowPartId) {
    const id = text(raw.part_id);
    if (!UUID.test(id)) throw new Error("料件格式錯誤");
    out.part_id = id;
  }
  if (has(raw, "safety_stock_qty")) out.safety_stock_qty = qty(raw.safety_stock_qty, "安全庫存");
  if (has(raw, "reorder_point_qty")) out.reorder_point_qty = qty(raw.reorder_point_qty, "補貨點");
  if (has(raw, "maximum_stock_qty")) out.maximum_stock_qty = qty(raw.maximum_stock_qty, "最高庫存");
  if (has(raw, "preferred_issue_unit_type")) {
    const unit = optional(raw.preferred_issue_unit_type)?.toUpperCase() ?? null;
    if (unit !== null && !(ISSUE_UNIT_TYPES as readonly string[]).includes(unit)) throw new Error("偏好領用單位類型錯誤");
    out.preferred_issue_unit_type = unit;
  }
  if (has(raw, "notes")) {
    const n = optional(raw.notes);
    if (n && n.length > 500) throw new Error("備註不可超過 500 字");
    out.notes = n;
  }
  if (has(raw, "is_active")) out.is_active = bool(raw.is_active, "啟用狀態");
  checkStockOrder(out.safety_stock_qty as number | null | undefined, out.reorder_point_qty as number | null | undefined, out.maximum_stock_qty as number | null | undefined);
  return out;
}

/** 批次新增（C1）：每筆都驗證，同一批不可重複料件，最多 100 筆；錯誤訊息帶「第 N 筆」。 */
export function validateLocationPartItems(input: unknown): Record<string, unknown>[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error("請選擇要加入的料件");
  if (input.length > LOCATION_PART_BATCH_MAX) throw new Error(`一次最多加入 ${LOCATION_PART_BATCH_MAX} 個料件`);
  const seen = new Set<string>();
  return input.map((item, i) => {
    try {
      const out = validateLocationPartPayload(item, { allowPartId: true });
      const id = out.part_id as string;
      if (seen.has(id)) throw new Error("同一批裡重複選了這個料件");
      seen.add(id);
      return out;
    } catch (e) {
      throw new Error(`第 ${i + 1} 筆：${(e as Error).message}`);
    }
  });
}

/** 位置的連帶影響（資料庫 ga_ws_inv_location_impact 的回傳）。 */
export type LocationImpact = { stock_items: number; transactions: number; open_transfers: number; open_transfer_nos: string[]; location_parts: number; has_history: boolean };

/** 停用或刪除前的白話說明（C2）：blocked＝一律不能做；warn＝要使用者確認；info＝連帶筆數。 */
export function impactSummary(impact: LocationImpact, action: "disable" | "delete") {
  const verb = action === "disable" ? "停用" : "刪除";
  const nos = (impact.open_transfer_nos || []).join("、");
  const lines: string[] = [];
  if (impact.stock_items) lines.push(`${impact.stock_items} 項庫存`);
  if (impact.open_transfers) lines.push(`${impact.open_transfers} 張進行中調撥單${nos ? `（${nos}）` : ""}`);
  lines.push(`${impact.location_parts} 筆料件設定`);
  let blocked = "";
  let warn = "";
  if (impact.open_transfers > 0) blocked = `有 ${impact.open_transfers} 張進行中的調撥單使用這個位置${nos ? `（${nos}）` : ""}，請先完成或取消調撥單再${verb}。`;
  else if (action === "delete" && impact.stock_items > 0) blocked = `這個位置還有 ${impact.stock_items} 項庫存，不能刪除；請先出庫或調整庫存為 0，或改用停用。`;
  else if (action === "disable" && impact.stock_items > 0) warn = `這個位置還有 ${impact.stock_items} 項庫存；停用後庫存仍保留，但不能再過帳或調撥。`;
  return { blocked, warn, lines, text: `影響範圍：${lines.join("、")}。` };
}

/** C3：位置已有交易或庫存後，類型、門市、代碼鎖定（資料庫也會擋）。 */
export const LOCATION_LOCK_FIELDS = ["location_type", "store_id", "code"] as const;
export const LOCATION_LOCK_NOTE = "這個位置已有庫存或交易紀錄，位置類型、所屬門市與代碼不能再修改；要換店請新增位置，再用調撥搬移庫存。";
export function lockedFields(hasHistory: boolean): readonly string[] {
  return hasHistory ? LOCATION_LOCK_FIELDS : [];
}

/** 位置料件設定：移除或停用前的阻擋說明（庫存、進行中調撥）。 */
export function settingBlockText(i: { stock_qty?: number; has_stock?: boolean; open_transfers?: number; open_transfer_nos?: string[] }, action: "remove" | "disable") {
  const verb = action === "remove" ? "移除設定" : "停用設定";
  if (i.has_stock) return `這個位置還有此料件的庫存（${i.stock_qty}），不能${verb}；請先出庫或調整庫存為 0。`;
  if ((i.open_transfers || 0) > 0) return `有 ${i.open_transfers} 張進行中的調撥單使用此料件與位置${i.open_transfer_nos?.length ? `（${i.open_transfer_nos.join("、")}）` : ""}，不能${verb}。`;
  return "";
}

/**
 * C12：能看內部欄位（位置描述、位置料件備註）的人＝有位置查看／管理權限的總務；
 * 只憑門市名單身分（店長、督導、區經理）可唯讀看自己門市，但內部欄位由伺服端遮蔽。
 */
export function locationAccess(c: { canView: boolean; canManage: boolean; roster: boolean }) {
  const internal = c.canView || c.canManage;
  return { read: internal || c.roster, manage: c.canManage, internal, readOnly: !c.canManage };
}

export function maskLocation<T extends Record<string, any>>(row: T, internal: boolean): T {
  if (internal) return row;
  const { description: _d, ...rest } = row;
  return rest as T;
}
export function maskSetting<T extends Record<string, any>>(row: T, internal: boolean): T {
  if (internal) return row;
  const { notes: _n, ...rest } = row;
  return rest as T;
}

/** 位置清單／選擇器顯示用名稱：「名稱（代碼）」。 */
export const locationLabel = (l: { name: string; code?: string | null }) => (l.code ? `${l.name}（${l.code}）` : l.name);

/** 偏好領用單位的實際單位名稱。 */
export function resolvedIssueUnit(type: string | null | undefined, part: { base_unit?: string | null; purchase_unit?: string | null } | null | undefined) {
  if (!part) return null;
  if (type === "BASE") return part.base_unit || null;
  if (type === "PURCHASE") return part.purchase_unit || null;
  return null;
}

/** 位置表單是否有未存的變更（離開頁面前警告用）：逐欄比較，忽略前後空白。 */
export function isLocationFormDirty(initial: Record<string, any>, current: Record<string, any>) {
  const keys = ["code", "name", "location_type", "store_id", "description", "is_active", "allow_negative_stock", "is_default"];
  const norm = (v: any) => (typeof v === "string" ? v.trim() : v ?? "");
  return keys.some((k) => norm(initial[k]) !== norm(current[k]));
}
