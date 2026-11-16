import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, sideLabels, visibleHeading } from '../support/g01-ui';
import { openFromMenu } from '../support/m3-fixtures';
import { assertGaBaseline, cleanupM7M8, seedWorkOrder } from '../support/m7m8-fixtures';
import { setupPoUsers, type PoUser } from '../support/m7m8-po-fixtures';

// M7/M8 第 5 批 G18.smoke（工單中心）與 G19.smoke（跨部門「總務組」維修頁）冒煙層：兩頁可開、標題與焦點卡、主要 API 200、無 pageerror／console 錯誤、
// 桌機 1440 與手機 390 無水平溢出（project viewport）、導覽 href 對到正確頁面 kind、沒有權限沒有入口且 API 403、只能查看者唯讀、店長看不到處理人。
const API = '/api/workspace/general-affairs';
async function nav(page: any, label: string) {
  await openGaSide(page);
  await shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first().click();
}

test.describe.configure({ mode: 'serial' });
let users: Record<string, PoUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
const woIds: Record<string, string> = {};
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(['wo_works', 'wo_manager', 'wo_viewall', 'wo_store_a', 'wo_cross_store_a', 'wo_cross_update', 'wo_cross_manager', 'nobody']);
  users = made.users;
  teardown = made.teardown;
  for (const k of Object.keys(users)) {
    const c = await apiForUser(users[k] as any);
    states[k] = await c.storageState();
    await c.dispose();
  }
  // 種子：未受理一張、待門市確認的舊式一張（回報人 = 店長 A，另一張回報人 = 舊跨部門回報人）
  woIds.fresh = (await seedWorkOrder('VW001', 'SMK-FRESH', users.wo_store_a.id)).id;
  woIds.confirm = (await seedWorkOrder('VW001', 'SMK-CONFIRM', users.wo_store_a.id, { status: 'PROCESSING', progress_stage: 'WAITING_STORE_CONFIRMATION', accepted_at: new Date().toISOString(), assignee_name: 'M7M8 工務甲' })).id;
  woIds.cross = (await seedWorkOrder('VW001', 'SMK-CROSS', users.wo_cross_store_a.id)).id;
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('G18.smoke 總務：側欄有「工單中心」；標題、7 張焦點卡、列表與精確筆數；詳情與動作鈕；API 200；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.wo_works, testInfo);
  try {
    await openGaCenter(page);
    expect(await sideLabels(page)).toContain('工單中心');
    const calls: string[] = [];
    page.on('response', (r) => r.url().includes(`${API}/work-orders`) && calls.push(String(r.status())));
    await nav(page, '工單中心');
    await expect(visibleHeading(page, '工單中心')).toBeVisible();
    await expect(page.getByRole('list', { name: '工單焦點' }).locator('visible=true').getByRole('listitem')).toHaveCount(7);
    await expect(page.getByTestId('wob-total').locator('visible=true')).toBeVisible();
    await page.getByTestId('wob-search').locator('visible=true').fill('SMK-');
    await expect(page.getByTestId('wob-total').locator('visible=true')).toHaveText('共 3 張');
    await page.getByTestId('wob-search').locator('visible=true').fill('SMK-FRESH');
    await expect(page.getByTestId('wob-total').locator('visible=true')).toHaveText('共 1 張');
    expect(await noPageOverflow(page)).toBe(true);
    await page.getByTestId('wob-open').locator('visible=true').first().click();
    await expect(page.getByTestId('wo-detail').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('wo-status').locator('visible=true')).toHaveText('未受理');
    await expect(page.getByTestId('wo-next-step').locator('visible=true')).toContainText('先「更新進度」');
    for (const id of ['act-progress', 'act-print']) await expect(page.getByTestId(id).locator('visible=true'), id).toBeVisible();
    await expect(page.getByTestId('act-force-close').locator('visible=true')).toHaveCount(0); // 沒有強制結案權限（wo_works），也還沒受理
    await expect(page.getByTestId('wo-assignee').locator('visible=true')).toBeVisible(); // 總務端看得到處理人
    await expect(page.getByTestId('wo-parts-block').locator('visible=true')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((c) => c === '200')).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('G18.smoke 導覽：工單中心 href 對到 ga-work-orders；capabilities 為 true；總務組 href 對到 cross-dept-maintenance', async ({ browser }, testInfo) => {
  const { ctx, page } = await pageForUser(browser, states.wo_manager, testInfo);
  try {
    await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    const s = await page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()));
    const flat = (s.gaNavigation as any[]).flatMap((g) => g.items.flatMap((i: any) => [i, ...(i.children || [])]));
    expect(flat.filter((i) => i.href === '/general-affairs/work-orders').map((i) => i.kind)).toContain('ga-work-orders');
    expect(s.capabilities).toMatchObject({ gaWorkOrders: true });
    const cross = (s.navigation as any[]).flatMap((g) => g.items).find((i: any) => i.href === '/cross-dept/maintenance');
    // wo_manager 沒有舊跨部門權限碼，總務組入口不列；有舊權限的帳號（wo_cross_update）才列，kind 一律是 cross-dept-maintenance
    expect(cross).toBeUndefined();
  } finally {
    await ctx.close();
  }
  const c2 = await pageForUser(browser, states.wo_cross_update, testInfo);
  try {
    await c2.page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    const s = await c2.page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()));
    const cross = (s.navigation as any[]).flatMap((g) => g.items).find((i: any) => i.href === '/cross-dept/maintenance');
    expect(cross).toMatchObject({ label: '總務組', kind: 'cross-dept-maintenance' });
    expect(s.capabilities).toMatchObject({ gaCrossDeptMaintenance: true });
  } finally {
    await c2.ctx.close();
  }
});

