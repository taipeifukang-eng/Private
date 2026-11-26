// G11 多家買受人公司規則（純函式，無資料庫相依；API、Vue 頁面與單元測試共用）。
// 與資料庫函式 ga_ws_buyer_company_*、ga_ib1_pay_buyer、ga_ws_pay_invoice_save 的統編核對逐條對齊：
// 名稱＋統編（8 碼數字）、預設至多一家、統編在啟用中不重複、停用的公司在既有單據仍顯示、請款單送出時凍結抬頭快照、三聯式發票統編可為任一啟用公司的統編。
import { isUuid } from "./rules";

export const BUYER_TAX_ID_RE = /^[0-9]{8}$/;
export type BuyerCompany = { id: string; name: string; tax_id: string; is_default: boolean; is_active: boolean; sort_order?: number; updated_at?: string; usage_count?: number };

const text = (v: unknown) => String(v ?? "").trim();

/** 統編：去掉空白與連字號後必須是 8 碼數字（和資料庫 ga_pay_norm_tax 一致的寬鬆輸入）。 */
export function normalizeTaxId(v: unknown): string {
  return text(v).replace(/[\s-]/g, "");
}

/** 新增或修改一家公司：有 id 是修改（沒帶的欄位不動），沒有 id 是新增（名稱與統編必填）。 */
export function validateBuyerCompanyPayload(raw: Record<string, any>) {
  for (const k of Object.keys(raw)) if (!["id", "name", "tax_id", "is_default", "is_active", "sort_order", "idempotency_key", "expected_updated_at"].includes(k)) throw new Error(`不支援的欄位：${k}`);
  const id = text(raw.id);
  if (id && !isUuid(id)) throw new Error("公司 id 格式錯誤");
  const out: Record<string, unknown> = {};
  if (id) out.id = id;
  const creating = !id;
  if (creating || "name" in raw) {
    const name = text(raw.name);
    if (!name) throw new Error("請填寫公司名稱");
    if (name.length > 100) throw new Error("公司名稱不可超過 100 個字");
    out.name = name;
  }
  if (creating || "tax_id" in raw) {
    const tax = normalizeTaxId(raw.tax_id);
    if (!BUYER_TAX_ID_RE.test(tax)) throw new Error("統一編號要是 8 碼數字");
    out.tax_id = tax;
  }
  if ("is_default" in raw) out.is_default = bool(raw.is_default, "預設公司");
  if ("is_active" in raw) out.is_active = bool(raw.is_active, "啟用狀態");
  if ("sort_order" in raw) {
    const n = Number(raw.sort_order);
    if (!Number.isInteger(n) || n < -9999 || n > 9999) throw new Error("排序必須是整數");
    out.sort_order = n;
  }
  return out;
}
function bool(v: unknown, label: string): boolean {
  if (typeof v === "boolean") return v;
  const s = text(v).toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  throw new Error(`${label}必須是是或否`);
}

/** 預設公司（啟用中的那一家；至多一家）。 */
export const defaultCompany = (rows: BuyerCompany[]) => rows.find((r) => r.is_default && r.is_active) ?? null;

/** 下拉選單可選的公司：啟用中的，加上單據目前已選的（即使已停用，既有單據仍要顯示）。 */
export function selectableCompanies(rows: BuyerCompany[], currentId?: string | null): BuyerCompany[] {
  return rows.filter((r) => r.is_active || (!!currentId && r.id === currentId));
}

/** 請款單列印與詳情的抬頭：送出後用快照；草稿用所選公司；都沒有再用設定值（舊單 fallback，行為同改版前）。 */
export function resolveBuyer(input: {
  snapshot?: { title?: string | null; tax_id?: string | null } | null;
  company?: Pick<BuyerCompany, "name" | "tax_id"> | null;
  settings?: { title?: string | null; tax_id?: string | null } | null;
}): { title: string | null; tax_id: string | null; source: "SNAPSHOT" | "COMPANY" | "SETTINGS" } {
  const s = input.snapshot;
  if (s && (s.title || s.tax_id)) return { title: s.title ?? null, tax_id: s.tax_id ?? null, source: "SNAPSHOT" };
  if (input.company) return { title: input.company.name, tax_id: input.company.tax_id, source: "COMPANY" };
  return { title: input.settings?.title ?? null, tax_id: input.settings?.tax_id ?? null, source: "SETTINGS" };
}

/** 三聯式發票的買受人統編核對：等於任一啟用公司的統編才算相符；沒有任何公司時不核對（沿用設定鍵行為，由資料庫處理）。 */
export function buyerTaxIdMatches(taxId: string, companies: Pick<BuyerCompany, "tax_id" | "is_active">[]): boolean {
  const t = normalizeTaxId(taxId);
  if (!t) return true;
  const active = companies.filter((c) => c.is_active);
  if (!active.length) return true;
  return active.some((c) => c.tax_id === t);
}
