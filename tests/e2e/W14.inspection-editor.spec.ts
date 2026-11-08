import { expect, test, type Page } from '@playwright/test';
import { loginAs, TEST_ORIGIN } from '../support/auth';
import { GPS_BASE, applyProjectViewport, grantGeolocation, noPageOverflow, openNativeNew, runIdOrThrow } from '../support/i01-fixtures';
import { ed, item, photoInput, png, selectStore, shot, sign, thumbs, waitUnlocked } from '../support/w14-ui';

// W14 e2e（桌機 1440、手機 390）：
//  追加要求：問題照片連續拍照（capture=environment、連拍到 5 張、按鈕消失與重現、縮圖刪除、手機觸控區）；
//  Q12 空白簽名不能確認、雙簽名才能送出；Q13 換門市自動帶入並在有手動修改時確認；
//  Q9 範本變更：擋下送出、保留還對得上的內容、列出對不上的、確認後才能再送。
// 不寫入資料庫（送出請求以 route 攔截），所以不會留下測試資料。

async function open(browser: any, testInfo: any) {
  runIdOrThrow();
  const ctx = await loginAs(browser, 'admin');
  await grantGeolocation(ctx, TEST_ORIGIN, GPS_BASE);
  const page: Page = await ctx.newPage();
  await applyProjectViewport(page, testInfo);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/geolocation|Failed to load resource/i.test(m.text()) && errors.push(m.text()));
  await openNativeNew(page);
  await waitUnlocked(page);
  return { ctx, page, errors };
}

