import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { apiForUser, type M5User } from './m5-fixtures';

/** 以 apiForUser 登入後的 cookie 開瀏覽器 context（W21 e2e 同做法）。 */
export async function contextFor(browser: Browser, user: M5User): Promise<BrowserContext> {
  const api = await apiForUser(user);
  const state = await api.storageState();
  await api.dispose();
  return browser.newContext({ baseURL: 'http://localhost:3002', storageState: state });
}
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}
/** 以深連結開啟年度行事曆（可指定日期，測試一律用保留年度 2099）。 */
export async function openCalendar(page: Page, date?: string) {
  await page.goto('about:blank'); // 只有 hash 不同時瀏覽器不會重新載入，先離開再進來才會重新讀深連結
  await page.goto(`/workspace/index.html#/open/calendar${date ? `?date=${date}` : ''}`, { waitUntil: 'networkidle' });
  await expect(page.getByTestId('calendar-page')).toBeVisible();
  await expect(page.getByTestId('month-grid')).toBeVisible();
}
export const cell = (page: Page, date: string) => page.locator(`[data-date="${date}"]`);
export const dayPanel = (page: Page) => page.getByTestId('day-panel');
