// G20／G21 廠商、服務分類、服務區域：頁面用的型別與純函式（規則在 lib/workspace/general-affairs/vendor-rules.ts，伺服端與頁面共用）。
import { ApiError } from "../api";
import { VENDOR_STATUS_LABELS, VENDOR_TYPE_LABELS, vendorDisplayName, type VendorStatus } from "../../../lib/workspace/general-affairs/vendor-rules";
import { VENDOR_CODE_MESSAGES, describeWarning, type VendorWarning } from "../../../lib/workspace/general-affairs/vendor-messages";

export { VENDOR_STATUS_LABELS, VENDOR_TYPE_LABELS, vendorDisplayName, describeWarning };
export type { VendorStatus, VendorWarning };

export type VendorAbilities = { canView: boolean; canManage: boolean; canViewCategories: boolean; canManageCategories: boolean; canViewRegions: boolean; canManageRegions: boolean; canViewStats: boolean; canOptions: boolean; billingVisible: boolean };
export type VendorRow = {
  id: string; name: string; alias: string | null; vendor_type: string; status: VendorStatus; tax_id?: string | null; contact_name: string | null; contact_phone: string | null; phone: string | null; email: string | null;
  tags: string[]; service_category_ids: string[]; service_region_ids: string[]; contract_required: boolean; contract_end_date: string | null; contract_due: boolean; updated_at: string;
};
export type VendorStats = { total: number; active: number; paused: number; inactive: number; contract_due: number };
export type VendorDetailData = VendorRow & {
  founded_date: string | null; fax: string | null; website: string | null; city: string | null; district: string | null; address: string | null;
  service_city: string | null; service_district: string | null; service_address: string | null; same_service_address: boolean; line_id: string | null;
  description: string | null; brands: string[]; equipment_types: string[]; service_capability_note: string | null; cooperation_start_date: string | null; preferred_vendor: boolean; cooperation_notes: string | null;
  attachment_names: string[]; created_at: string; updated_by_name: string | null;
  billing_title?: string | null; billing_address?: string | null; invoice_type?: string | null; payment_terms?: string | null; payment_methods?: string[]; accounting_notes?: string | null; total_amount?: number;
  service_categories: Array<{ id: string; name: string; status: string }>; service_regions: Array<{ id: string; name: string; status: string; region_type: string }>;
};
export type TreeRow = {
  id: string; name: string; code: string; parent_id: string | null; parent_name: string | null; description: string | null; status: string; sort_order: number; updated_at: string;
  child_count?: number; vendor_count?: number | null; icon_key?: string | null; common_items?: string[]; region_type?: string; included_locations?: string[];
};

export const INVOICE_TYPES = ["二聯式", "三聯式", "電子發票"];
export const PAYMENT_TERMS = ["月結30天", "月結45天", "現結"];
export const PAYMENT_METHODS = ["匯款", "支票", "現金"];

/** 錯誤訊息：伺服端已回白話；沒有訊息時用代碼對照。 */
export function errorText(e: unknown, fallback = "操作失敗，請稍後重試") {
  if (e instanceof ApiError) {
    const code = String(e.data?.code || "");
    return e.message && e.message !== "服務暫時無法使用，請重試" ? e.message : VENDOR_CODE_MESSAGES[code] || e.message || fallback;
  }
  return (e as Error)?.message || fallback;
}
export const errorCodeOf = (e: unknown) => (e instanceof ApiError ? String(e.data?.code || "") : "");

/** 樹狀資料攤平成深度優先清單（依排序、名稱）；找不到上層的視為根。 */
export function flattenTree<T extends { id: string; parent_id: string | null; sort_order?: number; name: string }>(rows: T[]): Array<T & { depth: number }> {
  const ids = new Set(rows.map((r) => r.id));
  const kids = new Map<string | null, T[]>();
  for (const r of rows) {
    const key = r.parent_id && ids.has(r.parent_id) ? r.parent_id : null;
    if (!kids.has(key)) kids.set(key, []);
    kids.get(key)!.push(r);
  }
  const sorter = (a: T, b: T) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, "zh-Hant");
  const out: Array<T & { depth: number }> = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const r of (kids.get(parent) || []).slice().sort(sorter)) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({ ...r, depth });
      walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** 某節點的所有祖先 id。 */
export function ancestorsOf(rows: Array<{ id: string; parent_id: string | null }>, id: string): string[] {
  const by = new Map(rows.map((r) => [r.id, r.parent_id]));
  const out: string[] = [];
  let cur = by.get(id) ?? null;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) { out.push(cur); seen.add(cur); cur = by.get(cur) ?? null; }
  return out;
}
export function descendantsOf(rows: Array<{ id: string; parent_id: string | null }>, id: string): string[] {
  const out: string[] = [];
  const walk = (p: string) => { for (const r of rows) if (r.parent_id === p && !out.includes(r.id)) { out.push(r.id); walk(r.id); } };
  walk(id);
  return out;
}

/** 勾選區域時連祖先一起勾；取消時連子孫一起取消。回傳新的選取集合。 */
export function toggleRegion(rows: Array<{ id: string; parent_id: string | null }>, selected: string[], id: string, on: boolean): string[] {
  const set = new Set(selected);
  if (on) { set.add(id); for (const a of ancestorsOf(rows, id)) set.add(a); }
  else { set.delete(id); for (const d of descendantsOf(rows, id)) set.delete(d); }
  return Array.from(set);
}

