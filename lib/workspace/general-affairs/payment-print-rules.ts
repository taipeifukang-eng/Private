// 請款單紙本格式列印：把請款單資料整理成紙本表格（純函式，頁面與單元測試共用，不連資料庫、不讀環境）。
// 規則（老闆 2026-11-26 問卷決定）：
//   抬頭＝買受人公司（沒選＝預設公司，再沒有就用 DEFAULT_COMPANY_TITLE）；副標「請款單」；日期一律民國年（115/11/24、115年11月30日）。
//   申請部門、申請人：請款單上存的值優先，沒有就帶建立人的部門與姓名；檢附單據：水電預設「繳費單」、採購預設「發票」。
//   水電請款：同一門市的多張帳單合併一列、金額加總，申請事由＝「帳單月份（民國）＋費用類型」，合併後加「（共 N 個電號）」；使用單位＝門市簡稱，帳單有備註就用括號接在後面。
//   採購請款：同一採購單一列，申請事由＝採購單號＋品名摘要，內部訂單＝採購單號，金額＝未稅。
//   請款單上若有「申請事由覆寫」，每一列都用它（不加後綴）。
//   至少 7 列，不足補空白列；「5% 營業稅」列水電印 0、採購印實際稅額；合計＝請款單實際應付總額。
//   付款方式依系統付款方式打勾；到期日＝預計付款日，沒填取所含帳單最早繳費期限。付款對象＝廠商名稱，同仁代墊印同仁姓名。
import { EXPENSE_TYPE_LABELS, type ExpenseType } from "./utility-bill-rules";

export const MIN_ROWS = 7;
export const DEFAULT_COMPANY_TITLE = "富康活力醫藥股份有限公司";
export const PRINT_FIELD_LIMITS = { applicant_name: 50, applicant_dept: 50, attach_docs: 100, reason_override: 200 } as const;
export type PrintFieldKey = keyof typeof PRINT_FIELD_LIMITS;
export const PRINT_FIELD_LABELS: Record<PrintFieldKey, string> = { applicant_name: "申請人", applicant_dept: "申請部門", attach_docs: "檢附單據", reason_override: "申請事由" };
export const SIGN_ROWS: ReadonlyArray<ReadonlyArray<string>> = [
  ["董事長", "副董事長", "總經理/長級高階主管"],
  ["事業群主管"],
  ["部門主管", "直屬主管", "財會部"],
];
export const SIGN_NOTE = "註：依核決權限簽核完成再交由財會部入帳。";

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 'YYYY-MM-DD'（或帶時間的 ISO）的日期部分；時間戳記依台北時區換算成日期。無法解析回 null。 */
export function dayOf(v: string | null | undefined): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return /^\d{4}-\d{2}-\d{2}$/.test(parts) ? parts : null;
}
const ymd = (v: string | null | undefined) => {
  const d = dayOf(v);
  if (!d) return null;
  const [y, m, day] = d.split("-").map(Number);
  return { roc: y - 1911, m, d: day };
};
/** 民國日期 115/11/24；沒有或無法解析回空字串。 */
export function rocDate(v: string | null | undefined): string {
  const x = ymd(v);
  return x ? `${x.roc}/${pad2(x.m)}/${pad2(x.d)}` : "";
}
/** 民國日期 115年11月30日（到期日用）。 */
export function rocDateCn(v: string | null | undefined): string {
  const x = ymd(v);
  return x ? `${x.roc}年${x.m}月${x.d}日` : "";
}
/** 帳單月份（'2026-11' 或 '2026-11-01'）→「115年11月」。 */
export function rocMonthLabel(v: string | null | undefined): string {
  const s = String(v ?? "").slice(0, 7);
  const m = /^(\d{4})-(\d{2})$/.exec(s);
  return m ? `${Number(m[1]) - 1911}年${Number(m[2])}月` : "";
}

export type PayBoxes = { transfer: boolean; check: boolean; cash: boolean; other: boolean; otherText: string };
/** 付款方式打勾：TRANSFER→匯款、CHECK→支票、CASH→零用金、信用卡／網購平台→其他並寫名稱；沒設定全部空白。 */
export function payMethodBoxes(method: string | null | undefined, platform?: string | null): PayBoxes {
  const out: PayBoxes = { transfer: false, check: false, cash: false, other: false, otherText: "" };
  switch (String(method ?? "").toUpperCase()) {
    case "TRANSFER": out.transfer = true; break;
    case "CHECK": out.check = true; break;
    case "CASH": out.cash = true; break;
    case "CREDIT_CARD": out.other = true; out.otherText = "信用卡"; break;
    case "ONLINE_PLATFORM": out.other = true; out.otherText = String(platform ?? "").trim() || "網購平台"; break;
    case "": break;
    default: out.other = true; out.otherText = String(method);
  }
  return out;
}

