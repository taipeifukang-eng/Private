// M6 W27/W28 商品主檔共用規則（純函式，無相依）：Vue 端與 workspace API 共用。
// 規則來源：舊 app/api/products-master/route.ts（欄位別名、搜尋 20 筆、匯入覆蓋更新），新增的行為在 allowlist（m6-w27-*／m6-w28-*）。

/** 欄位別名：沿用舊版（依序取第一個有值的）。 */
export const IMPORT_ALIASES = {
  code: ["商品編號", "product_code", "ProductCode", "編號"],
  name: ["商品名稱", "product_name", "ProductName", "品名", "名稱"],
  unit: ["單位", "unit", "Unit"],
} as const;
export const MAX_IMPORT_ROWS = 5000;
export const IMPORT_BATCH_SIZE = 500;
export const LIST_PAGE_SIZE = 50;
export const SEARCH_LIMIT = 20;
export const SEARCH_CONTAINS_LIMIT = 10;
export const MAX_CODE_LENGTH = 64;
export const MAX_NAME_LENGTH = 200;
export const MAX_UNIT_LENGTH = 20;

export type ImportInput = { row: number; code: string; name: string; unit: string };
export type ExistingProduct = { product_code: string; product_name: string; unit: string; is_active: boolean };
export type SkipReason = "missing_code" | "missing_name" | "duplicate_in_file" | "unchanged" | "too_long";
export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  missing_code: "缺少商品編號",
  missing_name: "缺少商品名稱",
  duplicate_in_file: "檔案內編號重複，只採用最後一列",
  unchanged: "內容與現有商品完全相同，不需更新",
  too_long: "編號、名稱或單位太長",
};
export type PlanRow = { row: number; code: string; name: string; unit: string };
export type ImportPlan = {
  total: number;
  /** 將新增。 */
  inserts: PlanRow[];
  /** 將更新（名稱或單位不同，或停用中要重新啟用）；reactivate 為 true 表示原本停用。 */
  updates: (PlanRow & { reactivate: boolean; previousName: string; previousUnit: string })[];
  skipped: { row: number; code: string; reason: SkipReason; text: string }[];
  counts: { total: number; inserted: number; updated: number; reactivated: number; skipped: number };
};

/** 搜尋字串：去前後空白；LIKE 的 % _ \ 一律跳脫成字面字元（舊版直接組進 .or() 字串，逗號括號會改寫條件）。 */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (c) => "\\" + c);
}
/**
 * PostgREST or() 的「編號或名稱包含」條件。值先以 escapeLike 跳脫，再整個用雙引號包起來（引號內的 " 與 \ 以反斜線跳脫），
 * 所以逗號、括號、冒號、點等會改寫條件語法的字元只是一般文字。
 */
export function orContains(escaped: string): string {
  const quoted = '"%' + escaped.replace(/[\\"]/g, (c) => "\\" + c) + '%"';
  return `product_code.ilike.${quoted},product_name.ilike.${quoted}`;
}
export function cleanSearch(q: unknown): string {
  return typeof q === "string" ? q.trim().slice(0, 100) : "";
}

/** 合併搜尋結果：編號開頭優先，其次名稱或編號包含，最多 20 筆（同編號不重複）。 */
export function mergeSearch<T extends { product_code: string }>(prefix: T[], contains: T[]): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const r of [...prefix, ...contains]) {
    if (out.length >= SEARCH_LIMIT) break;
    if (seen.has(r.product_code)) continue;
    seen.add(r.product_code);
    out.push(r);
  }
  return out;
}

/** 把一列 Excel 物件（標題 -> 值）轉成編號／名稱／單位；規則同舊版 normalize（大小寫容忍、空值略過、去空白）。 */
export function pickAlias(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const k of keys) {
    const val = row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
    if (val !== undefined && val !== null && String(val).trim() !== "") return String(val).trim();
  }
  return "";
}
export function normalizeExcelRow(row: Record<string, unknown>) {
  return {
    code: pickAlias(row, IMPORT_ALIASES.code),
    name: pickAlias(row, IMPORT_ALIASES.name),
    unit: pickAlias(row, IMPORT_ALIASES.unit),
  };
}

/** 伺服端再次清理前端送來的列（不信任前端）：只留字串、去空白。 */
export function sanitizeInputs(raw: unknown): ImportInput[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((r: any, i) => ({
    row: Number.isInteger(r?.row) && r.row > 0 ? r.row : i + 2,
    code: typeof r?.code === "string" ? r.code.trim() : r?.code == null ? "" : String(r.code).trim(),
    name: typeof r?.name === "string" ? r.name.trim() : r?.name == null ? "" : String(r.name).trim(),
    unit: typeof r?.unit === "string" ? r.unit.trim() : r?.unit == null ? "" : String(r.unit).trim(),
  }));
}

/**
 * 匯入計畫（預覽與確認共用）。
 * 先逐列檢查（缺編號、缺名稱、過長）；同編號在檔案內出現多次時只採用最後一列（舊版同批 upsert 會直接出錯）；
 * 之後和現有資料比對：不存在 = 新增；內容不同或停用中 = 更新（停用中者會重新啟用）；內容相同且啟用中 = 略過。
 */
export function planImport(inputs: ImportInput[], existing: Map<string, ExistingProduct>): ImportPlan {
  const skipped: ImportPlan["skipped"] = [];
  const skip = (r: ImportInput, reason: SkipReason) => skipped.push({ row: r.row, code: r.code, reason, text: SKIP_REASON_TEXT[reason] });
  const valid: ImportInput[] = [];
  for (const r of inputs) {
    if (!r.code && !r.name && !r.unit) {
      skip(r, "missing_code");
      continue;
    }
    if (!r.code) skip(r, "missing_code");
    else if (!r.name) skip(r, "missing_name");
    else if (r.code.length > MAX_CODE_LENGTH || r.name.length > MAX_NAME_LENGTH || r.unit.length > MAX_UNIT_LENGTH) skip(r, "too_long");
    else valid.push(r);
  }
  const last = new Map<string, ImportInput>();
  for (const r of valid) last.set(r.code, r);
  for (const r of valid) if (last.get(r.code) !== r) skip(r, "duplicate_in_file");
  const inserts: ImportPlan["inserts"] = [];
  const updates: ImportPlan["updates"] = [];
  for (const r of valid) {
    if (last.get(r.code) !== r) continue;
    const cur = existing.get(r.code);
    if (!cur) inserts.push({ row: r.row, code: r.code, name: r.name, unit: r.unit });
    else if (!cur.is_active || cur.product_name !== r.name || cur.unit !== r.unit)
      updates.push({ row: r.row, code: r.code, name: r.name, unit: r.unit, reactivate: !cur.is_active, previousName: cur.product_name, previousUnit: cur.unit });
    else skip(r, "unchanged");
  }
  skipped.sort((a, b) => a.row - b.row);
  return {
    total: inputs.length,
    inserts,
    updates,
    skipped,
    counts: { total: inputs.length, inserted: inserts.length, updated: updates.length, reactivated: updates.filter((u) => u.reactivate).length, skipped: skipped.length },
  };
}

export function chunk<T>(items: T[], size = IMPORT_BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
