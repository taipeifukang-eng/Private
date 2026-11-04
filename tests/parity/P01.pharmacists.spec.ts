import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { apiAs, loginAs } from '../support/auth';
import { assertNoUnlistedDiffs, compareApiRead, loadMap, ParityRecorder, valueDiffsToDiffs, type Diff } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import { PROOF_LIMIT_LABEL } from '../../vue-workspace/src/pharmacist-proof';
import { PHARMACIST_TITLE, REAL_SYNC_APPROVAL_ENV, collectErrors, openNativePage, panel, realDataFootprint, type RealDataFootprint } from '../support/p01-fixtures';

// P01 對等層：藥師管理。
//  1. 督導區總覽：同角色、同月份（2026-10，真實過去月份，zone=all），舊頁伺服器端計算的摘要卡、督導區卡片、每位藥師的變化類型與備註，
//     對比新版 overview 回應（以門市＋員編為鍵）。不讀 2099 月份（總覽會替所有可見門市同步快照）。
//     資料衛生：舊版總覽頁與新版 overview 會替「可見的真實門市」同步 pharmacist_monthly_snapshot，sweeper 清不掉；
//     因此預設只比對沒有門市範圍的帳號（pharmacist，不寫入任何列），其餘角色需 P01_APPROVE_REAL_SYNC=1（見下方說明）。
//  2. 主檔 API 對等：舊 GET /api/pharmacist-annual-master/sync 與新 POST master（各角色）。
//  3. 主檔畫面：執照更新日顯示與逾期紅字逐列比對。
//  4. 提示與標頭、排版與增強、繳費證明上限文字：差異以 only-native／only-legacy／changed 登記，列入白名單（approvedBy: null，待使用者核可）。

const map = loadMap('pharmacists');
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const recorder = new ParityRecorder('pharmacists');
const YM = '2026-10';
const MASTER_YEAR = 2026;

let footprintBefore: RealDataFootprint | null = null;

/**
 * 資料衛生（測試資料規則：只觸及 ZT/VW 測試門市與保留月份）：
 * 舊版總覽頁、舊版主檔 sync 對「真實門市」會同步寫入快照與年度主檔，sweeper 清不掉。
 * 因此預設只執行「不會觸發真實門市同步」的檢查：
 *   - 沒有門市範圍的帳號（pharmacist）的總覽（storeIds 為空，不寫入任何列）；
 *   - 無權限存取、原始碼層級的比對。
 * 會觸發真實門市同步的比對（admin／navigation／ops_manager 總覽、主檔 API、主檔畫面、提示標頭的管理者部分）
 * 需使用者核可後設定 P01_APPROVE_REAL_SYNC=1 才會執行；執行時前後以 service role 只讀計數 2026-10 快照與 2026 年度主檔，列數不得變動。
 */
const REAL_SYNC_APPROVED = process.env[REAL_SYNC_APPROVAL_ENV] === '1';
const needRealSync = () => test.skip(!REAL_SYNC_APPROVED, `會替真實門市同步寫入、sweeper 清不掉；需使用者核可後設定 ${REAL_SYNC_APPROVAL_ENV}=1`);

test.beforeAll(async () => {
  if (REAL_SYNC_APPROVED) footprintBefore = await realDataFootprint(YM, MASTER_YEAR);
});

test.afterAll(async () => {
  if (!footprintBefore) return;
  const after = await realDataFootprint(YM, MASTER_YEAR);
  expect(after, `真實月份 ${YM} 快照／${MASTER_YEAR} 年度主檔列數在測試前後不得變動（不得新增資料）`).toEqual(footprintBefore);
});
const ROOT = path.resolve(__dirname, '..', '..');

const sorted = <T extends Record<string, any>>(rows: T[], keys: string[]) =>
  [...rows].sort((a, b) => keys.map((k) => String(a[k] ?? '')).join('\u0000').localeCompare(keys.map((k) => String(b[k] ?? '')).join('\u0000')));

