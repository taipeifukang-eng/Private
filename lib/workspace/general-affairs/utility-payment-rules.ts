// G46 水電話費請款（水電網費帳單接進請款單）規則（純函式，無資料庫相依；API、Vue 頁面與單元測試共用）。
// 與資料庫函式（ga_pay_ub_*、ga_ws_pay_ub_*、ga_ws_ub_*）逐條對齊：帳單能不能請款（建立、重新帶入、送出三處同一套判斷）、自動帶入、送出前缺附件、
// 自動標記已繳與回復的規則表（U6）、帳單鎖定（D7）、權限矩陣（U7）、來源整形、對帳 CSV 與列印欄位（U3）、錯誤白話。資料庫是最後一道防線，這裡讓 API 先擋明顯錯誤、畫面與測試用同一套說法。
import { isUuid } from "./rules";
import { isRealDate, taipeiToday } from "./payment-rules";
import { PAY, paymentAbilities } from "./payment-rules";
import { UB, utilityBillAbilities, EXPENSE_TYPE_LABELS, identifierLabel, monthStart, type ExpenseType } from "./utility-bill-rules";
import { buildCsv, csvCell, type CsvColumn, type PayMethod, PAY_METHOD_LABELS, PR_SOURCES, PR_SOURCE_LABELS, PR_STATUS_LABELS, type PrStatus, MONTH_RE } from "./payment-request-rules";

// ---------------------------------------------------------------- 來源
export const PR_SOURCE_VALUES = PR_SOURCES;
export type PrSourceValue = (typeof PR_SOURCES)[number];
export const PR_SOURCE_NAMES: Record<PrSourceValue, string> = PR_SOURCE_LABELS;
export const isSourceValue = (v: unknown): v is PrSourceValue => (PR_SOURCE_VALUES as readonly string[]).includes(String(v));
/** 沒有來源的舊資料一律當採購。 */
export const sourceOf = (row: { source?: unknown } | null | undefined): PrSourceValue => (row && isSourceValue(row.source) ? row.source : "PURCHASE");
export const isUtilityRequest = (row: { source?: unknown } | null | undefined) => sourceOf(row) === "UTILITY";
export const sourceName = (row: { source?: unknown } | null | undefined) => PR_SOURCE_NAMES[sourceOf(row)];
/** 來源篩選參數：空＝全部；其他值回錯誤。 */
export function parseSourceParam(v: string | null | undefined): PrSourceValue | null {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return null;
  if (!isSourceValue(s)) throw new Error("來源篩選值錯誤（採購或水電話費）");
  return s;
}

// ---------------------------------------------------------------- 權限（U7；與資料庫 ga_pay_can_*／ga_ub_can_* 相同，profiles.role = admin 不放行）
type Has = { has(code: string): boolean };
export function utilityPaymentAbilities(p: Has) {
  const pay = paymentAbilities(p);
  const bill = utilityBillAbilities(p);
  return {
    ...pay,
    /** 看請款單明細（門市、識別號碼、各帳單金額）另需水電檢視（D9）。 */
    billsVisible: bill.canView,
    billManage: bill.canManage,
    /** 建立、修改草稿、送出水電請款單：請款管理＋水電管理，缺一不可。 */
    canCreateUtility: pay.canManage && bill.canManage,
    /** 缺哪個（給畫面反灰說明用）。 */
    missingForCreate: [!pay.canManage ? "請款管理" : null, !bill.canManage ? "水電網費管理" : null].filter(Boolean) as string[],
  };
}
export type UtilityPaymentAbilities = ReturnType<typeof utilityPaymentAbilities>;
export const UTILITY_PERMISSION_CODES = { payManage: PAY.manage, billManage: UB.manage, billView: UB.view } as const;

/** 水電請款單的動作需要的權限：送出需兩個；退回、作廢、標已付款、備註、重抓銀行只要請款管理（自動回復帳單由資料庫同步情境放行）。 */
export function utilityActionAllowed(action: string, p: Has): { ok: boolean; missing: string[] } {
  const a = utilityPaymentAbilities(p);
  const missing: string[] = [];
  if (!a.canManage) missing.push("請款管理");
  if (action === "submit" && !a.billManage) missing.push("水電網費管理");
  return { ok: missing.length === 0, missing };
}

