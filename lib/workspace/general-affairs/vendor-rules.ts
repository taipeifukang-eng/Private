// M7/M8 第 6 批 G20／G21 廠商與服務分類區域規則（純函式，無相依，單元測試直接引用）。
// 與資料庫函式（ga_vd_*、ga_ws_vendor_*、ga_ws_svc_*）逐條對齊：統編標準化與檢查碼、名稱相近判斷、帳務機密欄位遮蔽清單（V1）、權限碼常數、樹狀循環檢查、合約到期條件（V4）、列表篩選整形。
// 資料庫是最後一道防線（同交易、鎖列、版本檢查、唯一統編）；這裡讓 API 在送出前先擋掉明顯錯誤，並讓畫面與測試用同一套說法。
import { isUuid } from "./rules";

// ---------------------------------------------------------------- 權限碼（與資料庫 ga_vd_can_* 相同）
export const VD = {
  view: "general_affairs.vendor.view",
  manage: "general_affairs.vendor.manage",
  catView: "general_affairs.service_category.view",
  catManage: "general_affairs.service_category.manage",
  regView: "general_affairs.service_region.view",
  regManage: "general_affairs.service_region.manage",
  coopView: "general_affairs.cooperation_record.view",
  reviewView: "general_affairs.purchase_review.view",
  reviewManage: "general_affairs.purchase_review.manage",
  woUpdate: "general_affairs.work_order.update",
  woManage: "general_affairs.work_order.manage",
  requestManage: "general_affairs.request.manage",
  approve: "general_affairs.purchase_order.approve",
} as const;

type Has = { has(code: string): boolean };
const any = (p: Has, ...codes: string[]) => codes.some((c) => p.has(c));

export function vendorAbilities(p: Has) {
  const view = any(p, VD.view, VD.manage);
  const manage = p.has(VD.manage);
  const catManage = p.has(VD.catManage);
  const regManage = p.has(VD.regManage);
  return {
    /** 廠商列表與詳情（含帳務機密欄位）。 */
    canView: view,
    canManage: manage,
    canViewCategories: any(p, VD.catView, VD.catManage) || view,
    canManageCategories: catManage,
    canViewRegions: any(p, VD.regView, VD.regManage) || view,
    canManageRegions: regManage,
    /** 廠商績效頁（資料由獨立函式提供，不含帳務機密欄位）。 */
    canViewStats: p.has(VD.coopView),
    /** 工單、需求單採購評估頁下拉（採購單端另有 po-vendor-options）；採購單查看以採購評估或採購核准判斷。 */
    canOptions: view || any(p, VD.woUpdate, VD.woManage, VD.reviewView, VD.reviewManage, VD.requestManage, VD.approve),
    /** 看得到統編與帳務機密欄位。 */
    billingVisible: view,
  };
}
export type VendorAbilities = ReturnType<typeof vendorAbilities>;

// ---------------------------------------------------------------- 帳務機密欄位（V1）
/** 只有廠商檢視／管理權限者拿得到；其他人的回應完全不含這 12 個欄位（第 4.5 批 P8 新增銀行名稱、分行、帳號、戶名四欄）（資料庫函式不回傳，不是回傳後前端隱藏）。 */
export const VENDOR_SECRET_FIELDS = ["tax_id", "billing_title", "billing_address", "invoice_type", "payment_terms", "payment_methods", "accounting_notes", "total_amount", "bank_name", "bank_branch", "bank_account", "bank_account_name"] as const;
/** 非廠商權限者最多只拿到這些（名稱、別名、類型、狀態、分類、區域、聯絡人）。合約到期日與合作備註不算帳務，但只在完整版（廠商檢視／管理）回傳。 */
export const VENDOR_PUBLIC_FIELDS = ["id", "name", "alias", "vendor_type", "status", "service_category_ids", "service_region_ids", "contact_name", "contact_phone", "line_id", "email", "updated_at"] as const;

export function maskVendor<T extends Record<string, unknown>>(row: T, canSeeBilling: boolean): Partial<T> {
  if (canSeeBilling) return row;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row)) if (!(VENDOR_SECRET_FIELDS as readonly string[]).includes(k)) out[k] = row[k];
  return out as Partial<T>;
}