interface OverviewFacts {
  empty: boolean;
  summary: { total: number; newJoin: number; changed: number };
  zones: Array<{ zone: string; stores: number; pharmacists: number; pills: Array<{ store: string; count: number }> }>;
  rows: Array<{ key: string; zone: string; store: string; code: string; name: string; position: string; type: string; note: string }>;
  viewOnlyHint: boolean;
  scopeEmptyText: string;
  hintLine: boolean;
}

async function readLegacyOverview(page: Page): Promise<OverviewFacts> {
  const bodyText = await page.locator('body').innerText();
  if (bodyText.includes('目前沒有可查看的門市範圍')) {
    return { empty: true, summary: { total: 0, newJoin: 0, changed: 0 }, zones: [], rows: [], viewOnlyHint: bodyText.includes('目前為檢視模式'), scopeEmptyText: '目前沒有可查看的門市範圍。', hintLine: false };
  }
  await page.getByRole('button', { name: /當月藥師總數/ }).click();
  return page.evaluate(() => {
    const t = (el: Element | null | undefined) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const n = (s: string) => Number(String(s).replace(/[^0-9.-]/g, '') || 0);
    const cards = Array.from(document.querySelectorAll('button')).filter((b) => b.querySelector('div.text-2xl'));
    const val = (label: string) => n(t(cards.find((b) => t(b).includes(label))?.querySelector('div.text-2xl')));
    const zones = Array.from(document.querySelectorAll('section.rounded-xl')).map((s) => {
      const spans = Array.from(s.querySelectorAll('span')).map(t);
      return {
        zone: t(s.querySelector('h3')),
        stores: n(spans.find((x) => x.startsWith('門市數')) || ''),
        pharmacists: n(spans.find((x) => x.startsWith('藥師數')) || ''),
        pills: Array.from(s.querySelectorAll('button.rounded-lg')).map((b) => ({ store: t(b.querySelector('span.font-medium')), count: n(t(b.querySelector('span.ml-1'))) })),
      };
    });
    const table = Array.from(document.querySelectorAll('table')).find((x) => t(x.querySelector('thead')).includes('變化類型'));
    const rows = Array.from(table?.querySelectorAll('tbody tr') || []).map((tr) => {
      const c = Array.from(tr.children).map(t);
      const note = c[6] === '-' ? '' : c[6];
      return { key: '', zone: c[0], store: c[1], code: c[2], name: c[3], position: c[4], type: c[5], note };
    });
    return {
      empty: false,
      summary: { total: val('當月藥師總數'), newJoin: val('新增任職'), changed: val('門市/職級異動') },
      zones,
      rows,
      viewOnlyHint: document.body.innerText.includes('目前為檢視模式'),
      scopeEmptyText: '',
      hintLine: document.body.innerText.includes('點選門市可查看藥師明細'),
    };
  });
}

function nativeFacts(body: any): OverviewFacts {
  const cards = body.cards as Array<{ supervisorZone: string; stores: Array<{ storeCode: string; storeName: string; pharmacistCount: number }> }>;
  return {
    empty: cards.length === 0,
    summary: body.summary,
    zones: cards.map((c) => ({
      zone: c.supervisorZone,
      stores: c.stores.length,
      pharmacists: c.stores.reduce((s, x) => s + x.pharmacistCount, 0),
      pills: c.stores.map((s) => ({ store: `${s.storeCode} ${s.storeName}`.trim(), count: s.pharmacistCount })),
    })),
    rows: (body.rows as any[]).map((r) => ({ key: '', zone: r.supervisor_zone, store: `${r.store_code} ${r.store_name}`.trim(), code: r.employee_code, name: r.employee_name, position: r.position, type: r.change_type, note: r.change_note || '' })),
    viewOnlyHint: !body.capabilities.edit,
    scopeEmptyText: cards.length === 0 ? '目前沒有可查看的門市範圍。' : '',
    hintLine: cards.length > 0,
  };
}

