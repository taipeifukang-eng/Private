import { expect, test, request as pwRequest, type APIRequestContext } from '@playwright/test';
import { adminDb, apiForUser, setupM5Users, type M5User } from '../support/m5-fixtures';
import { createAuthUser } from '../support/m5-org-fixtures';
import { TEST_ORIGIN } from '../support/auth';
import {
  assertCalendarBaseline,
  auditRows,
  calTitle,
  cleanupCalendar,
  companyEventRow,
  holidaysOf,
  mockControl,
  mockReset,
  personalEventRow,
  publishedImports,
  RESERVED_YEAR,
  seedResignedEmployee,
} from '../support/m5-calendar-fixtures';

// W23 整合層：年度行事曆 API（/api/workspace/calendar，委派舊 /api/organization/calendar/**）。
//  Q17 所有登入者都能看；三個獨立權限（新增公司行事、修改取消、匯入假日）以資料庫規則為準；
//  Q18 分享對象搜尋排除停用與離職；Q21 同年度再發布要先看差異並二次確認。
// 外部服務全 mock（D17）：人事總處辦公日曆由測試站假回應提供（只有 2099 年）。資料只用保留年度 2099，標題帶「[自動測試]M5W23」。

const KEYS = ['cal_plain', 'cal_creator', 'cal_editor', 'cal_holiday', 'cal_google', 'cal_all', 'cal_admin_ungranted'];
let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const apis: Record<string, APIRequestContext> = {};
const uniq = () => Math.random().toString(36).slice(2, 8);
const Q18 = `Q18X${uniq()}`;
const extra: { id: string; email: string }[] = [];

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
  for (const c of Object.values(apis)) await c.dispose();
  const left = await cleanupCalendar();
  for (const u of extra) await adminDb().auth.admin.deleteUser(u.id);
  expect(left, '清除行事曆測試資料').toEqual([]);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const year = (api: APIRequestContext, y = RESERVED_YEAR) => api.get(`/api/workspace/calendar?year=${y}`);
const ev = (tag: string, over: Record<string, unknown> = {}) => ({
  title: calTitle(tag), event_type: 'meeting', start_date: '2099-03-10', end_date: '2099-03-10', is_all_day: true, ...over,
});

test('Q17：所有登入者都能讀年度行事曆（含沒有任何角色的帳號）；未登入 401；session 回報 calendar 且導覽是 workspace 分頁', async () => {
  for (const k of KEYS) {
    const r = await year(apis[k]);
    expect(r.status(), k).toBe(200);
    const body = await r.json();
    for (const f of ['companyEvents', 'personalEvents', 'holidays', 'permissions', 'currentUserId']) expect(body, `${k}:${f}`).toHaveProperty(f);
  }
  const norole = await createAuthUser(`w23-norole-${uniq()}`);
  extra.push(norole);
  const nr = await apiForUser({ key: 'norole', id: norole.id, email: norole.email, password: norole.password });
  expect((await year(nr)).status(), '沒有任何角色的帳號').toBe(200);
  await nr.dispose();

  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  expect((await year(anon)).status()).toBe(401);
  await anon.dispose();

  const session = await (await apis.cal_plain.get('/api/workspace/session')).json();
  expect(session.capabilities.calendar).toBe(true);
  const item = session.navigation.flatMap((g: any) => g.items).find((i: any) => i.label === '年度行事曆');
  expect(item).toMatchObject({ kind: 'calendar', href: '/organization/calendar' }); // 導覽只列出有權進入的項目

  expect((await apis.cal_plain.get('/api/workspace/calendar?year=1999')).status()).toBe(400);
  expect((await apis.cal_plain.get('/api/workspace/calendar')).status()).toBe(400);
});

test('三個獨立權限旗標：各自獨立；舊式身分管理員沒被授予就不能編公司行事與假日（資料庫規則，沒有管理員繞過）', async () => {
  const flags = async (k: string) => (await (await year(apis[k])).json()).permissions;
  expect(await flags('cal_plain')).toEqual({ createCompany: false, editCompany: false, manageHolidays: false, manageGoogle: false });
  expect(await flags('cal_creator')).toEqual({ createCompany: true, editCompany: false, manageHolidays: false, manageGoogle: false });
  expect(await flags('cal_editor')).toEqual({ createCompany: true, editCompany: true, manageHolidays: false, manageGoogle: false });
  expect(await flags('cal_holiday')).toEqual({ createCompany: false, editCompany: false, manageHolidays: true, manageGoogle: false });
  expect(await flags('cal_google')).toEqual({ createCompany: false, editCompany: false, manageHolidays: false, manageGoogle: true });
  expect(await flags('cal_all')).toEqual({ createCompany: true, editCompany: true, manageHolidays: true, manageGoogle: true });
  // 管理員沒被授予：資料庫語意的三個旗標是 false；Google 管理只靠應用層檢查，舊版對管理員放行，所以是 true
  expect(await flags('cal_admin_ungranted')).toEqual({ createCompany: false, editCompany: false, manageHolidays: false, manageGoogle: true });
});

