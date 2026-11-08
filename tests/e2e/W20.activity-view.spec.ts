import fs from 'node:fs';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { loginAs } from '../support/auth';
import { applyProjectViewport, noPageOverflow } from '../support/w04-ui';
import { adminDb, apiForUser, deleteRunData, seedW20Campaign, setupM5Users, stores, type M5User } from '../support/m5-fixtures';

// W20 e2e（M5 Q2、Q6、Q7、Q8、不需決策項目）：活動檢視列表與排程檢視、店長／督導填報、舊網址轉址、PDF、無權限頁。
// 桌機 1440 與手機 390 各跑一次。資料只用 VW/ZT 測試門市與 2099 年活動，名稱帶「[自動測試]M5 <runId>」。

let users: Record<string, M5User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let main: Awaited<ReturnType<typeof seedW20Campaign>>;
const stores_name: Record<string, string> = {};
let off: Awaited<ReturnType<typeof seedW20Campaign>>;
let draft: Awaited<ReturnType<typeof seedW20Campaign>>;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  const s = await setupM5Users(['store_manager', 'viewer', 'w20_mgr_support', 'w20_mgr_full', 'w20_sup_full']);
  users = s.users;
  teardownUsers = s.teardown;
  main = await seedW20Campaign('w20-e2e');
  off = await seedW20Campaign('w20-e2e-off', { active: false });
  draft = await seedW20Campaign('w20-e2e-draft', { publish: {} });
  for (const [code, v] of Object.entries(await stores())) stores_name[code] = v.name;
});
test.afterAll(async () => {
  await deleteRunData();
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

async function contextFor(browser: Browser, key: string): Promise<BrowserContext> {
  const api = await apiForUser(users[key]);
  const state = await api.storageState();
  await api.dispose();
  return browser.newContext({ baseURL: 'http://localhost:3002', storageState: state, acceptDownloads: true });
}
async function openList(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.locator('.workspace-menu button.catalog-item[title="活動檢視"]').click();
  await expect(page.getByRole('heading', { name: '活動檢視', exact: true })).toBeVisible();
}
// 活動名稱互為前綴（xxx、xxx-off、xxx-draft），用「後面不能接 - 或英數字」避免多筆符合
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const card = (page: Page, name: string) => page.getByTestId('activity-card').filter({ hasText: new RegExp(`${escapeRe(name)}(?![-\\w])`) });
async function openDetail(page: Page, name: string) {
  await openList(page);
  await page.getByTestId('year-all').click(); // 測試活動在 2099 年，預設年度（今年）不會列出
  await card(page, name).getByTestId('open-activity').click();
  await expect(page.getByTestId('activity-view-detail').getByRole('heading', { name, level: 3 })).toBeVisible({ timeout: 30_000 });
}
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return errors;
}

test('列表：預設今年之外的年度要按年度按鈕；狀態與發布對象標籤；停用的不出現；店長看不到未發布草稿', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const ctx = await contextFor(browser, 'store_manager');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    const errors = watchErrors(page);
    await openList(page);
    await expect(page.getByTestId('activity-view-title')).toHaveText('（店長）');
    // 預設年度是今年（台灣日曆）：被按下的是今年的按鈕或（今年沒有活動時）沒有任何按鈕被按下；2099 的測試活動要按 2099 年才列出
    await expect(page.getByTestId('year-all')).toHaveAttribute('aria-pressed', 'false');
    await expect(card(page, main.name)).toHaveCount(0);
    await page.getByTestId('year-2099').click();
    await expect(card(page, main.name)).toHaveCount(1);
    const c = card(page, main.name);
    await expect(c.getByTestId('status-tag')).toHaveText('即將開始');
    await expect(c.getByTestId('audience-tag')).toHaveText(['督導', '店長', '盤點組/行銷部/營業部助理']);
    await expect(c.getByTestId('unpublished-tag')).toHaveCount(0);
    await expect(card(page, off.name)).toHaveCount(0); // Q2：停用的活動檢視端隱藏
    await expect(card(page, draft.name)).toHaveCount(0);
    await page.getByTestId('year-all').click();
    await expect(card(page, main.name)).toHaveCount(1);
    expect(await noPageOverflow(page), '頁面層級水平溢出').toBe(true);
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('列表：有「查看全部」權限者看到未發布草稿並標「未發布」，停用的仍隱藏', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await contextFor(browser, 'viewer');
  try {
    const page = await ctx.newPage();
    await openList(page);
    await page.getByTestId('year-2099').click();
    await expect(card(page, draft.name)).toHaveCount(1);
    await expect(card(page, draft.name).getByTestId('unpublished-tag')).toHaveText('未發布');
    await expect(card(page, main.name).getByTestId('unpublished-tag')).toHaveCount(0);
    await expect(card(page, off.name)).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('排程檢視（Q7）：按鈕與管轄門市照舊版——只有 view_own 的店長沒有支援請求、人力查看、Check List', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const ctx = await contextFor(browser, 'store_manager');
  try {
    const page = await ctx.newPage();
    await applyProjectViewport(page, testInfo);
    await openDetail(page, main.name);
    await expect(page.getByTestId('plan-counts')).toContainText('已排程：1 間'); // 店長只看到自己任命的門市排程
    await expect(page.getByTestId('btn-support')).toHaveCount(0);
    await expect(page.getByTestId('btn-checklist')).toHaveCount(0);
    await expect(page.getByTestId('btn-staff')).toHaveCount(0);
    await expect(page.getByTestId('btn-marketing')).toBeVisible();
    await expect(page.getByTestId('btn-merchandise')).toBeVisible();
    await expect(page.getByTestId('activity-view-detail').getByText(stores_name.VW001).first()).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test('排程檢視（Q7）：支援指派權只看到支援請求與 Check List；完整權限三顆都有且 Check List 有未完成數', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctxA = await contextFor(browser, 'w20_mgr_support');
  const ctxB = await contextFor(browser, 'w20_mgr_full');
  try {
    const a = await ctxA.newPage();
    await openDetail(a, main.name);
    await expect(a.getByTestId('btn-support')).toBeVisible();
    await expect(a.getByTestId('btn-checklist')).toBeVisible();
    await expect(a.getByTestId('btn-staff')).toHaveCount(0);
    const b = await ctxB.newPage();
    await openDetail(b, main.name);
    for (const id of ['btn-support', 'btn-checklist', 'btn-staff']) await expect(b.getByTestId(id)).toBeVisible();
    await expect(b.getByTestId('checklist-badge')).toHaveText('1'); // VW001 一個前置項目未完成
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('Q6 填報人力：活動人力查看只列管轄門市；填報人力預估後存進資料庫，重新整理仍在', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await contextFor(browser, 'w20_mgr_full');
  const s = await stores();
  try {
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await openDetail(page, main.name);
    await page.getByTestId('btn-staff').click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog.getByRole('heading', { name: '活動人力查看' })).toBeVisible();
    await expect(dialog.getByText(s.VW001.name).first()).toBeVisible();
    await expect(dialog.getByText(s.ZT01.name)).toHaveCount(0); // 不是自己管轄的門市不列
    await dialog.getByTestId('fill-people').first().click();
    const fill = page.getByTestId('activity-store-fill');
    await expect(fill).toBeVisible();
    await fill.getByLabel('額外支援人數').fill('3');
    await fill.getByLabel('督導人數').fill('1');
    await fill.getByRole('button', { name: '儲存預估人數' }).click();
    await expect(fill.getByRole('status').filter({ hasText: '預估人數已儲存' })).toBeVisible();
    const row = (await adminDb().from('campaign_store_headcount').select('extra_support_count,supervisor_count').eq('campaign_id', main.id).eq('store_id', s.VW001.id).maybeSingle()).data;
    expect(row).toEqual({ extra_support_count: 3, supervisor_count: 1 });
    await fill.getByRole('button', { name: '關閉填報' }).click();
    await expect(page.getByTestId('activity-store-fill')).toHaveCount(0);
    // 關閉後列表資料已重新讀取
    await expect(dialog.getByText('3').first()).toBeVisible();
    expect(errors, errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('Q6 填報 Check List：勾選已完成、寫備註與負責人，存進資料庫；督導可代填自己範圍內的其他門市', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await contextFor(browser, 'w20_mgr_support');
  const s = await stores();
  try {
    const page = await ctx.newPage();
    await openDetail(page, main.name);
    await page.getByTestId('btn-checklist').click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog.getByRole('heading', { name: '前置 Check List' })).toBeVisible();
    await expect(dialog.getByText(s.ZT01.name)).toHaveCount(0);
    await dialog.getByTestId('fill-checklist').first().click();
    const fill = page.getByTestId('activity-store-fill');
    await expect(fill.getByText('W20 前置項目')).toBeVisible();
    await fill.getByLabel('已完成', { exact: true }).check();
    await fill.getByLabel('門市負責人').fill('W20 王店長');
    await fill.getByLabel('店長回報').fill('W20 已備妥');
    await fill.getByRole('button', { name: '儲存此項回報' }).click();
    await expect(fill.getByRole('status').filter({ hasText: '工作回報已儲存' })).toBeVisible();
    const row = (await adminDb().from('campaign_checklist_completions').select('is_completed,manager_note,store_assigned_person').eq('checklist_item_id', main.itemId).eq('store_id', s.VW001.id).maybeSingle()).data;
    expect(row).toMatchObject({ is_completed: true, manager_note: 'W20 已備妥', store_assigned_person: 'W20 王店長' });
    await fill.getByRole('button', { name: '關閉填報' }).click();
    await expect(page.getByTestId('checklist-badge')).toHaveCount(0); // 未完成數歸零
  } finally {
    await ctx.close();
  }
});

test('Q6 支援請求：列出請求由我管轄門市出人的需求；移除已指派的人並儲存', async ({ browser }) => {
  test.setTimeout(240_000);
  const db = adminDb();
  const s = await stores();
  const seeded = await db.from('campaign_support_staff').insert({ support_request_id: main.requestFromVW001, campaign_id: main.id, requesting_store_id: s.ZT02.id, supporting_store_id: s.VW001.id, employee_code: 'W20E001', employee_name: 'W20 待移除', position: '店員', sort_order: 0 });
  expect(seeded.error).toBeNull();
  const ctx = await contextFor(browser, 'w20_mgr_support');
  try {
    const page = await ctx.newPage();
    await openDetail(page, main.name);
    await page.getByTestId('btn-support').click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog.getByRole('heading', { name: '支援請求管理' })).toBeVisible();
    const row = dialog.locator(`tr[data-request="${main.requestFromVW001}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText('W20E001');
    await expect(dialog.locator(`tr[data-request="${main.requestVW001}"]`)).toHaveCount(0); // VW001 是請求門市，不是出人的門市
    await row.getByTestId('assign-start').click();
    await expect(dialog.getByTestId('assigned-row')).toHaveCount(1);
    await dialog.getByTestId('assigned-row').getByRole('button', { name: '移除' }).click();
    await dialog.getByTestId('assign-save').click();
    await expect(dialog.getByRole('status').filter({ hasText: '已儲存支援指派' })).toBeVisible();
    await expect(row).toContainText('尚未指派');
    const rows = (await db.from('campaign_support_staff').select('id').eq('support_request_id', main.requestFromVW001)).data || [];
    expect(rows).toHaveLength(0);
  } finally {
    await ctx.close();
  }
});

test('舊版寫入範圍：督導（ZT01）在活動人力查看只列自己管轄的門市', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await contextFor(browser, 'w20_sup_full');
  const s = await stores();
  try {
    const page = await ctx.newPage();
    await openDetail(page, main.name);
    await expect(page.getByTestId('plan-counts')).toContainText('已排程：3 間'); // 督導看到全部排程
    await page.getByTestId('btn-staff').click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog.getByText(s.ZT01.name).first()).toBeVisible();
    await expect(dialog.getByText(s.VW001.name)).toHaveCount(0);
    await expect(dialog.getByText(s.ZT02.name)).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('PDF 匯出：A4 橫式、舊檔名「活動名稱_活動排程.pdf」', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    await page.waitForSelector('.menu-toggle');
    await page.click('.menu-toggle');
    await page.locator('.workspace-menu button.catalog-item[title="活動檢視"]').click();
    await page.getByTestId('year-2099').click();
    await card(page, main.name).getByTestId('open-activity').click();
    await expect(page.getByTestId('btn-export-pdf')).toBeEnabled({ timeout: 30_000 });
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120_000 }), page.getByTestId('btn-export-pdf').click()]);
    expect(download.suggestedFilename()).toBe(`${main.name}_活動排程.pdf`);
    const file = await download.path();
    const bytes = fs.readFileSync(file!).toString('latin1');
    expect(bytes.startsWith('%PDF')).toBe(true);
    // A4 橫式 = 841.89 x 595.28 pt；每月一頁（2099-05 一個月 = 一頁）
    const box = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(bytes);
    expect(box, 'PDF 頁面大小').not.toBeNull();
    expect(Number(box![1])).toBeCloseTo(841.89, 0);
    expect(Number(box![2])).toBeCloseTo(595.28, 0);
    expect((bytes.match(/\/Type\s*\/Page[^s]/g) || []).length).toBe(1);
  } finally {
    await ctx.close();
  }
});

test('舊網址（Q8）：/activity-view/<id> 轉到新版排程檢視；?focus=marketing 直接開行銷部視窗；舊書籤的活動停用後顯示無權限頁', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await loginAs(browser, 'admin');
  try {
    const page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(`/activity-view/${main.id}`, { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(/\/workspace\/(index\.html)?#\/(open\/activity-view-detail|work\/)/);
    await expect(page.getByTestId('activity-view-detail').getByRole('heading', { name: main.name, level: 3 })).toBeVisible({ timeout: 30_000 });
    await page.goto(`/activity-view/${main.id}?focus=marketing`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('dialog').getByRole('heading', { name: '行銷部規劃' }).first()).toBeVisible({ timeout: 30_000 });
    await page.goto(`/activity-view/${off.id}`, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('activity-view-denied')).toBeVisible({ timeout: 30_000 });
    expect(errors.filter((e) => !/40[34]/.test(e)), errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('未登入開舊網址（Q8）：先登入，登入後直接開到該活動的排程檢視', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await browser.newContext({ baseURL: 'http://localhost:3002' });
  try {
    const page = await ctx.newPage();
    await page.goto(`/activity-view/${main.id}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.login-layout')).toBeVisible();
    await page.getByLabel('帳號或電子郵件').fill(users.store_manager.email);
    await page.getByLabel('密碼').fill(users.store_manager.password);
    await page.getByRole('button', { name: '登入工作台' }).click();
    await expect(page.getByTestId('activity-view-detail').getByRole('heading', { name: main.name, level: 3 })).toBeVisible({ timeout: 45_000 });
  } finally {
    await ctx.close();
  }
});

test('無權限直接輸入網址：顯示無權限頁，不是空白也不是 alert', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await contextFor(browser, 'store_manager');
  try {
    const page = await ctx.newPage();
    const dialogs: string[] = [];
    page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });
    await page.goto(`/activity-view/${draft.id}`, { waitUntil: 'networkidle' }); // 店長看不到未發布草稿
    await expect(page.getByTestId('activity-view-denied')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: '返回活動列表' })).toBeVisible();
    expect(dialogs).toEqual([]);
    await page.getByRole('button', { name: '返回活動列表' }).click();
    await expect(page.getByRole('heading', { name: '活動檢視', exact: true })).toBeVisible();
  } finally {
    await ctx.close();
  }
});