type BillLineIn = {
  id?: string; line_no?: number; store_id?: string | null; location_name?: string | null; expense_type?: string | null; billing_month?: string | null;
  due_date?: string | null; claim_total?: number | string | null; active?: boolean | null;
};
type PurchaseLineIn = { line_no?: number; po_no?: string | null; claim_untaxed?: number | string | null; items?: Array<{ item_name?: string | null }> | null };
type ExtraIn = {
  creator?: { name?: string | null; department?: string | null } | null;
  bill_lines?: Array<{ line_id: string; store_short_name?: string | null; store_name?: string | null; notes?: string | null }> | null;
} | null;
export type PrintPr = {
  pr_no?: string | null; source?: string | null; bill_month?: string | null; expected_pay_date?: string | null; created_at?: string | null;
  applicant_name?: string | null; applicant_dept?: string | null; attach_docs?: string | null; reason_override?: string | null;
  pay_method?: string | null; pay_platform?: string | null; platform?: string | null;
  payee_type?: string | null; payee_name?: string | null; payee_name_snapshot?: string | null; vendor_name_snapshot?: string | null;
  tax_amount?: number | string | null; amount_untaxed?: number | string | null; amount_total?: number | string | null; created_by_name?: string | null;
  buyer_title_snapshot?: string | null; pay_kind?: string | null; prepay_po_no?: string | null; po_nos?: string[] | null;
  lines?: PurchaseLineIn[] | null; bill_lines?: BillLineIn[] | null; bills_masked?: boolean; bill_count?: number | null;
};
export type PaperRow = { no: number | null; unit: string; reason: string; amount: number | null; order: string };
export type PaperPrint = {
  title: string; subtitle: string; dept: string; applicant: string; attach: string; applyDate: string; register: string;
  rows: PaperRow[]; taxLabel: string; tax: number; total: number; pay: PayBoxes; dueDate: string; payee: string; prNo: string; signRows: ReadonlyArray<ReadonlyArray<string>>; signNote: string;
};

const num = (v: unknown) => Math.round(Number(v) || 0);
const clean = (v: unknown) => String(v ?? "").trim();
const firstOf = (...vs: unknown[]) => { for (const v of vs) { const s = clean(v); if (s) return s; } return ""; };

/** 到期日：請款單預計付款日；沒填取所含（有效）帳單最早的繳費期限；都沒有回空字串。回傳 ISO 日期。 */
export function dueDateOf(pr: Pick<PrintPr, "expected_pay_date" | "bill_lines">): string {
  const own = dayOf(pr.expected_pay_date);
  if (own) return own;
  const dues = (pr.bill_lines || []).filter((l) => l.active !== false).map((l) => dayOf(l.due_date)).filter((d): d is string => !!d).sort();
  return dues[0] || "";
}

export const payeeLabel = (pr: Pick<PrintPr, "payee_type" | "payee_name" | "payee_name_snapshot" | "vendor_name_snapshot">) =>
  pr.payee_type === "EMPLOYEE" ? firstOf(pr.payee_name_snapshot, pr.payee_name) : clean(pr.vendor_name_snapshot);

const identifierWord = (t: string) => (t === "ELECTRICITY" ? "電號" : t === "WATER" ? "水號" : "用戶號碼");
const expenseLabel = (t: string) => EXPENSE_TYPE_LABELS[t as ExpenseType] ?? t;
const uniq = <T,>(xs: T[]) => [...new Set(xs)];

function utilityRows(pr: PrintPr, extra: ExtraIn, override: string): PaperRow[] {
  const lines = (pr.bill_lines || []).filter((l) => l.active !== false).slice().sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0));
  const info = new Map((extra?.bill_lines || []).map((x) => [x.line_id, x]));
  const groups = new Map<string, BillLineIn[]>();
  for (const l of lines) {
    const key = l.store_id ? `s:${l.store_id}` : `n:${clean(l.location_name)}`;
    groups.set(key, [...(groups.get(key) || []), l]);
  }
  const rows: PaperRow[] = [];
  for (const g of groups.values()) {
    const first = g[0];
    const meta = first.id ? info.get(first.id) : undefined;
    const unitName = firstOf(meta?.store_short_name, meta?.store_name, first.location_name);
    const notes = uniq(g.map((l) => clean(l.id ? info.get(l.id)?.notes : "")).filter(Boolean));
    const types = uniq(g.map((l) => clean(l.expense_type)).filter(Boolean));
    const month = rocMonthLabel(first.billing_month || pr.bill_month);
    let reason: string;
    if (override) reason = override;
    else {
      reason = `${month}${types.map(expenseLabel).join("、")}`;
      if (g.length > 1) reason += types.length === 1 ? `（共 ${g.length} 個${identifierWord(types[0])}）` : `（共 ${g.length} 張帳單）`;
    }
    rows.push({ no: null, unit: notes.length ? `${unitName}（${notes.join("、")}）` : unitName, reason, amount: g.reduce((s, l) => s + num(l.claim_total), 0), order: "" });
  }
  return rows;
}

