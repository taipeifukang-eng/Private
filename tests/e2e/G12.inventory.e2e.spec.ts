import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { apiAs } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import {
  adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedBalance, seedCategory, seedLocation, seedLocationPart, seedPart, setupM7Users, type M7User,
} from '../support/m7m8-fixtures';
import { noPageOverflow, openGaCenter, pageFor, pageForUser } from '../support/g01-ui';
import { balanceRow, dialog, holdingRow, invNavTo, notice, pick, txnRow } from '../support/g12-ui';

// M7/M8 第 3 批 G12 e2e（桌機 1440 與手機 390 各跑一次）：
//  總務主要流程：餘額表（低庫存紅黃標、只看需補貨）→ 入庫（直接送出，顯示庫存前後）→ 出庫（會變負被擋；風險確認顯示過帳後餘額，確認後才過帳）→ 連點只過帳一次 →
//      發生時間不可晚於現在 → 流水（篩選、匯出 CSV）→ 持有狀態（調整原因、修改紀錄、合計超過擋下、別人先改 STALE）；每一步用資料庫回讀驗證。
//  失敗分支：只有交易管理（沒有料件查看）的過帳視窗直接說明缺哪個權限。
//  唯讀：店長、督導、區經理（名單身分）看自己門市，沒有過帳與調整按鈕，流水看不到交易原因與備註。
let users: Record<string, M7User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let partCat: { id: string };

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupM7Users(['roster_supervisor', 'roster_area_manager']);
  users = made.users;
  teardownUsers = made.teardown;
  partCat = await seedCategory('part', 'G12E');
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料（含過帳流水）').toEqual([]);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const real = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const searchBox = (page: any) => page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first();
const dbBal = async (loc: string, part: string) => (await adminDb().from('ga_inventory_balances').select('*').eq('location_id', loc).eq('part_id', part).maybeSingle()).data as any;
const dbTx = async (loc: string, part: string) => ((await adminDb().from('ga_inventory_transactions').select('*').eq('location_id', loc).eq('part_id', part).order('created_at')).data || []) as any[];
const stateOf = async (u: M7User) => {
  const api = await apiForUser(u as any);
  const state = await api.storageState();
  await api.dispose();
  return state;
};

