import { test, type Page } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, valueDiffsToDiffs } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import { openFromMenu } from '../support/m3-fixtures';
import { deleteRunMasters, M4_MONTH, runIdOrThrow, seedMaster } from '../support/m4-fixtures';
import { inspectionStats } from '../../lib/workspace/inspection-list';

// W13 對等層（M4 Q1–Q4）：舊版 /inspection（伺服端渲染，走使用者身分的 RLS）與新版 /api/workspace/inspections 同一份種子資料逐項對照。
// 角色：supervisor（查看自己＋查看門市，被指派 ZT01–03）。資料：ZT／VW 測試門市、保留月份 2099-03～2099-05。
//  - stats-same-input：同口徑（含草稿、全部月份）下四張卡片分段相同 → 不應有差異。
//  - stats-month（Q1）、stats-finished（Q2）、coverage（Q2）：已核可的差異，逐項拆開對照。
//  - default-month（Q4）、list-rows、visibility（Q3）、compare-entry：新版回到舊版行為 → 不應有差異。

const map = loadMap('inspection-list');
const recorder = new ParityRecorder('inspection-list');
const find = (id: string) => map.entries.find((e) => e.id === id)!;

test.beforeAll(async () => {
  runIdOrThrow();
  const a = M4_MONTH.stats;
  await seedMaster({ store: 'ZT01', inspector: 'supervisor', date: `${a}-05`, status: 'completed', total: 220, tag: 'par-a' });
  await seedMaster({ store: 'ZT01', inspector: 'supervisor', date: `${a}-06`, status: 'completed', total: 175, bonus: 3, tag: 'par-b' });
  await seedMaster({ store: 'ZT01', inspector: 'supervisor', date: `${a}-07`, status: 'completed', total: 150, tag: 'par-c' });
  await seedMaster({ store: 'ZT01', inspector: 'supervisor', date: `${a}-08`, status: 'draft', tag: 'par-d' });
  await seedMaster({ store: 'ZT02', inspector: 'supervisor', date: `${a}-09`, status: 'draft', tag: 'par-e' });
  await seedMaster({ store: 'ZT03', inspector: 'supervisor', date: `${a}-10`, status: 'completed', total: 200, tag: 'par-f' });
  await seedMaster({ store: 'ZT01', inspector: 'supervisor', date: `${M4_MONTH.latest}-03`, status: 'completed', total: 200, tag: 'par-g' });
  const c = M4_MONTH.scope;
  await seedMaster({ store: 'VW001', inspector: 'supervisor', date: `${c}-04`, status: 'completed', total: 200, tag: 'par-own-other-store' });
  await seedMaster({ store: 'VW001', inspector: 'admin', date: `${c}-03`, status: 'completed', total: 200, tag: 'par-invisible' });
  await seedMaster({ store: 'ZT02', inspector: 'admin', date: `${c}-03`, status: 'completed', total: 200, tag: 'par-assigned-others' });
  await seedMaster({ store: 'ZT03', inspector: 'ops_manager', date: `${M4_MONTH.latest}-04`, status: 'completed', total: 200, type: 'manager', tag: 'par-manager' });
});
test.afterAll(async () => {
  await deleteRunMasters();
});

