import { expect, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { expandGroup, gaNavToIn, noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, visibleHeading } from '../support/g01-ui';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, stores } from '../support/m7m8-fixtures';
import { ga6Name, setupGa6Users, type Ga6User } from '../support/m7m8-ga6-fixtures';
import { M7_FILE_PREFIX } from '../support/m7m8-fixtures';
import { makePng } from '../support/png';
import { shiftMonth, taipeiToday } from '../../lib/workspace/general-affairs/utility-bill-rules';

// M7/M8 第 6 批 G23.journey-utility-bill（角色接力劇本）：總務登錄水電帳單 → 金額異常提醒（多打一個零，顯示基準金額與明細，仍可儲存）→ 更正（編輯留修改者）
// → 到期日已過未繳，列表與摘要出現逾期 → 標記已繳（選日期；未來日與過早日被擋）→ 改回待繳（顯示原日期並確認）→ 已繳帳單改金額（二次確認並顯示原值）
// → 刪除（必填原因；已繳帳單多一道確認）→「顯示已刪除」檢視看得到誰、何時、為何刪；重複帳單訊息指出既有那一筆並可直接開啟；水電檢視者全程唯讀。
// 最後一個測試是 G24 補上的首頁「待我處理」與導覽徽章（逾期帳單）斷言：登錄逾期帳單後出現、點徽章只看逾期且筆數相同、標記已繳後即時減少。
// 每步用 service role 回讀資料庫。測試資料帶 QA-GA6- 標記、只用 VW 測試門市；結束只清自己的。
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });

