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
