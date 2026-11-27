import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { gaNavTo, noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, visibleHeading } from '../support/g01-ui';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, stores } from '../support/m7m8-fixtures';
import { ga6Name, seedGa6Vendor, setupGa6Users, type Ga6User } from '../support/m7m8-ga6-fixtures';
import { oracle, seedAttention, transferDays } from '../support/m7m8-ga6-home-fixtures';

// M7/M8 第 6 批 G24.journey-store-blocked（角色接力劇本）：店長與「只有分類區域權限者」看不到不該看的東西，而且不是只有畫面藏起來。
//   店長（需求單查看／留言／確認自己門市，VW001 名單成員）：側欄沒有廠商、水電網費、合作紀錄、採購分析；首頁只有「待我的門市確認或補資料」且只算自己門市（VW002 那張不算）；
//     點進去的我的追蹤筆數等於首頁數字；廠商、帳單、績效、採購分析的 API 全部 403；用自己的登入身分直查資料表（廠商、帳單）讀不到任何一列。
//   只有分類區域權限者：服務分類與服務區域兩頁正常開啟；側欄沒有廠商資料；廠商 API 403；分類與區域回應與廠商下拉都看不到統編；直查廠商表讀不到。
//   另驗：DEV 真實 store_manager 角色（只有報修與工單查看自己門市）首頁沒有任何待辦項目，也沒有庫存提醒。
// 每步用 service role 回讀資料庫確認種子存在（證明「讀不到」不是因為資料本來就空）。測試資料只放 VW／ZT 測試門市與 2038 年，帶 QA-GA6- 標記；結束只清自己的。
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });

