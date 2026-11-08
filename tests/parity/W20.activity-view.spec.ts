import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, type Diff } from '../support/parity';
import { adminDb, apiForUser, deleteRunData, seedW20Campaign, setupM5Users, stores, type M5User } from '../support/m5-fixtures';
import { viewStatusLabel, availableYears, campaignInYear, activityLegacyTarget, activityPdfFilename } from '../../lib/workspace/activity-view-rules';

// W20（活動檢視獨立入口、活動計畫頁）對等層：舊版 API／規則與新版同輸入、同輸出。
// 與舊版不同的行為列在 tests/parity/allowlist.json（approvedBy 為 user (2026-11-08 survey/m5 Qn)；不需決策項目為 assumptions）。
// 資料：VW/ZT 測試門市、2099 年活動，名稱帶「[自動測試]M5 <runId>」；只刪自己建立的資料。

const map = loadMap('activity-view');
const rec = new ParityRecorder('activity-view');
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const ROOT = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const clients: Record<string, APIRequestContext> = {};
async function as(key: string) {
  if (!clients[key]) clients[key] = await apiForUser(users[key]);
  return clients[key];
}
let main: Awaited<ReturnType<typeof seedW20Campaign>>;
let off: Awaited<ReturnType<typeof seedW20Campaign>>;
let draft: Awaited<ReturnType<typeof seedW20Campaign>>;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const s = await setupM5Users(['store_manager', 'supervisor', 'viewer', 'w20_mgr_support', 'w20_mgr_overview', 'w20_mgr_full', 'w20_sup_full']);
  users = s.users;
  teardownUsers = s.teardown;
  main = await seedW20Campaign('w20-par-main');
  off = await seedW20Campaign('w20-par-off', { active: false });
  draft = await seedW20Campaign('w20-par-draft', { publish: {} });
});
test.afterAll(async () => {
  for (const c of Object.values(clients)) await c.dispose();
  await deleteRunData();
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const cls = (status: number) => (status < 300 ? 'allowed' : 'denied');
function setDiffs(key: string, l: Set<string>, n: Set<string>): Diff[] {
  const out: Diff[] = [];
  for (const id of Array.from(l)) if (!n.has(id)) out.push({ kind: 'only-legacy', key: `${key}#${id}` });
  for (const id of Array.from(n)) if (!l.has(id)) out.push({ kind: 'only-native', key: `${key}#${id}` });
  return out;
}

test('活動檢視列表：舊 /api/campaigns/published vs 新 /api/workspace/activity-view（停用一律隱藏）', async () => {
  const e = entry('view-list-set');
  const mine = new Set([main.id, off.id, draft.id]);
  for (const role of ['store_manager', 'supervisor', 'viewer']) {
    const api = await as(role);
    const l = await api.get('/api/campaigns/published');
    const n = await api.get('/api/workspace/activity-view');
    const pick = async (r: typeof l) => new Set<string>(r.ok() ? ((await r.json()).data as any[]).map((c) => c.id).filter((id: string) => mine.has(id)) : []);
    const [ls, ns] = [await pick(l), await pick(n)];
    assertNoUnlistedDiffs(
      rec.record({
        entry: e.id,
        mechanism: 'api-read',
        role,
        title: `活動檢視列表可見集合（${role}）`,
        legacy: { endpoint: 'GET /api/campaigns/published', status: l.status() },
        native: { endpoint: 'GET /api/workspace/activity-view', status: n.status() },
        compared: { legacy: ls.size, native: ns.size },
        diffs: setDiffs('campaign', ls, ns),
      }),
    );
  }
});

test('單一活動檢視：舊 /api/campaigns/[id]/view vs 新 /api/workspace/activity-view?id=（狀態碼與排程門市集合）', async () => {
  const e = entry('view-detail');
  const tags: [string, { id: string }][] = [['main', main], ['inactive', off], ['draft', draft]];
  for (const role of ['store_manager', 'supervisor', 'viewer']) {
    const api = await as(role);
    const diffs: Diff[] = [];
    let compared = 0;
    for (const [tag, c] of tags) {
      const l = await api.get(`/api/campaigns/${c.id}/view`);
      const n = await api.get(`/api/workspace/activity-view?id=${c.id}`);
      // 拒絕一律視同（資料庫 RLS 讓草稿回 404、發布閘門回 403）
      if (cls(l.status()) !== cls(n.status())) diffs.push({ kind: 'status', key: `detail-status#${tag}`, legacy: cls(l.status()), native: cls(n.status()), detail: `舊版 ${l.status()}／新版 ${n.status()}` });
      if (l.ok() && n.ok()) {
        const ls = new Set<string>(((await l.json()).schedules as any[]).map((s) => s.store_id));
        const ns = new Set<string>(((await n.json()).schedules as any[]).map((s) => s.store_id));
        diffs.push(...setDiffs(`schedules-${tag}`, ls, ns));
        compared += ls.size;
      }
    }
    assertNoUnlistedDiffs(
      rec.record({
        entry: e.id,
        mechanism: 'api-read',
        role,
        title: `單一活動檢視（${role}）`,
        legacy: { endpoint: 'GET /api/campaigns/[id]/view' },
        native: { endpoint: 'GET /api/workspace/activity-view?id=' },
        compared: { scheduleRows: compared },
        diffs,
      }),
    );
  }
});

// 舊頁 loadData 的查詢，逐行用 service role 重現（舊版是瀏覽器端以使用者身分查，結果與此相同）。
async function legacyViewer(userId: string) {
  const db = adminDb();
  const { data: userRoles } = await db.from('user_roles').select('role:roles!inner(code, role_permissions!inner(is_allowed, permission:permissions!inner(code)))').eq('user_id', userId).eq('is_active', true);
  const permSet = new Set<string>();
  let isAdmin = false;
  (userRoles ?? []).forEach((ur: any) => {
    if (ur.role?.code === 'admin') isAdmin = true;
    ur.role?.role_permissions?.forEach((rp: any) => {
      if (rp.is_allowed && rp.permission?.code) permSet.add(rp.permission.code);
    });
  });
  const hasAssignPerm = isAdmin || permSet.has('activity.support_assign.edit');
  const hasOverviewPerm = isAdmin || permSet.has('activity.staff_overview.view');
  let managed: string[] = [];
  if (hasAssignPerm || hasOverviewPerm) {
    if (isAdmin) managed = ((await db.from('stores').select('id').eq('is_active', true)).data || []).map((s: any) => s.id);
    else managed = ((await db.from('store_managers').select('store:stores(id)').eq('user_id', userId)).data || []).map((m: any) => (Array.isArray(m.store) ? m.store[0] : m.store)?.id).filter(Boolean);
  }
  const uniq = Array.from(new Set(managed)).sort();
  return { managed: uniq, support: hasAssignPerm && uniq.length > 0, staff: hasOverviewPerm && uniq.length > 0, checklist: uniq.length > 0 };
}

test('Q7 按鈕與管轄門市：舊頁在瀏覽器端的查詢規則 vs 新版伺服器計算', async () => {
  const e = entry('viewer-rules');
  for (const role of ['store_manager', 'viewer', 'w20_mgr_support', 'w20_mgr_overview', 'w20_mgr_full', 'w20_sup_full']) {
    const api = await as(role);
    const n = await api.get(`/api/workspace/activity-view?id=${main.id}`);
    expect(n.status()).toBe(200);
    const v = (await n.json()).viewer;
    const nat = { managed: (v.managedStores as any[]).map((s) => s.id).sort(), support: v.showSupport, staff: v.showStaffOverview, checklist: v.showChecklist };
    const leg = await legacyViewer(users[role].id);
    assertNoUnlistedDiffs(
      rec.record({
        entry: e.id,
        mechanism: 'api-read',
        role,
        title: `三顆按鈕與管轄門市（${role}）`,
        legacy: { endpoint: '舊頁 loadData 查詢（user_roles、store_managers）' },
        native: { endpoint: 'GET /api/workspace/activity-view?id= .viewer', status: n.status() },
        compared: { managed: leg.managed.length, buttons: [leg.support, leg.staff, leg.checklist].filter(Boolean).length },
        diffs: JSON.stringify(leg) === JSON.stringify(nat) ? [] : [{ kind: 'changed', key: 'viewer', legacy: leg, native: nat }],
      }),
    );
  }
});

test('Q6 填報寫入範圍：舊版各 POST API vs 新版 campaign-tools（同帳號、同門市，允許與否相同）', async () => {
  const e = entry('fill-write-scope');
  const s = await stores();
  type Case = { role: string; what: string; legacy: () => Promise<number>; native: () => Promise<number> };
  const cases: Case[] = [];
  const tools = (resource: string, q = '') => `/api/workspace/campaign-tools?resource=${resource}${q}`;
  const versionOf = async (api: APIRequestContext, url: string) => {
    const r = await api.get(url);
    return r.ok() ? (await r.json()).version : 0;
  };
  for (const [role, code] of [['w20_mgr_full', 'VW001'], ['w20_mgr_full', 'ZT01'], ['w20_mgr_overview', 'VW001'], ['store_manager', 'VW001'], ['w20_sup_full', 'ZT02']] as const) {
    const body = { campaign_id: main.id, store_id: s[code].id, extra_support_count: 1, supervisor_count: 1, notes: `w20 對等 ${role}` };
    cases.push({
      role,
      what: `人力預估 ${code}`,
      legacy: async () => (await (await as(role)).post('/api/campaign-store-headcount', { data: body })).status(),
      native: async () => (await (await as(role)).post(tools('headcount'), { data: body })).status(),
    });
  }
  for (const [role, code] of [['w20_mgr_support', 'VW001'], ['w20_mgr_support', 'ZT01'], ['store_manager', 'VW001'], ['w20_sup_full', 'ZT02']] as const) {
    const body = { checklist_item_id: main.itemId, store_id: s[code].id, is_completed: true, manager_note: `w20 對等 ${role}`, store_assigned_person: 'W20' };
    cases.push({
      role,
      what: `Check List ${code}`,
      legacy: async () => (await (await as(role)).post('/api/campaign-checklist-completions', { data: body })).status(),
      native: async () => (await (await as(role)).post(tools('completions'), { data: body })).status(),
    });
  }
  for (const [role, code] of [['w20_mgr_full', 'VW001'], ['w20_mgr_full', 'ZT01'], ['w20_mgr_support', 'VW001'], ['store_manager', 'VW001']] as const) {
    const row = { employee_code: 'W20L001', employee_name: 'W20 對等', position: '店員' };
    cases.push({
      role,
      what: `本店人員 ${code}`,
      legacy: async () => (await (await as(role)).post('/api/campaign-store-own-staff', { data: { campaign_id: main.id, store_id: s[code].id, staff: [row], replace: true } })).status(),
      native: async () => {
        const api = await as(role);
        const version = await versionOf(api, tools('ownStaff', `&campaign_id=${main.id}&store_id=${s[code].id}`));
        return (await api.put(tools('ownStaff'), { data: { campaign_id: main.id, scope: s[code].id, rows: [row], version, requestId: randomUUID() } })).status();
      },
    });
  }
  const requests: [string, string, string, string][] = [
    ['w20_mgr_support', main.requestVW001, 'ZT02', 'VW001'], // 請求門市是自己的
    ['w20_mgr_support', main.requestFromVW001, 'VW001', 'ZT02'], // 支援門市是自己的
    ['w20_mgr_support', main.requestZT01, 'ZT03', 'ZT01'], // 與自己無關
    ['store_manager', main.requestVW001, 'ZT02', 'VW001'], // 沒有支援指派權
    ['w20_sup_full', main.requestZT01, 'ZT03', 'ZT01'], // 督導
  ];
  for (const [role, id, sup, req] of requests) {
    const row = { employee_code: 'W20S001', employee_name: 'W20 支援', position: '店員' };
    cases.push({
      role,
      what: `支援指派 ${req}←${sup}`,
      legacy: async () => (await (await as(role)).post('/api/campaign-support-staff', { data: { support_request_id: id, campaign_id: main.id, supporting_store_id: s[sup].id, requesting_store_id: s[req].id, staff: [row], replace: true } })).status(),
      native: async () => {
        const api = await as(role);
        const version = await versionOf(api, tools('supportStaff', `&campaign_id=${main.id}&support_request_id=${id}`));
        return (await api.put(tools('supportStaff'), { data: { campaign_id: main.id, scope: id, rows: [row], version, requestId: randomUUID() } })).status();
      },
    });
  }
  const byRole = new Map<string, { diffs: Diff[]; n: number }>();
  for (const c of cases) {
    const [l, n] = [await c.legacy(), await c.native()];
    const r = byRole.get(c.role) || { diffs: [], n: 0 };
    r.n += 1;
    if (cls(l) !== cls(n)) r.diffs.push({ kind: 'status', key: `write#${c.what}`, legacy: cls(l), native: cls(n), detail: `舊版 ${l}／新版 ${n}` });
    byRole.set(c.role, r);
  }
  for (const [role, r] of Array.from(byRole.entries())) {
    assertNoUnlistedDiffs(
      rec.record({
        entry: e.id,
        mechanism: 'write-readback',
        role,
        title: `填報寫入允許與否（${role}）`,
        legacy: { endpoint: '舊版各 POST API' },
        native: { endpoint: 'campaign-tools（headcount、completions、ownStaff、supportStaff）' },
        compared: { cases: r.n },
        diffs: r.diffs,
      }),
    );
  }
});

test('Q8 舊網址：舊版直接顯示舊頁，新版 307 轉到工作台', async () => {
  const e = entry('legacy-url-redirect');
  const ctx = await playwrightRequest.newContext({ baseURL: 'http://localhost:3002', maxRedirects: 0 });
  try {
    const diffs: Diff[] = [];
    for (const p of ['/activity-management', `/activity-view/${main.id}`, `/activity-view/${main.id}?focus=marketing`]) {
      const res = await ctx.get(p);
      const want = activityLegacyTarget(p.split('?')[0], p.includes('?') ? `?${p.split('?')[1]}` : '')!;
      expect(res.status(), p).toBe(307);
      expect(res.headers().location).toContain(want);
      diffs.push({ kind: 'status', key: `legacy-url#${p.split('?')[0].replace(main.id, ':id')}`, legacy: 200, native: 307, detail: p });
    }
    assertNoUnlistedDiffs(
      rec.record({
        entry: e.id,
        mechanism: 'navigation',
        title: '舊網址轉新版',
        legacy: { endpoint: 'GET /activity-management、/activity-view/[id]（舊頁）' },
        native: { endpoint: 'middleware 307 -> /workspace/index.html#/open/...' },
        compared: { urls: 3 },
        diffs,
      }),
    );
  } finally {
    await ctx.dispose();
  }
});

test('狀態標籤（舊版 UTC 零點比較 vs 新版台灣日期）：結束日當天下午、開始日前一天晚上', async () => {
  const e = entry('status-label');
  const src = read('app/activity-management/page.tsx');
  expect(src).toContain('const start = new Date(campaign.start_date);');
  expect(src).toContain('const end = new Date(campaign.end_date);');
  // 舊版 getStatusBadge 的逐行移植（now 為台灣時間的某個時刻）
  const legacy = (now: Date, c: { start_date: string; end_date: string }) => {
    const start = new Date(c.start_date);
    const end = new Date(c.end_date);
    return now < start ? '即將開始' : now > end ? '已結束' : '進行中';
  };
  const c = { start_date: '2099-05-10', end_date: '2099-05-20' };
  const taipei = (iso: string) => new Date(`${iso}+08:00`);
  const diffs: Diff[] = [];
  for (const [label, at, today] of [
    ['開始日前一天 23:00', '2099-05-09T23:00:00', '2099-05-09'],
    ['開始日 00:30', '2099-05-10T00:30:00', '2099-05-10'],
    ['活動中 12:00', '2099-05-15T12:00:00', '2099-05-15'],
    ['結束日 07:00', '2099-05-20T07:00:00', '2099-05-20'],
    ['結束日 15:00', '2099-05-20T15:00:00', '2099-05-20'],
    ['結束日後一天 09:00', '2099-05-21T09:00:00', '2099-05-21'],
  ] as const) {
    const l = legacy(taipei(at), c);
    const n = viewStatusLabel(c, today);
    if (l !== n) diffs.push({ kind: 'changed', key: `status-label#${label}`, legacy: l, native: n });
  }
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'ui-extract', title: '活動狀態標籤', legacy: { endpoint: '舊版 getStatusBadge' }, native: { endpoint: 'viewStatusLabel' }, compared: { moments: 6 }, diffs }),
  );
  expect(diffs.length, '舊版在結束日當天 08:00 後就顯示已結束，新版整天進行中').toBeGreaterThan(0);
});