// ---------------------------------------------------------------- 金額
/** 帳單金額可以請款：正整數（請款金額欄位是整數且要大於 0；帳單金額可以有小數、可以是 0）。 */
export function amountProblem(amount: unknown): "BILL_AMOUNT_INVALID" | null {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return "BILL_AMOUNT_INVALID";
  return null;
}
export function amountProblemMessage(amount: unknown): string | null {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "0 元帳單不需要請款";
  if (!Number.isInteger(n)) return "金額有小數，請先到水電帳單修正";
  return null;
}
export const sumClaims = (rows: Array<{ claim_total?: unknown; amount?: unknown }>) => rows.reduce((s, r) => s + (Number(r.claim_total ?? r.amount) || 0), 0);

// ---------------------------------------------------------------- 帳單能不能請款（建立、重新帶入、送出三處共用；與資料庫 ga_pay_ub_eligible 逐條對齊，順序一致）
export type EligibilityCode =
  | "BILL_DELETED" | "BILL_NO_PAYEE" | "BILL_PAYEE_MISMATCH" | "BILL_MONTH_MISMATCH" | "BILL_ALREADY_PAID" | "BILL_AMOUNT_INVALID" | "BILL_IN_OTHER_REQUEST";
export type BillLite = { id?: string; deleted_at?: string | null; payee_vendor_id?: string | null; billing_month?: string; paid_at?: string | null; amount?: number | string | null };
export type EligibilityContext = { vendorId: string; month: string; payeeName?: string | null; otherRequestNo?: string | null };
export type Eligibility = { eligible: true } | { eligible: false; code: EligibilityCode; message: string; pr_no?: string };
export function billEligibility(b: BillLite, c: EligibilityContext): Eligibility {
  if (b.deleted_at) return { eligible: false, code: "BILL_DELETED", message: "這筆帳單已被刪除，不能請款" };
  if (!b.payee_vendor_id) return { eligible: false, code: "BILL_NO_PAYEE", message: "這筆帳單還沒有指定繳費單位，請先到水電帳單補填" };
  if (b.payee_vendor_id !== c.vendorId) return { eligible: false, code: "BILL_PAYEE_MISMATCH", message: `這筆帳單的繳費單位不是 ${c.payeeName || "這張請款單的繳費單位"}` };
  const bm = String(b.billing_month ?? "").slice(0, 7);
  const rm = String(c.month ?? "").slice(0, 7);
  if (bm !== rm) return { eligible: false, code: "BILL_MONTH_MISMATCH", message: `這筆帳單是 ${bm} 月，不能放進 ${rm} 月的請款單` };
  if (b.paid_at) return { eligible: false, code: "BILL_ALREADY_PAID", message: `這筆帳單已標記已繳（${b.paid_at}），不需要再請款` };
  const am = amountProblemMessage(b.amount);
  if (am) return { eligible: false, code: "BILL_AMOUNT_INVALID", message: am };
  if (c.otherRequestNo) return { eligible: false, code: "BILL_IN_OTHER_REQUEST", message: `這筆帳單已在請款單 ${c.otherRequestNo} 內`, pr_no: c.otherRequestNo };
  return { eligible: true };
}
/** 自動帶入：同單位同月份全部可請款的帳單 id（依 id 排序，與資料庫去重排序相同）。otherRequestOf 回傳帳單所在的其他有效請款單號。 */
export function autoPickBills(bills: Array<BillLite & { id: string }>, c: EligibilityContext, otherRequestOf: (id: string) => string | null = () => null): string[] {
  return bills
    .filter((b) => billEligibility(b, { ...c, otherRequestNo: otherRequestOf(b.id) }).eligible)
    .map((b) => b.id)
    .sort();
}
/** 沒有可請款帳單時的原因統計（NO_BILLS 的說明）。 */
export function excludedStats(bills: BillLite[], c: EligibilityContext, otherRequestOf: (b: BillLite) => string | null = () => null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of bills) {
    if (b.deleted_at) continue;
    const e = billEligibility(b, { ...c, otherRequestNo: otherRequestOf(b) });
    if (!e.eligible) out[e.code] = (out[e.code] || 0) + 1;
  }
  return out;
}
export const NO_BILLS_MESSAGE = (payeeName: string, month: string) => `${payeeName} ${month.slice(0, 7)} 月沒有可以請款的帳單`;
export const EXCLUDED_LABELS: Record<string, string> = {
  BILL_DELETED: "已刪除", BILL_NO_PAYEE: "沒有繳費單位", BILL_PAYEE_MISMATCH: "別的繳費單位", BILL_MONTH_MISMATCH: "別的月份", BILL_ALREADY_PAID: "已繳",
  BILL_AMOUNT_INVALID: "金額有小數或為 0", BILL_IN_OTHER_REQUEST: "已在別張請款單",
};
/** 「這個月還有 N 張帳單沒有指定繳費單位」的提示。 */
export const noPayeeNotice = (n: number) => (n > 0 ? `這個月還有 ${n} 張帳單沒有指定繳費單位，補填後才能請款` : "");

