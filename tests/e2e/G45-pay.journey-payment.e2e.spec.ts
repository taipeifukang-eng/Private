import crypto from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageForUser, shell, visibleHeading } from '../support/g01-ui';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name } from '../support/m7m8-fixtures';
import { seedGa45Vendor, setupGa45Users, type Ga45Key, type Ga45User } from '../support/m7m8-ga45-fixtures';

// 第 4.5 批 G45-pay.journey-payment（角色接力劇本，桌機與手機各跑一次）：
// 總務（clerk）從採購單進貨選可請款進貨建立請款單並送出 → 會計（accountant，權限與總務相同，P4）在「待付款」看到並退回（必填原因）→ 總務看到退回原因、修改後再送出 →
// 會計標已付款（轉帳、參考號）→ 已付款鎖定（按鈕只剩備註與作廢）→ 請款檢視者（viewer）唯讀看得到結果、看不到銀行與統編 → 總務查操作紀錄（誰、何時）→
// 失敗分支：兩個畫面同時操作（STALE 白話提示並重新載入）、超過累計上限被擋、已付款作廢必填原因、作廢後額度釋放可重新請款、列印頁簽章區顯示兩段（總務請款、會計付款）。
// 每步用 service role 回讀資料庫與操作紀錄。測試資料帶 QA-GA45- 標記；結束只清自己的。
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });

