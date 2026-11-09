// 設備表單 <-> API 欄位轉換、標籤與驗證（新增頁、列表編輯共用）。
import { ONBOARDING_LABEL, ONBOARDING_PERCENT, ONBOARDING_STATUSES, type OnboardingStatus } from "../../../lib/workspace/general-affairs/asset-fields";

export { ONBOARDING_LABEL, ONBOARDING_PERCENT, ONBOARDING_STATUSES };
export type { OnboardingStatus };

export const EQUIPMENT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "使用中", TEMPORARILY_STOPPED: "暫停使用", SPARE: "備品", RETIRED: "退役", SCRAPPED: "報廢",
};
export const CRITICALITY_LABEL: Record<string, string> = { LOW: "低", NORMAL: "一般", HIGH: "高", CRITICAL: "關鍵" };
export const WARRANTY_CLAIM_METHODS = [
  { value: "", label: "未設定" },
  { value: "INVOICE_OR_RECEIPT", label: "保留購買方發票／收據" },
  { value: "ONLINE_REGISTRATION", label: "上網登錄保固" },
  { value: "SERIAL_NUMBER_REGISTRATION", label: "序號登錄保固" },
  { value: "VENDOR_WARRANTY_CARD", label: "供應商／原廠保固卡" },
  { value: "CONTRACT_OR_QUOTATION", label: "合約／報價單約定" },
  { value: "NO_DOCUMENT_REQUIRED", label: "免單據，依序號或購買紀錄" },
  { value: "OTHER", label: "其他方式，請於備註補充" },
] as const;
export const WARRANTY_FILTER_OPTIONS = [
  { value: "", label: "全部保固" }, { value: "active", label: "保固中" }, { value: "expiring", label: "即將到期" },
  { value: "expired", label: "已過保" }, { value: "missing", label: "保固日未填" }, { value: "none", label: "無保固" },
] as const;

export type EquipmentForm = {
  template_id: string; category_id: string; name: string; asset_code: string; barcode: string; brand: string; model: string; serial_number: string;
  status: string; criticality: string; area: string; location_detail: string; purpose: string; installed_at: string; purchased_at: string;
  purchase_amount: string; tags: string; notes: string; has_warranty: boolean; warranty_end_date: string;
  purchase_source_supplier: string; warranty_claim_method: string; warranty_claim_notes: string;
};

export function emptyEquipmentForm(): EquipmentForm {
  return {
    template_id: "", category_id: "", name: "", asset_code: "", barcode: "", brand: "", model: "", serial_number: "", status: "ACTIVE", criticality: "NORMAL",
    area: "", location_detail: "", purpose: "", installed_at: "", purchased_at: "", purchase_amount: "", tags: "", notes: "", has_warranty: false, warranty_end_date: "",
    purchase_source_supplier: "", warranty_claim_method: "", warranty_claim_notes: "",
  };
}

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
export function equipmentFormFromRow(row: Record<string, any>): EquipmentForm {
  const specs = row.specs && typeof row.specs === "object" ? row.specs : {};
  return {
    template_id: s(row.template_id), category_id: s(row.category_id), name: s(row.name), asset_code: s(row.asset_code), barcode: s(row.barcode), brand: s(row.brand),
    model: s(row.model), serial_number: s(row.serial_number), status: s(row.status || "ACTIVE"), criticality: s(row.criticality || "NORMAL"), area: s(row.area),
    location_detail: s(row.location_detail), purpose: s(row.purpose), installed_at: s(row.installed_at), purchased_at: s(row.purchased_at),
    purchase_amount: s(row.purchase_amount), tags: Array.isArray(row.tags) ? row.tags.join(", ") : "", notes: s(row.notes), has_warranty: !!row.has_warranty,
    warranty_end_date: s(row.warranty_end_date), purchase_source_supplier: s(specs.purchase_source_supplier), warranty_claim_method: s(specs.warranty_claim_method),
    warranty_claim_notes: s(specs.warranty_claim_notes),
  };
}

const tagsOf = (v: string) => v.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
const orNull = (v: string) => (v.trim() ? v.trim() : null);

