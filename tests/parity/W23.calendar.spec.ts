import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { adminDb, apiForUser, M5_SCENARIOS, setupM5Users, type M5User } from '../support/m5-fixtures';
import { createAuthUser } from '../support/m5-org-fixtures';
import {
  assertCalendarBaseline,
  auditRows,
  CAL_MARKER_PREFIX,
  calTitle,
  cleanupCalendar,
  holidaysOf,
  mockControl,
  mockReset,
  publishedImports,
  RESERVED_YEAR,
  seedResignedEmployee,
} from '../support/m5-calendar-fixtures';

// W23 對等層：舊版年度行事曆（/api/organization/calendar/**、舊頁面伺服器端權限旗標）與新版（/api/workspace/calendar/**）
// 同一個登入者、同一份輸入、同一份 mock 官方日曆，結果逐項比對；差異都列在 tests/parity/allowlist.json（page: calendar）。
// 新版寫入是委派舊 handler，所以寫入與讀取結果本來就應該相同；真正的差異只有 Q18、Q21、按鈕旗標與舊網址轉址。

const map = loadMap('calendar');
const rec = new ParityRecorder('calendar');
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const uniq = () => Math.random().toString(36).slice(2, 8);
const KEYS = ['cal_plain', 'cal_creator', 'cal_editor', 'cal_holiday', 'cal_google', 'cal_admin_ungranted', 'cal_all'];
let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const apis: Record<string, APIRequestContext> = {};
const extra: string[] = [];
const LEGACY = '/api/organization/calendar';
const NATIVE = '/api/workspace/calendar';

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
  await mockReset(apis.cal_plain);
});
test.afterAll(async () => {
  await mockReset(apis.cal_plain).catch(() => undefined);
  for (const c of Object.values(apis)) await c.dispose();
  for (const id of extra) await adminDb().auth.admin.deleteUser(id);
  expect(await cleanupCalendar(), '清除行事曆測試資料').toEqual([]);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const ev = (tag: string, over: Record<string, unknown> = {}) => ({ title: calTitle(tag), event_type: 'meeting', start_date: '2099-04-10', end_date: '2099-04-11', is_all_day: true, ...over });
const byId = (rows: any[]) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
const norm = (row: any) => ({
  event_type: row.event_type, start_date: row.start_date, end_date: row.end_date, is_all_day: row.is_all_day,
  start_time: row.start_time, end_time: row.end_time, location: row.location, description: row.description, status: row.status,
});

test('舊版規則的來源與前提沒有變（被改動時先失敗，提醒重新比對）', () => {
  const page = read('app/organization/calendar/page.tsx');
  for (const code of ['CREATE_PERMISSION', 'EDIT_PERMISSION', 'HOLIDAY_MANAGE_PERMISSION', 'GOOGLE_MANAGE_PERMISSION']) expect(page).toContain(code);
  expect(page.match(/hasPermission\(user\.id/g)?.length).toBe(4);
  expect(read('hooks/useNavbarPermissions.ts')).toContain('canViewAnnualCalendar: true');
  expect(read('components/Navbar.tsx')).toContain("show: permissions.canViewAnnualCalendar");
  expect(read('app/api/organization/calendar/route.ts')).toContain(".eq('status', 'active')");
  expect(read('supabase/migrations/20261008100000_organization_annual_calendar.sql')).toContain("organization_calendar_events_read");
});

test('讀取：舊 API 與新 API 的公司行事、個人行程、假日、假日來源完全相同（新版另多 currentUserId 與 permissions）', async () => {
  const e = entry('year-read');
  const c = await apis.cal_creator.post(`${NATIVE}/company-events`, { data: ev('par-read-company') });
  expect(c.status()).toBe(201);
  const p = await apis.cal_plain.post(`${NATIVE}/personal-events`, { data: { ...ev('par-read-personal'), share_with_user_ids: [users.cal_creator.id] } });
  expect(p.status()).toBe(201);
  await mockControl(apis.cal_holiday, { csvVariant: 'base' });
  const prev = await (await apis.cal_holiday.post(`${NATIVE}/holidays/preview`, { data: { calendar_year: RESERVED_YEAR, use_official_source: true } })).json();
  expect((await apis.cal_holiday.post(`${NATIVE}/holidays`, { data: { calendar_year: RESERVED_YEAR, source_name: prev.source_name, source_url: prev.source_url, source_revision: prev.source_revision, holidays: prev.holidays } })).status()).toBe(201);

  const diffs: Diff[] = [];
  let compared = 0;
  for (const k of ['cal_plain', 'cal_creator', 'cal_google']) {
    const legacy = await (await apis[k].get(`${LEGACY}?year=${RESERVED_YEAR}`)).json();
    const native = await (await apis[k].get(`${NATIVE}?year=${RESERVED_YEAR}`)).json();
    for (const f of ['companyEvents', 'personalEvents', 'holidays', 'holidaySource']) {
      compared += 1;
      const a = Array.isArray(legacy[f]) ? byId(legacy[f]) : legacy[f];
      const b = Array.isArray(native[f]) ? byId(native[f]) : native[f];
      if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push({ kind: 'changed', key: `${k}:${f}`, legacy: a, native: b });
    }
    for (const extraKey of Object.keys(native).filter((x) => !(x in legacy))) diffs.push({ kind: 'only-native', key: extraKey });
    // 個人行程分享：creator 看得到被分享的那筆、google 帳號看不到
    const mine = (native.personalEvents as any[]).some((x) => x.title === calTitle('par-read-personal'));
    expect(mine, k).toBe(k !== 'cal_google');
  }
  assertNoUnlistedDiffs(rec.record({ entry: e.id, mechanism: 'api-read', title: '讀取年度行事曆', legacy: { endpoint: `GET ${LEGACY}` }, native: { endpoint: `GET ${NATIVE}`, status: 200 }, compared: { fields: compared }, diffs }));
  expect(diffs.filter((d) => d.kind === 'changed')).toEqual([]);
  expect(diffs.map((d) => d.key).sort()).toEqual(['currentUserId', 'currentUserId', 'currentUserId', 'permissions', 'permissions', 'permissions']);
});

test('按鈕旗標：舊頁（hasPermission，管理員一律放行）vs 新版；一般帳號相同，只有沒被授予的舊式管理員不同，而且舊版按下去儲存會失敗', async () => {
  const e = entry('permission-flags');
  const codes: Record<string, string> = {
    createCompany: 'organization.calendar.company.create', editCompany: 'organization.calendar.company.edit',
    manageHolidays: 'organization.calendar.holiday.manage', manageGoogle: 'organization.calendar.google.manage',
  };
  const diffs: Diff[] = [];
  let compared = 0;
  for (const k of KEYS) {
    const sc = M5_SCENARIOS[k];
    const native = (await (await apis[k].get(`${NATIVE}?year=${RESERVED_YEAR}`)).json()).permissions;
    for (const [flag, code] of Object.entries(codes)) {
      // 舊頁：lib/permissions/check hasPermission = 舊式身分 admin 一律 true，否則看資料庫授權
      const legacy = sc.profileRole === 'admin' || sc.perms.includes(code);
      compared += 1;
      if (legacy !== native[flag]) diffs.push({ kind: 'changed', key: `${k}:${flag}`, legacy, native: native[flag] });
    }
  }
  // 舊版按鈕按下去：管理員沒被授予，舊 handler 的應用層檢查放行、資料庫規則擋下（500）
  const adm = apis.cal_admin_ungranted;
  const create = await adm.post(`${LEGACY}/company-events`, { data: ev('par-admin') });
  expect(create.status()).toBe(500);
  expect((await create.json()).error).toMatch(/row-level security|permission/i);
  const holiday = await adm.post(`${LEGACY}/holidays`, { data: { calendar_year: 2098, source_name: calTitle('adm'), source_url: 'https://example.test', holidays: [{ holiday_date: '2098-01-01', name: 'x', day_type: 'national_holiday' }] } });
  expect(holiday.status()).toBe(500);
  expect(await publishedImports(2098)).toEqual([]);
  const { data } = await adminDb().from('organization_calendar_events').select('id').eq('title', calTitle('par-admin'));
  expect(data || []).toEqual([]);
  assertNoUnlistedDiffs(rec.record({ entry: e.id, mechanism: 'ui-extract', title: '按鈕旗標', legacy: { endpoint: 'app/organization/calendar/page.tsx' }, native: { endpoint: `GET ${NATIVE} permissions` }, compared: { flags: compared }, diffs }));
  expect(diffs.map((d) => d.key).sort()).toEqual(['cal_admin_ungranted:createCompany', 'cal_admin_ungranted:editCompany', 'cal_admin_ungranted:manageHolidays']);
});

test('公司行事寫入：同一份輸入打舊 API 與新 API，狀態、錯誤訊息、資料庫欄位、異動紀錄都相同', async () => {
  const e = entry('company-write');
  const run = async (base: string, tag: string) => {
    const out: Record<string, unknown> = {};
    const created = await apis.cal_editor.post(`${base}/company-events`, { data: ev(tag, { location: '會議室', description: '說明', is_all_day: false, start_time: '09:00', end_time: '10:00', end_date: '2099-04-10' }) });
    out.createStatus = created.status();
    const id = (await created.json()).event.id as string;
    const updated = await apis.cal_editor.patch(`${base}/company-events`, { data: { ...ev(tag, { title: calTitle(`${tag}-x`), end_date: '2099-04-12' }), id } });
    out.updateStatus = updated.status();
    out.rowAfterUpdate = norm((await adminDb().from('organization_calendar_events').select('*').eq('id', id).single()).data);
    const cancelled = await apis.cal_editor.patch(`${base}/company-events`, { data: { id, status: 'cancelled' } });
    out.cancelStatus = cancelled.status();
    out.rowAfterCancel = norm((await adminDb().from('organization_calendar_events').select('*').eq('id', id).single()).data);
    out.audit = (await auditRows(id)).map((a) => a.action);
    // 沒有權限與欄位錯誤
    const errors: [number, string][] = [];
    const denied = await apis.cal_plain.post(`${base}/company-events`, { data: ev(`${tag}-denied`) });
    errors.push([denied.status(), (await denied.json()).error]);
    const noEdit = await apis.cal_creator.patch(`${base}/company-events`, { data: { id, status: 'cancelled' } });
    errors.push([noEdit.status(), (await noEdit.json()).error]);
    for (const over of [{ title: '' }, { event_type: 'x' }, { end_date: '2099-04-01' }, { location: 'x'.repeat(501) }, { is_all_day: false, start_time: '10:00', end_time: '09:00', end_date: '2099-04-10' }]) {
      const r = await apis.cal_creator.post(`${base}/company-events`, { data: ev(`${tag}-bad`, over) });
      errors.push([r.status(), (await r.json()).error]);
    }
    out.errors = errors;
    return out;
  };
  const legacy = await run(LEGACY, 'par-cw-legacy');
  const native = await run(NATIVE, 'par-cw-native');
  const diffs: Diff[] = [];
  for (const k of Object.keys(legacy)) if (JSON.stringify(legacy[k]) !== JSON.stringify(native[k])) diffs.push({ kind: 'changed', key: k, legacy: legacy[k], native: native[k] });
  assertNoUnlistedDiffs(rec.record({ entry: e.id, mechanism: 'write-readback', title: '公司行事寫入', legacy: { endpoint: `POST/PATCH ${LEGACY}/company-events` }, native: { endpoint: `POST/PATCH ${NATIVE}/company-events` }, compared: { steps: Object.keys(legacy).length, errorCases: 7 }, diffs }));
  expect(diffs).toEqual([]);
  expect(legacy.audit).toEqual(['created', 'updated', 'cancelled']);
});

test('個人行程寫入與分享：舊 API 與新 API 結果相同（建立者改和刪、分享給同事、同事只能看）', async () => {
  const e = entry('personal-write');
  const run = async (base: string, tag: string) => {
    const out: Record<string, unknown> = {};
    const created = await apis.cal_plain.post(`${base}/personal-events`, { data: { ...ev(tag, { location: '外面' }), share_with_user_ids: [users.cal_creator.id] } });
    out.createStatus = created.status();
    const id = (await created.json()).event.id as string;
    const row = (await adminDb().from('organization_personal_calendar_events').select('*').eq('id', id).single()).data;
    out.row = { start_date: row.start_date, end_date: row.end_date, is_all_day: row.is_all_day, location: row.location, owner: row.owner_id === users.cal_plain.id };
    out.shares = ((await adminDb().from('organization_personal_calendar_event_shares').select('shared_with_user_id,shared_by_user_id,parent_share_id,revoked_at').eq('event_id', id)).data || []).map((s: any) => ({ with: s.shared_with_user_id === users.cal_creator.id, by: s.shared_by_user_id === users.cal_plain.id, parent: s.parent_share_id, revoked: s.revoked_at }));
    out.otherCanSee = ((await (await apis.cal_creator.get(`${base === LEGACY ? LEGACY : NATIVE}?year=${RESERVED_YEAR}`)).json()).personalEvents as any[]).some((x) => x.id === id);
    const otherPatch = await apis.cal_creator.patch(`${base}/personal-events`, { data: { ...ev(tag, { title: 'hacked' }), id } });
    out.otherPatchOk = otherPatch.ok();
    out.titleStillMine = (await adminDb().from('organization_personal_calendar_events').select('title').eq('id', id).single()).data.title === calTitle(tag);
    out.ownerPatch = (await apis.cal_plain.patch(`${base}/personal-events`, { data: { ...ev(tag, { title: calTitle(`${tag}-x`) }), id } })).status();
    out.ownerDelete = (await apis.cal_plain.delete(`${base}/personal-events?id=${id}`)).status();
    out.gone = ((await adminDb().from('organization_personal_calendar_events').select('id').eq('id', id)).data || []).length === 0;
    return out;
  };
  const legacy = await run(LEGACY, 'par-pw-legacy');
  const native = await run(NATIVE, 'par-pw-native');
  const diffs: Diff[] = [];
  for (const k of Object.keys(legacy)) if (JSON.stringify(legacy[k]) !== JSON.stringify(native[k])) diffs.push({ kind: 'changed', key: k, legacy: legacy[k], native: native[k] });
  assertNoUnlistedDiffs(rec.record({ entry: e.id, mechanism: 'write-readback', title: '個人行程寫入與分享', legacy: { endpoint: `${LEGACY}/personal-events` }, native: { endpoint: `${NATIVE}/personal-events` }, compared: { steps: Object.keys(legacy).length }, diffs }));
  expect(diffs).toEqual([]);
  expect(legacy).toMatchObject({ createStatus: 201, otherCanSee: true, otherPatchOk: false, titleStillMine: true, ownerPatch: 200, ownerDelete: 200, gone: true });
});

test('Q18 分享對象搜尋：同一個查詢，舊版列出停用與離職，新版只列在職；其餘相同', async () => {
  const e = entry('people-search');
  const token = `PAR18${uniq()}`;
  const mk = async (tag: string, o: { ban?: boolean; code?: string } = {}) => {
    const u = await createAuthUser(`w23-par-${tag}-${uniq()}`, { ban: o.ban, employeeCode: o.code });
    extra.push(u.id);
    await adminDb().from('profiles').update({ full_name: `${token}${tag}` }).eq('id', u.id);
    return u;
  };
  const code = `ZTTW23${uniq().toUpperCase()}`;
  const active = await mk('active');
  const banned = await mk('banned', { ban: true });
  const resigned = await mk('resigned', { code });
  await seedResignedEmployee(code, `${token}resigned`);
  const ids = async (base: string) => ((await (await apis.cal_plain.get(`${base}/people?q=${encodeURIComponent(token)}`)).json()).people as any[]).map((p) => p.id);
  const legacy = await ids(LEGACY);
  const native = await ids(NATIVE);
  const label = new Map([[active.id, 'active'], [banned.id, 'banned'], [resigned.id, 'resigned']]);
  const diffs: Diff[] = [];
  for (const id of legacy) if (!native.includes(id)) diffs.push({ kind: 'only-legacy', key: label.get(id) || id });
  for (const id of native) if (!legacy.includes(id)) diffs.push({ kind: 'only-native', key: label.get(id) || id });
  assertNoUnlistedDiffs(rec.record({ entry: e.id, mechanism: 'api-read', title: '分享對象搜尋', legacy: { endpoint: `GET ${LEGACY}/people` }, native: { endpoint: `GET ${NATIVE}/people`, status: 200 }, compared: { legacyCount: legacy.length, nativeCount: native.length }, diffs }));
  expect(diffs.map((d) => `${d.kind}:${d.key}`).sort()).toEqual(['only-legacy:banned', 'only-legacy:resigned']);
  expect(native).toEqual([active.id]);
});

test('政府假日預覽：同一份 mock 官方日曆，舊預覽與新預覽解析出的清單相同（新版另回現行版本與差異）', async () => {
  const e = entry('holiday-preview');
  await mockControl(apis.cal_holiday, { csvVariant: 'base', officialFail: false });
  // 先清掉前面測試發布的 2099 版本，讓兩邊都是「第一次」
  await adminDb().from('organization_calendar_holiday_imports').delete().like('source_name', `${CAL_MARKER_PREFIX}%`);
  const body = { calendar_year: RESERVED_YEAR, use_official_source: true };
  const legacy = await (await apis.cal_holiday.post(`${LEGACY}/holidays/preview`, { data: body })).json();
  const native = await (await apis.cal_holiday.post(`${NATIVE}/holidays/preview`, { data: body })).json();
  const diffs: Diff[] = [];
  for (const k of ['calendar_year', 'source_url', 'source_revision', 'holidays', 'count']) {
    if (JSON.stringify(legacy[k]) !== JSON.stringify(native[k])) diffs.push({ kind: 'changed', key: k, legacy: legacy[k], native: native[k] });
  }
  // 測試站為了讓 sweeper 辨識，會在新版預覽的來源名稱前加測試標記（正式與一般環境不會）
  expect(native.source_name).toBe(`${CAL_MARKER_PREFIX}${legacy.source_name}`);
  for (const k of Object.keys(native).filter((x) => !(x in legacy))) diffs.push({ kind: 'only-native', key: k });
  // 錯誤回應也相同（官方沒有該年度資料）
  const bad = { calendar_year: 2098, use_official_source: true };
  const lb = await apis.cal_holiday.post(`${LEGACY}/holidays/preview`, { data: bad });
  const nb = await apis.cal_holiday.post(`${NATIVE}/holidays/preview`, { data: bad });
  if (lb.status() !== nb.status() || (await lb.json()).error !== (await nb.json()).error) diffs.push({ kind: 'changed', key: 'error-2098' });
  assertNoUnlistedDiffs(rec.record({ entry: e.id, mechanism: 'api-read', title: '政府假日預覽', legacy: { endpoint: `POST ${LEGACY}/holidays/preview` }, native: { endpoint: `POST ${NATIVE}/holidays/preview`, status: 200 }, compared: { holidays: legacy.holidays.length }, diffs }));
  expect(diffs.map((d) => `${d.kind}:${d.key}`).sort()).toEqual(['only-native:diff', 'only-native:existing']);
  expect(legacy.holidays.length).toBe(5);
});

test('Q21 同年度再次發布：舊版直接取代、新版要先確認；確認後資料庫結果相同', async () => {
  const e = entry('holiday-republish');
  const holiday = apis.cal_holiday;
  const wipe = () => adminDb().from('organization_calendar_holiday_imports').delete().like('source_name', `${CAL_MARKER_PREFIX}%`);
  const post = async (base: string, variant: 'base' | 'changed', extraBody: Record<string, unknown> = {}) => {
    await mockControl(holiday, { csvVariant: variant });
    const p = await (await holiday.post(`${NATIVE}/holidays/preview`, { data: { calendar_year: RESERVED_YEAR, use_official_source: true } })).json();
    return holiday.post(`${base}/holidays`, { data: { calendar_year: RESERVED_YEAR, source_name: p.source_name, source_url: p.source_url, source_revision: p.source_revision, holidays: p.holidays, ...extraBody } });
  };
  const state = async () => {
    const imports = await publishedImports();
    const current = imports.find((i) => i.status === 'published');
    return { statuses: imports.map((i) => i.status).sort(), holidays: current ? (await holidaysOf(current.id)).map((h) => `${h.holiday_date}:${h.name}:${h.day_type}`) : [] };
  };
  await wipe();
  const legacyFirst = await post(LEGACY, 'base');
  const legacySecond = await post(LEGACY, 'changed'); // 舊版：沒有確認，直接取代
  const legacyState = await state();
  await wipe();
  const nativeFirst = await post(NATIVE, 'base');
  const nativeSecond = await post(NATIVE, 'changed'); // 新版：先 409
  const stillOld = await state();
  const nativeConfirmed = await post(NATIVE, 'changed', { confirm_replace: true });
  const nativeState = await state();
  const diffs: Diff[] = [];
  if (legacySecond.status() !== nativeSecond.status()) diffs.push({ kind: 'status', key: 'republish-without-confirm', legacy: legacySecond.status(), native: nativeSecond.status() });
  if (legacyFirst.status() !== nativeFirst.status()) diffs.push({ kind: 'status', key: 'first-publish', legacy: legacyFirst.status(), native: nativeFirst.status() });
  if (legacyFirst.status() !== nativeConfirmed.status()) diffs.push({ kind: 'status', key: 'confirmed-republish', legacy: legacySecond.status(), native: nativeConfirmed.status() });
  if (JSON.stringify(legacyState) !== JSON.stringify(nativeState)) diffs.push({ kind: 'changed', key: 'final-state', legacy: legacyState, native: nativeState });
  assertNoUnlistedDiffs(rec.record({ entry: e.id, mechanism: 'write-readback', title: '政府假日再次發布', legacy: { endpoint: `POST ${LEGACY}/holidays` }, native: { endpoint: `POST ${NATIVE}/holidays`, status: nativeSecond.status() }, compared: { steps: 3 }, diffs }));
  expect(diffs.map((d) => d.key)).toEqual(['republish-without-confirm']);
  expect(legacySecond.status()).toBe(201);
  expect(nativeSecond.status()).toBe(409);
  expect(stillOld.holidays.some((h) => h.startsWith('2099-02-19'))).toBe(true); // 沒確認前資料沒變
  expect(legacyState.statuses).toEqual(['published', 'superseded']);
  expect(nativeState.holidays.some((h) => h.startsWith('2099-10-10'))).toBe(true);
});

test('舊網址：舊頁改為 307 轉新版；Google 回調網址與回導路徑不變；導覽入口舊版新版都對所有登入者顯示', async () => {
  const e = entry('legacy-url');
  expect(fs.existsSync(path.join(ROOT, 'app/organization/calendar/page.tsx'))).toBe(true); // 舊頁檔案仍在
  const r = await apis.cal_plain.get('/organization/calendar', { maxRedirects: 0 });
  const diffs: Diff[] = [];
  const location = r.headers().location || '';
  if (r.status() !== 200) diffs.push({ kind: 'changed', key: 'legacy-page', legacy: '200（舊頁直接顯示）', native: `${r.status()} → ${location}` });
  expect(r.status()).toBe(307);
  expect(location).toContain('/workspace/index.html#/open/calendar');
  // 回調網址不變：state 不符時仍回導到 /organization/calendar（舊 handler 原樣）
  const cb = await apis.cal_google.get('/api/organization/calendar/google/callback?code=x&state=bad', { maxRedirects: 0 });
  expect(cb.status()).toBe(307);
  expect(new URL(cb.headers().location).pathname).toBe('/organization/calendar');
  // 導覽入口
  const session = await (await apis.cal_plain.get('/api/workspace/session')).json();
  const nav = session.navigation.flatMap((g: any) => g.items).find((i: any) => i.label === '年度行事曆');
  expect(nav).toBeTruthy();
  expect(nav.href).toBe('/organization/calendar');
  assertNoUnlistedDiffs(rec.record({ entry: e.id, mechanism: 'navigation', title: '舊網址與導覽入口', legacy: { endpoint: '/organization/calendar' }, native: { endpoint: '/organization/calendar → workspace', status: r.status() }, compared: { urls: 3 }, diffs }));
  expect(diffs).toHaveLength(1);
});