test('公司行事：新增、修改、取消與異動紀錄；沒有權限 403；欄位驗證 400；所有登入者都能看異動紀錄', async () => {
  const bad = await apis.cal_plain.post('/api/workspace/calendar/company-events', { data: ev('plain') });
  expect(bad.status()).toBe(403);
  expect((await bad.json()).error).toContain('沒有新增公司行事的權限');

  const created = await apis.cal_creator.post('/api/workspace/calendar/company-events', { data: ev('c1', { location: '會議室', description: '說明' }) });
  expect(created.status()).toBe(201);
  const id = (await created.json()).event.id as string;
  expect((await auditRows(id)).map((a) => a.action)).toEqual(['created']);

  // 只有新增權限的人不能改、不能取消
  expect((await apis.cal_creator.patch('/api/workspace/calendar/company-events', { data: { ...ev('c1'), id, title: calTitle('c1-x') } })).status()).toBe(403);
  expect((await apis.cal_creator.patch('/api/workspace/calendar/company-events', { data: { id, status: 'cancelled' } })).status()).toBe(403);
  expect((await companyEventRow(id)).title).toBe(calTitle('c1'));

  const edited = await apis.cal_editor.patch('/api/workspace/calendar/company-events', { data: { ...ev('c1'), id, title: calTitle('c1-edited'), is_all_day: false, start_time: '09:00', end_time: '10:30' } });
  expect(edited.status()).toBe(200);
  expect((await companyEventRow(id)).start_time).toBe('09:00:00');

  const listed = await (await year(apis.cal_plain)).json();
  expect(listed.companyEvents.some((e: any) => e.id === id)).toBe(true);

  const cancelled = await apis.cal_editor.patch('/api/workspace/calendar/company-events', { data: { id, status: 'cancelled' } });
  expect(cancelled.status()).toBe(200);
  expect((await companyEventRow(id)).status).toBe('cancelled');
  expect((await auditRows(id)).map((a) => a.action)).toEqual(['created', 'updated', 'cancelled']);
  const after = await (await year(apis.cal_plain)).json();
  expect(after.companyEvents.some((e: any) => e.id === id)).toBe(false); // 取消的不在清單，但紀錄保留

  const hist = await apis.cal_plain.get(`/api/workspace/calendar/company-events?event_id=${id}`);
  expect(hist.status()).toBe(200);
  expect((await hist.json()).history.map((h: any) => h.action).sort()).toEqual(['cancelled', 'created', 'updated']);
  expect((await apis.cal_plain.get('/api/workspace/calendar/company-events')).status()).toBe(400);
});

test('公司行事欄位驗證：與舊版相同的 400 訊息，且不會寫入任何資料', async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ title: '' }, '請輸入行事名稱'],
    [{ title: 'x'.repeat(161) }, '請輸入行事名稱'],
    [{ event_type: 'party' }, '行事類型無效'],
    [{ start_date: '2099-03-11', end_date: '2099-03-10' }, '請確認行事日期範圍'],
    [{ start_date: '2099-02-30', end_date: '2099-02-30' }, '請確認行事日期範圍'],
    [{ location: 'x'.repeat(501) }, '地點最多 500 字'],
    [{ description: 'x'.repeat(3001) }, '補充說明最多 3000 字'],
    [{ is_all_day: false, start_time: '10:00', end_time: '09:00' }, '請確認開始與結束時間'],
    [{ is_all_day: false, start_time: '25:00', end_time: '26:00' }, '請確認開始與結束時間'],
  ];
  for (const [over, text] of cases) {
    const r = await apis.cal_creator.post('/api/workspace/calendar/company-events', { data: ev('invalid', over) });
    expect(r.status(), JSON.stringify(over)).toBe(400);
    expect((await r.json()).error).toContain(text);
  }
  const { data } = await adminDb().from('organization_calendar_events').select('id').eq('title', calTitle('invalid'));
  expect(data || []).toEqual([]);
});