// ---------------------------------------------------------------- 送出前缺附件（U5）：每張帳單至少一個附件
export type AttachmentRow = { bill_id?: string; id?: string; attachment_count?: number | string | null; location_name?: string | null; expense_type?: string | null; identifier?: string | null; amount?: number | string | null };
export function missingAttachmentBills<T extends AttachmentRow>(rows: T[]): T[] {
  return rows.filter((r) => !(Number(r.attachment_count) > 0));
}
export function billLabel(r: { location_name?: string | null; expense_type?: string | null; identifier?: string | null }): string {
  const t = EXPENSE_TYPE_LABELS[r.expense_type as ExpenseType] ?? String(r.expense_type ?? "");
  return [r.location_name, t, r.identifier].filter((x) => x !== null && x !== undefined && String(x) !== "").join(" ");
}
/** 與資料庫 BILL_MISSING_ATTACHMENT 訊息相同（最多列 10 張）。沒缺回 null。 */
export function missingAttachmentMessage(missing: AttachmentRow[]): string | null {
  if (!missing.length) return null;
  const labels = missing.map(billLabel);
  return `有 ${missing.length} 張帳單還沒有附件（帳單照片或 PDF），請先上傳：${labels.slice(0, 10).join("、")}${labels.length > 10 ? " 等" : ""}`;
}

// ---------------------------------------------------------------- 帳單鎖定（D7）
export const BILL_LOCK_FIELDS = ["amount", "payee_vendor_id", "billing_month", "expense_type", "location", "identifier", "delete"] as const;
export type InRequest = { status: string; auto_mark_paid?: boolean } | null | undefined;
/** 帳單位於已送出或已付款請款單內才鎖；勾自動標記者另鎖繳費日期（paid_at）。草稿內不鎖。 */
export function lockedFields(req: InRequest): string[] {
  if (!req || (req.status !== "SUBMITTED" && req.status !== "PAID")) return [];
  return req.auto_mark_paid ? [...BILL_LOCK_FIELDS, "paid_at"] : [...BILL_LOCK_FIELDS];
}
export const isFieldLocked = (field: string, locked: readonly string[] | null | undefined) => !!locked && locked.includes(field);
/** 這次修改碰到哪些鎖定的欄位（畫面反灰與 API 先擋用；資料庫觸發器是最後一道防線）。 */
export function lockedChanges(changed: readonly string[], req: InRequest): string[] {
  const locked = lockedFields(req);
  return changed.filter((f) => locked.includes(f));
}
export function lockMessage(prNo: string, status: string, autoMark: boolean, changed: readonly string[]): string | null {
  const state = status === "PAID" ? "已付款" : "已送出";
  if (changed.some((f) => (BILL_LOCK_FIELDS as readonly string[]).includes(f))) return `這筆帳單已在請款單 ${prNo} 內（${state}），金額、繳費單位與刪除已鎖定；請先請款單退回或作廢`;
  if (autoMark && changed.includes("paid_at")) return `這筆帳單已在請款單 ${prNo} 內（${state}，勾選送出後自動標記已繳），繳費狀態由請款單管理；請先請款單退回或作廢`;
  return null;
}

// ---------------------------------------------------------------- 自動標記已繳與回復（U6）
export type BillState = { id: string; paid_at: string | null; paid_by_pr_id: string | null };
export type SyncPlan = {
  /** 要標已繳的帳單（繳費日期＝台北今天，記錄 paid_by_pr_id）。 */
  mark: Array<{ id: string; paid_at: string; paid_by_pr_id: string }>;
  /** 要改回待繳的帳單（只限「因這張請款單自動標記」的）。 */
  revert: string[];
  /** 是否釋放明細（作廢時 active 改 false，帳單可重新請款）。 */
  release: boolean;
  /** 明細留痕原因。 */
  revertReason: "RETURN" | "VOID" | null;
};
/**
 * 狀態變化對帳單的影響：
 * 送出＋勾自動標記→全部標已繳（不套「帳單月份前 1 個月」限制）；送出不勾→不動；
 * 退回→只回復 paid_by_pr_id＝本單且已繳者；作廢（含已付款作廢）→同退回，並釋放明細；會計標已付款→不動。
 */
