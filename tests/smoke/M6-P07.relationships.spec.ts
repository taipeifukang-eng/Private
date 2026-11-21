import { expect, test, type Page } from '@playwright/test';
import { apiAs, loginAs, TEST_ORIGIN } from '../support/auth';
import { apiForUser, setupM6Users, type M6User } from '../support/m6-fixtures';

/**
 * M6 第一批 P07 關係會員冒煙：view／edit／delete／approve 各一個帳號與無權限帳號，桌機 1440 與手機 390。
 * 驗證入口、按鈕可見性（viewer 看不到核可／駁回／刪除／匯入／編輯）、表頭欄位順序（姓名、電話兩欄）、無 pageerror、手機不橫向捲出。
 * 只讀取。
 */
type Row = { who: string; entry: boolean; submit: boolean; sales: boolean; operations: boolean };
const ROWS: Row[] = [
  { who: 'admin', entry: true, submit: true, sales: true, operations: true },
  { who: 'relationship_view', entry: true, submit: true, sales: true, operations: false },
  { who: 'relationship_edit', entry: true, submit: true, sales: true, operations: true },
  { who: 'relationship_delete', entry: true, submit: true, sales: true, operations: true },
  { who: 'rel_approve', entry: true, submit: false, sales: false, operations: true },
  { who: 'denied', entry: false, submit: false, sales: false, operations: false },
];
const BASE_HEADS = ['姓名', '電話', '關係', '填表人／日期', '會員編號', '審核狀態'];

let users: Record<string, M6User>;
let teardown: () => Promise<string[]>;
test.beforeAll(async () => {
  ({ users, teardown } = await setupM6Users(['rel_approve']));
});
test.afterAll(async () => {
  expect(await teardown()).toEqual([]);
});

async function open(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.waitForSelector('.workspace-menu');
}

for (const r of ROWS) {
  test(`關係會員冒煙 ${r.who}（${r.entry ? '有入口' : '無入口'}）`, async ({ browser }) => {
    test.setTimeout(120_000);
    let ctx;
    if (r.who === 'rel_approve') {
      const api = await apiForUser(users.rel_approve);
      const state = await api.storageState();
      await api.dispose();
      ctx = await browser.newContext({ baseURL: TEST_ORIGIN, storageState: state });
    } else ctx = await loginAs(browser, r.who);
    try {
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
      await open(page);
      const entry = page.locator('.workspace-menu button.catalog-item[title="關係會員"]');
      if (!r.entry) {
        await expect(entry).toHaveCount(0);
        expect((await ctx.request.get('/api/workspace/relationships')).status()).toBe(403);
        return;
      }
      await entry.click();
      await expect(page.getByRole('heading', { name: '關係會員', exact: true })).toBeVisible();
      await page.waitForFunction(() => !/載入中/.test(document.querySelector('.toolbar span')?.textContent || ''));
      await expect(page.locator('.relationship-page .notice.error')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '新增關係會員申請' })).toHaveCount(r.submit ? 1 : 0);
      await expect(page.getByRole('button', { name: '銷售明細報表', exact: true })).toHaveCount(r.sales ? 1 : 0);
      const heads = (await page.locator('.relationship-page section:visible thead th').allTextContents()).map((h) => h.trim());
      expect(heads).toEqual(r.operations ? [...BASE_HEADS, '操作'] : BASE_HEADS);
      // 作用中的分頁就算被滑鼠停在上面（hover）也要維持主色底白字，不能變成淡底白字
      const activeTab = page.locator('.section-tabs button[aria-pressed="true"]');
      await activeTab.hover();
      const tabStyle = await activeTab.evaluate((el) => {
        const cs = getComputedStyle(el);
        const probe = document.createElement('i');
        probe.style.color = 'var(--primary)';
        document.body.appendChild(probe);
        const primary = getComputedStyle(probe).color;
        probe.remove();
        return { bg: cs.backgroundColor, primary, opacity: cs.opacity };
      });
      expect(tabStyle.bg, '作用中分頁 hover 時仍為主色底').toBe(tabStyle.primary);
      expect(tabStyle.opacity).toBe('1');
      if (r.sales) {
        await page.getByRole('button', { name: '銷售明細報表', exact: true }).click();
        await expect(page.getByRole('button', { name: '匯入銷售明細 Excel' })).toHaveCount(r.who === 'relationship_edit' || r.who === 'admin' ? 1 : 0);
        await expect(page.getByRole('button', { name: '下載範本' })).toHaveCount(r.who === 'relationship_edit' || r.who === 'admin' ? 1 : 0);
        const salesHeads = (await page.locator('.relationship-page section:visible thead th').allTextContents()).map((h) => h.trim());
        expect(salesHeads).toEqual(['門市代號', '銷售日期', '會員編號／姓名', '品號／品名', '數量', '金額', '匯入來源／時間']);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '無水平溢出').toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}

test('關係會員 API 與入口一致（view 看得到的，session 導覽也有；沒有的就沒有）', async () => {
  const api = await apiAs('relationship_view');
  try {
    const session = await (await api.get('/api/workspace/session')).json();
    expect(session.capabilities.relationships).toBe(true);
  } finally {
    await api.dispose();
  }
});