test('G18.smoke 門市店長（回報＋查看自己門市）：能開工單中心、只看到自己門市、看不到處理人與用料清單、沒有強制結案；待確認的舊式單有「確認完成」「仍有問題」', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.wo_store_a, testInfo);
  try {
    await openGaCenter(page);
    expect(await sideLabels(page)).toContain('工單中心');
    await nav(page, '工單中心');
    await expect(visibleHeading(page, '工單中心')).toBeVisible();
    await page.getByTestId('wob-search').locator('visible=true').fill('SMK-CONFIRM');
    await expect(page.getByTestId('wob-total').locator('visible=true')).toHaveText('共 1 張');
    await page.getByTestId('wob-open').locator('visible=true').first().click();
    await expect(page.getByTestId('wo-detail').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('wo-next-step').locator('visible=true')).toContainText('確認問題是否解決');
    await expect(page.getByTestId('act-store-confirm').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('act-unresolved').locator('visible=true')).toBeVisible();
    for (const id of ['wo-assignee', 'wo-parts-block', 'act-force-close', 'act-progress', 'act-issue-part', 'act-delete']) await expect(page.getByTestId(id).locator('visible=true'), id).toHaveCount(0);
    await expect(page.getByTestId('wo-readonly').locator('visible=true')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
    const body = await page.evaluate(async (u) => (await (await fetch(u)).text()), `${API}/work-orders/${woIds.confirm}`);
    expect(body).not.toContain('M7M8 工務甲'); // 處理人姓名伺服端已遮蔽
  } finally {
    await ctx.close();
  }
});

test('G18.smoke 只能查看全部的帳號唯讀（缺哪個權限講清楚）；沒有權限的帳號沒有入口且 API 403', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const v = await pageForUser(browser, states.wo_viewall, testInfo);
  try {
    await openGaCenter(v.page);
    await nav(v.page, '工單中心');
    await expect(visibleHeading(v.page, '工單中心')).toBeVisible();
    await expect(v.page.getByTestId('wob-readonly').locator('visible=true')).toContainText('只有查看工單的權限');
    await v.page.getByTestId('wob-search').locator('visible=true').fill('SMK-FRESH');
    await v.page.getByTestId('wob-open').locator('visible=true').first().click();
    await expect(v.page.getByTestId('wo-detail').locator('visible=true')).toBeVisible();
    for (const id of ['act-progress', 'act-delete', 'act-force-close', 'act-issue-part']) await expect(v.page.getByTestId(id).locator('visible=true'), id).toHaveCount(0);
    expect(await noPageOverflow(v.page)).toBe(true);
    expect(v.errors).toEqual([]);
  } finally {
    await v.ctx.close();
  }
  const n = await pageForUser(browser, states.nobody, testInfo);
  try {
    await n.page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    const s = await n.page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()));
    expect(s.capabilities).toMatchObject({ gaWorkOrders: false, gaCrossDeptMaintenance: false });
    const flat = ((s.gaNavigation || []) as any[]).flatMap((g) => g.items.flatMap((i: any) => [i, ...(i.children || [])]));
    expect(flat.some((i) => i.kind === 'ga-work-orders')).toBe(false);
    expect(await n.page.evaluate(async (u) => (await fetch(u)).status, `${API}/work-orders`)).toBe(403);
    expect(await n.page.evaluate(async (u) => (await fetch(u)).status, `${API}/work-orders/summary`)).toBe(403);
  } finally {
    await n.ctx.close();
  }
});