test('個人行程與分享：新增並分享、被分享的人只能看、轉分享、撤回讓下游一併看不到、只有建立者能改和刪', async () => {
  const owner = apis.cal_plain;
  const viewer = apis.cal_creator;
  const outsider = apis.cal_google;
  const create = await owner.post('/api/workspace/calendar/personal-events', { data: { ...ev('p1'), share_with_user_ids: [users.cal_creator.id] } });
  expect(create.status(), await create.text()).toBe(201);
  const id = (await create.json()).event.id as string;

  const seen = async (api: APIRequestContext) => ((await (await year(api)).json()).personalEvents as any[]).some((e) => e.id === id);
  expect(await seen(owner)).toBe(true);
  expect(await seen(viewer)).toBe(true);
  expect(await seen(outsider)).toBe(false);

  // 被分享的人不能改、不能刪（資料庫規則擋下，資料不變）
  const patch = await viewer.patch('/api/workspace/calendar/personal-events', { data: { ...ev('p1'), id, title: calTitle('p1-hacked') } });
  expect(patch.ok()).toBe(false);
  await viewer.delete(`/api/workspace/calendar/personal-events?id=${id}`);
  expect((await personalEventRow(id))?.title).toBe(calTitle('p1'));

  // 轉分享：被分享的人用自己的分享紀錄當上層
  const shares = await (await viewer.get(`/api/workspace/calendar/shares?event_id=${id}`)).json();
  expect(shares.isOwner).toBe(false);
  const mine = shares.shares.find((s: any) => s.shared_with_user_id === users.cal_creator.id && s.is_effective);
  expect(mine).toBeTruthy();
  const reshare = await viewer.post('/api/workspace/calendar/shares', { data: { event_id: id, shared_with_user_id: users.cal_google.id, parent_share_id: mine.id } });
  expect(reshare.status()).toBe(201);
  expect(await seen(outsider)).toBe(true);
  // 沒有上層分享紀錄就不能轉分享（外人不能自己轉）
  const forged = await outsider.post('/api/workspace/calendar/shares', { data: { event_id: id, shared_with_user_id: users.cal_holiday.id, parent_share_id: null } });
  expect(forged.ok()).toBe(false);

  // 建立者撤回第一層：下游也一併看不到
  const revoke = await owner.delete(`/api/workspace/calendar/shares?id=${mine.id}`);
  expect(revoke.status()).toBe(200);
  expect(await seen(viewer)).toBe(false);
  expect(await seen(outsider)).toBe(false);
  const after = await (await owner.get(`/api/workspace/calendar/shares?event_id=${id}`)).json();
  expect(after.isOwner).toBe(true);
  expect(after.shares.every((s: any) => s.is_effective === false)).toBe(true);

  const upd = await owner.patch('/api/workspace/calendar/personal-events', { data: { ...ev('p1'), id, title: calTitle('p1-new') } });
  expect(upd.status()).toBe(200);
  expect((await owner.delete(`/api/workspace/calendar/personal-events?id=${id}`)).status()).toBe(200);
  expect(await personalEventRow(id)).toBeNull();
});

test('Q18 分享對象搜尋：已停用與離職的人搜不到，在職的搜得到，自己不出現，少於 2 字回空', async () => {
  const mk = async (tag: string, o: { ban?: boolean; code?: string } = {}) => {
    const u = await createAuthUser(`w23-${tag}-${uniq()}`, { ban: o.ban, employeeCode: o.code });
    extra.push(u);
    await adminDb().from('profiles').update({ full_name: `${Q18}${tag}` }).eq('id', u.id);
    return u;
  };
  const code = `ZTTW23${uniq().toUpperCase()}`;
  const active = await mk('active');
  const banned = await mk('banned', { ban: true });
  const resigned = await mk('resigned', { code });
  await seedResignedEmployee(code, `${Q18}resigned`);

  const search = async (api: APIRequestContext, q: string) => api.get(`/api/workspace/calendar/people?q=${encodeURIComponent(q)}`);
  const r = await search(apis.cal_plain, Q18);
  expect(r.status()).toBe(200);
  const ids = ((await r.json()).people as any[]).map((p) => p.id);
  expect(ids).toContain(active.id);
  expect(ids).not.toContain(banned.id);
  expect(ids).not.toContain(resigned.id);

  // 舊版 API 同一查詢會把停用與離職的也列出來（Q18 的差異）
  const legacy = await apis.cal_plain.get(`/api/organization/calendar/people?q=${encodeURIComponent(Q18)}`);
  const legacyIds = ((await legacy.json()).people as any[]).map((p) => p.id);
  expect(legacyIds).toEqual(expect.arrayContaining([active.id, banned.id, resigned.id]));

  // 自己不出現；少於 2 個字回空；超過 80 字 400
  await adminDb().from('profiles').update({ full_name: `${Q18}self` }).eq('id', users.cal_plain.id);
  const withSelf = ((await (await search(apis.cal_plain, Q18)).json()).people as any[]).map((p) => p.id);
  expect(withSelf).toContain(active.id);
  expect(withSelf).not.toContain(users.cal_plain.id);
  expect(await (await search(apis.cal_plain, 'a')).json()).toEqual({ people: [] });
  expect((await search(apis.cal_plain, 'x'.repeat(81))).status()).toBe(400);
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  expect((await anon.get('/api/workspace/calendar/people?q=abcd')).status()).toBe(401);
  await anon.dispose();
});