export type VendorForm = {
  name: string; alias: string; vendor_type: string; tax_id: string; founded_date: string; phone: string; fax: string; website: string; city: string; district: string; address: string;
  same_service_address: boolean; service_city: string; service_district: string; service_address: string;
  service_category_ids: string[]; service_region_ids: string[]; brands: string; equipment_types: string; tags: string; description: string; service_capability_note: string;
  contact_name: string; contact_phone: string; line_id: string; email: string;
  cooperation_start_date: string; contract_end_date: string; contract_required: boolean; preferred_vendor: boolean; cooperation_notes: string;
  billing_title: string; billing_address: string; invoice_type: string; payment_terms: string; payment_methods: string[]; accounting_notes: string;
};
export const emptyVendorForm = (): VendorForm => ({
  name: "", alias: "", vendor_type: "company", tax_id: "", founded_date: "", phone: "", fax: "", website: "", city: "", district: "", address: "",
  same_service_address: true, service_city: "", service_district: "", service_address: "",
  service_category_ids: [], service_region_ids: [], brands: "", equipment_types: "", tags: "", description: "", service_capability_note: "",
  contact_name: "", contact_phone: "", line_id: "", email: "",
  // V4：需簽合約預設為「否」。
  cooperation_start_date: "", contract_end_date: "", contract_required: false, preferred_vendor: false, cooperation_notes: "",
  billing_title: "", billing_address: "", invoice_type: "", payment_terms: "", payment_methods: [], accounting_notes: "",
});
const list = (s: string) => Array.from(new Set(s.split(/[,，、\n]/).map((x) => x.trim()).filter(Boolean)));
export function formFromDetail(d: VendorDetailData): VendorForm {
  const t = (v: unknown) => (v == null ? "" : String(v));
  return {
    name: t(d.name), alias: t(d.alias), vendor_type: t(d.vendor_type) || "company", tax_id: t(d.tax_id), founded_date: t(d.founded_date), phone: t(d.phone), fax: t(d.fax), website: t(d.website),
    city: t(d.city), district: t(d.district), address: t(d.address), same_service_address: !!d.same_service_address, service_city: t(d.service_city), service_district: t(d.service_district), service_address: t(d.service_address),
    service_category_ids: [...(d.service_category_ids || [])], service_region_ids: [...(d.service_region_ids || [])], brands: (d.brands || []).join("、"), equipment_types: (d.equipment_types || []).join("、"), tags: (d.tags || []).join("、"),
    description: t(d.description), service_capability_note: t(d.service_capability_note), contact_name: t(d.contact_name), contact_phone: t(d.contact_phone), line_id: t(d.line_id), email: t(d.email),
    cooperation_start_date: t(d.cooperation_start_date), contract_end_date: t(d.contract_end_date), contract_required: !!d.contract_required, preferred_vendor: !!d.preferred_vendor, cooperation_notes: t(d.cooperation_notes),
    billing_title: t(d.billing_title), billing_address: t(d.billing_address), invoice_type: t(d.invoice_type), payment_terms: t(d.payment_terms), payment_methods: [...(d.payment_methods || [])], accounting_notes: t(d.accounting_notes),
  };
}
/** 送出的欄位：全部欄位都帶（編輯時是完整表單的值）；沒有帳務權限時不送帳務欄位（資料庫也會拒絕，這裡避免誤送空值）。 */
export function payloadFromForm(f: VendorForm, billing: boolean): Record<string, unknown> {
  const p: Record<string, unknown> = {
    name: f.name.trim(), alias: f.alias, vendor_type: f.vendor_type, founded_date: f.founded_date, phone: f.phone, fax: f.fax, website: f.website, city: f.city, district: f.district, address: f.address,
    same_service_address: f.same_service_address, service_city: f.same_service_address ? "" : f.service_city, service_district: f.same_service_address ? "" : f.service_district, service_address: f.same_service_address ? "" : f.service_address,
    service_category_ids: f.service_category_ids, service_region_ids: f.service_region_ids, brands: list(f.brands), equipment_types: list(f.equipment_types), tags: list(f.tags), description: f.description,
    service_capability_note: f.service_capability_note, contact_name: f.contact_name, contact_phone: f.contact_phone, line_id: f.line_id, email: f.email,
    cooperation_start_date: f.cooperation_start_date, contract_end_date: f.contract_end_date, contract_required: f.contract_required, preferred_vendor: f.preferred_vendor, cooperation_notes: f.cooperation_notes,
  };
  if (billing) Object.assign(p, { tax_id: f.tax_id, billing_title: f.billing_title, billing_address: f.billing_address, invoice_type: f.invoice_type, payment_terms: f.payment_terms, payment_methods: f.payment_methods, accounting_notes: f.accounting_notes });
  return p;
}

/** 表單步驟（無附件步驟）。 */
export const VENDOR_STEPS = ["基本資料", "服務範圍", "聯絡人", "合作與帳務"] as const;
/** 第幾步有必填沒填（回傳白話說明；空字串表示可以送出）。 */
export function stepProblem(f: VendorForm, step: number, isNew: boolean): string {
  if (step === 0) {
    if (!f.name.trim()) return "請填寫廠商名稱";
    if (isNew && f.vendor_type !== "personal" && !f.tax_id.trim()) return "公司與工作室請填寫 8 碼統一編號（個人可留空）";
    const tax = f.tax_id.normalize("NFKC").replace(/\s/g, "");
    if (tax && !/^[0-9]{8}$/.test(tax)) return "統一編號要是 8 碼數字";
  }
  if (step === 2 && f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return "Email 格式不正確";
  if (step === 3 && f.cooperation_start_date && f.contract_end_date && f.contract_end_date < f.cooperation_start_date) return "合約到期日不能早於合作開始日";
  return "";
}

export const dateText = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : "");
export const timeText = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false }) : "");
export const statusLabel = (s: string) => (VENDOR_STATUS_LABELS as Record<string, string>)[s] || s;
