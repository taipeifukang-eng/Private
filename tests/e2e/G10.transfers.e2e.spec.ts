import { expect, type Page, test } from '@playwright/test';
import { adminDb, assertGaBaseline, cleanupM7M8, row, seedCategory, seedEquipment, seedFacility, stores } from '../support/m7m8-fixtures';
import { apiAs } from '../support/auth';
import { gaNavTo, noPageOverflow, openGaCenter, pageFor } from '../support/g01-ui';
import { makePng } from '../support/png';

// M7/M8 第 2 批 Q28 轉移單 e2e（桌機 1440 與手機 390 各跑一次，使用 project 的視窗大小）：
//  - 總務：從轉移單頁發起（搜尋設備、選轉入門市、原因必填）、從設備詳情發起、查看歷程、取消（原因必填、設備不動）。
//  - 店長：待我處理（手機一張一卡、大按鈕、無水平捲動）、確認交出（附照片）、確認收到（換店）、角標；沒有權限者沒有按鈕。
// 完整的角色接力（總務桌機 -> A 店店長手機 -> B 店店長手機）在 G10.journey-transfer.spec.ts。
let eqCat: { id: string };
let facCat: { id: string };
const png = () => makePng({ width: 120, height: 80, inkPixels: 20 });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  eqCat = await seedCategory('equipment', 'XE');
  facCat = await seedCategory('facility', 'XF');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
});

const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('visible=true').first();
const dialog = (page: Page) => page.locator('dialog[open]').last();
const notice = (page: Page, text: string | RegExp) => page.locator('.notice:visible', { hasText: text }).first();
/** 轉移單列：桌機是表格列，手機是卡片。 */
const transferRow = (page: Page, text: string) => page.locator('tr[data-testid="transfer-row"]:visible, li[data-testid="transfer-card"]:visible', { hasText: text });
/** 對話框的主按鈕與「返回」要一開啟就在視窗內（手機 390×844 內容很長時按鈕列固定在底部，不用捲動）。 */
async function expectActionsInViewport(page: Page, primary: string) {
  const vh = page.viewportSize()!.height;
  for (const b of [dialog(page).getByRole('button', { name: primary }).last(), dialog(page).getByRole('button', { name: '返回' })]) {
    await expect(b).toBeInViewport({ ratio: 1 });
    const box = await b.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(vh);
  }
}
const tab = (page: Page, name: string | RegExp) => page.getByRole('tab', { name }).locator('visible=true').first();

async function pickStore(scope: ReturnType<Page['locator']>, label: string, code: string) {
  await scope.getByRole('combobox', { name: new RegExp(label) }).fill(code);
  await scope.getByRole('option').filter({ hasText: code }).first().getByRole('button').click();
}