export function autoMarkPlan(action: "submit" | "return" | "void" | "mark_paid", prId: string, autoMarkPaid: boolean, bills: BillState[], now: Date = new Date()): SyncPlan {
  const plan: SyncPlan = { mark: [], revert: [], release: false, revertReason: null };
  if (action === "submit") {
    if (autoMarkPaid) plan.mark = bills.map((b) => ({ id: b.id, paid_at: taipeiToday(now), paid_by_pr_id: prId }));
    return plan;
  }
  if (action === "return" || action === "void") {
    plan.revert = bills.filter((b) => b.paid_by_pr_id === prId).map((b) => b.id);
    plan.revertReason = action === "return" ? "RETURN" : "VOID";
    plan.release = action === "void";
  }
  return plan;
}
/** 手動標記、改回待繳、改繳費日期一律把 paid_by_pr_id 清空（之後退回或作廢不會動它）。 */
export function afterManualPaidChange(before: { paid_at: string | null; paid_by_pr_id: string | null }, nextPaidAt: string | null) {
  return nextPaidAt === before.paid_at ? before.paid_by_pr_id : null;
}
/** 作廢已付款的水電請款單前要跳確認（D6）。 */
export const voidPaidWarning = "款項已付，帳單會改回待繳，請確認是否需要追回款項";

