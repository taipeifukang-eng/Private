import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, sideLabels, visibleHeading } from '../support/g01-ui';
import { assertGaBaseline, callFn, cleanupM7M8, m7Name } from '../support/m7m8-fixtures';
import { seedGa45Vendor, setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';

// 第 4.5 批 G45-pay 冒煙層（桌機 1440 與手機 390 由 project viewport 決定）：請款單清單、建立與編輯、狀態按鈕依權限與狀態顯示、超過累計上限被擋、
// 差異原因必填但可送出、已付款鎖定、A4 列印頁內容、請款設定、對帳 CSV、無廠商權限者唯讀與遮蔽、無請款權限者沒有入口且 API 403、無 pageerror／console 錯誤、無水平溢出。
// 帳號：vue_workspace_ga45_clerk（請款管理＋廠商查看）、ga45_novendor（請款管理、無廠商查看）、ga45_viewer（請款檢視、無廠商查看）、vue_workspace_ga_purchaser（無請款權限）、無權限與管理員身分無角色。
const KEYS: Ga45Key[] = ['clerk', 'novendor', 'viewer', 'purchaser', 'nobody', 'admin'];
const P = '/api/workspace/general-affairs';
const side = (page: any, label: string) => shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first();
async function nav(page: any, label: string) {
  await openGaSide(page);
  await side(page, label).click();
}
test.describe.configure({ mode: 'serial' });
let users: Record<string, Ga45User> = {};
let teardown: () => Promise<string[]> = async () => [];
const apis: Record<string, any> = {};
const states: Record<string, any> = {};
let vendor: any;
let po: any;
let rcA: any;
let rcB: any;
let seeded: any;
const rpcOk = async (who: Ga45Key, name: string, args: Record<string, unknown>) => {
  const r: any = await callFn(users[who].client, name, args);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
};
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date());
const key = () => crypto.randomUUID();
const vis = (page: any, id: string) => page.getByTestId(id).locator('visible=true');
const cards = (page: any, id: string) => page.locator(`[data-testid="${id}"]:visible`);

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupGa45Users(KEYS);
  users = made.users;
  teardown = made.teardown;
  for (const k of KEYS) {
    apis[k] = await apiForUser(users[k] as any);
    states[k] = await apis[k].storageState();
  }
  vendor = await seedGa45Vendor('PSMK');
  const draft = await rpcOk('clerk', 'ga_ws_po_create', { p_header: { notes: m7Name('PSMK1'), vendor_id: vendor.id }, p_items: [{ item_name: 'QA-GA45 請款冒煙品項', unit: '個', quantity: 30, unit_price: 100 }], p_create_key: key() });
  po = await rpcOk('clerk', 'ga_ws_po_action', { p_id: draft.id, p_action: 'place_order', p_expected_updated_at: draft.updated_at, p_note: null });
  const recv = (qty: number) => rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [{ po_item_id: po.items[0].id, delivered_qty: qty }], p_key: key() });
  rcA = await recv(10);
  rcB = await recv(10);
  const rcC = await recv(10);
  // rcA 連一張免開發票（含稅 1050）；rcC 先做成已送出的請款單給唯讀角色看
  const inv = await apis.clerk.post(`${P}/purchase-invoices`, { data: { invoice_type: 'NO_INVOICE', invoice_date: today(), vendor_id: vendor.id, amount_total: 1050, receipts: [{ receipt_id: rcA.id }], idempotency_key: key() } });
  expect(inv.status(), await inv.text()).toBe(201);
  const c = await apis.clerk.post(`${P}/payment-requests`, { data: { vendor_id: vendor.id, lines: [{ receipt_id: rcC.id }], notes: '冒煙既有請款單', idempotency_key: key() } });
  expect(c.status(), await c.text()).toBe(201);
  const created = (await c.json()).data;
  const s = await apis.clerk.post(`${P}/payment-requests/${created.id}/actions`, { data: { action: 'submit', expected_updated_at: created.updated_at, idempotency_key: key() } });
  expect(s.status(), await s.text()).toBe(200);
  seeded = (await s.json()).data;
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('請款管理（總務）：清單、建立（超過累計上限被擋、差異原因必填但可送出）、送出、標已付款、已付款鎖定；無錯誤、無水平溢出', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    expect(await sideLabels(page)).toContain('請款單');
    await nav(page, '請款單');
    await expect(visibleHeading(page, '請款單')).toBeVisible();
    await expect(vis(page, 'new-pr')).toBeVisible();
    await vis(page, 'pr-search').fill(seeded.pr_no);
    await expect(cards(page, 'pr-card')).toHaveCount(1);
    await expect(vis(page, 'pr-status')).toHaveText('已送出');
    await expect(vis(page, 'pr-total')).toHaveText('共 1 張');
    expect(await noPageOverflow(page)).toBe(true);
    // 待付款頁籤
    await vis(page, 'pr-search').fill('');
    await vis(page, 'pr-tab-pay').click();
    await expect(cards(page, 'pr-card').first()).toBeVisible();
    await vis(page, 'pr-tab-all').click();
    // 建立：選 rcA（已連免開發票，含稅 1050）
    await vis(page, 'new-pr').click();
    await expect(visibleHeading(page, '建立請款單')).toBeVisible();
    await vis(page, 'pe-search').fill(po.po_no);
    await expect(vis(page, 'pe-add-' + rcA.receipt_no)).toBeVisible();
    await vis(page, 'pe-add-' + rcA.receipt_no).click();
    await expect(cards(page, 'pe-line')).toHaveCount(1);
    await expect(vis(page, 'pe-vendor')).toContainText(vendor.name);
    await expect(vis(page, 'pe-grand')).toContainText('1,050');
    // 稅額手改到 56：含稅 1056，與發票分攤 1050 差 6 元 → 要差異原因
    await vis(page, 'pe-untaxed').fill('1000');
    await vis(page, 'pe-tax-input').fill('55');
    await expect(vis(page, 'pe-diff-reason')).toHaveCount(0); // 差 5 元：尾差免原因
    await expect(vis(page, 'pe-tail')).toContainText('尾差');
    await vis(page, 'pe-tax-input').fill('56');
    await expect(vis(page, 'pe-diff-reason')).toBeVisible();
    await vis(page, 'pe-save').click();
    await expect(vis(page, 'pe-error')).toContainText('差異原因');
    await vis(page, 'pe-diff-reason').fill('廠商加收小額運費');
    // 超過累計上限：這張採購單已收 3150（本次連同其他進貨），請款 9999 被擋
    await vis(page, 'pe-untaxed').fill('9999');
    await vis(page, 'pe-tax-input').fill('0');
    await expect(vis(page, 'pe-over').first()).toContainText('超過累計驗入含稅額');
    await vis(page, 'pe-save').click();
    await expect(vis(page, 'pe-error')).toContainText('無法送出');
    await vis(page, 'pe-untaxed').fill('1000');
    await vis(page, 'pe-tax-input').fill('56');
    await expect(vis(page, 'pe-over')).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    await vis(page, 'pe-save').click();
    // 建立成功後轉到檢視（草稿）
    await expect(vis(page, 'pe-status')).toHaveText('草稿');
    await expect(vis(page, 'pe-bank')).toContainText('123-456-789012');
    await expect(vis(page, 'pe-submit')).toBeVisible();
    await expect(vis(page, 'pe-paid')).toHaveCount(0); // 沒有核准也一定要先送出
    await expect(vis(page, 'pe-return')).toHaveCount(0);
    await expect(vis(page, 'pe-refresh-bank')).toBeVisible();
    // 送出
    await vis(page, 'pe-submit').click();
    await vis(page, 'act-confirm').click();
    await expect(vis(page, 'pe-status')).toHaveText('已送出');
    await expect(vis(page, 'pe-return')).toBeVisible();
    await expect(vis(page, 'pe-paid')).toBeVisible();
    await expect(vis(page, 'pe-submit')).toHaveCount(0);
    await expect(vis(page, 'pe-save')).toHaveCount(0); // 已送出不能直接改
    // 退回要原因
    await vis(page, 'pe-return').click();
    await vis(page, 'act-confirm').click();
    await expect(vis(page, 'act-error')).toContainText('退回原因');
    await vis(page, 'act-reason').fill('請補發票影本');
    await vis(page, 'act-confirm').click();
    await expect(vis(page, 'pe-status')).toHaveText('草稿');
    await expect(vis(page, 'pe-returned')).toContainText('請補發票影本');
    await vis(page, 'pe-submit').click();
    await vis(page, 'act-confirm').click();
    await expect(vis(page, 'pe-status')).toHaveText('已送出');
    // 標已付款（申請人自己標）
    await vis(page, 'pe-paid').click();
    await vis(page, 'act-method').selectOption('TRANSFER');
    await vis(page, 'act-ref').fill('77777');
    await vis(page, 'act-confirm').click();
    await expect(vis(page, 'pe-status')).toHaveText('已付款');
    await expect(vis(page, 'pe-locked')).toBeVisible();
    await expect(vis(page, 'pe-paid-info')).toContainText('77777');
    await expect(vis(page, 'pe-pay-date')).toBeDisabled();
    await expect(vis(page, 'pe-return')).toHaveCount(0);
    await expect(vis(page, 'pe-paid')).toHaveCount(0);
    await expect(vis(page, 'pe-note')).toBeVisible();
    await expect(vis(page, 'pe-void-btn')).toBeVisible();
    await expect(cards(page, 'pe-event').first()).toBeVisible();
    expect(await cards(page, 'pe-event').count()).toBe(5); // 建立、送出、退回、再送出、標已付款
    expect(await noPageOverflow(page)).toBe(true);
    // 列印頁
    await vis(page, 'pe-print-detail').click();
    await expect(visibleHeading(page, '請款單列印')).toBeVisible();
    await expect(vis(page, 'pp-sheet')).toBeVisible();
    await expect(vis(page, 'pp-vendor')).toContainText(vendor.name);
    await expect(vis(page, 'pp-no')).toContainText('PY-');
    await expect(vis(page, 'pp-bank')).toContainText('123-456-789012');
    await expect(vis(page, 'pp-secret')).toContainText(vendor.tax_id);
    await expect(vis(page, 'pp-sign-ga')).toContainText('GA45 clerk');
    await expect(vis(page, 'pp-sign-acc')).toContainText('GA45 clerk');
    await expect(vis(page, 'pp-paid')).toContainText('77777');
    // 審查修正：合計列的稅額欄不可空白（欄位名是 tax_amount，曾誤用 amount_tax 而印出空白）
    await expect(vis(page, 'pp-tax')).toHaveText(/\d/);
    await expect(vis(page, 'pp-total')).toHaveText(/\d/);
    expect(await cards(page, 'pp-line').count()).toBe(1);
    // 列印樣式：只輸出紙張（導覽與按鈕隱藏），而且切回螢幕後恢復
    await page.emulateMedia({ media: 'print' });
    await expect(vis(page, 'pp-sheet')).toBeVisible();
    await expect(page.getByTestId('pp-print')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });
    await expect(page.getByTestId('pp-print')).toBeVisible();
    expect(await noPageOverflow(page)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('請款設定與對帳 CSV：設定可調尾差與買受人（檢視者唯讀）；匯出要先選月份，下載檔含 BOM 與請款單號', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '請款單');
    await vis(page, 'pr-export').click();
    await expect(vis(page, 'pr-export-msg')).toContainText('選擇要匯出的月份');
    await vis(page, 'pr-filter-month').fill(today().slice(0, 7));
    const [download] = await Promise.all([page.waitForEvent('download'), vis(page, 'pr-export').click()]);
    expect(download.suggestedFilename()).toContain('請款對帳');
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    const buf = Buffer.concat(chunks);
    expect([buf[0], buf[1], buf[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(buf.toString('utf8')).toContain(seeded.pr_no);
    await expect(vis(page, 'pr-export-msg')).toContainText('已匯出');
    // 設定
    await vis(page, 'pr-settings').click();
    await expect(vis(page, 'ps-tol')).toHaveValue('5');
    await vis(page, 'ps-tol').fill('101');
    await vis(page, 'ps-save').click();
    await expect(vis(page, 'ps-error')).toContainText('0 到 100');
    await vis(page, 'ps-tol').fill('7');
    await vis(page, 'ps-title').fill('QA-GA45 買受人');
    await vis(page, 'ps-save').click();
    await expect(vis(page, 'ps-notice')).toContainText('已儲存');
    await expect(vis(page, 'ps-history')).toContainText('尾差金額');
    await vis(page, 'ps-tol').fill('5');
    await vis(page, 'ps-title').fill('');
    await vis(page, 'ps-save').click();
    await expect(vis(page, 'ps-notice')).toContainText('已儲存');
    await expect(vis(page, 'ps-tol')).toHaveValue('5');
    expect(await noPageOverflow(page)).toBe(true);
    await vis(page, 'ps-close').click();
    expect(errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]); // 故意送 101 被擋的 400 不算錯誤
  } finally {
    await ctx.close();
  }
  const v = await pageForUser(browser, states.viewer, testInfo);
  try {
    await openGaCenter(v.page);
    await nav(v.page, '請款單');
    await vis(v.page, 'pr-settings').click();
    await expect(vis(v.page, 'ps-readonly')).toBeVisible();
    await expect(vis(v.page, 'ps-tol')).toBeDisabled();
    await expect(v.page.getByTestId('ps-save')).toHaveCount(0);
    expect(v.errors).toEqual([]);
  } finally {
    await v.ctx.close();
  }
});