test('總務主要流程：餘額紅黃標與只看需補貨 → 入庫 → 出庫（被擋、風險確認）→ 連點 → 未來時間 → 流水篩選與匯出 → 持有狀態調整、紀錄、合計超過、STALE', async ({ browser }, testInfo) => {
  test.setTimeout(480_000);
  const loc = await seedLocation('ZT04', 'E2E-位置');
  const pa = await seedPart(partCat.id, 'E2E-甲', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  const pb = await seedPart(partCat.id, 'E2E-乙', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  await seedLocationPart(loc.id, pa.id, { safety_stock_qty: 5, reorder_point_qty: 10 });
  await seedLocationPart(loc.id, pb.id, { safety_stock_qty: 5, reorder_point_qty: 10 });
  await seedBalance(loc.id, pa.id, 3);
  await seedBalance(loc.id, pb.id, 20);
  const reasonTag = `E2E原因-${m7Name('R')}`;
  const { ctx, page, errors } = await pageFor(browser, 'ga_works', testInfo);
  try {
    await openGaCenter(page);
    await invNavTo(page, '庫存總覽');
    await expect(page.getByRole('heading', { name: '庫存餘額', exact: true }).locator('visible=true').first()).toBeVisible();

    // ---- 餘額：紅黃標與只看需補貨（C7）
    await searchBox(page).fill(m7Name('E2E-'));
    await expect(balanceRow(page, pa.name)).toHaveCount(1);
    await expect(balanceRow(page, pb.name)).toHaveCount(1);
    await expect(balanceRow(page, pa.name).locator('[data-level="red"]')).toHaveCount(1);
    await expect(balanceRow(page, pb.name).locator('[data-level]')).toHaveCount(0);
    await page.getByTestId('low-only').locator('visible=true').check();
    await expect(balanceRow(page, pb.name)).toHaveCount(0);
    await expect(balanceRow(page, pa.name)).toHaveCount(1);
    await page.getByTestId('low-only').locator('visible=true').uncheck();
    await expect(balanceRow(page, pb.name)).toHaveCount(1);

    // ---- 入庫：直接送出（不需確認），顯示庫存前後
    await page.getByTestId('open-post').locator('visible=true').click();
    await expect(dialog(page).getByRole('heading', { name: '庫存過帳' })).toBeVisible();
    await expect(dialog(page).getByTestId('type-help')).toContainText('增加庫存');
    await pick(dialog(page), /^庫存位置 \*$/, '庫存位置選項', loc.name, loc.name);
    await pick(dialog(page), /^料件 \*$/, '料件選項', pa.name, pa.name);
    await expect(dialog(page).getByTestId('stock-now')).toContainText('3');
    await dialog(page).getByLabel('數量', { exact: true }).fill('10');
    await dialog(page).getByLabel('原因', { exact: true }).fill(`${reasonTag} 入庫`);
    await dialog(page).getByTestId('post-submit').click();
    await expect(dialog(page).getByTestId('post-result-line')).toContainText('庫存 3 → 13');
    expect(Number((await dbBal(loc.id, pa.id)).quantity_base)).toBe(13);
    let txs = await dbTx(loc.id, pa.id);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ transaction_type: 'RECEIPT', reason: `${reasonTag} 入庫` });
    expect(Number(txs[0].balance_before)).toBe(3);

    // ---- 出庫：會變負且不允許負庫存 → 直接擋；改小數量 → 風險確認（顯示過帳後餘額）→ 確認才過帳
    await dialog(page).getByRole('button', { name: '再過一筆' }).click();
    await dialog(page).getByRole('radio', { name: '出庫' }).check();
    await pick(dialog(page), /^料件 \*$/, '料件選項', pa.name, pa.name);
    await dialog(page).getByLabel('數量', { exact: true }).fill('20');
    await dialog(page).getByLabel('原因', { exact: true }).fill(`${reasonTag} 出庫`);
    await dialog(page).getByTestId('post-submit').click();
    await expect(dialog(page).getByTestId('post-error')).toContainText('不允許負庫存');
    await expect(dialog(page).getByTestId('post-confirm')).toHaveCount(0);
    expect(Number((await dbBal(loc.id, pa.id)).quantity_base)).toBe(13);
    await dialog(page).getByLabel('數量', { exact: true }).fill('5');
    await expect(dialog(page).getByTestId('post-submit')).toHaveText('下一步：確認');
    await dialog(page).getByTestId('post-submit').click();
    await expect(dialog(page).getByTestId('post-confirm')).toBeVisible();
    await expect(dialog(page).getByTestId('post-after')).toContainText('13 → 8');
    expect(Number((await dbBal(loc.id, pa.id)).quantity_base), '確認前不能過帳').toBe(13);
    await dialog(page).getByRole('button', { name: '返回修改' }).click();
    await expect(dialog(page).getByTestId('post-confirm')).toHaveCount(0);
    await dialog(page).getByTestId('post-submit').click();
    await dialog(page).getByTestId('post-confirm-ok').click();
    await expect(dialog(page).getByTestId('post-result-line')).toContainText('庫存 13 → 8');
    expect(Number((await dbBal(loc.id, pa.id)).quantity_base)).toBe(8);

    // ---- 連點：同一份內容連續按兩次只過帳一次
    await dialog(page).getByRole('button', { name: '再過一筆' }).click();
    await dialog(page).getByRole('radio', { name: '入庫' }).check();
    await pick(dialog(page), /^料件 \*$/, '料件選項', pa.name, pa.name);
    await dialog(page).getByLabel('數量', { exact: true }).fill('1');
    await dialog(page).getByLabel('原因', { exact: true }).fill(`${reasonTag} 連點`);
    await dialog(page).getByTestId('post-submit').dblclick();
    await expect(dialog(page).getByTestId('post-result-line')).toContainText('庫存 8 → 9');
    txs = await dbTx(loc.id, pa.id);
    expect(txs).toHaveLength(3);
    expect(Number((await dbBal(loc.id, pa.id)).quantity_base)).toBe(9);

    // ---- 發生時間不可晚於現在
    await dialog(page).getByRole('button', { name: '再過一筆' }).click();
    await pick(dialog(page), /^料件 \*$/, '料件選項', pa.name, pa.name);
    await dialog(page).getByLabel('數量', { exact: true }).fill('1');
    await dialog(page).getByLabel('原因', { exact: true }).fill(`${reasonTag} 未來`);
    await dialog(page).getByLabel('發生時間', { exact: true }).fill('2099-01-01T08:00');
    await dialog(page).getByTestId('post-submit').click();
    await expect(dialog(page).locator('.field-error', { hasText: '發生時間不可晚於現在' })).toBeVisible();
    expect(await dbTx(loc.id, pa.id)).toHaveLength(3);
    await dialog(page).getByRole('button', { name: '取消' }).click();
    await expect(dialog(page)).toHaveCount(0);

    // ---- 餘額更新（9 < 補貨點 10 → 黃標）
    await searchBox(page).fill(pa.name);
    await expect(balanceRow(page, pa.name).locator('[data-level="yellow"]')).toHaveCount(1);

    // ---- 流水：原因關鍵字、類型篩選、匯出
    await page.getByTestId('tab-transactions').locator('visible=true').click();
    await page.getByLabel('原因關鍵字').locator('visible=true').first().fill(reasonTag);
    await expect(txnRow(page)).toHaveCount(3);
    await page.getByLabel('交易類型').locator('visible=true').first().selectOption({ label: '出庫' });
    await expect(txnRow(page)).toHaveCount(1);
    await expect(txnRow(page)).toContainText('手動過帳');
    await page.getByLabel('交易類型').locator('visible=true').first().selectOption({ label: '全部類型' });
    await expect(txnRow(page)).toHaveCount(3);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-transactions').locator('visible=true').click()]);
    expect(download.suggestedFilename()).toMatch(/^庫存流水-\d{8}\.csv$/);
    const csv = fs.readFileSync((await download.path())!, 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.trim().split('\r\n')).toHaveLength(4);
    await expect(notice(page, '已匯出')).toBeVisible();

    // ---- 持有狀態：調整（帶原因）、修改紀錄、合計超過擋下、別人先改 STALE
    await page.getByTestId('tab-holding').locator('visible=true').click();
    await searchBox(page).fill(pa.name);
    await expect(holdingRow(page, pa.name)).toHaveCount(1);
    await holdingRow(page, pa.name).getByRole('button', { name: /^調整/ }).click();
    await dialog(page).getByLabel('使用中數量').fill('8');
    await dialog(page).getByLabel('閒置數量').fill('5');
    await expect(dialog(page).locator('.field-error', { hasText: '不可超過' })).toBeVisible();
    await expect(dialog(page).getByRole('button', { name: '儲存', exact: true })).toBeDisabled();
    await dialog(page).getByLabel('使用中數量').fill('4');
    await dialog(page).getByLabel('閒置數量').fill('3');
    await expect(dialog(page).getByTestId('draft-unclassified')).toContainText('2');
    await dialog(page).getByLabel('調整原因').fill('e2e 盤點確認');
    await dialog(page).getByRole('button', { name: '儲存', exact: true }).click();
    await expect(notice(page, '已調整')).toBeVisible();
    const hold = (await adminDb().from('ga_inventory_holding_allocations').select('*').eq('balance_id', (await dbBal(loc.id, pa.id)).id).single()).data as any;
    expect(hold).toMatchObject({ in_use_quantity: 4, idle_quantity: 3, notes: 'e2e 盤點確認' });
    await holdingRow(page, pa.name).getByRole('button', { name: /^修改紀錄/ }).click();
    await expect(dialog(page).getByTestId('history-row')).toHaveCount(1);
    await expect(dialog(page).getByTestId('history-row')).toContainText('e2e 盤點確認');
    await dialog(page).getByRole('button', { name: '關閉' }).click();
    // 別人先改：開著調整視窗時，另一人（這裡用資料庫）改了同一筆
    await holdingRow(page, pa.name).getByRole('button', { name: /^調整/ }).click();
    await expect(dialog(page).getByLabel('使用中數量')).toHaveValue('4');
    await adminDb().from('ga_inventory_holding_allocations').update({ idle_quantity: 1, updated_at: new Date().toISOString() }).eq('balance_id', hold.balance_id);
    await dialog(page).getByLabel('閒置數量').fill('2');
    await dialog(page).getByRole('button', { name: '儲存', exact: true }).click();
    await expect(dialog(page).locator('.field-error', { hasText: '已被其他人調整過' })).toBeVisible();
    expect(Number((await adminDb().from('ga_inventory_holding_allocations').select('idle_quantity').eq('balance_id', hold.balance_id).single()).data!.idle_quantity)).toBe(1);
    await dialog(page).getByRole('button', { name: '重新載入這筆' }).click();
    await expect(dialog(page).getByLabel('閒置數量')).toHaveValue('1');
    await dialog(page).getByRole('button', { name: '取消' }).click();
    expect(await noPageOverflow(page)).toBe(true);
    expect(real(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('只有交易管理（沒有料件查看）：過帳視窗直接說明缺「料件查看」，送出按鈕不能按；伺服端也擋（沒有流水）', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const loc = await seedLocation('ZT04', 'E2E-缺權限位置');
  const part = await seedPart(partCat.id, 'E2E-缺權限料件', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  await seedLocationPart(loc.id, part.id);
  const { ctx, page, errors } = await pageFor(browser, 'ga_inv_txn_only', testInfo);
  try {
    await openGaCenter(page);
    await invNavTo(page, '庫存總覽');
    await page.getByTestId('open-post').locator('visible=true').click();
    await expect(dialog(page).getByTestId('post-problem')).toContainText('料件查看');
    await expect(dialog(page).getByTestId('post-problem')).not.toContainText('缺少：庫存交易管理');
    await expect(dialog(page).getByTestId('post-submit')).toBeDisabled();
    // 直接打 API 也被擋
    const status = await page.evaluate(async ({ l, p }) => (await fetch('/api/workspace/general-affairs/inventory/transactions/post', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transaction_type: 'RECEIPT', location_id: l, part_id: p, quantity: 1, input_unit_type: 'BASE', reason: 'x', idempotency_key: crypto.randomUUID() }),
    })).status, { l: loc.id, p: part.id });
    expect(status).toBe(403);
    expect(await dbTx(loc.id, part.id)).toEqual([]);
    expect(real(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('門市名單身分（店長、督導、區經理）：看自己門市的餘額、流水、持有狀態；沒有過帳與調整按鈕；流水看不到交易原因與備註；別間門市看不到', async ({ browser }, testInfo) => {
  test.setTimeout(480_000);
  const mine = await seedLocation('ZT01', 'E2E-我的位置');
  const theirs = await seedLocation('VW001', 'E2E-他店位置');
  const pm = await seedPart(partCat.id, 'E2E-我的料件', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  const pt = await seedPart(partCat.id, 'E2E-他店料件', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  await seedLocationPart(mine.id, pm.id, { safety_stock_qty: 5, reorder_point_qty: 10 });
  await seedLocationPart(theirs.id, pt.id);
  await seedBalance(mine.id, pm.id, 2);
  await seedBalance(theirs.id, pt.id, 9);
  const ga = await apiAs('ga_works');
  const posted = await ga.post('/api/workspace/general-affairs/inventory/transactions/post', { data: { transaction_type: 'RECEIPT', location_id: mine.id, part_id: pm.id, quantity: 4, input_unit_type: 'BASE', reason: '內部原因-只有總務看得到', notes: '內部備註-只有總務看得到', idempotency_key: crypto.randomUUID() } });
  expect(posted.status()).toBe(201);
  await ga.dispose();
  const who: [string, any][] = [['store_manager', null], ['roster_supervisor', await stateOf(users.roster_supervisor)], ['roster_area_manager', await stateOf(users.roster_area_manager)]];
  for (const [role, state] of who) {
    const { ctx, page, errors } = state ? await pageForUser(browser, state, testInfo) : await pageFor(browser, role, testInfo);
    try {
      await openGaCenter(page);
      await invNavTo(page, '庫存總覽');
      await expect(page.getByTestId('readonly-note').locator('visible=true'), role).toContainText('只會看到自己門市');
      await expect(page.getByTestId('open-post'), role).toHaveCount(0);
      await searchBox(page).fill(m7Name('E2E-'));
      await expect(balanceRow(page, pm.name), role).toHaveCount(1);
      await expect(balanceRow(page, pm.name).locator('[data-level]'), role).toHaveCount(1); // 6 < 補貨點 10 → 黃標（庫存 2 + 入庫 4）
      await expect(balanceRow(page, pt.name), role).toHaveCount(0);
      // 流水分頁（只在名單上的人，側欄只有一個「庫存總覽」入口，流水用分頁切換）
      await page.getByTestId('tab-transactions').locator('visible=true').click();
      await expect(page.getByRole('heading', { name: '庫存流水', exact: true }).locator('visible=true').first(), role).toBeVisible();
      await expect(page.getByTestId('masked-note').locator('visible=true'), role).toBeVisible();
      await expect(txnRow(page).first(), role).toBeVisible();
      await expect(page.locator('[data-testid="txn-row"]:visible, [data-testid="txn-card"]:visible').filter({ hasText: '內部' }), role).toHaveCount(0);
      expect(await page.locator('main, body').first().innerText(), role).not.toContain('只有總務看得到');
      // 持有狀態：唯讀
      await page.getByTestId('tab-holding').locator('visible=true').click();
      await expect(page.getByTestId('holding-readonly').locator('visible=true'), role).toBeVisible();
      await searchBox(page).fill(pm.name);
      await expect(holdingRow(page, pm.name), role).toHaveCount(1);
      await expect(holdingRow(page, pm.name).getByRole('button', { name: /^調整/ }), role).toHaveCount(0);
      expect(await noPageOverflow(page), role).toBe(true);
      expect(real(errors), role).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
  // 別間門市的店長只看到自己的
  const b = await pageFor(browser, 'ga_store_manager_b', testInfo);
  try {
    await openGaCenter(b.page);
    await invNavTo(b.page, '庫存總覽');
    await searchBox(b.page).fill(m7Name('E2E-'));
    await expect(balanceRow(b.page, pt.name)).toHaveCount(1);
    await expect(balanceRow(b.page, pm.name)).toHaveCount(0);
  } finally {
    await b.ctx.close();
  }
});

test('角色接力（庫存段）：總務在桌機過帳入庫 → 店長在手機看到自己門市的餘額與流水 → 工務（另一個持有總務角色的帳號）也看得到並能過帳 → 店長畫面沒有任何操作按鈕', async ({ browser }, testInfo) => {
  test.setTimeout(480_000);
  const loc = await seedLocation('ZT01', 'E2E-接力位置');
  const part = await seedPart(partCat.id, 'E2E-接力料件', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  await seedLocationPart(loc.id, part.id);
  const run = async (role: string, fn: (page: any) => Promise<void>) => {
    const { ctx, page, errors } = await pageFor(browser, role, testInfo);
    try {
      await openGaCenter(page);
      await fn(page);
      expect(real(errors), role).toEqual([]);
    } finally {
      await ctx.close();
    }
  };
  const postVia = async (page: any, qty: string, reason: string) => {
    await invNavTo(page, '庫存總覽');
    await page.getByTestId('open-post').locator('visible=true').click();
    await pick(dialog(page), /^庫存位置 \*$/, '庫存位置選項', loc.name, loc.name);
    await pick(dialog(page), /^料件 \*$/, '料件選項', part.name, part.name);
    await dialog(page).getByLabel('數量', { exact: true }).fill(qty);
    await dialog(page).getByLabel('原因', { exact: true }).fill(reason);
    await dialog(page).getByTestId('post-submit').click();
    await expect(dialog(page).getByTestId('post-result-line')).toBeVisible();
    await dialog(page).getByRole('button', { name: '關閉' }).click();
  };
  await run('ga_works', async (page) => {
    await postVia(page, '8', '接力-總務入庫');
    expect(Number((await dbBal(loc.id, part.id)).quantity_base)).toBe(8);
  });
  await run('store_manager', async (page) => {
    await invNavTo(page, '庫存總覽');
    await searchBox(page).fill(part.name);
    await expect(balanceRow(page, part.name)).toHaveCount(1);
    await expect(balanceRow(page, part.name)).toContainText('8');
    await expect(page.getByTestId('open-post')).toHaveCount(0);
    await page.getByTestId('tab-transactions').locator('visible=true').click();
    await expect(txnRow(page).first()).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
  });
  await run('ga_works', async (page) => {
    // 工務與總務同權限（Q25）：這裡用總務帳號代表持有總務角色的另一個帳號，再補一筆出庫
    await invNavTo(page, '庫存總覽');
    await page.getByTestId('open-post').locator('visible=true').click();
    await dialog(page).getByRole('radio', { name: '出庫' }).check();
    await pick(dialog(page), /^庫存位置 \*$/, '庫存位置選項', loc.name, loc.name);
    await pick(dialog(page), /^料件 \*$/, '料件選項', part.name, part.name);
    await dialog(page).getByLabel('數量', { exact: true }).fill('3');
    await dialog(page).getByLabel('原因', { exact: true }).fill('接力-出庫');
    await dialog(page).getByTestId('post-submit').click();
    await dialog(page).getByTestId('post-confirm-ok').click();
    await expect(dialog(page).getByTestId('post-result-line')).toContainText('庫存 8 → 5');
    await dialog(page).getByRole('button', { name: '關閉' }).click();
  });
  await run('store_manager', async (page) => {
    await invNavTo(page, '庫存總覽');
    await searchBox(page).fill(part.name);
    await expect(balanceRow(page, part.name)).toContainText('5');
    await page.getByTestId('tab-transactions').locator('visible=true').click();
    await expect(txnRow(page, part.name)).toHaveCount(2);
  });
});