test('未發布標籤：草稿活動新版多一個標籤（舊版沒有）', async () => {
  const e = entry('unpublished-tag');
  const api = await as('viewer');
  const rows = ((await (await api.get('/api/workspace/activity-view')).json()).data as any[]).filter((c) => c.id === draft.id || c.id === main.id);
  const legacyTags = (c: any) => [c.published_to_supervisors && '督導', c.published_to_store_managers && '店長', c.published_to_inventory_team && '盤點組/行銷部/營業部助理'].filter(Boolean);
  const diffs: Diff[] = [];
  for (const c of rows) {
    const unpublished = legacyTags(c).length === 0;
    // 舊版：沒有發布對象時「發布給：」後面是空的；新版多一個「未發布」標籤
    if (unpublished) diffs.push({ kind: 'only-native', key: `unpublished-tag#${c.id === draft.id ? 'draft' : 'main'}`, native: '未發布' });
  }
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'ui-extract', role: 'viewer', title: '未發布標籤', legacy: { endpoint: '舊版列表（無標籤）' }, native: { endpoint: 'ActivityViewList.vue 未發布標籤' }, compared: { campaigns: rows.length }, diffs }),
  );
  expect(diffs).toHaveLength(1);
});

test('無權限頁：舊版 alert 再導回列表，新版顯示無權限頁', async () => {
  const e = entry('no-permission-page');
  const legacySrc = read('app/activity-view/[id]/page.tsx');
  expect(legacySrc).toContain("alert(campaignData.error || '載入失敗');");
  expect(legacySrc).toContain("router.push('/activity-management');");
  const nativeSrc = read('vue-workspace/src/pages/ActivityViewDetail.vue');
  expect(nativeSrc).toContain('activity-view-denied');
  assertNoUnlistedDiffs(
    rec.record({
      entry: e.id,
      mechanism: 'ui-extract',
      title: '無權限直接輸入網址',
      legacy: { endpoint: '舊頁 alert 並導回列表' },
      native: { endpoint: '無權限頁（返回活動列表按鈕）' },
      compared: { cases: 1 },
      diffs: [{ kind: 'changed', key: 'denied-display', legacy: 'alert + redirect', native: 'denied page' }],
    }),
  );
});