test('總務：轉移單頁發起（必填檢查、搜尋選設備、選轉入門市）→ 列表出現待交出 → 查看歷程 → 取消（原因必填）→ 設備仍在原門市', async ({ browser }, testInfo) => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'XF-發起');
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '轉移單');
    await expect(heading(page, '設備轉移單')).toBeVisible();
    await page.getByRole('button', { name: '發起轉移單' }).click();
    await dialog(page).getByRole('searchbox', { name: '搜尋要轉移的資產' }).fill(eq.name);
    await dialog(page).getByRole('button', { name: `選擇 ${eq.name}` }).click();
    await expect(dialog(page).getByTestId('transfer-picked')).toContainText(eq.name);
    // 必填檢查
    await dialog(page).getByRole('button', { name: '送出轉移單' }).click();
    await expect(dialog(page).getByText('請選擇轉入門市')).toBeVisible();
    await pickStore(dialog(page), '轉入門市', 'VW001');
    await dialog(page).getByRole('button', { name: '送出轉移單' }).click();
    await expect(dialog(page).getByText('請輸入轉移原因')).toBeVisible();
    // 同店
    await pickStore(dialog(page), '轉入門市', 'ZT01');
    await dialog(page).getByLabel('轉移原因').fill('E2E 調撥');
    await dialog(page).getByRole('button', { name: '送出轉移單' }).click();
    await expect(dialog(page).getByText('轉入門市與目前所屬門市相同')).toBeVisible();
    await dialog(page).getByRole('combobox', { name: /轉入門市/ }).fill('VW001');
    await dialog(page).getByRole('option').filter({ hasText: 'VW001' }).first().getByRole('button').click();
    await dialog(page).getByRole('button', { name: '送出轉移單' }).click();
    await expect(notice(page, '已發起轉移單')).toBeVisible();
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    // 列表：待交出；設備還在 ZT01
    const r = transferRow(page, eq.name);
    await expect(r).toBeVisible();
    await expect(r).toContainText('等轉出門市確認交出');
    expect((await row('ga_equipment', eq.id)).store_id).toBe((await stores()).ZT01.id);
    // 總務不是店長：沒有「確認交出」按鈕
    await expect(r.getByRole('button', { name: '確認交出' })).toHaveCount(0);
    // 歷程
    await r.getByRole('button', { name: /查看/ }).click();
    await expect(dialog(page)).toContainText('轉移單詳情');
    await expect(dialog(page).getByTestId('transfer-event')).toHaveCount(1);
    await expect(dialog(page).getByTestId('transfer-event').first()).toContainText('總務發起轉移');
    await expect(dialog(page).getByTestId('transfer-event').first()).toContainText('E2E 調撥');
    // 取消：原因必填
    await dialog(page).getByRole('button', { name: '取消轉移單' }).click();
    await dialog(page).getByRole('button', { name: '確認取消轉移單' }).click();
    await expect(dialog(page).getByText('請輸入取消原因')).toBeVisible();
    await dialog(page).getByLabel('取消原因').fill('E2E 不調了');
    await dialog(page).getByRole('button', { name: '確認取消轉移單' }).click();
    await expect(notice(page, '已取消轉移單')).toBeVisible();
    expect((await row('ga_equipment', eq.id)).store_id).toBe((await stores()).ZT01.id);
    await tab(page, '已取消').click();
    await expect(transferRow(page, eq.name)).toContainText('已取消');
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('總務：從設備詳情發起轉移（已帶入設備，只填轉入門市與原因）；有進行中轉移單時詳情不再顯示發起轉移', async ({ browser }, testInfo) => {
  const eq = await seedEquipment('ZT01', eqCat.id, 'XF-詳情發起');
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await gaNavTo(page, '設備清冊', '設備管理');
    await page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first().fill(eq.name);
    await page.locator('tr:visible, li.asset-card:visible', { hasText: eq.name }).getByRole('button', { name: /查看/ }).click();
    await expect(dialog(page).getByRole('heading', { name: eq.name })).toBeVisible();
    await dialog(page).getByRole('button', { name: '發起轉移' }).click();
    const d = dialog(page);
    await expect(d.getByTestId('transfer-picked')).toContainText(eq.name);
    await pickStore(d, '轉入門市', 'VW002');
    await d.getByLabel('轉移原因').fill('E2E 詳情發起');
    await d.getByRole('button', { name: '送出轉移單' }).click();
    // 回到詳情，顯示進行中轉移單，且沒有「發起轉移」
    await expect(dialog(page).getByText(/進行中的轉移單 AT\d{8}-\d{4}/)).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: '發起轉移' })).toHaveCount(0);
    // 編輯畫面提示改走轉移單、不能改所屬門市
    await dialog(page).getByRole('button', { name: '編輯' }).click();
    await expect(dialog(page)).toContainText('平常換店請發起「轉移單」');
    await dialog(page).getByRole('button', { name: '取消' }).click();
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
  await adminDb().from('ga_asset_transfers').update({ status: 'CANCELLED' }).eq('asset_id', eq.id); // 清理由 fixture 刪除；先收單避免唯一索引影響其他測試
});