type Legacy = { cards: Record<string, number>; rows: string[][]; footer: { month: string; count: number } | null; visited: number | null; unvisited: number | null; compareLink: boolean };
async function legacy(page: Page, qs: string): Promise<Legacy> {
  await page.goto(`/inspection?${qs}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const num = (label: string) => Number([...document.querySelectorAll('p')].find((e) => e.textContent?.trim() === label)?.nextElementSibling?.textContent?.trim() ?? NaN);
    const text = document.body.innerText.replace(/\s+/g, ' ');
    const f = /(\d{4}-\d{2}) 共 (\d+) 筆記錄/.exec(text);
    const visited = /已巡店（(\d+)）/.exec(text);
    const unvisited = /尚未巡店（(\d+)）/.exec(text);
    return {
      cards: { total: num('總巡店次數'), excellent: num('優秀 (8-10分)'), good: num('良好 (6-7分)'), improve: num('需改善 (0-5分)') },
      rows: [...document.querySelectorAll('table tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((t) => (t.textContent || '').replace(/\s+/g, ' ').trim())),
      footer: f ? { month: f[1], count: Number(f[2]) } : null,
      visited: visited ? Number(visited[1]) : null,
      unvisited: unvisited ? Number(unvisited[1]) : null,
      compareLink: !!document.querySelector("a[href='/inspection/compare']"),
    };
  });
}
async function nativeMonth(role: string, month: string | null, extra: Record<string, string> = {}) {
  const api = await apiAs(role);
  try {
    const params: Record<string, string> = { overview: 'true', ...extra };
    if (month) params.month = month;
    const res = await api.get('/api/workspace/inspections', { params });
    return (await res.json()) as { month: string; records: any[]; coverage: { visited: any[]; unvisited: any[] } | null };
  } finally {
    await api.dispose();
  }
}
const statusLabel: Record<string, string> = { draft: '草稿', in_progress: '進行中', completed: '已完成', closed: '已結案' };

function record(entry: string, title: string, legacyV: unknown, nativeV: unknown, compared: unknown, role = 'supervisor') {
  const e = find(entry);
  assertNoUnlistedDiffs(
    recorder.record({
      entry,
      mechanism: 'ui-extract',
      role,
      title,
      legacy: { endpoint: e.legacy.ui?.route || '' },
      native: { endpoint: `GET ${e.native.api?.path}` },
      compared,
      diffs: valueDiffsToDiffs(diffNormalized(legacyV, nativeV)),
    }),
  );
}

/** 舊版視窗：今天往前 6 個月（與舊版 new Date().setMonth(-6)、toISOString 同算法）到未來，以日期字串比較。 */
function legacyWindowMonths(): { since: string; months: string[] } {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  const since = d.toISOString().slice(0, 10);
  const months: string[] = [];
  const t = new Date(`${since.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(Date.now() + 24 * 3600_000);
  while (t <= end) {
    months.push(t.toISOString().slice(0, 7));
    t.setUTCMonth(t.getUTCMonth() + 1);
  }
  return { since, months };
}

test('統計卡：同口徑相同；月份（Q1）與已完成（Q2）的差異逐項登記', async ({ browser }) => {
  test.setTimeout(300_000);
  // 管理員：新舊都看全部（舊版視窗內可能含 DEV 真實資料，新版逐月讀回後以同樣視窗加總）。
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    const old = await legacy(page, 'tab=supervisor');
    const { since, months: windowMonths } = legacyWindowMonths();
    const months = Array.from(new Set([...windowMonths, M4_MONTH.stats, M4_MONTH.latest, M4_MONTH.scope]));
    const all = (await Promise.all(months.map((m) => nativeMonth('admin', m)))).flatMap((r) => r.records).filter((r) => r.inspection_date.slice(0, 10) >= since);
    const selected = (await nativeMonth('admin', M4_MONTH.stats)).records;
    const asCards = (s: ReturnType<typeof inspectionStats>) => ({ total: s.total, excellent: s.excellent, good: s.good, improve: s.improve });
    record('stats-same-input', '同口徑（近 6 個月全部、含草稿）', old.cards, asCards(inspectionStats(all, true)), old.cards, 'admin');
    record('stats-month', 'Q1：舊版近 6 個月 vs 新版所選月份（同樣含草稿）', old.cards, asCards(inspectionStats(selected, true)), old.cards, 'admin');
    record('stats-finished', 'Q2：舊版含草稿 vs 新版只算已完成（同樣近 6 個月全部）', old.cards, asCards(inspectionStats(all, false)), old.cards, 'admin');
  } finally {
    await ctx.close();
  }
});

test('已巡店／尚未巡店：只有草稿的門市舊版算已巡店，新版留在尚未巡店（Q2）', async ({ browser }) => {
  test.setTimeout(240_000);
  // 督導沒有 inspection.view_store_status（兩邊都不顯示名單），改用管理員（看全部啟用門市）。
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    const old = await legacy(page, `tab=supervisor&month=${M4_MONTH.stats}`);
    const nat = await nativeMonth('admin', M4_MONTH.stats);
    record('coverage', 'Q2：已巡店／尚未巡店數', { visited: old.visited, unvisited: old.unvisited }, { visited: nat.coverage?.visited.length ?? null, unvisited: nat.coverage?.unvisited.length ?? null }, { visited: old.visited, unvisited: old.unvisited }, 'admin');
  } finally {
    await ctx.close();
  }
});