test('Q21 政府假日：沒有權限 403；同年度再發布要先看差異；沒帶確認回 409 且資料不變；帶確認才取代', async () => {
  const body = (preview: any, over: Record<string, unknown> = {}) => ({
    calendar_year: RESERVED_YEAR, source_name: preview.source_name, source_url: preview.source_url, source_revision: preview.source_revision, holidays: preview.holidays, ...over,
  });
  // 沒有權限：預覽與發布都擋下
  for (const k of ['cal_plain', 'cal_editor', 'cal_google']) {
    expect((await apis[k].post('/api/workspace/calendar/holidays/preview', { data: { calendar_year: RESERVED_YEAR, use_official_source: true } })).status(), `${k} preview`).toBe(403);
    expect((await apis[k].post('/api/workspace/calendar/holidays', { data: { calendar_year: RESERVED_YEAR } })).status(), `${k} publish`).toBe(403);
  }
  const holiday = apis.cal_holiday;
  await mockControl(holiday, { csvVariant: 'base' });
  // 預覽：沒有現行版本，沒有差異欄
  const p1 = await holiday.post('/api/workspace/calendar/holidays/preview', { data: { calendar_year: RESERVED_YEAR, use_official_source: true } });
  expect(p1.status()).toBe(200);
  const preview1 = await p1.json();
  expect(preview1.existing).toBeNull();
  expect(preview1.diff).toBeNull();
  expect(preview1.source_name.startsWith('[自動測試]M5W23 ')).toBe(true);
  const names = (preview1.holidays as any[]).map((h) => `${h.holiday_date}:${h.name}:${h.day_type}`);
  expect(names).toContain('2099-01-01:開國紀念日:national_holiday');
  expect(names).toContain('2099-02-19:春節:national_holiday');
  expect(names.some((n) => n.endsWith('補行上班:makeup_workday'))).toBe(true);
  // 其他年度：官方沒有資料，回 400
  const nope = await holiday.post('/api/workspace/calendar/holidays/preview', { data: { calendar_year: 2098, use_official_source: true } });
  expect(nope.status()).toBe(400);

  // 第一次發布不需要確認
  const first = await holiday.post('/api/workspace/calendar/holidays', { data: body(preview1) });
  expect(first.status()).toBe(201);
  expect((await first.json()).count).toBe(preview1.holidays.length);
  const importsAfterFirst = await publishedImports();
  expect(importsAfterFirst.filter((i) => i.status === 'published').length).toBe(1);

  // 第二個版本：預覽顯示差異（base -> changed：新增 10-10、移除 02-19、01-01 與 04-04 改名、04-04 改類型）
  await mockControl(holiday, { csvVariant: 'changed' });
  const p2 = await holiday.post('/api/workspace/calendar/holidays/preview', { data: { calendar_year: RESERVED_YEAR, use_official_source: true } });
  const preview2 = await p2.json();
  expect(preview2.existing).toMatchObject({ count: preview1.holidays.length });
  expect(preview2.diff.identical).toBe(false);
  expect(preview2.diff.added.map((r: any) => r.holiday_date)).toEqual(['2099-10-10']);
  expect(preview2.diff.removed.map((r: any) => r.holiday_date)).toEqual(['2099-02-19']);
  expect(preview2.diff.renamed.map((r: any) => r.holiday_date)).toEqual(['2099-01-01', '2099-04-04']);
  expect(preview2.diff.retyped.map((r: any) => r.holiday_date)).toEqual(['2099-04-04']);

  // 沒帶確認：409 並附差異，資料庫沒有任何變動
  const refused = await holiday.post('/api/workspace/calendar/holidays', { data: body(preview2) });
  expect(refused.status()).toBe(409);
  const refusedBody = await refused.json();
  expect(refusedBody.requiresConfirm).toBe(true);
  expect(refusedBody.diff.changeCount).toBe(preview2.diff.changeCount);
  const unchanged = await publishedImports();
  expect(unchanged.map((i) => `${i.id}:${i.status}`)).toEqual(importsAfterFirst.map((i) => `${i.id}:${i.status}`));
  // confirm_replace 必須是 true（字串 "true" 不算）
  expect((await holiday.post('/api/workspace/calendar/holidays', { data: body(preview2, { confirm_replace: 'true' }) })).status()).toBe(409);

  // 帶確認才取代：舊版本標為已取代，新版本成為唯一的發布版本
  const replaced = await holiday.post('/api/workspace/calendar/holidays', { data: body(preview2, { confirm_replace: true }) });
  expect(replaced.status()).toBe(201);
  const imports = await publishedImports();
  expect(imports.map((i) => i.status).sort()).toEqual(['published', 'superseded']);
  const current = imports.find((i) => i.status === 'published');
  expect((await holidaysOf(current.id)).map((h) => h.holiday_date)).toEqual(preview2.holidays.map((h: any) => h.holiday_date).sort());
  const view = await (await year(apis.cal_plain)).json();
  expect(view.holidaySource.id).toBe(current.id);
  expect(view.holidays.length).toBe(preview2.holidays.length);

  // 內容完全相同的再次預覽：差異為「完全相同」，發布仍然要確認
  const p3 = await (await holiday.post('/api/workspace/calendar/holidays/preview', { data: { calendar_year: RESERVED_YEAR, use_official_source: true } })).json();
  expect(p3.diff.identical).toBe(true);
  expect(p3.diff.changeCount).toBe(0);
  expect((await holiday.post('/api/workspace/calendar/holidays', { data: body(p3) })).status()).toBe(409);
});