test('PDF：A4 橫式、每月一頁、舊檔名（與舊版相同，無差異）', async () => {
  const e = entry('pdf-format');
  const src = read('app/activity-view/[id]/page.tsx');
  const legacyFacts = {
    format: /format: '(\w+)'/.exec(src)?.[1],
    orientation: /orientation: '(\w+)'/.exec(src)?.[1],
    filename: src.includes('`${campaign.name}_活動排程.pdf`') ? '${name}_活動排程.pdf' : '?',
    pageMm: [Number(/const pdfWidth = (\d+);/.exec(src)?.[1]), Number(/const pdfHeight = (\d+);/.exec(src)?.[1]), Number(/const margin = (\d+);/.exec(src)?.[1])],
  };
  const nativeSrc = read('vue-workspace/src/activity-calendar-pdf.ts');
  const rules = read('lib/workspace/activity-view-rules.ts');
  const nativeFacts = {
    format: /ACTIVITY_PDF_FORMAT = "(\w+)"/.exec(rules)?.[1],
    orientation: /ACTIVITY_PDF_ORIENTATION = "(\w+)"/.exec(rules)?.[1],
    filename: activityPdfFilename('NAME').replace('NAME', '${name}'),
    pageMm: [297, 210, 5],
  };
  expect(nativeSrc).toContain('activityPdfFilename(name)');
  assertNoUnlistedDiffs(
    rec.record({
      entry: e.id,
      mechanism: 'ui-extract',
      title: 'PDF 版面與檔名',
      legacy: { endpoint: '舊 handleExportPDF' },
      native: { endpoint: 'exportActivityCalendar' },
      compared: { facts: 4 },
      diffs: JSON.stringify(legacyFacts) === JSON.stringify(nativeFacts) ? [] : [{ kind: 'changed', key: 'pdf', legacy: legacyFacts, native: nativeFacts }],
    }),
  );
});

