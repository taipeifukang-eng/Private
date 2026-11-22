// G12 庫存餘額、流水、過帳、持有狀態：頁面用的型別與小工具（規則在 lib/workspace/general-affairs/inventory-stock-rules.ts，伺服端與頁面共用）。

export type StoreInfo = { id: string; store_code: string; store_name: string; short_name: string | null } | null;
export type LocationInfo = { id: string; code: string | null; name: string; location_type: string; store_id: string | null; allow_negative_stock: boolean; is_default?: boolean; store?: StoreInfo };
export type PartInfoLite = {
  id: string; name: string; part_code?: string | null; barcode?: string | null; brand?: string | null; model?: string | null; specification?: string | null;
  base_unit: string; purchase_unit?: string | null; purchase_to_base_rate?: number | null; minimum_issue_qty?: number; allow_fractional_issue?: boolean; allow_unpacking?: boolean;
};
export type Holding = { in_use_quantity: number; idle_quantity: number; unclassified_quantity: number; notes: string | null; updated_at: string | null };
export type BalanceRowView = {
  id: string; location_id: string; part_id: string; quantity_base: number; last_transaction_at: string | null; version: number; updated_at: string;
  level: "red" | "yellow" | null; safety_stock_qty: number | null; reorder_point_qty: number | null; maximum_stock_qty: number | null;
  holding: Holding | null; location: LocationInfo | null; part: PartInfoLite | null; store: StoreInfo;
};
export type BalanceStats = { rows: number; nonzero: number; zero: number; negative: number; red: number; yellow: number; total_qty: number; in_use: number; idle: number; unclassified: number };
export type TransactionRowView = {
  id: string; transaction_no: string; transaction_type: string; location_id: string; part_id: string; quantity_input: number; input_unit_type: string;
  unit_conversion_rate: number; quantity_base: number; balance_before: number; balance_after: number; reason: string | null; notes: string | null;
  occurred_at: string; created_at: string; creator_name: string | null; source_label: string; transfer_no: string | null; return_stock: boolean;
  location: (LocationInfo & { store?: StoreInfo }) | null; part: PartInfoLite | null; reference_type?: string | null;
};
export type HoldingEventView = {
  id: string; before_in_use_quantity: number; before_idle_quantity: number; after_in_use_quantity: number; after_idle_quantity: number;
  notes: string | null; created_at: string; creator_name: string | null;
};

export const fmtNum = (v: number | string | null | undefined) => {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("zh-TW", { maximumFractionDigits: 4 }) : "—";
};
export const fmtTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
};
export const partText = (p: Pick<PartInfoLite, "name" | "part_code" | "brand" | "model" | "specification"> | null | undefined) =>
  p ? [p.name, [p.part_code, p.brand, p.model, p.specification].filter(Boolean).join(" / ")].filter(Boolean).join("　") : "（料件資料不可見）";
export const locationText = (l: Pick<LocationInfo, "name" | "code"> | null | undefined, store?: StoreInfo) =>
  l ? `${l.name}${store ? `｜${store.short_name || store.store_name}` : ""}` : "（位置資料不可見）";

/** 「datetime-local」輸入框要的本地時間字串（精確到分鐘）。 */
export function localInputValue(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** 下載 CSV：走同一個 API（帶登入 cookie），取回後存成檔案；失敗回說明文字。 */
export async function downloadCsv(path: string, query: URLSearchParams): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`/api/workspace/${path}?${query}`, { credentials: "same-origin", signal: AbortSignal.timeout(120000) });
  } catch {
    return "連線中斷或逾時，請稍後重試";
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return data.error || "匯出失敗，請稍後重試";
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename\*=UTF-8''([^;]+)/.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : "export.csv";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return res.headers.get("X-Export-Truncated") === "true" ? "資料筆數很多，只匯出前 50,000 筆，請縮小篩選範圍後再匯出。" : "";
}
