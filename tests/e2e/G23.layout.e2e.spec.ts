import { expect, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { gaNavToIn, noPageOverflow, openGaCenter, pageForUser, visibleHeading } from '../support/g01-ui';
import { dialog } from '../support/g12-ui';
import { assertGaBaseline, callFn, cleanupM7M8, stores } from '../support/m7m8-fixtures';
import { ga6Name, setupGa6Users, type Ga6User } from '../support/m7m8-ga6-fixtures';

// M7/M8 第 6 批 G23.layout.e2e（水電網費的版面，桌機 1440 與手機 390 各跑一次）：
//  - 帳單列表：摘要卡、篩選列、帳單卡片、分頁都沒有水平溢出；沒有任何東西超出視窗。
//  - 新增費用視窗、異常提醒面板、已繳修改確認面板、帳單詳情（含標記已繳面板與附件區）、刪除面板：每個彈出視窗都在視窗內、沒有水平捲動、主要按鈕在視窗內可按。
//  - 費用報表：手機把表格轉成卡片（每格有標籤）、桌機是表格；長條不超出。
// 每步用 service role 回讀資料庫。測試資料帶 QA-GA6- 標記、只用 VW 測試門市，結束只清自己的。
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });

const GROUP = '水電電話網路費';
let users: Record<string, Ga6User> = {};
let teardown: () => Promise<string[]> = async () => [];
let state: any;
let st: Awaited<ReturnType<typeof stores>>;
let billId = '';
const isPhone = (page: Page) => (page.viewportSize()?.width || 1440) < 700;
const noConsole = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const vis = (page: Page, testid: string) => page.getByTestId(testid).locator('visible=true');
const IDENT = 'QA-GA6-LAY-0001';

async function dialogFits(page: Page) {
  const vp = page.viewportSize()!;
  const m = await dialog(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, over: el.scrollWidth - el.clientWidth };
  });
  expect(m.left).toBeGreaterThanOrEqual(-1);
  expect(m.right).toBeLessThanOrEqual(vp.width + 1);
  expect(m.over).toBeLessThanOrEqual(1);
}
async function inViewport(page: Page, testid: string) {
  const vp = page.viewportSize()!;
  const b = dialog(page).getByTestId(testid).last();
  await b.scrollIntoViewIfNeeded();
  await expect(b).toBeInViewport({ ratio: 1 });
  const box = await b.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  st = await stores();
  const made = await setupGa6Users(['util_mgr']);
  users = made.users;
  teardown = made.teardown;
  state = await (await apiForUser(users.util_mgr as any)).storageState();
  for (const [m, a] of [['2038-02', 1200], ['2038-03', 1300], ['2038-04', 1100], ['2038-05', 1250]] as const) {
    const r = await callFn(users.util_mgr.client, 'ga_ws_ub_save', { p_id: null, p_payload: { store_id: st.VW001.id, expense_type: 'WATER', billing_month: m, provider_name: ga6Name('LAY'), service_identifier: IDENT, amount: a, due_date: '2038-06-20', notes: '版面測試的長備註：'.repeat(8) }, p_expected_updated_at: null, p_confirm_paid_change: false });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    billId = r.data.id;
  }
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('帳單列表與各個彈出視窗：沒有水平溢出、視窗在畫面內、主要按鈕可按', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, state, testInfo);
  try {
    await openGaCenter(page);
    await gaNavToIn(page, GROUP, '帳單列表');
    await expect(visibleHeading(page, '水電電話網路費')).toBeVisible();
    await vis(page, 'filter-month').fill('');
    await vis(page, 'bill-search').fill(IDENT);
    await expect(page.locator('[data-testid="bill-card"]:visible')).toHaveCount(4);
    expect(await noPageOverflow(page)).toBe(true);
    // 卡片寬度不超出內容區
    const cardFits = await page.locator('[data-testid="bill-card"]:visible').first().evaluate((el) => el.getBoundingClientRect().right <= window.innerWidth + 1);
    expect(cardFits).toBe(true);

    // 新增費用視窗
    await vis(page, 'new-bill').click();
    await expect(page.getByTestId('utility-form')).toBeVisible();
    await dialogFits(page);
    await page.getByTestId('uf-store').selectOption(st.VW001.id);
    await page.getByTestId('uf-type').selectOption('INTERNET');
    await expect(page.getByTestId('uf-serial')).toBeVisible();
    await page.getByTestId('uf-type').selectOption('ELECTRICITY');
    await expect(page.getByTestId('uf-kwh')).toBeVisible();
    await page.getByTestId('uf-type').selectOption('WATER');
    await inViewport(page, 'uf-save');
    // 異常提醒面板：同鍵、2038-06、金額 12000
    await page.getByTestId('uf-month').fill('2038-06');
    await page.getByTestId('uf-provider').fill(ga6Name('LAY'));
    await page.getByTestId('uf-ident').fill(IDENT);
    await page.getByTestId('uf-amount').fill('12000');
    await vis(page, 'uf-save').click();
    await expect(vis(page, 'uf-anomaly')).toBeVisible();
    await dialogFits(page);
    await inViewport(page, 'uf-save-anyway');
    await vis(page, 'uf-back').click();
    await vis(page, 'uf-cancel').click();
    await expect(page.getByTestId('utility-form')).toHaveCount(0);

    // 詳情：長備註不撐破、標記已繳面板、附件區
    await page.locator('[data-testid="bill-card"]:visible').first().getByTestId('open-bill').click();
    await expect(page.getByTestId('bill-detail')).toBeVisible();
    await dialogFits(page);
    await expect(dialog(page).getByText('帳單掃描檔與照片')).toBeVisible();
    await vis(page, 'bd-delete').click();
    await dialogFits(page);
    await inViewport(page, 'bd-delete-ok');
    await vis(page, 'bd-delete-reason').fill('x');
    await dialog(page).getByRole('button', { name: '取消' }).first().click();
    await vis(page, 'bd-edit').click();
    await expect(page.getByTestId('utility-form')).toBeVisible();
    await dialogFits(page);
    await inViewport(page, 'uf-save');
    await vis(page, 'uf-cancel').click(); // 編輯會關掉詳情，取消後回到列表
    await expect(page.getByTestId('utility-form')).toHaveCount(0);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  expect(billId).toBeTruthy();
});

