import { expect, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, visibleHeading } from '../support/g01-ui';
import { dialog } from '../support/g12-ui';
import { vis } from '../support/g18-journey';
import { adminDb, assertGaBaseline, cleanupM7M8, seedWorkOrder } from '../support/m7m8-fixtures';
import { seedGa6Vendor, setupGa6Users, type Ga6User } from '../support/m7m8-ga6-fixtures';
import { dayOffset, oracle, transferDays } from '../support/m7m8-ga6-home-fixtures';

// M7/M8 第 6 批補充劇本（G21.journey-contract-perf-roles，補 G21 廠商鏈、G24 首頁劇本沒走到的段落）：
//  1. 合約提醒（V4）：需簽合約且 30 天內到期與已過期出現在首頁待辦與廠商列表；改到期日後消失；需簽合約為否者不出現；
//     編輯帳務欄位（付款條件）後資料庫留下修改者（updated_by）。
//  2. 績效：門市確認完成、強制結案、進行中的工單各自分開算；強制結案不入完成數與平均天數（總務桌機＋店長手機 390 看不到績效）。
//  3. 角色徽章（V9）：只有廠商查看者與工務各自的徽章數字等於點進列表的筆數；處理掉一張後數字減少。
// 每步用 service role 回讀資料庫。測試資料只放 VW 測試門市，帶 QA-GA6-／[自動測試]M7M8 標記；結束只清自己的。
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });

const B = '/api/workspace/general-affairs';
let users: Record<string, Ga6User> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
const apis: Record<string, any> = {};
const ids: Record<string, string> = {};
const db = () => adminDb();
const noConsole = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const cap = (n: number) => (n <= 0 ? '' : n > 99 ? '99+' : String(n));
const vRow = async (id: string) => (await db().from('ga_vendors').select('*').eq('id', id).single()).data as any;

