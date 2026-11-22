import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { adminDb, apiForUser, setupM5Users, type M5User } from '../support/m5-fixtures';
import { TEST_ORIGIN } from '../support/auth';
import { GOOGLE_SYNC_NOTE } from '../../lib/workspace/calendar-rules';
import {
  assertCalendarBaseline,
  calTitle,
  cleanupCalendar,
  companyEventRow,
  googleConnection,
  googleLinks,
  MOCK_GOOGLE_EMAIL,
  mockControl,
  mockReset,
  mockSnapshot,
  RESERVED_YEAR,
} from '../support/m5-calendar-fixtures';

// W24 整合層：Google 單向同步（全部 mock，D17——不連真實 Google）。
//  OAuth 連結與回調（網址不變）、Q19 取消時 Google 事件真的刪除並在描述加註、Q20 待同步筆數與授權失效旗標、
//  只刪系統建立的事件、中斷連結只斷線、同一時間只有一個共用連線。
// 測試站以 WORKSPACE_CALENDAR_MOCK=true 啟動；Google 連線只有一列（id=1），DEV 若已有非 mock 的連線會中止不動它。

const KEYS = ['cal_plain', 'cal_creator', 'cal_editor', 'cal_holiday', 'cal_google', 'cal_all', 'cal_admin_ungranted'];
let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const apis: Record<string, APIRequestContext> = {};
const CAL = '/api/organization/calendar/google';
const status = async (k: string) => (await apis[k].get('/api/workspace/calendar/google/status')).json();
const ev = (tag: string, over: Record<string, unknown> = {}) => ({
  title: calTitle(tag), event_type: 'meeting', start_date: '2099-03-10', end_date: '2099-03-11', is_all_day: true, ...over,
});
const createEvent = async (tag: string, over: Record<string, unknown> = {}) => {
  const r = await apis.cal_creator.post('/api/workspace/calendar/company-events', { data: ev(tag, over) });
  const text = await r.text();
  expect(r.status(), text).toBe(201);
  return JSON.parse(text) as { event: { id: string; title: string }; googleSync: { status: string; message?: string } };
};
const mockEventFor = async (eventId: string) => {
  const links = await googleLinks();
  const link = links.find((l) => l.source_key === `company:${eventId}`);
  const snap = await mockSnapshot(apis.cal_plain);
  return { link, event: link?.google_event_id ? snap.events.find((e) => e.id === link.google_event_id) : undefined, snap };
};
/** 走完連結：connect 取得 state，再用同一個 cookie jar 帶 state 打回調。 */
async function connectGoogle(api: APIRequestContext, code = 'mock-code') {
  const connect = await api.get(`${CAL}/connect`, { maxRedirects: 0 });
  expect(connect.status()).toBe(307);
  const state = new URL(connect.headers().location).searchParams.get('state')!;
  const callback = await api.get(`${CAL}/callback?code=${code}&state=${encodeURIComponent(state)}`, { maxRedirects: 0 });
  return { connect, callback, location: new URL(callback.headers().location) };
}

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertCalendarBaseline();
  const left = await cleanupCalendar();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const s = await setupM5Users(KEYS);
  users = s.users;
  teardownUsers = s.teardown;
  for (const k of KEYS) apis[k] = await apiForUser(users[k]);
  await mockReset(apis.cal_plain).catch((e) => {
    throw new Error(`測試站沒有啟用 mock（需由 Playwright webServer 啟動）：${e.message}`);
  });
});
test.afterAll(async () => {
  await mockReset(apis.cal_plain).catch(() => undefined);
  for (const c of Object.values(apis)) await c.dispose();
  const left = await cleanupCalendar();
  expect(left, '清除行事曆測試資料').toEqual([]);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

test.describe.configure({ mode: 'serial' });

test('狀態與授權：沒有 Google 管理權限的人 403；管理員（舊式身分）放行；未連結時沒有警示', async () => {
  for (const k of ['cal_plain', 'cal_creator', 'cal_editor', 'cal_holiday']) {
    expect((await apis[k].get('/api/workspace/calendar/google/status')).status(), `${k} status`).toBe(403);
    expect((await apis[k].get(`${CAL}/status`)).status(), `${k} legacy status`).toBe(403);
    for (const op of ['sync', 'diagnose', 'disconnect']) expect((await apis[k].post(`/api/workspace/calendar/google/${op}`, { data: {} })).status(), `${k} ${op}`).toBe(403);
    expect((await apis[k].get(`${CAL}/connect`, { maxRedirects: 0 })).status(), `${k} connect`).toBe(403);
  }
  for (const k of ['cal_google', 'cal_all', 'cal_admin_ungranted']) {
    const s = await status(k);
    expect(s).toMatchObject({ configured: true, connected: false, pendingCount: 0 });
    expect(s.banner.show).toBe(false);
  }
});

test('OAuth 連結：連結網址導到 Google、只要求最小的日曆事件權限；state 不符、授權範圍不足、沒有權限都是錯誤回導，不會寫入連線', async () => {
  const api = apis.cal_google;
  const connect = await api.get(`${CAL}/connect`, { maxRedirects: 0 });
  expect(connect.status()).toBe(307);
  const auth = new URL(connect.headers().location);
  expect(auth.origin + auth.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
  expect(auth.searchParams.get('scope')!.split(' ').sort()).toEqual(['email', 'https://www.googleapis.com/auth/calendar.events.owned', 'openid']);
  expect(auth.searchParams.get('access_type')).toBe('offline');
  expect(auth.searchParams.get('redirect_uri')).toBe(`${TEST_ORIGIN}${CAL}/callback`);
  expect(auth.searchParams.get('state')!.length).toBeGreaterThan(20);
  expect(connect.headers()['set-cookie']).toContain('organization_calendar_google_oauth_state');

  // state 不符：固定的錯誤說明
  const bad = await api.get(`${CAL}/callback?code=mock-code&state=wrong`, { maxRedirects: 0 });
  const badUrl = new URL(bad.headers().location);
  expect(badUrl.pathname).toBe('/organization/calendar');
  expect(badUrl.searchParams.get('google_calendar')).toBe('error');
  expect(badUrl.searchParams.get('google_detail')).toContain('驗證逾時或失敗');
  // 使用者在 Google 上按取消
  const state = auth.searchParams.get('state')!;
  const again = await (async () => {
    const c = await api.get(`${CAL}/connect`, { maxRedirects: 0 });
    const s = new URL(c.headers().location).searchParams.get('state')!;
    return api.get(`${CAL}/callback?error=access_denied&state=${encodeURIComponent(s)}`, { maxRedirects: 0 });
  })();
  expect(new URL(again.headers().location).searchParams.get('google_detail')).toBe('已取消 Google 授權');
  void state;
  // Google 核發的授權範圍沒有日曆寫入權限
  await mockControl(api, { scopeMissing: true });
  const scope = await connectGoogle(api);
  expect(scope.location.searchParams.get('google_calendar')).toBe('error');
  expect(scope.location.searchParams.get('google_detail')).toContain('未包含日曆事件寫入權限');
  await mockControl(api, { scopeMissing: false });
  // 沒有管理權限的人拿著自己的 state 打回調：被擋
  const plainState = await apis.cal_plain.storageState();
  plainState.cookies.push({ name: 'organization_calendar_google_oauth_state', value: 'abc123', domain: 'localhost', path: '/api/organization/calendar/google', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' });
  const plain = await pwRequest.newContext({ baseURL: TEST_ORIGIN, storageState: plainState });
  const denied = await plain.get(`${CAL}/callback?code=mock-code&state=abc123`, { maxRedirects: 0 });
  expect(new URL(denied.headers().location).searchParams.get('google_detail')).toContain('沒有管理 Google 同步的權限');
  await plain.dispose();
  expect(await googleConnection()).toBeNull();
});

test('未連結時新增公司行事：行事照常儲存，同步結果是「尚未連結」', async () => {
  const r = await createEvent('e0');
  expect(r.googleSync.status).toBe('not_connected');
  expect((await companyEventRow(r.event.id)).status).toBe('active');
  expect(await googleLinks()).toEqual([]);
});

test('連結成功：授權換取更新權杖（加密存放）、回導舊網址由舊站轉新版、立即同步既有公司行事；只有一個共用連線', async () => {
  const api = apis.cal_google;
  const { callback, location } = await connectGoogle(api);
  expect(callback.status()).toBe(307);
  expect(location.origin).toBe(TEST_ORIGIN);
  expect(location.pathname).toBe('/organization/calendar'); // 回調網址不變，結果回到舊路徑再由 middleware 轉新版
  expect(location.searchParams.get('google_calendar')).toBe('connected');
  expect(location.searchParams.get('google_detail')).toContain('已連結並同步');

  const conn = await adminDb().from('organization_calendar_google_connections').select('*').eq('id', 1).single();
  expect(conn.data.google_account_email).toBe(MOCK_GOOGLE_EMAIL);
  expect(conn.data.refresh_token_ciphertext).not.toContain('mock-refresh-token');
  expect(conn.data.refresh_token_ciphertext.split('.').length).toBe(3); // iv.tag.密文
  const s = await status('cal_google');
  expect(s).toMatchObject({ connected: true, calendarMatches: true, googleAccountEmail: MOCK_GOOGLE_EMAIL, pendingCount: 0, lastSyncStatus: 'success' });
  expect(s.banner.show).toBe(false);

  // 首次同步：連結前建立的那筆公司行事已經在 Google 上
  const e0 = (await adminDb().from('organization_calendar_events').select('id').eq('title', calTitle('e0')).single()).data;
  const { event } = await mockEventFor(e0.id);
  expect(event?.summary).toBe(calTitle('e0'));

  // 重新連結只會更新同一列
  await connectGoogle(api);
  const rows = await adminDb().from('organization_calendar_google_connections').select('id');
  expect(rows.data).toEqual([{ id: 1 }]);
  expect((await mockSnapshot(api)).calls.some((c) => c.path === '/token' && c.method === 'POST')).toBe(true);
});

test('Q19：新增、修改寫到 Google（描述加註「請勿在此修改，請回系統」）；取消時 Google 事件真的刪除，只刪系統建立的', async () => {
  const api = apis.cal_google;
  await mockControl(api, { addEvents: [{ id: 'manual-by-human', summary: '同事手動建立的事件' }] });

  const created = await createEvent('e1', { description: '大會議室\n請準時', location: '總部會議室', is_all_day: true });
  expect(created.googleSync.status).toBe('synced');
  const first = await mockEventFor(created.event.id);
  expect(first.event?.summary).toBe(calTitle('e1'));
  expect(first.event?.location).toBe('總部會議室');
  expect(first.event?.description).toBe(`會議\n\n大會議室\n請準時\n\n${GOOGLE_SYNC_NOTE}`);
  expect((first.event as any).start).toEqual({ date: '2099-03-10' });
  expect((first.event as any).end).toEqual({ date: '2099-03-12' }); // 全天事件的結束日是「隔天」

  // 指定時間（台北時區）
  const timed = await createEvent('e1-timed', { is_all_day: false, start_date: '2099-03-12', end_date: '2099-03-12', start_time: '09:30', end_time: '11:00' });
  const t = await mockEventFor(timed.event.id);
  expect((t.event as any).start).toEqual({ dateTime: '2099-03-12T09:30:00+08:00', timeZone: 'Asia/Taipei' });
  expect(t.event?.description?.endsWith(GOOGLE_SYNC_NOTE)).toBe(true);

  // 修改：同一個 Google 事件被更新，不會多出第二個
  const before = (await mockSnapshot(api)).events.length;
  const editor = apis.cal_editor;
  const edited = await editor.patch('/api/workspace/calendar/company-events', { data: { ...ev('e1'), id: created.event.id, title: calTitle('e1-renamed'), start_date: '2099-03-10', end_date: '2099-03-10' } });
  expect(edited.status()).toBe(200);
  expect((await edited.json()).googleSync.status).toBe('synced');
  const renamed = await mockEventFor(created.event.id);
  expect(renamed.event?.summary).toBe(calTitle('e1-renamed'));
  expect(renamed.link?.google_event_id).toBe(first.link?.google_event_id);
  expect((await mockSnapshot(api)).events.length).toBe(before);

  // 取消：Google 事件真的刪除，連結紀錄移除；系統裡的行事保留為「已取消」且有紀錄
  const cancelled = await editor.patch('/api/workspace/calendar/company-events', { data: { id: created.event.id, status: 'cancelled' } });
  expect(cancelled.status()).toBe(200);
  expect((await cancelled.json()).googleSync.status).toBe('synced');
  const after = await mockSnapshot(api);
  expect(after.events.some((e) => e.id === first.link?.google_event_id)).toBe(false);
  expect(after.calls.some((c) => c.method === 'DELETE' && c.path.endsWith(`/events/${first.link?.google_event_id}`))).toBe(true);
  expect((await googleLinks()).some((l) => l.source_key === `company:${created.event.id}`)).toBe(false);
  expect((await companyEventRow(created.event.id)).status).toBe('cancelled');
  // 別人在 Google 上手動建立的事件完全沒被動到
  expect(after.events.find((e) => e.id === 'manual-by-human')?.description).toBe('手動建立');
});

test('Q20：同步失敗會留下「待同步」筆數（行事照常儲存）；補同步後警示消失', async () => {
  const api = apis.cal_google;
  await mockControl(api, { failTitles: ['FAILME'] });
  const failed = await createEvent('e2-FAILME');
  expect(failed.googleSync.status).toBe('failed');
  expect((await companyEventRow(failed.event.id)).status).toBe('active'); // 系統先存、Google 後補
  const s = await status('cal_google');
  expect(s.pendingCount).toBe(1);
  expect(s.banner).toMatchObject({ show: true, pendingCount: 1, authInvalid: false });
  expect(s.banner.text).toContain('有 1 筆行事待同步到 Google');

  // 授權沒問題、只是這一筆失敗：立即同步回報失敗筆數，狀態維持待同步
  const partial = await api.post('/api/workspace/calendar/google/sync', { data: {} });
  expect((await partial.json()).failed).toBe(1);
  expect((await status('cal_google')).pendingCount).toBe(1);

  await mockControl(api, { failTitles: [] });
  const ok = await api.post('/api/workspace/calendar/google/sync', { data: {} });
  expect(ok.status()).toBe(200);
  expect(await ok.json()).toMatchObject({ status: 'synced', failed: 0 });
  const done = await status('cal_google');
  expect(done.pendingCount).toBe(0);
  expect(done.banner.show).toBe(false);
});

test('Q20：授權失效（invalid_grant）時頁頂警示出現，且待同步筆數正確（舊版數字會是 0）；重新授權後恢復', async () => {
  const api = apis.cal_google;
  await mockControl(api, { tokenInvalid: true });
  const failed = await createEvent('e3-authfail');
  expect(failed.googleSync.status).toBe('failed');
  expect(failed.googleSync.message).toContain('授權已失效');
  const s = await status('cal_google');
  expect(s.banner).toMatchObject({ show: true, authInvalid: true });
  expect(s.banner.text).toContain('Google 授權已失效');
  expect(s.pendingCount).toBeGreaterThanOrEqual(1);
  expect(s.legacyPendingCount).toBe(0); // 舊版算法：授權失效時沒有連結紀錄帶錯誤，所以是 0 筆、沒人發現
  expect(s.lastSyncError).toContain('授權已失效');
  // 同步與檢查授權都明確失敗
  expect((await api.post('/api/workspace/calendar/google/sync', { data: {} })).status()).toBe(502);
  expect((await api.post('/api/workspace/calendar/google/diagnose', { data: {} })).status()).toBe(502);
  // 舊版狀態 API 的筆數（只算連結上有錯誤的）與新版的差別
  expect((await (await api.get(`${CAL}/status`)).json()).pendingCount).toBe(0);

  await mockControl(api, { tokenInvalid: false });
  const diag = await (await api.post('/api/workspace/calendar/google/diagnose', { data: {} })).json();
  expect(diag).toMatchObject({ canManageCalendarEvents: true, requiredScope: 'https://www.googleapis.com/auth/calendar.events.owned' });
  expect(diag.grantedCalendarScopes).toEqual(['https://www.googleapis.com/auth/calendar.events.owned']);
  expect((await api.post('/api/workspace/calendar/google/sync', { data: {} })).status()).toBe(200);
  const done = await status('cal_google');
  expect(done.pendingCount).toBe(0);
  expect(done.banner.show).toBe(false);
});

test('Q19、Q21：假日發布與取代也同步到 Google；被移除的假日在 Google 上刪除，所有假日描述加註', async () => {
  const holiday = apis.cal_holiday;
  const google = apis.cal_google;
  const publish = async (variant: 'base' | 'changed', replace: boolean) => {
    await mockControl(holiday, { csvVariant: variant });
    const p = await (await holiday.post('/api/workspace/calendar/holidays/preview', { data: { calendar_year: RESERVED_YEAR, use_official_source: true } })).json();
    return holiday.post('/api/workspace/calendar/holidays', {
      data: { calendar_year: RESERVED_YEAR, source_name: p.source_name, source_url: p.source_url, source_revision: p.source_revision, holidays: p.holidays, ...(replace ? { confirm_replace: true } : {}) },
    });
  };
  const first = await publish('base', false);
  expect(first.status()).toBe(201);
  expect((await first.json()).googleSync.status).toBe('synced');
  const holidayEvents = async () => {
    const links = (await googleLinks()).filter((l) => l.source_key.startsWith('holiday:2099-'));
    const snap = await mockSnapshot(google);
    return { links, events: links.map((l) => snap.events.find((e) => e.id === l.google_event_id)) };
  };
  const base = await holidayEvents();
  expect(base.links.length).toBe(5);
  expect(base.events.every((e) => e?.description?.endsWith(GOOGLE_SYNC_NOTE))).toBe(true);
  expect(base.links.map((l) => l.source_key)).toContain('holiday:2099-02-19');
  const removedGoogleId = base.links.find((l) => l.source_key === 'holiday:2099-02-19').google_event_id;

  const second = await publish('changed', true);
  expect(second.status()).toBe(201);
  expect((await second.json()).googleSync.status).toBe('synced');
  const changed = await holidayEvents();
  const keys = changed.links.map((l) => l.source_key);
  expect(keys).not.toContain('holiday:2099-02-19'); // 移除的假日，連結與 Google 事件都不在了
  expect(keys).toContain('holiday:2099-10-10');
  expect((await mockSnapshot(google)).events.some((e) => e.id === removedGoogleId)).toBe(false);
  expect(changed.events.find((e) => e?.summary === '兒童節補假')).toBeTruthy(); // 改名的假日更新同一筆
  expect((await status('cal_google')).pendingCount).toBe(0);
});

test('中斷連結只斷線：Google 上的事件保留，連線列移除，之後不再同步；非管理者不能中斷', async () => {
  const google = apis.cal_google;
  const beforeEvents = (await mockSnapshot(google)).events.length;
  expect(beforeEvents).toBeGreaterThan(0);
  const r = await google.post('/api/workspace/calendar/google/disconnect', { data: {} });
  expect(r.status()).toBe(200);
  expect(await r.json()).toEqual({ disconnected: true });
  const snap = await mockSnapshot(google);
  expect(snap.events.length).toBe(beforeEvents); // 事件保留
  expect(snap.calls.some((c) => c.path === '/revoke')).toBe(true); // 向 Google 撤銷授權
  expect(await googleConnection()).toBeNull();
  const s = await status('cal_google');
  expect(s).toMatchObject({ connected: false });
  expect(s.banner.show).toBe(false);
  // 斷線後新增公司行事：行事照常儲存，Google 不動
  const created = await createEvent('e4-after-disconnect');
  expect(created.googleSync.status).toBe('not_connected');
  expect((await mockSnapshot(google)).events.length).toBe(beforeEvents);
});
