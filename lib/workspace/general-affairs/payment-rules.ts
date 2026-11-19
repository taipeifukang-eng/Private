// M7/M8 第 4.5 批 進貨憑證、進貨發票、請款單規則（純函式，無相依，單元測試直接引用；Vue 前端與 API 共用同一套說法）。
// 與資料庫函式（ga_ws_pay_*、ga_pay_*）逐條對齊：稅額進位、含稅等式、尾差容許、統編核對、發票類型與圖片必傳、台北日期不可未來、
// 同廠商重複號碼、權限碼與帳務機密遮蔽。資料庫是最後一道防線；這裡讓 API 在送出前先擋掉明顯錯誤，並讓畫面與測試用同一套規則。
import { isUuid } from "./rules";

// ---------------------------------------------------------------- 權限碼（與資料庫 ga_pay_can_* 相同；DB 沒有管理員後備，profiles.role = admin 不放行）
export const PAY = {
  view: "general_affairs.purchase_payment.view",
  manage: "general_affairs.purchase_payment.manage",
  vendorView: "general_affairs.vendor.view",
  vendorManage: "general_affairs.vendor.manage",
  reviewView: "general_affairs.purchase_review.view",
} as const;

type Has = { has(code: string): boolean };
const any = (p: Has, ...codes: string[]) => codes.some((c) => p.has(c));

export function paymentAbilities(p: Has) {
  const manage = p.has(PAY.manage);
  const view = manage || p.has(PAY.view);
  return {
    /** 看發票、請款單與採購單的發票與請款分頁（manage 涵蓋 view）。 */
    canView: view,
    /** 新增、編輯、作廢發票，登錄進貨憑證，建立與處理請款單。 */
    canManage: manage,
    /** 看得到賣方統編與廠商銀行資訊（與廠商頁 V1 同規則）。 */
    vendorVisible: any(p, PAY.vendorView, PAY.vendorManage),
    /** 發票編輯頁挑選進貨單需要採購評估檢視（資料庫 ga_po_can_view：評估檢視／管理或採購核准）。 */
    canPickReceipts: view && any(p, PAY.reviewView, "general_affairs.purchase_review.manage", "general_affairs.purchase_order.approve"),
  };
}
export type PaymentAbilities = ReturnType<typeof paymentAbilities>;

// ---------------------------------------------------------------- 發票類型與圖片必傳（P10）
export const INVOICE_TYPES = ["TRIPLE", "DUPLEX", "E_INVOICE", "RECEIPT", "NO_INVOICE"] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];
export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  TRIPLE: "三聯式發票", DUPLEX: "二聯式發票", E_INVOICE: "電子發票", RECEIPT: "收據", NO_INVOICE: "免開發票",
};
export const isInvoiceType = (v: unknown): v is InvoiceType => (INVOICE_TYPES as readonly string[]).includes(String(v));
/** 三聯式、二聯式、電子發票一定要有圖片；收據可不傳但要填原因；免開發票不需要。 */
export const IMAGE_REQUIRED_TYPES: readonly InvoiceType[] = ["TRIPLE", "DUPLEX", "E_INVOICE"];
/** 收據與免開發票沒有稅額：未稅＝含稅、稅額 0。 */
export const NO_TAX_TYPES: readonly InvoiceType[] = ["RECEIPT", "NO_INVOICE"];
export const invoiceNoRequired = (t: InvoiceType) => t === "TRIPLE" || t === "DUPLEX" || t === "E_INVOICE";

/** 缺圖：必傳圖的類型沒有圖片；收據沒有圖片又沒填原因。與資料庫 ga_pay_invoice_missing_image 相同。 */
export function invoiceMissingImage(type: string, noImageReason: string | null | undefined, imageCount: number) {
  if (imageCount > 0) return false;
  if ((IMAGE_REQUIRED_TYPES as readonly string[]).includes(type)) return true;
  if (type === "RECEIPT") return !String(noImageReason ?? "").trim();
  return false;
}

