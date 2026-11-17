import { expect, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, visibleHeading } from '../support/g01-ui';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name, stores } from '../support/m7m8-fixtures';
import { ga6Name, setupGa6Users, type Ga6User } from '../support/m7m8-ga6-fixtures';
import { dayOffset, oracle, seedAttention, transferDays } from '../support/m7m8-ga6-home-fixtures';

// M7/M8 第 6 批 G24.journey-home（角色接力劇本）：總務首頁「待我處理」與導覽徽章。
//   總務（全套）：首頁七項各自的數字等於資料庫；逐一點進去（首頁卡片）列表總筆數等於首頁數字；點需求工作台、工單中心的徽章也一樣；
//   採購核准＋門市名單身分：待核准採購單、逾期未到貨、待我的門市確認三項；採購單選單徽章是待核准與逾期的聯集，點進去筆數相同；
//   辦完一項即時減少：店長確認完成一張待確認的需求單後，我的追蹤徽章與首頁數字少 1；
//   超過 100 筆：首頁合計與選單徽章顯示 99+，點進去列表仍是完整筆數。
// 每步用 service role 獨立計算（oracle）回讀資料庫。測試資料只放 VW／ZT 測試門市與 2038 年，帶 QA-GA6-／[自動測試]M7M8 標記；結束只清自己的。
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });

let users: Record<string, Ga6User> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
const apis: Record<string, any> = {};
let st: Awaited<ReturnType<typeof stores>>;
let seeded: Awaited<ReturnType<typeof seedAttention>>;
const db = () => adminDb();
const noConsole = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const cap = (n: number) => (n <= 0 ? '' : n > 99 ? '99+' : String(n));
const home = (page: Page, key: string) => page.locator(`[data-testid="home-count-${key}"]:visible`);

