import crypto from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, visibleHeading } from '../support/g01-ui';
import { dialog } from '../support/g12-ui';
import { openWo, submitForm, vis } from '../support/g18-journey';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name, seedWorkOrder } from '../support/m7m8-fixtures';
import { freshValidTaxId, ga6Name, seedGa6Vendor, setupGa6Users, type Ga6User } from '../support/m7m8-ga6-fixtures';
import { runIdOrThrow } from '../support/m5-fixtures';

// M7/M8 第 6 批 G21.journey-vendor-chain（角色接力劇本，廠商從登錄到績效到停用的一整條鏈）：
//  1. 總務新增廠商：統編重複被擋並指出既有廠商；名稱相近只提醒仍可儲存。
//  2. 採購單選廠商：下拉只列合作中（暫停與停用的選不到）；下訂後採購單存快照名稱；對暫停廠商開單被擋（資料庫不留單）。
//  3. 工單進度表單指定該廠商（廠商下拉僅總務有）→ 送門市確認 → 店長確認完成（STORE_CONFIRMED）。
//  4. 績效頁出現該廠商：工單數、完成數（門市確認）、受理到完成平均天數、採購單確定金額；沒選廠商的工單列「未指定」。
//  5. 廠商停用後：舊工單與舊採購單顯示「（已停用）」、新單選不到（下拉沒有、API 422）；已下訂的採購單仍可收貨結案；績效頁照樣有這家廠商的歷史。
// 每步用 service role 回讀資料庫。測試資料帶 QA-GA6- 標記、只用 VW 測試門市；結束只清自己的。
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });

