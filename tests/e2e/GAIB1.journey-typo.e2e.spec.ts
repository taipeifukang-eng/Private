import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { TEST_ORIGIN } from '../support/auth';
import { adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedCategory, seedLocation, seedLocationPart, seedPart, stores, seedBalance } from '../support/m7m8-fixtures';
import { seedRequest, setupPoUsers, type PoUser } from '../support/m7m8-po-fixtures';
import { openGaCenter, openGaSide, shell } from '../support/g01-ui';
import { dialog } from '../support/g12-ui';
import { expectNoOverflow } from '../support/gaib1-ui';

// ga-improve-b1 小錯字劇本：店長（手機 390）在「我的追蹤」按「確認完成」，提示是「確認完成。」，不是「確認完成完成。」。
// （另一個小錯字「已付款或已連結發票的進貨單不再顯示登錄憑證」由 GAIB1.journey-ui 第 1 劇本在到貨後驗證。）
let users: Record<string, PoUser> = {};
let teardown: () => Promise<string[]> = async () => [];
let state: any;
const real = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(['rq_store_part']);
  users = made.users;
  teardown = made.teardown;
  const c = await apiForUser(users.rq_store_part as any);
  state = await c.storageState();
  await c.dispose();
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('店長確認完成：提示是「確認完成。」且沒有「完成完成」；無錯誤、無溢出', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '店長固定用手機視窗，只在桌機 project 跑一次');
  test.setTimeout(300_000);
  const st = await stores();
  const cat = await seedCategory('part', 'GAIB1T');
  const part = await seedPart(cat.id, 'GAIB1T-熱感紙', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  const loc = await seedLocation(null, 'GAIB1T-倉');
  await seedLocationPart(loc.id, part.id);
  await seedBalance(loc.id, part.id, 10);
  const r = await seedRequest(st.VW001.id, users.rq_store_part.id, 'GAIB1T-確認', { part_id: part.id, desired_unit: part.base_unit, desired_quantity: 2, main_status: 'WAITING_STORE_CONFIRMATION', intake_route: 'STOCK_ISSUE' });
  const ctx = await browser.newContext({ baseURL: TEST_ORIGIN, storageState: state, serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  try {
    await openGaCenter(page);
    await openGaSide(page);
    await shell(page).locator('aside').getByRole('button', { name: '我的追蹤', exact: true }).locator('visible=true').first().click();
    await page.getByLabel('狀態').selectOption('WAITING_STORE_CONFIRMATION');
    await page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first().fill(r.request_no);
    const row = page.locator('[data-testid="mr-card"]:visible', { hasText: r.request_no });
    await expect(row).toHaveCount(1);
    await row.getByTestId('open-detail').click();
    await expect(dialog(page).getByTestId('request-detail')).toBeVisible();
    await page.getByTestId('act-confirm_complete').click();
    await page.getByTestId('action-submit').click();
    const notice = page.getByTestId('detail-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText('確認完成。');
    await expect(notice).not.toContainText('完成完成');
    expect((await adminDb().from('ga_service_requests').select('main_status').eq('id', r.id).single()).data).toMatchObject({ main_status: 'COMPLETED' });
    await expectNoOverflow(page, '店長確認完成（手機）');
    expect(real(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  void m7Name;
});
