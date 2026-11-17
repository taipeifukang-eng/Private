import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageFor, shell, sideLabels, visibleHeading } from '../support/g01-ui';
import { assertGaBaseline, cleanupM7M8 } from '../support/m7m8-fixtures';
import { setupPoUsers, type PoUser } from '../support/m7m8-po-fixtures';

// M7/M8 第 4 批 G25 冒煙層：採購單、新增採購單、待簽核採購單可開、標題與統計卡、主要 API 200、無 pageerror／console 錯誤、
// 桌機 1440 與手機 390 無水平溢出（project viewport）、導覽兩個 href 對到正確頁面 kind、核准設定只給核准人、沒有權限沒有入口且 API 403。
// 帳號：role-matrix 的 ga_po_purchaser（採購三權限）、ga_po_approver（核准人，沒有採購寫入權限）；缺權限與無權限用臨時帳號。
const API = '/api/workspace/general-affairs/purchase-orders';
const side = (page: any, label: string) => shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first();
async function nav(page: any, label: string) {
  await openGaSide(page);
  await side(page, label).click();
}

test.describe.configure({ mode: 'serial' });
let users: Record<string, PoUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const apis: Record<string, any> = {};
test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupPoUsers(['review_only', 'stock_only', 'no_partview', 'nobody']);
  users = made.users;
  teardown = made.teardown;
  for (const k of Object.keys(users)) apis[k] = await apiForUser(users[k] as any);
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('採購人員：側欄有「採購單」沒有「待簽核採購單」；採購單頁有 11 張統計卡與新增按鈕、沒有核准設定；新增採購單表單可開；API 200；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageFor(browser, 'ga_po_purchaser', testInfo);
  try {
    await openGaCenter(page);
    const labels = await sideLabels(page);
    expect(labels).toContain('採購單');
    expect(labels).not.toContain('待簽核採購單');
    const calls: string[] = [];
    page.on('response', (r) => r.url().includes(`${API}`) && calls.push(String(r.status())));
    await nav(page, '採購單');
    await expect(visibleHeading(page, '採購單')).toBeVisible();
    await expect(page.getByRole('list', { name: '採購單統計' }).locator('visible=true').getByRole('listitem')).toHaveCount(11);
    await expect(page.getByTestId('po-total').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('new-po').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('open-settings')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    await expect.poll(() => calls.length).toBeGreaterThanOrEqual(1);
    expect(calls.every((c) => c === '200')).toBe(true);
    await page.getByTestId('new-po').locator('visible=true').click();
    await expect(visibleHeading(page, '新增採購單')).toBeVisible();
    await expect(page.getByTestId('po-form').locator('visible=true')).toBeVisible();
    // 第 6 批：連結改指新版廠商頁，只有廠商管理權限者看得到；採購人員（只有廠商檢視）改顯示「請洽總務新增」。
    await expect(page.getByTestId('legacy-vendor-link')).toHaveCount(0);
    await expect(page.getByTestId('vendor-ask-ga').locator('visible=true')).toContainText('請洽總務新增');
    await expect(page.getByTestId('pe-save').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('pe-add-item').locator('visible=true')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('核准人：側欄有「採購單」與「待簽核採購單」；待簽核頁可開；採購單頁有核准設定、沒有新增按鈕；設定對話框可開；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageFor(browser, 'ga_po_approver', testInfo);
  try {
    await openGaCenter(page);
    const labels = await sideLabels(page);
    expect(labels).toEqual(expect.arrayContaining(['採購單', '待簽核採購單']));
    await nav(page, '待簽核採購單');
    await expect(visibleHeading(page, '待簽核採購單')).toBeVisible();
    await expect(page.getByTestId('ap-total').locator('visible=true')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    await nav(page, '採購單');
    await expect(visibleHeading(page, '採購單')).toBeVisible();
    await expect(page.getByTestId('open-settings').locator('visible=true')).toBeVisible();
    await expect(page.getByTestId('new-po')).toHaveCount(0); // 核准人沒有採購寫入權限
    await page.getByTestId('open-settings').locator('visible=true').click();
    const form = page.locator('dialog[open]').getByTestId('settings-form');
    await expect(form).toBeVisible();
    await expect(form.getByTestId('st-threshold')).toBeVisible();
    await expect(form.getByTestId('st-threshold')).not.toHaveValue('');
    expect(await noPageOverflow(page)).toBe(true);
    await form.getByTestId('st-close').click();
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('導覽兩個 href 對到正確頁面 kind；capabilities 依權限（採購人員只有採購單、核准人兩個都有）', async ({ browser }, testInfo) => {
  const flat = (nav: any[]) => nav.flatMap((g) => g.items.flatMap((i: any) => [i, ...(i.children || [])]));
  for (const [role, orders, approvals] of [['ga_po_purchaser', true, false], ['ga_po_approver', true, true]] as const) {
    const { ctx, page } = await pageFor(browser, role, testInfo);
    try {
      await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
      const session = await page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()));
      const items = flat(session.gaNavigation);
      const kind = (href: string) => items.filter((i) => i.href === href).map((i) => i.kind);
      expect(kind('/general-affairs/purchase-orders'), role).toEqual(orders ? ['ga-purchase-orders'] : []);
      expect(kind('/general-affairs/purchase-orders?view=approvals'), role).toEqual(approvals ? ['ga-purchase-approvals'] : []);
      expect(session.capabilities, role).toMatchObject({ gaPurchaseOrders: orders, gaPurchaseApprovals: approvals });
    } finally {
      await ctx.close();
    }
  }
});

test('缺權限與無權限帳號：只有採購評估管理者能看清單但不能寫（訊息說明缺哪個）；沒有任何採購權限的帳號沒有入口且 API 403', async ({ browser }, testInfo) => {
  const get = async (k: string, p: string) => (await apis[k].get(p)).status();
  expect(await get('review_only', API)).toBe(200);
  expect(await get('review_only', `${API}/approvals`)).toBe(403);
  const create = await apis.review_only.post(API, { data: { header: {}, items: [{ item_name: 'x', quantity: 1 }], idempotency_key: 'smoke-1' } });
  expect(create.status()).toBe(403);
  expect((await create.json()).error).toContain('庫存交易管理');
  for (const k of ['stock_only', 'nobody']) {
    for (const p of ['', '/approvals', '/settings', '/options?type=store', '/vendor-options']) expect(await get(k, API + p), `${k} ${p}`).toBe(403);
  }
  expect(await get('no_partview', API)).toBe(200);
  const noPart = await apis.no_partview.post(API, { data: { header: {}, items: [{ item_name: 'x', quantity: 1 }], idempotency_key: 'smoke-2' } });
  expect(noPart.status()).toBe(403);
  expect((await noPart.json()).error).toContain('料件查看');
  const d = await pageFor(browser, 'denied', testInfo);
  try {
    await d.page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
    const caps = await d.page.evaluate(async () => (await (await fetch('/api/workspace/session')).json()).capabilities);
    expect(caps).toMatchObject({ gaPurchaseOrders: false, gaPurchaseApprovals: false });
    for (const p of ['', '/approvals', '/settings']) expect(await d.page.evaluate(async (u) => (await fetch(u)).status, `${API}${p}`), p).toBe(403);
  } finally {
    await d.ctx.close();
  }
});
