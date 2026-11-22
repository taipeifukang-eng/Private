// M6 W29 商品部缺貨回報共用規則（純函式，無相依；today 一律由呼叫端注入，日期一律以 Asia/Taipei 計算）。
// 規則來源：舊 app/cross-dept/merchandise/page.tsx 與 app/api/stockout-reports|stockout-responses。
// 與舊版不同處見 tests/parity/allowlist.json 的 m6-w29-* 條目（C3 即時衍生狀態、日期一律台北時間、關鍵字跳脫）。

/** 回覆「仍有效」的緩衝天數（C1 照舊：預計到貨日過了 15 天內仍算已回覆）。 */
export const GRACE_DAYS = 15;
/** 回覆「仍顯示提醒」的天數（C1 照舊：超過 30 天視同新回報，不再提醒）。 */
export const REMINDER_DAYS = 30;
/** C6：近期重複回報提示的天數。 */
export const DUPLICATE_WINDOW_DAYS = 7;
export const REPORT_PAGE_SIZE = 30;
export const REPORT_PAGE_MAX = 100;
export const HISTORY_PAGE_SIZE = 10;
export const HISTORY_PAGE_MAX = 50;
export const RECENT_DAYS = 30;

export type ResponseLike = { eta_date: string | null; responded_at?: string | null };

const pad = (n: number) => String(n).padStart(2, "0");
/** 某個時間點的台北日期 YYYY-MM-DD。 */
export function taipeiDate(at: Date | string | number): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
/** 台北日期字串加減天數（純日曆運算，不受時區影響）。 */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export const graceLowerBound = (today: string) => addDays(today, -GRACE_DAYS);
export const reminderLowerBound = (today: string) => addDays(today, -REMINDER_DAYS);

/** 回覆是否仍有效（算已回覆）：沒有預計到貨日一律有效；否則預計到貨日要在「今天往前 15 天」內。 */
export function isResponseActive(r: ResponseLike | null | undefined, today: string): boolean {
  if (!r) return false;
  if (!r.eta_date) return true;
  return r.eta_date >= graceLowerBound(today);
}
/** 回覆是否仍顯示提醒：超過預計到貨日 30 天就不再提醒。 */
export function shouldShowReminder(r: ResponseLike | null | undefined, today: string): boolean {
  if (!r) return false;
  if (!r.eta_date) return true;
  return r.eta_date >= reminderLowerBound(today);
}
export function normalizeForReminder<T extends ResponseLike>(r: T | null | undefined, today: string): T | null {
  return shouldShowReminder(r, today) ? (r ?? null) : null;
}

/** C3：回報狀態不讀資料欄位，改由「該商品目前有沒有有效回覆」即時算出。 */
export function deriveStatus(productCode: string, activeCodes: ReadonlySet<string>): "pending" | "responded" {
  return activeCodes.has(productCode) ? "responded" : "pending";
}
export function activeCodeSet(responses: { product_code: string; eta_date: string | null }[], today: string): Set<string> {
  const out = new Set<string>();
  for (const r of responses) if (isResponseActive(r, today)) out.add(r.product_code);
  return out;
}

/** 回報時間所屬的台北月份 YYYY-MM（舊版取 UTC 前七碼，月初月底的回報會落到錯的月份）。 */
export function taipeiMonthKey(at: string | Date): string {
  return taipeiDate(at).slice(0, 7);
}
/** 某月份的台北時間起訖（含起、不含迄），用於資料庫篩選；格式不對回 null。 */
export function monthRange(month: string): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [y, m] = month.split("-").map(Number);
  if (m < 1 || m > 12) return null;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  return { start: `${month}-01T00:00:00+08:00`, end: `${next}T00:00:00+08:00` };
}
/** 「近 30 天」的起點：台北今天往前 30 天的 00:00（舊版用「現在往前 30×24 小時」的瞬間）。 */
export function recentStart(today: string): string {
  return `${addDays(today, -RECENT_DAYS)}T00:00:00+08:00`;
}

