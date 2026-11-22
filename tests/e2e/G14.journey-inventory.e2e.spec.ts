import crypto from 'node:crypto';
import { expect, type Browser, type BrowserContext, type Page, test } from '@playwright/test';
import { apiAs, storageStateFor, TEST_ORIGIN } from '../support/auth';
import {
  adminDb, assertGaBaseline, cleanupM7M8, m7Code, m7Name, rowsWhere, seedCategory, seedLocation, seedLocationPart, seedPart, seedBalance, stores,
} from '../support/m7m8-fixtures';
import { noPageOverflow, openGaCenter, gaNavTo } from '../support/g01-ui';
import { balanceRow, dialog, invNavTo, openTransferLink, pick, trRow, txnRow } from '../support/g12-ui';

// M7/M8 第 3 批 角色接力劇本「庫存調撥」（G14，桌機 project 跑一次；每個角色自己決定視窗：總務桌機 1440、店長手機 390）：
//  劇本 1（主線）：總務（桌機）在庫存位置頁建位置並加入料件設定 → 庫存總覽入庫 → 從網址建調撥單到門市 → 確認交出（扣來源）→ 運送中
//      → 門市店長（手機）看到寄給我的調撥並回報「數量不足」（C10，只標記不動帳）→ 總務處理：
//      甲單由工務（另一個持有總務角色的帳號）收貨；乙單取消並勾「退回來源庫存」（C9 未收只是註記，所以走取消）
//      → 雙方（總務桌機看來源、店長手機看門市）回讀餘額與流水，與資料庫逐筆相符。
//  劇本 2（C11）：真的走到「運送中」再把交出時間往前調，總務看到逾期紅標並用卡片篩選；收貨後紅標消失。
//  劇本 3：店長（手機）不能過帳、不能收貨、看不到內部備註（介面與 API 兩邊都驗）。
const BASE = '/api/workspace/general-affairs';
const NOTE_SECRET = '內部備註-G14-只有總務看得到';
const real = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
let partCat: { id: string };
let originalDays = 3;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  partCat = await seedCategory('part', 'G14E');
  originalDays = Number(((await adminDb().from('ga_inventory_transfer_settings').select('overdue_days').eq('id', true).single()).data as any).overdue_days);
});
test.afterAll(async () => {
  await adminDb().from('ga_inventory_transfer_settings').update({ overdue_days: originalDays }).eq('id', true);
  expect(await cleanupM7M8(), '清除總務測試資料（含調撥與過帳流水）').toEqual([]);
});

type Who = { ctx: BrowserContext; page: Page; errors: string[] };
async function open(browser: Browser, role: string, kind: 'desktop' | 'phone'): Promise<Who> {
  const state = await storageStateFor(role);
  const ctx = await browser.newContext({
    baseURL: TEST_ORIGIN, storageState: state, serviceWorkers: 'block',
    ...(kind === 'phone'
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 } }),
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { ctx, page, errors };
}
const searchBox = (page: Page) => page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first();
const statusBadge = (page: Page) => dialog(page).locator('.tr-status');
const settingRow = (page: Page, text: string) => dialog(page).locator('[data-testid="setting-row"]:visible, li.setting-card:visible', { hasText: text });
const dbTransfer = async (no: string) => (await adminDb().from('ga_inventory_transfers').select('*').eq('transfer_no', no).single()).data as any;
const dbBal = async (loc: string, part: string) => Number(((await adminDb().from('ga_inventory_balances').select('quantity_base').eq('location_id', loc).eq('part_id', part).maybeSingle()).data as any)?.quantity_base ?? 0);
const dbTx = async (loc: string, part: string) => ((await adminDb().from('ga_inventory_transactions').select('*').eq('location_id', loc).eq('part_id', part).order('created_at')).data || []) as any[];

