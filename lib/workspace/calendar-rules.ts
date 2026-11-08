// M5 W23／W24 年度行事曆的純規則（無 I/O，Next 端、Vue 工作台與 Vitest 共用）。
// 此檔不得 import 任何模組：Vue 端用相對路徑直接引用。
// 規則來源：舊版 components/organization/OrganizationCalendarClient.tsx、app/api/organization/calendar/**、lib/organization/google-calendar.ts；
// 與舊版不同的地方（Q18 搜尋排除停用離職、Q19 Google 事件加註、Q20 頁頂警示、Q21 假日差異）都在這裡集中，方便逐一對照測試。

export type CalendarSource = "company" | "personal" | "holiday";
export type CalendarEntry = {
  id: string;
  key: string;
  source: CalendarSource;
  title: string;
  start_date: string;
  end_date: string;
  description?: string | null;
  event_type?: string;
  day_type?: string;
  owner_id?: string;
  is_all_day?: boolean;
  start_time?: string | null;
  end_time?: string | null;
  location?: string | null;
};

// ---- 月曆格線（舊版 getMonthDays：週日為首，補滿整週）----
export function monthGridDays(year: number, month: number) {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const count = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, month, index - firstWeekday + 1));
    return { value: date.toISOString().slice(0, 10), day: date.getUTCDate(), inMonth: date.getUTCMonth() === month };
  });
}

/** 三種來源合併成同一份清單（舊版 entries）：依來源篩選，開始日再名稱排序。 */
export function buildCalendarEntries(
  data: { companyEvents: any[]; personalEvents: any[]; holidays: any[] },
  visible: Record<CalendarSource, boolean>,
): CalendarEntry[] {
  const all: CalendarEntry[] = [
    ...data.companyEvents.map((e) => ({ ...e, key: `company:${e.id}`, source: "company" as const })),
    ...data.personalEvents.map((e) => ({ ...e, key: `personal:${e.id}`, source: "personal" as const })),
    ...data.holidays.map((h) => ({
      id: h.id,
      key: `holiday:${h.id}`,
      source: "holiday" as const,
      title: h.name,
      start_date: h.holiday_date,
      end_date: h.holiday_date,
      day_type: h.day_type,
    })),
  ];
  return all
    .filter((e) => visible[e.source])
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.title.localeCompare(b.title, "zh-Hant"));
}
export const entriesOnDate = (entries: CalendarEntry[], date: string) =>
  entries.filter((e) => e.start_date <= date && e.end_date >= date);
/** 全年清單：依「開始日期所在月份」歸月（舊版行為，跨月行事只出現在開始的那個月）。 */
export const entriesByMonth = (entries: CalendarEntry[]) =>
  Array.from({ length: 12 }, (_, month) => ({
    month,
    events: entries.filter((e) => Number(e.start_date.slice(5, 7)) - 1 === month),
  }));

