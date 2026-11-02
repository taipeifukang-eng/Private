/**
 * T03 全站回歸：以 admin 角色逐一開啟導覽中「已登錄 kind」的工作頁，擷取頁籤標題與主要元素。
 *
 * - 基準模式：T03_BASELINE=write -> 寫入 tests/fixtures/t03-nav-baseline.json（重構前執行一次）。
 * - 比對模式（預設）：重構後再跑一次，與基準逐項比對；不一致即失敗。
 *
 * 只讀取（只開啟頁籤，不按任何儲存／送出），不寫入任何資料。
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { loginAs } from '../support/auth';

const BASELINE = path.resolve(__dirname, '..', 'fixtures', 't03-nav-baseline.json');
const WRITE = process.env.T03_BASELINE === 'write';

type PageFacts = {
  navLabel: string;
  tabTitle: string;
  headings: string[];
  hasTable: boolean;
  hasForm: boolean;
  hasErrorNotice: boolean;
  allowedNoticeShown: boolean;
};

test('T03 全站回歸：admin 導覽 kind 逐頁基準', async ({ browser }) => {
  test.setTimeout(600_000);
  const ctx = await loginAs(browser, 'admin');
  const page = await ctx.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/workspace/index.html');
  await page.waitForSelector('.menu-toggle');

  const labels = await (async () => {
    await page.click('.menu-toggle');
    await page.waitForSelector('.workspace-menu');
    return page.$$eval('.workspace-menu button.catalog-item', (els) => els.map((e) => (e.textContent || '').trim()));
  })();
  await page.keyboard.press('Escape');
  expect(labels.length).toBeGreaterThan(10);

  const results: PageFacts[] = [];
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index];
    await page.click('.menu-toggle');
    await page.waitForSelector('.workspace-menu');
    await page.locator('.workspace-menu button.catalog-item').nth(index).click();
    await page.waitForSelector('[role="tab"][aria-selected="true"]');
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.waitForTimeout(3500);
    const facts = await page.evaluate((navLabel) => {
      const tab = document.querySelector('[role="tab"][aria-selected="true"]') as HTMLElement | null;
      const panel = document.getElementById((tab?.getAttribute('aria-controls') as string) || '');
      const heads = panel ? Array.from(panel.querySelectorAll('h1,h2,h3')).map((h) => (h.textContent || '').trim()).filter(Boolean) : [];
      return {
        navLabel,
        tabTitle: (tab?.getAttribute('title') || '').trim(),
        headings: heads.slice(0, 8),
        hasTable: !!panel?.querySelector('table'),
        hasForm: !!panel?.querySelector('input,select,textarea'),
        hasErrorNotice: !!panel?.querySelector('.notice.error'),
        allowedNoticeShown: !!panel?.querySelector('[role="alert"]'),
      };
    }, label);
    results.push(facts);
  }
  expect(pageErrors, `pageerror: ${pageErrors.join(' | ')}`).toEqual([]);
  await ctx.close();

  const snapshot = { count: results.length, pages: results };
  if (WRITE) {
    fs.writeFileSync(BASELINE, `${JSON.stringify(snapshot, null, 2)}\n`);
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as typeof snapshot;
  expect(snapshot.count).toBe(baseline.count);
  for (let i = 0; i < baseline.pages.length; i++) expect(snapshot.pages[i], `頁面 ${baseline.pages[i].navLabel}`).toEqual(baseline.pages[i]);
});
