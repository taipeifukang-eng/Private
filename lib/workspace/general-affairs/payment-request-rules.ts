// M7/M8 第 4.5 批 請款單規則（純函式，無資料庫相依；API、Vue 頁面與單元測試共用）。
// 與資料庫函式 ga_ws_pay_request_*、ga_pay_apply_lines 逐條對齊：狀態機（沒有核准關卡，P3）、累計請款上限與尾差、請款單號格式、付款輸入驗證、
// 對帳 CSV（UTF-8 含 BOM、公式注入防護、5000 筆上限）、帳務機密遮蔽。資料庫是最後一道防線，這裡讓 API 先擋明顯錯誤、畫面與測試用同一套說法。
import { isUuid } from "./rules";
import { DEFAULT_TOLERANCE, isRealDate, overClaim, taipeiToday, withinTolerance } from "./payment-rules";

// ---------------------------------------------------------------- 狀態機
export const PR_STATUSES = ["DRAFT", "SUBMITTED", "PAID", "VOID"] as const;
export type PrStatus = (typeof PR_STATUSES)[number];
export const PR_STATUS_LABELS: Record<PrStatus, string> = { DRAFT: "草稿", SUBMITTED: "已送出", PAID: "已付款", VOID: "已作廢" };
export const isPrStatus = (v: unknown): v is PrStatus => (PR_STATUSES as readonly string[]).includes(String(v));

// G46 請款單來源：採購（既有）或水電話費（水電網費帳單請款）。沒有來源的舊資料一律是採購。細節規則在 utility-payment-rules.ts。
export const PR_SOURCES = ["PURCHASE", "UTILITY"] as const;
export type PrSource = (typeof PR_SOURCES)[number];
export const PR_SOURCE_LABELS: Record<PrSource, string> = { PURCHASE: "採購", UTILITY: "水電話費" };

export const PR_ACTIONS = ["submit", "return", "mark_paid", "void", "note", "refresh_bank"] as const;
export type PrAction = (typeof PR_ACTIONS)[number];
export const isPrAction = (v: unknown): v is PrAction => (PR_ACTIONS as readonly string[]).includes(String(v));
export const PR_ACTION_LABELS: Record<PrAction, string> = {
  submit: "送出", return: "退回草稿", mark_paid: "標記已付款", void: "作廢", note: "加備註", refresh_bank: "重抓廠商帳號",
};

/** 各動作允許的起始狀態。note 在草稿、已送出、已付款都可以（已付款鎖定，只能備註與作廢）；已作廢什麼都不能做。 */
const ACTION_FROM: Record<PrAction, readonly PrStatus[]> = {
  submit: ["DRAFT"],
  return: ["SUBMITTED"],
  mark_paid: ["SUBMITTED"],
  void: ["DRAFT", "SUBMITTED", "PAID"],
  note: ["DRAFT", "SUBMITTED", "PAID"],
  refresh_bank: ["DRAFT"],
};
/** 動作成功後的狀態（note、refresh_bank 狀態不變）。 */
export function nextStatus(from: PrStatus, action: PrAction): PrStatus | null {
  if (!ACTION_FROM[action].includes(from)) return null;
  switch (action) {
    case "submit": return "SUBMITTED";
    case "return": return "DRAFT";
    case "mark_paid": return "PAID";
    case "void": return "VOID";
    default: return from;
  }
}
export const canTransition = (from: PrStatus, action: PrAction) => nextStatus(from, action) !== null;
/** 內容（明細、預計付款日）只有草稿可改；已送出要先退回，已付款鎖定。 */
export const isEditable = (s: PrStatus) => s === "DRAFT";
export const isLocked = (s: PrStatus) => s === "PAID" || s === "VOID";
/** 作廢時必填原因：已送出與已付款（草稿可不填）。 */
export const voidReasonRequired = (s: PrStatus) => s === "SUBMITTED" || s === "PAID";
/** 佔用請款額度的狀態（作廢釋放額度）。 */
export const holdsQuota = (s: PrStatus) => s !== "VOID";

/** 依狀態與權限列出畫面上可按的動作；沒有管理權限一律沒有動作。申請人可自己標已付款（P4）。 */
export function availableActions(status: PrStatus, canManage: boolean): PrAction[] {
  if (!canManage) return [];
  return PR_ACTIONS.filter((a) => canTransition(status, a));
}

