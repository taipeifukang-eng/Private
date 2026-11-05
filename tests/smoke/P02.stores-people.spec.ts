import { expect, test, type Page } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, collectErrors, noPageOverflow, workPanel } from '../support/p02-fixtures';

// P02 冒煙層：舊版 11 頁（/admin/stores、create、map、[id]/edit、[id]/clone、[id]/employees、[id]/employee-management、
// [id]/promotion-management、store-managers、supervisors、import-employees）在新版都能從選單或門市列表開啟並載入，
// 沒有 console 錯誤與頁面層級水平溢出（桌機 1440 與手機 390）。唯讀，不建立任何資料。

async function openMenu(page: Page, menuTitle: string, heading: string) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.locator(`.workspace-menu button.catalog-item[title="${menuTitle}"]`).click();
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible({ timeout: 60_000 });
}
async function openStoreRowAction(page: Page, action: RegExp | string, heading: string | RegExp) {
  await openMenu(page, '門市管理', '門市管理');
  const p = workPanel(page);
  await p.getByLabel('搜尋門市').fill('ZT01');
  const row = p.locator('tbody tr').filter({ hasText: 'ZT01' }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole('button', { name: action, exact: typeof action === 'string' }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible({ timeout: 60_000 });
}

const cases: { name: string; legacy: string; open: (page: Page) => Promise<void> }[] = [
  { name: '門市列表', legacy: '/admin/stores', open: (p) => openMenu(p, '門市管理', '門市管理') },
  {
    name: '新增門市', legacy: '/admin/stores/create',
    open: async (p) => { await openMenu(p, '門市管理', '門市管理'); await workPanel(p).getByRole('button', { name: '新增門市' }).click(); await expect(p.getByRole('heading', { name: '新增門市', exact: true })).toBeVisible(); },
  },
  {
    name: '門市整合地圖', legacy: '/admin/stores/map',
    open: async (p) => { await openMenu(p, '門市管理', '門市管理'); await workPanel(p).getByRole('button', { name: '門市整合地圖' }).click(); await expect(p.getByRole('heading', { name: '門市整合地圖', exact: true })).toBeVisible(); },
  },
  { name: '編輯門市', legacy: '/admin/stores/[id]/edit', open: (p) => openStoreRowAction(p, '編輯', '編輯門市') },
  { name: '搬遷與沿革', legacy: '/admin/stores/[id]/clone', open: (p) => openStoreRowAction(p, /搬遷／沿革|查看沿革/, '門市搬遷與沿革') },
  { name: '門市員工', legacy: '/admin/stores/[id]/employees', open: (p) => openStoreRowAction(p, '員工', /測試門市|ZT 測試門市 01|門市員工/) },
  { name: '門市員工主檔／歷程', legacy: '/admin/stores/[id]/employee-management', open: (p) => openStoreRowAction(p, '員工主檔／歷程', '門市員工主檔') },
  { name: '門市批次升遷', legacy: '/admin/stores/[id]/promotion-management', open: (p) => openStoreRowAction(p, '批次升遷', '批次升遷') },
  { name: '店長指派', legacy: '/admin/store-managers', open: (p) => openMenu(p, '店長指派', '店長指派') },
  { name: '經理／督導管理', legacy: '/admin/supervisors', open: (p) => openMenu(p, '經理/督導管理', '經理／督導管理') },
  { name: '批次匯入員工', legacy: '/admin/import-employees', open: (p) => openMenu(p, '批次匯入員工', '批次匯入員工') },
];

for (const c of cases) {
  test(`${c.name}（${c.legacy}）：可開啟、沒有 console 錯誤與水平溢出`, async ({ browser }, testInfo) => {
    test.setTimeout(150_000);
    const ctx = await loginAs(browser, 'admin');
    try {
      const page = await ctx.newPage();
      await applyProjectViewport(page, testInfo);
      const errors = collectErrors(page);
      await c.open(page);
      await page.waitForLoadState('networkidle');
      expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}

test('門市列表：顯示「顯示已停止門市 (N)」與已停止數量（F.3）', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openMenu(page, '門市管理', '門市管理');
    const p = workPanel(page);
    await expect(p.getByText(/顯示已停止門市 \(\d+\)/)).toBeVisible({ timeout: 60_000 });
    await expect(p.getByText(/已停止 \d+ 間/)).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('門市整合地圖：預設只看營運中，管理員可勾選「顯示已停止門市」（F.3）', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openMenu(page, '門市管理', '門市管理');
    await workPanel(page).getByRole('button', { name: '門市整合地圖' }).click();
    const p = workPanel(page);
    const box = p.getByRole('checkbox', { name: '顯示已停止門市', exact: true });
    await expect(box).toBeVisible({ timeout: 60_000 });
    await expect(box).not.toBeChecked();
    await expect(p.locator('.map-store', { hasText: '已停止' })).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