async function openDetail(page: Page, no: string) {
  await searchBox(page).fill(no);
  await expect(trRow(page, no)).toHaveCount(1);
  await trRow(page, no).getByTestId('open-detail').click();
  await expect(dialog(page).getByTestId('transfer-detail')).toBeVisible();
}
async function runAction(page: Page, action: string, done: string | RegExp, note?: string) {
  const d = dialog(page);
  await d.getByTestId(`act-${action}`).click();
  await expect(d.getByTestId('action-panel')).toBeVisible();
  if (note !== undefined) await d.getByTestId('action-note').fill(note);
  await d.getByTestId('action-submit').click();
  await expect(d.getByTestId('action-done')).toContainText(done);
}
/** 從網址帶入建單（來源位置、料件、數量、目的門市），回傳單號。 */
async function createByLink(page: Page, p: { partId: string; src: string; storeId: string; qty: string; reason: string; notes?: string }) {
  await openTransferLink(page, { partId: p.partId, quantity: p.qty, sourceLocationId: p.src, destinationStoreId: p.storeId, reason: p.reason, ...(p.notes ? { notes: p.notes } : {}) });
  const dlg = dialog(page);
  await expect(dlg.getByTestId('dest-missing')).toHaveCount(0);
  await expect(dlg.getByTestId('create-submit')).toBeEnabled();
  await dlg.getByTestId('create-submit').click();
  await expect(dlg.getByTestId('create-result')).toBeVisible();
  const no = (await dlg.getByTestId('created-no').innerText()).trim();
  expect(no).toMatch(/^GAT-\d{8}-\d{5}$/);
  await dlg.getByRole('button', { name: '關閉' }).click();
  return no;
}
async function apiCreate(src: any, dest: any, part: any, reason: string, qty = 3) {
  const api = await apiAs('ga_staff');
  const r = await api.post(`${BASE}/inventory/transfers`, { data: { source_location_id: src.id, destination_location_id: dest.id, part_id: part.id, quantity: qty, input_unit_type: 'BASE', reason, notes: NOTE_SECRET, idempotency_key: crypto.randomUUID() } });
  const body = await r.json();
  await api.dispose();
  expect(r.status(), JSON.stringify(body)).toBe(201);
  return { id: body.data.id as string, no: body.data.transfer_no as string, v: body.data.updated_at as string };
}
async function apiAct(who: string, id: string, action: string, expected: string, over: Record<string, unknown> = {}) {
  const api = await apiAs(who);
  const r = await api.post(`${BASE}/inventory/transfers/${id}/actions`, { data: { action, expected_updated_at: expected, idempotency_key: crypto.randomUUID(), ...over } });
  const body = await r.json();
  await api.dispose();
  return { status: r.status(), body };
}

