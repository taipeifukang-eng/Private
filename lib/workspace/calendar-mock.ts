// D17：Google 與政府辦公日曆（人事總處）的外部呼叫在測試站一律 mock。
// 只有 WORKSPACE_CALENDAR_MOCK=true 且 WORKSPACE_DEV_ENABLED=true（測試站啟動腳本才會設定）時，
// googleFetch／officialFetch 才會改走這裡的假回應；一般環境（含正式區）兩者都是原本的 fetch，不經過這個檔案的任何邏輯。
// 狀態放在 globalThis，讓同一個 Node 程序內不同 route 共用；測試以 /api/workspace/calendar/mock 控制與讀取。

export function calendarMockEnabled(): boolean {
  return process.env.WORKSPACE_CALENDAR_MOCK === "true" && process.env.WORKSPACE_DEV_ENABLED === "true";
}

export type MockGoogleEvent = { id: string; calendarId: string; summary?: string; description?: string; start?: unknown; end?: unknown; location?: string };
export type MockState = {
  /** 重新整理授權（refresh_token）時回 invalid_grant，模擬授權過期。 */
  tokenInvalid: boolean;
  /** 授權碼換到的 scope 不含日曆寫入權限。 */
  scopeMissing: boolean;
  /** 事件標題含其中任一字串時，Google 寫入回 500。 */
  failTitles: string[];
  /** 刪除 Google 事件時回 500。 */
  failDelete: boolean;
  /** 官方辦公日曆 CSV 版本：base 與 changed 在幾天上不同（供 Q21 差異測試）。 */
  csvVariant: "base" | "changed";
  /** 官方日曆下載失敗。 */
  officialFail: boolean;
  events: Record<string, MockGoogleEvent>;
  calls: { method: string; host: string; path: string }[];
};
const fresh = (): MockState => ({
  tokenInvalid: false, scopeMissing: false, failTitles: [], failDelete: false, csvVariant: "base", officialFail: false, events: {}, calls: [],
});
export function mockState(): MockState {
  const g = globalThis as unknown as { __fkCalendarMock?: MockState };
  if (!g.__fkCalendarMock) g.__fkCalendarMock = fresh();
  return g.__fkCalendarMock;
}
export function resetMock() {
  (globalThis as unknown as { __fkCalendarMock?: MockState }).__fkCalendarMock = fresh();
  return mockState();
}
export function setMock(
  patch: Partial<Pick<MockState, "tokenInvalid" | "scopeMissing" | "failTitles" | "failDelete" | "csvVariant" | "officialFail">> & { addEvents?: { id: string; summary?: string }[] },
) {
  const s = mockState();
  // 模擬「別人在 Google 上手動建立的事件」：系統不該動它。
  if (Array.isArray(patch.addEvents))
    for (const e of patch.addEvents) s.events[String(e.id)] = { id: String(e.id), calendarId: "mock-calendar@group.calendar.google.com", summary: String(e.summary || "手動建立"), description: "手動建立" };
  if (typeof patch.tokenInvalid === "boolean") s.tokenInvalid = patch.tokenInvalid;
  if (typeof patch.scopeMissing === "boolean") s.scopeMissing = patch.scopeMissing;
  if (Array.isArray(patch.failTitles)) s.failTitles = patch.failTitles.map(String);
  if (typeof patch.failDelete === "boolean") s.failDelete = patch.failDelete;
  if (patch.csvVariant === "base" || patch.csvVariant === "changed") s.csvVariant = patch.csvVariant;
  if (typeof patch.officialFail === "boolean") s.officialFail = patch.officialFail;
  return s;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const bodyText = (init?: RequestInit): string => {
  const b = init?.body;
  if (typeof b === "string") return b;
  if (b instanceof URLSearchParams) return b.toString();
  return "";
};
const WRITE_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";

function mockGoogle(url: string, init?: RequestInit): Response {
  const state = mockState();
  const u = new URL(url);
  const method = (init?.method || "GET").toUpperCase();
  state.calls.push({ method, host: u.host, path: u.pathname });
  if (state.calls.length > 300) state.calls.splice(0, state.calls.length - 300);

  if (u.host === "oauth2.googleapis.com" && u.pathname === "/token") {
    const form = new URLSearchParams(bodyText(init));
    if (form.get("grant_type") === "authorization_code") {
      if (form.get("code") !== "mock-code") return json({ error: "invalid_grant" }, 400);
      return json({
        access_token: "mock-access-token",
        refresh_token: "mock-refresh-token",
        scope: state.scopeMissing ? "openid email" : `openid email ${WRITE_SCOPE}`,
      });
    }
    if (state.tokenInvalid) return json({ error: "invalid_grant" }, 400);
    return json({ access_token: "mock-access-token", scope: `openid email ${WRITE_SCOPE}` });
  }
  if (u.host === "oauth2.googleapis.com" && u.pathname === "/revoke") return json({});
  if (u.host === "www.googleapis.com" && u.pathname === "/oauth2/v2/userinfo") return json({ email: "mock-google@example.test" });

  const m = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(u.pathname);
  if (u.host === "www.googleapis.com" && m) {
    const calendarId = decodeURIComponent(m[1]);
    const eventId = m[2] ? decodeURIComponent(m[2]) : null;
    if (method === "DELETE") {
      if (state.failDelete) return json({ error: { message: "mock delete failure" } }, 500);
      if (!eventId || !state.events[eventId]) return json({ error: { message: "Not Found" } }, 404);
      delete state.events[eventId];
      return new Response(null, { status: 204 });
    }
    let payload: any = {};
    try {
      payload = JSON.parse(bodyText(init) || "{}");
    } catch {
      return json({ error: { message: "bad json" } }, 400);
    }
    if (state.failTitles.some((t) => t && String(payload.summary || "").includes(t))) {
      return json({ error: { message: "mock write failure" } }, 500);
    }
    if (method === "POST" && !eventId) {
      const id = String(payload.id || `mock-${Math.random().toString(36).slice(2, 12)}`);
      if (state.events[id]) return json({ error: { message: "duplicate" } }, 409);
      state.events[id] = { ...payload, id, calendarId };
      return json({ id });
    }
    if (method === "PATCH" && eventId) {
      if (!state.events[eventId]) return json({ error: { message: "Not Found" } }, 404);
      state.events[eventId] = { ...state.events[eventId], ...payload, id: eventId };
      return json({ id: eventId });
    }
  }
  return json({ error: { message: `mock: unhandled ${method} ${u.host}${u.pathname}` } }, 501);
}

export async function googleFetch(url: string, init?: RequestInit): Promise<Response> {
  if (calendarMockEnabled()) return mockGoogle(url, init);
  return fetch(url, init);
}

// ---- 人事總處辦公日曆（只供 holidays/preview 使用）----
const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
/** 產生一整年的官方格式 CSV（UTF-8 BOM）。base 與 changed 的差異：移除 02-19、01-01 改名、04-04 改補假、多一天 10-10。 */
export function mockOfficialCsv(year: number, variant: "base" | "changed"): string {
  const notes = new Map<string, string>();
  notes.set(iso(year, 1, 1), variant === "changed" ? "元旦" : "開國紀念日");
  notes.set(iso(year, 2, 18), "春節");
  if (variant === "base") notes.set(iso(year, 2, 19), "春節");
  notes.set(iso(year, 4, 4), variant === "changed" ? "兒童節補假" : "兒童節");
  if (variant === "changed") notes.set(iso(year, 10, 10), "國慶日");
  // 補行上班：二月的第一個星期六
  let makeup = "";
  for (let d = 1; d <= 28; d += 1) if (new Date(Date.UTC(year, 1, d)).getUTCDay() === 6) { makeup = iso(year, 2, d); break; }
  const lines = ["西元日期,星期,是否放假,備註"];
  const days = new Date(Date.UTC(year, 1, 29)).getUTCDate() === 29 ? 366 : 365;
  for (let i = 0; i < days; i += 1) {
    const date = new Date(Date.UTC(year, 0, 1 + i));
    const value = date.toISOString().slice(0, 10);
    const weekday = date.getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const note = notes.get(value) || "";
    let off = weekend ? "2" : "0";
    let text = note;
    if (note) off = "2";
    if (value === makeup) { off = "0"; text = "補行上班"; }
    lines.push(`${value.replace(/-/g, "")},${WEEKDAY[weekday]},${off},${text}`);
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
const MOCK_YEARS = [2099];
export async function officialFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!calendarMockEnabled()) return fetch(url, init);
  const state = mockState();
  if (state.officialFail) return new Response("mock official failure", { status: 503 });
  const u = new URL(url);
  if (u.host === "www.dgpa.gov.tw" && u.pathname === "/information") return new Response("", { status: 404 }); // 走資料開放平台目錄
  if (u.host === "data.gov.tw") {
    const links = MOCK_YEARS.map((y) => `"https://www.dgpa.gov.tw/FileConversion?filename=mock${y}&nfix=&name=${encodeURIComponent(`${y - 1911}年中華民國政府行政機關辦公日曆表_utf8bom.csv`)}"`);
    return new Response(`<html><body>${links.join("\n")}</body></html>`, { status: 200 });
  }
  if (u.host === "www.dgpa.gov.tw" && u.pathname === "/FileConversion") {
    const name = u.searchParams.get("name") || "";
    const roc = Number(/^(\d{2,3})年/.exec(name)?.[1]);
    if (!Number.isInteger(roc) || !MOCK_YEARS.includes(roc + 1911)) return new Response("not found", { status: 404 });
    return new Response(Buffer.from(mockOfficialCsv(roc + 1911, state.csvVariant), "utf8"), { status: 200 });
  }
  return new Response("mock: unhandled", { status: 501 });
}