/** 新增：完整內容（舊版新增頁的欄位）。 */
export function equipmentCreatePayload(f: EquipmentForm, storeId: string, quantity: number, entryMode: string) {
  return {
    store_id: storeId, category_id: f.category_id, template_id: f.template_id || null, quantity, name: f.name.trim(),
    asset_code: orNull(f.asset_code), barcode: orNull(f.barcode), brand: f.brand.trim(), model: orNull(f.model), serial_number: orNull(f.serial_number),
    status: f.status, criticality: f.criticality, area: orNull(f.area), location_detail: f.location_detail.trim(), purpose: orNull(f.purpose),
    installed_at: f.installed_at || null, purchased_at: f.purchased_at || null, purchase_amount: f.purchase_amount ? Number(f.purchase_amount) : null,
    tags: tagsOf(f.tags), notes: orNull(f.notes), has_warranty: f.has_warranty, warranty_end_date: f.has_warranty ? f.warranty_end_date || null : null,
    specs: {
      entry_mode: entryMode, purchase_source_supplier: orNull(f.purchase_source_supplier), warranty_claim_method: f.warranty_claim_method || null,
      warranty_claim_notes: f.warranty_claim_method === "OTHER" ? orNull(f.warranty_claim_notes) : null,
    },
  };
}

const SIMPLE_KEYS = ["category_id", "name", "asset_code", "barcode", "brand", "model", "serial_number", "status", "criticality", "area", "location_detail", "purpose", "installed_at", "purchased_at", "notes"] as const;

/** 編輯：只送有改的欄位（修正舊版整包送出、清空「購買來源供應商」「保固申請方式」的問題）。 */
export function equipmentPatch(before: EquipmentForm, after: EquipmentForm) {
  const out: Record<string, unknown> = {};
  for (const k of SIMPLE_KEYS) {
    if (before[k] === after[k]) continue;
    const v = after[k];
    out[k] = k === "category_id" || k === "status" || k === "criticality" ? v : k === "installed_at" || k === "purchased_at" ? v || null : k === "name" ? v.trim() : orNull(v);
  }
  if (before.purchase_amount !== after.purchase_amount) out.purchase_amount = after.purchase_amount ? Number(after.purchase_amount) : null;
  if (before.tags !== after.tags) out.tags = tagsOf(after.tags);
  if (before.has_warranty !== after.has_warranty) out.has_warranty = after.has_warranty;
  if (before.warranty_end_date !== after.warranty_end_date || before.has_warranty !== after.has_warranty) out.warranty_end_date = after.has_warranty ? after.warranty_end_date || null : null;
  const specs: Record<string, unknown> = {};
  if (before.purchase_source_supplier !== after.purchase_source_supplier) specs.purchase_source_supplier = orNull(after.purchase_source_supplier);
  if (before.warranty_claim_method !== after.warranty_claim_method) specs.warranty_claim_method = after.warranty_claim_method || null;
  if (before.warranty_claim_notes !== after.warranty_claim_notes || before.warranty_claim_method !== after.warranty_claim_method) {
    specs.warranty_claim_notes = after.warranty_claim_method === "OTHER" ? orNull(after.warranty_claim_notes) : null;
  }
  if (Object.keys(specs).length) out.specs = specs;
  return out;
}

export function validateEquipmentForm(f: EquipmentForm, opts: { storeId?: string; needStore?: boolean; quantity?: number } = {}) {
  const e: Record<string, string> = {};
  if (opts.needStore && !opts.storeId) e.store_id = "請選擇門市";
  if (!f.category_id) e.category_id = "請選擇設備分類";
  if (!f.name.trim()) e.name = "請輸入設備名稱";
  if (f.purchase_amount && !(Number(f.purchase_amount) >= 0)) e.purchase_amount = "購買金額必須是 0 以上的數字";
  if (f.has_warranty && f.warranty_end_date && f.purchased_at && f.warranty_end_date < f.purchased_at) e.warranty_end_date = "保固到期日不能早於購買日期";
  if (opts.quantity !== undefined && (!Number.isInteger(opts.quantity) || opts.quantity < 1 || opts.quantity > 100)) e.quantity = "新增數量必須是 1 至 100 的整數";
  if (opts.quantity !== undefined && opts.quantity > 1 && f.asset_code.trim()) e.asset_code = "一次新增多台時不能指定同一個資產編號（留空由系統自動產生）";
  return e;
}

export const warrantyToneClass = (tone: string) => `tone-${tone}`;
export const storeLabel = (s?: { store_code?: string; store_name?: string; short_name?: string | null } | null) => (s ? `${s.store_code} ${s.short_name || s.store_name}` : "—");
export const formatDate = (v?: string | null) => (v ? v.slice(0, 10) : "—");
export const formatMoney = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : `NT$ ${Number(v).toLocaleString("zh-TW")}`);