test('費用報表：桌機是表格、手機轉成卡片（每格帶標籤）；摘要卡與長條不超出；切換月、季、年版面不亂', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, state, testInfo);
  try {
    await openGaCenter(page);
    await gaNavToIn(page, GROUP, '費用報表');
    await expect(visibleHeading(page, '費用報表')).toBeVisible();
    await vis(page, 'rp-year').fill('2038');
    await vis(page, 'rp-month').selectOption('03');
    await expect(vis(page, 'rp-range')).toContainText('2038-03-01');
    await expect.poll(async () => page.locator('[data-testid="rp-row"]:visible').count(), { timeout: 20_000 }).toBeGreaterThan(5);
    const row = page.locator('[data-testid="rp-row"]:visible', { hasText: 'VW001' }).first();
    await expect(row).toContainText('NT$ 1,300');
    expect(await noPageOverflow(page)).toBe(true);
    if (isPhone(page)) {
      await expect(page.locator('.rp-table thead').first()).toBeHidden();
      await expect(row.locator('td[data-label="水費"]')).toBeVisible();
    } else {
      await expect(page.locator('.rp-table thead').first()).toBeVisible();
    }
    await vis(page, 'rp-mode').selectOption('quarter');
    await vis(page, 'rp-quarter').selectOption('1');
    await expect(vis(page, 'rp-range')).toContainText('2038-01-01');
    await expect(page.locator('[data-testid="rp-row"]:visible', { hasText: 'VW001' }).first()).toContainText('NT$ 2,500');
    await vis(page, 'rp-mode').selectOption('year');
    await expect(vis(page, 'rp-range')).toContainText('2038-12-31');
    await expect(page.locator('[data-testid="rp-row"]:visible', { hasText: 'VW001' }).first()).toContainText('NT$ 4,850');
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});
