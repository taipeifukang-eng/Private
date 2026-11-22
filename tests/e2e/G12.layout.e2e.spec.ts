import { expect, type Page, test } from '@playwright/test';
import { assertGaBaseline, cleanupM7M8, seedBalance, seedCategory, seedLocation, seedLocationPart, seedPart } from '../support/m7m8-fixtures';
import { noPageOverflow, openGaCenter, pageFor } from '../support/g01-ui';
import { dialog, invNavTo, pick } from '../support/g12-ui';

// M7/M8 第 3 批 G12 版面鎖定（桌機 1440 與手機 390 各跑一次）：
//  - 三個分頁（餘額、流水、持有狀態）統計卡排列（桌機一列四張、手機兩欄）、無水平溢出；手機改成卡片、卡片操作按鈕高度 >= 44px。
//  - 過帳視窗、風險確認、持有狀態調整視窗、修改紀錄視窗：不超出視窗寬度、主要按鈕一開啟就在視窗內。
let loc: { id: string; name: string };
let part: { id: string; name: string };

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const cat = await seedCategory('part', 'G12L');
  loc = await seedLocation('ZT04', 'LY-位置');
  part = await seedPart(cat.id, 'LY-料件', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  await seedLocationPart(loc.id, part.id, { safety_stock_qty: 5, reorder_point_qty: 10 });
  await seedBalance(loc.id, part.id, 12);
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

async function inViewport(page: Page, names: (string | RegExp)[]) {
  const vp = page.viewportSize()!;
  for (const n of names) {
    const b = dialog(page).getByRole('button', { name: n }).last();
    await expect(b).toBeInViewport({ ratio: 1 });
    const box = await b.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
  }
}
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
const cardsLayout = async (page: Page, name: string, phone: boolean) => {
  const cards = page.getByRole('list', { name }).locator('visible=true').getByRole('listitem');
  await expect(cards).toHaveCount(4);
  const tops = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(phone ? 2 : 1);
};

test('三個分頁版面：統計卡排列、無水平溢出、手機卡片按鈕夠大；過帳視窗與風險確認、持有狀態調整與修改紀錄視窗不超出視窗、主要按鈕在視窗內', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  const phone = (page.viewportSize()?.width || 1440) < 700;
  try {
    await openGaCenter(page);
    await invNavTo(page, '庫存總覽');
    await expect(page.getByRole('heading', { name: '庫存餘額', exact: true }).locator('visible=true').first()).toBeVisible();
    await page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first().fill(part.name);
    await cardsLayout(page, '庫存餘額統計', phone);
    await expect(page.locator('[data-testid="balance-row"]:visible, [data-testid="balance-card"]:visible', { hasText: part.name })).toHaveCount(1);
    expect(await noPageOverflow(page)).toBe(true);
    // 子分頁按鈕夠大（手機要能點）
    for (const id of ['balances', 'transactions', 'holding']) expect((await page.getByTestId(`tab-${id}`).locator('visible=true').boundingBox())!.height).toBeGreaterThanOrEqual(40);

    // 過帳視窗
    await page.getByTestId('open-post').locator('visible=true').click();
    await expect(dialog(page).getByRole('heading', { name: '庫存過帳' })).toBeVisible();
    await dialogFits(page);
    await pick(dialog(page), /^庫存位置 \*$/, '庫存位置選項', loc.name, loc.name);
    await pick(dialog(page), /^料件 \*$/, '料件選項', part.name, part.name);
    await dialogFits(page);
    await dialog(page).getByRole('radio', { name: '出庫' }).check();
    await dialog(page).getByLabel('數量', { exact: true }).fill('2');
    await dialog(page).getByLabel('原因', { exact: true }).fill('版面');
    await dialog(page).getByTestId('post-submit').scrollIntoViewIfNeeded();
    await inViewport(page, ['取消', /^下一步：確認$/]);
    await dialog(page).getByTestId('post-submit').click();
    await expect(dialog(page).getByTestId('post-confirm')).toBeVisible();
    await dialogFits(page);
    await dialog(page).getByTestId('post-confirm-ok').scrollIntoViewIfNeeded();
    await inViewport(page, ['返回修改', '確認過帳']);
    await dialog(page).getByRole('button', { name: '返回修改' }).click();
    await dialog(page).getByRole('button', { name: '取消' }).click();

    // 流水分頁
    await page.getByTestId('tab-transactions').locator('visible=true').click();
    await expect(page.getByTestId('txn-total').locator('visible=true')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);

    // 持有狀態分頁
    await page.getByTestId('tab-holding').locator('visible=true').click();
    await cardsLayout(page, '持有狀態統計（全部）', phone);
    await page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first().fill(part.name);
    const row = page.locator('[data-testid="holding-row"]:visible, [data-testid="holding-card"]:visible', { hasText: part.name });
    await expect(row).toHaveCount(1);
    if (phone) for (const b of await row.getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await noPageOverflow(page)).toBe(true);
    await row.getByRole('button', { name: /^調整/ }).click();
    await dialogFits(page);
    await inViewport(page, ['儲存', '取消']);
    await dialog(page).getByRole('button', { name: '取消' }).click();
    await row.getByRole('button', { name: /^修改紀錄/ }).click();
    await dialogFits(page);
    await inViewport(page, ['關閉']);
    await dialog(page).getByRole('button', { name: '關閉' }).click();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  } finally {
    await ctx.close();
  }
});