test('店長（ZT01 帳號）：待我處理 → 確認交出（附照片）→ 單子移到進行中；B 店店長確認收到後換店；角標與按鈕只在自己要處理的單上出現；頁面無水平捲動', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const eq = await seedEquipment('ZT01', eqCat.id, 'XF-店長');
  const fac = await seedFacility('ZT01', facCat.id, 'XF-設施');
  const api = await apiAs('ga_works');
  const s = await stores();
  const mk = async (type: string, id: string) => (await (await api.post('/api/workspace/general-affairs/transfers', { data: { assetType: type, assetId: id, toStoreId: s.VW001.id, reason: 'E2E 店長接力' } })).json()).data;
  const t1 = await mk('EQUIPMENT', eq.id);
  const t2 = await mk('FACILITY', fac.id);
  await api.dispose();
  const a = await pageFor(browser, 'store_manager', testInfo);
  const b = await pageFor(browser, 'ga_store_manager_b', testInfo);
  try {
    await openGaCenter(a.page);
    await gaNavTo(a.page, '轉移單');
    await expect(heading(a.page, '設備轉移單')).toBeVisible();
    // A 店長：有待我處理角標，預設就在「待我處理」，沒有發起按鈕
    await expect(tab(a.page, /待我處理/)).toHaveAttribute('aria-selected', 'true');
    await expect(a.page.getByTestId('todo-count').locator('visible=true')).toBeVisible();
    await expect(a.page.getByRole('button', { name: '發起轉移單' })).toHaveCount(0);
    const ra = transferRow(a.page, eq.name);
    await expect(ra).toBeVisible();
    await expect(transferRow(a.page, fac.name)).toContainText('設施');
    await expect(ra.getByRole('button', { name: '確認收到' })).toHaveCount(0);
    await expect(ra.getByRole('button', { name: '取消' })).toHaveCount(0);
    expect(await noPageOverflow(a.page)).toBe(true);
    if (testInfo.project.name === 'mobile-390') {
      const box = await ra.getByRole('button', { name: '確認交出' }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await ra.getByRole('button', { name: '確認交出' }).click();
    await expect(dialog(a.page)).toContainText('確認交出');
    await expectActionsInViewport(a.page, '確認交出');
    await dialog(a.page).getByLabel('備註').fill('E2E 已裝箱');
    await dialog(a.page).getByTestId('upload-input').setInputFiles({ name: 'm7m8t-handover.png', mimeType: 'image/png', buffer: png() });
    await expect(dialog(a.page).getByRole('list', { name: '待上傳的檔案' })).toContainText('m7m8t-handover.png');
    await expectActionsInViewport(a.page, '確認交出');
    await dialog(a.page).getByRole('button', { name: '確認交出' }).last().click();
    await expect(notice(a.page, '已確認交出')).toBeVisible();
    await expect(transferRow(a.page, eq.name)).toHaveCount(0); // 已不在待我處理
    await expect(transferRow(a.page, fac.name)).toBeVisible();
    expect((await row('ga_equipment', eq.id)).store_id).toBe(s.ZT01.id);

    // B 店店長：待我處理只有已交出的那張；設施那張還在等 A 店，不在待辦
    await openGaCenter(b.page);
    await gaNavTo(b.page, '轉移單');
    await expect(tab(b.page, /待我處理/)).toHaveAttribute('aria-selected', 'true');
    await expect(transferRow(b.page, eq.name)).toBeVisible();
    await expect(transferRow(b.page, fac.name)).toHaveCount(0);
    await expect(transferRow(b.page, eq.name).getByRole('button', { name: '確認交出' })).toHaveCount(0);
    await transferRow(b.page, eq.name).getByRole('button', { name: '確認收到' }).click();
    await expectActionsInViewport(b.page, '確認收到');
    await dialog(b.page).getByTestId('upload-input').setInputFiles({ name: 'm7m8t-receive.png', mimeType: 'image/png', buffer: png() });
    await expectActionsInViewport(b.page, '確認收到');
    await dialog(b.page).getByRole('button', { name: '確認收到' }).last().click();
    await expect(notice(b.page, /已確認收到.*原 QR 標籤繼續可用/)).toBeVisible();
    expect((await row('ga_equipment', eq.id)).store_id).toBe(s.VW001.id);
    expect(await noPageOverflow(b.page)).toBe(true);
    // 已完成分頁看得到，詳情有兩段照片
    await tab(b.page, '已完成').click();
    await transferRow(b.page, eq.name).getByRole('button', { name: /查看/ }).click();
    await expect(dialog(b.page).getByTestId('transfer-event')).toHaveCount(3);
    await expect(dialog(b.page).getByRole('heading', { name: '交出時的照片' })).toBeVisible();
    await expect(dialog(b.page).getByRole('heading', { name: '收到時的照片' })).toBeVisible();
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  } finally {
    await a.ctx.close();
    await b.ctx.close();
  }
  // 設施那張留在待交出：收單，避免影響其他測試
  await adminDb().from('ga_asset_transfers').update({ status: 'CANCELLED' }).eq('id', t2.id);
  expect(t1.id).toBeTruthy();
});

test('沒有權限的人：無權限者看不到轉移單入口也進不了頁；設備查看者沒有入口（API 可讀、不能發起）', async ({ browser }, testInfo) => {
  const denied = await pageFor(browser, 'denied', testInfo);
  const viewer = await pageFor(browser, 'ga_equipment_view', testInfo);
  try {
    await denied.page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    const res = await denied.ctx.request.get('/api/workspace/general-affairs/transfers');
    expect(res.status()).toBe(403);
    await openGaCenter(viewer.page);
    await expect(viewer.page.locator('[data-testid="ga-shell"]:visible aside .ga-link', { hasText: '轉移單' })).toHaveCount(0);
    const vr = await viewer.ctx.request.get('/api/workspace/general-affairs/transfers');
    expect(vr.status()).toBe(200);
    const created = await viewer.ctx.request.post('/api/workspace/general-affairs/transfers', {
      headers: { Origin: 'http://localhost:3002' },
      data: { assetType: 'EQUIPMENT', assetId: '00000000-0000-4000-8000-000000000000', toStoreId: '00000000-0000-4000-8000-000000000001', reason: 'x' },
    });
    expect(created.status()).toBe(403);
  } finally {
    await denied.ctx.close();
    await viewer.ctx.close();
  }
});