/** 手機的側欄是抽屜，讀完側欄內容後要收起來，否則會擋住頁面上的點擊。 */
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
async function clickHomeCard(page: Page, key: string) {
  await openGaCenter(page);
  await page.locator(`[data-testid="home-item-${key}"]:visible`).getByRole('button').first().click();
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  st = await stores();
  const made = await setupGa6Users(['ga_all', 'home_plus', 'util_mgr']);
  users = made.users;
  teardown = made.teardown;
  for (const k of Object.keys(users)) {
    apis[k] = await apiForUser(users[k] as any);
    states[k] = await apis[k].storageState();
  }
  seeded = await seedAttention(users.ga_all.id, 'HM');
  for (const [i, due] of [dayOffset(-4), dayOffset(-1)].entries()) {
    const r = await callFn(users.util_mgr.client, 'ga_ws_ub_save', { p_id: null, p_payload: { store_id: st.VW001.id, expense_type: 'WATER', billing_month: '2038-06', provider_name: ga6Name('HM'), service_identifier: `QA-GA6-HM-${i}`, amount: 700, due_date: due }, p_expected_updated_at: null, p_confirm_paid_change: false });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('總務：首頁七項數字等於資料庫；逐一點進去列表總筆數等於首頁數字（需求單、帳單、廠商合約、調撥、採購逾期、工單退回、貼標複核）', async ({ browser }, testInfo) => {
  test.setTimeout(420_000);
  const exp = await oracle([], await transferDays());
  expect(seeded.pos.length).toBeGreaterThan(5);
  const { ctx, page, errors } = await pageForUser(browser, states.ga_all, testInfo);
  try {
    await openGaCenter(page);
    const targets: Array<[keyof typeof exp, string, (n: number) => string, string?]> = [
      ['request_intake', 'rq-total', (n) => `共 ${n} 張`],
      ['bill_overdue', 'bill-total', (n) => `共 ${n} 筆`],
      ['contract_due', 'vendor-total', (n) => `共 ${n} 家`],
      ['transfer_overdue', 'tr-total', (n) => `共 ${n} 張`],
      ['po_overdue', 'po-total', (n) => `共 ${n} 張`],
      ['wo_store_rejected', 'wob-total', (n) => `共 ${n} 張`],
    ];
    for (const [key, tid, fmt] of targets) {
      await openGaCenter(page);
      await expect(home(page, key), `首頁 ${key}`).toHaveText(String(exp[key]), { timeout: 20_000 });
      await clickHomeCard(page, key);
      await expect(page.getByTestId(tid).locator('visible=true'), `${key} 列表總筆數`).toHaveText(fmt(exp[key]), { timeout: 20_000 });
    }
    // 貼標複核頁沒有 testid：用文字
    await openGaCenter(page);
    await expect(home(page, 'onboarding_review')).toHaveText(String(exp.onboarding_review));
    await clickHomeCard(page, 'onboarding_review');
    await expect(visibleHeading(page, '貼標複核')).toBeVisible();
    await expect(page.getByText(`待複核 ${exp.onboarding_review} 筆`).locator('visible=true').first()).toBeVisible({ timeout: 20_000 });
    // 沒有權限的項目不出現
    for (const k of ['po_pending', 'store_wait']) await expect(page.locator(`[data-testid="home-item-${k}"]:visible`)).toHaveCount(0);
    // 首頁合計＝七項加總
    await openGaCenter(page);
    const total = exp.request_intake + exp.bill_overdue + exp.contract_due + exp.transfer_overdue + exp.po_overdue + exp.wo_store_rejected + exp.onboarding_review;
    await expect(page.locator('[data-testid="home-total"]:visible')).toHaveText(total > 99 ? '99+' : String(total));
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('總務：點導覽徽章（需求工作台、工單中心、採購單、廠商資料、調撥）只看待辦，列表筆數等於徽章數字；徽章 99+ 以內原樣顯示', async ({ browser }, testInfo) => {
  test.setTimeout(420_000);
  const exp = await oracle([], await transferDays());
  const { ctx, page, errors } = await pageForUser(browser, states.ga_all, testInfo);
  try {
    await openGaCenter(page);
    const cases: Array<[string, number, string, (n: number) => string]> = [
      ['總務需求工作台', exp.request_intake, 'rq-total', (n) => `共 ${n} 張`],
      ['工單中心', exp.wo_store_rejected, 'wob-total', (n) => `共 ${n} 張`],
      ['採購單', exp.po_overdue, 'po-total', (n) => `共 ${n} 張`],
      ['廠商資料', exp.contract_due, 'vendor-total', (n) => `共 ${n} 家`],
    ];
    for (const [label, n, tid, fmt] of cases) {
      await openGaCenter(page);
      await expect.poll(() => sideBadge(page, label), { timeout: 20_000, message: label }).toBe(cap(n));
      await openGaSide(page);
      await shell(page).getByRole('button', { name: new RegExp(`^${label}待我處理`) }).click();
      await expect(page.getByTestId(tid).locator('visible=true'), `${label} 列表`).toHaveText(fmt(n), { timeout: 20_000 });
      // 篩選提示：看全部可取消
      if (tid === 'rq-total' || tid === 'po-total') await expect(page.locator('[data-testid="attention-chip"]:visible')).toBeVisible();
    }
    // 沒有待辦的選單不顯示徽章（庫存調撥以外的選單，例如設備清冊）
    expect(await sideBadge(page, '設備清冊')).toBe('');
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('採購核准＋店長身分：待核准採購單、逾期未到貨、待我的門市確認三項；採購單徽章是待核准與逾期的聯集，點進去筆數相同；待簽核徽章等於待簽核清單', async ({ browser }, testInfo) => {
  test.setTimeout(420_000);
  const exp = await oracle([st.VW001.id], await transferDays());
  const { ctx, page, errors } = await pageForUser(browser, states.home_plus, testInfo);
  try {
    await openGaCenter(page);
    await expect(page.locator('[data-testid="home-items"] > li:visible')).toHaveCount(3);
    await expect(home(page, 'po_pending')).toHaveText(String(exp.po_pending));
    await expect(home(page, 'po_overdue')).toHaveText(String(exp.po_overdue));
    await expect(home(page, 'store_wait')).toHaveText(String(exp.store_wait));
    await expect(page.locator('[data-testid="home-total"]:visible')).toHaveText(String(exp.po_pending + exp.po_overdue + exp.store_wait));
    for (const k of ['request_intake', 'bill_overdue', 'contract_due', 'transfer_overdue', 'wo_store_rejected', 'onboarding_review']) await expect(page.locator(`[data-testid="home-item-${k}"]:visible`)).toHaveCount(0);
    // 點待核准 → 待簽核清單
    await clickHomeCard(page, 'po_pending');
    await expect(page.getByTestId('ap-total').locator('visible=true')).toHaveText(`待簽核 ${exp.po_pending} 張`, { timeout: 20_000 });
    // 點逾期未到貨 → 採購單（逾期）
    await clickHomeCard(page, 'po_overdue');
    await expect(page.getByTestId('po-total').locator('visible=true')).toHaveText(`共 ${exp.po_overdue} 張`, { timeout: 20_000 });
    // 採購單選單徽章（聯集）→ 點進去筆數相同
    await openGaCenter(page);
    await expect.poll(() => sideBadge(page, '採購單'), { timeout: 20_000 }).toBe(cap(exp.po_pending + exp.po_overdue));
    await openGaSide(page);
    await shell(page).getByRole('button', { name: /^採購單待我處理/ }).click();
    await expect(page.getByTestId('po-total').locator('visible=true')).toHaveText(`共 ${exp.po_pending + exp.po_overdue} 張`, { timeout: 20_000 });
    // 待簽核選單徽章 = 待簽核清單
    await openGaCenter(page);
    await expect.poll(() => sideBadge(page, '待簽核採購單'), { timeout: 20_000 }).toBe(cap(exp.po_pending));
    // 點待我的門市確認 → 我的追蹤（自己門市，不含別間）
    await clickHomeCard(page, 'store_wait');
    await expect(visibleHeading(page, '我的追蹤')).toBeVisible();
    await expect(page.getByTestId('mr-total').locator('visible=true')).toHaveText(`共 ${exp.store_wait} 張`, { timeout: 20_000 });
    await expect(page.locator('[data-testid="mr-card"]:visible', { hasText: seeded.requests.otherStore.request_no })).toHaveCount(0);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('辦完一項即時減少：店長確認完成一張待確認的需求單後，導覽徽章與首頁待辦數字立刻少 1，我的追蹤筆數也少 1', async ({ browser }, testInfo) => {
  test.setTimeout(420_000);
  const before = (await oracle([st.VW001.id], await transferDays())).store_wait;
  const target = seeded.requests.confirmA;
  const { ctx, page, errors } = await pageForUser(browser, states.home_plus, testInfo);
  try {
    await openGaCenter(page);
    await expect(home(page, 'store_wait')).toHaveText(String(before));
    await expect.poll(() => sideBadge(page, '我的追蹤'), { timeout: 20_000 }).toBe(cap(before));
    await clickHomeCard(page, 'store_wait');
    await page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first().fill(target.request_no);
    const card = page.locator('[data-testid="mr-card"]:visible', { hasText: target.request_no });
    await expect(card).toHaveCount(1);
    await card.getByTestId('open-detail').click();
    await expect(page.getByTestId('request-detail').locator('visible=true').first()).toBeVisible();
    await page.getByTestId('act-confirm_complete').click();
    await page.getByTestId('action-submit').click();
    await expect(page.getByTestId('detail-notice').locator('visible=true').first()).toBeVisible();
    expect((await db().from('ga_service_requests').select('main_status').eq('id', target.id).single()).data).toMatchObject({ main_status: 'COMPLETED' });
    expect((await oracle([st.VW001.id], await transferDays())).store_wait).toBe(before - 1);
    // 關掉詳情視窗（手機是全螢幕視窗，會擋住側欄）後看導覽徽章：即時減少
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect.poll(() => sideBadge(page, '我的追蹤'), { timeout: 20_000 }).toBe(cap(before - 1));
    // 首頁數字也減少
    await openGaCenter(page);
    await expect(home(page, 'store_wait')).toHaveText(String(before - 1), { timeout: 20_000 });
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('超過 100 筆：待受理需求單 110 筆，首頁合計與需求工作台徽章顯示 99+，首頁項目與點進去的列表是完整筆數', async ({ browser }, testInfo) => {
  test.setTimeout(420_000);
  const rows = Array.from({ length: 110 }, (_, i) => ({ store_id: st.VW001.id, created_by: users.ga_all.id, request_type: 'PURCHASE_SUPPLEMENT', title: m7Name(`hm-bulk-${i}`), description: 'm7m8 大量', resource_type: 'PART', desired_quantity: 1, main_status: 'PENDING_INTAKE' }));
  for (let i = 0; i < rows.length; i += 100) {
    const r = await db().from('ga_service_requests').insert(rows.slice(i, i + 100));
    expect(r.error, r.error?.message).toBeNull();
  }
  const exp = await oracle([], await transferDays());
  expect(exp.request_intake).toBeGreaterThan(100);
  const { ctx, page, errors } = await pageForUser(browser, states.ga_all, testInfo);
  try {
    await openGaCenter(page);
    await expect(home(page, 'request_intake')).toHaveText(String(exp.request_intake), { timeout: 20_000 });
    await expect(page.locator('[data-testid="home-total"]:visible')).toHaveText('99+');
    await expect.poll(() => sideBadge(page, '總務需求工作台'), { timeout: 20_000 }).toBe('99+');
    await openGaSide(page);
    await shell(page).getByRole('button', { name: /^總務需求工作台待我處理/ }).click();
    await expect(page.getByTestId('rq-total').locator('visible=true')).toHaveText(`共 ${exp.request_intake} 張`, { timeout: 20_000 });
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});
