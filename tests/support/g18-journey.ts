import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { TEST_ORIGIN } from './auth';
import { adminDb } from './m7m8-fixtures';
import { openGaCenter, openGaSide, shell, visibleHeading } from './g01-ui';
import { dialog } from './g12-ui';

// M7/M8 第 5 批角色接力劇本共用輔助（G18.journey-*、G19.journey-legacy、G28、G18.print）：
// 各角色自己決定視窗（店長手機 390、總務與工務桌機 1440）、頁面錯誤收集、工單中心／總務組頁／我的追蹤的操作與資料庫回讀。
export type Who = { ctx: BrowserContext; page: Page; errors: string[] };
export const realErrors = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
export const db = () => adminDb();

export async function openAs(browser: Browser, state: any, kind: 'desktop' | 'phone'): Promise<Who> {
  const ctx = await browser.newContext({
    baseURL: TEST_ORIGIN, storageState: state, serviceWorkers: 'block',
    ...(kind === 'phone' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }),
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, page, errors };
}
export const isPhone = (page: Page) => (page.viewportSize()?.width || 1440) < 700;
export const vis = (page: Page, testid: string): Locator => page.getByTestId(testid).locator('visible=true');
export const searchBox = (page: Page) => page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first();

export async function gaNav(page: Page, label: string) {
  await openGaSide(page);
  await shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first().click();
}
/** 進入工單中心。 */
export async function openCenter(page: Page) {
  await openGaCenter(page);
  await gaNav(page, '工單中心');
  await expect(visibleHeading(page, '工單中心')).toBeVisible();
}
/** 在工單列表以關鍵字搜尋到唯一一張並開啟詳情（手機單欄：先回列表）。 */
export async function openWo(page: Page, term: string) {
  if (isPhone(page) && (await vis(page, 'wo-back').count())) await vis(page, 'wo-back').first().click();
  await vis(page, 'wob-search').fill(term);
  await expect(vis(page, 'wob-total')).toHaveText('共 1 張');
  await expect(vis(page, 'wob-card')).toHaveCount(1);
  await expect(vis(page, 'wob-card').first()).toContainText(term);
  await vis(page, 'wob-open').first().click();
  await expect(vis(page, 'wo-detail')).toBeVisible();
}
/** 開啟詳情後的表單送出（更新進度等），回傳等待提示出現。 */
export async function submitForm(page: Page, expectNotice: string | RegExp) {
  await dialog(page).getByTestId('wo-submit').click();
  await expect(page.locator('dialog[open]')).toHaveCount(0); // 表單關閉才代表這次送出完成（提示文字可能是上一次留下的）
  await expect(vis(page, 'wo-notice')).toContainText(expectNotice);
}
/** 我的追蹤：以單號搜尋並開啟需求單詳情。 */
export async function openMyRequest(page: Page, no: string) {
  await searchBox(page).fill(no);
  const row = page.locator('[data-testid="mr-card"]:visible', { hasText: no });
  await expect(row).toHaveCount(1);
  await row.getByTestId('open-detail').click();
  await expect(dialog(page).getByTestId('request-detail')).toBeVisible();
}
/** 總務需求工作台：以單號搜尋並開啟需求單詳情。 */
export async function openWorkbenchRequest(page: Page, no: string) {
  await searchBox(page).fill(no);
  const row = page.locator('[data-testid="rq-row"]:visible, [data-testid="rq-card"]:visible', { hasText: no });
  await expect(row).toHaveCount(1);
  await row.getByTestId('open-detail').click();
  await expect(dialog(page).getByTestId('request-detail')).toBeVisible();
}
export async function dialogFits(page: Page) {
  const vp = page.viewportSize()!;
  const m = await dialog(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, over: el.scrollWidth - el.clientWidth };
  });
  expect(m.left).toBeGreaterThanOrEqual(-1);
  expect(m.right).toBeLessThanOrEqual(vp.width + 1);
  expect(m.over).toBeLessThanOrEqual(1);
}

// ------------------------------------------------------------------ 資料庫回讀
export const woRow = async (id: string) => (await db().from('maintenance_requests').select('*').eq('id', id).maybeSingle()).data as any;
export const reqRow = async (id: string) => (await db().from('ga_service_requests').select('*').eq('id', id).single()).data as any;
export const reqByNo = async (no: string) => (await db().from('ga_service_requests').select('*').eq('request_no', no).single()).data as any;
export const woEvents = async (id: string) => ((await db().from('maintenance_ticket_events').select('*').eq('ticket_id', id).order('created_at').order('id')).data || []) as any[];
export const woUpdates = async (id: string) => ((await db().from('maintenance_updates').select('*').eq('request_id', id).order('created_at').order('id')).data || []) as any[];
export const reqEvents = async (id: string) => ((await db().from('ga_service_request_events').select('*').eq('request_id', id).order('created_at').order('id')).data || []) as any[];
export const attachments = async (resourceId: string) => ((await db().from('ga_resource_attachments').select('*').eq('resource_id', resourceId)).data || []) as any[];
export const balanceOf = async (locationId: string, partId: string) =>
  Number(((await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', locationId).eq('part_id', partId).maybeSingle()).data as any)?.quantity_base ?? 0);
export const ledgerOf = async (refId: string) => ((await db().from('ga_inventory_transactions').select('*').eq('reference_id', refId).order('created_at')).data || []) as any[];
