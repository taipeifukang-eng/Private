import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { applyProjectViewport, noPageOverflow } from './w04-ui';
import { openFromMenu } from './m3-fixtures';
import { loginAs } from './auth';

export { applyProjectViewport, noPageOverflow, openFromMenu };

/** 以角色登入後開新頁（套用 project viewport），並收集 console／頁面錯誤。 */
export async function pageFor(browser: any, role: string, testInfo: TestInfo) {
  const ctx = await loginAs(browser, role);
  const page: Page = await ctx.newPage();
  await applyProjectViewport(page, testInfo);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, page, errors };
}

export async function pageForUser(browser: any, state: any, testInfo: TestInfo) {
  const ctx = await browser.newContext({ baseURL: 'http://localhost:3002', storageState: state, serviceWorkers: 'block' });
  const page: Page = await ctx.newPage();
  await applyProjectViewport(page, testInfo);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, page, errors };
}

/** 目前顯示中的總務外殼（每個頁籤都有自己的外殼，只取看得見的那個）。 */
export const shell = (page: Page): Locator => page.locator('[data-testid="ga-shell"]:visible').first();

/** 從全站選單進入「總務服務中心」入口頁。 */
export async function openGaCenter(page: Page) {
  await openFromMenu(page, '服務中心首頁');
  await expect(page.getByRole('heading', { name: '總務服務中心', exact: true }).first()).toBeVisible();
  await expect(shell(page)).toBeVisible();
}

/** 手機寬度時側欄是抽屜，先打開；桌機側欄一直都在。 */
export async function openGaSide(page: Page) {
  const bar = shell(page).getByRole('button', { name: '總務選單', exact: true });
  if ((await bar.isVisible()) && (await bar.getAttribute('aria-expanded')) !== 'true') await bar.click();
}

/** 在總務側欄展開一個群組（如「料件管理」）。 */
export async function expandGroup(page: Page, name: string) {
  const btn = shell(page).locator('aside').getByRole('button', { name, exact: true });
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
}

/** 點總務側欄的項目（會在新版頁籤開啟）。 */
export async function gaNavTo(page: Page, label: string, group?: string) {
  await openGaSide(page);
  if (group) await expandGroup(page, group);
  await shell(page).locator('aside').getByRole('button', { name: label, exact: true }).click();
}

export async function sideLabels(page: Page): Promise<string[]> {
  await openGaSide(page);
  return shell(page).locator('aside .ga-link').allTextContents();
}

export const visibleHeading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('visible=true').first();

/** 點某個群組底下的項目（不同群組有同名項目時用，例如設備管理與設施管理都有「保固管理」「維修紀錄」）。 */
export async function gaNavToIn(page: Page, group: string, label: string) {
  await openGaSide(page);
  await expandGroup(page, group);
  const li = shell(page).locator('aside li').filter({ has: page.getByRole('button', { name: group, exact: true }) }).first();
  await li.locator('.ga-sub').getByRole('button', { name: label, exact: true }).click();
}

/** 勾選框要是一般大小（寬高 <= 24px），所屬標籤要單行（高度 <= 1.6 倍行高），避免全域 input 樣式把它放大成方塊。 */
export async function expectTidyCheckbox(page: Page, label: string) {
  const box = page.getByLabel(label).locator('visible=true').first();
  const m = await box.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const lab = el.closest('label') as HTMLElement;
    const lr = lab.getBoundingClientRect();
    return { w: r.width, h: r.height, labelH: lr.height, line: parseFloat(getComputedStyle(lab).lineHeight) || parseFloat(getComputedStyle(lab).fontSize) * 1.4 };
  });
  if (m.w > 24 || m.h > 24) throw new Error(`勾選框「${label}」太大：${m.w}x${m.h}`);
  if (m.labelH > Math.max(m.line * 1.6, 44)) throw new Error(`勾選框「${label}」的標籤不是單行：高度 ${m.labelH}`);
}
