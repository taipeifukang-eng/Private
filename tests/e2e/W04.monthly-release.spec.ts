import { expect, test } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow, openNativeRelease, readNativeRelease } from '../support/w04-ui';

// W04 e2e：桌機 1440 與手機 390 各跑完整主流程（project 由 playwright-options 決定）。
// 流程：從選單開頁 → 最新一期預設展開 → 收合 → 再展開 → 鍵盤（Enter）收合 → 月份清單卡片點擊會展開並捲到該期 →
//       版面（卡片兩欄／單欄、無水平溢出）→ 無 pageerror。
// 不建立任何資料。

test('版更頁主流程：展開、收合、月份清單、版面', async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const mobile = testInfo.project.name === 'mobile-390';
  const ctx = await loginAs(browser, 'denied'); // 沒有任何權限的帳號也能完整使用
  const errors: string[] = [];
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await openNativeRelease(page);

    const release = page.locator('details[data-release="2026-03"]');
    const body = release.locator('.release-body');
    await expect(release).toHaveAttribute('open', '');
    await expect(body).toBeVisible();

    // 內容：三個段落標題、強調段落、六點更新、三點提醒。
    await expect(release.locator('[data-section-title]')).toHaveText(['一、本月重點更新（精簡）', '二、對使用者的主要影響', '三、提醒事項']);
    await expect(release.locator('[data-release-section]').nth(0).locator('[data-section-item]')).toHaveCount(6);
    await expect(release.locator('[data-release-section]').nth(1)).toHaveClass(/highlight/);
    await expect(release.locator('[data-release-section]').nth(2).locator('[data-section-item]')).toHaveCount(3);
    await expect(release.locator('[data-release-state]')).toHaveText('最新公告');

    // 版面：提醒卡片桌機兩欄、手機單欄；無水平溢出。
    const columns = await release.locator('ol.cards').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(mobile ? 1 : 2);
    expect(await noPageOverflow(page), '展開狀態水平溢出').toBe(true);

    // 收合 → 再展開（點擊標題區）。
    await release.locator('summary').click();
    await expect(release).not.toHaveAttribute('open', '');
    await expect(body).toBeHidden();
    expect(await noPageOverflow(page)).toBe(true);
    await release.locator('summary').click();
    await expect(release).toHaveAttribute('open', '');
    await expect(body).toBeVisible();

    // 鍵盤：焦點在標題區按 Enter 可收合。
    await release.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(release).not.toHaveAttribute('open', '');

    // 月份清單卡片：收合狀態下點擊會展開該期。
    await page.locator('[data-release-link="2026-03"]').click();
    await expect(release).toHaveAttribute('open', '');
    await expect(release.locator('summary')).toBeInViewport();

    // 狀態與 DOM 一致。
    const facts = await readNativeRelease(page);
    expect(facts.releases[0].open).toBe(true);
    expect(facts.index.count).toBe('共 1 期');
    expect(facts.index.cards).toEqual([{ month: '2026年3月', title: '2026年3月 系統版更公告', latest: true }]);

    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('版更頁：深色主題下文字與背景仍可辨識（對比不低於 3:1）', async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.locator('[data-home-card="monthly-release"]').click();
    await expect(page.getByRole('heading', { name: '每月版更內容', exact: true })).toBeVisible();
    const ratio = await page.evaluate(() => {
      const lum = (rgb: string) => {
        const [r, g, b] = (rgb.match(/[\d.]+/g) || []).slice(0, 3).map(Number).map((v) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const el = document.querySelector('[data-release-title]')!;
      const fg = getComputedStyle(el).color;
      const bg = getComputedStyle(document.querySelector('.release-banner')!).backgroundColor;
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      return (a + 0.05) / (b + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(3);
  } finally {
    await ctx.close();
  }
});
