import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  calendarLegacyTarget,
  GOOGLE_RECONNECT_PATTERN,
  GOOGLE_SYNC_NOTE,
  googleBanner,
  googleReconnectNeeded,
  pendingSyncCount,
  withSyncNote,
} from '@/lib/workspace/calendar-rules';
import { calendarMockEnabled, googleFetch, mockOfficialCsv, mockState, officialFetch, resetMock, setMock } from '@/lib/workspace/calendar-mock';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

describe('W24 Q19：Google 事件描述加註', () => {
  it('加註文字固定，附在描述最後獨立一段；空描述就只有加註', () => {
    expect(GOOGLE_SYNC_NOTE).toBe('請勿在此修改，請回系統');
    expect(withSyncNote('會議\n\n說明')).toBe('會議\n\n說明\n\n請勿在此修改，請回系統');
    expect(withSyncNote('')).toBe('請勿在此修改，請回系統');
  });
  it('同步程式的公司行事與假日兩種描述都經過 withSyncNote，且所有對 Google 的呼叫都經過 googleFetch（測試站才會改走 mock）', () => {
    const src = read('lib/organization/google-calendar.ts');
    expect(src).toContain("description: withSyncNote(lines.join('\\n\\n')),");
    expect(src).toContain("description: withSyncNote(`政府公告參考：");
    expect(src.match(/googleFetch\(/g)?.length).toBe(3); // token、事件 API、撤銷授權
    expect(src).not.toMatch(/[^.\w]fetch\(/); // 沒有直接 fetch
  });
  it('取消公司行事時真的刪除 Google 事件：snapshot 對不再有效的來源送 DELETE（照舊，沒有被改動）', () => {
    const src = read('lib/organization/google-calendar.ts');
    expect(src).toContain("event.status === 'active' ? companyPayload(event) : null");
    expect(src).toMatch(/if \(!eventPayload\) \{[\s\S]*?'DELETE'/);
    // 只刪連結紀錄裡有的（系統建立的），不是掃整個日曆
    expect(src).toContain('existing?.google_event_id');
  });
  it('同步方向維持單向：同步程式沒有讀取 Google 事件清單的呼叫（沒有 GET events）', () => {
    const src = read('lib/organization/google-calendar.ts');
    expect(src).not.toMatch(/googleApi\([^)]*'GET'/);
    expect(src).not.toContain('events/watch');
  });
});

describe('W24 Q20：頁頂警示與待同步筆數', () => {
  it('授權需重新連結的判斷與舊版頁面的正規表示式完全相同', () => {
    const legacy = read('components/organization/OrganizationCalendarClient.tsx');
    expect(legacy).toContain('/insufficient authentication scopes|insufficient.*scope|授權已失效|invalid_grant/i');
    expect(GOOGLE_RECONNECT_PATTERN.source).toBe('insufficient authentication scopes|insufficient.*scope|授權已失效|invalid_grant');
    for (const [text, want] of [
      ['Google 授權已失效，請重新連結（測試模式的授權可能在 7 天後到期）', true],
      ['invalid_grant', true],
      ['Request had insufficient authentication scopes', true],
      ['Google Calendar：Rate Limit Exceeded（HTTP 403）', false],
      ['', false],
      [null, false],
      [undefined, false],
    ] as [string | null | undefined, boolean][]) expect(googleReconnectNeeded(text), String(text)).toBe(want);
  });
  it('待同步筆數：缺連結、連結帶錯誤、已不該存在但還沒刪成功的都算；舊算法只算連結帶錯誤的', () => {
    const links = (rows: [string, string | null][]) => rows.map(([source_key, last_error]) => ({ source_key, last_error }));
    expect(pendingSyncCount([], [])).toBe(0);
    expect(pendingSyncCount(['company:a', 'holiday:2099-01-01'], links([['company:a', null], ['holiday:2099-01-01', null]]))).toBe(0);
    // 授權失效時根本沒寫連結：兩筆都缺連結
    expect(pendingSyncCount(['company:a', 'company:b'], [])).toBe(2);
    expect(pendingSyncCount(['company:a'], links([['company:a', 'Google Calendar：mock failure']]))).toBe(1);
    // 已取消的行事，連結還在（Google 刪除失敗）：算待同步
    expect(pendingSyncCount([], links([['company:gone', null]]))).toBe(1);
    expect(pendingSyncCount(['company:a', 'company:b', 'holiday:2099-01-01'], links([['company:a', null], ['company:b', 'x'], ['company:old', 'y']]))).toBe(1 + 1 + 1 + 0);
  });
  it('警示：沒連結不顯示；連結且沒有問題不顯示；待同步與授權失效各自出現，也可以同時', () => {
    expect(googleBanner(null)).toEqual({ show: false, pendingCount: 0, authInvalid: false, text: '' });
    expect(googleBanner({ connected: false, pendingCount: 9, lastSyncError: 'invalid_grant' }).show).toBe(false);
    expect(googleBanner({ connected: true, pendingCount: 0, lastSyncError: null, calendarMatches: true }).show).toBe(false);
    const pending = googleBanner({ connected: true, pendingCount: 3 });
    expect(pending).toMatchObject({ show: true, pendingCount: 3, authInvalid: false });
    expect(pending.text).toBe('有 3 筆行事待同步到 Google');
    const auth = googleBanner({ connected: true, pendingCount: 0, lastSyncError: 'Google 授權已失效，請重新連結' });
    expect(auth).toMatchObject({ show: true, authInvalid: true });
    expect(auth.text).toContain('Google 授權已失效');
    const both = googleBanner({ connected: true, pendingCount: 2, lastSyncError: 'invalid_grant' });
    expect(both.text).toBe('Google 授權已失效，行事無法同步到 Google，請重新連結；有 2 筆行事待同步到 Google');
    expect(googleBanner({ connected: true, pendingCount: 0, calendarMatches: false }).text).toContain('目標日曆與已連結日曆不同');
    expect(googleBanner({ connected: true, pendingCount: -5 }).show).toBe(false);
    expect(googleBanner({ connected: true, pendingCount: Number.NaN }).pendingCount).toBe(0);
  });
});

describe('W24 OAuth 回調不變、由舊站轉新版', () => {
  it('舊站 /organization/calendar 轉到新版「開啟頁面」；Google 回調帶來的結果與說明原樣帶過去，其他參數丟棄', () => {
    expect(calendarLegacyTarget('/organization/calendar')).toBe('/workspace/index.html#/open/calendar');
    expect(calendarLegacyTarget('/organization/calendar/')).toBe('/workspace/index.html#/open/calendar');
    expect(calendarLegacyTarget('/organization/calendar', '?google_calendar=connected&google_detail=' + encodeURIComponent('已連結並同步 3 筆')))
      .toBe('/workspace/index.html#/open/calendar?google_calendar=connected&google_detail=' + encodeURIComponent('已連結並同步 3 筆').replace(/%20/g, '+'));
    expect(calendarLegacyTarget('/organization/calendar', '?google_calendar=error&google_detail=x&utm=1')).toBe('/workspace/index.html#/open/calendar?google_calendar=error&google_detail=x');
    expect(calendarLegacyTarget('/organization/calendar', '?google_calendar=hacked&google_detail=x')).toBe('/workspace/index.html#/open/calendar');
    expect(calendarLegacyTarget('/organization/calendar', '?google_calendar=connected_with_errors')).toBe('/workspace/index.html#/open/calendar?google_calendar=connected_with_errors');
    // 說明最多 300 字
    const long = calendarLegacyTarget('/organization/calendar', '?google_calendar=error&google_detail=' + 'a'.repeat(500))!;
    expect(new URLSearchParams(long.split('?')[1]).get('google_detail')).toHaveLength(300);
  });
  it('其他路徑不轉；回調網址本身（/api/organization/calendar/google/callback）完全不在轉址範圍內', () => {
    for (const p of ['/organization', '/organization/calendars', '/api/organization/calendar/google/callback', '/organization/calendar/x', '/admin/calendar']) expect(calendarLegacyTarget(p), p).toBeNull();
  });
  it('舊回調程式仍然導向 /organization/calendar（回調網址與回導路徑不變，Google 後台設定不用改），授權範圍維持最小', () => {
    const cb = read('app/api/organization/calendar/google/callback/route.ts');
    expect(cb).toContain("new URL('/organization/calendar', origin)");
    expect(cb).toContain("url.searchParams.set('google_calendar', result)");
    const connect = read('app/api/organization/calendar/google/connect/route.ts');
    expect(connect).toContain("'https://www.googleapis.com/auth/calendar.events.owned'");
    expect(connect).not.toMatch(/auth\/calendar'/); // 不要求整個日曆權限
    expect(read('middleware.ts')).toContain('calendarLegacyTarget(request.nextUrl.pathname, request.nextUrl.search)');
  });
});

describe('W24 mock（D17）：只有測試站才啟用，一般環境完全走真實 fetch', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.WORKSPACE_CALENDAR_MOCK;
    delete process.env.WORKSPACE_DEV_ENABLED;
    resetMock();
  });
  afterEach(() => {
    process.env = { ...saved };
    vi.unstubAllGlobals();
  });
  it('兩個旗標都要有才啟用', () => {
    expect(calendarMockEnabled()).toBe(false);
    process.env.WORKSPACE_CALENDAR_MOCK = 'true';
    expect(calendarMockEnabled()).toBe(false);
    process.env.WORKSPACE_DEV_ENABLED = 'true';
    expect(calendarMockEnabled()).toBe(true);
    process.env.WORKSPACE_CALENDAR_MOCK = 'yes';
    expect(calendarMockEnabled()).toBe(false);
  });
  it('沒啟用時 googleFetch 與 officialFetch 就是原本的 fetch', async () => {
    const f = vi.fn(async () => new Response('real', { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect(await (await googleFetch('https://oauth2.googleapis.com/token', { method: 'POST' })).text()).toBe('real');
    expect(await (await officialFetch('https://www.dgpa.gov.tw/information')).text()).toBe('real');
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('啟用時完全不會呼叫真實 fetch', async () => {
    process.env.WORKSPACE_CALENDAR_MOCK = 'true';
    process.env.WORKSPACE_DEV_ENABLED = 'true';
    const f = vi.fn(async () => new Response('real'));
    vi.stubGlobal('fetch', f);
    await googleFetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token' }) });
    await officialFetch('https://data.gov.tw/dataset/14718');
    expect(f).not.toHaveBeenCalled();
  });
  it('假 Google：授權碼換權杖、更新權杖、授權失效、範圍不足、帳號資訊', async () => {
    process.env.WORKSPACE_CALENDAR_MOCK = 'true';
    process.env.WORKSPACE_DEV_ENABLED = 'true';
    const token = (form: Record<string, string>) => googleFetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams(form) });
    const ok = await (await token({ grant_type: 'authorization_code', code: 'mock-code' })).json();
    expect(ok.refresh_token).toBe('mock-refresh-token');
    expect(ok.scope).toContain('calendar.events.owned');
    expect((await token({ grant_type: 'authorization_code', code: 'other' })).status).toBe(400);
    expect((await (await token({ grant_type: 'refresh_token' })).json()).access_token).toBe('mock-access-token');
    setMock({ tokenInvalid: true });
    const bad = await token({ grant_type: 'refresh_token' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('invalid_grant');
    setMock({ tokenInvalid: false, scopeMissing: true });
    expect((await (await token({ grant_type: 'authorization_code', code: 'mock-code' })).json()).scope).toBe('openid email');
    expect((await (await googleFetch('https://www.googleapis.com/oauth2/v2/userinfo')).json()).email).toBe('mock-google@example.test');
  });
  it('假 Google 事件：新增、重複 409、修改、不存在 404、刪除 204、寫入失敗規則', async () => {
    process.env.WORKSPACE_CALENDAR_MOCK = 'true';
    process.env.WORKSPACE_DEV_ENABLED = 'true';
    const base = 'https://www.googleapis.com/calendar/v3/calendars/cal%40x/events';
    const call = (m: string, p: string, body?: unknown) => googleFetch(`${base}${p}`, { method: m, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect((await call('POST', '', { id: 'e1', summary: 'a' })).status).toBe(200);
    expect((await call('POST', '', { id: 'e1', summary: 'a' })).status).toBe(409);
    expect((await call('PATCH', '/e1', { summary: 'b' })).status).toBe(200);
    expect(mockState().events.e1.summary).toBe('b');
    expect((await call('PATCH', '/nope', { summary: 'x' })).status).toBe(404);
    setMock({ failTitles: ['BAD'] });
    expect((await call('POST', '', { id: 'e2', summary: 'BAD one' })).status).toBe(500);
    expect(mockState().events.e2).toBeUndefined();
    setMock({ failTitles: [], failDelete: true });
    expect((await call('DELETE', '/e1')).status).toBe(500);
    setMock({ failDelete: false });
    expect((await call('DELETE', '/e1')).status).toBe(204);
    expect((await call('DELETE', '/e1')).status).toBe(404);
    expect(mockState().calls.filter((c) => c.method === 'DELETE')).toHaveLength(3);
    expect((await googleFetch('https://www.googleapis.com/something/else')).status).toBe(501);
  });
  it('「別人手動建立」的事件可由控制介面加入，reset 會清空全部狀態', () => {
    setMock({ addEvents: [{ id: 'human-1', summary: '手動' }], csvVariant: 'changed', failTitles: ['x'] });
    expect(mockState().events['human-1'].summary).toBe('手動');
    resetMock();
    expect(mockState()).toMatchObject({ events: {}, calls: [], csvVariant: 'base', failTitles: [], tokenInvalid: false });
  });
});

describe('W24 假的人事總處辦公日曆', () => {
  it('整年資料：2099 年 365 天、閏年 366 天；欄位與舊版解析器要求的標題一致；開頭有 BOM', () => {
    const csv = mockOfficialCsv(2099, 'base');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.trim().split('\r\n');
    expect(lines[0].replace('﻿', '')).toBe('西元日期,星期,是否放假,備註');
    expect(lines).toHaveLength(1 + 365);
    expect(mockOfficialCsv(2096, 'base').trim().split('\r\n')).toHaveLength(1 + 366);
    const src = read('app/api/organization/calendar/holidays/preview/route.ts');
    for (const h of ['西元日期', '星期', '是否放假', '備註']) expect(src).toContain(h);
  });
  it('base 與 changed 的差異剛好是測試預期的那幾天', () => {
    const rows = (v: 'base' | 'changed') => new Map(mockOfficialCsv(2099, v).trim().split('\r\n').slice(1).map((l) => { const [d, , off, note] = l.split(','); return [d, `${off}:${note}`] as const; }));
    const a = rows('base');
    const b = rows('changed');
    const diff = Array.from(a.keys()).filter((k) => a.get(k) !== b.get(k));
    expect(diff).toEqual(['20990101', '20990219', '20990404', '20991010']);
  });
  it('預覽路由的三個對外請求都經過 officialFetch', () => {
    const src = read('app/api/organization/calendar/holidays/preview/route.ts');
    expect(src.match(/officialFetch\(/g)?.length).toBe(3);
    expect(src).not.toMatch(/[^.\w]fetch\(/);
  });
});