// 只有系統管理員與導覽帳號讀得到真實門市（stores 受 RLS 限制）；其餘角色的總覽範圍為空，兩邊也要一致。
for (const role of ['admin', 'navigation', 'ops_manager', 'pharmacist']) {
  test(`總覽對等 ${role}：${YM} 摘要卡、督導區卡片、每位藥師的變化類型與備註`, async ({ browser }) => {
    test.setTimeout(240_000);
    if (role !== 'pharmacist') needRealSync(); // 只有 pharmacist 沒有門市範圍，不會觸發真實門市同步
    const api = await apiAs(role);
    const ctx = await loginAs(browser, role);
    try {
      const res = await api.post('/api/workspace/pharmacists/overview', { params: { year_month: YM, zone: 'all' } });
      expect(res.status()).toBe(200);
      const body = await res.json();
      const page = await ctx.newPage();
      await page.goto(`/admin/pharmacist-management?tab=overview&year_month=${YM}&zone=all`, { waitUntil: 'networkidle' });
      const l = await readLegacyOverview(page);
      const n = nativeFacts(body);
      if (role === 'admin') {
        expect(l.rows.length, '空洞檢查：舊頁確實有藥師列').toBeGreaterThan(0);
        expect(l.zones.length).toBeGreaterThan(0);
      }
      if (role === 'pharmacist') expect(l.empty, '沒有門市範圍的帳號，舊頁顯示空範圍').toBe(true);
      const rowKey = (r: OverviewFacts['rows'][number]) => `${r.store}|${r.code}`;
      const keyed = (rows: OverviewFacts['rows']) => sorted(rows.map((r) => ({ ...r, key: rowKey(r) })), ['key']);
      const diffs: Diff[] = [
        ...valueDiffsToDiffs(diffNormalized(l.summary, n.summary), 'summary'),
        ...valueDiffsToDiffs(diffNormalized(sorted(l.zones.map((z) => ({ ...z, pills: sorted(z.pills, ['store']) })), ['zone']), sorted(n.zones.map((z) => ({ ...z, pills: sorted(z.pills, ['store']) })), ['zone'])), 'zones'),
        ...valueDiffsToDiffs(diffNormalized(keyed(l.rows), keyed(n.rows)), 'rows'),
      ];
      assertNoUnlistedDiffs(
        recorder.record({
          entry: 'overview-ui',
          mechanism: 'ui-extract',
          role,
          title: `${YM} 總覽：摘要卡、督導區卡片、每位藥師（變化類型與備註）`,
          legacy: { endpoint: `/admin/pharmacist-management?year_month=${YM}` },
          native: { endpoint: `POST /api/workspace/pharmacists/overview?year_month=${YM}`, status: res.status() },
          compared: { zones: l.zones.length, rows: l.rows.length },
          diffs,
        }),
      );
    } finally {
      await api.dispose();
      await ctx.close();
    }
  });
}

test('存取對等：無權限帳號舊頁被導走（伺服器端重新導向）、新版 API 403', async () => {
  test.setTimeout(120_000);
  for (const role of ['denied', 'employee']) {
    const api = await apiAs(role);
    try {
      const nativeStatus = (await api.post('/api/workspace/pharmacists/overview', { params: { year_month: YM } })).status();
      const legacy = await api.get(`/admin/pharmacist-management?year_month=${YM}`, { maxRedirects: 0 });
      const location = legacy.headers()['location'] || '';
      const legacyDenied = legacy.status() >= 300 && legacy.status() < 400 && !location.includes('/admin/pharmacist-management');
      const diffs: Diff[] = [];
      if (legacyDenied && nativeStatus !== 403) diffs.push({ kind: 'only-native', key: 'access', detail: `舊頁被導走，新版 ${nativeStatus}` });
      if (!legacyDenied && nativeStatus === 403) diffs.push({ kind: 'only-legacy', key: 'access', detail: '舊頁可開，新版 403' });
      assertNoUnlistedDiffs(
        recorder.record({
          entry: 'overview-ui',
          mechanism: 'ui-extract',
          role,
          title: '無權限存取',
          legacy: { endpoint: '/admin/pharmacist-management', status: legacy.status() },
          native: { endpoint: 'POST /api/workspace/pharmacists/overview', status: nativeStatus },
          compared: { legacyDenied, nativeStatus },
          diffs,
        }),
      );
      expect(legacyDenied, `舊頁應被導走：${legacy.status()} ${location}`).toBe(true);
      expect(nativeStatus).toBe(403);
    } finally {
      await api.dispose();
    }
  }
});

