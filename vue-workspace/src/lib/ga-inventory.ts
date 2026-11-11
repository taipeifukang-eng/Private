// G11 庫存位置與料件設定：頁面用的型別與小工具（規則本身在 lib/workspace/general-affairs/inventory-rules.ts，伺服端與頁面共用）。
import { DEFAULT_ELIGIBLE_TYPES, LOCATION_TYPES, type LocationType } from "../../../lib/workspace/general-affairs/inventory-rules";

export type LocationRow = {
  id: string; code: string | null; name: string; location_type: LocationType; store_id: string | null; description?: string | null;
  is_active: boolean; allow_negative_stock: boolean; is_default: boolean; created_at: string; updated_at: string;
  store: { id: string; store_code: string; store_name: string; short_name: string | null } | null;
  parts_count: number; stock_items: number | null; open_transfers: number | null; has_history: boolean | null;
};
export type PartInfo = {
  id: string; name: string; part_code: string | null; barcode: string | null; brand: string | null; model: string | null; specification: string | null;
  base_unit: string; purchase_unit: string | null; purchase_to_base_rate: number | null; is_active: boolean;
  category_id?: string | null; category?: { id: string; name: string; code: string | null } | null;
};
export type SettingRow = {
  id: string; location_id: string; part_id: string; is_active: boolean; safety_stock_qty: number | null; reorder_point_qty: number | null; maximum_stock_qty: number | null;
  preferred_issue_unit_type: "BASE" | "PURCHASE" | null; notes?: string | null; created_at: string; updated_at: string;
  part: PartInfo | null; resolvedPreferredIssueUnit: string | null; stock_qty?: number;
};
export type LocForm = {
  code: string; name: string; location_type: string; store_id: string; description: string; is_active: boolean; allow_negative_stock: boolean; is_default: boolean;
};

export const emptyLocationForm = (): LocForm => ({ code: "", name: "", location_type: "STORE", store_id: "", description: "", is_active: true, allow_negative_stock: false, is_default: false });
export const locationFormFromRow = (r: Partial<LocationRow>): LocForm => ({
  code: r.code || "", name: r.name || "", location_type: r.location_type || "STORE", store_id: r.store_id || "", description: r.description || "",
  is_active: r.is_active !== false, allow_negative_stock: !!r.allow_negative_stock, is_default: !!r.is_default,
});

/** 前端先擋明顯錯誤（伺服端與資料庫仍會再驗一次）。 */
export function validateLocationForm(f: LocForm): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.name.trim()) e.name = "請輸入位置名稱";
  if (f.name.trim().length > 100) e.name = "位置名稱不可超過 100 字";
  if (!(LOCATION_TYPES as readonly string[]).includes(f.location_type)) e.location_type = "請選擇位置類型";
  if (f.location_type === "STORE" && !f.store_id) e.store_id = "「門市」類型必須選擇門市";
  if (f.code.trim().length > 40) e.code = "位置代碼不可超過 40 字";
  return e;
}

/** 只送有改的欄位（鎖定的欄位沒改就不送）。 */
export function locationPatch(initial: LocForm, current: LocForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys = Object.keys(current) as (keyof LocForm)[];
  for (const k of keys) {
    const a = typeof initial[k] === "string" ? (initial[k] as string).trim() : initial[k];
    const b = typeof current[k] === "string" ? (current[k] as string).trim() : current[k];
    if (a === b) continue;
    out[k] = k === "store_id" ? (b || null) : k === "code" ? (b || null) : k === "description" ? (b || null) : b;
  }
  if (current.location_type !== "STORE" && "location_type" in out) out.store_id = null;
  return out;
}

export const canBeDefault = (f: Pick<LocForm, "location_type" | "is_active">) => f.is_active && (DEFAULT_ELIGIBLE_TYPES as readonly string[]).includes(f.location_type);

export const fmtQty = (v: number | null | undefined) => (v === null || v === undefined ? "—" : String(Number(v)));
export const storeText = (s: LocationRow["store"]) => (s ? `${s.store_code} ${s.short_name || s.store_name}` : "—");

/** 批次新增的一筆待加入設定（輸入框用字串，送出前轉數字）。 */
export type DraftItem = { part_id: string; name: string; part_code?: string | null; base_unit?: string; safety: string; reorder: string; maximum: string; unit: string; notes: string };
export function draftPayload(d: DraftItem) {
  const n = (v: string) => (v.trim() === "" ? null : v.trim());
  return { part_id: d.part_id, safety_stock_qty: n(d.safety), reorder_point_qty: n(d.reorder), maximum_stock_qty: n(d.maximum), preferred_issue_unit_type: d.unit || null, notes: n(d.notes) };
}
