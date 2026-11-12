import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageFor, pageForUser, shell, sideLabels, visibleHeading } from '../support/g01-ui';
import { assertGaBaseline, cleanupM7M8 } from '../support/m7m8-fixtures';
import { setupPoUsers, type PoUser } from '../support/m7m8-po-fixtures';

// M7/M8 第 4 批 G14 至 G17 冒煙層：四個頁面（新增需求、我的追蹤、總務需求工作台、料件處理中心）可開、標題與統計卡、主要 API 200、無 pageerror／console 錯誤、
// 桌機 1440 與手機 390 無水平溢出（project viewport）、導覽四個 href 對到正確頁面 kind、沒有權限沒有入口且 API 403。
const API = '/api/workspace/general-affairs';
const side = (page: any, label: string) => shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first();
async function nav(page: any, label: string) {
  await openGaSide(page);
  await side(page, label).click();
}

test.describe.configure({ mode: 'serial' });
let users: Record<string, PoUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(['rq_store_a', 'rq_view_all', 'ful_view', 'nobody']);
  users = made.users;
  teardown = made.teardown;
  for (const k of Object.keys(users)) {
    const c = await apiForUser(users[k] as any);
    states[k] = await c.storageState();
    await c.dispose();
  }
});
test.afterAll(async () => {
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('總務：側欄四個入口；總務需求工作台有 11 張統計卡、逾期天數設定；API 200；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    const labels = await sideLabels(page);
    for (const l of ['新增需求', '我的追蹤', '總務需求工作台', '料件處理中心']) expect(labels, l).toContain(l);
    const calls: string[] = [];
    page.on('response', (r) => r.url().includes(`${API}/requests`) && calls.push(String(r.status())));
    await nav(page, '總務需求工作台');
    await expect(visibleHeading(page, '總務需求工作台')).toBeVisible();
    await expect(page.getByRole('list', { name: '需求單統計' }).locator('visible=true').getByRole('listitem')).toHaveCount(11);
    await expect(page.getByTestId('open-setting').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('rq-total').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('card-overdue').locator('visible=true')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.every((c) => c === '200')).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('總務：料件處理中心有 8 張統計卡；新增需求表單可開；我的追蹤可開；API 200；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '料件處理中心');
    await expect(visibleHeading(page, '料件處理中心')).toBeVisible();
    await expect(page.getByRole('list', { name: '處理單統計' }).locator('visible=true').getByRole('listitem')).toHaveCount(8);
    await expect(page.getByTestId('fl-total').locator('visible=true')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    await nav(page, '新增需求');
    await expect(visibleHeading(page, '新增需求')).toBeVisible();
    await expect(page.getByTestId('report-form').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('f-store').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('create-submit').locator('visible=true')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    await nav(page, '我的追蹤');
    await expect(visibleHeading(page, '我的追蹤')).toBeVisible();
    await expect(page.getByTestId('mr-total').locator('visible=true')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('導覽四個 href：新增需求、我的追蹤、需求工作台、料件處理中心對到正確頁面 kind；capabilities 為 true', async ({ browser }, testInfo) => {
  const { ctx, page } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    const nav = await page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).gaNavigation);
    const flat = (nav as any[]).flatMap((g) => g.items.flatMap((i: any) => [i, ...(i.children || [])]));
    const kind = (href: string) => flat.filter((i) => i.href === href).map((i) => i.kind);
    expect(kind('/general-affairs/reports/new')).toContain('ga-report-create');
    expect(kind('/general-affairs/reports/mine')).toContain('ga-my-reports');
    expect(kind('/general-affairs/requests')).toContain('ga-requests');
    expect(kind('/general-affairs/part-fulfillments')).toContain('ga-part-fulfillments');
    const caps = await page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
    expect(caps).toMatchObject({ gaReportCreate: true, gaMyReports: true, gaRequests: true, gaPartFulfillments: true });
  } finally {
    await ctx.close();
  }
});

test('門市店長（只有建立與看自己門市）：有「新增需求」「我的追蹤」，沒有工作台與處理中心；我的追蹤可開；工作台 API 仍可讀（自己門市）、處理單 API 403；無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.rq_store_a, testInfo);
  try {
    await openGaCenter(page);
    const labels = await sideLabels(page);
    expect(labels).toEqual(expect.arrayContaining(['新增需求', '我的追蹤']));
    expect(labels).not.toContain('總務需求工作台');
    expect(labels).not.toContain('料件處理中心');
    await nav(page, '我的追蹤');
    await expect(visibleHeading(page, '我的追蹤')).toBeVisible();
    await expect(page.getByTestId('mr-total').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('open-create').locator('visible=true')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    await nav(page, '新增需求');
    await expect(visibleHeading(page, '新增需求')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    const caps = await page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
    expect(caps).toMatchObject({ gaReportCreate: true, gaMyReports: true, gaRequests: false, gaPartFulfillments: false });
    expect(errors).toEqual([]); // 先檢查頁面本身沒有錯誤；下面故意打 403 的 API 會在 console 留下資源錯誤，不算
    expect(await page.evaluate(async (u) => (await fetch(u)).status, `${API}/reports/mine`)).toBe(200);
    expect(await page.evaluate(async (u) => (await fetch(u)).status, `${API}/part-fulfillments`)).toBe(403);
  } finally {
    await ctx.close();
  }
});

test('只能查看全部需求單、只能查看處理單的帳號：各自只有對應入口；沒有權限的帳號沒有入口且 API 403', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const v = await pageForUser(browser, states.rq_view_all, testInfo);
  try {
    await openGaCenter(v.page);
    const labels = await sideLabels(v.page);
    expect(labels).toContain('總務需求工作台');
    expect(labels).not.toContain('料件處理中心');
    await nav(v.page, '總務需求工作台');
    await expect(visibleHeading(v.page, '總務需求工作台')).toBeVisible();
    await expect(v.page.getByTestId('open-setting')).toHaveCount(0); // 沒有管理權限不能改逾期天數
    expect(await noPageOverflow(v.page)).toBe(true);
    expect(v.errors).toEqual([]);
  } finally {
    await v.ctx.close();
  }
  const f = await pageForUser(browser, states.ful_view, testInfo);
  try {
    await openGaCenter(f.page);
    const labels = await sideLabels(f.page);
    expect(labels).toContain('料件處理中心');
    expect(labels).not.toContain('總務需求工作台');
    await nav(f.page, '料件處理中心');
    await expect(visibleHeading(f.page, '料件處理中心')).toBeVisible();
    expect(f.errors).toEqual([]);
  } finally {
    await f.ctx.close();
  }
  const d = await pageForUser(browser, states.nobody, testInfo);
  try {
    await d.page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    const caps = await d.page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
    expect(caps).toMatchObject({ gaReportCreate: false, gaMyReports: false, gaRequests: false, gaPartFulfillments: false });
    for (const p of ['/requests', '/reports/mine', '/part-fulfillments', '/requests/settings']) expect(await d.page.evaluate(async (u) => (await fetch(u)).status, `${API}${p}`), p).toBe(403);
  } finally {
    await d.ctx.close();
  }
});
