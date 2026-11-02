import { expect, test, type Page } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { readRowsAsServiceRole } from '../support/parity';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRegistry, RUN_ID_RE } = require('../support/registry.cjs') as {
  createRegistry: (o: { runId: string }) => { record: (e: { table: string; values: string[]; note?: string }) => void };
  RUN_ID_RE: RegExp;
};

// M0 樣本頁「關係會員」e2e：桌機 1440 與手機 390 各跑一次完整主流程。
// 流程：relationship_edit 填寫申請 -> 編輯 -> 回讀 DB；admin 核可 -> 回讀；重新開啟仍可見；最後 admin 刪除並確認消失。
// fixture 姓名帶 ZT + runId 前綴（ZTT<yyyymmdd>-xxxx），測試結束刪除；失敗時由 teardown sweeper 依登錄與標記清除。

const runId = process.env.TEST_RUN_ID || '';

async function openPage(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.locator('.workspace-menu button.catalog-item[title="關係會員"]').click();
  await expect(page.getByRole('heading', { name: '關係會員', exact: true })).toBeVisible();
  await page.waitForFunction(() => !/載入中/.test(document.querySelector('.toolbar span')?.textContent || ''));
}

async function searchFor(page: Page, text: string) {
  await page.getByLabel('搜尋會員').fill(text);
}

test('關係會員主流程：申請、編輯、核可、重新開啟、刪除', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  expect(RUN_ID_RE.test(runId), '必須由 run-all 啟動（需要 TEST_RUN_ID）').toBe(true);
  const tag = testInfo.project.name === 'mobile-390' ? 'M' : 'D';
  const name = `ZT${runId}-${tag}`;
  const registry = createRegistry({ runId });
  const admin = await apiAs('admin');
  const pageErrors: string[] = [];
  let memberId: string | null = null;

  try {
    // ---- relationship_edit：申請與編輯 ----
    const editCtx = await loginAs(browser, 'relationship_edit');
    try {
      const page = await editCtx.newPage();
      page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));
      await openPage(page);
      await expect(page.getByRole('button', { name: '新增關係會員申請' })).toBeVisible();

      await page.getByRole('button', { name: '新增關係會員申請' }).click();
      const create = page.getByRole('dialog', { name: '填寫關係會員申請' });
      await create.getByLabel('關係會員姓名').fill(name);
      await create.getByLabel('電話').fill('0900000000');
      await create.getByLabel('關係', { exact: true }).fill('自動測試');
      await create.getByRole('button', { name: '送出申請' }).click();
      await expect(page.getByRole('status')).toContainText('關係會員申請已建立');

      // 回讀 DB 並登錄（供 teardown sweeper 當後備）
      const rows = await readRowsAsServiceRole('relationship_members', { like: { member_name: name }, select: 'id, member_name, phone, relationship, is_approved' });
      expect(rows).toHaveLength(1);
      memberId = String(rows[0].id);
      registry.record({ table: 'relationship_members', values: [memberId], note: 'M0 e2e' });
      expect(rows[0]).toMatchObject({ phone: '0900000000', relationship: '自動測試', is_approved: false });

      await searchFor(page, name);
      const row = page.locator('.relationship-page tbody tr', { hasText: name });
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('待核可');

      // 編輯關係
      await row.getByRole('button', { name: '編輯', exact: true }).click();
      const edit = page.getByRole('dialog', { name: '編輯關係會員' });
      await edit.getByLabel('關係', { exact: true }).fill('自動測試已編輯');
      await edit.getByRole('button', { name: '儲存修改' }).click();
      await expect(page.getByRole('status')).toContainText('關係會員資料已更新');
      const after = await readRowsAsServiceRole('relationship_members', { eq: { id: memberId }, select: 'relationship' });
      expect(after[0].relationship).toBe('自動測試已編輯');

      // relationship_edit 沒有核可與刪除權限
      await searchFor(page, name);
      await expect(page.locator('.relationship-page tbody tr', { hasText: name }).getByRole('button', { name: '核可' })).toHaveCount(0);
      await expect(page.locator('.relationship-page tbody tr', { hasText: name }).getByRole('button', { name: '刪除' })).toHaveCount(0);
    } finally {
      await editCtx.close();
    }

    // ---- admin：核可 ----
    const adminCtx = await loginAs(browser, 'admin');
    try {
      const page = await adminCtx.newPage();
      page.on('pageerror', (e) => pageErrors.push(e.message.slice(0, 200)));
      await openPage(page);
      await searchFor(page, name);
      const row = page.locator('.relationship-page tbody tr', { hasText: name });
      await expect(row).toHaveCount(1);
      await row.getByRole('button', { name: '核可', exact: true }).click();
      await page.getByRole('dialog', { name: '核可關係會員' }).getByRole('button', { name: '確認核可' }).click();
      await expect(page.getByRole('status')).toContainText('關係會員已核可');
      const approved = await readRowsAsServiceRole('relationship_members', { eq: { id: memberId }, select: 'is_approved, approved_at' });
      expect(approved[0].is_approved).toBe(true);
      expect(approved[0].approved_at).toBeTruthy();

      // ---- 重新開啟：資料仍在、狀態為已核可 ----
      await openPage(page);
      await searchFor(page, name);
      const reopened = page.locator('.relationship-page tbody tr', { hasText: name });
      await expect(reopened).toHaveCount(1);
      await expect(reopened).toContainText('已核可');
      await expect(reopened).toContainText('自動測試已編輯');

      // 手機寬度下版面不溢出
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);

      // ---- 刪除 ----
      await reopened.getByRole('button', { name: '刪除', exact: true }).click();
      await page.getByRole('dialog', { name: '刪除關係會員' }).getByRole('button', { name: '確認刪除' }).click();
      await expect(page.getByRole('status')).toContainText('關係會員已刪除');
      const gone = await readRowsAsServiceRole('relationship_members', { eq: { id: memberId } });
      expect(gone).toHaveLength(0);
      memberId = null;
    } finally {
      await adminCtx.close();
    }
    expect(pageErrors).toEqual([]);
  } finally {
    // 後備清除：失敗時仍嘗試經 admin API 刪除，之後由 teardown sweeper 再次確認。
    if (memberId) await admin.delete(`/api/workspace/relationships/${memberId}`).catch(() => undefined);
    await admin.dispose();
  }
});