test('假日發布的資料檢查照舊：日期要屬於該年度、重複日期、筆數上限、來源網址', async () => {
  const holiday = apis.cal_holiday;
  const base = { calendar_year: 2098, source_name: calTitle('src'), source_url: 'https://example.test/x', source_revision: 'r', holidays: [{ holiday_date: '2098-01-01', name: 'x', day_type: 'national_holiday' }] };
  const cases: [Record<string, unknown>, string][] = [
    [{ holidays: [{ holiday_date: '2099-01-01', name: 'x', day_type: 'national_holiday' }] }, '日期需屬於匯入年度'],
    [{ holidays: [{ holiday_date: '2098-01-01', name: 'x', day_type: 'national_holiday' }, { holiday_date: '2098-01-01', name: 'y', day_type: 'national_holiday' }] }, '日期重複'],
    [{ holidays: [] }, '1 至 500 筆'],
    [{ source_url: 'ftp://example.test' }, '官方來源網址'],
    [{ source_name: '' }, '資料來源'],
    [{ calendar_year: 1999 }, '年度格式錯誤'],
  ];
  for (const [over, text] of cases) {
    const r = await holiday.post('/api/workspace/calendar/holidays', { data: { ...base, ...over } });
    expect(r.status(), JSON.stringify(over)).toBe(400);
    expect((await r.json()).error).toContain(text);
  }
  expect(await publishedImports(2098)).toEqual([]);
});

test('未登入、跨站請求與不存在的操作都被擋下', async () => {
  const anon = await pwRequest.newContext({ baseURL: TEST_ORIGIN });
  for (const p of ['calendar?year=2099', 'calendar/google/status', 'calendar/people?q=abcd', 'calendar/company-events?event_id=x']) {
    expect((await anon.get(`/api/workspace/${p}`)).status(), p).toBe(401);
  }
  await anon.dispose();
  // 寫入沒有帶站內 Origin：403
  const foreign = await pwRequest.newContext({ baseURL: TEST_ORIGIN, storageState: await apis.cal_creator.storageState(), extraHTTPHeaders: { Origin: 'https://evil.example' } });
  expect((await foreign.post('/api/workspace/calendar/company-events', { data: ev('csrf') })).status()).toBe(403);
  await foreign.dispose();
  expect((await apis.cal_plain.get('/api/workspace/calendar/nothing')).status()).toBe(404);
  expect((await apis.cal_plain.post('/api/workspace/calendar', { data: {} })).status()).toBe(404);
  const { data } = await adminDb().from('organization_calendar_events').select('id').eq('title', calTitle('csrf'));
  expect(data || []).toEqual([]);
});