test('G19.smoke 總務組維修頁：回報人可開、有「新增回報」、看不到維修分類管理、只看自己門市（有回報權限的店長看得到自己門市的全部）；API 200；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.wo_cross_store_a, testInfo);
  try {
    const calls: string[] = [];
    page.on('response', (r) => r.url().includes(`${API}/work-orders`) && calls.push(String(r.status())));
    await openFromMenu(page, '總務組');
    await expect(visibleHeading(page, '總務組維修')).toBeVisible();
    await expect(page.getByTestId('wob-total').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('wob-create').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('wob-categories').locator('visible=true')).toHaveCount(0);
    await page.getByTestId('wob-search').locator('visible=true').fill('SMK-');
    await expect(page.getByTestId('wob-total').locator('visible=true')).toHaveText('共 3 張'); // 同店店長看得到自己門市的全部（有回報權限）
    await page.getByTestId('wob-search').locator('visible=true').fill('SMK-CROSS');
    await expect(page.getByTestId('wob-total').locator('visible=true')).toHaveText('共 1 張');
    expect(await noPageOverflow(page)).toBe(true);
    await page.getByTestId('wob-open').locator('visible=true').first().click();
    await expect(page.getByTestId('wo-detail').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('act-delete').locator('visible=true')).toBeVisible(); // 回報人刪自己未受理的單
    expect(await noPageOverflow(page)).toBe(true);
    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.every((c) => c === '200')).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('G19.smoke 總務組維修頁：總務（舊更新權限）看全部門市；有分類編輯權限者有「維修分類管理」，新增回報視窗可開；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const a = await pageForUser(browser, states.wo_cross_update, testInfo);
  try {
    await openFromMenu(a.page, '總務組');
    await expect(visibleHeading(a.page, '總務組維修')).toBeVisible();
    await a.page.getByTestId('wob-search').locator('visible=true').fill('SMK-');
    await expect(a.page.getByTestId('wob-total').locator('visible=true')).toHaveText('共 3 張');
    await expect(a.page.getByTestId('wob-categories').locator('visible=true')).toHaveCount(0);
    expect(await noPageOverflow(a.page)).toBe(true);
    expect(a.errors).toEqual([]);
  } finally {
    await a.ctx.close();
  }
  const m = await pageForUser(browser, states.wo_cross_manager, testInfo);
  try {
    await openFromMenu(m.page, '總務組');
    await expect(visibleHeading(m.page, '總務組維修')).toBeVisible();
    await m.page.getByTestId('wob-create').locator('visible=true').click();
    await expect(m.page.getByTestId('wo-create-form')).toBeVisible();
    await expect(m.page.getByTestId('c-store')).toBeVisible();
    await expect(m.page.getByTestId('c-title')).toBeVisible();
    await expect.poll(async () => m.page.getByTestId('c-store').locator('option').count()).toBeGreaterThan(2); // 總務端（只有跨部門更新權限）可替任何門市回報，門市清單不能是空的
    await m.page.getByRole('button', { name: '取消' }).click();
    await m.page.getByTestId('wob-categories').locator('visible=true').click();
    await expect(m.page.getByTestId('cat-dialog')).toBeVisible();
    await m.page.getByTestId('cat-close').click();
    expect(await noPageOverflow(m.page)).toBe(true);
    expect(m.errors).toEqual([]);
  } finally {
    await m.ctx.close();
  }
});
