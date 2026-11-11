import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiAs } from '../support/auth';
import { apiForUser } from '../support/cv01-fixtures';
import {
  adminDb, assertGaBaseline, cleanupM7M8, m7Name, seedBalance, seedCategory, seedLocation, seedLocationPart, seedPart, seedServiceRequest, seedTransfer, setupM7Users, stores, type M7User,
} from '../support/m7m8-fixtures';
import { noPageOverflow, openGaCenter, pageFor, pageForUser, visibleHeading } from '../support/g01-ui';
import { dialog, invNavTo, openTransferLink, trRow } from '../support/g12-ui';

// M7/M8 第 3 批 G13 調撥單 e2e（桌機 1440 與手機 390 各跑一次，循序）：
//  角色接力劇本：總務（ga_staff）從需求單網址帶入建調撥單（目的位置缺設定被擋 C8，走「前往位置設定」捷徑）→ 確認交出 → 運送中 →
//      店長（手機 390）看自己門市的單、沒有操作按鈕、看不到內部備註，並回報問題 C10 → 總務看到紅標並註記「未收」C9（單子仍待收貨）→ 工務（ga_works，另一個持有總務角色的帳號）收貨 →
//      督導（名單身分）同樣唯讀；每一步用資料庫回讀驗證庫存、流水、處理單同步。
//  異常路線：取消勾退回來源庫存（紅字提醒）、異常終結（損壞）不退回、逾期標紅與篩選與逾期天數設定 C11、別人先處理時的 STALE 提示、連點只處理一次。
//  沒權限做不到：只有查看、只有交易管理、只有調撥管理看得到單但沒有任何操作按鈕並說明缺哪個權限。
//  網址預填：舊網址參數完整保留；無法帶入的欄位列在「未能帶入」。
let users: Record<string, M7User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
let partCat: { id: string };
let staffId = '';
let originalDays = 3;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupM7Users(['roster_supervisor']);
  users = made.users;
  teardownUsers = made.teardown;
  partCat = await seedCategory('part', 'G13E');
  staffId = ((await adminDb().from('profiles').select('id').eq('email', 'vue-workspace-ga-staff@example.test').single()).data as any).id;
  originalDays = Number(((await adminDb().from('ga_inventory_transfer_settings').select('overdue_days').eq('id', true).single()).data as any).overdue_days);
});
test.afterAll(async () => {
  await adminDb().from('ga_inventory_transfer_settings').update({ overdue_days: originalDays }).eq('id', true);
  expect(await cleanupM7M8(), '清除總務測試資料（含調撥與過帳流水）').toEqual([]);
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const real = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const stateOf = async (u: M7User) => {
  const api = await apiForUser(u as any);
  const state = await api.storageState();
  await api.dispose();
  return state;
};
const dbTransfer = async (no: string) => (await adminDb().from('ga_inventory_transfers').select('*').eq('transfer_no', no).single()).data as any;
const dbBal = async (loc: string, part: string) => Number(((await adminDb().from('ga_inventory_balances').select('quantity_base').eq('location_id', loc).eq('part_id', part).maybeSingle()).data as any)?.quantity_base ?? 0);
const dbTx = async (loc: string, part: string) => ((await adminDb().from('ga_inventory_transactions').select('*').eq('location_id', loc).eq('part_id', part).order('created_at')).data || []) as any[];
const statusBadge = (page: any) => dialog(page).locator('.tr-status');
const NOTE_SECRET = '內部備註-由需求單帶入-G13';

async function mk(suffix: string, qty = 30, destCfg = true) {
  const src = await seedLocation(null, `${suffix}-倉`);
  const dest = await seedLocation('ZT01', `${suffix}-店`);
  const part = await seedPart(partCat.id, `${suffix}-料件`, { allow_fractional_issue: false, minimum_issue_qty: 1, allow_unpacking: false });
  await seedLocationPart(src.id, part.id, { safety_stock_qty: 2, reorder_point_qty: 5 });
  if (destCfg) await seedLocationPart(dest.id, part.id);
  if (qty) await seedBalance(src.id, part.id, qty);
  return { src, dest, part };
}
/** 用 API 建單（總務身分），回傳單號、id 與版本；給 UI 之前的前置資料。 */
async function apiCreate(m: { src: any; dest: any; part: any }, reason: string, over: Record<string, unknown> = {}) {
  const api = await apiAs('ga_staff');
  const r = await api.post('/api/workspace/general-affairs/inventory/transfers', { data: { source_location_id: m.src.id, destination_location_id: m.dest.id, part_id: m.part.id, quantity: 5, input_unit_type: 'BASE', reason, idempotency_key: crypto.randomUUID(), ...over } });
  const body = await r.json();
  await api.dispose();
  expect(r.status(), JSON.stringify(body)).toBe(201);
  return { id: body.data.id as string, no: body.data.transfer_no as string, v: body.data.updated_at as string };
}
async function apiAct(who: string, id: string, action: string, expected: string, over: Record<string, unknown> = {}) {
  const api = await apiAs(who);
  const r = await api.post(`/api/workspace/general-affairs/inventory/transfers/${id}/actions`, { data: { action, expected_updated_at: expected, idempotency_key: crypto.randomUUID(), ...over } });
  const body = await r.json();
  await api.dispose();
  return { status: r.status(), body };
}
/** 在調撥單頁開某張單的詳情（用單號搜尋）。 */
async function openDetail(page: any, no: string) {
  const box = page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first();
  await box.fill(no);
  await expect(trRow(page, no)).toHaveCount(1);
  await trRow(page, no).getByTestId('open-detail').click();
  await expect(dialog(page).getByTestId('transfer-detail')).toBeVisible();
}
async function runAction(page: any, action: string, done: string | RegExp, note?: string) {
  const d = dialog(page);
  await d.getByTestId(`act-${action}`).click();
  await expect(d.getByTestId('action-panel')).toBeVisible();
  if (note !== undefined) await d.getByTestId('action-note').fill(note);
  await d.getByTestId('action-submit').click();
  await expect(d.getByTestId('action-done')).toContainText(done);
}

test('角色接力：總務從需求單網址建單（C8 被擋→前往位置設定→補設定）→ 確認交出 → 運送中 → 店長手機查看與回報（C10）→ 總務註記未收（C9）→ 工務收貨 → 督導唯讀；每步 DB 回讀', async ({ browser }, testInfo) => {
  test.setTimeout(900_000);
  const s = await stores();
  const m = await mk('J', 30, false);
  const req = await seedServiceRequest('ZT01', m.part.id, 'J-需求', 'IN_PROGRESS', staffId);
  await adminDb().from('ga_service_requests').update({ desired_quantity: 5, desired_unit: '個' }).eq('id', req.id);
  const reason = m7Name('J-原因');
  const params = { fromRequestId: req.id, requestNo: req.request_no, partId: m.part.id, quantity: '5', sourceLocationId: m.src.id, destinationStoreId: s.ZT01.id, reason, notes: NOTE_SECRET };
  let no = '';

  // ---- 1. 總務：網址帶入，目的位置缺設定被擋，走捷徑
  const staff = await pageFor(browser, 'ga_staff', testInfo);
  try {
    const page = staff.page;
    await openGaCenter(page);
    await openTransferLink(page, params);
    let dlg = dialog(page);
    await expect(dlg.getByTestId('create-request')).toContainText(req.request_no);
    await expect(dlg.getByTestId('picker-picked')).toHaveCount(3); // 來源、目的、料件都由網址帶入
    await expect(dlg.getByTestId('prefill-unresolved')).toHaveCount(0);
    await expect(dlg.getByLabel('調撥數量')).toHaveValue('5');
    await expect(dlg.getByLabel('調撥原因')).toHaveValue(reason);
    await expect(dlg.getByTestId('dest-missing')).toBeVisible();
    await expect(dlg.getByTestId('dest-missing')).toContainText('目的位置還沒有設定這個料件');
    await expect(dlg.getByTestId('create-submit')).toBeDisabled();
    await dlg.getByTestId('goto-locations').click();
    await expect(visibleHeading(page, '庫存位置與料件設定')).toBeVisible();
    expect((await adminDb().from('ga_inventory_transfers').select('id').eq('reason', reason)).data).toEqual([]);
    // 補上目的位置的料件設定（位置設定頁的操作由 G11 驗證，這裡直接補），再用同一個網址建單
    await seedLocationPart(m.dest.id, m.part.id);
    await openTransferLink(page, params);
    dlg = dialog(page);
    await expect(dlg.getByTestId('dest-missing')).toHaveCount(0);
    await expect(dlg.getByTestId('create-submit')).toBeEnabled();
    await dlg.getByTestId('create-submit').click();
    await expect(dlg.getByTestId('create-result')).toBeVisible();
    no = (await dlg.getByTestId('created-no').innerText()).trim();
    expect(no).toMatch(/^GAT-\d{8}-\d{5}$/);
    await dlg.getByRole('button', { name: '關閉' }).click();
    // DB 回讀：單、明細、連結到需求單的處理單與單據；庫存還沒動
    const t = await dbTransfer(no);
    expect(t).toMatchObject({ status: 'REQUESTED', reason, notes: NOTE_SECRET, source_location_id: m.src.id, destination_location_id: m.dest.id, created_by: staffId });
    const items = ((await adminDb().from('ga_inventory_transfer_items').select('*').eq('transfer_id', t.id)).data || []) as any[];
    expect(items).toHaveLength(1);
    expect(Number(items[0].quantity_input)).toBe(5);
    const ful = (await adminDb().from('ga_part_fulfillments').select('*').eq('request_id', req.id).single()).data as any;
    expect(ful.status).toBe('TRANSFER');
    expect((await adminDb().from('ga_part_fulfillment_documents').select('*').eq('fulfillment_id', ful.id)).data).toMatchObject([{ document_id: t.id, status: 'REQUESTED' }]);
    expect(await dbBal(m.src.id, m.part.id)).toBe(30);

    // ---- 2. 確認交出、運送中
    await openGaCenter(page);
    await invNavTo(page, '調撥與收貨');
    await openDetail(page, no);
    await expect(statusBadge(page)).toHaveText('待來源確認交出');
    await expect(dialog(page).getByTestId('d-notes')).toContainText(NOTE_SECRET); // 總務看得到內部備註
    await runAction(page, 'confirm_source', '確認交出完成', '倉庫已交出');
    await expect(statusBadge(page)).toHaveText('來源已交出');
    expect(await dbBal(m.src.id, m.part.id)).toBe(25);
    expect((await dbTx(m.src.id, m.part.id)).map((x) => x.transaction_type)).toEqual(['ISSUE']);
    expect(await dbBal(m.dest.id, m.part.id)).toBe(0);
    await runAction(page, 'ship', '標記運送中完成', '物流取件');
    await expect(statusBadge(page)).toHaveText('運送中 / 待收貨');
    expect((await dbTransfer(no)).notes).toBe(NOTE_SECRET); // 備註不被清空
    expect(((await adminDb().from('ga_part_fulfillments').select('current_step').eq('id', ful.id).single()).data as any).current_step).toBe('調撥運送中');
    await expect(dialog(page).getByTestId('timeline-item')).toHaveCount(3);
    await dialog(page).getByTestId('detail-close').click();
    expect(real(staff.errors)).toEqual([]);
  } finally {
    await staff.ctx.close();
  }

  // ---- 3. 店長（手機 390）：看自己門市的單，沒有操作按鈕、看不到內部備註；回報問題
  const mgr = await pageFor(browser, 'store_manager', testInfo);
  try {
    const page = mgr.page;
    await page.setViewportSize({ width: 390, height: 844 });
    await openGaCenter(page);
    await invNavTo(page, '調撥與收貨');
    await expect(page.getByTestId('open-create')).toHaveCount(0);
    await expect(page.getByTestId('readonly-note').locator('visible=true')).toContainText('唯讀檢視');
    await openDetail(page, no);
    const d = dialog(page);
    await expect(statusBadge(page)).toHaveText('運送中 / 待收貨');
    for (const a of ['confirm_source', 'ship', 'receive', 'cancel', 'mark_unreceived']) await expect(d.getByTestId(`act-${a}`), a).toHaveCount(0);
    await expect(d.getByTestId('act-store_report')).toBeVisible();
    await expect(d).not.toContainText(NOTE_SECRET);
    await expect(d.getByTestId('timeline-item').filter({ hasText: '倉庫已交出' })).toHaveCount(0); // 內部備註遮蔽
    await d.getByTestId('act-store_report').click();
    await d.getByTestId('report-type').selectOption('NOT_ARRIVED');
    await d.getByTestId('action-note').fill('門市還沒看到貨');
    await d.getByTestId('action-submit').click();
    await expect(d.getByTestId('action-done')).toContainText('完成');
    await expect(d.getByTestId('flag-reported')).toBeVisible();
    await expect(d.getByTestId('report-box')).toContainText('還沒收到');
    expect(await noPageOverflow(page)).toBe(true);
    const t = await dbTransfer(no);
    expect(t).toMatchObject({ status: 'IN_TRANSIT', store_report_type: 'NOT_ARRIVED', store_report_note: '門市還沒看到貨' });
    expect(await dbBal(m.dest.id, m.part.id)).toBe(0); // 回報只是標記，不動庫存
    expect(real(mgr.errors)).toEqual([]);
  } finally {
    await mgr.ctx.close();
  }

  // ---- 4. 總務：看到紅標、用卡片篩選、註記未收（單子仍待收貨）
  const staff2 = await pageFor(browser, 'ga_staff', testInfo);
  try {
    const page = staff2.page;
    await openGaCenter(page);
    await invNavTo(page, '調撥與收貨');
    await page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first().fill(reason);
    await expect(trRow(page, no).getByTestId('row-reported')).toBeVisible();
    await expect(page.getByTestId('stat-reported').locator('visible=true')).toHaveText('1');
    await page.getByTestId('card-reported').locator('visible=true').click();
    await expect(trRow(page, no)).toHaveCount(1);
    await page.getByTestId('card-reported').locator('visible=true').click(); // 再點一次取消篩選
    await trRow(page, no).getByTestId('open-detail').click();
    await expect(dialog(page).getByTestId('report-box')).toContainText('門市還沒看到貨');
    await runAction(page, 'mark_unreceived', '註記未收完成', '已電話確認目的門市未收到');
    await expect(dialog(page).getByTestId('flag-unreceived')).toBeVisible();
    await expect(dialog(page).getByTestId('unreceived-box')).toContainText('仍是「待收貨」');
    await expect(statusBadge(page)).toHaveText('運送中 / 待收貨');
    await expect(dialog(page).getByTestId('act-receive')).toBeVisible();
    const t = await dbTransfer(no);
    expect(t).toMatchObject({ status: 'IN_TRANSIT', unreceived_note: '已電話確認目的門市未收到' });
    expect(await dbBal(m.dest.id, m.part.id)).toBe(0);
    expect(await dbBal(m.src.id, m.part.id)).toBe(25);
    expect(real(staff2.errors)).toEqual([]);
  } finally {
    await staff2.ctx.close();
  }

  // ---- 5. 工務（另一個持有總務角色的帳號）收貨
  const works = await pageFor(browser, 'ga_works', testInfo);
  try {
    const page = works.page;
    await openGaCenter(page);
    await invNavTo(page, '調撥與收貨');
    await openDetail(page, no);
    await expect(dialog(page).getByTestId('flag-unreceived')).toBeVisible();
    await runAction(page, 'receive', '確認收貨完成', '門市已點收');
    await expect(statusBadge(page)).toHaveText('已收貨');
    await expect(dialog(page).getByTestId('act-receive')).toHaveCount(0);
    expect(await dbBal(m.dest.id, m.part.id)).toBe(5);
    expect(await dbBal(m.src.id, m.part.id)).toBe(25);
    const t = await dbTransfer(no);
    expect(t.status).toBe('RECEIVED');
    expect(t.received_by).not.toBe(staffId);
    expect((await dbTx(m.dest.id, m.part.id)).map((x) => x.transaction_type)).toEqual(['RECEIPT']);
    const ful = (await adminDb().from('ga_part_fulfillments').select('status,fulfilled_quantity').eq('request_id', req.id).single()).data as any;
    expect(ful.status).toBe('WAITING_STORE_CONFIRMATION'); // 需求量全收，處理單等門市確認
    expect(Number(ful.fulfilled_quantity)).toBe(5);
    await expect(dialog(page).getByTestId('timeline-item')).toHaveCount(6);
    expect(real(works.errors)).toEqual([]);
  } finally {
    await works.ctx.close();
  }

  // ---- 6. 督導（名單身分）唯讀
  const sup = await pageForUser(browser, await stateOf(users.roster_supervisor), testInfo);
  try {
    const page = sup.page;
    await openGaCenter(page);
    await invNavTo(page, '調撥與收貨');
    await expect(page.getByTestId('open-create')).toHaveCount(0);
    await openDetail(page, no);
    const d = dialog(page);
    await expect(statusBadge(page)).toHaveText('已收貨');
    for (const a of ['confirm_source', 'ship', 'receive', 'cancel', 'mark_unreceived', 'store_report']) await expect(d.getByTestId(`act-${a}`), a).toHaveCount(0);
    await expect(d).not.toContainText(NOTE_SECRET);
    await expect(d).not.toContainText('已電話確認目的門市未收到');
    expect(real(sup.errors)).toEqual([]);
  } finally {
    await sup.ctx.close();
  }
});

test('異常路線：取消勾退回來源庫存（紅字提醒）、異常終結（損壞）不退回、別人先處理時 STALE 提示並可重新載入、連點只處理一次', async ({ browser }, testInfo) => {
  test.setTimeout(900_000);
  const m = await mk('X', 30);
  const tag = m7Name('X-原因');
  const a = await apiCreate(m, `${tag}-A`);
  const b = await apiCreate(m, `${tag}-B`);
  const c = await apiCreate(m, `${tag}-C`);
  const d4 = await apiCreate(m, `${tag}-D`);
  for (const t of [a, b]) expect((await apiAct('ga_staff', t.id, 'confirm_source', t.v)).status).toBe(200);
  expect(await dbBal(m.src.id, m.part.id)).toBe(20);
  const { ctx, page, errors } = await pageFor(browser, 'ga_staff', testInfo);
  try {
    await openGaCenter(page);
    await invNavTo(page, '調撥與收貨');
    // (a) 取消＋退回來源庫存：沒勾時有紅字提醒，勾了提醒消失
    await openDetail(page, a.no);
    let d = dialog(page);
    await d.getByTestId('act-cancel').click();
    await expect(d.getByTestId('return-warning')).toBeVisible();
    await expect(d.getByTestId('return-warning')).toContainText('不會回來');
    await d.getByTestId('return-stock').check();
    await expect(d.getByTestId('return-warning')).toHaveCount(0);
    await d.getByTestId('action-submit').click();
    await expect(d.getByTestId('action-error')).toContainText('必須填寫原因'); // 一般取消必須填原因
    await d.getByTestId('action-note').fill('客戶取消');
    await d.getByTestId('action-submit').click();
    await expect(d.getByTestId('action-done')).toContainText('取消調撥完成');
    await expect(statusBadge(page)).toHaveText('已取消');
    await expect(d.getByTestId('detail-item')).toContainText('庫存已退回來源');
    expect(await dbBal(m.src.id, m.part.id)).toBe(25);
    const ta = await dbTransfer(a.no);
    expect(ta).toMatchObject({ status: 'CANCELED', cancel_reason: '客戶取消', exception_type: null });
    expect((await dbTx(m.src.id, m.part.id)).filter((x) => x.metadata?.action === 'return_stock')).toHaveLength(1);
    await d.getByTestId('detail-close').click();
    // (b) 異常終結（損壞）不退回
    await openDetail(page, b.no);
    d = dialog(page);
    await d.getByTestId('act-cancel').click();
    await d.getByTestId('cancel-exception').check();
    await d.getByTestId('exception-type').selectOption('DAMAGED');
    await expect(d.getByTestId('return-warning')).toBeVisible();
    await d.getByTestId('action-note').fill('外箱破損');
    await d.getByTestId('action-submit').click();
    await expect(d.getByTestId('action-done')).toContainText('取消調撥完成');
    await expect(statusBadge(page)).toHaveText('已取消');
    await expect(d.getByTestId('d-cancel')).toContainText('調撥異常：損壞｜外箱破損');
    const tb = await dbTransfer(b.no);
    expect(tb).toMatchObject({ status: 'CANCELED', exception_type: 'DAMAGED' });
    expect(await dbBal(m.src.id, m.part.id)).toBe(25); // 沒退回，維持被扣
    await d.getByTestId('detail-close').click();
    // (c) STALE：這邊打開確認交出的面板，另一個人先處理
    await openDetail(page, c.no);
    d = dialog(page);
    await d.getByTestId('act-confirm_source').click();
    await d.getByTestId('action-note').fill('我也要交出');
    expect((await apiAct('ga_works', c.id, 'confirm_source', c.v)).status).toBe(200);
    await d.getByTestId('action-submit').click();
    await expect(d.getByTestId('stale-box')).toBeVisible();
    await expect(d.getByTestId('action-error')).toContainText('已被其他人處理過');
    await d.getByTestId('reload-detail').click();
    await expect(statusBadge(page)).toHaveText('來源已交出');
    expect(await dbBal(m.src.id, m.part.id)).toBe(20); // 只扣一次
    expect((await dbTx(m.src.id, m.part.id)).filter((x) => x.reference_id === c.id)).toHaveLength(1);
    await d.getByTestId('detail-close').click();
    // (d) 連點：同一個按鈕快速按兩次，只處理一次
    await openDetail(page, d4.no);
    d = dialog(page);
    await d.getByTestId('act-confirm_source').click();
    await d.getByTestId('action-submit').dblclick();
    await expect(d.getByTestId('action-done')).toBeVisible();
    await expect(statusBadge(page)).toHaveText('來源已交出');
    expect((await dbTx(m.src.id, m.part.id)).filter((x) => x.reference_id === d4.id)).toHaveLength(1);
    expect(await dbBal(m.src.id, m.part.id)).toBe(15);
    expect(real(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('C11 逾期：交出超過天數標紅、卡片與篩選、逾期天數設定改了判斷跟著變；已收貨不算逾期', async ({ browser }, testInfo) => {
  test.setTimeout(600_000);
  const m = await mk('O', 0);
  const tag = m7Name('O-原因');
  const day = 86_400_000;
  const make = async (label: string, status: string, ago: number) => {
    const t = await seedTransfer(m.src.id, m.dest.id, m.part.id, `${label}`, status);
    await adminDb().from('ga_inventory_transfers').update({ reason: `${tag}-${label}`, source_confirmed_at: new Date(Date.now() - ago * day).toISOString() }).eq('id', t.id);
    return (await adminDb().from('ga_inventory_transfers').select('transfer_no').eq('id', t.id).single()).data!.transfer_no as string;
  };
  const late = await make('逾期', 'IN_TRANSIT', 5);
  const fresh = await make('新交出', 'SOURCE_CONFIRMED', 2);
  const done = await make('已收', 'RECEIVED', 6);
  await adminDb().from('ga_inventory_transfer_settings').update({ overdue_days: 3 }).eq('id', true);
  const { ctx, page, errors } = await pageFor(browser, 'ga_staff', testInfo);
  try {
    await openGaCenter(page);
    await invNavTo(page, '調撥與收貨');
    await page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first().fill(tag);
    await expect(page.getByTestId('stat-all').locator('visible=true')).toHaveText('3');
    await expect(page.getByTestId('stat-overdue').locator('visible=true')).toHaveText('1');
    await expect(trRow(page, late).getByTestId('row-overdue')).toContainText('逾期 5 天');
    await expect(trRow(page, fresh).getByTestId('row-overdue')).toHaveCount(0);
    await expect(trRow(page, done).getByTestId('row-overdue')).toHaveCount(0);
    await page.getByTestId('card-overdue').locator('visible=true').click();
    await expect(trRow(page)).toHaveCount(1);
    await expect(trRow(page, late)).toHaveCount(1);
    // 設定改成 7 天：沒有逾期；改成 1 天：兩張在途的都逾期
    await page.getByTestId('open-setting').locator('visible=true').click();
    await dialog(page).getByTestId('overdue-days').fill('0');
    await dialog(page).getByTestId('setting-save').click();
    await expect(dialog(page).getByTestId('setting-error')).toContainText('1 到 90');
    await dialog(page).getByTestId('overdue-days').fill('7');
    await dialog(page).getByTestId('setting-save').click();
    await expect(page.getByTestId('tr-notice').locator('visible=true')).toContainText('已改為 7 天');
    await expect(page.getByTestId('stat-overdue').locator('visible=true')).toHaveText('0');
    expect(Number(((await adminDb().from('ga_inventory_transfer_settings').select('overdue_days').eq('id', true).single()).data as any).overdue_days)).toBe(7);
    await page.getByTestId('open-setting').locator('visible=true').click();
    await dialog(page).getByTestId('overdue-days').fill('1');
    await dialog(page).getByTestId('setting-save').click();
    await expect(page.getByTestId('tr-notice').locator('visible=true')).toContainText('已改為 1 天');
    await expect(page.getByTestId('stat-overdue').locator('visible=true')).toHaveText('2');
    await expect(trRow(page, fresh).getByTestId('row-overdue')).toHaveCount(1);
    // 還原
    await page.getByTestId('open-setting').locator('visible=true').click();
    await dialog(page).getByTestId('overdue-days').fill(String(originalDays));
    await dialog(page).getByTestId('setting-save').click();
    await expect(page.getByTestId('tr-notice').locator('visible=true')).toContainText(`已改為 ${originalDays} 天`);
    expect(await noPageOverflow(page)).toBe(true);
    expect(real(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('沒權限做不到：只有查看、只有交易管理、只有調撥管理的帳號看得到單，沒有任何操作按鈕，並說明缺哪個權限；建單與動作 API 403', async ({ browser }, testInfo) => {
  test.setTimeout(600_000);
  const m = await mk('N', 30);
  const t = await apiCreate(m, m7Name('N-原因'));
  for (const [role, missing] of [['navigation', '調撥管理'], ['ga_inv_txn_only', '調撥管理'], ['ga_inv_transfer_only', '庫存交易管理']] as const) {
    const { ctx, page, errors } = await pageFor(browser, role, testInfo);
    try {
      await openGaCenter(page);
      await invNavTo(page, '調撥與收貨');
      await openDetail(page, t.no);
      const d = dialog(page);
      await expect(d.getByTestId('ability-problem'), role).toContainText(missing);
      for (const act of ['confirm_source', 'ship', 'receive', 'cancel', 'mark_unreceived', 'store_report']) await expect(d.getByTestId(`act-${act}`), `${role} ${act}`).toHaveCount(0);
      const r = await page.evaluate(async ([id, v]) => (await fetch(`/api/workspace/general-affairs/inventory/transfers/${id}/actions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm_source', expected_updated_at: v, idempotency_key: window.crypto.randomUUID() }) })).status, [t.id, t.v]);
      expect(r, role).toBe(403);
      expect(real(errors), role).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
  expect((await dbTransfer(t.no)).status).toBe('REQUESTED');
  expect(await dbBal(m.src.id, m.part.id)).toBe(30);
});

test('網址預填：舊網址參數完整保留；無法帶入的欄位列在「未能帶入」，其餘照常帶入', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const s = await stores();
  const m = await mk('P', 12);
  const reason = m7Name('P-原因');
  const { ctx, page, errors } = await pageFor(browser, 'ga_staff', testInfo);
  try {
    await openGaCenter(page);
    // 單位對不上與數量不合法、來源位置不存在、需求單不存在：能帶的帶，不能帶的列出
    await openTransferLink(page, {
      fromRequestId: '00000000-0000-4000-8000-000000000000', requestNo: 'SR-不存在', partId: m.part.id, quantity: 'abc',
      sourceLocationId: '11111111-1111-4111-8111-111111111111', destinationStoreId: s.ZT01.id, reason, notes: '預填備註',
    });
    const dlg = dialog(page);
    const un = dlg.getByTestId('prefill-unresolved');
    await expect(un).toBeVisible();
    await expect(un).toContainText('來源需求單');
    await expect(un).toContainText('數量');
    await expect(un).toContainText('來源位置');
    await expect(un).not.toContainText('料件：');
    await expect(dlg.getByLabel('調撥原因')).toHaveValue(reason);
    await expect(dlg.getByLabel('備註')).toHaveValue('預填備註');
    await expect(dlg.getByLabel('調撥數量')).toHaveValue('');
    await expect(dlg.getByTestId('create-request')).toHaveCount(0); // 需求單帶不進來，就不會連結
    await expect(dlg.getByTestId('picker-picked')).toHaveCount(2); // 料件與目的門市的位置帶進來了
    // 缺數量：送出時欄位提示
    await dlg.getByTestId('create-submit').click();
    expect(await noPageOverflow(page)).toBe(true);
    expect(real(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  expect((await adminDb().from('ga_inventory_transfers').select('id').eq('reason', reason)).data).toEqual([]);
});
