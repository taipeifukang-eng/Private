import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { assertNoUnlistedDiffs, compareApiRead, loadMap, ParityRecorder, valueDiffsToDiffs, type Diff, type LegacyApiSource, type NativeApiSource } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import { compareWorkbooks, seedExportMonth, W02_MONTHS, type SeededMonth } from '../support/w02-fixtures';
import { openNativeExport, pickMonth } from '../support/w02-ui';
import { EXPORT_DEFINITIONS, exportFileName } from '../../lib/workspace/monthly-export';

// W02 對等層：舊 /admin/export-monthly-status 與新「資料匯出」。
//  - file-<type>：同角色、同月份（2099-05）、同門市選擇（已送審＋已確認，含一組調店人員）下，十種匯出
//    （九個 Excel；名冊另有 JSON 預覽）逐工作表、逐欄、逐格比對；同時比對 Content-Type 與 Content-Disposition。
//  - unsubmitted-guard：含草稿門市，新舊都照樣產檔（規格 A.3，與舊版一致、無白名單）。
//  - perm-<type>：各角色的 HTTP 狀態碼對照（規格 A.1：全部只看 monthly.export.download，與舊版不同處列白名單）。
//  - stats-cards／store-badges／select-all／year-control：畫面比對。
// 資料只用 ZT03（草稿）、ZT04（已送審）、ZT05（已確認）與保留月份 2099-05，sweeper 清除。
// 環境沒有 openpyxl／exceljs，改以 SheetJS 做儲存格層級比對（型別、值、數字格式、欄寬、範圍、合併儲存格）。

const MONTH = W02_MONTHS.parity;
const map = loadMap('monthly-export');
const entry = (id: string) => map.entries.find((e) => e.id === id)!;
const recorder = new ParityRecorder('monthly-export');
const LEGACY = '/api/export-monthly-status';
const NATIVE = '/api/workspace/monthly-export';
const FILE_ROLES = ['admin', 'ops_manager'];
const PERM_ROLES = ['admin', 'ops_manager', 'ops_assistant', 'supervisor', 'store_manager', 'denied'];

let admin: APIRequestContext;
let seed: SeededMonth;
let selected: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  admin = await apiAs('admin');
  seed = await seedExportMonth(admin, MONTH);
  selected = [seed.ids.submitted, seed.ids.confirmed];
});
test.afterAll(async () => {
  await admin?.dispose();
});

async function call(api: APIRequestContext, base: string, key: string, method: 'GET' | 'POST', ids: string[]) {
  const url = `${base}/${key}`;
  const res = method === 'GET'
    ? await api.get(url, { params: { year_month: MONTH } })
    : await api.post(url, { data: { year_month: MONTH, store_ids: ids } });
  return { status: res.status(), headers: res.headers(), body: res.status() === 200 ? await res.body() : Buffer.alloc(0), text: res.status() === 200 ? '' : (await res.text()).slice(0, 200) };
}

// ---------------------------------------------------------------------------
// 檔案逐格比對
// ---------------------------------------------------------------------------

for (const role of FILE_ROLES) {
  test(`檔案對等 ${role}：九種匯出逐工作表、逐欄、逐格`, async () => {
    test.setTimeout(240_000);
    const api = await apiAs(role);
    try {
      for (const def of EXPORT_DEFINITIONS) {
        const started = Date.now();
        const [l, n] = [await call(api, LEGACY, def.path, def.method, selected), await call(api, NATIVE, def.path, def.method, selected)];
        const diffs: Diff[] = [];
        const compared: Record<string, number | string | boolean> = { legacyStatus: l.status, nativeStatus: n.status, fileName: exportFileName(def.key, MONTH, selected.length) };
        if (l.status !== n.status) {
          diffs.push({ kind: 'status', key: 'http-status', legacy: l.status, native: n.status, detail: `舊 ${l.status} / 新 ${n.status}` });
        } else if (l.status === 200) {
          for (const h of ['content-type', 'content-disposition']) {
            if ((l.headers[h] || '') !== (n.headers[h] || '')) diffs.push({ kind: 'changed', key: `header#${h}`, legacy: l.headers[h], native: n.headers[h] });
          }
          const cmp = compareWorkbooks(l.body, n.body);
          diffs.push(...cmp.diffs);
          Object.assign(compared, cmp.stats);
        } else if (l.text !== n.text) {
          diffs.push({ kind: 'changed', key: 'error-body', legacy: l.text, native: n.text });
        }
        const result = recorder.record({
          entry: entry(`file-${def.key}`).id,
          mechanism: 'api-read',
          role,
          title: `${def.label}：Excel 逐工作表、逐欄、逐格（同角色、${MONTH}、已送審＋已確認）`,
          legacy: { endpoint: `${def.method} ${LEGACY}/${def.path}`, status: l.status },
          native: { endpoint: `${def.method} ${NATIVE}/${def.path}`, status: n.status },
          compared,
          diffs,
          durationMs: Date.now() - started,
        });
        assertNoUnlistedDiffs(result);
        // admin 必須真的有產出內容，避免「兩邊都 404 所以一致」的空洞通過。
        if (role === 'admin') {
          expect(l.status, `${def.key} 舊版`).toBe(200);
          expect(Number(compared.rows), `${def.key} 列數`).toBeGreaterThanOrEqual(2);
        }
      }
    } finally {
      await api.dispose();
    }
  });
}