const N = '/api/workspace/general-affairs';
let users: Record<string, Ga6User> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
let apiGa: any;
const db = () => adminDb();
const noConsole = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const tag = (s: string) => ga6Name(`CH-${s}`);
const st: Record<string, any> = {};
const ids: Record<string, string> = {};
let taxA = '';
const poRow = async (id: string) => (await db().from('ga_purchase_orders').select('*').eq('id', id).single()).data as any;
const woRow = async (id: string) => (await db().from('maintenance_requests').select('*').eq('id', id).single()).data as any;
const vRow = async (id: string) => (await db().from('ga_vendors').select('*').eq('id', id).single()).data as any;
async function nav(page: Page, label: string) {
  await openGaSide(page);
  await shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first().click();
  await expect(visibleHeading(page, label)).toBeVisible();
}
const money = (n: number) => 'NT$ ' + Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 0 });

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGa6Users(['ga_all', 'store_wo']);
  users = made.users;
  teardown = made.teardown;
  apiGa = await apiForUser(users.ga_all as any);
  states.ga_all = await apiGa.storageState();
  states.store_wo = await (await apiForUser(users.store_wo as any)).storageState();
  taxA = await freshValidTaxId();
});
test.afterAll(async () => {
  await apiGa?.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('1 總務新增廠商：統編重複被擋並指出既有廠商；名稱相近只提醒、仍可儲存', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const nameA = tag('甲廠商');
  const { ctx, page, errors } = await pageForUser(browser, states.ga_all, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '廠商資料');
    await vis(page, 'new-vendor').click();
    await expect(dialog(page).getByTestId('vendor-form')).toBeVisible();
    await dialog(page).getByTestId('vf-name').fill(nameA);
    await dialog(page).getByTestId('vf-tax').fill(taxA);
    for (let i = 0; i < 3; i += 1) await dialog(page).getByTestId('vf-next').click();
    await dialog(page).getByTestId('vf-save').click();
    await expect(vis(page, 'vendor-saved')).toContainText(nameA);
    const a = (await db().from('ga_vendors').select('*').eq('name', nameA).single()).data as any;
    expect(a).toMatchObject({ tax_id: taxA, status: 'active' });
    ids.vendorA = a.id;
    st.nameA = nameA;
    // 統編重複：擋下並指出既有廠商
    await vis(page, 'new-vendor').click();
    await dialog(page).getByTestId('vf-name').fill(tag('重複統編'));
    await dialog(page).getByTestId('vf-tax').fill(taxA);
    for (let i = 0; i < 3; i += 1) await dialog(page).getByTestId('vf-next').click();
    await dialog(page).getByTestId('vf-save').click();
    await expect(dialog(page).getByTestId('vf-error')).toContainText('已經登錄在');
    await expect(dialog(page).getByTestId('vf-existing')).toContainText(nameA);
    expect((await db().from('ga_vendors').select('id').eq('name', tag('重複統編'))).data).toEqual([]);
    await dialog(page).getByTestId('vf-cancel').click();
    // 名稱相近：只提醒，仍可儲存
    const nameSim = `${nameA}分公司`;
    await vis(page, 'new-vendor').click();
    await dialog(page).getByTestId('vf-name').fill(nameSim);
    await dialog(page).getByTestId('vf-tax').fill(await freshValidTaxId());
    for (let i = 0; i < 3; i += 1) await dialog(page).getByTestId('vf-next').click();
    await dialog(page).getByTestId('vf-save').click();
    await expect(vis(page, 'vendor-saved')).toContainText(nameSim);
    await expect(vis(page, 'vendor-warning').first()).toContainText('名稱相近');
    expect((await db().from('ga_vendors').select('id').eq('name', nameSim).maybeSingle()).data).toBeTruthy();
    // 另外備好暫停與停用的廠商（採購單下拉用）
    const p = await seedGa6Vendor('CH-暫停', { status: 'paused' });
    const i = await seedGa6Vendor('CH-停用', { status: 'inactive' });
    ids.paused = p.id;
    ids.inactive = i.id;
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('2 採購單選廠商：下拉只列合作中（暫停與停用的選不到）；下訂後存快照名稱；對暫停廠商開單被擋', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, states.ga_all, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '採購單');
    await vis(page, 'new-po').click();
    await expect(vis(page, 'pe-vendor')).toBeVisible();
    await vis(page, 'pe-vendor').fill(`QA-GA6-${runIdOrThrow()}-CH`);
    await expect(vis(page, 'pe-vendor-option').filter({ hasText: st.nameA }).first()).toBeVisible();
    await expect(vis(page, 'pe-vendor-option').filter({ hasText: 'CH-暫停' })).toHaveCount(0);
    await expect(vis(page, 'pe-vendor-option').filter({ hasText: 'CH-停用' })).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  // 開單與下訂（資料庫函式，用總務自己的身分）：快照名稱
  const created = await apiGa.post(`${N}/purchase-orders`, { data: { header: { vendor_id: ids.vendorA, notes: m7Name('CH-PO') }, items: [{ item_name: m7Name('CH-item'), unit: '個', quantity: 2, unit_price: 500, fulfil_mode: 'NO_STOCK' }], idempotency_key: crypto.randomUUID() } });
  expect(created.status(), await created.text()).toBe(201);
  const po = (await created.json()).data as any;
  const placed = await apiGa.post(`${N}/purchase-orders/${po.id}/actions`, { data: { action: 'place_order', expected_updated_at: po.updated_at } });
  expect(placed.status(), await placed.text()).toBe(200);
  ids.po = po.id;
  const row = await poRow(po.id);
  expect(row).toMatchObject({ status: 'ORDERED', vendor_id: ids.vendorA, vendor_name_snapshot: st.nameA });
  expect(row.ordered_at).toBeTruthy();
  // 暫停廠商開單被擋：422，資料庫沒有新單
  const before = (await db().from('ga_purchase_orders').select('id', { count: 'exact', head: true }).eq('vendor_id', ids.paused)).count;
  const bad = await apiGa.post(`${N}/purchase-orders`, { data: { header: { vendor_id: ids.paused, notes: m7Name('CH-PO-paused') }, items: [{ item_name: m7Name('CH-item2'), unit: '個', quantity: 1, unit_price: 1, fulfil_mode: 'NO_STOCK' }], idempotency_key: crypto.randomUUID() } });
  expect(bad.status(), await bad.text()).toBe(422);
  expect((await db().from('ga_purchase_orders').select('id', { count: 'exact', head: true }).eq('vendor_id', ids.paused)).count).toBe(before);
});

test('3 工單進度表單指定該廠商（僅總務有廠商下拉）→ 送門市確認 → 店長確認完成', async ({ browser }, testInfo) => {
  test.setTimeout(420_000);
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const wo = await seedWorkOrder('VW001', 'CH-工單', users.store_wo.id, { status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW', accepted_at: twoDaysAgo, accepted_by: users.ga_all.id });
  const noVendor = await seedWorkOrder('VW001', 'CH-未指定', users.store_wo.id, { status: 'PROCESSING', progress_stage: 'INITIAL_REVIEW', accepted_at: twoDaysAgo });
  ids.wo = wo.id;
  ids.woNoVendor = noVendor.id;
  const ga = await pageForUser(browser, states.ga_all, testInfo);
  try {
    await openGaCenter(ga.page);
    await nav(ga.page, '工單中心');
    await openWo(ga.page, wo.title);
    await vis(ga.page, 'act-progress').click();
    const select = dialog(ga.page).getByTestId('f-vendor');
    // 名稱相近的「分公司」也是合作中，會一起列出；甲廠商本身只有一項
    await expect(select.locator('option', { hasText: st.nameA }).filter({ hasNotText: '分公司' })).toHaveCount(1);
    await expect(select.locator('option', { hasText: 'CH-暫停' })).toHaveCount(0);
    await expect(select.locator('option', { hasText: 'CH-停用' })).toHaveCount(0);
    await select.selectOption(ids.vendorA);
    await dialog(ga.page).getByTestId('f-notes').fill('指定廠商處理');
    await submitForm(ga.page, '進度已更新');
    expect((await woRow(wo.id)).vendor_id).toBe(ids.vendorA);
    await expect(vis(ga.page, 'wo-vendor')).toContainText(st.nameA);
    await vis(ga.page, 'act-completion').click();
    await submitForm(ga.page, '已送門市確認');
    expect(await woRow(wo.id)).toMatchObject({ status: 'PROCESSING', progress_stage: 'WAITING_STORE_CONFIRMATION' });
    expect(noConsole(ga.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
  }
  // 店長沒有廠商下拉（看不到「更新進度」），確認完成
  const store = await pageForUser(browser, states.store_wo, testInfo);
  try {
    await openGaCenter(store.page);
    await nav(store.page, '工單中心');
    await openWo(store.page, wo.title);
    await expect(vis(store.page, 'act-progress')).toHaveCount(0);
    await vis(store.page, 'act-store-confirm').click();
    await submitForm(store.page, '已確認完成');
    expect(await woRow(wo.id)).toMatchObject({ status: 'COMPLETED', completion_method: 'STORE_CONFIRMED', vendor_id: ids.vendorA });
    expect(noConsole(store.errors)).toEqual([]);
  } finally {
    await store.ctx.close();
  }
});

test('4 績效頁出現該廠商：工單數、完成數（門市確認）、平均天數、採購單確定金額；沒選廠商的工單列「未指定」', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const po = await poRow(ids.po);
  const { ctx, page, errors } = await pageForUser(browser, states.ga_all, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '合作紀錄');
    await expect(vis(page, 'vs-table')).toBeVisible();
    const row = page.locator('[data-testid="vs-row"]:visible', { hasText: st.nameA });
    await expect(row).toHaveCount(1, { timeout: 20_000 });
    await expect(row.getByTestId('vs-wo')).toHaveText('1');
    await expect(row.getByTestId('vs-completed')).toHaveText('1');
    await expect(row.getByTestId('vs-forced')).toHaveText('0');
    await expect(row.getByTestId('vs-unknown')).toHaveText('0');
    await expect(row.getByTestId('vs-avg')).toContainText('天');
    await expect(row.getByTestId('vs-po')).toContainText(money(po.total_amount).replace('NT$ ', 'NT$ '));
    await expect(row.getByTestId('vs-po')).toContainText('1 張');
    // 沒選廠商的工單列「未指定」（至少那一張）
    const unassigned = vis(page, 'vs-unassigned');
    await expect(unassigned).toBeVisible();
    expect(Number((await unassigned.locator('td').nth(1).innerText()).trim())).toBeGreaterThanOrEqual(1);
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  // 資料庫回讀：平均天數約 2 天（受理 2 天前、現在完成）
  const w = await woRow(ids.wo);
  const days = (Date.parse(w.completed_at) - Date.parse(w.accepted_at)) / 86_400_000;
  expect(days).toBeGreaterThan(1.9);
  expect(days).toBeLessThan(2.2);
  const perf = await callFn(users.ga_all.client, 'ga_ws_vendor_perf', {});
  const mine = perf.data.rows.find((r: any) => r.vendor_id === ids.vendorA);
  expect(mine).toMatchObject({ wo_count: 1, completed_count: 1, force_closed_count: 0, unknown_method_count: 0, po_count: 1, insufficient: false });
  expect(Number(mine.avg_days)).toBeCloseTo(Math.round(days * 10) / 10, 1);
});

test('5 廠商停用後：舊工單與舊採購單顯示（已停用）、新單選不到；已下訂的採購單仍可收貨結案；績效頁仍有歷史', async ({ browser }, testInfo) => {
  test.setTimeout(420_000);
  // 停用（用總務自己的身分走伺服端狀態 API；停用時有未結單據只提醒、不擋）
  const v = await vRow(ids.vendorA);
  const off = await apiGa.post(`${N}/vendors/${ids.vendorA}/status`, { data: { status: 'inactive', expected_updated_at: v.updated_at } });
  expect(off.status(), await off.text()).toBe(200);
  expect((await vRow(ids.vendorA)).status).toBe('inactive');
  const { ctx, page, errors } = await pageForUser(browser, states.ga_all, testInfo);
  try {
    await openGaCenter(page);
    // 舊工單：顯示（已停用）
    await nav(page, '工單中心');
    await openWo(page, (await woRow(ids.wo)).title);
    await expect(vis(page, 'wo-vendor')).toContainText('（已停用）');
    // 新單選不到：工單進度下拉（另一張工單）沒有這家廠商
    await openWo(page, (await woRow(ids.woNoVendor)).title);
    await vis(page, 'act-progress').click();
    await expect(dialog(page).getByTestId('f-vendor').locator('option', { hasText: st.nameA }).filter({ hasNotText: '分公司' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    // 舊採購單：詳情顯示（已停用）
    await nav(page, '採購單');
    await vis(page, 'po-search').fill((await poRow(ids.po)).po_no);
    await expect(vis(page, 'po-card')).toHaveCount(1);
    await vis(page, 'open-detail').click();
    await expect(vis(page, 'pd-vendor')).toContainText(st.nameA);
    await expect(vis(page, 'pd-vendor-status')).toHaveText('（已停用）');
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  // 新單：採購單下拉與 API 都不能選（422）
  const bad = await apiGa.post(`${N}/purchase-orders`, { data: { header: { vendor_id: ids.vendorA, notes: m7Name('CH-PO-off') }, items: [{ item_name: m7Name('CH-item3'), unit: '個', quantity: 1, unit_price: 1, fulfil_mode: 'NO_STOCK' }], idempotency_key: crypto.randomUUID() } });
  expect(bad.status(), await bad.text()).toBe(422);
  const opts = await apiGa.get(`${N}/purchase-orders/vendor-options?q=${encodeURIComponent(st.nameA)}`);
  expect(opts.status()).toBe(200);
  expect(JSON.stringify(await opts.json())).not.toContain(ids.vendorA);
  // 已下訂的採購單仍可收貨結案（用總務自己的身分）
  const detail = await apiGa.get(`${N}/purchase-orders/${ids.po}`);
  const po = (await detail.json()).data as any;
  expect(po.status).toBe('ORDERED');
  const item = po.items[0];
  const rc = await apiGa.post(`${N}/purchase-orders/${ids.po}/receipts`, { data: { header: {}, lines: [{ po_item_id: item.id, delivered_qty: Number(item.quantity) }], idempotency_key: crypto.randomUUID() } });
  expect(rc.status(), await rc.text()).toBeLessThan(300);
  expect((await poRow(ids.po)).status).toBe('RECEIVED');
  const fresh = (await (await apiGa.get(`${N}/purchase-orders/${ids.po}`)).json()).data as any;
  const closed = await apiGa.post(`${N}/purchase-orders/${ids.po}/actions`, { data: { action: 'close', expected_updated_at: fresh.updated_at } });
  expect(closed.status(), await closed.text()).toBe(200);
  expect(await poRow(ids.po)).toMatchObject({ status: 'CLOSED', vendor_name_snapshot: st.nameA });
  // 績效頁仍有這家廠商的歷史（標示停用）
  const perf = await callFn(users.ga_all.client, 'ga_ws_vendor_perf', {});
  const mine = perf.data.rows.find((r: any) => r.vendor_id === ids.vendorA);
  expect(mine).toMatchObject({ vendor_status: 'inactive', wo_count: 1, completed_count: 1, po_count: 1 });
});