// ---------------------------------------------------------------- 請款單號
export const PR_NO_RE = /^PY-\d{8}-\d{3,}$/;
export const isPrNo = (v: unknown) => PR_NO_RE.test(String(v ?? ""));
/** 請款單號：PY-YYYYMMDD-NNN（台北日期流水，三位數不足補零，超過 999 照實際位數）。 */
export function formatPrNo(day: string, seq: number) {
  return `PY-${day.replace(/-/g, "")}-${seq < 1000 ? String(seq).padStart(3, "0") : String(seq)}`;
}

// ---------------------------------------------------------------- 累計請款上限
/**
 * 累計請款（不含作廢）不得超過累計驗入含稅額加尾差；超過直接擋，不能靠填原因過關。短收以累計驗入計（拒收部分不能請）。
 * @returns ok：可以請；remaining：目前還能再請的最大金額（含尾差，不低於 0）
 */
export function checkClaimLimit(receivedTotal: number, claimedBefore: number, thisClaim: number, tolerance: number = DEFAULT_TOLERANCE) {
  const over = overClaim(claimedBefore + thisClaim, receivedTotal, tolerance);
  return { ok: !over, remaining: Math.max(receivedTotal + tolerance - claimedBefore, 0), overBy: over ? claimedBefore + thisClaim - (receivedTotal + tolerance) : 0 };
}
/** 請款額與發票分攤額（或進貨單含稅額）相差超過尾差要填差異原因（仍可送出）；5 元內免原因。 */
export const lineDiffReasonRequired = (claimTotal: number, referenceTotal: number, tolerance: number = DEFAULT_TOLERANCE) => !withinTolerance(claimTotal - referenceTotal, tolerance);

// ---------------------------------------------------------------- 輸入驗證
// G4：付款方式加信用卡（可填卡號末四碼）與網購平台／第三方支付（可填平台名稱）。同仁代墊只能用轉帳、現金、支票（公司還錢給同仁）。
export const PAY_METHODS = ["TRANSFER", "CASH", "CHECK", "CREDIT_CARD", "ONLINE_PLATFORM"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];
export const PAY_METHOD_LABELS: Record<PayMethod, string> = { TRANSFER: "轉帳", CASH: "現金", CHECK: "支票", CREDIT_CARD: "信用卡", ONLINE_PLATFORM: "網購平台／第三方支付" };
export const isPayMethod = (v: unknown): v is PayMethod => (PAY_METHODS as readonly string[]).includes(String(v));
export const PAYEE_PAY_METHODS = ["TRANSFER", "CASH", "CHECK"] as const;
export const payMethodAllowed = (method: string, payeeType: string | null | undefined) => (payeeType === "EMPLOYEE" ? (PAYEE_PAY_METHODS as readonly string[]).includes(method) : isPayMethod(method));

// G4：付款對象（廠商或同仁代墊）。廠商仍記在請款單與採購單上；代墊時付款對象是同仁，帳戶走同仁匯款帳戶。
export const PAYEE_TYPES = ["VENDOR", "EMPLOYEE"] as const;
export type PayeeType = (typeof PAYEE_TYPES)[number];
export const PAYEE_TYPE_LABELS: Record<PayeeType, string> = { VENDOR: "廠商", EMPLOYEE: "同仁代墊" };
export const isPayeeType = (v: unknown): v is PayeeType => (PAYEE_TYPES as readonly string[]).includes(String(v));
/** 標已付款的人不可以就是代墊的付款對象本人（SELF_PAYEE，與資料庫觸發器一致）；一般請款單沒有這個限制（P4）。 */
export const selfPayeeBlocked = (row: { payee_type?: string | null; payee_profile_id?: string | null }, userId: string) => row.payee_type === "EMPLOYEE" && !!row.payee_profile_id && row.payee_profile_id === userId;

// G1：請款單類型。預付款對應一張已下訂的採購單，沒有進貨明細；餘額由預付餘額帳（核銷、退款）計算。
export const PR_KINDS = ["NORMAL", "PREPAY"] as const;
export type PrKind = (typeof PR_KINDS)[number];
export const PR_KIND_LABELS: Record<PrKind, string> = { NORMAL: "一般請款", PREPAY: "預付款" };
export const isPrKind = (v: unknown): v is PrKind => (PR_KINDS as readonly string[]).includes(String(v));

