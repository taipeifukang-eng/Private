import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { storageStateFor, TEST_ORIGIN } from '../support/auth';
import { adminDb, apiForUser, runIdOrThrow, setupM6Users, type M6User } from '../support/m6-fixtures';
import { legacyRouteFor } from '../../lib/workspace/legacy-routes';

/**
 * M9 F01S 多角色劇本（桌機 1440、手機 390 各跑一次）：C2「回舊版」連結、N2 逐頁備援開關。
 * 角色：admin（系統管理員）、so_store_a（店長，有缺貨回報入口「商品部」）。
 * 劇本：
 *   1. 管理員逐頁開啟多個頁面：頁籤列都有「回舊版」連結，網址與對照表一致、另開分頁（rel=noopener）、手機沒有水平溢出且點擊區夠大；
 *      沒有舊版對應的頁面（頁面回舊版設定）不顯示連結；點連結真的開到舊版頁面。
 *   2. 店長開著「商品部」新版頁籤 -> 管理員在「頁面回舊版設定」把缺貨回報切回舊版（必填原因）
 *      -> 店長開選單（會重新讀 session）：商品部改成舊版連結（另開分頁、帶「暫時使用舊版」提示），點了開到舊版 /cross-dept/merchandise；
 *         已開著的新版頁籤顯示通知與舊版連結、內容被隱藏。
 *   3. 管理員改回新版 -> 店長選單的商品部又是新版按鈕，點了開新版頁籤；先前頁籤的通知消失。
 * 全程記錄 console 錯誤與 pageerror；測試前後都把 merchandise 的備援狀態還原成測試前的樣子。
 */
const db = adminDb();
const KIND = 'merchandise';
const mark = () => `ZT2038-M9F01S-${runIdOrThrow()}`;
const SHOTS = path.resolve(__dirname, '..', 'reports', '_shots_m9');
let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
let before: any[] = [];
// 演練紀錄：每一步的時間與結果，測完寫成 JSON（scripts/m9-write-drill-log.cjs 轉成 docs/.../m9-fallback-drill.md）。
type DrillStep = { at: string; step: string; ok: boolean; ms?: number; note?: string };
const drill: DrillStep[] = [];
const stamp = async <T>(step: string, fn: () => Promise<T>, note?: string): Promise<T> => {
  const t0 = Date.now();
  try {
    const r = await fn();
    drill.push({ at: new Date().toISOString(), step, ok: true, ms: Date.now() - t0, note });
    return r;
  } catch (e) {
    drill.push({ at: new Date().toISOString(), step, ok: false, ms: Date.now() - t0, note: String((e as Error).message).slice(0, 200) });
    throw e;
  }
};
const startedAtAll = new Date().toISOString();

test.beforeAll(async () => {
  runIdOrThrow();
  fs.mkdirSync(SHOTS, { recursive: true });
  before = (await db.from('workspace_page_fallbacks').select('*').eq('kind', KIND)).data || [];
  await db.from('workspace_page_fallbacks').delete().eq('kind', KIND);
  ({ users, teardown } = await setupM6Users(['so_store_a']));
});
test.afterAll(async () => {
  await db.from('workspace_page_fallbacks').delete().eq('kind', KIND);
  if (before.length) await db.from('workspace_page_fallbacks').upsert(before, { onConflict: 'kind' });
  await db.from('workspace_page_fallback_events').delete().eq('kind', KIND).gte('created_at', startedAtAll); // 只刪測試期間新增的列
  const left = await teardown();
  expect(left, `清除臨時帳號：${left.join('; ')}`).toEqual([]);
});