test('預設月份（Q4）、列表欄位、可見範圍（Q3）：新版與舊版一致', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await loginAs(browser, 'supervisor');
  try {
    const page = await ctx.newPage();
    // Q4：兩邊都不帶月份
    const oldDefault = await legacy(page, 'tab=supervisor');
    const natDefault = await nativeMonth('supervisor', null);
    record('default-month', 'Q4：預設月份', { month: oldDefault.footer?.month ?? null }, { month: natDefault.month }, { month: oldDefault.footer?.month });

    // 列表欄位：2099-03 每列（以單號為鍵）的門市代碼、分數、含改善、評級、狀態
    const oldRows = await legacy(page, `tab=supervisor&month=${M4_MONTH.stats}`);
    const natRows = await nativeMonth('supervisor', M4_MONTH.stats);
    const fromLegacy = Object.fromEntries(
      oldRows.rows.map((td) => {
        const score = /^([\d.]+) \/ 220(?:\(含改善\+([\d.]+)\))?/.exec(td[4]);
        return [td[1], { store: /(ZT0\d|VW00\d)$/.exec(td[0])?.[1] ?? '', total: Number(score?.[1] ?? NaN), bonus: Number(score?.[2] ?? 0), grade: td[5], status: td[6] }];
      }),
    );
    const fromNative = Object.fromEntries(
      natRows.records.map((r) => [r.inspection_no, { store: r.store?.store_code ?? '', total: Number(r.total_score ?? NaN), bonus: Number(r.improvement_bonus ?? 0), grade: String(r.grade ?? '-'), status: statusLabel[r.status] || r.status }]),
    );
    record('list-rows', '列表每列欄位（單號為鍵）', fromLegacy, fromNative, fromLegacy);

    // Q3：督導可見的單號集合（2099-05：自己在未指派門市建立的、被指派門市他人建立的；未指派門市他人建立的不可見）
    const oldVis = await legacy(page, `tab=supervisor&month=${M4_MONTH.scope}`);
    const natVis = await nativeMonth('supervisor', M4_MONTH.scope);
    record('visibility', 'Q3：督導可見單號集合', { numbers: oldVis.rows.map((td) => td[1]).sort() }, { numbers: natVis.records.map((r) => r.inspection_no).sort() }, { numbers: oldVis.rows.map((td) => td[1]).sort() });
  } finally {
    await ctx.close();
  }
});

test('巡店比較入口位置：只在經理巡店分頁有紀錄時出現（兩邊一致）', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const ctx = await loginAs(browser, 'ops_manager');
  try {
    const page = await ctx.newPage();
    const viewport = (testInfo.project.use as { viewport?: { width: number; height: number } }).viewport;
    if (viewport) await page.setViewportSize(viewport);
    const oldManager = await legacy(page, 'tab=manager');
    const oldSupervisor = await legacy(page, 'tab=supervisor');
    await openFromMenu(page, '巡店列表');
    const work = page.locator('section.work-page:visible');
    await work.getByRole('heading', { name: '巡店列表' }).waitFor();
    const nativeSupervisor = (await work.getByTestId('compare-entry').count()) > 0;
    await work.getByLabel('巡店類型').selectOption('manager');
    await work.getByRole('button', { name: '查詢紀錄' }).click();
    await work.getByTestId('compare-entry').waitFor({ timeout: 30_000 });
    const nativeManager = (await work.getByTestId('compare-entry').count()) > 0;
    record('compare-entry', '比較入口（督導分頁／經理分頁）', { supervisorTab: oldSupervisor.compareLink, managerTab: oldManager.compareLink }, { supervisorTab: nativeSupervisor, managerTab: nativeManager }, { supervisorTab: oldSupervisor.compareLink, managerTab: oldManager.compareLink }, 'ops_manager');
  } finally {
    await ctx.close();
  }
});