test('提示與標頭對等：檢視模式提示、督導區門市數／藥師數、說明文字、空範圍訊息；Debug 面板（?debug=1，管理員）', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const diffs: Diff[] = [];
  // 1) 管理者：督導區卡片標頭與說明文字（會觸發真實門市同步：需核可）
  if (REAL_SYNC_APPROVED) {
  const admin = await loginAs(browser, 'admin');
  try {
    const legacy = await admin.newPage();
    await legacy.goto(`/admin/pharmacist-management?tab=overview&year_month=${YM}&zone=all`, { waitUntil: 'networkidle' });
    const legacyTotals = await legacy.locator('section.rounded-xl h3 + div').first().innerText();
    const legacyHint = await legacy.locator('p', { hasText: '點選門市可查看藥師明細' }).first().innerText();
    await legacy.goto(`/admin/pharmacist-management?tab=overview&year_month=${YM}&zone=all&debug=1`, { waitUntil: 'networkidle' });
    const legacyDebug = (await legacy.getByText('Debug 資訊（server-side）').count()) > 0;
    const native = await admin.newPage();
    await native.setViewportSize((testInfo.project.use as any).viewport);
    const errors = collectErrors(native);
    await openNativePage(native, PHARMACIST_TITLE, '?debug=1');
    const p = panel(native);
    await p.getByLabel('月份').fill(YM);
    await p.getByRole('button', { name: '查詢總覽' }).click();
    await expect(p.locator('.zone').first()).toBeVisible({ timeout: 60_000 });
    const nativeTotals = await p.locator('.zone [data-zone-totals]').first().innerText();
    const nativeHint = await p.locator('p.muted', { hasText: '點選門市可查看藥師明細' }).innerText();
    const norm = (s: string) => s.replace(/\s+/g, '');
    if (norm(legacyTotals) !== norm(nativeTotals)) diffs.push({ kind: 'changed', key: 'zone-totals', legacy: legacyTotals, native: nativeTotals });
    if (norm(legacyHint) !== norm(nativeHint)) diffs.push({ kind: 'changed', key: 'overview-hint', legacy: legacyHint, native: nativeHint });
    // 舊版 ?debug=1 的 Debug 面板，新版沒有
    if (legacyDebug && (await native.getByText('Debug 資訊（server-side）').count()) === 0) diffs.push({ kind: 'only-legacy', key: 'debug-panel', detail: '舊版 ?debug=1 會顯示 Debug 資訊面板' });
    expect(errors, errors.join('\n')).toEqual([]);
    expect(legacyTotals).toMatch(/門市數：\d+/);
    expect(legacyDebug, '舊版 debug 面板存在').toBe(true);
  } finally {
    await admin.close();
  }
  }
  // 2) 僅檢視：提示文字與空範圍訊息
  const viewer = await loginAs(browser, 'pharmacist');
  try {
    const legacy = await viewer.newPage();
    await legacy.goto(`/admin/pharmacist-management?year_month=${YM}`, { waitUntil: 'networkidle' });
    const legacyText = await legacy.locator('body').innerText();
    const native = await viewer.newPage();
    await native.setViewportSize((testInfo.project.use as any).viewport);
    await openNativePage(native, PHARMACIST_TITLE);
    const p = panel(native);
    await expect(p.getByText('目前沒有可查看的門市範圍。')).toBeVisible({ timeout: 60_000 });
    const nativeText = await p.innerText();
    for (const text of ['目前沒有可查看的門市範圍。']) {
      if (legacyText.includes(text) !== nativeText.includes(text)) diffs.push({ kind: 'changed', key: 'scope-empty-text', detail: text });
    }
    expect(legacyText).toContain('目前沒有可查看的門市範圍。');
  } finally {
    await viewer.close();
  }
  // 3) 有 view 與 view_all、沒有 edit、讀得到門市的帳號（導覽帳號）：檢視模式提示（會觸發真實門市同步：需核可）
  if (REAL_SYNC_APPROVED) {
  const ops = await loginAs(browser, 'navigation');
  try {
    const legacy = await ops.newPage();
    await legacy.goto(`/admin/pharmacist-management?year_month=${YM}`, { waitUntil: 'networkidle' });
    const legacyHasHint = (await legacy.getByText('目前為檢視模式（僅可查看，無法編輯）。').count()) > 0;
    const native = await ops.newPage();
    await native.setViewportSize((testInfo.project.use as any).viewport);
    await openNativePage(native, PHARMACIST_TITLE);
    await expect(panel(native).locator('.metrics')).toBeVisible({ timeout: 60_000 });
    const nativeHasHint = (await panel(native).locator('[data-view-only]').count()) > 0;
    if (legacyHasHint !== nativeHasHint) diffs.push({ kind: 'changed', key: 'view-only-hint', legacy: legacyHasHint, native: nativeHasHint });
    expect(legacyHasHint).toBe(true);
  } finally {
    await ops.close();
  }
  }
  assertNoUnlistedDiffs(
    recorder.record({
      entry: 'overview-ui-text',
      mechanism: 'ui-extract',
      role: 'admin',
      title: '總覽提示與標頭文字',
      legacy: { endpoint: '/admin/pharmacist-management' },
      native: { endpoint: '藥師管理 督導區總覽' },
      compared: { checks: 5 },
      diffs,
    }),
  );
});

