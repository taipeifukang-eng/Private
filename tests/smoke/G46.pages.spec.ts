import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { gaNavToIn, noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, sideLabels, visibleHeading } from '../support/g01-ui';
import { adminDb, assertGaBaseline, cleanupM7M8, stores } from '../support/m7m8-fixtures';
import { addBillAttachment, cleanupGaup, mkBill, seedPayee, setupGaupUsers, type GaupKey, type GaupUser } from '../support/g46-fixtures';

// G46 水電話費請款 冒煙層（桌機 1440 與手機 390 由 project viewport 決定）：
//   請款單列表（來源標籤與篩選、水電話費請款單入口依權限啟用、匯出來源選項預設採購）、水電請款單建立（自動帶入、不可請款的帳單灰字寫原因、缺附件標紅、自動標記選項預設勾選與說明文字、增減）、
//   檢視頁（來源、單位、月份、自動標記資訊）、A4 列印頁欄位（門市、費用類型、帳單月份、識別號碼、金額）、沒有水電檢視者明細遮蔽、
//   水電帳單頁（繳費單位與請款單欄位、新篩選、補填繳費單位工具、請款單內的帳單欄位反灰）、無請款權限者沒有入口且 API 403、店長看不到；無 pageerror／console 錯誤、無水平溢出。
// 帳號：DEV 真實角色 vue_workspace_gaup_*（總務、會計、只有水電管理、只有請款檢視）與第 4.5 批、店長、管理員身分對照組。
const KEYS: GaupKey[] = ['clerk', 'accountant', 'billonly', 'payview', 'ga45_clerk', 'store_mgr', 'admin'];
const P = '/api/workspace/general-affairs';
const side = (page: any, label: string) => shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first();
async function nav(page: any, label: string) {
  await openGaSide(page);
  await side(page, label).click();
}
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);
let users: Record<string, GaupUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const apis: Record<string, any> = {};
const states: Record<string, any> = {};
const key = () => crypto.randomUUID();
/** 預期中的 4xx（例如缺附件被擋回 409）瀏覽器會在 console 記一筆，不算錯誤；其餘 console 錯誤與頁面例外照常失敗。 */
const real = (errs: string[]) => errs.filter((x) => !/Failed to load resource: the server responded with a status of 4[0-9][0-9]/.test(x));
const vis = (page: any, id: string) => page.getByTestId(id).locator('visible=true');
const cards = (page: any, id: string) => page.locator(`[data-testid="${id}"]:visible`);
let payee: any;
let seeded: any;
let bills: any[] = [];

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = [...(await cleanupGaup()), ...(await cleanupM7M8())];
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGaupUsers(KEYS);
  users = made.users;
  teardown = made.teardown;
  for (const k of KEYS) {
    apis[k] = await apiForUser(users[k] as any);
    states[k] = await apis[k].storageState();
  }
  const st = await stores();
  payee = await seedPayee('PG');
  const mk = (over: Record<string, unknown>) => mkBill(users.clerk.client, { payee_vendor_id: payee.id, billing_month: '2038-03-01', ...over });
  bills = [
    await mk({ store_id: st.VW001.id, expense_type: 'ELECTRICITY', service_identifier: 'E-0001', amount: 1200 }),
    await mk({ store_id: st.ZT01.id, expense_type: 'WATER', service_identifier: 'W-0002', amount: 300 }),
    await mk({ store_id: st.ZT01.id, expense_type: 'ELECTRICITY', service_identifier: 'E-0003', amount: 450.5 }), // 有小數：不可請款
  ];
  await addBillAttachment(users.clerk.client, bills[0].id, users.clerk.id);
  // 一張已送出的水電請款單（只含第一張帳單，有附件）供唯讀角色與列印頁使用
  const c = await apis.clerk.post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: payee.id, bill_month: '2038-03', bill_ids: [bills[0].id], auto_mark_paid: false, notes: '冒煙水電請款單', idempotency_key: key() } });
  expect(c.status(), await c.text()).toBe(201);
  const created = (await c.json()).data;
  const s = await apis.clerk.post(`${P}/payment-requests/${created.id}/actions`, { data: { action: 'submit', expected_updated_at: created.updated_at, idempotency_key: key() } });
  expect(s.status(), await s.text()).toBe(200);
  seeded = (await s.json()).data;
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupGaup(), '清除水電請款測試資料').toEqual([]);
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('總務：請款單列表有來源標籤與篩選、水電話費入口可用；建立水電請款單（自動帶入、不可請款灰字、缺附件標紅、自動標記預設勾選與說明）；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '請款單');
    await expect(visibleHeading(page, '請款單')).toBeVisible();
    await expect(vis(page, 'new-pr')).toBeVisible();
    await expect(vis(page, 'new-pr-utility')).toBeEnabled();
    await expect(vis(page, 'pr-filter-source')).toBeVisible();
    await expect(vis(page, 'pr-export-src-purchase')).toBeChecked();
    await vis(page, 'pr-search').fill(seeded.pr_no);
    await expect(cards(page, 'pr-card')).toHaveCount(1);
    await expect(vis(page, 'pr-source')).toHaveText('水電話費');
    await expect(vis(page, 'pr-bill-info')).toContainText('2038-03');
    await expect(vis(page, 'pr-bill-info')).toContainText('1 張帳單');
    // 來源篩選
    await vis(page, 'pr-filter-source').selectOption('PURCHASE');
    await expect(cards(page, 'pr-card')).toHaveCount(0);
    await vis(page, 'pr-filter-source').selectOption('UTILITY');
    await expect(cards(page, 'pr-card')).toHaveCount(1);
    expect(await noPageOverflow(page)).toBe(true);
    // 建立水電請款單
    await vis(page, 'new-pr-utility').click();
    await expect(page.locator('h1:visible').filter({ hasText: '建立水電話費請款單' })).toHaveCount(1);
    await expect(vis(page, 'pu-source')).toHaveText('水電話費');
    await vis(page, 'pu-month').fill('2038-03');
    await expect(vis(page, 'pu-vendor')).toBeVisible();
    await vis(page, 'pu-vendor').selectOption(payee.id);
    await expect(cards(page, 'pu-bill')).toHaveCount(3);
    // 自動帶入：第一、二張可請款預設全選（第一張在別張請款單內，不可請款；第三張有小數，不可請款）
    await expect(cards(page, 'pu-reason').filter({ hasText: '已在請款單 ' + seeded.pr_no })).toHaveCount(1);
    await expect(cards(page, 'pu-reason').filter({ hasText: '金額有小數' })).toHaveCount(1);
    await expect(vis(page, 'pu-count')).toHaveText('1');
    await expect(vis(page, 'pu-missing').first()).toBeVisible();
    await expect(vis(page, 'pu-warn-missing')).toContainText('還沒有附件');
    // 自動標記選項預設勾選，說明文字完整
    await expect(vis(page, 'pu-auto')).toBeChecked();
    await expect(vis(page, 'pu-auto-help')).toContainText('勾選：送出請款單時，這些帳單會標記為已繳（繳費日期＝送出日）');
    await expect(vis(page, 'pu-auto-help')).toContainText('不勾選：帳單維持原狀');
    // 手動取消再加回
    const boxes = page.locator('[data-testid="pu-bill-check"][aria-label*="W-0002"]:visible');
    await expect(boxes).toBeChecked();
    await boxes.uncheck();
    await expect(vis(page, 'pu-count')).toHaveText('0');
    await boxes.check();
    await expect(vis(page, 'pu-count')).toHaveText('1');
    expect(await noPageOverflow(page)).toBe(true);
    // 內層容器也不能橫向溢出（帳單表在手機版改卡片，每個欄位都要在區塊內）
    const inner = await page.locator('[data-testid="pu-candidates"]:visible').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return Array.from(el.querySelectorAll('table,tr,td')).every((c) => c.getBoundingClientRect().right <= r.right + 1);
    });
    expect(inner, '帳單區塊內層橫向溢出').toBe(true);
    // 儲存草稿 → 進入請款單頁
    await vis(page, 'pu-save').click();
    await expect(vis(page, 'pu-status')).toHaveText('草稿');
    await expect(vis(page, 'pu-vendor-name')).toContainText(payee.name);
    await expect(vis(page, 'pu-month-text')).toHaveText('2038-03');
    await expect(vis(page, 'pu-submit')).toBeVisible();
    await expect(vis(page, 'pu-auto')).toBeChecked();
    // 送出被擋：缺附件，列出哪一張
    await vis(page, 'pu-submit').click();
    await vis(page, 'act-confirm').click();
    await expect(vis(page, 'missing-list')).toBeVisible();
    await expect(cards(page, 'missing-item')).toHaveCount(1);
    await expect(vis(page, 'missing-intro')).toContainText('請款單維持草稿');
    await vis(page, 'missing-close').click();
    await expect(vis(page, 'pu-status')).toHaveText('草稿');
    expect(await noPageOverflow(page)).toBe(true);
    expect(real(errors), errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('檢視與列印：來源與帳單月份、水電明細欄位、列印頁欄位（沒有採購單、進貨單、發票、未稅、稅額）；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageForUser(browser, states.accountant, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '請款單');
    await vis(page, 'pr-search').fill(seeded.pr_no);
    await expect(cards(page, 'pr-card')).toHaveCount(1);
    await vis(page, 'open-pr').click();
    await expect(vis(page, 'pu-status')).toHaveText('已送出');
    await expect(vis(page, 'pu-source')).toHaveText('水電話費');
    await expect(vis(page, 'pu-auto-info')).toContainText('否');
    await expect(cards(page, 'pu-line')).toHaveCount(1);
    await expect(vis(page, 'pu-total')).toContainText('1,200');
    await expect(vis(page, 'pu-tax')).toBeVisible(); // 會計有廠商檢視
    // 會計看得到退回、標已付款、作廢；沒有「送出」（缺水電管理）
    await expect(vis(page, 'pu-return')).toBeVisible();
    await expect(vis(page, 'pu-paid')).toBeVisible();
    await expect(vis(page, 'pu-void-btn')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    await vis(page, 'pu-print-detail').click();
    await expect(visibleHeading(page, '請款單列印')).toBeVisible();
    await expect(vis(page, 'pp-source')).toHaveText('水電話費');
    await expect(vis(page, 'pp-bill-month')).toHaveText('2038-03');
    const head = page.locator('[data-testid="pp-lines"]:visible thead');
    for (const h of ['門市', '費用類型', '帳單月份', '電號／水號／用戶號碼', '金額']) await expect(head).toContainText(h);
    for (const h of ['採購單', '進貨單', '發票', '未稅', '稅額']) await expect(head).not.toContainText(h);
    await expect(cards(page, 'pp-line')).toHaveCount(1);
    await expect(cards(page, 'pp-line').first()).toContainText('電費');
    await expect(cards(page, 'pp-line').first()).toContainText('E-0001');
    await expect(vis(page, 'pp-total')).toContainText('1,200');
    expect(await noPageOverflow(page)).toBe(true);
    expect(real(errors), errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('只有請款檢視：明細遮蔽、沒有建立入口、列印頁明細區省略；無水電權限者 API 403', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageForUser(browser, states.payview, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '請款單');
    await expect(page.getByTestId('new-pr')).toHaveCount(0);
    await expect(page.getByTestId('new-pr-utility')).toHaveCount(0);
    await vis(page, 'pr-search').fill(seeded.pr_no);
    await vis(page, 'open-pr').click();
    await expect(vis(page, 'pu-lines-masked')).toContainText('明細已遮蔽');
    await expect(vis(page, 'pu-masked')).toBeVisible(); // 統編與銀行遮蔽
    await expect(vis(page, 'pu-submit')).toHaveCount(0);
    await vis(page, 'pu-print-detail').click();
    await expect(vis(page, 'pp-bills-masked')).toContainText('明細已遮蔽');
    await expect(page.locator('[data-testid="pp-secret"]:visible')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(real(errors), errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
  expect((await apis.payview.get(`${P}/utility-bills`)).status()).toBe(403);
});

test('水電帳單頁：繳費單位與請款單欄位、新篩選、補填繳費單位工具、請款單內的帳單欄位反灰；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const st = await stores();
  const noPayeeBill = await mkBill(users.clerk.client, { payee_vendor_id: null, billing_month: '2038-03-01', store_id: st.VW001.id, expense_type: 'PHONE', service_identifier: 'P-0009', amount: 99, provider_name: payee.name.replace('-P-', '-PRV-') });
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    await gaNavToIn(page, '水電電話網路費', '帳單列表');
    await expect(visibleHeading(page, '水電電話網路費')).toBeVisible();
    await vis(page, 'filter-month').fill('2038-03');
    await expect(vis(page, 'filter-request')).toBeVisible();
    await expect(vis(page, 'filter-payee')).toBeVisible();
    await expect(vis(page, 'open-backfill')).toBeVisible();
    // 已在請款單內的帳單顯示單號；沒有繳費單位的帳單標「未指定」
    await vis(page, 'filter-request').selectOption('in_request');
    await expect(cards(page, 'bill-card')).toHaveCount(2); // 已送出的那張（E-0001）與上一個測試建立的草稿（W-0002）
    await expect(cards(page, 'bill-request-link').filter({ hasText: seeded.pr_no })).toHaveCount(1);
    await vis(page, 'filter-request').selectOption('');
    await vis(page, 'filter-payee').selectOption('none');
    await expect(cards(page, 'bill-card')).toHaveCount(1);
    await expect(vis(page, 'bill-payee-none')).toHaveText('未指定');
    await vis(page, 'filter-payee').selectOption('');
    // 請款單內帳單的編輯視窗：金額與月份反灰、顯示鎖定說明
    await vis(page, 'filter-request').selectOption('in_request');
    await cards(page, 'bill-card').filter({ hasText: 'E-0001' }).locator('[data-testid="open-bill"]').click();
    await expect(vis(page, 'bd-request')).toContainText(seeded.pr_no);
    await expect(vis(page, 'bd-locked-note')).toBeVisible();
    await vis(page, 'bd-edit').click();
    await expect(vis(page, 'uf-locked-note')).toBeVisible();
    await expect(vis(page, 'uf-amount')).toHaveAttribute('readonly', '');
    await expect(vis(page, 'uf-month')).toBeDisabled();
    await expect(vis(page, 'uf-payee')).toBeDisabled();
    await vis(page, 'uf-cancel').click();
    await vis(page, 'filter-request').selectOption('');
    // 補填繳費單位工具
    await vis(page, 'open-backfill').click();
    await expect(vis(page, 'payee-backfill')).toBeVisible();
    const group = cards(page, 'pb-group').filter({ hasText: noPayeeBill.provider_name });
    await expect(group).toHaveCount(1);
    await group.locator('[data-testid="pb-select"]').selectOption(payee.id);
    await group.locator('[data-testid="pb-apply"]').click();
    await expect(vis(page, 'pb-result')).toContainText('補填 1 筆');
    expect((await adminDb().from('ga_utility_bills').select('payee_vendor_id').eq('id', noPayeeBill.id).single()).data!.payee_vendor_id).toBe(payee.id);
    expect(await noPageOverflow(page)).toBe(true);
    await vis(page, 'pb-close').click();
    expect(real(errors), errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('沒有請款權限者沒有入口且 API 403：只有水電管理、第 4.5 批總務（有請款沒水電）可進請款單但不能建立水電請款單、店長、管理員身分無角色', async ({ browser }, testInfo) => {
  for (const who of ['billonly', 'store_mgr', 'admin'] as const) {
    const { ctx, page, errors } = await pageForUser(browser, states[who], testInfo);
    try {
      await page.goto('/');
      if (who !== 'store_mgr') {
        await openGaCenter(page).catch(() => undefined);
        const labels = await sideLabels(page).catch(() => [] as string[]);
        expect(labels, `${who} 側欄`).not.toContain('請款單');
      }
      expect(errors.filter((e) => !/403|Failed to load resource/.test(e)), errors.join('\n')).toEqual([]);
    } finally {
      await ctx.close();
    }
    expect((await apis[who].get(`${P}/payment-requests`)).status(), `${who} 請款單 API`).toBe(403);
    expect((await apis[who].get(`${P}/payment-requests/utility-candidates?month=2038-03`)).status(), `${who} 候選 API`).toBe(403);
  }
  // 第 4.5 批總務：有請款、沒有水電管理 → 水電入口反灰並說明缺哪個權限
  const { ctx, page, errors } = await pageForUser(browser, states.ga45_clerk, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '請款單');
    await expect(vis(page, 'new-pr')).toBeVisible();
    await expect(vis(page, 'new-pr-utility')).toBeDisabled();
    await expect(vis(page, 'new-pr-utility-need')).toContainText('水電話網費管理');
    expect(real(errors), errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