/** 下拉項目：id、名稱、別名、類型、狀態、聯絡人、電話；統編與付款條件只給可看帳務者。 */
export function maskVendorOption<T extends Record<string, unknown>>(row: T, billingVisible: boolean): Partial<T> {
  if (billingVisible) return row;
  const { tax_id: _t, payment_terms: _p, ...rest } = row as any;
  return rest;
}

// ---------------------------------------------------------------- 狀態
export const VENDOR_STATUSES = ["active", "paused", "inactive"] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];
export const VENDOR_STATUS_LABELS: Record<VendorStatus, string> = { active: "合作中", paused: "暫停", inactive: "停用" };
export const VENDOR_TYPES = ["company", "studio", "personal"] as const;
export const VENDOR_TYPE_LABELS: Record<(typeof VENDOR_TYPES)[number], string> = { company: "公司", studio: "工作室", personal: "個人" };

/** 舊單據上顯示的廠商名稱：暫停加「（暫停）」、停用加「（已停用）」，合作中原樣（V3）。 */
export function vendorDisplayName(name: string, status: string | null | undefined) {
  if (status === "inactive") return `${name}（已停用）`;
  if (status === "paused") return `${name}（暫停）`;
  return name;
}

// ---------------------------------------------------------------- 統編
/** 全形轉半角（NFKC）、去掉所有空白。 */
export function normalizeTaxId(value: unknown): string {
  return String(value ?? "").normalize("NFKC").replace(/\s/g, "");
}
export const isValidTaxIdFormat = (tax: string) => /^[0-9]{8}$/.test(tax);

/** 統編檢查碼（財政部規則）：權重 1,2,1,2,1,2,4,1，乘積十位與個位相加；總和能被 5 整除；第 7 碼是 7 時，總和或總和加 1 能被 5 整除。 */
export function taxIdChecksumOk(tax: string): boolean {
  if (!isValidTaxIdFormat(tax)) return false;
  const w = [1, 2, 1, 2, 1, 2, 4, 1];
  let sum = 0;
  for (let i = 0; i < 8; i += 1) {
    const prod = Number(tax[i]) * w[i];
    sum += Math.floor(prod / 10) + (prod % 10);
  }
  if (sum % 5 === 0) return true;
  return tax[6] === "7" && (sum + 1) % 5 === 0;
}

// ---------------------------------------------------------------- 名稱相近
const SUFFIX = /(股份有限公司|有限公司|股份公司|企業有限公司|企業社|企業行|商行)$/;
/** 全半形統一、轉小寫、去空白與常見標點、去公司型態字尾（最多兩層）。與資料庫 ga_vd_norm_name 相同。 */
export function normalizeVendorName(value: unknown): string {
  let v = String(value ?? "").normalize("NFKC").toLowerCase();
  v = v.replace(/[\s\-_.,，。、()（）「」]/g, "");
  for (let i = 0; i < 2; i += 1) v = v.replace(SUFFIX, "");
  return v;
}

/** 兩組名稱（名稱與別名）正規化後相同，或其中一個（至少 2 字）包含另一個，視為相近。 */
export function namesSimilar(a: Array<string | null | undefined>, b: Array<string | null | undefined>): boolean {
  const na = a.map(normalizeVendorName).filter(Boolean);
  const nb = b.map(normalizeVendorName).filter(Boolean);
  for (const x of na) for (const y of nb) {
    if (x === y) return true;
    if (x.length >= 2 && y.length >= 2 && (x.includes(y) || y.includes(x))) return true;
  }
  return false;
}

export function similarVendors<T extends { id: string; name: string; alias?: string | null }>(self: { id?: string | null; name: string; alias?: string | null }, others: T[]): T[] {
  return others.filter((o) => o.id !== self.id && namesSimilar([self.name, self.alias], [o.name, o.alias]));
}