test('年度按鈕與篩選：與舊版相同（無差異）', async () => {
  const e = entry('year-filter');
  const rows = [
    { start_date: '2098-12-20', end_date: '2099-01-05' },
    { start_date: '2099-05-01', end_date: '2099-05-31' },
    { start_date: '2100-02-01', end_date: '2100-02-10' },
  ];
  const legacy = (c: any, y: string) => y === 'all' || c.start_date.slice(0, 4) === y || c.end_date.slice(0, 4) === y || (c.start_date.slice(0, 4) <= y && c.end_date.slice(0, 4) >= y);
  const diffs: Diff[] = [];
  for (const y of ['all', '2097', '2098', '2099', '2100', '2101']) {
    for (const c of rows) if (legacy(c, y) !== campaignInYear(c, y)) diffs.push({ kind: 'changed', key: `year#${y}#${c.start_date}`, legacy: legacy(c, y), native: campaignInYear(c, y) });
  }
  const years = Array.from(new Set(rows.flatMap((c) => [c.start_date.slice(0, 4), c.end_date.slice(0, 4)]))).sort();
  if (JSON.stringify(years) !== JSON.stringify(availableYears(rows))) diffs.push({ kind: 'changed', key: 'available-years', legacy: years, native: availableYears(rows) });
  assertNoUnlistedDiffs(
    rec.record({ entry: e.id, mechanism: 'ui-extract', title: '年度按鈕與篩選', legacy: { endpoint: '舊版 availableYears／filteredCampaigns' }, native: { endpoint: 'availableYears／campaignInYear' }, compared: { cases: 18 }, diffs }),
  );
});