const KEYS: Ga45Key[] = ['clerk', 'accountant', 'viewer'];
const P = '/api/workspace/general-affairs';
let users: Record<string, Ga45User> = {};
let teardown: () => Promise<string[]> = async () => [];
const states: Record<string, any> = {};
const apis: Record<string, any> = {};
let vendor: any;
let po: any;
let rc: any[] = [];
let prNo = '';
let prId = '';
const db = () => adminDb();
const vis = (page: Page, testid: string) => page.getByTestId(testid).locator('visible=true');
const noConsole = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const rpcOk = async (who: Ga45Key, name: string, args: Record<string, unknown>) => {
  const r: any = await callFn(users[who].client, name, args);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return r.data as any;
};
const dbPr = async () => (await db().from('ga_payment_requests').select('*').eq('pr_no', prNo).maybeSingle()).data as any;
const dbEvents = async () => ((await db().from('ga_payment_request_events').select('event_type,actor_id,from_status,to_status,reason,created_at').eq('pr_id', prId).order('created_at')).data || []) as any[];
async function nav(page: Page, label: string) {
  await openGaSide(page);
  await shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first().click();
}
async function openPr(page: Page, tab: 'all' | 'pay' = 'all') {
  await openGaCenter(page);
  await nav(page, '請款單');
  await expect(visibleHeading(page, '請款單')).toBeVisible();
  if (tab === 'pay') await vis(page, 'pr-tab-pay').click();
  await vis(page, 'pr-search').fill(prNo);
  await expect(page.locator('[data-testid="pr-card"]:visible')).toHaveCount(1);
  await page.locator('[data-testid="pr-card"]:visible').first().getByTestId('open-pr').click();
  await expect(vis(page, 'pe-status')).toBeVisible();
}

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
  vendor = await seedGa45Vendor('PJNY');
  const draft = await rpcOk('clerk', 'ga_ws_po_create', { p_header: { notes: m7Name('PJNY1'), vendor_id: vendor.id }, p_items: [{ item_name: 'QA-GA45 接力品項', unit: '個', quantity: 20, unit_price: 100 }], p_create_key: crypto.randomUUID() });
  po = await rpcOk('clerk', 'ga_ws_po_action', { p_id: draft.id, p_action: 'place_order', p_expected_updated_at: draft.updated_at, p_note: null });
  // 分批到貨：先收 10（含稅 1050），再收 6（含稅 630）；訂 20 只收 16，累計驗入 1680，拒收與未到貨的 4 件不能請款
  for (const q of [10, 6]) rc.push(await rpcOk('clerk', 'ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [{ po_item_id: po.items[0].id, delivered_qty: q }], p_key: crypto.randomUUID() }));
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('1. 總務建立請款單並送出：選第一批進貨，資料庫是已送出，操作紀錄有建立與送出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '請款單');
    await vis(page, 'new-pr').click();
    await vis(page, 'pe-search').fill(po.po_no);
    await expect(vis(page, 'pe-add-' + rc[0].receipt_no)).toBeVisible();
    await vis(page, 'pe-add-' + rc[0].receipt_no).click();
    await vis(page, 'pe-notes').fill('第一批貨款');
    await expect(vis(page, 'pe-grand')).toContainText('1,050');
    await vis(page, 'pe-save').click();
    await expect(vis(page, 'pe-status')).toHaveText('草稿');
    prNo = (await page.locator('h1:visible').first().innerText()).match(/PY-\d{8}-\d{3,}/)![0];
    await vis(page, 'pe-submit').click();
    await vis(page, 'act-confirm').click();
    await expect(vis(page, 'pe-status')).toHaveText('已送出');
    const row = await dbPr();
    prId = row.id;
    expect(row).toMatchObject({ status: 'SUBMITTED', created_by: users.clerk.id, submitted_by: users.clerk.id, amount_total: 1050 });
    expect((await dbEvents()).map((e) => e.event_type)).toEqual(['create', 'submit']);
    expect(await noPageOverflow(page)).toBe(true);
    expect(noConsole(errors)).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('2. 會計在「待付款」看到這張並退回（必填原因）；總務看到退回原因、修改備註後再送出', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const acc = await pageForUser(browser, states.accountant, testInfo);
  try {
    await openPr(acc.page, 'pay');
    await expect(vis(acc.page, 'pe-bank')).toContainText('123-456-789012');
    await vis(acc.page, 'pe-return').click();
    await vis(acc.page, 'act-confirm').click();
    await expect(vis(acc.page, 'act-error')).toContainText('退回原因');
    expect((await dbPr()).status).toBe('SUBMITTED'); // 沒填原因，沒有動作
    await vis(acc.page, 'act-reason').fill('備註要寫清楚是第一批');
    await vis(acc.page, 'act-confirm').click();
    await expect(vis(acc.page, 'pe-status')).toHaveText('草稿');
    expect(await dbPr()).toMatchObject({ status: 'DRAFT', last_return_reason: '備註要寫清楚是第一批' });
    expect(noConsole(acc.errors)).toEqual([]);
  } finally {
    await acc.ctx.close();
  }
  const clerk = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openPr(clerk.page);
    await expect(vis(clerk.page, 'pe-returned')).toContainText('備註要寫清楚是第一批');
    await vis(clerk.page, 'pe-notes').fill('第一批貨款（分批到貨之 10 件）');
    await vis(clerk.page, 'pe-save').click();
    await expect(vis(clerk.page, 'pe-saved')).toContainText('已儲存');
    await vis(clerk.page, 'pe-submit').click();
    await vis(clerk.page, 'act-confirm').click();
    await expect(vis(clerk.page, 'pe-status')).toHaveText('已送出');
    expect((await dbEvents()).map((e) => e.event_type)).toEqual(['create', 'submit', 'return', 'update', 'submit']);
    expect(noConsole(clerk.errors)).toEqual([]);
  } finally {
    await clerk.ctx.close();
  }
});

test('3. 失敗分支：兩個畫面同時操作，後按的人看到白話提示並重新載入；請款單狀態沒有被覆蓋', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const a = await pageForUser(browser, states.accountant, testInfo);
  const c = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openPr(a.page, 'pay');
    await openPr(c.page);
    // 總務先加一則備註（版本更新），會計手上的是舊版本
    await vis(c.page, 'pe-note').click();
    await vis(c.page, 'act-reason').fill('已跟廠商確認金額');
    await vis(c.page, 'act-confirm').click();
    await expect(vis(c.page, 'pe-saved')).toContainText('已加備註');
    await vis(a.page, 'pe-paid').click();
    await vis(a.page, 'act-ref').fill('00001');
    await vis(a.page, 'act-confirm').click();
    await expect(vis(a.page, 'act-error')).toContainText('剛被其他人修改');
    expect((await dbPr()).status).toBe('SUBMITTED');
    // 重新載入後已有最新版本：關掉對話框再按一次即可成功（這裡不付款，留到下一步）
    expect(noConsole(a.errors)).toEqual([]);
  } finally {
    await a.ctx.close();
    await c.ctx.close();
  }
});

test('4. 會計標已付款（轉帳、參考號）：資料庫記下付款人與時間；已付款鎖定，只剩備註與作廢', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const acc = await pageForUser(browser, states.accountant, testInfo);
  try {
    await openPr(acc.page, 'pay');
    await vis(acc.page, 'pe-paid').click();
    await vis(acc.page, 'act-method').selectOption('TRANSFER');
    await vis(acc.page, 'act-ref').fill('12345');
    await vis(acc.page, 'act-confirm').click();
    await expect(vis(acc.page, 'pe-status')).toHaveText('已付款');
    await expect(vis(acc.page, 'pe-locked')).toBeVisible();
    await expect(vis(acc.page, 'pe-paid-info')).toContainText('12345');
    await expect(vis(acc.page, 'pe-return')).toHaveCount(0);
    await expect(vis(acc.page, 'pe-save')).toHaveCount(0);
    await expect(vis(acc.page, 'pe-void-btn')).toBeVisible();
    const row = await dbPr();
    expect(row).toMatchObject({ status: 'PAID', pay_method: 'TRANSFER', paid_ref: '12345', paid_by: users.accountant.id, submitted_by: users.clerk.id });
    expect(row.paid_at).toBeTruthy();
    const ev = await dbEvents();
    expect(ev.at(-1)).toMatchObject({ event_type: 'mark_paid', actor_id: users.accountant.id, from_status: 'SUBMITTED', to_status: 'PAID' });
    // API 也擋：已付款不能改內容
    const patch = await apis.accountant.patch(`${P}/payment-requests/${prId}`, { data: { notes: '想改', expected_updated_at: row.updated_at } });
    expect(patch.status()).toBe(409);
    expect(noConsole(acc.errors)).toEqual([]);
  } finally {
    await acc.ctx.close();
  }
});