const text = (v: unknown, max: number, label: string, required = false) => {
  const s = String(v ?? "").trim();
  if (!s) {
    if (required) throw new Error(`請填寫${label}`);
    return null;
  }
  if (s.length > max) throw new Error(`${label}不可超過 ${max} 個字`);
  return s;
};
const moneyInt = (v: unknown, label: string) => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999) throw new Error(`${label}必須是 0 以上的整數`);
  return n;
};

export type PrLineInput = { receipt_id: string; invoice_id?: string | null; claim_untaxed?: number; claim_tax?: number; diff_reason?: string | null };
export function validateLines(raw: unknown): PrLineInput[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("請至少選擇一筆進貨來請款");
  if (raw.length > 100) throw new Error("一張請款單最多 100 筆明細");
  return raw.map((l, i) => {
    if (!l || typeof l !== "object") throw new Error(`第 ${i + 1} 筆明細格式錯誤`);
    const o = l as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      if (!["receipt_id", "invoice_id", "claim_untaxed", "claim_tax", "diff_reason"].includes(k)) throw new Error(`不支援的明細欄位：${k}`);
    }
    if (!isUuid(String(o.receipt_id ?? ""))) throw new Error(`第 ${i + 1} 筆明細的進貨單格式錯誤`);
    const inv = String(o.invoice_id ?? "").trim();
    if (inv && !isUuid(inv)) throw new Error(`第 ${i + 1} 筆明細的發票格式錯誤`);
    const out: PrLineInput = { receipt_id: String(o.receipt_id), invoice_id: inv || null, diff_reason: text(o.diff_reason, 200, "差異原因") };
    const u = moneyInt(o.claim_untaxed, "請款未稅金額");
    const t = moneyInt(o.claim_tax, "請款稅額");
    if (u !== undefined) out.claim_untaxed = u;
    if (t !== undefined) out.claim_tax = t;
    return out;
  });
}

/** G4／G11：付款對象與買受人公司欄位（採購、水電、預付請款單共用）。payee_type 沒帶但有 payee_profile_id 視為同仁代墊；改回廠商用 payee_type=VENDOR。 */
export const PAYEE_BUYER_KEYS = ["payee_type", "payee_profile_id", "buyer_company_id"] as const;
export function pickPayeeBuyer(raw: Record<string, any>) {
  const out: Record<string, unknown> = {};
  if ("payee_type" in raw || "payee_profile_id" in raw) {
    const pid = String(raw.payee_profile_id ?? "").trim();
    const type = String(raw.payee_type ?? (pid ? "EMPLOYEE" : "VENDOR")).trim().toUpperCase();
    if (!isPayeeType(type)) throw new Error("付款對象只能是廠商或同仁代墊");
    if (type === "EMPLOYEE") {
      if (!isUuid(pid)) throw new Error("請選擇代墊的同仁");
      out.payee_type = "EMPLOYEE";
      out.payee_profile_id = pid;
    } else {
      if (pid) throw new Error("廠商付款不能指定同仁");
      out.payee_type = "VENDOR";
    }
  }
  if ("buyer_company_id" in raw) {
    const b = String(raw.buyer_company_id ?? "").trim();
    if (b && !isUuid(b)) throw new Error("買受人抬頭格式錯誤");
    out.buyer_company_id = b || null;
  }
  return out;
}

export function validateCreatePayload(raw: Record<string, any>, now: Date = new Date()) {
  for (const k of Object.keys(raw)) if (!["vendor_id", "expected_pay_date", "notes", "lines", ...PAYEE_BUYER_KEYS].includes(k)) throw new Error(`不支援的欄位：${k}`);
  if (!isUuid(String(raw.vendor_id ?? ""))) throw new Error("請選擇廠商");
  return { vendor_id: String(raw.vendor_id), expected_pay_date: expectedPayDate(raw.expected_pay_date, now), notes: text(raw.notes, 500, "備註"), lines: validateLines(raw.lines), ...pickPayeeBuyer(raw) };
}
export function validateUpdatePayload(raw: Record<string, any>, now: Date = new Date()) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) if (!["expected_pay_date", "notes", "lines", "amount", ...PAYEE_BUYER_KEYS].includes(k)) throw new Error(`不支援的欄位：${k}`);
  if ("expected_pay_date" in raw) out.expected_pay_date = expectedPayDate(raw.expected_pay_date, now);
  if ("notes" in raw) out.notes = text(raw.notes, 500, "備註");
  if ("lines" in raw) out.lines = validateLines(raw.lines);
  if ("amount" in raw) out.amount = prepayAmount(raw.amount);
  Object.assign(out, pickPayeeBuyer(raw));
  if (!Object.keys(out).length) throw new Error("沒有要修改的內容");
  return out;
}
function expectedPayDate(v: unknown, _now: Date) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!isRealDate(s)) throw new Error("預計付款日格式錯誤（YYYY-MM-DD）");
  return s;
}