test('劇本 1：總務建位置與料件設定 → 入庫 → 建調撥交出扣帳 → 店長手機回報數量不足（只標記）→ 工務收貨／總務取消退回來源 → 雙方回讀餘額與流水', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用總務桌機＋店長手機，只在桌機 project 跑一次');
  test.setTimeout(420_000);
  const s = await stores();
  const part = await seedPart(partCat.id, 'J-料件', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  const srcName = m7Name('J-總倉');
  const srcCode = m7Code('j1').toUpperCase();
  const dest = await seedLocation('ZT01', 'J-門市櫃');
  await seedLocationPart(dest.id, part.id); // 目的位置的設定（位置頁操作由 G11 驗證）
  const tag = m7Name('J-原因');
  let srcId = '';
  let noA = '';
  let noB = '';

  // ---- 1. 總務（桌機）：建位置、加入料件設定、入庫
  const ga = await open(browser, 'ga_staff', 'desktop');
  try {
    const page = ga.page;
    await openGaCenter(page);
    await gaNavTo(page, '庫存位置', '庫存管理');
    await expect(page.getByRole('heading', { name: '庫存位置與料件設定', exact: true }).locator('visible=true').first()).toBeVisible();
    await page.getByRole('button', { name: '新增位置' }).locator('visible=true').click();
    await dialog(page).getByLabel('位置類型', { exact: true }).selectOption({ label: '辦公室' });
    await dialog(page).getByLabel('位置名稱', { exact: true }).fill(srcName);
    await dialog(page).getByLabel('位置代碼', { exact: true }).fill(srcCode);
    await dialog(page).getByRole('button', { name: '新增位置' }).click();
    await expect(dialog(page).getByRole('heading', { name: '編輯庫存位置' })).toBeVisible();
    await expect(dialog(page).getByTestId('location-parts')).toBeVisible();
    const loc = (await rowsWhere('ga_inventory_locations', 'name', srcName))[0];
    srcId = loc.id;
    expect(loc).toMatchObject({ code: srcCode, location_type: 'OFFICE', is_active: true });
    await dialog(page).getByRole('button', { name: '加入料件', exact: true }).click();
    await dialog(page).getByLabel('共用安全庫存', { exact: true }).fill('2');
    await dialog(page).getByLabel('共用補貨點', { exact: true }).fill('5');
    await dialog(page).getByLabel('共用偏好領用單位', { exact: true }).selectOption('BASE');
    await dialog(page).getByLabel('加入料件', { exact: true }).fill(part.name);
    const li = dialog(page).getByRole('list', { name: '料件搜尋結果' }).getByRole('listitem').filter({ hasText: part.name });
    await expect(li).toBeVisible();
    await li.getByRole('button', { name: '加入', exact: true }).click();
    await dialog(page).getByRole('button', { name: '加入 1 筆' }).click();
    await expect(settingRow(page, part.name)).toHaveCount(1);
    expect((await rowsWhere('ga_inventory_location_parts', 'part_id', part.id)).find((x) => x.location_id === srcId)).toMatchObject({ safety_stock_qty: 2, reorder_point_qty: 5, is_active: true });
    await dialog(page).getByRole('button', { name: '取消', exact: true }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    // 入庫 20
    await invNavTo(page, '庫存總覽');
    await page.getByTestId('open-post').locator('visible=true').click();
    await pick(dialog(page), /^庫存位置 \*$/, '庫存位置選項', srcName, srcName);
    await pick(dialog(page), /^料件 \*$/, '料件選項', part.name, part.name);
    await dialog(page).getByLabel('數量', { exact: true }).fill('20');
    await dialog(page).getByLabel('原因', { exact: true }).fill(`${tag} 入庫`);
    await dialog(page).getByTestId('post-submit').click();
    await expect(dialog(page).getByTestId('post-result-line')).toContainText('庫存 0 → 20');
    await dialog(page).getByRole('button', { name: '關閉' }).click();
    expect(await dbBal(srcId, part.id)).toBe(20);
    expect((await dbTx(srcId, part.id)).map((x) => x.transaction_type)).toEqual(['RECEIPT']);

    // 建兩張調撥單（甲 5 個、乙 4 個）到 ZT01
    noA = await createByLink(page, { partId: part.id, src: srcId, storeId: s.ZT01.id, qty: '5', reason: `${tag}-甲`, notes: NOTE_SECRET });
    noB = await createByLink(page, { partId: part.id, src: srcId, storeId: s.ZT01.id, qty: '4', reason: `${tag}-乙`, notes: NOTE_SECRET });
    expect(await dbBal(srcId, part.id)).toBe(20); // 建單不動庫存
    // 確認交出（扣來源）→ 運送中
    await openGaCenter(page);
    await invNavTo(page, '調撥與收貨');
    for (const [no, qty, left] of [[noA, 5, 15], [noB, 4, 11]] as const) {
      await openDetail(page, no);
      await expect(statusBadge(page)).toHaveText('待來源確認交出');
      await runAction(page, 'confirm_source', '確認交出完成', '總倉已交出');
      expect(await dbBal(srcId, part.id), `${no} 交出後`).toBe(left);
      expect(await dbBal(dest.id, part.id)).toBe(0);
      await runAction(page, 'ship', '標記運送中完成', '物流取件');
      await expect(statusBadge(page)).toHaveText('運送中 / 待收貨');
      expect(await dbTransfer(no)).toMatchObject({ status: 'IN_TRANSIT' });
      expect(qty).toBeGreaterThan(0);
      await dialog(page).getByTestId('detail-close').click();
    }
    expect(real(ga.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
  }

  // ---- 2. 店長（手機 390）：看到寄給我的兩張調撥，回報乙單「數量不足」（只標記，不動帳）
  const mgr = await open(browser, 'store_manager', 'phone');
  try {
    const page = mgr.page;
    await openGaCenter(page);
    await invNavTo(page, '調撥與收貨');
    await expect(page.getByTestId('open-create')).toHaveCount(0);
    await searchBox(page).fill(tag);
    await expect(trRow(page)).toHaveCount(2);
    await expect(trRow(page, noA)).toHaveCount(1);
    await openDetail(page, noB);
    const d = dialog(page);
    await expect(d).not.toContainText(NOTE_SECRET);
    for (const a of ['confirm_source', 'ship', 'receive', 'cancel', 'mark_unreceived']) await expect(d.getByTestId(`act-${a}`), a).toHaveCount(0);
    await d.getByTestId('act-store_report').click();
    await d.getByTestId('report-type').selectOption('SHORT_QUANTITY');
    await d.getByTestId('action-note').fill('只看到 2 個');
    await d.getByTestId('action-submit').click();
    await expect(d.getByTestId('action-done')).toContainText('完成');
    await expect(d.getByTestId('flag-reported')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(await dbTransfer(noB)).toMatchObject({ status: 'IN_TRANSIT', store_report_type: 'SHORT_QUANTITY', store_report_note: '只看到 2 個' });
    expect(await dbBal(dest.id, part.id)).toBe(0); // 回報只是標記
    expect(await dbBal(srcId, part.id)).toBe(11);
    expect(real(mgr.errors)).toEqual([]);
  } finally {
    await mgr.ctx.close();
  }

  // ---- 3. 總務處理乙單：看到回報，取消並勾退回來源庫存
  const ga2 = await open(browser, 'ga_staff', 'desktop');
  try {
    const page = ga2.page;
    await openGaCenter(page);
    await invNavTo(page, '調撥與收貨');
    await openDetail(page, noB);
    await expect(dialog(page).getByTestId('report-box')).toContainText('只看到 2 個');
    const d = dialog(page);
    await d.getByTestId('act-cancel').click();
    await expect(d.getByTestId('return-warning')).toBeVisible();
    await d.getByTestId('return-stock').check();
    await d.getByTestId('action-note').fill('門市回報數量不足，退回總倉清點');
    await d.getByTestId('action-submit').click();
    await expect(d.getByTestId('action-done')).toContainText('取消調撥完成');
    await expect(statusBadge(page)).toHaveText('已取消');
    expect(await dbTransfer(noB)).toMatchObject({ status: 'CANCELED' });
    expect(await dbBal(srcId, part.id)).toBe(15); // 11 + 4 退回
    expect(await dbBal(dest.id, part.id)).toBe(0);
    expect(real(ga2.errors)).toEqual([]);
  } finally {
    await ga2.ctx.close();
  }

  // ---- 4. 工務（另一個持有總務角色的帳號）收貨甲單
  const works = await open(browser, 'ga_works', 'desktop');
  try {
    const page = works.page;
    await openGaCenter(page);
    await invNavTo(page, '調撥與收貨');
    await openDetail(page, noA);
    await runAction(page, 'receive', '確認收貨完成', '門市已點收');
    await expect(statusBadge(page)).toHaveText('已收貨');
    const t = await dbTransfer(noA);
    expect(t.status).toBe('RECEIVED');
    expect(await dbBal(dest.id, part.id)).toBe(5);
    expect(await dbBal(srcId, part.id)).toBe(15);
    expect(real(works.errors)).toEqual([]);
  } finally {
    await works.ctx.close();
  }

  // ---- 5. 雙方回讀：總務（桌機）看來源，店長（手機）看門市；畫面與資料庫逐筆相符
  const srcTx = await dbTx(srcId, part.id);
  expect(srcTx.map((x) => x.transaction_type)).toHaveLength(4); // 入庫、交出甲、交出乙、乙退回
  expect(srcTx.map((x) => x.transaction_type).sort()).toEqual(['ISSUE', 'ISSUE', 'RECEIPT', 'RECEIPT']);
  expect(srcTx.filter((x) => x.metadata?.action === 'return_stock')).toHaveLength(1);
  const last = srcTx[srcTx.length - 1];
  expect(Number(last.balance_after)).toBe(15);
  const destTx = await dbTx(dest.id, part.id);
  expect(destTx.map((x) => x.transaction_type)).toEqual(['RECEIPT']);
  expect(Number(destTx[0].balance_after)).toBe(5);

  const ga3 = await open(browser, 'ga_staff', 'desktop');
  try {
    const page = ga3.page;
    await openGaCenter(page);
    await invNavTo(page, '庫存總覽');
    await searchBox(page).fill(part.name);
    await expect(balanceRow(page, srcName)).toHaveCount(1);
    await expect(balanceRow(page, srcName)).toContainText('15');
    await expect(balanceRow(page, dest.name)).toContainText('5');
    await page.getByTestId('tab-transactions').locator('visible=true').click();
    await page.getByLabel('原因關鍵字').locator('visible=true').first().fill(tag);
    await expect(txnRow(page)).toHaveCount(1); // 手動入庫那一筆有帶原因關鍵字
    expect(real(ga3.errors)).toEqual([]);
  } finally {
    await ga3.ctx.close();
  }
  const mgr2 = await open(browser, 'store_manager', 'phone');
  try {
    const page = mgr2.page;
    await openGaCenter(page);
    await invNavTo(page, '庫存總覽');
    await searchBox(page).fill(part.name);
    await expect(balanceRow(page, dest.name)).toHaveCount(1);
    await expect(balanceRow(page, dest.name)).toContainText('5');
    await expect(page.getByTestId('open-post')).toHaveCount(0);
    await page.getByTestId('tab-transactions').locator('visible=true').click();
    await expect(txnRow(page).first()).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(real(mgr2.errors)).toEqual([]);
  } finally {
    await mgr2.ctx.close();
  }
});

test('劇本 2（C11）：運送中超過天數標紅並可用卡片篩選；收貨後紅標消失', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用總務桌機，只在桌機 project 跑一次');
  test.setTimeout(600_000);
  const src = await seedLocation(null, 'K-倉');
  const dest = await seedLocation('ZT01', 'K-店');
  const part = await seedPart(partCat.id, 'K-料件', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  await seedLocationPart(src.id, part.id);
  await seedLocationPart(dest.id, part.id);
  await seedBalance(src.id, part.id, 20);
  await adminDb().from('ga_inventory_transfer_settings').update({ overdue_days: 3 }).eq('id', true);
  const tag = m7Name('K-原因');
  // 真的走到運送中（交出扣帳），再把交出時間往前調
  const late = await apiCreate(src, dest, part, `${tag}-逾期`, 3);
  const fresh = await apiCreate(src, dest, part, `${tag}-新`, 2);
  let v = late.v;
  const c1 = await apiAct('ga_staff', late.id, 'confirm_source', v);
  expect(c1.status).toBe(200);
  const s1 = await apiAct('ga_staff', late.id, 'ship', c1.body.data.updated_at);
  expect(s1.status).toBe(200);
  const c2 = await apiAct('ga_staff', fresh.id, 'confirm_source', fresh.v);
  expect(c2.status).toBe(200);
  const s2 = await apiAct('ga_staff', fresh.id, 'ship', c2.body.data.updated_at);
  expect(s2.status).toBe(200);
  await adminDb().from('ga_inventory_transfers').update({ source_confirmed_at: new Date(Date.now() - 5 * 86_400_000).toISOString() }).eq('id', late.id);
  v = '';
  expect(await dbBal(src.id, part.id)).toBe(15);

  const ga = await open(browser, 'ga_staff', 'desktop');
  try {
    const page = ga.page;
    await openGaCenter(page);
    await invNavTo(page, '調撥與收貨');
    await searchBox(page).fill(tag);
    await expect(page.getByTestId('stat-all').locator('visible=true')).toHaveText('2');
    await expect(page.getByTestId('stat-overdue').locator('visible=true')).toHaveText('1');
    await expect(trRow(page, late.no).getByTestId('row-overdue')).toContainText('逾期 5 天');
    await expect(trRow(page, fresh.no).getByTestId('row-overdue')).toHaveCount(0);
    await page.getByTestId('card-overdue').locator('visible=true').click();
    await expect(trRow(page)).toHaveCount(1);
    await expect(trRow(page, late.no)).toHaveCount(1);
    await page.getByTestId('card-overdue').locator('visible=true').click();
    // 收貨後不再逾期
    await openDetail(page, late.no);
    await runAction(page, 'receive', '確認收貨完成', '遲到但已收');
    await expect(statusBadge(page)).toHaveText('已收貨');
    expect(await dbTransfer(late.no)).toMatchObject({ status: 'RECEIVED' });
    await dialog(page).getByTestId('detail-close').click();
    await expect(page.getByTestId('stat-overdue').locator('visible=true')).toHaveText('0');
    await expect(trRow(page, late.no).getByTestId('row-overdue')).toHaveCount(0);
    expect(await dbBal(dest.id, part.id)).toBe(3);
    expect(await noPageOverflow(page)).toBe(true);
    expect(real(ga.errors)).toEqual([]);
  } finally {
    await ga.ctx.close();
  }
});

test('劇本 3：店長（手機）不能過帳、不能收貨、看不到內部備註；介面與 API 兩邊都擋', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用店長手機，只在桌機 project 跑一次');
  test.setTimeout(600_000);
  const src = await seedLocation(null, 'N-倉');
  const dest = await seedLocation('ZT01', 'N-店');
  const part = await seedPart(partCat.id, 'N-料件', { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  await seedLocationPart(src.id, part.id);
  await seedLocationPart(dest.id, part.id);
  await seedBalance(src.id, part.id, 10);
  const t = await apiCreate(src, dest, part, m7Name('N-原因'), 2);
  const c = await apiAct('ga_staff', t.id, 'confirm_source', t.v);
  const sh = await apiAct('ga_staff', t.id, 'ship', c.body.data.updated_at);
  expect(sh.status).toBe(200);
  const cur = (await dbTransfer(t.no)).updated_at as string;

  const mgr = await open(browser, 'store_manager', 'phone');
  try {
    const page = mgr.page;
    await openGaCenter(page);
    await invNavTo(page, '庫存總覽');
    await expect(page.getByTestId('open-post')).toHaveCount(0); // 不能過帳（介面）
    await invNavTo(page, '調撥與收貨');
    await openDetail(page, t.no);
    const d = dialog(page);
    await expect(d.getByTestId('act-receive')).toHaveCount(0); // 不能收貨（介面）
    await expect(d).not.toContainText(NOTE_SECRET); // 看不到內部備註（介面）
    expect(await noPageOverflow(page)).toBe(true);
    // API：同一個登入身分直接打
    const status = (url: string, body: unknown) => page.evaluate(async ([u, b]) => (await fetch(u as string, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).status, [url, body]);
    expect(await status(`${BASE}/inventory/transactions/post`, { transaction_type: 'RECEIPT', location_id: dest.id, part_id: part.id, quantity: 1, input_unit_type: 'BASE', reason: 'G14 不該成功', idempotency_key: crypto.randomUUID() })).toBe(403);
    expect(await status(`${BASE}/inventory/transfers/${t.id}/actions`, { action: 'receive', expected_updated_at: cur, idempotency_key: crypto.randomUUID() })).toBe(403);
    const detail = await page.evaluate(async (u) => (await fetch(u)).json(), `${BASE}/inventory/transfers/${t.id}`);
    expect(detail.data.notes).toBeNull();
    expect(JSON.stringify(detail)).not.toContain(NOTE_SECRET);
    expect(real(mgr.errors)).toEqual([]);
  } finally {
    await mgr.ctx.close();
  }
  expect((await dbTransfer(t.no)).status).toBe('IN_TRANSIT');
  expect(await dbBal(dest.id, part.id)).toBe(0);
  expect(await dbBal(src.id, part.id)).toBe(8);
  expect((await dbTx(dest.id, part.id))).toEqual([]);
});