// ---------------------------------------------------------------- 金額
/** 四捨五入到整數（遠離零，與資料庫 round(numeric) 相同）；先修正浮點誤差。 */
export function roundHalfUp(value: number) {
  if (!Number.isFinite(value)) return NaN;
  const fixed = Number(value.toFixed(6));
  return fixed < 0 ? -Math.round(-fixed) : Math.round(fixed);
}
/** 稅額預設：round(未稅 × 稅率)。稅率 0（免稅廠商採購單）稅額為 0。 */
export function calcTax(untaxed: number, rate: number) {
  return roundHalfUp(untaxed * rate);
}
export const calcTotal = (untaxed: number, tax: number) => untaxed + tax;
/** 含稅等式：含稅＝未稅＋稅額。 */
export const totalsConsistent = (untaxed: number, tax: number, total: number) => untaxed + tax === total;
/** 單張進貨單含稅額（品項各自進位後的未稅合計）：未稅 ＋ round(未稅 × 稅率)。 */
export function receiptTotal(untaxed: number, rate: number) {
  return untaxed + calcTax(untaxed, rate);
}
/** 品項各自進位：單價 × 驗入量（採購單位）。 */
export const lineUntaxed = (unitPrice: number, acceptedQty: number) => roundHalfUp(unitPrice * acceptedQty);

export const DEFAULT_TOLERANCE = 5;
/** 差異絕對值在容許內（≤ 尾差）視為尾差，免填原因；超過要填原因但可儲存。5 元整算尾差，6 元超過。 */
export const withinTolerance = (diff: number, tolerance: number = DEFAULT_TOLERANCE) => Math.abs(diff) <= tolerance;
/** 發票含稅額與連結進貨單含稅合計、與分攤合計，任一超過尾差就要填差異原因（資料庫同樣兩個比較對象）。 */
export function diffReasonRequired(invoiceTotal: number, receiptsTotal: number, allocatedTotal: number, tolerance: number = DEFAULT_TOLERANCE, linkedCount = 1) {
  if (linkedCount <= 0) return false;
  return !withinTolerance(invoiceTotal - receiptsTotal, tolerance) || !withinTolerance(invoiceTotal - allocatedTotal, tolerance);
}
/** 累計請款上限：累計驗入含稅額 ＋ 尾差；超過直接擋（不能填原因過關）。 */
export const claimLimit = (receivedTotal: number, tolerance: number = DEFAULT_TOLERANCE) => receivedTotal + tolerance;
export const overClaim = (claimedTotal: number, receivedTotal: number, tolerance: number = DEFAULT_TOLERANCE) => claimedTotal > claimLimit(receivedTotal, tolerance);

// ---------------------------------------------------------------- 統編
export const normalizeTaxNo = (v: unknown) => String(v ?? "").replace(/\D/g, "");
export const taxNoFormatOk = (v: string) => /^[0-9]{8}$/.test(v);
/** 賣方統編不符：發票上的統編與採購單下訂時的廠商統編快照不同（任一邊空白不算不符）。 */
export function sellerMismatch(sellerOnInvoice: unknown, expected: unknown) {
  const s = normalizeTaxNo(sellerOnInvoice);
  const e = normalizeTaxNo(expected);
  return !!s && !!e && s !== e;
}
/** 買受人統編不符：只檢查三聯式，與設定的買受人統編比對（沒設定不檢查）。 */
export function buyerMismatch(type: string, buyerOnInvoice: unknown, configured: unknown) {
  if (type !== "TRIPLE") return false;
  const b = normalizeTaxNo(buyerOnInvoice);
  const c = normalizeTaxNo(configured);
  return !!b && !!c && b !== c;
}
export const taxMismatchReasonRequired = (type: string, seller: unknown, expectedSeller: unknown, buyer: unknown, configuredBuyer: unknown) =>
  sellerMismatch(seller, expectedSeller) || buyerMismatch(type, buyer, configuredBuyer);