// ---- Q21：政府假日再匯入前的差異 ----
export type HolidayRow = { holiday_date: string; name: string; day_type: string };
export type HolidayDiff = {
  added: HolidayRow[];
  removed: HolidayRow[];
  renamed: { holiday_date: string; before: string; after: string }[];
  retyped: { holiday_date: string; before: string; after: string }[];
  unchanged: number;
  /** 新增、移除、改名、改類型的件數總和（同一天同時改名又改類型算兩件）。 */
  changeCount: number;
  /** 完全沒有差異（再發布也不會改變任何一天）。 */
  identical: boolean;
};
/** 比較「現行已發布版本」與「準備發布的新版本」：以日期為鍵。 */
export function diffHolidays(existing: HolidayRow[], incoming: HolidayRow[]): HolidayDiff {
  const before = new Map(existing.map((r) => [r.holiday_date, r]));
  const after = new Map(incoming.map((r) => [r.holiday_date, r]));
  const added: HolidayRow[] = [];
  const removed: HolidayRow[] = [];
  const renamed: HolidayDiff["renamed"] = [];
  const retyped: HolidayDiff["retyped"] = [];
  let unchanged = 0;
  for (const [date, row] of Array.from(after.entries())) {
    const old = before.get(date);
    if (!old) {
      added.push(row);
      continue;
    }
    const nameChanged = old.name !== row.name;
    const typeChanged = old.day_type !== row.day_type;
    if (nameChanged) renamed.push({ holiday_date: date, before: old.name, after: row.name });
    if (typeChanged) retyped.push({ holiday_date: date, before: old.day_type, after: row.day_type });
    if (!nameChanged && !typeChanged) unchanged += 1;
  }
  for (const [date, row] of Array.from(before.entries())) if (!after.has(date)) removed.push(row);
  const byDate = (a: { holiday_date: string }, b: { holiday_date: string }) => a.holiday_date.localeCompare(b.holiday_date);
  added.sort(byDate);
  removed.sort(byDate);
  renamed.sort(byDate);
  retyped.sort(byDate);
  const changeCount = added.length + removed.length + renamed.length + retyped.length;
  return { added, removed, renamed, retyped, unchanged, changeCount, identical: changeCount === 0 };
}
export function holidayDiffSummary(diff: HolidayDiff): string {
  if (diff.identical) return "與現有版本完全相同";
  return `新增 ${diff.added.length} 筆、移除 ${diff.removed.length} 筆、改名 ${diff.renamed.length} 筆、改類型 ${diff.retyped.length} 筆`;
}
/** 同一年度已有「已發布」版本時，發布前必須二次確認（confirm_replace === true）。 */
export function holidayPublishNeedsConfirm(hasPublishedForYear: boolean, confirmReplace: unknown): boolean {
  return hasPublishedForYear && confirmReplace !== true;
}

// ---- Q19：寫到 Google 事件描述的加註 ----
export const GOOGLE_SYNC_NOTE = "請勿在此修改，請回系統";
/** 把加註附在描述最後（獨立一段）。舊描述原樣保留，方便對照。 */
export function withSyncNote(description: string): string {
  return description ? `${description}\n\n${GOOGLE_SYNC_NOTE}` : GOOGLE_SYNC_NOTE;
}

// ---- Q20：頁頂常駐警示 ----
/** 授權需重新連結的錯誤文字（與舊版 googleReconnectNeeded 的判斷完全相同）。 */
export const GOOGLE_RECONNECT_PATTERN = /insufficient authentication scopes|insufficient.*scope|授權已失效|invalid_grant/i;
export const googleReconnectNeeded = (lastSyncError: string | null | undefined) => GOOGLE_RECONNECT_PATTERN.test(lastSyncError || "");

/**
 * 待同步筆數：目前「應該在 Google 上」的來源（有效公司行事、已發布假日）沒有連結紀錄或連結上有錯誤，
 * 加上「已不該存在、但 Google 上的事件還沒刪成功」的連結紀錄。
 * 舊版只算「連結上有錯誤」的筆數：授權失效時根本不會寫連結紀錄，所以會顯示 0 筆而沒有人發現。
 */
export function pendingSyncCount(
  sourceKeys: readonly string[],
  links: readonly { source_key: string; last_error?: string | null }[],
): number {
  const sources = new Set(sourceKeys);
  const linkByKey = new Map(links.map((l) => [l.source_key, l]));
  let pending = 0;
  for (const key of Array.from(sources)) {
    const link = linkByKey.get(key);
    if (!link || link.last_error) pending += 1;
  }
  for (const link of links) if (!sources.has(link.source_key)) pending += 1;
  return pending;
}

