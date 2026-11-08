import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { apiForUser, setupM5Users, type M5User } from '../support/m5-fixtures';
import { GOOGLE_SYNC_NOTE } from '../../lib/workspace/calendar-rules';
import {
  assertCalendarBaseline,
  calTitle,
  cleanupCalendar,
  companyEventRow,
  googleLinks,
  holidaysOf,
  mockControl,
  mockReset,
  mockSnapshot,
  publishedImports,
  RESERVED_YEAR,
} from '../support/m5-calendar-fixtures';

// W24 對等層：舊版 Google 同步（lib/organization/google-calendar.ts 與 /api/organization/calendar/google/**）與新版的同輸入同輸出。
// Google 全部 mock（D17）。新版沿用舊 handler，差異只有 Q19（描述加註）與 Q20（待同步筆數與警示欄位）。

const map = loadMap('google-sync');
const rec = new ParityRecorder('google-sync');
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const KEYS = ['cal_plain', 'cal_creator', 'cal_editor', 'cal_holiday', 'cal_google'];
let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const apis: Record<string, APIRequestContext> = {};
const LEGACY = '/api/organization/calendar';
const NATIVE = '/api/workspace/calendar';
const CAL = '/api/organization/calendar/google';
const TYPE_LABELS: Record<string, string> = { meeting: '會議', activity: '活動', important: '重要事項' };
const HOLIDAY_LABELS: Record<string, string> = { national_holiday: '國定假日', substitute_holiday: '補假日', makeup_workday: '補行上班' };

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertCalendarBaseline();
  const left = await cleanupCalendar();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const s = await setupM5Users(KEYS);
  users = s.users;
  teardownUsers = s.teardown;
  for (const k of KEYS) apis[k] = await apiForUser(users[k]);
  await mockReset(apis.cal_google);
  // 連結（走完整 OAuth，mock）
  const connect = await apis.cal_google.get(`${CAL}/connect`, { maxRedirects: 0 });
  const state = new URL(connect.headers().location).searchParams.get('state')!;
  const cb = await apis.cal_google.get(`${CAL}/callback?code=mock-code&state=${encodeURIComponent(state)}`, { maxRedirects: 0 });
  expect(new URL(cb.headers().location).searchParams.get('google_calendar')).toBe('connected');
});
test.afterAll(async () => {
  await mockReset(apis.cal_google).catch(() => undefined);
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupCalendar(), '清除行事曆測試資料').toEqual([]);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const ev = (tag: string, over: Record<string, unknown> = {}) => ({ title: calTitle(tag), event_type: 'meeting', start_date: '2099-07-10', end_date: '2099-07-10', is_all_day: true, ...over });
const create = async (tag: string, over: Record<string, unknown> = {}, base = NATIVE) => {
  const r = await apis.cal_creator.post(`${base}/company-events`, { data: ev(tag, over) });
  const text = await r.text();
  expect(r.status(), text).toBe(201);
  return JSON.parse(text) as { event: { id: string }; googleSync: { status: string } };
};
const googleEventOf = async (key: string) => {
  const link = (await googleLinks()).find((l) => l.source_key === key);
  const snap = await mockSnapshot(apis.cal_google);
  return { link, event: link?.google_event_id ? snap.events.find((e) => e.id === link.google_event_id) : undefined, snap };
};

test('Q20 同步狀態：欄位一致；同步失敗（連結帶錯誤）時筆數相同；授權失效時舊版是 0、新版算出真實筆數並回警示', async () => {
  const e = entry('status-pending');
  const diffs: Diff[] = [];
  const compareStatus = async (label: string) => {
    const legacy = await (await apis.cal_google.get(`${CAL}/status`)).json();
    const native = await (await apis.cal_google.get(`${NATIVE}/google/status`)).json();
    for (const k of Object.keys(legacy)) {
      if (JSON.stringify(legacy[k]) !== JSON.stringify(native[k])) diffs.push({ kind: 'changed', key: k === 'pendingCount' ? 'pendingCount' : `${label}:${k}`, legacy: legacy[k], native: native[k], detail: label });
    }
    for (const k of Object.keys(native).filter((x) => !(x in legacy))) diffs.push({ kind: 'only-native', key: k, detail: label });
    return { legacy, native };
  };
  // 乾淨：兩邊都是 0
  const clean = await compareStatus('clean');
  expect(clean.legacy.pendingCount).toBe(0);
  expect(clean.native.banner.show).toBe(false);
  // 同步失敗：連結上有錯誤，兩邊筆數相同
  await mockControl(apis.cal_google, { failTitles: ['PARFAIL'] });
  await create('par-PARFAIL');
  const failed = await compareStatus('failed-link');
  expect(failed.legacy.pendingCount).toBe(1);
  expect(failed.native.pendingCount).toBe(1);
  expect(diffs.filter((d) => d.key === 'pendingCount')).toEqual([]); // 到這裡兩邊筆數沒有差異
  await mockControl(apis.cal_google, { failTitles: [] });
  expect((await apis.cal_google.post(`${NATIVE}/google/sync`, { data: {} })).status()).toBe(200);
  // 授權失效：沒有連結紀錄帶錯誤，舊版 0 筆、新版 1 筆以上
  await mockControl(apis.cal_google, { tokenInvalid: true });
  await create('par-authfail');
  const invalid = await compareStatus('auth-invalid');
  expect(invalid.legacy.pendingCount).toBe(0);
  expect(invalid.native.pendingCount).toBeGreaterThanOrEqual(1);
  expect(invalid.native.banner).toMatchObject({ show: true, authInvalid: true });
  await mockControl(apis.cal_google, { tokenInvalid: false });
  expect((await apis.cal_google.post(`${NATIVE}/google/sync`, { data: {} })).status()).toBe(200);
  assertNoUnlistedDiffs(rec.record({ entry: e.id, mechanism: 'api-read', title: 'Google 同步狀態', legacy: { endpoint: `GET ${CAL}/status` }, native: { endpoint: `GET ${NATIVE}/google/status`, status: 200 }, compared: { scenarios: 3 }, diffs }));
  expect(Array.from(new Set(diffs.map((d) => `${d.kind}:${d.key}`))).sort()).toEqual(['changed:pendingCount', 'only-native:banner', 'only-native:legacyPendingCount']);
});

test('Q19 寫到 Google 的事件內容：標題、地點、時間、類型文字與舊格式相同，描述只多一段加註（公司行事與政府假日）', async () => {
  const e = entry('event-description');
  const diffs: Diff[] = [];
  let compared = 0;
  // 公司行事：全天跨日 + 指定時間，兩種
  const cases = [
    { tag: 'par-desc-allday', over: { event_type: 'activity', description: '第一行\n第二行', location: '總部', start_date: '2099-07-20', end_date: '2099-07-22' } },
    { tag: 'par-desc-timed', over: { event_type: 'important', is_all_day: false, start_time: '09:30', end_time: '11:00', start_date: '2099-07-23', end_date: '2099-07-23' } },
    { tag: 'par-desc-empty', over: { description: '' } },
  ];
  for (const c of cases) {
    const made = await create(c.tag, c.over);
    const { event } = await googleEventOf(`company:${made.event.id}`);
    expect(event, c.tag).toBeTruthy();
    const row = await companyEventRow(made.event.id);
    // 舊版 companyPayload（lib/organization/google-calendar.ts 原始碼的逐字邏輯）
    const lines = [TYPE_LABELS[row.event_type] || '公司行事', row.description?.trim()].filter(Boolean);
    const legacyDescription = lines.join('\n\n');
    const next = (d: string) => new Date(new Date(`${d}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
    const legacyStart = row.is_all_day ? { date: row.start_date } : { dateTime: `${row.start_date}T${row.start_time}+08:00`, timeZone: 'Asia/Taipei' };
    const legacyEnd = row.is_all_day ? { date: next(row.end_date) } : { dateTime: `${row.end_date}T${row.end_time}+08:00`, timeZone: 'Asia/Taipei' };
    const e2 = event as any;
    for (const [k, l, n] of [['summary', row.title, e2.summary], ['location', row.location || '', e2.location], ['start', legacyStart, e2.start], ['end', legacyEnd, e2.end]] as [string, unknown, unknown][]) {
      compared += 1;
      if (JSON.stringify(l) !== JSON.stringify(n)) diffs.push({ kind: 'changed', key: `${c.tag}:${k}`, legacy: l, native: n });
    }
    compared += 1;
    if (legacyDescription !== e2.description) diffs.push({ kind: 'changed', key: 'description', legacy: legacyDescription, native: e2.description, detail: c.tag });
    expect(e2.description).toBe(`${legacyDescription}\n\n${GOOGLE_SYNC_NOTE}`);
  }
  // 政府假日
  await mockControl(apis.cal_holiday, { csvVariant: 'base' });
  const p = await (await apis.cal_holiday.post(`${NATIVE}/holidays/preview`, { data: { calendar_year: RESERVED_YEAR, use_official_source: true } })).json();
  const pub = await apis.cal_holiday.post(`${NATIVE}/holidays`, { data: { calendar_year: RESERVED_YEAR, source_name: p.source_name, source_url: p.source_url, source_revision: p.source_revision, holidays: p.holidays } });
  expect(pub.status()).toBe(201);
  const imp = (await publishedImports()).find((i) => i.status === 'published');
  for (const h of await holidaysOf(imp.id)) {
    const { event } = await googleEventOf(`holiday:${h.holiday_date}`);
    const e2 = event as any;
    const legacyDescription = `政府公告參考：${HOLIDAY_LABELS[h.day_type] || '假日'}`;
    const next = new Date(new Date(`${h.holiday_date}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);
    compared += 3;
    if (e2.summary !== h.name) diffs.push({ kind: 'changed', key: `holiday:${h.holiday_date}:summary`, legacy: h.name, native: e2.summary });
    if (JSON.stringify(e2.start) !== JSON.stringify({ date: h.holiday_date }) || JSON.stringify(e2.end) !== JSON.stringify({ date: next })) diffs.push({ kind: 'changed', key: `holiday:${h.holiday_date}:date` });
    if (legacyDescription !== e2.description) diffs.push({ kind: 'changed', key: 'description', legacy: legacyDescription, native: e2.description, detail: h.holiday_date });
    expect(e2.description).toBe(`${legacyDescription}\n\n${GOOGLE_SYNC_NOTE}`);
  }
  assertNoUnlistedDiffs(rec.record({ entry: e.id, mechanism: 'write-readback', title: 'Google 事件內容', legacy: { endpoint: 'companyPayload／holidayPayload（舊格式）' }, native: { endpoint: 'Google mock 事件' }, compared: { fields: compared }, diffs }));
  expect(Array.from(new Set(diffs.map((d) => d.key)))).toEqual(['description']);
});

test('取消公司行事：舊 PATCH 與新 PATCH 都真的刪除 Google 事件與連結紀錄，別人手動建立的事件不動', async () => {
  const e = entry('cancel-deletes');
  await mockControl(apis.cal_google, { addEvents: [{ id: 'human-par', summary: '手動' }] });
  const run = async (base: string, tag: string) => {
    const made = await create(tag, { start_date: '2099-08-01', end_date: '2099-08-01' });
    const before = await googleEventOf(`company:${made.event.id}`);
    const gid = before.link?.google_event_id;
    const callsBefore = before.snap.calls.filter((c) => c.method === 'DELETE').length;
    const cancel = await apis.cal_editor.patch(`${base}/company-events`, { data: { id: made.event.id, status: 'cancelled' } });
    const after = await googleEventOf(`company:${made.event.id}`);
    return {
      existedBefore: Boolean(before.event),
      cancelStatus: cancel.status(),
      googleSync: (await cancel.json()).googleSync.status,
      eventGone: !after.snap.events.some((x) => x.id === gid),
      linkGone: !after.link,
      deleteCalls: after.snap.calls.filter((c) => c.method === 'DELETE').length - callsBefore,
      rowStatus: (await companyEventRow(made.event.id)).status,
      humanKept: after.snap.events.some((x) => x.id === 'human-par'),
    };
  };
  const legacy = await run(LEGACY, 'par-cancel-legacy');
  const native = await run(NATIVE, 'par-cancel-native');
  const diffs: Diff[] = [];
  for (const k of Object.keys(legacy) as (keyof typeof legacy)[]) if (legacy[k] !== native[k]) diffs.push({ kind: 'changed', key: k, legacy: legacy[k], native: native[k] });
  assertNoUnlistedDiffs(rec.record({ entry: e.id, mechanism: 'write-readback', title: '取消公司行事刪除 Google 事件', legacy: { endpoint: `PATCH ${LEGACY}/company-events` }, native: { endpoint: `PATCH ${NATIVE}/company-events`, status: 200 }, compared: { fields: Object.keys(legacy).length }, diffs }));
  expect(diffs).toEqual([]);
  expect(legacy).toEqual({ existedBefore: true, cancelStatus: 200, googleSync: 'synced', eventGone: true, linkGone: true, deleteCalls: 1, rowStatus: 'cancelled', humanKept: true });
});

test('OAuth 連結與回調沿用舊 handler：連結網址、最小授權範圍、回調網址、state 驗證與回導路徑不變；新版畫面的連結按鈕指向舊連結網址', async () => {
  const e = entry('oauth-connect');
  const diffs: Diff[] = [];
  const connect = await apis.cal_google.get(`${CAL}/connect`, { maxRedirects: 0 });
  const auth = new URL(connect.headers().location);
  const facts = {
    endpoint: auth.origin + auth.pathname,
    scope: auth.searchParams.get('scope')!.split(' ').sort().join(' '),
    redirect: auth.searchParams.get('redirect_uri'),
    offline: auth.searchParams.get('access_type'),
  };
  const legacySource = read('app/api/organization/calendar/google/connect/route.ts');
  const expected = {
    endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'email https://www.googleapis.com/auth/calendar.events.owned openid',
    redirect: 'http://localhost:3002/api/organization/calendar/google/callback',
    offline: 'offline',
  };
  for (const k of Object.keys(expected) as (keyof typeof expected)[]) if (facts[k] !== expected[k]) diffs.push({ kind: 'changed', key: k, legacy: expected[k], native: facts[k] });
  expect(legacySource).toContain("'https://www.googleapis.com/auth/calendar.events.owned'");
  // 新版畫面的連結按鈕就是舊連結網址
  expect(read('vue-workspace/src/pages/OrganizationCalendar.vue')).toContain('const href = "/api/organization/calendar/google/connect";');
  // 回調：state 不符與取消授權的回導路徑沒有改（舊 handler 原樣）
  const bad = await apis.cal_google.get(`${CAL}/callback?code=x&state=bad`, { maxRedirects: 0 });
  const u = new URL(bad.headers().location);
  if (u.pathname !== '/organization/calendar' || u.searchParams.get('google_calendar') !== 'error') diffs.push({ kind: 'changed', key: 'callback-redirect', legacy: '/organization/calendar?google_calendar=error', native: u.pathname + u.search });
  assertNoUnlistedDiffs(rec.record({ entry: e.id, mechanism: 'write-readback', title: 'OAuth 連結與回調', legacy: { endpoint: `GET ${CAL}/connect` }, native: { endpoint: 'CalendarGooglePanel 連結按鈕 → 舊連結網址', status: 307 }, compared: { facts: 5 }, diffs }));
  expect(diffs).toEqual([]);
});