test('請款檢視者與無廠商權限的管理者：檢視者唯讀（沒有任何動作按鈕）；統編與銀行帳號整區省略（含列印頁）；管理者仍可操作但看不到帳務機密', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  for (const who of ['viewer', 'novendor'] as const) {
    const { ctx, page, errors } = await pageForUser(browser, states[who], testInfo);
    try {
      await openGaCenter(page);
      expect(await sideLabels(page)).toContain('請款單');
      await nav(page, '請款單');
      await vis(page, 'pr-search').fill(seeded.pr_no);
      await expect(cards(page, 'pr-card')).toHaveCount(1);
      if (who === 'viewer') await expect(page.getByTestId('new-pr')).toHaveCount(0);
      else await expect(vis(page, 'new-pr')).toBeVisible();
      await expect(page.getByTestId('pr-filter-vendor')).toHaveCount(0); // 沒有廠商權限：沒有廠商篩選
      await cards(page, 'pr-card').first().getByTestId('open-pr').click();
      await expect(vis(page, 'pe-status')).toHaveText('已送出');
      await expect(vis(page, 'pe-masked')).toBeVisible();
      await expect(page.getByTestId('pe-bank')).toHaveCount(0);
      await expect(page.getByTestId('pe-tax')).toHaveCount(0);
      if (who === 'viewer') {
        await expect(vis(page, 'pe-readonly')).toBeVisible();
        for (const id of ['pe-submit', 'pe-return', 'pe-paid', 'pe-void-btn', 'pe-note', 'pe-save']) await expect(page.getByTestId(id), `viewer ${id}`).toHaveCount(0);
      } else {
        await expect(vis(page, 'pe-paid')).toBeVisible();
      }
      expect(await page.content()).not.toContain('123-456-789012');
      await vis(page, 'pe-print-detail').click();
      await expect(vis(page, 'pp-sheet')).toBeVisible();
      await expect(page.getByTestId('pp-secret')).toHaveCount(0);
      await expect(page.getByTestId('pp-bank')).toHaveCount(0);
      expect(await page.content()).not.toContain('123-456-789012');
      expect(await noPageOverflow(page)).toBe(true);
      expect(errors, who).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});

test('沒有請款權限：採購人員、無權限、管理員身分（無角色）側欄沒有「請款單」，API 403', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  for (const who of ['purchaser', 'nobody', 'admin']) {
    const { ctx, page, errors } = await pageForUser(browser, states[who], testInfo);
    try {
      await openGaCenter(page).catch(() => undefined);
      const labels = await sideLabels(page).catch(() => [] as string[]);
      expect(labels, who).not.toContain('請款單');
      for (const u of [`${P}/payment-requests`, `${P}/payment-settings`, `${P}/payment-requests/export?month=${today().slice(0, 7)}`]) {
        const r = await page.evaluate(async (url) => (await fetch(url, { credentials: 'same-origin' })).status, u);
        expect(r, `${who} ${u}`).toBe(403);
      }
      expect(errors.filter((e) => !/403/.test(e)), who).toEqual([]);
    } finally {
      await ctx.close();
    }
  }
});
