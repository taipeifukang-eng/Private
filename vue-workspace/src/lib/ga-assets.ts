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

// ------------------------------------------------------------------------------------------------ 設施（G08）
export const FACILITY_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "使用中", PARTIALLY_DAMAGED: "部分損壞", OUT_OF_SERVICE: "停用中", UNDER_RENOVATION: "整修中", RETIRED: "退役",
};
export const FACILITY_STORE_AREAS = ["前場營業區", "收銀區", "調劑區", "處方作業區", "藥品儲存區", "倉庫／後倉", "辦公區", "員工休息區", "廁所", "戶外／騎樓", "機房／設備區", "其他"];

export type FacilityForm = {
  facility_template_id: string; category_id: string; name: string; facility_code: string; status: string; criticality: string; description: string; tags: string;
  brand: string; model: string; area: string; location_detail: string; floor_area_description: string; installed_at: string; purchased_at: string;
  quantity: string; unit: string; purchase_unit_amount: string; last_renovated_at: string; notes: string;
  has_warranty: boolean; warranty_start_date: string; warranty_end_date: string; warranty_claim_method: string; warranty_description: string; warranty_claim_notes: string;
};

export function emptyFacilityForm(): FacilityForm {
  return {
    facility_template_id: "", category_id: "", name: "", facility_code: "", status: "ACTIVE", criticality: "NORMAL", description: "", tags: "", brand: "", model: "",
    area: "", location_detail: "", floor_area_description: "", installed_at: "", purchased_at: "", quantity: "1", unit: "座", purchase_unit_amount: "", last_renovated_at: "",
    notes: "", has_warranty: false, warranty_start_date: "", warranty_end_date: "", warranty_claim_method: "", warranty_description: "", warranty_claim_notes: "",
  };
}

export function facilityFormFromRow(row: Record<string, any>): FacilityForm {
  const specs = row.specs && typeof row.specs === "object" ? row.specs : {};
  return {
    facility_template_id: s(row.facility_template_id), category_id: s(row.category_id), name: s(row.name), facility_code: s(row.facility_code), status: s(row.status || "ACTIVE"),
    criticality: s(row.criticality || "NORMAL"), description: s(row.description), tags: Array.isArray(row.tags) ? row.tags.join(", ") : "", brand: s(specs.facility_brand),
    model: s(specs.facility_model), area: s(row.area), location_detail: s(row.location_detail), floor_area_description: s(specs.facility_floor_area_description),
    installed_at: s(row.installed_at), purchased_at: s(row.purchased_at), quantity: s(row.quantity), unit: s(row.unit), purchase_unit_amount: s(row.purchase_unit_amount),
    last_renovated_at: s(row.last_renovated_at), notes: s(row.notes), has_warranty: specs.facility_has_warranty === true,
    warranty_start_date: s(specs.facility_warranty_start_date), warranty_end_date: s(specs.facility_warranty_end_date), warranty_claim_method: s(specs.facility_warranty_claim_method),
    warranty_description: s(specs.facility_warranty_description), warranty_claim_notes: s(specs.facility_warranty_claim_notes),
  };
}

function facilityWarrantySpecs(f: FacilityForm) {
  return {
    facility_has_warranty: f.has_warranty,
    facility_warranty_start_date: f.has_warranty ? f.warranty_start_date || null : null,
    facility_warranty_end_date: f.has_warranty ? f.warranty_end_date || null : null,
    facility_warranty_claim_method: f.has_warranty ? f.warranty_claim_method || null : null,
    facility_warranty_description: f.has_warranty ? orNull(f.warranty_description) : null,
    facility_warranty_claim_notes: f.has_warranty && f.warranty_claim_method === "OTHER" ? orNull(f.warranty_claim_notes) : null,
  };
}

/** 新增：與舊版新增頁送出的內容相同（品牌、型號、位置說明、保固都放在 specs）。 */
export function facilityCreatePayload(f: FacilityForm, storeId: string, entryMode: string) {
  const qty = Number(f.quantity);
  return {
    store_id: storeId, category_id: f.category_id, facility_template_id: f.facility_template_id || null, name: f.name.trim(), facility_code: orNull(f.facility_code),
    status: f.status, criticality: f.criticality, area: orNull(f.area), location_detail: orNull(f.location_detail), quantity: qty, unit: f.unit.trim(), is_fixed_asset: true,
    installed_at: f.installed_at || null, purchased_at: f.purchased_at || null, purchase_unit_amount: f.purchase_unit_amount ? Number(f.purchase_unit_amount) : null,
    purchase_amount: f.purchase_unit_amount ? qty * Number(f.purchase_unit_amount) : null, last_renovated_at: f.last_renovated_at || null, description: orNull(f.description),
    specs: {
      entry_mode: entryMode, facility_brand: orNull(f.brand), facility_model: orNull(f.model), facility_floor_area_description: orNull(f.floor_area_description),
      ...facilityWarrantySpecs(f),
    },
    tags: tagsOf(f.tags), notes: orNull(f.notes),
  };
}