// ---------------------------------------------------------------------------
// 名冊預覽 JSON 與門市列表
// ---------------------------------------------------------------------------

for (const role of FILE_ROLES) {
  test(`名冊預覽與門市列表對等 ${role}`, async () => {
    test.setTimeout(120_000);
    const api = await apiAs(role);
    try {
      const ids = selected.join(',');
      const rosterEntry = entry('roster-preview');
      const roster = await compareApiRead({
        recorder,
        entry: rosterEntry.id,
        title: '名冊預覽 rows（含調店人員的當月快照）',
        role,
        legacyApi: api,
        legacy: { ...(rosterEntry.legacy.api as LegacyApiSource), query: { year_month: MONTH, store_ids: ids } },
        native: { ...(rosterEntry.native.api as NativeApiSource), query: { year_month: MONTH, store_ids: ids } },
        compareKey: rosterEntry.compareKey,
      });
      assertNoUnlistedDiffs(roster);
      if (role === 'admin') expect(roster.compared.legacyRows, '名冊筆數').toBeGreaterThanOrEqual(6);

      const storesEntry = entry('stores-list');
      const stores = await compareApiRead({
        recorder,
        entry: storesEntry.id,
        title: '門市列表：員工人數、已提交／已確認人數、提交狀態',
        role,
        legacyApi: api,
        legacy: { ...(storesEntry.legacy.api as LegacyApiSource), query: { year_month: MONTH } },
        native: { ...(storesEntry.native.api as NativeApiSource), query: { year_month: MONTH } },
        compareKey: storesEntry.compareKey,
      });
      assertNoUnlistedDiffs(stores);
      if (role === 'admin') expect(stores.compared.legacyRows, '門市數').toBeGreaterThanOrEqual(3);
    } finally {
      await api.dispose();
    }
  });
}

// ---------------------------------------------------------------------------
// 規格 A.3：含未提交門市，新舊皆照樣產檔
// ---------------------------------------------------------------------------

test('含未提交門市（規格 A.3）：新舊都照樣產檔且檔案逐格一致；支援時數不受影響', async () => {
  test.setTimeout(240_000);
  const ids = [seed.ids.draft, seed.ids.submitted, seed.ids.confirmed];
  const results = [];
  for (const def of EXPORT_DEFINITIONS.filter((d) => d.storeScoped)) {
    const [l, n] = [await call(admin, LEGACY, def.path, 'POST', ids), await call(admin, NATIVE, def.path, 'POST', ids)];
    const diffs: Diff[] = l.status !== n.status ? [{ kind: 'status', key: 'http-status', legacy: l.status, native: n.status, detail: def.key }] : [];
    if (!diffs.length && l.status === 200) diffs.push(...compareWorkbooks(l.body, n.body).diffs);
    results.push(
      recorder.record({
        entry: entry('unsubmitted-guard').id,
        mechanism: 'api-read',
        role: 'admin',
        title: `${def.label}：選取含草稿門市`,
        legacy: { endpoint: `POST ${LEGACY}/${def.path}`, status: l.status },
        native: { endpoint: `POST ${NATIVE}/${def.path}`, status: n.status },
        compared: { type: def.key },
        diffs,
      }),
    );
    expect(n.status, `${def.key} 新版`).toBe(200);
    expect(l.status, `${def.key} 舊版不檢查提交狀態，照樣產檔`).toBe(200);
  }
  for (const r of results) assertNoUnlistedDiffs(r);
  // 支援時數：兩邊都不受選取影響（需帶年月）
  const [l, n] = [await call(admin, LEGACY, 'support-hours', 'GET', []), await call(admin, NATIVE, 'support-hours', 'GET', [])];
  expect([l.status, n.status]).toEqual([200, 200]);
  expect(compareWorkbooks(l.body, n.body).diffs).toEqual([]);
});