// ---------------------------------------------------------------- 日期（台北）
export function taipeiToday(now: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function isRealDate(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}
/** 發票日期不可是台北時間的未來日期。 */
export const invoiceDateNotFuture = (date: string, now: Date = new Date()) => isRealDate(date) && date <= taipeiToday(now);

// ---------------------------------------------------------------- 同廠商重複號碼
export const invoiceNoKey = (vendorId: string, no: string | null | undefined) => `${vendorId}|${String(no ?? "").trim().toLowerCase()}`;
/** 同廠商同號碼（排除作廢與自己）已存在 -> 回重複的那一張。 */
export function findDuplicateInvoice<T extends { id: string; vendor_id: string; invoice_no: string | null; status: string }>(existing: T[], vendorId: string, no: string | null | undefined, selfId?: string) {
  const key = invoiceNoKey(vendorId, no);
  if (!String(no ?? "").trim()) return null;
  return existing.find((e) => e.status !== "VOID" && e.id !== selfId && invoiceNoKey(e.vendor_id, e.invoice_no) === key) ?? null;
}

// ---------------------------------------------------------------- 帳務機密欄位（賣方統編與廠商銀行）
/** 廠商銀行四欄（P8，與廠商頁同一套遮蔽規則）。 */
export const VENDOR_BANK_FIELDS = ["bank_name", "bank_branch", "bank_account", "bank_account_name"] as const;
/** 發票上只有賣方統編屬廠商機密；沒有廠商檢視／管理權限者拿到 null 並標記 seller_tax_masked。 */
export function maskInvoice<T extends Record<string, any>>(row: T, vendorVisible: boolean): T {
  if (vendorVisible) return row;
  return { ...row, seller_tax_id_snapshot: null, seller_tax_masked: row.seller_tax_id_snapshot != null || !!row.seller_tax_masked };
}

// ---------------------------------------------------------------- 輸入驗證（API 送出前先擋；資料庫仍會再驗一次）
const MAX = { invoice_no: 30, reason: 200, notes: 500 } as const;
const bad = (m: string): never => {
  throw new Error(m);
};
function moneyOf(v: unknown, label: string, opts: { required?: boolean } = {}): number | null {
  if (v === undefined || v === null || v === "") {
    if (opts.required) bad(`請輸入${label}`);
    return null;
  }
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > 999_999_999_999) return bad(`${label}要是 0 以上的整數（元）`);
  return n;
}
function textOf(v: unknown, label: string, max: number): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (s.length > max) bad(`${label}不可超過 ${max} 個字`);
  return s;
}