const FACILITY_SIMPLE = ["category_id", "name", "facility_code", "status", "criticality", "area", "location_detail", "unit", "installed_at", "purchased_at", "last_renovated_at", "description", "notes"] as const;
const FACILITY_DATES = new Set<string>(["installed_at", "purchased_at", "last_renovated_at"]);

/** 編輯：只送有改的欄位；specs 合併（品牌、型號等沒動的鍵保留）。所屬門市不能在這裡改。 */
export function facilityPatch(before: FacilityForm, after: FacilityForm) {
  const out: Record<string, unknown> = {};
  for (const k of FACILITY_SIMPLE) {
    if (before[k] === after[k]) continue;
    const v = after[k];
    out[k] = k === "category_id" || k === "status" || k === "criticality" ? v : FACILITY_DATES.has(k) ? v || null : k === "name" || k === "unit" ? v.trim() : orNull(v);
  }
  if (before.facility_template_id !== after.facility_template_id) out.facility_template_id = after.facility_template_id || null;
  if (before.quantity !== after.quantity) out.quantity = after.quantity ? Number(after.quantity) : null;
  if (before.purchase_unit_amount !== after.purchase_unit_amount) {
    out.purchase_unit_amount = after.purchase_unit_amount ? Number(after.purchase_unit_amount) : null;
    out.purchase_amount = after.purchase_unit_amount ? Number(after.quantity || 0) * Number(after.purchase_unit_amount) : null;
  } else if (before.quantity !== after.quantity && after.purchase_unit_amount) out.purchase_amount = Number(after.quantity || 0) * Number(after.purchase_unit_amount);
  if (before.tags !== after.tags) out.tags = tagsOf(after.tags);
  const specs: Record<string, unknown> = {};
  if (before.brand !== after.brand) specs.facility_brand = orNull(after.brand);
  if (before.model !== after.model) specs.facility_model = orNull(after.model);
  if (before.floor_area_description !== after.floor_area_description) specs.facility_floor_area_description = orNull(after.floor_area_description);
  const warrantyKeys = ["has_warranty", "warranty_start_date", "warranty_end_date", "warranty_claim_method", "warranty_description", "warranty_claim_notes"] as const;
  if (warrantyKeys.some((k) => before[k] !== after[k])) Object.assign(specs, facilityWarrantySpecs(after));
  if (Object.keys(specs).length) out.specs = specs;
  return out;
}

export function validateFacilityForm(f: FacilityForm, opts: { needStore?: boolean; storeId?: string; create?: boolean; entryMode?: string } = {}) {
  const e: Record<string, string> = {};
  if (opts.create && !opts.entryMode) e.entry_mode = "請先選擇這次是既有設施補登或新購設施";
  if (opts.create && !f.facility_template_id) e.facility_template_id = "請先選擇公司設施架型；若公司尚未建立此架型，請先新增公司設施架型";
  if (opts.needStore && !opts.storeId) e.store_id = "請選擇所在據點";
  if (!f.name.trim()) e.name = "請輸入設施名稱";
  if (!f.category_id) e.category_id = "請選擇設施分類";
  if (opts.create) {
    if (!f.area.trim()) e.area = "請選擇或輸入據點區域";
    if (!f.location_detail.trim()) e.location_detail = "請輸入詳細位置";
  }
  // 新增一定要有數量與單位；編輯時舊資料可能兩者都沒填（舊版允許），只要求兩者一起填。
  if (opts.create || f.quantity.trim() || f.unit.trim()) {
    if (!(Number(f.quantity) > 0)) e.quantity = "數量必須大於 0";
    if (!f.unit.trim()) e.unit = "請輸入設施單位";
  }
  if (f.purchase_unit_amount && !(Number(f.purchase_unit_amount) >= 0)) e.purchase_unit_amount = "每單位購買金額不可為負數";
  if (opts.create && opts.entryMode === "NEW_PURCHASE" && !f.purchased_at) e.purchased_at = "新購設施請填寫購買日期";
  if (f.has_warranty) {
    if (opts.create && !f.warranty_start_date) e.warranty_start_date = "有保固時請填寫保固開始日期";
    if (!f.warranty_end_date) e.warranty_end_date = "有保固時請填寫保固到期日期";
    if (f.warranty_start_date && f.warranty_end_date && f.warranty_start_date > f.warranty_end_date) {
      e.warranty_start_date = "保固開始日期不可晚於保固到期日期";
      e.warranty_end_date = "保固到期日期不可早於保固開始日期";
    }
  }
  return e;
}

/** 保固月數（起訖日期）：與舊版「約 N 個月」相同算法。 */
export function warrantyMonths(start: string, end: string) {
  if (!start || !end || start > end) return null;
  const a = new Date(`${start}T00:00:00`);
  const b = new Date(`${end}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.max(0, (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1);
}