// ---------------------------------------------------------------------------
// 權限矩陣
// ---------------------------------------------------------------------------

for (const role of PERM_ROLES) {
  test(`權限矩陣 ${role}：十支端點狀態碼逐一對照`, async () => {
    test.setTimeout(300_000);
    const api = await apiAs(role);
    try {
      const results = [];
      for (const def of EXPORT_DEFINITIONS) {
        const [l, n] = [await call(api, LEGACY, def.path, def.method, selected), await call(api, NATIVE, def.path, def.method, selected)];
        const diffs: Diff[] = l.status !== n.status ? [{ kind: 'status', key: 'http-status', legacy: l.status, native: n.status, detail: `舊 ${l.status} / 新 ${n.status}` }] : [];
        results.push(
          recorder.record({
            entry: entry(`perm-${def.key}`).id,
            mechanism: 'api-read',
            role,
            title: `${def.label}：權限狀態碼`,
            legacy: { endpoint: `${def.method} ${LEGACY}/${def.path}`, status: l.status },
            native: { endpoint: `${def.method} ${NATIVE}/${def.path}`, status: n.status },
            compared: { legacyStatus: l.status, nativeStatus: n.status },
            diffs,
          }),
        );
      }
      // 門市列表
      const [ls, ns] = [
        await api.get(`${LEGACY}/stores`, { params: { year_month: MONTH } }),
        await api.get(`${NATIVE}/stores`, { params: { year_month: MONTH } }),
      ];
      results.push(
        recorder.record({
          entry: entry('perm-stores').id,
          mechanism: 'api-read',
          role,
          title: '門市列表：權限狀態碼',
          legacy: { endpoint: `GET ${LEGACY}/stores`, status: ls.status() },
          native: { endpoint: `GET ${NATIVE}/stores`, status: ns.status() },
          compared: { legacyStatus: ls.status(), nativeStatus: ns.status() },
          diffs: ls.status() !== ns.status() ? [{ kind: 'status', key: 'http-status', legacy: ls.status(), native: ns.status() }] : [],
        }),
      );
      for (const r of results) assertNoUnlistedDiffs(r);
    } finally {
      await api.dispose();
    }
  });
}

// ---------------------------------------------------------------------------
// 畫面比對
// ---------------------------------------------------------------------------

type UiRow = { code: string; name: string; employees: string; badge: string; note: boolean; checked: boolean };

async function legacyUi(page: Page) {
  // 舊頁的年份下拉只有「今年前後各兩年」，選不到 2099；把門市列表請求改寫成 2099-05，畫面照舊版邏輯渲染。
  await page.route('**/api/export-monthly-status/stores?year_month=*', (route) =>
    route.continue({ url: route.request().url().replace(/year_month=[^&]+/, `year_month=${MONTH}`) }),
  );
  await page.goto('/admin/export-monthly-status', { waitUntil: 'networkidle' });
  await page.waitForSelector('div.space-y-2 > div.rounded-lg', { timeout: 30_000 });
}
async function legacyRead(page: Page) {
  return page.evaluate(() => {
    const t = (el: Element | null | undefined) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const stats = Array.from(document.querySelectorAll('div.space-y-3.text-sm > div')).map((d) => ({ label: t(d.querySelectorAll('span')[0]), value: t(d.querySelectorAll('span')[1]) }));
    const rows = Array.from(document.querySelectorAll('div.space-y-2 > div.rounded-lg')).map((d) => {
      const title = t(d.querySelector('h3'));
      const [code, ...rest] = title.split(' - ');
      return {
        code,
        name: rest.join(' - '),
        employees: (t(d.querySelector('p.text-sm')).match(/(\d+)\s*人/) || [])[1] || '',
        badge: t(d.querySelector('span.rounded.text-xs.font-medium')),
        note: t(d).includes('尚未提交，無法匯出'),
        checked: (d as HTMLElement).className.includes('border-blue-500'),
      };
    });
    return { stats, rows, yearControl: document.querySelector('select')?.tagName || '' };
  });
}
async function nativeRead(page: Page) {
  return page.evaluate(() => {
    const t = (el: Element | null | undefined) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const stats = Array.from(document.querySelectorAll('[data-export-stats] dl > div')).map((d) => ({ label: t(d.querySelector('dt')), value: t(d.querySelector('dd')) }));
    const rows = Array.from(document.querySelectorAll('.export-store-list li')).map((li) => {
      const [code, ...rest] = t(li.querySelector('strong')).split(' - ');
      return {
        code,
        name: rest.join(' - '),
        employees: (t(li.querySelector('small')).match(/(\d+)\s*人/) || [])[1] || '',
        badge: t(li.querySelector('em.badge')),
        note: t(li).includes('尚未提交，無法匯出'),
        checked: (li.querySelector('input') as HTMLInputElement).checked,
      };
    });
    return { stats, rows, yearControl: document.querySelector('[data-export-year]')?.tagName || '' };
  });
}