async function closeSide(page: Page) {
  const b = shell(page).getByRole('button', { name: '關閉總務選單' });
  if (await b.isVisible().catch(() => false)) await b.click();
}
async function sideBadge(page: Page, label: string): Promise<string> {
  await openGaSide(page);
  const row = shell(page).locator('aside .ga-row').filter({ has: page.getByRole('button', { name: label, exact: true }) }).first();
  const text = (await row.locator('.ga-badge').count()) ? ((await row.locator('.ga-badge').first().textContent()) || '').trim() : '';
  await closeSide(page);
  return text;
}
async function nav(page: Page, label: string) {
  await openGaSide(page);
  await shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first().click();
  await expect(visibleHeading(page, label)).toBeVisible();
}
async function homeCount(page: Page, key: string): Promise<number> {
  await openGaCenter(page);
  await expect(page.getByText(/載入中/).locator('visible=true')).toHaveCount(0, { timeout: 30_000 });
  const loc = page.locator(`[data-testid="home-count-${key}"]:visible`);
  if (!(await loc.count())) return 0;
  return Number((await loc.first().innerText()).trim());
}
async function listTotal(a: any, path: string): Promise<number> {
  const r = await a.get(`${B}${path}`);
  expect(r.status(), path).toBe(200);
  const j = await r.json();
  return Number(j.total ?? j.data?.total ?? j.pagination?.total ?? j.meta?.total);
}
/** 開某家廠商的詳情：用名稱搜尋後點「查看詳情」。 */
async function openVendor(page: Page, name: string) {
  await nav(page, '廠商資料');
  await vis(page, 'vendor-search').fill(name);
  await expect(vis(page, 'vendor-card')).toHaveCount(1, { timeout: 20_000 });
  await vis(page, 'open-detail').click();
  await expect(dialog(page).getByTestId('vendor-detail')).toBeVisible();
}
/** 編輯表單：走到最後一步（合約與帳務欄位在那一步）。 */
async function toLastStep(page: Page) {
  for (let i = 0; i < 3; i += 1) await dialog(page).getByTestId('vf-next').click();
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGa6Users(['ga_all', 'vendor_view', 'wo_works', 'store_wo']);
  users = made.users;
  teardown = made.teardown;
  for (const k of Object.keys(users)) {
    apis[k] = await apiForUser(users[k] as any);
    states[k] = await apis[k].storageState();
  }
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('1 合約提醒：需簽合約且 30 天內到期與已過期出現在首頁待辦；改到期日後消失；需簽合約為否者不出現；編輯帳務欄位留修改者', async ({ browser }, testInfo) => {
  test.setTimeout(420_000);
  const A = await seedGa6Vendor('CT-將到期', { contract_required: true, contract_end_date: dayOffset(10), payment_terms: '月結 30 天' });
  const Bx = await seedGa6Vendor('CT-已過期', { contract_required: true, contract_end_date: dayOffset(-5) });
  const C = await seedGa6Vendor('CT-免合約', { contract_required: false, contract_end_date: dayOffset(5) });
  const D = await seedGa6Vendor('CT-很久以後', { contract_required: true, contract_end_date: dayOffset(90) });
  Object.assign(ids, { ctA: A.id, ctB: Bx.id, ctC: C.id, ctD: D.id });
  const base = (await oracle([], await transferDays())).contract_due;
  const { ctx, page, errors } = await pageForUser(browser, states.ga_all, testInfo);
  try {
    // 首頁數字等於資料庫；列表只含將到期與已過期，不含免合約與很久以後
    expect(await homeCount(page, 'contract_due')).toBe(base);
    const names = async () => ((await (await apis.ga_all.get(`${B}/vendors?contract_due=1&pageSize=100`)).json()).data as any[]).map((r) => r.id);
    const list1 = await names();
    expect(list1).toEqual(expect.arrayContaining([A.id, Bx.id]));
    expect(list1).not.toContain(C.id);
    expect(list1).not.toContain(D.id);
    expect(await listTotal(apis.ga_all, '/vendors?contract_due=1&pageSize=1')).toBe(base);
    // 編輯 A：到期日改到很久以後、付款條件改掉 → 從待辦消失，資料庫留修改者
    await openVendor(page, A.name);
    await dialog(page).getByTestId('vd-edit').click();
    await expect(dialog(page).getByTestId('vendor-form')).toBeVisible();
    await toLastStep(page);
    await dialog(page).getByTestId('vf-contract-end').fill(dayOffset(120));
    await dialog(page).getByTestId('vf-terms').fill('月結 60 天');
    await dialog(page).getByTestId('vf-save').click();
    await expect(vis(page, 'vendor-saved')).toContainText(A.name);
    const a2 = await vRow(A.id);
    expect(a2).toMatchObject({ contract_end_date: dayOffset(120), payment_terms: '月結 60 天', updated_by: users.ga_all.id });
    expect(await homeCount(page, 'contract_due')).toBe(base - 1);
    // 編輯 B：改成不需簽合約 → 也消失
    await openVendor(page, Bx.name);
    await dialog(page).getByTestId('vd-edit').click();
    await toLastStep(page);
    await dialog(page).getByTestId('vf-contract-required').uncheck();
    await dialog(page).getByTestId('vf-save').click();
    await expect(vis(page, 'vendor-saved')).toContainText(Bx.name);
    expect((await vRow(Bx.id)).contract_required).toBe(false);
    expect(await homeCount(page, 'contract_due')).toBe(base - 2);
    // 編輯 C：改成需簽合約 → 5 天後到期，出現
    await openVendor(page, C.name);
    await dialog(page).getByTestId('vd-edit').click();
    await toLastStep(page);
    await dialog(page).getByTestId('vf-contract-required').check();
    await dialog(page).getByTestId('vf-save').click();
    await expect(vis(page, 'vendor-saved')).toContainText(C.name);
    expect(await homeCount(page, 'contract_due')).toBe(base - 1);
    // 徽章與列表一致
    await expect.poll(() => sideBadge(page, '廠商資料'), { timeout: 20_000 }).toBe(cap(base - 1));
    expect(await listTotal(apis.ga_all, '/vendors?contract_due=1&pageSize=1')).toBe(base - 1);
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('2 績效：門市確認完成、強制結案、進行中各自分開算；強制結案不入完成數與平均天數；店長（手機 390）看不到績效頁', async ({ browser }, testInfo) => {
  test.setTimeout(420_000);
  const v = await seedGa6Vendor('PF-績效');
  ids.pf = v.id;
  const accepted = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const done = new Date().toISOString();
  const wo = (s: string, over: Record<string, unknown>) => seedWorkOrder('VW001', `PF-${s}`, users.store_wo.id, { vendor_id: v.id, accepted_at: accepted, ...over });
  await wo('確認', { status: 'COMPLETED', progress_stage: 'WAITING_STORE_CONFIRMATION', completion_method: 'STORE_CONFIRMED', completed_at: done });
  await wo('強制', { status: 'COMPLETED', progress_stage: 'WAITING_STORE_CONFIRMATION', completion_method: 'ADMIN_FORCE_CLOSED', completed_at: done });
  await wo('進行中', { status: 'PROCESSING', progress_stage: 'VENDOR_WORKING' });
  const { ctx, page, errors } = await pageForUser(browser, states.ga_all, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '合作紀錄');
    const row = page.locator('[data-testid="vs-row"]:visible', { hasText: v.name });
    await expect(row).toHaveCount(1, { timeout: 20_000 });
    await expect(row.getByTestId('vs-wo')).toHaveText('3');
    await expect(row.getByTestId('vs-completed')).toHaveText('1');
    await expect(row.getByTestId('vs-forced')).toHaveText('1');
    await expect(row.getByTestId('vs-avg')).toContainText('3');
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  const r = await (await apis.ga_all.get(`${B}/vendor-stats`)).json();
  const mine = (r.data?.rows ?? []).find((x: any) => x.vendor_id === v.id);
  expect(mine).toMatchObject({ wo_count: 3, completed_count: 1, force_closed_count: 1 });
  expect(Number(mine.avg_days)).toBeCloseTo(3, 0);
  // 店長手機 390：側欄沒有合作紀錄，API 403
  const phone = await browser.newContext({ storageState: states.store_wo, viewport: { width: 390, height: 844 } });
  const p = await phone.newPage();
  try {
    await openGaCenter(p);
    await openGaSide(p);
    const labels = (await shell(p).locator('aside .ga-link').allTextContents()).map((l) => l.trim());
    expect(labels).not.toContain('合作紀錄');
    expect((await apis.store_wo.get(`${B}/vendor-stats`)).status()).toBe(403);
  } finally {
    await phone.close();
  }
});

test('3 角色徽章：只有廠商查看者看到廠商資料徽章、工務看到工單中心徽章，數字等於點進列表的筆數；處理掉一張後減少', async ({ browser }, testInfo) => {
  test.setTimeout(420_000);
  const exp0 = await oracle([], await transferDays());
  // 再備一張門市退回的工單，確保工務有東西可處理
  const w = await seedWorkOrder('VW001', 'BG-退回', users.store_wo.id, { status: 'PROCESSING', progress_stage: 'REOPENED', accepted_at: new Date().toISOString() });
  const exp = await oracle([], await transferDays());
  expect(exp.wo_store_rejected).toBe(exp0.wo_store_rejected + 1);
  // 只有廠商查看者
  const vb = (await (await apis.vendor_view.get(`${B}/home/badges`)).json()).data;
  expect(vb.menu.vendors ?? 0).toBe(exp.contract_due);
  expect(Object.keys(vb.items)).toEqual(['contract_due']);
  expect(await listTotal(apis.vendor_view, '/vendors?contract_due=1&pageSize=1')).toBe(exp.contract_due);
  const v1 = await pageForUser(browser, states.vendor_view, testInfo);
  try {
    await openGaCenter(v1.page);
    await expect.poll(() => sideBadge(v1.page, '廠商資料'), { timeout: 20_000 }).toBe(cap(exp.contract_due));
    await openGaSide(v1.page);
    await shell(v1.page).getByRole('button', { name: /^廠商資料待我處理/ }).click();
    await expect(v1.page.getByTestId('vendor-total').locator('visible=true')).toHaveText(`共 ${exp.contract_due} 家`, { timeout: 20_000 });
    expect(noConsole(v1.errors)).toEqual([]);
  } finally {
    await v1.ctx.close();
  }
  // 工務
  const wb = (await (await apis.wo_works.get(`${B}/home/badges`)).json()).data;
  expect(wb.menu.work_orders ?? 0).toBe(exp.wo_store_rejected);
  expect(await listTotal(apis.wo_works, '/work-orders?attention=store_rejected&pageSize=1')).toBe(exp.wo_store_rejected);
  const w1 = await pageForUser(browser, states.wo_works, testInfo);
  try {
    await openGaCenter(w1.page);
    await expect.poll(() => sideBadge(w1.page, '工單中心'), { timeout: 20_000 }).toBe(cap(exp.wo_store_rejected));
    await openGaSide(w1.page);
    await shell(w1.page).getByRole('button', { name: /^工單中心待我處理/ }).click();
    await expect(w1.page.getByTestId('wob-total').locator('visible=true')).toHaveText(`共 ${exp.wo_store_rejected} 張`, { timeout: 20_000 });
    // 處理掉一張（回到廠商處理中）→ 徽章減少 1
    const upd = await db().from('maintenance_requests').update({ progress_stage: 'VENDOR_WORKING' }).eq('id', w.id);
    expect(upd.error).toBeNull();
    await openGaCenter(w1.page);
    await expect.poll(() => sideBadge(w1.page, '工單中心'), { timeout: 20_000 }).toBe(cap(exp.wo_store_rejected - 1));
    expect(await listTotal(apis.wo_works, '/work-orders?attention=store_rejected&pageSize=1')).toBe(exp.wo_store_rejected - 1);
    expect(await noPageOverflow(w1.page)).toBe(true);
    expect(noConsole(w1.errors)).toEqual([]);
  } finally {
    await w1.ctx.close();
  }
});
