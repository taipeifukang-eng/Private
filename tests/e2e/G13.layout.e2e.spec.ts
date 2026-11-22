import crypto from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { apiAs } from '../support/auth';
import { assertGaBaseline, cleanupM7M8, m7Name, seedBalance, seedCategory, seedLocation, seedLocationPart, seedPart } from '../support/m7m8-fixtures';
import { noPageOverflow, openGaCenter, pageFor } from '../support/g01-ui';
import { dialog, invNavTo, trRow } from '../support/g12-ui';

// M7/M8 第 3 批 G13 版面鎖定（桌機 1440 與手機 390 各跑一次）：
//  - 調撥單頁統計卡排列（桌機一列四張共兩列、手機兩欄共四列）、無水平溢出；手機改成卡片、卡片按鈕高度 >= 44px。
//  - 建單視窗、詳情視窗（含動作面板、取消的「退回來源庫存」提醒）：不超出視窗寬度、主要按鈕一開啟就在視窗內。
let no = '';
let id = '';
let loc: { src: any; dest: any };

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const cat = await seedCategory('part', 'G13L');
  const src = await seedLocation(null, 'LY-倉');
  const dest = await seedLocation('ZT01', 'LY-店');
  const part = await seedPart(cat.id, 'LY-料件', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  await seedLocationPart(src.id, part.id);
  await seedLocationPart(dest.id, part.id);
  await seedBalance(src.id, part.id, 20);
  loc = { src, dest };
  const api = await apiAs('ga_staff');
  const r = await api.post('/api/workspace/general-affairs/inventory/transfers', {
    data: { source_location_id: src.id, destination_location_id: dest.id, part_id: part.id, quantity: 3, input_unit_type: 'BASE', reason: m7Name('LY-原因'), idempotency_key: crypto.randomUUID() },
  });
  const b = await r.json();
  const c = await api.post(`/api/workspace/general-affairs/inventory/transfers/${b.data.id}/actions`, { data: { action: 'confirm_source', expected_updated_at: b.data.updated_at, idempotency_key: crypto.randomUUID() } });
  expect(c.status()).toBe(200);
  await api.dispose();
  no = b.data.transfer_no;
  id = b.data.id;
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

test('調撥單頁版面：八張統計卡排列、無水平溢出、手機卡片按鈕夠大；建單視窗與詳情視窗與動作面板不超出視窗、主要按鈕在視窗內', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageFor(browser, 'ga_staff', testInfo);
  const phone = (page.viewportSize()?.width || 1440) < 700;
  try {
    await openGaCenter(page);
    await invNavTo(page, '調撥與收貨');
    await expect(page.getByTestId('tr-total').locator('visible=true')).toBeVisible();
    const cards = page.getByRole('list', { name: '調撥單統計' }).locator('visible=true').getByRole('listitem');
    await expect(cards).toHaveCount(8);
    const tops = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(phone ? 4 : 2);
    expect(await noPageOverflow(page)).toBe(true);
    await page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first().fill(no);
    await expect(trRow(page, no)).toHaveCount(1);
    if (phone) {
      const box = await trRow(page, no).getByTestId('open-detail').boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await noPageOverflow(page)).toBe(true);

    // 建單視窗
    await page.getByTestId('open-create').locator('visible=true').click();
    await expect(dialog(page).getByTestId('create-submit')).toBeVisible();
    await dialogFits(page);
    await inViewport(page, ['取消']);
    expect(await noPageOverflow(page)).toBe(true);
    await dialog(page).getByRole('button', { name: '取消' }).click();

    // 詳情視窗＋動作面板（取消的退回庫存提醒）
    await trRow(page, no).getByTestId('open-detail').click();
    await expect(dialog(page).getByTestId('transfer-detail')).toBeVisible();
    await dialogFits(page);
    await dialog(page).getByTestId('act-cancel').click();
    await expect(dialog(page).getByTestId('return-warning')).toBeVisible();
    await dialogFits(page);
    await dialog(page).getByTestId('action-submit').scrollIntoViewIfNeeded();
    await inViewport(page, ['先不要']);
    expect(await noPageOverflow(page)).toBe(true);
    await dialog(page).getByTestId('detail-close').click();
    expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  } finally {
    await ctx.close();
  }
  void id;
  void loc;
});