async function adminCtx(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ baseURL: TEST_ORIGIN, storageState: await storageStateFor('admin') });
}
async function managerCtx(browser: Browser): Promise<BrowserContext> {
  const api = await apiForUser(users.so_store_a);
  const state = await api.storageState();
  await api.dispose();
  return browser.newContext({ baseURL: TEST_ORIGIN, storageState: state });
}
const watch = (page: Page, problems: string[]) => {
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 200)}`));
};
async function boot(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
}
async function openMenu(page: Page) {
  await page.click('.menu-toggle');
  await expect(page.locator('#workspace-menu')).toBeVisible();
}
async function openPage(page: Page, label: string) {
  await openMenu(page);
  await page.locator(`.workspace-menu button.catalog-item[title="${label}"]`).click();
  await expect(page.locator('#workspace-menu')).toHaveCount(0);
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const link = (page: Page) => page.getByTestId('back-to-legacy');

test('回舊版連結、備援開關：管理員與店長多角色劇本', async ({ browser }, testInfo) => {
  test.setTimeout(360_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const tag = mobile ? 'm' : 'd';
  const problems: string[] = [];
  const startedAt = new Date(Date.now() - 2000).toISOString();
  let flipAt = 0;
  let flipBackAt = 0;
  const admin = await adminCtx(browser);
  const mgr = await managerCtx(browser);
  try {
    const ap = await admin.newPage();
    const mp = await mgr.newPage();
    watch(ap, problems);
    watch(mp, problems);

    // ---- 1. 管理員：每個有舊版對應的頁面頁籤列都有「回舊版」，沒有舊版對應的不顯示
    await boot(ap);
    await expect(link(ap), '首頁沒有頁籤，不顯示').toHaveCount(0);
    const pages: [string, string][] = [['商品部', 'merchandise'], ['盤點管理', 'inventory'], ['角色權限管理', 'roles'], ['使用者管理', 'users'], ['年度行事曆', 'calendar'], ['我的任務', 'my-tasks']];
    for (const [label, kind] of pages) {
      await openPage(ap, label);
      const a = link(ap);
      await expect(a, `${label} 有回舊版`).toBeVisible();
      const expected = legacyRouteFor(kind)!;
      await expect(a).toHaveAttribute('href', expected);
      await expect(a).toHaveAttribute('target', '_blank');
      await expect(a).toHaveAttribute('rel', /noopener/);
      await expect(a).toContainText('回舊版');
      const box = (await a.boundingBox())!;
      expect(box.x >= 0 && box.x + box.width <= (ap.viewportSize()!.width), `${label} 連結在視窗內`).toBe(true);
      if (mobile) expect(box.height, `${label} 手機點擊區高度`).toBeGreaterThanOrEqual(40);
      expect(await noOverflow(ap), `${label} 沒有水平溢出`).toBe(true);
    }
    drill.push({ at: new Date().toISOString(), step: `管理員逐頁檢查「回舊版」連結（${pages.map((x) => x[0]).join('、')}）`, ok: true });
    await ap.screenshot({ path: path.join(SHOTS, `${tag}-back-to-legacy.png`) });

    // 點連結：新分頁開到舊版頁面（舊頁沿用同一份登入）
    await openPage(ap, '商品部');
    const [popup] = await Promise.all([ap.context().waitForEvent('page'), link(ap).click()]);
    await popup.waitForLoadState('domcontentloaded');
    expect(new URL(popup.url()).pathname).toBe('/cross-dept/merchandise');
    await popup.close();
    await expect(ap.locator('.tab.active')).toContainText('商品部'); // 原頁籤保留

    // ---- 2. 角色權限管理 -> 頁面回舊版設定（沒有舊版對應，不顯示連結）
    await openPage(ap, '角色權限管理');
    await ap.locator('[data-testid="open-page-fallbacks"]:visible').click();
    await expect(ap.getByTestId('page-fallbacks')).toBeVisible();
    await expect(ap.locator('.tab.active')).toContainText('頁面回舊版設定');
    await expect(link(ap), '頁面回舊版設定沒有舊版對應').toHaveCount(0);
    expect(await noOverflow(ap)).toBe(true);
    await expect(ap.locator(`li[data-kind="${KIND}"]`)).toContainText('目前開新版');

    // 店長：開著新版「商品部」
    await boot(mp);
    await openPage(mp, '商品部');
    await expect(mp.getByRole('heading', { name: '商品部管理', exact: true })).toBeVisible();
    await expect(link(mp)).toHaveAttribute('href', '/cross-dept/merchandise');
    await expect(mp.getByTestId('open-page-fallbacks'), '店長沒有設定入口').toHaveCount(0);

    // ---- 管理員切回舊版：沒填原因會被擋
    const row = ap.locator(`li[data-kind="${KIND}"]`);
    await row.getByTestId(`toggle-${KIND}`).click();
    await expect(ap.getByTestId('fallback-error')).toContainText('原因');
    await row.locator('input').fill(`${mark()} ${tag} 新版載入很慢`);
    await row.getByTestId(`toggle-${KIND}`).click();
    flipAt = Date.now();
    await expect(ap.getByTestId('fallback-message')).toContainText('已切回舊版');
    await expect(row).toContainText('目前開舊版');
    drill.push({ at: new Date().toISOString(), step: '管理員在「頁面回舊版設定」把商品部切回舊版（必填原因，沒填會被擋）', ok: true, ms: Date.now() - flipAt });
    await expect(row).toContainText('最後修改');
    await ap.screenshot({ path: path.join(SHOTS, `${tag}-admin-switched.png`) });

    // ---- 店長：開選單（重新讀 session）-> 商品部變成舊版連結；已開頁籤顯示通知
    await openMenu(mp);
    const legacyItem = mp.locator('.workspace-menu a.catalog-item[data-fallback="true"]').filter({ hasText: '商品部' });
    await stamp('管理員切回舊版後，店長開選單看到商品部改開舊版', async () => {
      await expect(legacyItem, '最慢一次 session 請求內生效').toBeVisible({ timeout: 15_000 });
    });
    drill[drill.length - 1].ms = Date.now() - flipAt;
    await expect(legacyItem).toHaveAttribute('href', '/cross-dept/merchandise');
    await expect(legacyItem).toHaveAttribute('target', '_blank');
    await expect(mp.locator('.workspace-menu button.catalog-item[title="商品部"]'), '新版按鈕不再提供').toHaveCount(0);
    await expect(legacyItem).toHaveAttribute('title', /暫時使用舊版/);
    const tabsBefore = await mp.locator('[role="tab"]').count();
    const [legacyPage] = await Promise.all([mp.context().waitForEvent('page'), legacyItem.click()]);
    await legacyPage.waitForLoadState('domcontentloaded');
    expect(new URL(legacyPage.url()).pathname).toBe('/cross-dept/merchandise');
    await legacyPage.close();
    expect(await mp.locator('[role="tab"]').count(), '沒有多開新版頁籤').toBe(tabsBefore);
    drill.push({ at: new Date().toISOString(), step: '店長點選單的商品部：另開分頁到舊版 /cross-dept/merchandise，沒有多開新版頁籤', ok: true });
    // 已開著的新版頁籤：通知 + 舊版連結 + 內容隱藏
    const notice = mp.locator('#panel-' + (await mp.locator('[role="tab"][aria-selected="true"]').getAttribute('id'))!.replace('tab-', '')).getByTestId('tab-fallback-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('新版載入很慢');
    await expect(notice.locator('a')).toHaveAttribute('href', '/cross-dept/merchandise');
    await expect(mp.getByRole('heading', { name: '商品部管理', exact: true })).toBeHidden();
    drill.push({ at: new Date().toISOString(), step: '店長原本開著的新版商品部頁籤：顯示切回舊版通知與連結，內容隱藏', ok: true });
    expect(await noOverflow(mp)).toBe(true);
    await mp.screenshot({ path: path.join(SHOTS, `${tag}-manager-notice.png`) });

    // ---- 3. 改回新版
    await ap.locator(`li[data-kind="${KIND}"]`).getByTestId(`toggle-${KIND}`).click();
    flipBackAt = Date.now();
    await expect(ap.getByTestId('fallback-message')).toContainText('已改回新版');
    await expect(ap.locator(`li[data-kind="${KIND}"]`)).toContainText('目前開新版');
    await openMenu(mp); // 先關再開：選單已開著時直接重新讀取
    const newItem = mp.locator('.workspace-menu button.catalog-item[title="商品部"]');
    if ((await newItem.count()) === 0) {
      await mp.keyboard.press('Escape');
      await openMenu(mp);
    }
    await stamp('管理員改回新版後，店長選單的商品部恢復開新版', async () => {
      await expect(newItem).toBeVisible({ timeout: 15_000 });
    });
    drill[drill.length - 1].ms = Date.now() - flipBackAt;
    await newItem.click();
    await expect(mp.getByRole('heading', { name: '商品部管理', exact: true }).last()).toBeVisible();
    await expect(mp.getByTestId('tab-fallback-notice')).toHaveCount(0);
    expect(await noOverflow(mp)).toBe(true);

    // 資料庫已改回、稽核留下兩筆
    const events = (await db.from('workspace_page_fallback_events').select('use_legacy').eq('kind', KIND).gte('created_at', startedAt).order('created_at')).data || [];
    expect(events.map((e: any) => e.use_legacy)).toEqual([true, false]);
    expect(problems, problems.join('\n')).toEqual([]);
  } finally {
    try {
      fs.writeFileSync(path.join(SHOTS, `drill-${tag}.json`), JSON.stringify({ project: testInfo.project.name, runId: runIdOrThrow(), steps: drill, problems }, null, 2));
    } catch {}
    await admin.close();
    await mgr.close();
  }
});
