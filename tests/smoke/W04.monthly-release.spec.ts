import { expect, test } from '@playwright/test';
import { apiAs, loginAs, TEST_ORIGIN } from '../support/auth';
import { applyProjectViewport, noPageOverflow, openNativeRelease, readNativeRelease, RELEASE_TITLE } from '../support/w04-ui';

// W04 冒煙層：每月版更內容頁「登入即可看」。各種角色（含完全沒有權限的 denied）都能從選單開啟，
// 看到 2026-03 這一期且預設展開；沒有 pageerror、console 錯誤與頁面層級水平溢出。
// 此頁沒有資料請求，也不建立任何測試資料（不需 registry）。

const ROLES = ['admin', 'ops_manager', 'supervisor', 'store_manager', 'employee', 'denied'];

for (const role of ROLES) {
  test(`版更頁冒煙 ${role}`, async ({ browser }, testInfo) => {
    test.setTimeout(120_000);
    const api = await apiAs(role);
    try {
      const session = await (await api.get('/api/workspace/session')).json();
      expect(session.capabilities.monthlyRelease).toBe(true);
    } finally {
      await api.dispose();
    }
    const ctx = await loginAs(browser, role);
    const errors: string[] = [];
    try {
      const page = await ctx.newPage();
      await applyProjectViewport(page, testInfo);
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await openNativeRelease(page);
      const { releases, index } = await readNativeRelease(page);
      expect(releases.map((r) => r.slug)).toEqual(['2026-03']);
      expect(releases[0].open, '最新一期預設展開').toBe(true);
      expect(releases[0].state).toBe('最新公告');
      expect(index.count).toBe('共 1 期');
      await expect(page.getByText('2026年3月 系統版更公告').first()).toBeVisible();
      await expect(page.getByRole('heading', { name: '一、本月重點更新（精簡）' })).toBeVisible();
      await expect(page.locator('.notice.error')).toHaveCount(0);
      expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
      expect(errors, errors.join('\n')).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}

test('選單項目：所有登入角色都看得到「每月版更內容」', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  for (const role of ['admin', 'denied']) {
    const ctx = await loginAs(browser, role);
    try {
      const page = await ctx.newPage();
      await applyProjectViewport(page, testInfo);
      await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
      await page.waitForSelector('.menu-toggle');
      await page.click('.menu-toggle');
      await expect(page.locator(`.workspace-menu button.catalog-item[title="${RELEASE_TITLE}"]`), role).toHaveCount(1);
    } finally {
      await ctx.close();
    }
  }
});

test('未登入：session 回 401，不會洩漏頁面所需的 capability', async ({ request }) => {
  const res = await request.get(`${TEST_ORIGIN}/api/workspace/session`);
  expect(res.status()).toBe(401);
});