/** 動作 payload 驗證：return、void 原因；mark_paid 付款方式、日期（不可未來）、參考號；note 備註。 */
export function validateActionPayload(action: PrAction, status: PrStatus | null, raw: Record<string, any>, now: Date = new Date(), opts: { payeeType?: string | null } = {}) {
  switch (action) {
    case "return":
      return { reason: text(raw.reason, 200, "退回原因", true) };
    case "void": {
      const reason = text(raw.reason, 200, "作廢原因", status ? voidReasonRequired(status) : false);
      return { reason };
    }
    case "mark_paid": {
      const method = String(raw.pay_method ?? "").trim().toUpperCase();
      if (!isPayMethod(method)) throw new Error("付款方式只能是轉帳、現金、支票、信用卡或網購平台／第三方支付");
      if (!payMethodAllowed(method, opts.payeeType)) throw new Error("同仁代墊的款項只能用轉帳、現金或支票還給同仁");
      const card = String(raw.card_last4 ?? "").trim();
      const platform = String(raw.platform ?? "").trim();
      if (card && method !== "CREDIT_CARD") throw new Error("只有信用卡付款可以填卡號末四碼");
      if (platform && method !== "ONLINE_PLATFORM") throw new Error("只有網購平台／第三方支付可以填平台名稱");
      if (card && !/^[0-9]{4}$/.test(card)) throw new Error("卡號末四碼要是 4 位數字（不要填完整卡號）");
      if (platform.length > 40) throw new Error("平台名稱不可超過 40 個字");
      const paid = String(raw.paid_date ?? "").trim();
      if (paid) {
        if (!isRealDate(paid)) throw new Error("付款日期格式錯誤（YYYY-MM-DD）");
        if (paid > taipeiToday(now)) throw new Error(`付款日期不能是未來的日期（今天是 ${taipeiToday(now)}）`);
      }
      return { pay_method: method, paid_date: paid || null, paid_ref: text(raw.paid_ref, 60, "付款參考號"), ...(card ? { card_last4: card } : {}), ...(platform ? { platform } : {}) };
    }
    case "note":
      return { note: text(raw.note, 500, "備註內容", true) };
    default:
      return {};
  }
}

// ---------------------------------------------------------------- 篩選
export function parseRequestFilters(p: URLSearchParams) {
  const f: Record<string, unknown> = {};
  const status = (p.get("status") || "").trim().toUpperCase();
  if (status) {
    if (!isPrStatus(status)) throw new Error("狀態篩選值錯誤");
    f.status = status;
  }
  const vendor = (p.get("vendorId") || "").trim();
  if (vendor) {
    if (!isUuid(vendor)) throw new Error("廠商篩選格式錯誤");
    f.vendor_id = vendor;
  }
  const po = (p.get("poId") || "").trim();
  if (po) {
    if (!isUuid(po)) throw new Error("採購單篩選格式錯誤");
    f.po_id = po;
  }
  const month = (p.get("month") || "").trim();
  if (month) {
    if (!MONTH_RE.test(month)) throw new Error("月份格式要是 YYYY-MM");
    f.month = month;
  }
  const source = (p.get("source") || "").trim().toUpperCase();
  if (source) {
    if (!(PR_SOURCES as readonly string[]).includes(source)) throw new Error("來源篩選值錯誤（採購或水電話費）");
    f.source = source;
  }
  const payee = (p.get("payeeType") || p.get("payee_type") || "").trim().toUpperCase();
  if (payee) {
    if (!isPayeeType(payee)) throw new Error("付款對象篩選值錯誤（廠商或同仁代墊）");
    f.payee_type = payee;
  }
  const kind = (p.get("payKind") || p.get("pay_kind") || "").trim().toUpperCase();
  if (kind) {
    if (!isPrKind(kind)) throw new Error("類型篩選值錯誤（一般請款或預付款）");
    f.pay_kind = kind;
  }
  if (["1", "true"].includes((p.get("prepayOverdue") || p.get("prepay_overdue") || "").trim())) f.prepay_overdue = true;
  if (["1", "true"].includes((p.get("mine") || "").trim())) f.mine = true;
  if (["1", "true"].includes((p.get("stale_draft") || p.get("staleDraft") || "").trim())) f.stale_draft = true;
  const q = (p.get("q") || "").trim().slice(0, 100);
  if (q) f.search = q;
  return f;
}
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 草稿逾期天數（F7）：草稿超過這麼多天沒送出就出現在首頁待辦（與資料庫 ga_pay_stale_draft_ids 一致）。 */
export const STALE_DRAFT_DAYS = 14;
/** 付款日期最多可比請款單建立日早幾天（F3，與資料庫 mark_paid 一致）。 */
export const PAID_BACKDATE_DAYS = 30;