// ---------------------------------------------------------------- 請款單輸入驗證
export const normalizeBillMonth = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])(-01)?$/.test(s)) return null;
  return monthStart(s);
};
const text = (v: unknown, max: number, label: string) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (s.length > max) throw new Error(`${label}不可超過 ${max} 個字`);
  return s;
};
function billIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new Error("帳單清單格式錯誤");
  if (raw.length === 0) throw new Error("請至少選擇一張帳單");
  if (raw.length > 200) throw new Error("一張請款單最多 200 張帳單");
  const out = raw.map((x, i) => {
    const s = String(x ?? "").trim();
    if (!isUuid(s)) throw new Error(`第 ${i + 1} 張帳單格式錯誤`);
    return s;
  });
  return Array.from(new Set(out));
}
const bool = (v: unknown, label: string) => {
  if (typeof v !== "boolean") throw new Error(`${label}格式錯誤`);
  return v;
};
export function validateUtilityCreatePayload(raw: Record<string, any>) {
  for (const k of Object.keys(raw)) if (!["source", "vendor_id", "bill_month", "bill_ids", "auto_mark_paid", "expected_pay_date", "notes"].includes(k)) throw new Error(`不支援的欄位：${k}`);
  if (!isUuid(String(raw.vendor_id ?? ""))) throw new Error("請選擇繳費單位");
  const month = normalizeBillMonth(raw.bill_month);
  if (!month) throw new Error("請選擇帳單月份（YYYY-MM）");
  const out: Record<string, unknown> = { vendor_id: String(raw.vendor_id), bill_month: month.slice(0, 7), notes: text(raw.notes, 500, "備註") };
  if (raw.bill_ids !== undefined && raw.bill_ids !== null) out.bill_ids = billIds(raw.bill_ids);
  if (raw.auto_mark_paid !== undefined && raw.auto_mark_paid !== null) out.auto_mark_paid = bool(raw.auto_mark_paid, "送出後帳單自動標記已繳的選項");
  const pay = String(raw.expected_pay_date ?? "").trim();
  if (pay) {
    if (!isRealDate(pay)) throw new Error("預計付款日格式錯誤（YYYY-MM-DD）");
    out.expected_pay_date = pay;
  }
  return out;
}
export function validateUtilityUpdatePayload(raw: Record<string, any>) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) if (!["bill_ids", "refresh", "auto_mark_paid", "expected_pay_date", "notes"].includes(k)) throw new Error(`不支援的欄位：${k}`);
  if ("bill_ids" in raw) out.bill_ids = billIds(raw.bill_ids);
  if ("refresh" in raw) out.refresh = bool(raw.refresh, "重新帶入");
  if ("auto_mark_paid" in raw) out.auto_mark_paid = bool(raw.auto_mark_paid, "送出後帳單自動標記已繳的選項");
  if ("expected_pay_date" in raw) {
    const pay = String(raw.expected_pay_date ?? "").trim();
    if (pay && !isRealDate(pay)) throw new Error("預計付款日格式錯誤（YYYY-MM-DD）");
    out.expected_pay_date = pay || null;
  }
  if ("notes" in raw) out.notes = text(raw.notes, 500, "備註");
  if (!Object.keys(out).length) throw new Error("沒有要修改的內容");
  return out;
}
export function parseCandidateParams(p: URLSearchParams) {
  const month = normalizeBillMonth(p.get("month"));
  if (!month) throw new Error("請選擇帳單月份（YYYY-MM）");
  const f: Record<string, unknown> = { month: month.slice(0, 7) };
  const vendor = (p.get("vendor_id") || p.get("vendorId") || "").trim();
  if (vendor) {
    if (!isUuid(vendor)) throw new Error("繳費單位格式錯誤");
    f.vendor_id = vendor;
  }
  const pr = (p.get("pr_id") || p.get("prId") || "").trim();
  if (pr) {
    if (!isUuid(pr)) throw new Error("請款單格式錯誤");
    f.pr_id = pr;
  }
  return f;
}
export function validateSetPayee(raw: Record<string, any>) {
  for (const k of Object.keys(raw)) if (!["ids", "vendor_id"].includes(k)) throw new Error(`不支援的欄位：${k}`);
  if (!isUuid(String(raw.vendor_id ?? ""))) throw new Error("請選擇繳費單位");
  if (!Array.isArray(raw.ids) || raw.ids.length === 0) throw new Error("請選擇要補填的帳單");
  if (raw.ids.length > 200) throw new Error("一次最多補填 200 筆帳單");
  const ids = raw.ids.map((x: unknown, i: number) => {
    const s = String(x ?? "").trim();
    if (!isUuid(s)) throw new Error(`第 ${i + 1} 筆帳單格式錯誤`);
    return s;
  });
  return { ids: Array.from(new Set(ids)), vendor_id: String(raw.vendor_id) };
}
/** 帳單儲存時的繳費單位欄位（有帶才處理；空字串視為清空）。不放進 G23 的 BILL_PAYLOAD_FIELDS（那是帳單自己的 15 個欄位），在這裡另外挑。 */
export function pickPayeeField(body: Record<string, unknown>): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(body, "payee_vendor_id")) return {};
  const v = body.payee_vendor_id;
  if (v === null || v === undefined || String(v).trim() === "") return { payee_vendor_id: null };
  const s = String(v).trim();
  if (!isUuid(s)) throw new Error("繳費單位格式錯誤");
  return { payee_vendor_id: s };
}
/** 帳單列表的新篩選：request（none＝未在有效請款單、in_request＝已在）、payee（繳費單位 id 或 none）。 */
export function parseUtilityBillExtraFilters(p: URLSearchParams): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  const request = (p.get("request") || "").trim();
  if (request) {
    if (!["none", "in_request"].includes(request)) throw new Error("請款狀態篩選值錯誤");
    f.request = request;
  }
  const payee = (p.get("payee") || "").trim();
  if (payee) {
    if (payee !== "none" && !isUuid(payee)) throw new Error("繳費單位篩選值錯誤");
    f.payee = payee;
  }
  return f;
}

// ---------------------------------------------------------------- 遮蔽（第二道保險；資料庫函式已遮蔽）
export function maskUtilityRequest<T extends Record<string, any>>(row: T, billsVisible: boolean): T {
  if (billsVisible || !isUtilityRequest(row)) return row;
  const { bill_lines: _drop, ...rest } = row as Record<string, any>;
  return { ...rest, bills_masked: true } as unknown as T;
}

// ---------------------------------------------------------------- 對帳 CSV（來源＝水電話費；欄位與採購不同，所以分開匯出）
export type UtilityExportRow = Record<string, any>;
const taipeiDate = (iso: unknown) => {
  if (!iso) return "";
  const d = new Date(new Date(String(iso)).getTime() + 8 * 3600_000);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};