// ---------------------------------------------------------------- 樹狀（分類與區域）
export type TreeNode = { id: string; parent_id: string | null };
/** 把 id 的上層設為 parentId 會不會形成循環（parentId 是 id 本身或 id 的子孫）。 */
export function wouldCreateCycle(nodes: TreeNode[], id: string, parentId: string | null): boolean {
  if (!parentId) return false;
  if (parentId === id) return true;
  const byId = new Map(nodes.map((n) => [n.id, n.parent_id]));
  const seen = new Set<string>();
  let cur: string | null | undefined = parentId;
  while (cur) {
    if (cur === id) return true;
    if (seen.has(cur)) return false;
    seen.add(cur);
    cur = byId.get(cur) ?? null;
  }
  return false;
}

export const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,29}$/;
export const normalizeCode = (v: unknown) => String(v ?? "").trim().toUpperCase();
export const CATEGORY_STATUSES = ["active", "inactive"] as const;
export const REGION_STATUSES = ["active", "inactive", "archived"] as const;
export const REGION_TYPES = ["country", "region", "city", "district"] as const;
export const REGION_TYPE_LABELS: Record<(typeof REGION_TYPES)[number], string> = { country: "國家", region: "大區", city: "縣市", district: "行政區" };

// ---------------------------------------------------------------- 合約到期（V4、V9 #3）
/** 台北今日（YYYY-MM-DD）。 */
export function taipeiToday(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value || "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** 合作中＋需簽合約＋有到期日，且到期日在今日 +30 天內（含已過期）。 */
export function contractDue(v: { status: string; contract_required: boolean; contract_end_date: string | null }, today: string = taipeiToday()): boolean {
  return v.status === "active" && !!v.contract_required && !!v.contract_end_date && v.contract_end_date <= addDays(today, 30);
}

// ---------------------------------------------------------------- 列表篩選整形（API 送進資料庫函式前）
function bad(message: string): never {
  throw new Error(message);
}
export function parseVendorFilters(params: URLSearchParams): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  const search = (params.get("search") || "").trim();
  if (search) f.search = search.slice(0, 100);
  const status = params.get("status");
  if (status) {
    if (!(VENDOR_STATUSES as readonly string[]).includes(status)) bad("狀態篩選值錯誤");
    f.status = status;
  }
  const type = params.get("vendorType");
  if (type) {
    if (!(VENDOR_TYPES as readonly string[]).includes(type)) bad("類型篩選值錯誤");
    f.vendor_type = type;
  }
  for (const [q, k] of [["categoryId", "category_id"], ["regionId", "region_id"]] as const) {
    const v = params.get(q);
    if (v) {
      if (!isUuid(v)) bad(`${q} 格式錯誤`);
      f[k] = v;
    }
  }
  if (params.get("contract_due") === "1" || params.get("contract_due") === "true") f.contract_due = true;
  return f;
}

export function parseTreeFilters(params: URLSearchParams, kind: "category" | "region"): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  const search = (params.get("search") || "").trim();
  if (search) f.search = search.slice(0, 100);
  const status = params.get("status");
  if (status) {
    if (!((kind === "category" ? CATEGORY_STATUSES : REGION_STATUSES) as readonly string[]).includes(status)) bad("狀態篩選值錯誤");
    f.status = status;
  }
  const parent = params.get("parentId");
  if (parent) {
    if (!isUuid(parent)) bad("parentId 格式錯誤");
    f.parent_id = parent;
  }
  if (kind === "region") {
    const type = params.get("regionType");
    if (type) {
      if (!(REGION_TYPES as readonly string[]).includes(type)) bad("類型篩選值錯誤");
      f.region_type = type;
    }
  }
  if (params.get("options") === "1" || params.get("options") === "true") f.options = true;
  return f;
}

/** 寫入必帶的版本資訊。 */
export function parseExpectedUpdatedAt(raw: unknown): string {
  const v = String(raw ?? "").trim();
  if (!v) bad("缺少版本資訊（expected_updated_at），請重新載入畫面");
  if (Number.isNaN(Date.parse(v))) bad("版本資訊格式錯誤（expected_updated_at），請重新載入畫面");
  return v;
}

/** 逗號分隔的 uuid 清單（廠商下拉 includeIds）。 */
export function parseIdList(raw: string | null, max = 100): string[] {
  if (!raw) return [];
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length > max) bad(`一次最多帶 ${max} 個 id`);
  for (const id of ids) if (!isUuid(id)) bad("id 格式錯誤");
  return Array.from(new Set(ids));
}