test('5. 請款檢視者唯讀：看得到結果與付款資訊，沒有任何動作，沒有銀行與統編；列印頁簽章區顯示總務請款與會計付款兩段', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const v = await pageForUser(browser, states.viewer, testInfo);
  try {
    await openPr(v.page);
    await expect(vis(v.page, 'pe-status')).toHaveText('已付款');
    await expect(vis(v.page, 'pe-paid-info')).toContainText('12345');
    await expect(vis(v.page, 'pe-masked')).toBeVisible();
    for (const id of ['pe-submit', 'pe-return', 'pe-paid', 'pe-void-btn', 'pe-note', 'pe-save']) await expect(v.page.getByTestId(id), id).toHaveCount(0);
    expect(await v.page.content()).not.toContain('123-456-789012');
    await expect(v.page.locator('[data-testid="pe-event"]:visible').first()).toBeVisible();
    await vis(v.page, 'pe-print-detail').click();
    await expect(vis(v.page, 'pp-sign-ga')).toContainText('GA45 clerk');
    await expect(vis(v.page, 'pp-sign-acc')).toContainText('GA45 accountant');
    await expect(v.page.getByTestId('pp-bank')).toHaveCount(0);
    expect(await noPageOverflow(v.page)).toBe(true);
    expect(noConsole(v.errors)).toEqual([]);
  } finally {
    await v.ctx.close();
  }
});

test('6. 第二批進貨（短收 6 件）：超過累計上限被擋；已付款作廢必填原因，作廢後釋放額度，第一批可重新請款', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  // 累計驗入 1680（1050 + 630）；第一批已佔 1050。第二批請 700 > 630 + 5，被擋
  const over = await apis.clerk.post(`${P}/payment-requests`, { data: { vendor_id: vendor.id, lines: [{ receipt_id: rc[1].id, claim_untaxed: 667, claim_tax: 33 }], idempotency_key: crypto.randomUUID() } });
  expect(over.status()).toBe(409);
  expect((await over.json()).error).toContain('拒收、未到貨');
  const acc = await pageForUser(browser, states.accountant, testInfo);
  try {
    await openPr(acc.page);
    await vis(acc.page, 'pe-void-btn').click();
    await vis(acc.page, 'act-confirm').click();
    await expect(vis(acc.page, 'act-error')).toContainText('原因');
    expect((await dbPr()).status).toBe('PAID');
    await vis(acc.page, 'act-reason').fill('款項已退回，重新請款');
    await vis(acc.page, 'act-confirm').click();
    await expect(vis(acc.page, 'pe-status')).toHaveText('已作廢');
    await expect(vis(acc.page, 'pe-void')).toContainText('款項已退回，重新請款');
    for (const id of ['pe-submit', 'pe-return', 'pe-paid', 'pe-void-btn', 'pe-note']) await expect(acc.page.getByTestId(id), id).toHaveCount(0);
    expect(await dbPr()).toMatchObject({ status: 'VOID', void_reason: '款項已退回，重新請款', voided_by: users.accountant.id });
    const ev = await dbEvents();
    expect(ev.at(-1)).toMatchObject({ event_type: 'void', actor_id: users.accountant.id });
    expect(noConsole(acc.errors)).toEqual([]);
  } finally {
    await acc.ctx.close();
  }
  // 額度釋放：第一批與第二批合併請款（1050 + 630 = 1680）可以成功
  const both = await apis.clerk.post(`${P}/payment-requests`, { data: { vendor_id: vendor.id, lines: [{ receipt_id: rc[0].id }, { receipt_id: rc[1].id }], idempotency_key: crypto.randomUUID() } });
  expect(both.status(), await both.text()).toBe(201);
  expect((await both.json()).data.amount_total).toBe(1680);
  // 事件表不可改刪：即使是 service role 也被觸發器擋下
  const ev0 = (await db().from('ga_payment_request_events').select('id').eq('pr_id', prId).limit(1).single()).data as any;
  expect((await db().from('ga_payment_request_events').delete().eq('id', ev0.id)).error).toBeTruthy();
});