const taipeiTime = (iso: unknown) => {
  if (!iso) return "";
  const d = new Date(new Date(String(iso)).getTime() + 8 * 3600_000);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().replace("T", " ").slice(0, 16);
};
export function utilityExportColumns(includeVendorSecret: boolean): CsvColumn<UtilityExportRow>[] {
  const cols: CsvColumn<UtilityExportRow>[] = [
    { header: "請款單號", value: (r) => r.pr_no },
    { header: "狀態", value: (r) => PR_STATUS_LABELS[r.status as PrStatus] ?? r.status },
    { header: "繳費單位", value: (r) => r.vendor_name },
  ];
  if (includeVendorSecret) cols.push({ header: "統編", value: (r) => r.vendor_tax_id, asText: true });
  cols.push(
    { header: "帳單月份", value: (r) => String(r.bill_month ?? "").slice(0, 7) },
    { header: "門市", value: (r) => r.location_name },
    { header: "費用類型", value: (r) => (r.expense_type ? EXPENSE_TYPE_LABELS[r.expense_type as ExpenseType] ?? r.expense_type : "") },
    { header: "電號／水號／用戶號碼", value: (r) => r.identifier, asText: true },
    { header: "帳單金額", value: (r) => (r.amount_total == null ? "" : Number(r.amount_total)) },
    { header: "付款日期", value: (r) => r.paid_date ?? "" },
    { header: "付款方式", value: (r) => (r.pay_method ? PAY_METHOD_LABELS[r.pay_method as PayMethod] ?? r.pay_method : "") },
    { header: "付款參考號", value: (r) => r.paid_ref },
    { header: "總務請款人", value: (r) => r.submitted_by_name },
    { header: "請款時間", value: (r) => taipeiTime(r.submitted_at) },
    { header: "付款人", value: (r) => r.paid_by_name },
    { header: "付款時間", value: (r) => taipeiTime(r.paid_at) },
    { header: "送出後自動標記已繳", value: (r) => (r.auto_mark_paid ? "是" : "否") },
  );
  return cols;
}
export const buildUtilityExportCsv = (rows: UtilityExportRow[], includeVendorSecret: boolean) => buildCsv(rows, utilityExportColumns(includeVendorSecret));
export const utilityExportFileName = (month: string) => `水電話費請款對帳-${month}.csv`;
export const exportMonthOk = (m: string) => MONTH_RE.test(m);
export { csvCell };

// ---------------------------------------------------------------- 列印明細欄位（U3）：門市、費用類型、帳單月份、電號／水號／用戶號碼、金額
export const UTILITY_PRINT_HEADERS = ["門市", "費用類型", "帳單月份", "電號／水號／用戶號碼", "金額"] as const;
export type PrintBillLine = { location_name?: string | null; expense_type?: string | null; billing_month?: string | null; identifier?: string | null; claim_total?: number | string | null };
export function utilityPrintRow(l: PrintBillLine): string[] {
  return [
    String(l.location_name ?? ""),
    EXPENSE_TYPE_LABELS[l.expense_type as ExpenseType] ?? String(l.expense_type ?? ""),
    String(l.billing_month ?? "").slice(0, 7),
    String(l.identifier ?? ""),
    String(Math.round(Number(l.claim_total) || 0)),
  ];
}
/** 識別號碼欄位的白話名稱（依費用類型）。 */
export const identifierHeader = (type: string) => identifierLabel(type);

// ---------------------------------------------------------------- 錯誤白話（伺服端訊息已是白話，這裡補「下一步怎麼做」）
export const UTILITY_ERROR_HINTS: Record<string, string> = {
  BILL_MISSING_ATTACHMENT: "請先到水電帳單上傳帳單照片或 PDF，再回來送出",
  BILL_CHANGED: "按「重新帶入」更新請款金額後再送出",
  BILL_IN_REQUEST: "請先請款單退回或作廢，再修改帳單",
  BILL_NO_PAYEE: "到水電帳單頁用「補填繳費單位」指定後再請款",
  NO_BILLS: "確認該單位、該月份的帳單已建立並指定繳費單位",
  PAYEE_NOT_UTILITY: "請到廠商資料為這家廠商加上「公用事業」分類",
  SOURCE_MISMATCH: "這張請款單的來源不同，請從正確的畫面操作",
};
export function utilityErrorMessage(code: string, message: string): string {
  const hint = UTILITY_ERROR_HINTS[code];
  if (!hint || message.includes(hint)) return message;
  return `${message}。${hint}`;
}