function purchaseRows(pr: PrintPr, override: string): PaperRow[] {
  const lines = (pr.lines || []).slice().sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0));
  if (!lines.length) {
    // 預付款單沒有進貨明細：一列，採購單號、預付未稅金額。
    const po = firstOf(pr.prepay_po_no, (pr.po_nos || [])[0]);
    if (pr.pay_kind === "PREPAY" || po) return [{ no: null, unit: "", reason: override || (po ? `${po} 預付款` : "預付款"), amount: num(pr.amount_untaxed), order: po }];
    return [];
  }
  const groups = new Map<string, PurchaseLineIn[]>();
  for (const l of lines) groups.set(clean(l.po_no), [...(groups.get(clean(l.po_no)) || []), l]);
  const rows: PaperRow[] = [];
  for (const [po, g] of groups) {
    const names = uniq(g.flatMap((l) => (l.items || []).map((i) => clean(i.item_name))).filter(Boolean));
    const summary = names.length ? (names.length > 2 ? `${names.slice(0, 2).join("、")}等 ${names.length} 項` : names.join("、")) : "";
    rows.push({ no: null, unit: "", reason: override || [po, summary].filter(Boolean).join(" "), amount: g.reduce((s, l) => s + num(l.claim_untaxed), 0), order: po });
  }
  return rows;
}

/** 整理成紙本請款單的內容。title 是 API 回的買受人抬頭（可能為空）。 */
export function buildPaperPrint(pr: PrintPr, extra: ExtraIn, buyerTitle?: string | null): PaperPrint {
  const utility = pr.source === "UTILITY";
  const override = clean(pr.reason_override);
  let data = utility ? utilityRows(pr, extra, override) : purchaseRows(pr, override);
  // 沒有水電檢視權限看不到帳單明細：整張合成一列，只印張數與合計，不洩漏門市與電號。
  if (utility && !data.length && pr.bills_masked) data = [{ no: null, unit: "", reason: override || `${rocMonthLabel(pr.bill_month)}水電話費（共 ${pr.bill_count ?? 0} 張帳單）`, amount: num(pr.amount_total), order: "" }];
  const rows: PaperRow[] = data.map((r, i) => ({ ...r, no: i + 1 }));
  while (rows.length < MIN_ROWS) rows.push({ no: null, unit: "", reason: "", amount: null, order: "" });
  return {
    title: firstOf(pr.buyer_title_snapshot, buyerTitle, DEFAULT_COMPANY_TITLE),
    subtitle: "請款單",
    dept: firstOf(pr.applicant_dept, extra?.creator?.department),
    applicant: firstOf(pr.applicant_name, extra?.creator?.name, pr.created_by_name),
    attach: firstOf(pr.attach_docs, utility ? "繳費單" : "發票"),
    applyDate: rocDate(pr.created_at),
    register: "",
    rows,
    taxLabel: "5% 營業稅",
    tax: utility ? 0 : num(pr.tax_amount),
    total: num(pr.amount_total),
    pay: payMethodBoxes(pr.pay_method, firstOf(pr.pay_platform, pr.platform)),
    dueDate: rocDateCn(dueDateOf(pr)),
    payee: payeeLabel(pr),
    prNo: clean(pr.pr_no),
    signRows: SIGN_ROWS,
    signNote: SIGN_NOTE,
  };
}

/** 金額欄文字：千分位；空白列回空字串。 */
export const moneyCell = (n: number | null) => (n === null ? "" : n.toLocaleString("en-US"));

/** 儲存列印欄位的內容驗證（前後端共用）：只收四個欄位，字串、去頭尾空白、空字串＝清除、超長丟錯。 */
export function validatePrintFieldsPayload(raw: Record<string, unknown>): Partial<Record<PrintFieldKey, string | null>> {
  const out: Partial<Record<PrintFieldKey, string | null>> = {};
  for (const k of Object.keys(PRINT_FIELD_LIMITS) as PrintFieldKey[]) {
    if (!(k in raw)) continue;
    const v = raw[k];
    if (v !== null && typeof v !== "string") throw new Error(`${PRINT_FIELD_LABELS[k]}格式錯誤`);
    const s = (v ?? "").trim();
    if (s.length > PRINT_FIELD_LIMITS[k]) throw new Error(`${PRINT_FIELD_LABELS[k]}不可超過 ${PRINT_FIELD_LIMITS[k]} 個字`);
    out[k] = s || null;
  }
  if (!Object.keys(out).length) throw new Error("沒有要儲存的列印欄位");
  return out;
}