/** 付款日期檢查（畫面與測試用）：回傳白話問題；沒問題回 null。範圍：建立日往前 30 天到今天（台北）。 */
export function paidDateProblem(paid: string, createdDay: string, today: string): string | null {
  if (!paid) return null;
  if (!isRealDate(paid)) return "付款日期格式錯誤（YYYY-MM-DD）";
  if (paid > today) return `付款日期不能是未來的日期（今天是 ${today}）`;
  const { min } = paidDateRange(createdDay, today);
  if (paid < min) return `付款日期不能比請款單建立日（${createdDay}）早超過 ${PAID_BACKDATE_DAYS} 天，最早可填 ${min}`;
  return null;
}

/** 請款相關錯誤的畫面文字：伺服端訊息已是白話，這裡替幾個新規則補上「下一步怎麼做」。 */
export function payErrorMessage(code: string, message: string): string {
  switch (code) {
    case "OVER_PO_TOTAL": return `${message}。請減少這張請款單的金額，或先作廢同一張採購單上不需要的請款單。`;
    case "DIFF_REASON_REQUIRED": return `${message}（請款額與發票分攤金額的差距超過目前尾差，可能是尾差設定被調低，或發票分攤金額在存成草稿後有變動；請在草稿填寫差異原因後再送出）`;
    case "PAID_TOO_EARLY": return message;
    default: return message;
  }
}

// ---------------------------------------------------------------- 對帳匯出狀態（F2）
/** 預設只匯出已送出與已付款；草稿、已作廢要另外勾選。 */
export const EXPORT_DEFAULT_STATUSES: readonly PrStatus[] = ["SUBMITTED", "PAID"];
/**
 * 解析匯出要包含的狀態：明確的 status（單一）優先；否則預設已送出＋已付款，includeDraft／includeVoid 為 1 或 true 時加入。
 * 回傳順序固定（草稿、已送出、已付款、已作廢）。
 */
export function parseExportStatuses(p: URLSearchParams): PrStatus[] {
  const single = (p.get("status") || "").trim().toUpperCase();
  if (single) {
    if (!isPrStatus(single)) throw new Error("狀態篩選值錯誤");
    return [single];
  }
  const on = (k: string) => ["1", "true"].includes((p.get(k) || "").trim());
  const set = new Set<PrStatus>(EXPORT_DEFAULT_STATUSES);
  if (on("includeDraft")) set.add("DRAFT");
  if (on("includeVoid")) set.add("VOID");
  return PR_STATUSES.filter((s) => set.has(s));
}