test('連續拍照：後鏡頭 capture、連拍 5 張、第 5 張後按鈕消失並顯示上限、刪除後重現', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const { ctx, page, errors } = await open(browser, testInfo);
  try {
    const input = photoInput(page, 0);
    await expect(input).toHaveAttribute('capture', 'environment');
    await expect(input).toHaveAttribute('accept', 'image/*');
    const button = item(page, 0).locator('.photo-capture-button');
    const box = (await button.boundingBox())!;
    expect(box.width, '手機觸控區寬至少 96').toBeGreaterThanOrEqual(95.5);
    expect(box.height, '手機觸控區高至少 96').toBeGreaterThanOrEqual(95.5);
    await expect(item(page, 0)).toContainText('點擊拍照按鈕直接開啟相機');
    // 連拍：不等縮圖，直接連續加入 5 張（背景依序處理，不可遺失）
    for (let i = 0; i < 5; i++) await photoInput(page, 0).setInputFiles(png(i));
    await expect(thumbs(page, 0)).toHaveCount(5, { timeout: 30_000 });
    await expect(photoInput(page, 0)).toHaveCount(0);
    await expect(item(page, 0)).toContainText('已達上傳上限（5張）');
    // 每張縮圖右上角有刪除鈕；刪一張後按鈕重新出現，可補拍
    await thumbs(page, 0).nth(2).getByRole('button', { name: '刪除照片 3' }).click();
    await expect(thumbs(page, 0)).toHaveCount(4);
    await expect(photoInput(page, 0)).toHaveCount(1);
    await expect(item(page, 0)).not.toContainText('已達上傳上限');
    await photoInput(page, 0).setInputFiles(png(9));
    await expect(thumbs(page, 0)).toHaveCount(5, { timeout: 30_000 });
    // 照片已壓縮（長邊 800px 以內）
    const size = await thumbs(page, 0).first().locator('img').evaluate((el: HTMLImageElement) => ({ w: el.naturalWidth, h: el.naturalHeight }));
    expect(Math.max(size.w, size.h)).toBeLessThanOrEqual(800);
    // 第二個項目的照片獨立計算
    for (let i = 0; i < 2; i++) await photoInput(page, 1).setInputFiles(png(i));
    await expect(thumbs(page, 1)).toHaveCount(2, { timeout: 30_000 });
    await expect(thumbs(page, 0)).toHaveCount(5);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    await item(page, 0).scrollIntoViewIfNeeded();
    await shot(page, testInfo, 'w14-photo-capture');
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('簽名：沒畫前確認鈕是灰的；兩個簽名未完成時提交巡店為灰並說明缺哪個（F3），草稿照常可存', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const { ctx, page } = await open(browser, testInfo);
  const submit = ed(page).getByRole('button', { name: '提交巡店' });
  const hint = ed(page).getByTestId('submit-signature-hint');
  try {
    await expect(ed(page).getByText('店長／當班主管確認簽名')).toBeVisible();
    await expect(ed(page).getByText('督導簽名', { exact: true })).toBeVisible();
    await selectStore(page, 'ZT01');
    await ed(page).getByLabel(/室內溫度/).fill('26');
    // 兩個都沒簽：按鈕灰，兩個都提示
    await expect(submit).toBeDisabled();
    await expect(hint).toContainText('店長／當班主管簽名');
    await expect(hint).toContainText('督導簽名');
    // 草稿不受影響
    await expect(ed(page).getByRole('button', { name: '儲存草稿' })).toBeEnabled();
    // 只簽店長：仍灰，只提示督導
    await sign(page, 0);
    await expect(ed(page).getByAltText('店長／當班主管確認簽名')).toBeVisible();
    await expect(submit).toBeDisabled();
    await expect(hint).toHaveText('請完成督導簽名');
    // 開簽名板後直接取消，沒有產生簽名；督導欄位仍是空的
    await ed(page).getByRole('button', { name: '開啟簽名板' }).click();
    await expect(page.getByTestId('signature-confirm')).toBeDisabled();
    await page.locator('dialog[open]').getByRole('button', { name: '取消' }).click();
    await expect(ed(page).getByAltText('督導簽名')).toHaveCount(0);
    await shot(page, testInfo, 'w14-signature-required');
    // 補上督導簽名後可按
    await sign(page, 1);
    await expect(submit).toBeEnabled();
    await expect(hint).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

const ROSTERS: Record<string, { employee_code: string; employee_name: string; position: string }[]> = {
  ZT01: [
    { employee_code: 'ZT-A1', employee_name: '[自動測試]甲', position: '店長' },
    { employee_code: 'ZT-A2', employee_name: '[自動測試]乙', position: '藥師' },
  ],
  ZT02: [{ employee_code: 'ZT-B1', employee_name: '[自動測試]丙', position: '店員' }],
};

test('Q13 當班人員：換門市自動換成新名單；有手動修改先確認，取消則維持原門市與名單', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const { ctx, page } = await open(browser, testInfo);
  // 測試門市沒有上月在職資料時，以攔截回應注入名單（不寫入資料庫）。
  await page.route('**/api/workspace/inspection-form?*', async (route) => {
    const res = await route.fetch();
    const json = await res.json();
    const store = new URL(route.request().url()).searchParams.get('store');
    const code = (json.stores as any[]).find((s) => s.id === store)?.store_code;
    if (code && ROSTERS[code]) json.roster = ROSTERS[code];
    await route.fulfill({ response: res, json });
  });
  const rows = () => ed(page).locator('fieldset:has(legend:text("當班人員")) tbody tr');
  try {
    await selectStore(page, 'ZT01');
    await expect(rows()).toHaveCount(2);
    await expect(rows().first().getByLabel('人員 1 姓名')).toHaveValue('[自動測試]甲');
    // 沒動過名單：換門市直接換，不跳確認
    await selectStore(page, 'ZT02');
    await expect(rows()).toHaveCount(1);
    await expect(rows().first().getByLabel('人員 1 姓名')).toHaveValue('[自動測試]丙');
    await expect(page.getByTestId('staff-confirm-text')).toHaveCount(0);
    // 手動新增一人並勾當班督導 → 換門市要確認
    await ed(page).getByRole('button', { name: '手動新增人員' }).click();
    await rows().nth(1).getByLabel('人員 2 姓名').fill('[自動測試]手動');
    await rows().nth(1).getByLabel('人員 2 當班督導').check();
    await selectStore(page, 'ZT01');
    await expect(page.getByTestId('staff-confirm-text')).toBeVisible();
    await page.getByTestId('staff-keep').click();
    await expect(ed(page).getByLabel('巡店門市')).toHaveValue(/.+/);
    await expect(ed(page).getByLabel('巡店門市').locator('option:checked')).toContainText('ZT02');
    await expect(rows()).toHaveCount(2);
    await expect(rows().nth(1).getByLabel('人員 2 姓名')).toHaveValue('[自動測試]手動');
    // 再換一次並確認：整份換成新門市名單，手動資料清掉
    await selectStore(page, 'ZT01');
    await page.getByTestId('staff-replace').click();
    await expect(rows()).toHaveCount(2);
    await expect(rows().first().getByLabel('人員 1 姓名')).toHaveValue('[自動測試]甲');
    await expect(ed(page).getByText('[自動測試]手動')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
  } finally {
    await ctx.close();
  }
});

test('Q9 範本變更：擋下送出但保留還對得上的勾選、備註、照片，列出對不上的，確認後才能再送', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page } = await open(browser, testInfo);
  const fakeId = '00000000-0000-4000-8000-0000000000a9';
  let patched = false;
  const posts: any[] = [];
  await page.route('**/api/workspace/inspection-form**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      posts.push(JSON.parse(req.postData() || '{}'));
      if (posts.length === 1)
        return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: '巡店範本已更新，請保留草稿並重新載入' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ record: { id: fakeId, workspace_version: 1 } }) });
    }
    const res = await route.fetch();
    if (!patched) return route.fulfill({ response: res });
    const json = await res.json();
    // 模擬後台改了範本：第一個項目少了一個勾選選項、其餘不變，雜湊改變
    const first = json.templates[0];
    first.checklist_items = first.checklist_items.slice(1);
    json.templateHash = 'patched-' + json.templateHash;
    return route.fulfill({ response: res, json });
  });
  try {
    await selectStore(page, 'ZT01');
    await ed(page).getByLabel(/室內溫度/).fill('26');
    // 第一個項目：勾第 1、第 2 個選項（第 1 個之後會被移除），寫備註、加照片；第二個項目也寫備註
    const first = item(page, 0);
    const boxes = first.locator('.inspection-check input[type=checkbox]');
    await expect.poll(() => boxes.count()).toBeGreaterThanOrEqual(2);
    const removedLabel = (await boxes.nth(0).getAttribute('value'))!;
    const keptLabel = (await boxes.nth(1).getAttribute('value'))!;
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await first.getByLabel(/備註$/).fill('ZT 範本變更備註-1');
    await photoInput(page, 0).setInputFiles(png(1));
    await expect(thumbs(page, 0)).toHaveCount(1, { timeout: 30_000 });
    await item(page, 1).getByLabel(/備註$/).fill('ZT 範本變更備註-2');
    await sign(page, 0);
    await sign(page, 1);
    patched = true;
    await ed(page).getByRole('button', { name: '提交巡店' }).click();
    await page.getByRole('button', { name: '確認提交' }).click();
    // 被擋下：不丟內容、不跳錯誤視窗，列出對不上的項目
    const notices = page.getByTestId('carryover-notices');
    await expect(notices).toBeVisible({ timeout: 30_000 });
    await expect(notices).toContainText(removedLabel);
    await expect(notices).not.toContainText(keptLabel);
    await expect(first.getByLabel(/備註$/)).toHaveValue('ZT 範本變更備註-1');
    await expect(item(page, 1).getByLabel(/備註$/)).toHaveValue('ZT 範本變更備註-2');
    await expect(thumbs(page, 0)).toHaveCount(1);
    await expect(first.locator('.inspection-check input[type=checkbox]:checked')).toHaveCount(1);
    await expect(ed(page).getByAltText('店長／當班主管確認簽名')).toBeVisible();
    await expect(ed(page).getByAltText('督導簽名')).toBeVisible();
    expect(posts).toHaveLength(1);
    await shot(page, testInfo, 'w14-carryover');
    // 沒確認清單就送出：前端擋下（不送出第二次請求）
    await ed(page).getByRole('button', { name: '提交巡店' }).click();
    await page.getByRole('button', { name: '確認提交' }).click();
    await expect(page.locator('dialog[open]')).toContainText('先確認');
    await page.getByRole('button', { name: '返回編輯' }).click();
    expect(posts).toHaveLength(1);
    // 確認後可以送出；送出內容用的是新範本雜湊，且保留了備註與照片
    await page.getByTestId('carryover-ack').check();
    await ed(page).getByRole('button', { name: '提交巡店' }).click();
    await page.getByRole('button', { name: '確認提交' }).click();
    await expect(ed(page).getByText('巡店已完成提交')).toBeVisible({ timeout: 30_000 });
    expect(posts).toHaveLength(2);
    expect(posts[1].templateHash).toMatch(/^patched-/);
    expect(posts[1].scores[0].checked_items).toEqual([keptLabel]);
    expect(posts[1].scores[0].notes).toBe('ZT 範本變更備註-1');
    expect(posts[1].scores[0].photos).toHaveLength(1);
  } finally {
    await ctx.close();
  }
});