const B = '/api/workspace/general-affairs';
const TAX = '04595257';
let users: Record<string, Ga6User> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
const apis: Record<string, any> = {};
let st: Awaited<ReturnType<typeof stores>>;
let seeded: Awaited<ReturnType<typeof seedAttention>>;
let vendor: any;
const db = () => adminDb();
const noConsole = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const text = async (r: any) => r.text().catch(() => '');
async function closeSide(page: any) {
  const b = shell(page).getByRole('button', { name: '關閉總務選單' });
  if (await b.isVisible().catch(() => false)) await b.click();
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  st = await stores();
  const made = await setupGa6Users(['store_req', 'store_mgr', 'cat_only', 'util_mgr', 'ga_all']);
  users = made.users;
  teardown = made.teardown;
  for (const k of Object.keys(users)) {
    apis[k] = await apiForUser(users[k] as any);
    states[k] = await apis[k].storageState();
  }
  seeded = await seedAttention(users.ga_all.id, 'SB');
  vendor = await seedGa6Vendor('sb-secret', { tax_id: TAX, billing_title: '帳務抬頭機密', payment_terms: '月結 30 天', contract_required: true, contract_end_date: '2038-12-31' });
  const r = await callFn(users.util_mgr.client, 'ga_ws_ub_save', { p_id: null, p_payload: { store_id: st.VW001.id, service_period_start: '2038-01-01', service_period_end: '2038-01-31', expense_type: 'WATER', billing_month: '2038-06', provider_name: ga6Name('SB'), service_identifier: 'QA-GA6-SB-1', amount: 900, due_date: '2038-07-01' }, p_expected_updated_at: null, p_confirm_paid_change: false });
  expect(r.ok, JSON.stringify(r)).toBe(true);
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('店長：側欄沒有廠商、水電網費、合作紀錄、採購分析；首頁只有自己門市的待確認／待補資料；點進去筆數相同；API 全部 403', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const exp = await oracle([st.VW001.id], await transferDays());
  expect(exp.store_wait).toBeGreaterThanOrEqual(3);
  // 種子確實存在（別間門市還有一張待確認，不該算進來）
  expect(seeded.requests.otherStore.store_id).toBe(st.VW002.id);
  const { ctx, page, errors } = await pageForUser(browser, states.store_req, testInfo);
  try {
    await openGaCenter(page);
    await openGaSide(page);
    const labels = (await shell(page).locator('aside .ga-link').allTextContents()).map((l) => l.trim());
    for (const l of ['廠商資料', '服務分類', '服務區域', '合作紀錄', '採購分析', '水電電話網路費', '帳單列表', '費用報表', '採購單', '工單中心', '總務需求工作台']) expect(labels, `不應看到 ${l}`).not.toContain(l);
    await closeSide(page);
    await expect(page.locator('[data-testid="home-count-store_wait"]:visible')).toHaveText(String(exp.store_wait));
    await expect(page.locator('[data-testid="home-items"] > li:visible')).toHaveCount(1);
    await expect(page.locator('[data-testid="home-total"]:visible')).toHaveText(String(exp.store_wait));
    await expect(page.locator('[data-testid="home-inventory"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-testid="home-kpi"]:visible')).toHaveCount(0);
    // 點待辦：我的追蹤只列自己門市待確認／待補資料，筆數等於首頁數字
    await page.locator('[data-testid="home-item-store_wait"]:visible').getByRole('button').first().click();
    await expect(visibleHeading(page, '我的追蹤')).toBeVisible();
    await expect(page.getByTestId('mr-total').locator('visible=true')).toHaveText(`共 ${exp.store_wait} 張`);
    await expect(page.locator('[data-testid="attention-chip"]:visible')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  for (const p of ['/vendors', '/vendors?contract_due=1', '/utility-bills', '/utility-bills?overdue=1', '/vendor-stats', '/purchase-analysis', '/service-categories', '/service-regions', '/home/summary?x=1']) {
    const r = await apis.store_req.get(B + p);
    expect(r.status() === 403 || (p.startsWith('/home') && r.status() === 200), `${p} ${r.status()}`).toBe(true);
  }
  for (const p of ['/vendors', '/utility-bills', '/vendor-stats', '/purchase-analysis']) expect((await apis.store_req.get(B + p)).status(), p).toBe(403);
});

test('店長直查資料表也讀不到：廠商、水電帳單（種子確實存在）；直接呼叫廠商與帳單函式被擋；DEV 真實店長角色首頁沒有任何待辦與庫存提醒', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const seeds = {
    vendors: ((await db().from('ga_vendors').select('id', { count: 'exact', head: true }).eq('id', vendor.id)).count || 0),
    bills: ((await db().from('ga_utility_bills').select('id', { count: 'exact', head: true }).eq('service_identifier', 'QA-GA6-SB-1')).count || 0),
  };
  expect(seeds).toEqual({ vendors: 1, bills: 1 });
  for (const who of ['store_req', 'store_mgr']) {
    const c = users[who].client;
    for (const t of ['ga_vendors', 'ga_utility_bills']) {
      const r = await c.from(t).select('id').limit(5);
      expect(r.error?.code === '42501' || (r.data || []).length === 0, `${who} 直查 ${t}`).toBe(true);
    }
    expect((await callFn(c, 'ga_ws_vendor_list', { p_filters: {}, p_page: 1, p_page_size: 5 })).status, `${who} vendor_list`).toBe(403);
    expect((await callFn(c, 'ga_ws_vendor_get', { p_id: vendor.id })).status, `${who} vendor_get`).toBe(403);
    expect((await callFn(c, 'ga_ws_ub_list', { p_filters: {}, p_page: 1, p_page_size: 5 })).status, `${who} ub_list`).toBe(403);
    expect((await callFn(c, 'ga_ws_vendor_perf', {})).status, `${who} perf`).toBe(403);
    expect((await callFn(c, 'ga_ws_purchase_analysis', {})).status, `${who} analysis`).toBe(403);
  }
  const { ctx, page, errors } = await pageForUser(browser, states.store_mgr, testInfo);
  try {
    await openGaCenter(page);
    await expect(page.locator('[data-testid="home-empty"]:visible')).toBeVisible();
    await expect(page.locator('[data-testid="home-items"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-testid="home-inventory"]:visible')).toHaveCount(0);
    await openGaSide(page);
    await expect(shell(page).locator('aside .ga-badge')).toHaveCount(0);
    await closeSide(page);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('只有分類區域權限者：服務分類與服務區域兩頁正常；沒有廠商資料入口；廠商 API 403；任何回應都看不到統編；直查廠商表讀不到', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, states.cat_only, testInfo);
  const seen: string[] = [];
  page.on('response', async (r) => { if (r.url().includes('/api/workspace/') && r.ok()) seen.push(await r.text().catch(() => '')); });
  try {
    await openGaCenter(page);
    await openGaSide(page);
    const labels = (await shell(page).locator('aside .ga-link').allTextContents()).map((l) => l.trim());
    expect(labels).toEqual(expect.arrayContaining(['服務分類', '服務區域']));
    for (const l of ['廠商資料', '合作紀錄', '採購分析', '水電電話網路費']) expect(labels, `不應看到 ${l}`).not.toContain(l);
    await gaNavTo(page, '服務分類');
    await expect(visibleHeading(page, '服務分類')).toBeVisible();
    await expect(page.locator('[data-testid="stat-total"]:visible')).toBeVisible();
    await gaNavTo(page, '服務區域');
    await expect(visibleHeading(page, '服務區域')).toBeVisible();
    await expect(page.locator('[data-testid="stat-total"]:visible')).toBeVisible();
    // 首頁入口卡片導向可進入的第一個廠商頁（服務分類），不是廠商資料
    await openGaCenter(page);
    await page.locator('[data-testid="ga-vendor-entry"]:visible').click();
    await expect(visibleHeading(page, '服務分類')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  expect(seen.length).toBeGreaterThan(0);
  for (const body of seen) {
    expect(body).not.toContain(TAX);
    expect(body).not.toContain('帳務抬頭機密');
    expect(body).not.toContain('"tax_id"');
  }
  const a = apis.cat_only;
  for (const p of ['/vendors', '/vendors/' + vendor.id, '/vendor-stats', '/purchase-analysis', '/utility-bills']) expect((await a.get(B + p)).status(), p).toBe(403);
  for (const p of ['/service-categories', '/service-regions']) {
    const r = await a.get(B + p);
    expect(r.status(), p).toBe(200);
    const t = await text(r);
    expect(t).not.toContain(TAX);
    expect(t).not.toContain('tax_id');
  }
  const direct = await users.cat_only.client.from('ga_vendors').select('id,tax_id').limit(5);
  expect(direct.error?.code === '42501' || (direct.data || []).length === 0, '直查廠商表').toBe(true);
  expect((await callFn(users.cat_only.client, 'ga_ws_vendor_list', { p_filters: {}, p_page: 1, p_page_size: 5 })).status).toBe(403);
  const opt = await a.get(`${B}/vendor-options`);
  expect([200, 403]).toContain(opt.status());
  expect(await text(opt)).not.toContain(TAX);
});