const GROUP = '水電電話網路費';
const today = taipeiToday();
const PAST = shiftMonth(`${today.slice(0, 7)}-01`, -3).slice(0, 7);
const dayOffset = (n: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
let users: Record<string, Ga6User> = {};
let teardown: () => Promise<string[]> = async () => [];
let state: any;
let stateView: any;
let st: Awaited<ReturnType<typeof stores>>;
const db = () => adminDb();
const noConsole = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const vis = (page: Page, testid: string) => page.getByTestId(testid).locator('visible=true');
const key = (s: string) => `QA-GA6-JNY-${s}`;
const provider = ga6Name('JNY');
const rowBy = async (ident: string) => (await db().from('ga_utility_bills').select('*').eq('service_identifier', ident).maybeSingle()).data as any;
const countOverdueDb = async () => ((await db().from('ga_utility_bills').select('id').is('deleted_at', null).is('paid_at', null).lt('due_date', today)).data || []).length;

async function openList(page: Page, ident: string) {
  await openGaCenter(page);
  await gaNavToIn(page, GROUP, '帳單列表');
  await expect(visibleHeading(page, '水電電話網路費')).toBeVisible();
  await vis(page, 'filter-month').fill('');
  await vis(page, 'bill-search').fill(ident);
  await expect(vis(page, 'bill-total')).toBeVisible();
}
async function fillForm(page: Page, f: { ident: string; month: string; amount: string; due?: string; store?: string }) {
  await vis(page, 'new-bill').click();
  await expect(page.getByTestId('utility-form')).toBeVisible();
  await page.getByTestId('uf-store').selectOption(f.store || st.VW001.id);
  await page.getByTestId('uf-type').selectOption('WATER');
  await page.getByTestId('uf-month').fill(f.month);
  await page.getByTestId('uf-provider').fill(provider);
  await page.getByTestId('uf-ident').fill(f.ident);
  await page.getByTestId('uf-amount').fill(f.amount);
  await page.getByTestId('uf-period-start').fill('2038-01-01');
  await page.getByTestId('uf-period-end').fill('2038-01-31');
  if (f.due) await page.getByTestId('uf-due').fill(f.due);
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  st = await stores();
  const made = await setupGa6Users(['util_mgr', 'util_view']);
  users = made.users;
  teardown = made.teardown;
  state = await (await apiForUser(users.util_mgr as any)).storageState();
  stateView = await (await apiForUser(users.util_view as any)).storageState();
  // 前三個月的帳單（異常基準用）：同據點、水費、同一個水號
  for (const [m, a] of [['2038-02', 1200], ['2038-03', 1300], ['2038-04', 1100]] as const) {
    const r = await callFn(users.util_mgr.client, 'ga_ws_ub_save', { p_id: null, p_payload: { store_id: st.VW001.id, service_period_start: '2038-01-01', service_period_end: '2038-01-31', expense_type: 'WATER', billing_month: m, provider_name: provider, service_identifier: key('A'), amount: a }, p_expected_updated_at: null, p_confirm_paid_change: false });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
});
test.afterAll(async () => {
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('登錄帳單、金額異常提醒（仍可儲存）、更正並留修改者、重複帳單訊息', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, state, testInfo);
  try {
    await openList(page, key('A'));
    await expect(vis(page, 'bill-total')).toHaveText('共 3 筆');
    // 新增 2038-05，金額多打一個零（12000）：先跳異常提醒，顯示基準金額（近三筆平均 1,200）與三筆明細
    await fillForm(page, { ident: key('A'), month: '2038-05', amount: '12000', due: '2038-06-20' });
    await vis(page, 'uf-save').click();
    await expect(vis(page, 'uf-anomaly')).toBeVisible();
    await expect(vis(page, 'uf-anomaly-baseline')).toContainText('1,200');
    await expect(vis(page, 'uf-anomaly-samples').locator('li')).toHaveCount(3);
    await expect(vis(page, 'uf-anomaly-message')).toContainText('2 倍');
    expect((await db().from('ga_utility_bills').select('id', { count: 'exact', head: true }).eq('service_identifier', key('A'))).count).toBe(3);
    expect(await noPageOverflow(page)).toBe(true);
    // 返回修改，再原樣按「金額沒錯，仍要儲存」
    await vis(page, 'uf-back').click();
    await expect(vis(page, 'uf-anomaly')).toHaveCount(0);
    await vis(page, 'uf-save').click();
    await vis(page, 'uf-save-anyway').click();
    await expect(vis(page, 'bill-saved')).toBeVisible();
    await expect(vis(page, 'bill-saved-anomaly')).toContainText('1,200');
    await expect(page.getByTestId('bill-detail')).toBeVisible();
    const may = (await db().from('ga_utility_bills').select('*').eq('service_identifier', key('A')).eq('billing_month', '2038-05-01').single()).data as any;
    expect(Number(may.amount)).toBe(12000);
    expect(may.created_by).toBe(users.util_mgr.id);
    // 更正：編輯把金額改成 1250（不再提醒），最後修改者留下
    await vis(page, 'bd-edit').click();
    await expect(page.getByTestId('utility-form')).toBeVisible();
    await page.getByTestId('uf-amount').fill('1250');
    await vis(page, 'uf-save').click();
    await expect(vis(page, 'bill-saved')).toBeVisible();
    await expect(vis(page, 'bill-saved-anomaly')).toHaveCount(0);
    const fixed = (await db().from('ga_utility_bills').select('*').eq('id', may.id).single()).data as any;
    expect(Number(fixed.amount)).toBe(1250);
    expect(fixed.updated_by).toBe(users.util_mgr.id);
    await expect(vis(page, 'bd-updated-by')).toContainText('M7M8 GA6 util_mgr');
    await vis(page, 'bd-close').click();
    // 重複帳單：同一個據點、類型、月份、供應商、水號再新增一次 -> 白話訊息指出既有那一筆，可直接開啟
    await fillForm(page, { ident: key('A'), month: '2038-05', amount: '999' });
    await vis(page, 'uf-save').click();
    await expect(vis(page, 'uf-error')).toContainText('已經有一筆帳單');
    await expect(vis(page, 'uf-error')).toContainText('1,250');
    await expect(vis(page, 'uf-existing')).toBeVisible();
    await vis(page, 'uf-open-existing').click();
    await expect(page.getByTestId('bill-detail')).toBeVisible();
    await expect(vis(page, 'bd-amount')).toContainText('1,250');
    expect((await db().from('ga_utility_bills').select('id', { count: 'exact', head: true }).eq('service_identifier', key('A'))).count).toBe(4);
    await vis(page, 'bd-close').click();
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('到期日已過未繳→逾期；標記已繳（未來日與過早日被擋、選日期）→改回待繳（顯示原日期並確認）→已繳改金額二次確認', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, state, testInfo);
  try {
    const overdueBefore = await countOverdueDb();
    await openList(page, key('B'));
    await fillForm(page, { ident: key('B'), month: PAST, amount: '3000', due: dayOffset(-3) });
    await vis(page, 'uf-save').click();
    await expect(page.getByTestId('bill-detail')).toBeVisible();
    await expect(vis(page, 'bd-status')).toHaveText('已逾期');
    const b = await rowBy(key('B'));
    expect(b.paid_at).toBeNull();
    expect(await countOverdueDb()).toBe(overdueBefore + 1);
    // 摘要的逾期筆數與資料庫一致（待繳與逾期不受月份篩選影響）
    await vis(page, 'bd-close').click();
    await vis(page, 'bill-search').fill('');
    await expect(vis(page, 'stat-overdue')).toHaveText(`${overdueBefore + 1} 筆`);
    await vis(page, 'card-overdue').click();
    await expect(vis(page, 'bill-total')).toHaveText(`共 ${overdueBefore + 1} 筆`);
    await vis(page, 'card-overdue').click(); // 取消篩選
    await vis(page, 'bill-search').fill(key('B'));
    await expect(page.locator('[data-testid="bill-card"]:visible')).toHaveCount(1);
    await page.locator('[data-testid="bill-card"]:visible').first().getByTestId('open-bill').click();
    // 標記已繳：未來日期被擋
    await vis(page, 'bd-pay').click();
    await expect(vis(page, 'bd-pay-date')).toHaveValue(today);
    await vis(page, 'bd-pay-date').fill(dayOffset(5));
    await vis(page, 'bd-pay-ok').click();
    await expect(vis(page, 'bd-error')).toContainText('未來');
    expect((await rowBy(key('B'))).paid_at).toBeNull();
    // 過早（帳單月份前 1 個月之前）被擋
    await vis(page, 'bd-pay-date').fill(`${shiftMonth(`${PAST}-01`, -2)}`);
    await vis(page, 'bd-pay-ok').click();
    await expect(vis(page, 'bd-error')).toContainText('不能早於');
    expect((await rowBy(key('B'))).paid_at).toBeNull();
    // 選一個合法的日期（帳單月份前 1 個月的 1 日）
    const chosen = shiftMonth(`${PAST}-01`, -1);
    await vis(page, 'bd-pay-date').fill(chosen);
    await vis(page, 'bd-pay-ok').click();
    await expect(vis(page, 'bd-notice')).toContainText('已標記為已繳');
    await expect(vis(page, 'bd-status')).toHaveText('已繳費');
    expect((await rowBy(key('B'))).paid_at).toBe(chosen);
    expect(await countOverdueDb()).toBe(overdueBefore);
    // 改回待繳：顯示原日期並確認
    await vis(page, 'bd-unpay').click();
    await expect(vis(page, 'bd-unpay-date')).toHaveText(chosen);
    expect((await rowBy(key('B'))).paid_at).toBe(chosen);
    await vis(page, 'bd-unpay-ok').click();
    await expect(vis(page, 'bd-notice')).toContainText('已改回待繳');
    expect((await rowBy(key('B'))).paid_at).toBeNull();
    expect(await countOverdueDb()).toBe(overdueBefore + 1);
    // 再標記已繳（預設今天），然後改金額：二次確認並顯示原值
    await vis(page, 'bd-pay').click();
    await vis(page, 'bd-pay-ok').click();
    await expect(vis(page, 'bd-status')).toHaveText('已繳費');
    expect((await rowBy(key('B'))).paid_at).toBe(today);
    await vis(page, 'bd-edit').click();
    await expect(vis(page, 'uf-paid-note')).toBeVisible();
    await page.getByTestId('uf-amount').fill('3300');
    await vis(page, 'uf-save').click();
    await expect(vis(page, 'uf-paid-confirm')).toBeVisible();
    await expect(vis(page, 'uf-orig-amount')).toContainText('3,000');
    expect(Number((await rowBy(key('B'))).amount)).toBe(3000);
    await vis(page, 'uf-paid-confirm-cancel').click();
    await expect(vis(page, 'uf-paid-confirm')).toHaveCount(0);
    await vis(page, 'uf-save').click();
    await vis(page, 'uf-paid-confirm-ok').click();
    await expect(vis(page, 'bill-saved')).toBeVisible();
    await expect.poll(async () => Number((await rowBy(key('B'))).amount), { timeout: 15_000 }).toBe(3300);
    const after = await rowBy(key('B'));
    expect(after.paid_at).toBe(today);
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('刪除必填原因（已繳帳單多一道確認）、軟刪除、顯示已刪除檢視看得到誰、何時、為何；水電檢視者全程唯讀', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, state, testInfo);
  try {
    await openList(page, key('B'));
    await expect(page.locator('[data-testid="bill-card"]:visible')).toHaveCount(1);
    await page.locator('[data-testid="bill-card"]:visible').first().getByTestId('open-bill').click();
    await vis(page, 'bd-delete').click();
    await expect(vis(page, 'bd-delete-orig')).toContainText('3,300');
    await vis(page, 'bd-delete-ok').click();
    await expect(vis(page, 'bd-error')).toContainText('刪除原因');
    await vis(page, 'bd-delete-reason').fill('重複登錄，已用另一張補收單');
    await vis(page, 'bd-delete-ok').click();
    await expect(vis(page, 'bd-error')).toContainText('勾選確認');
    expect((await rowBy(key('B'))).deleted_at).toBeNull();
    await vis(page, 'bd-delete-confirm-paid').check();
    await vis(page, 'bd-delete-ok').click();
    await expect(vis(page, 'bd-notice')).toContainText('已刪除');
    const gone = await rowBy(key('B'));
    expect(gone.deleted_at).toBeTruthy();
    expect(gone.deleted_by).toBe(users.util_mgr.id);
    expect(gone.deletion_reason).toBe('重複登錄，已用另一張補收單');
    await expect(vis(page, 'bd-deleted-info')).toContainText('M7M8 GA6 util_mgr');
    await expect(vis(page, 'bd-deleted-info')).toContainText('重複登錄，已用另一張補收單');
    await vis(page, 'bd-close').click();
    // 預設列表看不到；顯示已刪除檢視看得到（唯讀）
    await expect(page.locator('[data-testid="bill-card"]:visible')).toHaveCount(0);
    await vis(page, 'show-deleted').check();
    await expect(vis(page, 'deleted-view-note')).toBeVisible();
    // 已刪除的帳單不可計入「篩選結果合計」
    await expect(vis(page, 'stat-filtered')).toHaveText(/NT\$\s*0/);
    await expect(vis(page, 'stat-filtered-count')).not.toContainText('待繳');
    await expect(page.locator('[data-testid="bill-card"]:visible')).toHaveCount(1);
    await expect(vis(page, 'bill-deleted-line')).toContainText('重複登錄');
    await page.locator('[data-testid="bill-card"]:visible').first().getByTestId('open-bill').click();
    for (const t of ['bd-edit', 'bd-pay', 'bd-unpay', 'bd-delete']) await expect(page.getByTestId(t)).toHaveCount(0);
    await vis(page, 'bd-close').click();
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
  // 水電檢視者：看得到帳單與已刪除檢視，沒有任何寫入入口
  const v = await pageForUser(browser, stateView, testInfo);
  try {
    await openList(v.page, key('A'));
    await expect(v.page.locator('[data-testid="bill-card"]:visible')).toHaveCount(4);
    await expect(v.page.getByTestId('new-bill')).toHaveCount(0);
    await v.page.locator('[data-testid="bill-card"]:visible').first().getByTestId('open-bill').click();
    for (const t of ['bd-edit', 'bd-pay', 'bd-unpay', 'bd-delete']) await expect(v.page.getByTestId(t)).toHaveCount(0);
    expect(noConsole(v.errors)).toEqual([]);
  } finally {
    await v.ctx.close();
  }
});

test('帳單附件：在詳情上傳掃描檔（照片）、清單看得到、刪除必填原因且只標記刪除、原檔保留；水電檢視者看得到附件但不能上傳或刪除', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, state, testInfo);
  const fileName = `${M7_FILE_PREFIX}bill.png`;
  try {
    await openList(page, key('A'));
    await page.locator('[data-testid="bill-card"]:visible').first().getByTestId('open-bill').click();
    const panel = page.locator('.attachment-panel:visible').first();
    await expect(panel).toContainText('目前沒有附件');
    await panel.getByTestId('upload-input').setInputFiles({ name: fileName, mimeType: 'image/png', buffer: makePng({ width: 120, height: 80, inkPixels: 20 }) });
    await panel.getByRole('button', { name: /上傳 1 個檔案/ }).click();
    await expect(panel.locator('.notice.success')).toContainText('已上傳 1 個檔案');
    await expect(panel.locator('.attachment-grid li')).toHaveCount(1);
    const rows = ((await db().from('ga_resource_attachments').select('*').eq('resource_type', 'UTILITY_BILL').eq('file_name', fileName)).data || []) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: 'BILL_DOCUMENT', uploaded_by: users.util_mgr.id, deleted_at: null });
    // 水電檢視者：看得到附件、沒有上傳與刪除
    const v = await pageForUser(browser, stateView, testInfo);
    try {
      await openList(v.page, key('A'));
      await v.page.locator('[data-testid="bill-card"]:visible').first().getByTestId('open-bill').click();
      const vp = v.page.locator('.attachment-panel:visible').first();
      await expect(vp.locator('.attachment-grid li')).toHaveCount(1);
      await expect(vp.getByTestId('upload-input')).toHaveCount(0);
      await expect(vp.getByRole('button', { name: new RegExp('^刪除 ') })).toHaveCount(0);
      expect(noConsole(v.errors)).toEqual([]);
    } finally {
      await v.ctx.close();
    }
    // 刪除：必填原因，只標記刪除，原檔保留
    await panel.getByRole('button', { name: new RegExp('^刪除 ' + M7_FILE_PREFIX) }).click();
    const del = page.locator('dialog[open]').last();
    await del.getByRole('button', { name: '確認刪除' }).click();
    await expect(del.getByText('請輸入刪除原因')).toBeVisible();
    await del.getByLabel('刪除原因').fill('傳錯檔');
    await del.getByRole('button', { name: '確認刪除' }).click();
    await expect(panel.locator('.notice.success')).toContainText('已標記刪除');
    await expect(panel.locator('.attachment-grid li')).toHaveCount(0);
    const after = (await db().from('ga_resource_attachments').select('*').eq('id', rows[0].id).single()).data as any;
    expect(after.deleted_at).toBeTruthy();
    expect(after.deletion_reason).toBe('傳錯檔');
    const kept = await db().storage.from('general-affairs-attachments').download(after.storage_path);
    expect(kept.error).toBeNull();
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('首頁「待我處理」與水電網費導覽徽章：登錄逾期帳單後出現、點徽章只看逾期且筆數相同、標記已繳後首頁與徽章即時減少', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const before = await countOverdueDb();
  const made = await callFn(users.util_mgr.client, 'ga_ws_ub_save', { p_id: null, p_payload: { store_id: st.VW001.id, service_period_start: '2038-01-01', service_period_end: '2038-01-31', expense_type: 'WATER', billing_month: PAST, provider_name: provider, service_identifier: key('H'), amount: 2100, due_date: dayOffset(-2) }, p_expected_updated_at: null, p_confirm_paid_change: false });
  expect(made.ok, JSON.stringify(made)).toBe(true);
  const { ctx, page, errors } = await pageForUser(browser, state, testInfo);
  const sideBadge = async () => {
    await openGaSide(page);
    await expandGroup(page, GROUP); // 帳單列表在「水電電話網路費」群組裡，收合時看不到
    const row = shell(page).locator('aside .ga-row').filter({ has: page.getByRole('button', { name: '帳單列表', exact: true }) }).first();
    const text = (await row.locator('.ga-badge').count()) ? ((await row.locator('.ga-badge').first().textContent()) || '').trim() : '';
    const close = shell(page).getByRole('button', { name: '關閉總務選單' });
    if (await close.isVisible().catch(() => false)) await close.click(); // 手機的側欄是抽屜，讀完收起來
    return text;
  };
  const cap = (n: number) => (n <= 0 ? '' : n > 99 ? '99+' : String(n));
  try {
    await openGaCenter(page);
    // 首頁待辦與導覽徽章：數字等於資料庫（逾期＝未繳且到期日早於台北今天）
    await expect(page.locator('[data-testid="home-count-bill_overdue"]:visible')).toHaveText(String(before + 1));
    await expect.poll(sideBadge, { timeout: 20_000 }).toBe(cap(before + 1));
    // 水電管理沒有其他待辦項目：首頁合計等於逾期帳單數
    await expect(page.locator('[data-testid="home-total"]:visible')).toHaveText(cap(before + 1) || '0');
    // 點徽章：只看逾期，筆數等於徽章數字
    await openGaSide(page);
    await expandGroup(page, GROUP);
    await shell(page).getByRole('button', { name: /^帳單列表待我處理/ }).click();
    await expect(visibleHeading(page, '水電電話網路費')).toBeVisible();
    await expect(vis(page, 'bill-total')).toHaveText(`共 ${before + 1} 筆`);
    // 開啟那一筆、標記已繳（預設今天）
    await vis(page, 'bill-search').fill(key('H'));
    await expect(page.locator('[data-testid="bill-card"]:visible')).toHaveCount(1);
    await page.locator('[data-testid="bill-card"]:visible').first().getByTestId('open-bill').click();
    await vis(page, 'bd-pay').click();
    await vis(page, 'bd-pay-date').fill(shiftMonth(`${PAST}-01`, -1));
    await vis(page, 'bd-pay-ok').click();
    await expect(vis(page, 'bd-status')).toHaveText('已繳費');
    expect(await countOverdueDb()).toBe(before);
    // 辦完一項：導覽徽章即時減少，首頁待辦也減少（手機的詳情是全螢幕視窗，先關掉才點得到側欄）
    if (await page.locator('dialog[open]').count()) await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect.poll(sideBadge, { timeout: 20_000 }).toBe(cap(before));
    await openGaCenter(page);
    await expect(page.locator('[data-testid="home-count-bill_overdue"]:visible')).toHaveText(String(before), { timeout: 20_000 });
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});
