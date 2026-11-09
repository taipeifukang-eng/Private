// 總務共用規則（純函式，無相依，單元測試直接引用）。

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/**
 * PostgREST `.or()` 的搜尋條件組合。舊版直接把使用者輸入塞進字串，輸入逗號、括號或雙引號就會讓整個查詢壞掉（G01 要修正）。
 * 做法：值一律用雙引號包起來，並把值內的反斜線與雙引號跳脫；LIKE 的 % 與 _ 在值內保留原義（只會讓搜尋範圍稍寬）。
 */
export function orIlike(columns: readonly string[], term: string) {
  const safe = term.trim().slice(0, 100).replace(/[\\"]/g, (c) => "\\" + c);
  if (!safe) return "";
  return columns.map((c) => `${c}.ilike."%${safe}%"`).join(",");
}

export function parsePaging(params: URLSearchParams, defaults = { pageSize: 20, max: 100 }) {
  const page = Math.max(1, Math.floor(Number(params.get("page") || 1)) || 1);
  const pageSize = Math.min(defaults.max, Math.max(1, Math.floor(Number(params.get("pageSize") || defaults.pageSize)) || defaults.pageSize));
  return { page, pageSize, from: (page - 1) * pageSize, to: (page - 1) * pageSize + pageSize - 1 };
}

export function pagingMeta(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** 料件欄位：店長（只有店長身分、沒有料件查看／管理權限）看不到內部備註（Q5）。 */
const PART_COLUMNS_BASE = [
  "id", "category_id", "name", "part_code", "barcode", "brand", "model", "specification", "description",
  "base_unit", "purchase_unit", "purchase_to_base_rate", "minimum_issue_qty", "allow_fractional_issue", "allow_unpacking",
  "image_path", "specs", "tags", "is_active", "created_at", "updated_at",
] as const;
export function partColumns(canSeeNotes: boolean) {
  return (canSeeNotes ? [...PART_COLUMNS_BASE, "notes"] : [...PART_COLUMNS_BASE]).join(",");
}
export function stripNotes<T extends Record<string, unknown>>(row: T, canSeeNotes: boolean): T {
  if (canSeeNotes) return row;
  const { notes: _drop, ...rest } = row as any;
  return rest;
}

export const PART_SORT_COLUMNS = new Set(["name", "part_code", "barcode", "brand", "model", "updated_at", "created_at"]);

/** 單位欄位：有庫存或有過庫存交易後鎖定（Q6）。 */
export const PART_UNIT_FIELDS = ["base_unit", "purchase_unit", "purchase_to_base_rate"] as const;
export function changedUnitFields(current: Record<string, any>, patch: Record<string, any>) {
  const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || (a != null && b != null && Number(a) === Number(b) && !Number.isNaN(Number(a)));
  return PART_UNIT_FIELDS.filter((f) => f in patch && !same(current[f], patch[f]));
}
export const UNIT_LOCK_MESSAGE = "這個料件已有庫存或庫存交易紀錄，基本單位、採購單位與換算率不能再修改；若單位真的要改，請新增另一個料件。";

/** 同品牌＋型號＋規格視為可能重複（與舊版後端偵測相同：三欄都有值才比）。 */
export function duplicateKey(part: { brand?: string | null; model?: string | null; specification?: string | null }) {
  const b = (part.brand || "").trim(), m = (part.model || "").trim(), s = (part.specification || "").trim();
  return b && m && s ? { brand: b, model: m, specification: s } : null;
}

export const FILTERS_BOOL = (v: string | null) => (v === "true" ? true : v === "false" ? false : null);

/** 分類路徑：「父 › 子 › 孫」。找不到父層時就停（資料被刪的保險）。 */
export function categoryPath(id: string, byId: Map<string, { name: string; parent_id: string | null }>) {
  const names: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const row = byId.get(cur);
    if (!row) break;
    names.unshift(row.name);
    cur = row.parent_id;
  }
  return names.join(" › ");
}

/** 把使用情形轉成白話說明（分類停用與刪除的確認框、錯誤提示共用）。 */
export function categoryUsageText(u: { children_total: number; children_active: number; items_total: number; items_active: number }, action: "disable" | "delete") {
  const children = action === "disable" ? u.children_active : u.children_total;
  const items = action === "disable" ? u.items_active : u.items_total;
  if (!children && !items) return action === "disable" ? "底下沒有啟用中的子分類或項目，可以停用。" : "底下沒有任何子分類或項目，可以刪除。";
  const parts: string[] = [];
  if (children) parts.push(`${children} 個${action === "disable" ? "啟用中的" : ""}子分類`);
  if (items) parts.push(`${items} 個${action === "disable" ? "啟用中的" : ""}項目`);
  return `底下還有 ${parts.join("、")}，不能${action === "disable" ? "停用" : "刪除"}。`;
}

export function partDeleteBlockText(u: { stock_locations: number; open_requests: number; open_transfers: number; open_fulfillments: number }) {
  const out: string[] = [];
  if (u.stock_locations) out.push(`在 ${u.stock_locations} 個位置仍有庫存`);
  const open = [u.open_requests && `需求單 ${u.open_requests} 張`, u.open_transfers && `調撥單 ${u.open_transfers} 張`, u.open_fulfillments && `料件處理單 ${u.open_fulfillments} 張`].filter(Boolean);
  if (open.length) out.push(`還有未結單（${open.join("、")}）`);
  return out.length ? `不能刪除：${out.join("，")}。可改用「停用」。` : "";
}

/** 設備歸戶預覽：逐台列出「原值 → 新值」。 */
export const REHOME_FIELDS = [
  ["name", "名稱"],
  ["brand", "品牌"],
  ["model", "型號"],
  ["category_id", "分類"],
] as const;
export function rehomeDiff(equipment: Record<string, any>, template: Record<string, any>) {
  return REHOME_FIELDS.map(([key, label]) => ({
    field: key,
    label,
    from: equipment[key] ?? null,
    to: template[key] ?? null,
    changed: (equipment[key] ?? null) !== (template[key] ?? null),
  }));
}