test('畫面對等 admin：統計資訊、門市徽章與提示、全選、年份控制項', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const legacyPage = await ctx.newPage();
    const nativePage = await ctx.newPage();
    await legacyUi(legacyPage);
    await nativePage.setViewportSize({ width: 1440, height: 900 });
    await openNativeExport(nativePage);
    await pickMonth(nativePage, MONTH);
    const l = await legacyRead(legacyPage);
    const n = await nativeRead(nativePage);

    // 統計資訊
    const stats = recorder.record({
      entry: entry('stats-cards').id,
      mechanism: 'ui-extract',
      role: 'admin',
      title: '統計資訊四個數字',
      legacy: { endpoint: '/admin/export-monthly-status 統計資訊' },
      native: { endpoint: '資料匯出頁 [data-export-stats]' },
      compared: { items: l.stats.length },
      diffs: valueDiffsToDiffs(diffNormalized(l.stats, n.stats)),
    });
    assertNoUnlistedDiffs(stats);
    expect(l.stats.map((s) => s.label)).toEqual(['總門市數', '可匯出門市', '已選擇', '總員工數']);

    // 門市徽章與提示（初始：預設勾選可匯出門市）
    const badges = recorder.record({
      entry: entry('store-badges').id,
      mechanism: 'ui-extract',
      role: 'admin',
      title: '門市列表：代號、名稱、員工人數、徽章、無法匯出提示、預設勾選',
      legacy: { endpoint: '/admin/export-monthly-status 門市列表' },
      native: { endpoint: '資料匯出頁 .export-store-list' },
      compared: { stores: l.rows.length },
      diffs: valueDiffsToDiffs(diffNormalized(l.rows, n.rows)),
    });
    assertNoUnlistedDiffs(badges);
    expect(new Set(l.rows.map((r) => r.badge))).toEqual(new Set(['未提交', '已提交', '已確認']));

    // 年份控制項
    const year = recorder.record({
      entry: entry('year-control').id,
      mechanism: 'ui-extract',
      role: 'admin',
      title: '年份控制項型態',
      legacy: { endpoint: '/admin/export-monthly-status select' },
      native: { endpoint: '資料匯出頁 [data-export-year]' },
      compared: { legacy: l.yearControl, native: n.yearControl },
      diffs: l.yearControl !== n.yearControl ? [{ kind: 'changed', key: 'control', legacy: l.yearControl, native: n.yearControl }] : [],
    });
    assertNoUnlistedDiffs(year);

    // 全選
    await legacyPage.getByRole('button', { name: '全選' }).click();
    await nativePage.locator('[data-export-toggle-all]').click();
    const l2 = await legacyRead(legacyPage);
    const n2 = await nativeRead(nativePage);
    const checked = (rows: UiRow[]) => rows.filter((r) => r.checked).map((r) => r.code).sort();
    const selectAll = recorder.record({
      entry: entry('select-all').id,
      mechanism: 'ui-extract',
      role: 'admin',
      title: '按「全選」後被勾選的門市',
      legacy: { endpoint: '/admin/export-monthly-status 全選' },
      native: { endpoint: '資料匯出頁 全選' },
      compared: { legacyChecked: checked(l2.rows).length, nativeChecked: checked(n2.rows).length },
      diffs: [
        ...checked(l2.rows).filter((c) => !checked(n2.rows).includes(c)).map((c): Diff => ({ kind: 'only-legacy', key: c, detail: '舊版全選連同未提交門市一併勾選' })),
        ...checked(n2.rows).filter((c) => !checked(l2.rows).includes(c)).map((c): Diff => ({ kind: 'only-native', key: c })),
      ],
    });
    assertNoUnlistedDiffs(selectAll);
    // 新版全選不含任何未提交門市
    expect(n2.rows.filter((r) => r.checked && r.badge === '未提交')).toEqual([]);
    expect(l2.rows.some((r) => r.checked && r.badge === '未提交'), '舊版全選會連未提交門市一起勾選').toBe(true);
  } finally {
    await ctx.close();
  }
});
