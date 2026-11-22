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

test('T03 全站回歸：admin 導覽 kind 逐頁基準', async ({ browser }, testInfo) => {
  // 此測試自行固定 1440 視窗，手機 project 重複執行沒有意義。
  test.skip(testInfo.project.name === 'mobile-390', '桌機專用（內部固定 1440 視窗）');
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
    // 等標題集合穩定（非同步載入的區塊可能晚於固定等待才出現）：連續兩次取樣相同才繼續，最多 20 秒。
    {
      let last = '';
      for (let n = 0; n < 28; n++) {
        const { cur, busy } = await page.evaluate(() => {
          const t = document.querySelector('[role="tab"][aria-selected="true"]');
          const pnl = document.getElementById(t?.getAttribute('aria-controls') || '');
          // 面板內仍有「載入…」狀態列（例如每月人員狀態的名冊與門市統計是依序載入的）就不算穩定。
          const loading = pnl ? Array.from(pnl.querySelectorAll('[role="status"]')).some((e) => /^載入/.test((e.textContent || '').trim())) : false;
          return { cur: pnl ? Array.from(pnl.querySelectorAll('h1,h2,h3')).map((h) => (h.textContent || '').trim()).join('|') : '', busy: loading };
        });
        if (busy) { last = ''; await page.waitForTimeout(700); continue; }
        if (cur && cur === last) break;
        last = cur;
        await page.waitForTimeout(700);
      }
    }
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
  // 標題清單含 DEV 資料動態產生的項目（例如藥師姓名、督導區），因此以「基準標題都必須出現」比對，不要求完全相等；
  // 其餘欄位（標籤、頁籤標題、表格／表單／錯誤提示）維持完全比對。
  // 巡店列表預設月份＝近 6 個月內最新有資料的月份（M4 Q4，伺服器決定），隨 DEV 資料與日期變動：
  // 比對時把 YYYY-MM 正規化成佔位符（格式仍須符合），並忽略依資料有無才出現的空狀態標題。
  const MONTH_RE = /20\d{2}-(0[1-9]|1[0-2])/g;
  const norm = (v: string) => v.replace(MONTH_RE, 'YYYY-MM');
  const DATA_DEPENDENT_HEADINGS = new Set(['這個月份沒有巡店紀錄']);
  for (let i = 0; i < baseline.pages.length; i++) {
    const { headings: baseHeadings, ...baseRest } = baseline.pages[i];
    const { headings: gotHeadings, ...gotRest } = snapshot.pages[i];
    if (baseRest.navLabel === '巡店列表') {
      expect(gotRest.tabTitle, '巡店列表 頁籤標題月份格式').toMatch(/^巡店 · .+ · 20\d{2}-(0[1-9]|1[0-2])$/);
    }
    expect({ ...gotRest, tabTitle: norm(gotRest.tabTitle) }, `頁面 ${baseline.pages[i].navLabel}`).toEqual({ ...baseRest, tabTitle: norm(baseRest.tabTitle) });
    expect(gotHeadings.map(norm), `頁面 ${baseline.pages[i].navLabel} 標題`).toEqual(
      expect.arrayContaining(baseHeadings.filter((h) => !DATA_DEPENDENT_HEADINGS.has(h)).map(norm)),
    );
  }
});