// ---------------------------------------------------------------------------
// 主檔
// ---------------------------------------------------------------------------

for (const role of ['admin', 'pharmacist_view', 'pharmacist_edit', 'pharmacist', 'denied']) {
  test(`主檔 API 對等 ${role}：舊 GET sync 對新 POST master（2026 年度）`, async () => {
    test.setTimeout(120_000);
    if (role !== 'denied') needRealSync(); // 舊版 sync 會寫入 2026 年度主檔（denied 被 403 擋下，不寫入）
    const api = await apiAs(role);
    try {
      const e = entry('master-api');
      const result = await compareApiRead({
        recorder,
        entry: e.id,
        title: e.description || e.id,
        role,
        legacyApi: api,
        legacy: e.legacy.api!,
        native: e.native.api!,
        compareKey: e.compareKey,
        rules: e.normalize,
      });
      assertNoUnlistedDiffs(result);
      expect(['pass', 'allowed', 'pending-approval']).toContain(result.status);
      if (role === 'admin') expect(result.compared.legacyRows, '空洞檢查：主檔確實有資料').toBeGreaterThan(0);
    } finally {
      await api.dispose();
    }
  });
}

interface LicenseRow {
  code: string;
  date: string;
  overdue: boolean;
}

test('主檔畫面對等 pharmacist_view：執照更新日顯示與逾期紅字逐列比對、欄位與增強項', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  needRealSync(); // 舊版主檔分頁會觸發年度主檔 sync 寫入
  const ctx = await loginAs(browser, 'pharmacist_view');
  try {
    const legacy = await ctx.newPage();
    await legacy.goto('/admin/pharmacist-management?tab=master', { waitUntil: 'networkidle' });
    await expect(legacy.locator('table tbody tr td').first()).toBeVisible({ timeout: 60_000 });
    await expect(legacy.getByText('載入中...')).toHaveCount(0, { timeout: 60_000 });
    const l = await legacy.evaluate(() => {
      const t = (el: Element | null | undefined) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const heads = Array.from(document.querySelectorAll('thead th')).map(t);
      const idx = heads.indexOf('執照更新日');
      const rows = Array.from(document.querySelectorAll('tbody tr'))
        .filter((tr) => tr.children.length > 5)
        .map((tr) => {
          const cell = tr.children[idx];
          const date = t(cell);
          return { code: t(tr.children[0]), date: date === '-' ? '' : date, overdue: !!cell.querySelector('.text-rose-600') };
        });
      const filters = Array.from(document.querySelectorAll('button')).map(t).filter((x) => ['在職', '已離職', '離職', '留停', '全部'].includes(x));
      return { heads, rows, filters };
    });

    const native = await ctx.newPage();
    await native.setViewportSize((testInfo.project.use as any).viewport);
    const errors = collectErrors(native);
    await openNativePage(native, PHARMACIST_TITLE);
    const p = panel(native);
    await p.getByRole('button', { name: '藥師主檔' }).click();
    await expect(p.getByRole('columnheader', { name: '執照更新日' })).toBeVisible({ timeout: 60_000 });
    await expect(p.locator('tbody tr').first()).toBeVisible({ timeout: 60_000 });
    const nativeRows: LicenseRow[] = [];
    {
      // 規格 F2：主檔不分頁，一次列出全部。
      nativeRows.push(
        ...(await p.evaluate((root) => {
          const t = (el: Element | null | undefined) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
          return Array.from(root.querySelectorAll('tbody tr'))
            .filter((tr) => tr.querySelector('[data-license-date]'))
            .map((tr) => {
              const cell = tr.querySelector('[data-license-date]')!;
              const first = tr.children[0];
              const code = t(first.querySelector('small')) || '';
              const date = t(cell);
              return { code, date: date === '—' ? '' : date, overdue: cell.getAttribute('data-overdue') === 'true' };
            });
        })),
      );
    }
    const nativeHeads = await p.locator('thead th').allTextContents();
    const nativePager = (await p.getByRole('button', { name: '下一頁' }).count()) > 0;

    const legacyRows = l.rows.filter((r) => r.code && r.code !== '-');
    const nativeComparable = nativeRows.filter((r) => r.code && r.code !== '手動新增');
    expect(legacyRows.length, '空洞檢查：舊頁主檔有資料').toBeGreaterThan(0);
    const diffs: Diff[] = valueDiffsToDiffs(diffNormalized(sorted(legacyRows, ['code']), sorted(nativeComparable, ['code'])), 'license');
    assertNoUnlistedDiffs(
      recorder.record({
        entry: 'master-license-ui',
        mechanism: 'ui-extract',
        role: 'pharmacist_view',
        title: '主檔「執照更新日」顯示與逾期紅字',
        legacy: { endpoint: '/admin/pharmacist-management?tab=master' },
        native: { endpoint: '藥師管理 藥師主檔' },
        compared: { legacyRows: legacyRows.length, nativeRows: nativeComparable.length, overdue: legacyRows.filter((r) => r.overdue).length },
        diffs,
      }),
    );
    // 逾期紅字的判斷：與日期本身一致（過去的日期為紅字）
    for (const r of nativeComparable) {
      expect(r.overdue, `${r.code} ${r.date}`).toBe(!!r.date && new Date(r.date) < new Date());
    }

    // 排版與增強
    const layout: Diff[] = [];
    if (JSON.stringify(l.heads.map((h) => h.trim())) !== JSON.stringify(nativeHeads.map((h) => h.trim()))) layout.push({ kind: 'changed', key: 'master-columns', legacy: l.heads.join('／'), native: nativeHeads.join('／') });
    // 年費視窗與用詞（來源層級比對，舊版 PharmacistAnnualFeeModal／PharmacistMasterList 對 Pharmacists.vue）
    const legacyFee = fs.readFileSync(path.join(ROOT, 'app/admin/pharmacist-management/PharmacistAnnualFeeModal.tsx'), 'utf8');
    const legacyMaster = fs.readFileSync(path.join(ROOT, 'app/admin/pharmacist-management/PharmacistMasterList.tsx'), 'utf8');
    const vueSrc = fs.readFileSync(path.join(ROOT, 'vue-workspace/src/pages/Pharmacists.vue'), 'utf8');
    if (!legacyFee.includes('編輯') && vueSrc.includes('編輯備註／證明')) layout.push({ kind: 'only-native', key: 'fee-edit', detail: '年費視窗新增「編輯備註／證明」與列表／表單兩步' });
    if (legacyMaster.includes('記錄') && vueSrc.includes('查看／登記會費') && vueSrc.includes('手動新增')) layout.push({ kind: 'changed', key: 'wording', detail: '年費按鈕「記錄」→「查看／登記會費」、手動標籤、負責藥師否、離職篩選呈現' });
    if (nativePager) layout.push({ kind: 'only-native', key: 'master-pagination', detail: '新版主檔有分頁；舊版一次列出全部' });
    const nativeFilter = await p.getByLabel('狀態').locator('option').allTextContents();
    // 順序與字樣都照舊版（在職／留停／已離職／全部）；舊版為按鈕列，新版為下拉選單（控制型態差異，見 allowlist）。
    const order = ['在職', '留停', '已離職', '全部'];
    const legacyOrder = Array.from(new Set(l.filters.filter((f) => order.includes(f))));
    if (JSON.stringify(legacyOrder) !== JSON.stringify(nativeFilter)) layout.push({ kind: 'changed', key: 'master-status-filter-label', legacy: legacyOrder.join('／'), native: nativeFilter.join('／') });
    layout.push({ kind: 'changed', key: 'master-status-filter-control', legacy: '按鈕列', native: '下拉選單' });
    assertNoUnlistedDiffs(
      recorder.record({
        entry: 'master-layout',
        mechanism: 'ui-extract',
        role: 'pharmacist_view',
        title: '主檔欄位、分頁與狀態篩選字樣',
        legacy: { endpoint: '/admin/pharmacist-management?tab=master' },
        native: { endpoint: '藥師管理 藥師主檔' },
        compared: { legacyColumns: l.heads.length, nativeColumns: nativeHeads.length },
        diffs: layout,
      }),
    );
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('年度關帳資訊：新版與舊版同為「由 {locked_by} 關帳於 {日期前 10 碼}」', () => {
  const legacy = fs.readFileSync(path.join(ROOT, 'app/admin/pharmacist-management/PharmacistMasterList.tsx'), 'utf8');
  const vue = fs.readFileSync(path.join(ROOT, 'vue-workspace/src/pages/Pharmacists.vue'), 'utf8');
  expect(legacy).toMatch(/由 \{lockInfo\.locked_by\} 關帳於 \{lockInfo\.locked_at\.slice\(0, 10\)\}/);
  expect(vue).toMatch(/由 \{\{ master\.lockInfo\.locked_by \}\} 關帳於\s*\{\{ String\(master\.lockInfo\.locked_at\)\.slice\(0, 10\) \}\}/);
});

test('繳費證明上限文字：舊版欄位標籤「最大 10 MB」，新版統一 3.5 MB（實際前端上限新舊相同）', async () => {
  const legacySource = fs.readFileSync(path.join(ROOT, 'app/admin/pharmacist-management/PharmacistAnnualFeeModal.tsx'), 'utf8');
  const legacyLabel = (legacySource.match(/繳費證明（照片或 PDF，最大 ([\d.]+ MB)）/) || [])[1];
  const legacyClientLimit = (legacySource.match(/建議 ([\d.]+ MB) 以內/) || [])[1];
  const vueSource = fs.readFileSync(path.join(ROOT, 'vue-workspace/src/pages/Pharmacists.vue'), 'utf8');
  expect(legacyLabel).toBe('10 MB');
  expect(legacyClientLimit).toBe('3.5 MB');
  // 兩邊實際的前端擋下門檻相同：3.5 * 1024 * 1024
  expect(legacySource).toMatch(/MOBILE_SAFE_MAX_UPLOAD_BYTES = 3\.5 \* 1024 \* 1024/);
  const diffs: Diff[] = [];
  if (legacyLabel !== PROOF_LIMIT_LABEL) diffs.push({ kind: 'changed', key: 'proof-limit-label', legacy: legacyLabel, native: PROOF_LIMIT_LABEL });
  assertNoUnlistedDiffs(
    recorder.record({
      entry: 'proof-limit-text',
      mechanism: 'ui-extract',
      role: 'pharmacist_edit',
      title: '繳費證明上限文字',
      legacy: { endpoint: 'PharmacistAnnualFeeModal.tsx 欄位標籤' },
      native: { endpoint: 'Pharmacists.vue / pharmacist-proof.ts' },
      compared: { legacy: legacyLabel, native: PROOF_LIMIT_LABEL },
      diffs,
    }),
  );
  expect(vueSource).not.toMatch(/10\s*MB/);
});