export function clampPage(raw: unknown): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}
/** pageSize：預設 30、上限 100；歷程預設 10、上限 50。 */
export function clampPageSize(raw: unknown, def: number, max: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return def;
  return Math.min(max, n);
}

export type Caps = { submit: boolean; viewAll: boolean; respond: boolean };
/** 預設分頁：只有提交權限預設「我的門市」；有查看全部或回覆權限預設「全部門市」。 */
export function defaultTab(c: Caps): "all" | "my-store" {
  return c.viewAll || c.respond ? "all" : "my-store";
}
export const canSeeAll = (c: Caps) => c.viewAll || c.respond;
export const canSubmitAny = (c: Caps) => c.submit || c.viewAll || c.respond;
/** 回覆（新增或編輯）：respond 或 view_all。 */
export const canRespondTo = (c: Caps) => c.respond || c.viewAll;
/** 刪除：商品部（view_all／respond）可刪任意，其他只能刪自己的。 */
export function canDeleteReport(c: Caps, reportedBy: string, userId: string): boolean {
  return canSeeAll(c) || reportedBy === userId;
}
/** POST 回報的門市範圍（b）：view_all／respond 不限；其餘只能是自己管轄（store_managers）的門市。 */
export function canReportForStore(c: Caps, storeId: string, managedStoreIds: readonly string[]): boolean {
  if (canSeeAll(c)) return true;
  return c.submit && managedStoreIds.includes(storeId);
}

export type ReportLike = { store_id: string; product_code: string; created_at: string };
/** C6：同門市、同商品在 7 天（含）內已回報過。today 為台北日期。 */
export function findRecentDuplicate<T extends ReportLike>(reports: readonly T[], storeId: string, productCode: string, today: string): T | null {
  const since = addDays(today, -DUPLICATE_WINDOW_DAYS);
  let best: T | null = null;
  for (const r of reports) {
    if (r.store_id !== storeId || r.product_code !== productCode) continue;
    if (taipeiDate(r.created_at) < since) continue;
    if (!best || r.created_at > best.created_at) best = r;
  }
  return best;
}

/** 回報欄位檢查，訊息沿用舊版。 */
export function validateReport(b: { store_id?: unknown; product_code?: unknown; product_name?: unknown; required_qty?: unknown }):
  | { ok: true; value: { store_id: string; product_code: string; product_name: string; required_qty: number } }
  | { ok: false; message: string } {
  const code = typeof b.product_code === "string" ? b.product_code.trim() : "";
  const name = typeof b.product_name === "string" ? b.product_name.trim() : "";
  const qty = Number(b.required_qty);
  if (!b.store_id || typeof b.store_id !== "string" || !code || !name || !b.required_qty) return { ok: false, message: "缺少必要欄位" };
  if (!Number.isInteger(qty) || qty < 1) return { ok: false, message: "需求數量必須是大於 0 的整數" };
  return { ok: true, value: { store_id: b.store_id, product_code: code, product_name: name, required_qty: qty } };
}
/** 回覆欄位檢查。 */
export function validateResponse(b: { product_code?: unknown; product_name?: unknown; response_content?: unknown; eta_date?: unknown }):
  | { ok: true; value: { product_code: string; product_name: string; response_content: string; eta_date: string } }
  | { ok: false; message: string } {
  const code = typeof b.product_code === "string" ? b.product_code.trim() : "";
  const name = typeof b.product_name === "string" ? b.product_name.trim() : "";
  const content = typeof b.response_content === "string" ? b.response_content.trim() : "";
  const eta = typeof b.eta_date === "string" ? b.eta_date : "";
  if (!code || !name || !content || !eta) return { ok: false, message: "缺少必要欄位" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eta) || addDays(eta, 0) !== eta) return { ok: false, message: "預計到貨日格式不正確" };
  return { ok: true, value: { product_code: code, product_name: name, response_content: content, eta_date: eta } };
}