/** 整形並驗證發票送出內容：只留白名單欄位；有帶才驗（編輯時沒帶的欄位維持原值）。回傳給資料庫函式的 payload。 */
export function validateInvoicePayload(raw: Record<string, any>, opts: { create: boolean; now?: Date }) {
  const out: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(raw, k) && raw[k] !== undefined;
  if (opts.create || has("invoice_type")) {
    const t = String(raw.invoice_type ?? "").trim().toUpperCase();
    if (!isInvoiceType(t)) bad("發票類型只能是三聯式、二聯式、電子發票、收據或免開發票");
    out.invoice_type = t;
  }
  const type = String(out.invoice_type ?? raw.invoice_type ?? "").trim().toUpperCase();
  if (has("invoice_no")) {
    const no = textOf(raw.invoice_no, "發票號碼", MAX.invoice_no);
    out.invoice_no = no ? no.toUpperCase() : null;
  }
  if (opts.create && isInvoiceType(type) && invoiceNoRequired(type) && !out.invoice_no) bad("請填寫發票號碼");
  if (has("invoice_date")) {
    const d = String(raw.invoice_date ?? "").trim();
    if (d) {
      if (!isRealDate(d)) bad("發票日期格式錯誤（要是 YYYY-MM-DD）");
      if (!invoiceDateNotFuture(d, opts.now)) bad(`發票日期不能是未來的日期（今天是 ${taipeiToday(opts.now)}）`);
      out.invoice_date = d;
    } else out.invoice_date = null;
  } else if (opts.create && type !== "NO_INVOICE") bad("請填寫發票日期");
  if (has("vendor_id")) {
    const v = raw.vendor_id;
    if (v !== null && v !== "" && !isUuid(v)) bad("廠商格式錯誤");
    out.vendor_id = v || null;
  }
  for (const k of ["seller_tax_id", "buyer_tax_id"] as const) {
    if (has(k)) {
      const t = normalizeTaxNo(raw[k]);
      if (t && !taxNoFormatOk(t)) bad(`${k === "seller_tax_id" ? "賣方" : "買受人"}統一編號要是 8 碼數字`);
      out[k] = t || null;
    }
  }
  for (const k of ["amount_untaxed", "amount_total"] as const) if (has(k)) out[k] = moneyOf(raw[k], k === "amount_untaxed" ? "未稅金額" : "含稅金額");
  if (has("tax_amount")) out.tax_amount = raw.tax_amount === null || raw.tax_amount === "" ? null : moneyOf(raw.tax_amount, "稅額");
  if (opts.create) {
    const noTax = (NO_TAX_TYPES as readonly string[]).includes(type);
    if (noTax ? out.amount_total == null && out.amount_untaxed == null : out.amount_untaxed == null) bad(noTax ? "請輸入金額" : "請輸入未稅金額");
  }
  if (isInvoiceType(type) && (NO_TAX_TYPES as readonly string[]).includes(type) && out.amount_untaxed != null && out.amount_total != null && out.amount_untaxed !== out.amount_total) {
    bad("收據與免開發票沒有稅額，未稅金額與含稅金額必須相同");
  }
  for (const [k, label] of [["diff_reason", "差異原因"], ["tax_mismatch_reason", "統編不符原因"], ["no_image_reason", "沒有圖片的原因"]] as const) {
    if (has(k)) out[k] = textOf(raw[k], label, MAX.reason);
  }
  if (has("notes")) out.notes = textOf(raw.notes, "備註", MAX.notes);
  if (has("receipts")) {
    if (!Array.isArray(raw.receipts)) bad("連結的進貨單格式錯誤");
    const list = raw.receipts as any[];
    if (list.length > 50) bad("一張發票最多連結 50 張進貨單");
    const seen = new Set<string>();
    out.receipts = list.map((r) => {
      if (!r || typeof r !== "object" || !isUuid(r.receipt_id)) return bad("連結的進貨單格式錯誤");
      if (seen.has(r.receipt_id)) bad("同一張進貨單在這張發票中重複出現，請合併成一列");
      seen.add(r.receipt_id);
      const item: Record<string, unknown> = { receipt_id: r.receipt_id };
      const au = moneyOf(r.allocated_untaxed, "分攤未稅金額");
      const at = moneyOf(r.allocated_tax, "分攤稅額");
      if (au !== null) item.allocated_untaxed = au;
      if (at !== null) item.allocated_tax = at;
      return item;
    });
  }
  return out;
}

export const INVOICE_STATUSES = ["ACTIVE", "VOID"] as const;
/** 發票清單篩選（網址參數 -> 資料庫 filters；格式錯誤丟中文 Error，由 API 轉 400）。 */
export function parseInvoiceFilters(p: URLSearchParams) {
  const f: Record<string, unknown> = {};
  for (const [param, key] of [["vendorId", "vendor_id"], ["receiptId", "receipt_id"], ["poId", "po_id"]] as const) {
    const v = (p.get(param) || "").trim();
    if (v) {
      if (!isUuid(v)) bad("篩選條件格式錯誤");
      f[key] = v;
    }
  }
  const status = (p.get("status") || "").trim().toUpperCase();
  if (status) {
    if (!(INVOICE_STATUSES as readonly string[]).includes(status)) bad("狀態只能是 ACTIVE 或 VOID");
    f.status = status;
  }
  const type = (p.get("type") || "").trim().toUpperCase();
  if (type) {
    if (!isInvoiceType(type)) bad("發票類型篩選值錯誤");
    f.type = type;
  }
  for (const [param, key] of [["dateFrom", "date_from"], ["dateTo", "date_to"]] as const) {
    const v = (p.get(param) || "").trim();
    if (v) {
      if (!isRealDate(v)) bad("日期篩選格式錯誤（要是 YYYY-MM-DD）");
      f[key] = v;
    }
  }
  if (p.get("missingImage") === "1" || p.get("missingImage") === "true") f.missing_image = true;
  if (p.get("unreferenced") === "1" || p.get("unreferenced") === "true") f.unreferenced = true;
  const q = (p.get("q") || p.get("search") || "").trim().slice(0, 100);
  if (q) f.search = q;
  return f;
}

/** 進貨憑證狀態文字。 */
export const VOUCHER_LABELS: Record<string, string> = { NONE: "尚未登錄", LINKED: "已連發票", NO_INVOICE: "免開發票／僅收據" };