/** 付款日期可填範圍（F3）：建立日（台北）往前 30 天到今天（台北）。 */
export function paidDateRange(createdDay: string, today: string): { min: string; max: string } {
  const d = new Date(`${createdDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - PAID_BACKDATE_DAYS);
  return { min: d.toISOString().slice(0, 10), max: today };
}

// ---------------------------------------------------------------- 設定
/** 尾差 0 至 100 的整數；買受人抬頭 ≤ 100 字；買受人統編 8 碼數字（可清空）。 */
export function validateSettings(raw: Record<string, any>) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(raw)) if (!["tolerance_amount", "buyer_title", "buyer_tax_id"].includes(k)) throw new Error(`不支援的設定：${k}`);
  if ("tolerance_amount" in raw) {
    const s = String(raw.tolerance_amount ?? "").trim();
    if (!/^[0-9]{1,4}$/.test(s) || Number(s) > 100) throw new Error("尾差金額必須是 0 到 100 的整數（元）");
    out.tolerance_amount = Number(s);
  }
  if ("buyer_title" in raw) out.buyer_title = text(raw.buyer_title, 100, "買受人抬頭");
  if ("buyer_tax_id" in raw) {
    const s = text(raw.buyer_tax_id, 20, "買受人統一編號");
    if (s !== null && !/^[0-9]{8}$/.test(s)) throw new Error("買受人統一編號要是 8 碼數字");
    out.buyer_tax_id = s;
  }
  if (!Object.keys(out).length) throw new Error("沒有要修改的設定");
  return out;
}

// ---------------------------------------------------------------- 對帳 CSV
export const EXPORT_MAX_ROWS = 5000;
/** asText：這欄是「長得像數字的文字」（統編、銀行帳號），試算表會掉前導 0 或變科學記號，要輸出成文字格式。 */
export type CsvColumn<T> = { header: string; value: (row: T) => unknown; asText?: boolean };

/** 試算表會把 = + - @ 開頭的儲存格當公式；字串前補單引號擋掉（數字不處理）。含逗號、引號、換行的欄位加雙引號。 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** 只含數字與連字號的文字（統編、帳號）輸出成 ="…"，試算表開啟時當文字、保留前導 0；內容只有數字與連字號，沒有公式注入的空間。其他內容照一般欄位處理。 */
export function csvTextCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value).trim();
  if (/^[0-9][0-9-]*$/.test(s)) return `"=""${s}"""`;
  return csvCell(value);
}
export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => (c.asText ? csvTextCell(c.value(r)) : csvCell(c.value(r)))).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
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
export type ExportRow = Record<string, any>;
/** 對帳欄位：廠商統編與銀行欄位只有 includeVendorSecret 才輸出（沒有廠商檢視權限者整欄省略，而不是留空欄）。 */
export function exportColumns(includeVendorSecret: boolean, extended = false): CsvColumn<ExportRow>[] {
  const cols: CsvColumn<ExportRow>[] = [
    { header: "請款單號", value: (r) => r.pr_no },
    { header: "狀態", value: (r) => PR_STATUS_LABELS[r.status as PrStatus] ?? r.status },
    { header: "建立日期", value: (r) => taipeiDate(r.created_at) },
    { header: "廠商", value: (r) => r.vendor_name },
  ];
  if (includeVendorSecret) cols.push({ header: "廠商統編", value: (r) => r.vendor_tax_id, asText: true }, { header: "銀行", value: (r) => r.bank_name }, { header: "帳號", value: (r) => r.bank_account, asText: true });
  cols.push(
    { header: "採購單號", value: (r) => r.po_no },
    { header: "進貨單號", value: (r) => r.receipt_no },
    { header: "發票號碼", value: (r) => r.invoice_no },
    { header: "未稅金額", value: (r) => (r.amount_untaxed == null ? "" : Number(r.amount_untaxed)) },
    { header: "稅額", value: (r) => (r.tax_amount == null ? "" : Number(r.tax_amount)) },
    { header: "請款金額", value: (r) => (r.claim_total == null ? "" : Number(r.claim_total)) },
    { header: "付款日期", value: (r) => r.paid_date ?? "" },
    { header: "付款方式", value: (r) => (r.pay_method ? PAY_METHOD_LABELS[r.pay_method as PayMethod] ?? r.pay_method : "") },
    { header: "付款參考號", value: (r) => r.paid_ref },
    { header: "總務請款人", value: (r) => r.submitted_by_name },
    { header: "請款時間", value: (r) => taipeiTime(r.submitted_at) },
    { header: "付款人", value: (r) => r.paid_by_name },
    { header: "付款時間", value: (r) => taipeiTime(r.paid_at) },
  );
  // G1／G4／G11：extended（匯出按鈕帶 extended=1）才追加欄位；預設欄位與順序完全不動。同仁帳戶欄位沒有廠商帳務檢視權限整欄省略。
  if (extended) {
    cols.push(
      { header: "類型", value: (r) => PR_KIND_LABELS[r.pay_kind as PrKind] ?? "一般請款" },
      { header: "付款對象類型", value: (r) => PAYEE_TYPE_LABELS[r.payee_type as PayeeType] ?? "廠商" },
      { header: "付款對象", value: (r) => r.payee_name ?? r.vendor_name },
      { header: "抬頭", value: (r) => r.buyer_title },
      { header: "信用卡末四碼", value: (r) => r.card_last4, asText: true },
      { header: "平台", value: (r) => r.platform },
    );
    if (includeVendorSecret) cols.push({ header: "同仁銀行", value: (r) => r.payee_bank_name }, { header: "同仁帳號", value: (r) => r.payee_bank_account, asText: true });
  }
  return cols;
}
export function buildExportCsv(rows: ExportRow[], includeVendorSecret: boolean, extended = false) {
  return buildCsv(rows, exportColumns(includeVendorSecret, extended));
}
export const exportFileName = (month: string) => `請款對帳-${month}.csv`;

// ---------------------------------------------------------------- 機密遮蔽（第二道保險；資料庫函式已遮蔽）
export function maskRequest<T extends Record<string, any>>(row: T, vendorVisible: boolean, viewerId?: string | null): T {
  if (vendorVisible) return row;
  // G4：同仁帳戶只有廠商帳務檢視者與同仁本人看得到；其餘只露末四碼（資料庫已遮蔽，這裡是第二道保險）。
  const ownAccount = !!viewerId && row.payee_type === "EMPLOYEE" && row.payee_profile_id === viewerId;
  const base = { ...row, vendor_tax_id_snapshot: null, bank_snapshot: {}, vendor_masked: true } as Record<string, any>;
  if (row.payee_type === "EMPLOYEE" && !ownAccount) {
    const last4 = row.payee_account_last4 ?? lastDigits(row.payee_account_snapshot?.bank_account, 4);
    return { ...base, payee_account_snapshot: {}, payee_account_masked: true, payee_account_last4: last4 } as unknown as T;
  }
  return base as T;
}
const lastDigits = (v: unknown, n: number): string | null => {
  const d = String(v ?? "").replace(/[^0-9]/g, "");
  return d ? d.slice(-n) : null;
};

// ---------------------------------------------------------------- G1 預付款（純函式，與資料庫 ga_pay_prepay_*、ga_ib1_prepay_* 逐條對齊）
/** 預付金額：大於 0 的整數元（含稅額）。 */
export function prepayAmount(v: unknown): number {
  const s = String(v ?? "").trim().replace(/,/g, "");
  if (!/^[0-9]{1,9}$/.test(s) || Number(s) <= 0) throw new Error("預付金額必須是大於 0 的整數元");
  return Number(s);
}
/** 預付款拆稅：未稅＝round(含稅額÷(1＋稅率))，稅額＝含稅額－未稅（含稅額永遠等於輸入）。 */
export function prepaySplit(total: number, taxRate = 0.05) {
  const untaxed = roundHalfUp(total / (1 + taxRate));
  return { untaxed, tax: total - untaxed, total };
}
/** 上限：這張採購單的預付（不含作廢）＋一般請款（不含核銷）＋這次金額 ≤ 採購單含稅總額＋尾差，超過回 OVER_PO_TOTAL。 */
export function prepayCap(poTotal: number, claimedNormal: number, prepaid: number, add: number, tolerance: number = DEFAULT_TOLERANCE) {
  const used = claimedNormal + prepaid;
  return { ok: used + add <= poTotal + tolerance, remaining: Math.max(poTotal + tolerance - used, 0), overBy: Math.max(used + add - (poTotal + tolerance), 0) };
}
/** 預付單餘額＝送出或已付款的金額 − 未回復的核銷與退款（草稿、作廢為 0）。 */
export function prepayBalance(status: string, amountTotal: number, offsets: number, refunds: number): number {
  if (status !== "SUBMITTED" && status !== "PAID") return 0;
  return amountTotal - offsets - refunds;
}
/** 單張進貨單可核銷額＝min(進貨單含稅額 − 有效請款 − 已核銷, 預付餘額)，不為負。 */
export function prepayOffsetFor(receiptTotal: number, claimedAndOffset: number, balance: number): number {
  return Math.max(Math.min(receiptTotal - claimedAndOffset, balance), 0);
}
export type PrepayReceipt = { id: string; total: number; claimed: number; offset: number };
export type PrepaySource = { id: string; balance: number };
/** 核銷順序（與資料庫 ga_pay_prepay_apply 相同）：進貨單依順序、預付單依建立先後逐張核銷；回傳要新增的核銷列。 */
export function prepayApply(receipts: PrepayReceipt[], prepays: PrepaySource[]): { receipt_id: string; prepay_id: string; amount: number }[] {
  const bal = new Map(prepays.map((p) => [p.id, p.balance]));
  const out: { receipt_id: string; prepay_id: string; amount: number }[] = [];
  for (const r of receipts) {
    let remain = r.total - r.claimed - r.offset;
    if (remain <= 0) continue;
    for (const p of prepays) {
      if (remain <= 0) break;
      const b = bal.get(p.id) ?? 0;
      if (b <= 0) continue;
      const take = Math.min(remain, b);
      out.push({ receipt_id: r.id, prepay_id: p.id, amount: take });
      bal.set(p.id, b - take);
      remain -= take;
    }
  }
  return out;
}
/** 一般請款預設金額扣核銷：含稅額＝進貨單含稅額 − 核銷；稅額＝含稅額 − round(含稅額÷(1＋稅率))。扣完為 0 以下代表已由預付款核銷、免再請款（PREPAY_COVERED）。 */
export function claimAfterOffset(receiptTotal: number, offset: number, taxRate = 0.05) {
  const total = receiptTotal - offset;
  if (offset <= 0) return null;
  const untaxed = Math.max(roundHalfUp(total / (1 + taxRate)), 0);
  return { covered: total <= 0, untaxed, tax: Math.max(total, 0) - untaxed, total: Math.max(total, 0) };
}
/** 逾期：採購單已下訂（ORDERED／PARTIALLY_RECEIVED）、預計到貨日早於今天（台北）、預付餘額大於 0。 */
export function prepayOverdue(po: { status: string; expected_delivery_date?: string | null }, balance: number, today: string = taipeiToday()): { overdue: boolean; days: number } {
  const open = po.status === "ORDERED" || po.status === "PARTIALLY_RECEIVED";
  const d = po.expected_delivery_date;
  if (!open || !d || !(d < today) || !(balance > 0)) return { overdue: false, days: 0 };
  return { overdue: true, days: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000) };
}
/** 結案守門：採購單取消、短收結案、結案時預付餘額大於尾差就擋（PREPAY_BALANCE_OPEN）。 */
export const prepayBlocksClose = (balance: number, tolerance: number = DEFAULT_TOLERANCE) => balance > tolerance;
const roundHalfUp = (n: number) => {
  const v = Math.round((Math.abs(n) + Number.EPSILON) * 1e6) / 1e6;
  const r = Math.floor(v + 0.5);
  return n < 0 ? -r : r;
};

export function validatePrepayCreatePayload(raw: Record<string, any>) {
  for (const k of Object.keys(raw)) if (!["po_id", "amount", "expected_pay_date", "notes", ...PAYEE_BUYER_KEYS].includes(k)) throw new Error(`不支援的欄位：${k}`);
  if (!isUuid(String(raw.po_id ?? ""))) throw new Error("請選擇採購單");
  return { po_id: String(raw.po_id), amount: prepayAmount(raw.amount), expected_pay_date: expectedPayDate(raw.expected_pay_date, new Date()), notes: text(raw.notes, 500, "備註"), ...pickPayeeBuyer(raw) };
}
/** 登記退款或轉抵：金額為大於 0 的整數元，原因必填（≤ 200 字）。 */
export function validatePrepaySettlePayload(raw: Record<string, any>) {
  for (const k of Object.keys(raw)) if (!["amount", "reason", "expected_updated_at", "idempotency_key"].includes(k)) throw new Error(`不支援的欄位：${k}`);
  const s = String(raw.amount ?? "").trim().replace(/,/g, "");
  if (!/^[0-9]{1,9}$/.test(s) || Number(s) <= 0) throw new Error("退款金額必須是大於 0 的整數元");
  return { amount: Number(s), reason: text(raw.reason, 200, "退款或轉抵的說明", true) as string };
}