export type GoogleBannerInput = {
  connected: boolean;
  calendarMatches?: boolean;
  lastSyncError?: string | null;
  pendingCount?: number;
} | null;
export type GoogleBanner = { show: boolean; pendingCount: number; authInvalid: boolean; text: string };
export function googleBanner(status: GoogleBannerInput): GoogleBanner {
  if (!status || !status.connected) return { show: false, pendingCount: 0, authInvalid: false, text: "" };
  const pendingCount = Math.max(0, Number(status.pendingCount) || 0);
  const authInvalid = googleReconnectNeeded(status.lastSyncError);
  const parts: string[] = [];
  if (authInvalid) parts.push("Google 授權已失效，行事無法同步到 Google，請重新連結");
  if (pendingCount > 0) parts.push(`有 ${pendingCount} 筆行事待同步到 Google`);
  if (status.calendarMatches === false) parts.push("伺服器設定的目標日曆與已連結日曆不同，已暫停同步");
  return { show: parts.length > 0, pendingCount, authInvalid, text: parts.join("；") };
}

// ---- Q18：分享個人行程的搜尋對象 ----
export type ColleagueFacts = {
  /** 登入帳號被停用（封鎖時間未到期）。 */
  disabled: boolean;
  /** 員工主檔（以員編對應）；沒有主檔的帳號（例如總部、管理員）視為在職。 */
  employeeRows: readonly { is_active?: boolean | null; employment_status?: string | null }[];
};
const rowActive = (r: { is_active?: boolean | null; employment_status?: string | null }) =>
  r.is_active !== false && r.employment_status !== "resigned";
/** 可被搜尋到：帳號沒被停用，且不是「有員工主檔、但每一筆都已離職或停用」。 */
export function isSearchableColleague(f: ColleagueFacts): boolean {
  if (f.disabled) return false;
  if (f.employeeRows.length === 0) return true;
  return f.employeeRows.some(rowActive);
}
/** 搜尋文字處理（與舊版 people API 相同）：% _ 換空白、trim；少於 2 字回空、超過 80 字報錯。 */
export function normalizePeopleQuery(raw: string | null | undefined): { query: string; tooShort: boolean; tooLong: boolean } {
  const query = (raw || "").replace(/[%_]/g, " ").trim();
  return { query, tooShort: query.length < 2, tooLong: query.length > 80 };
}
export const PEOPLE_RESULT_LIMIT = 30;

// ---- 舊網址轉新版（OAuth 回調不變，由舊站頁面轉過來）----
const GOOGLE_RESULTS = ["connected", "connected_with_errors", "error"] as const;
/** /organization/calendar（含 Google 回調帶來的 google_calendar、google_detail）→ 工作台的開啟頁面路由。 */
export function calendarLegacyTarget(pathname: string, search = ""): string | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (clean !== "/organization/calendar") return null;
  const source = new URLSearchParams(search);
  const result = source.get("google_calendar");
  const out = new URLSearchParams();
  if (result && (GOOGLE_RESULTS as readonly string[]).includes(result)) {
    out.set("google_calendar", result);
    const detail = source.get("google_detail");
    if (detail) out.set("google_detail", detail.slice(0, 300));
  }
  const q = out.toString();
  return `/workspace/index.html#/open/calendar${q ? `?${q}` : ""}`;
}

// ---- 表單驗證（與舊版 company-events／personal-events 的 validateEvent 相同的前端預檢）----
export const CALENDAR_TITLE_MAX = 160;
export const CALENDAR_LOCATION_MAX = 500;
export const CALENDAR_DESCRIPTION_MAX = 3000;
export function validateCalendarDraft(d: {
  title: string; start_date: string; end_date: string; is_all_day: boolean; start_time: string; end_time: string; location: string; description: string;
}): string | null {
  if (!d.title.trim() || d.title.trim().length > CALENDAR_TITLE_MAX) return "請輸入行事名稱（最多 160 字）";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(d.end_date) || d.end_date < d.start_date) return "請確認行事日期範圍";
  if (d.location.trim().length > CALENDAR_LOCATION_MAX) return "地點最多 500 字";
  const validTime = (v: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
  if (!d.is_all_day && (!validTime(d.start_time) || !validTime(d.end_time) || (d.start_date === d.end_date && d.end_time <= d.start_time))) {
    return "請確認開始與結束時間；同一天的結束時間需晚於開始時間";
  }
  if (d.description.trim().length > CALENDAR_DESCRIPTION_MAX) return "補充說明最多 3000 字";
  return null;
}
