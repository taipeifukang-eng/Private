import crypto from 'node:crypto';
import { expect, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { noPageOverflow, openGaCenter, openGaSide, pageForUser, shell } from '../support/g01-ui';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, m7Name, stores } from '../support/m7m8-fixtures';
import { seedGa45Vendor } from '../support/m7m8-ga45-fixtures';
import { addBillAttachment, cleanupGaup, mkBill, pastMonth, seedPayee, setupGaupUsers, todayIso, type GaupKey, type GaupUser } from '../support/g46-fixtures';

// G46 e2e 多角色劇本（循序；桌機 1440 與手機 390 由 project viewport 決定）：
//   1. 主劇本（總務→會計）：總務建水電請款單（自動帶入 3 張、取消再加回）→ 缺附件送出被擋並列出帳單 → 補附件後送出（自動標記勾選）→ 帳單已繳、繳費日期＝今天、顯示由請款單自動標記
//      → 會計退回（帳單回待繳）→ 總務再送出 → 會計標已付款（帳單不變、已付款鎖定、改帳單被擋）→ 會計作廢（先提醒款項已付；帳單回待繳、可再請款）。
//   2. 不勾自動標記：送出後帳單維持待繳，總務手動標記已繳；作廢時手動標的不動。
//   3. 雙重請款防護與不可請款的帳單（已在別張單、小數）、店長與管理員身分看不到、有請款沒水電者不能建立但能退回與作廢。
//   4. 採購請款並存：採購與水電請款單同在一個列表，來源標籤與篩選、待付款數字、採購 CSV 預設不含水電。
//   每個劇本結束以 service role 回讀資料庫確認；資料衛生：只清自己的（cleanupGaup、cleanupM7M8）。
const P = '/api/workspace/general-affairs';
const KEYS: GaupKey[] = ['clerk', 'accountant', 'billonly', 'ga45_clerk', 'ga45_accountant', 'store_mgr', 'admin'];
test.describe.configure({ mode: 'serial' });
test.setTimeout(360_000);
let users: Record<string, GaupUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const apis: Record<string, any> = {};
const states: Record<string, any> = {};
const key = () => crypto.randomUUID();
/** 預期中的 4xx（例如缺附件被擋回 409）瀏覽器會在 console 記一筆，不算錯誤；其餘 console 錯誤與頁面例外照常失敗。 */
const real = (errs: string[]) => errs.filter((x) => !/Failed to load resource: the server responded with a status of 4[0-9][0-9]/.test(x));
const db = () => adminDb();
const vis = (page: any, id: string) => page.getByTestId(id).locator('visible=true');
const cards = (page: any, id: string) => page.locator(`[data-testid="${id}"]:visible`);
const side = (page: any, label: string) => shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first();
async function nav(page: any, label: string) {
  await openGaSide(page);
  await side(page, label).click();
}
/** 重新載入後回到請款單列表（重新載入會清掉所有已開的工作頁）。 */
async function fresh(page: any) {
  await page.reload();
  await openGaCenter(page);
  await nav(page, '請款單');
}
/** 設定環境變數 G46_SHOTS=<資料夾> 才會截圖（1920×1080，供 Remote Control 回報用）；平常不截圖、不影響測試。 */
async function shot(testInfo: any, page: any, name: string) {
  const dir = process.env.G46_SHOTS;
  if (!dir || !String(testInfo.project.name).startsWith('desktop')) return;
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.screenshot({ path: `${dir}/${name}.png` });
}
const dbBill = async (id: string) => (await db().from('ga_utility_bills').select('*').eq('id', id).single()).data as any;
const dbPr = async (id: string) => (await db().from('ga_payment_requests').select('*').eq('id', id).single()).data as any;
const dbLines = async (id: string) => ((await db().from('ga_payment_request_bill_lines').select('*').eq('pr_id', id).order('line_no')).data || []) as any[];
const mk = (payee: any, st: any, over: Record<string, unknown>) => mkBill(users.clerk.client, { payee_vendor_id: payee.id, billing_month: '2038-03-01', ...over });
const attach = (b: any) => addBillAttachment(users.clerk.client, b.id, users.clerk.id);
const ident = () => `QA-GAUP-${String(Date.now()).slice(-6)}-${Math.floor(Math.random() * 9000 + 1000)}`;

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
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupGaup(), '清除水電請款測試資料').toEqual([]);
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('劇本 1 主劇本：總務建立→缺附件被擋→送出（自動標記）→會計退回→重送→標已付款→作廢；帳單狀態全程跟著走', async ({ browser }, testInfo) => {
  const st = await stores();
  const payee = await seedPayee('J1');
  const bills = [
    await mk(payee, st, { store_id: st.VW001.id, expense_type: 'ELECTRICITY', service_identifier: ident(), amount: 1100 }),
    await mk(payee, st, { store_id: st.ZT01.id, expense_type: 'ELECTRICITY', service_identifier: ident(), amount: 2200 }),
    await mk(payee, st, { store_id: st.ZT01.id, expense_type: 'WATER', service_identifier: ident(), amount: 330 }),
  ];
  await attach(bills[0]);
  await attach(bills[1]);
  const clerk = await pageForUser(browser, states.clerk, testInfo);
  const acc = await pageForUser(browser, states.accountant, testInfo);
  try {
    // ---- 總務：建立
    const cp = clerk.page;
    await openGaCenter(cp);
    await nav(cp, '請款單');
    await vis(cp, 'new-pr-utility').click();
    await vis(cp, 'pu-month').fill('2038-03');
    await vis(cp, 'pu-vendor').selectOption(payee.id);
    await expect(cards(cp, 'pu-bill')).toHaveCount(3);
    await shot(testInfo, cp, '01-建立自動帶入');
    await expect(vis(cp, 'pu-count')).toHaveText('3');
    await expect(vis(cp, 'pu-grand')).toContainText('3,630');
    const boxes = cp.locator('[data-testid="pu-bill-check"]:visible');
    await boxes.nth(0).uncheck();
    await expect(vis(cp, 'pu-count')).toHaveText('2');
    await boxes.nth(0).check();
    await expect(vis(cp, 'pu-count')).toHaveText('3');
    await vis(cp, 'pu-save').click();
    await expect(vis(cp, 'pu-status')).toHaveText('草稿');
    await shot(testInfo, cp, '02-建立草稿');
    const created = (await db().from('ga_payment_requests').select('pr_no,id').eq('vendor_id', payee.id).single()).data!;
    const prNo = created;
    const prId = created.id as string;
    // ---- 送出被擋（缺附件）：列出缺的那一張，請款單維持草稿，帳單不動
    await vis(cp, 'pu-submit').click();
    await expect(vis(cp, 'act-auto-note')).toContainText('這 3 張帳單會標記為已繳');
    await vis(cp, 'act-confirm').click();
    await expect(cards(cp, 'missing-item')).toHaveCount(1);
    await expect(cards(cp, 'missing-item').first()).toContainText('水費');
    await vis(cp, 'missing-close').click();
    expect((await dbPr(prId)).status).toBe('DRAFT');
    for (const b of bills) expect((await dbBill(b.id)).paid_at).toBeNull();
    expect(await noPageOverflow(cp)).toBe(true);
    // ---- 補附件後送出
    await attach(bills[2]);
    await fresh(cp);
    await vis(cp, 'pr-search').fill(prNo!.pr_no);
    await vis(cp, 'open-pr').click();
    await expect(vis(cp, 'pu-status')).toHaveText('草稿');
    await vis(cp, 'pu-submit').click();
    await vis(cp, 'act-confirm').click();
    await expect(vis(cp, 'pu-status')).toHaveText('已送出');
    for (const b of bills) {
      const row = await dbBill(b.id);
      expect(row.paid_at, '繳費日期＝送出日（台北今天）').toBe(todayIso());
      expect(row.paid_by_pr_id).toBe(prId);
    }
    await expect(vis(cp, 'pu-auto-info')).toContainText('已標記 3 張');
    await shot(testInfo, cp, '03-已送出自動標記');
    // ---- 會計：看得到請款單與明細，退回（原因必填）
    const ap = acc.page;
    await openGaCenter(ap);
    await nav(ap, '請款單');
    await vis(ap, 'pr-search').fill(prNo!.pr_no);
    await vis(ap, 'open-pr').click();
    await expect(vis(ap, 'pu-status')).toHaveText('已送出');
    await expect(cards(ap, 'pu-line')).toHaveCount(3);
    await expect(vis(ap, 'pu-submit')).toHaveCount(0);
    await vis(ap, 'pu-return').click();
    await vis(ap, 'act-confirm').click();
    await expect(vis(ap, 'act-error')).toContainText('退回原因');
    await vis(ap, 'act-reason').fill('金額要再確認');
    await vis(ap, 'act-confirm').click();
    await expect(vis(ap, 'pu-status')).toHaveText('草稿');
    for (const b of bills) {
      const row = await dbBill(b.id);
      expect(row.paid_at).toBeNull();
      expect(row.paid_by_pr_id).toBeNull();
    }
    expect((await dbLines(prId)).every((l) => l.auto_revert_reason === 'RETURN' && l.active)).toBe(true);
    // ---- 總務：看到退回原因，再送出
    await fresh(cp);
    await vis(cp, 'pr-search').fill(prNo!.pr_no);
    await vis(cp, 'open-pr').click();
    await expect(vis(cp, 'pu-returned')).toContainText('金額要再確認');
    await vis(cp, 'pu-submit').click();
    await vis(cp, 'act-confirm').click();
    await expect(vis(cp, 'pu-status')).toHaveText('已送出');
    // ---- 會計：標已付款（帳單不變）
    await fresh(ap);
    await vis(ap, 'pr-search').fill(prNo!.pr_no);
    await vis(ap, 'open-pr').click();
    await expect(vis(ap, 'pu-status')).toHaveText('已送出');
    const before = await Promise.all(bills.map((b) => dbBill(b.id)));
    await vis(ap, 'pu-paid').click();
    await vis(ap, 'act-confirm').click();
    await expect(vis(ap, 'pu-status')).toHaveText('已付款');
    await expect(vis(ap, 'pu-locked')).toBeVisible();
    const after = await Promise.all(bills.map((b) => dbBill(b.id)));
    expect(after.map((b) => [b.paid_at, b.paid_by_pr_id])).toEqual(before.map((b) => [b.paid_at, b.paid_by_pr_id]));
    // 已付款鎖定：改帳單金額被擋
    const edit = await apis.clerk.patch(`${P}/utility-bills/${bills[0].id}`, { data: { amount: 9999, expected_updated_at: after[0].updated_at, confirm_paid_change: true } });
    expect(edit.status()).toBe(409);
    expect((await edit.json()).code).toBe('BILL_IN_REQUEST');
    // ---- 會計作廢：先提醒款項已付，帳單回待繳、可再請款
    await vis(ap, 'pu-void-btn').click();
    await expect(vis(ap, 'act-void-paid-warning')).toContainText('款項已付');
    await vis(ap, 'act-reason').fill('重複付款');
    await vis(ap, 'act-confirm').click();
    await expect(vis(ap, 'pu-status')).toHaveText('已作廢');
    await shot(testInfo, ap, '04-會計作廢');
    for (const b of bills) expect((await dbBill(b.id)).paid_at).toBeNull();
    expect((await dbLines(prId)).every((l) => l.active === false)).toBe(true);
    expect((await dbPr(prId)).status).toBe('VOID');
    const again = await apis.clerk.post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: payee.id, bill_month: '2038-03', idempotency_key: key() } });
    expect(again.status(), await again.text()).toBe(201);
    expect((await again.json()).data.bill_count).toBe(3);
    expect(real(clerk.errors), clerk.errors.join('\n')).toEqual([]);
    expect(real(acc.errors), acc.errors.join('\n')).toEqual([]);
  } finally {
    await clerk.ctx.close();
    await acc.ctx.close();
  }
});

test('劇本 2 不勾自動標記：送出後帳單維持待繳，總務手動標已繳；作廢時手動標的不動；自動與手動並存', async ({ browser }, testInfo) => {
  const st = await stores();
  const pm = pastMonth(2).slice(0, 7);
  const payee = await seedPayee('J2');
  const manual = await mk(payee, st, { store_id: st.VW001.id, billing_month: `${pm}-01`, service_identifier: ident(), amount: 640 });
  const autoB = await mk(payee, st, { store_id: st.VW002.id, billing_month: `${pm}-01`, service_identifier: ident(), amount: 360 });
  await attach(manual);
  await attach(autoB);
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    const c1 = await apis.clerk.post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: payee.id, bill_month: pm, bill_ids: [manual.id], auto_mark_paid: false, idempotency_key: key() } });
    const noAuto = (await c1.json()).data;
    const c2 = await apis.clerk.post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: payee.id, bill_month: pm, bill_ids: [autoB.id], auto_mark_paid: true, idempotency_key: key() } });
    const withAuto = (await c2.json()).data;
    await openGaCenter(page);
    await nav(page, '請款單');
    // 不勾那張：UI 送出（取消勾選已存為 false）
    await vis(page, 'pr-search').fill(noAuto.pr_no);
    await vis(page, 'open-pr').click();
    await expect(vis(page, 'pu-auto')).not.toBeChecked();
    await vis(page, 'pu-submit').click();
    await expect(vis(page, 'act-auto-note')).toContainText('沒有勾選自動標記');
    await vis(page, 'act-confirm').click();
    await expect(vis(page, 'pu-status')).toHaveText('已送出');
    expect((await dbBill(manual.id)).paid_at, '不勾自動標記：帳單維持待繳').toBeNull();
    // 總務手動標已繳（既有標記已繳功能）
    const mb = await dbBill(manual.id);
    const pay = await apis.clerk.post(`${P}/utility-bills/${manual.id}/pay`, { data: { paid_at: todayIso(), expected_updated_at: mb.updated_at } });
    expect(pay.status(), await pay.text()).toBe(200);
    expect((await dbBill(manual.id)).paid_by_pr_id, '手動標記沒有請款單記錄').toBeNull();
    // 勾自動標記那張送出
    const sub2 = await apis.clerk.post(`${P}/payment-requests/${withAuto.id}/actions`, { data: { action: 'submit', expected_updated_at: withAuto.updated_at, idempotency_key: key() } });
    expect(sub2.status(), await sub2.text()).toBe(200);
    expect((await dbBill(autoB.id)).paid_by_pr_id).toBe(withAuto.id);
    // 會計作廢兩張：自動標的回待繳、手動標的不動
    for (const pr of [noAuto, withAuto]) {
      const cur = await dbPr(pr.id);
      const v = await apis.accountant.post(`${P}/payment-requests/${pr.id}/actions`, { data: { action: 'void', reason: '劇本 2 作廢', expected_updated_at: cur.updated_at, idempotency_key: key() } });
      expect(v.status(), await v.text()).toBe(200);
    }
    expect((await dbBill(autoB.id)).paid_at).toBeNull();
    expect((await dbBill(manual.id)).paid_at).toBe(todayIso());
    // 帳單頁顯示：手動標記的沒有「請款單自動標記」字樣
    await nav(page, '請款單');
    expect(real(errors), errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('劇本 3 雙重請款防護與權限：同一張帳單不能放進第二張請款單；已刪除與小數的帳單不能請款；有請款沒水電者不能建立但能退回與作廢；店長與管理員身分看不到', async ({ browser }, testInfo) => {
  const st = await stores();
  const payee = await seedPayee('J3');
  const good = await mk(payee, st, { store_id: st.VW001.id, service_identifier: ident(), amount: 800 });
  const decimal = await mk(payee, st, { store_id: st.VW002.id, service_identifier: ident(), amount: 99.5 });
  const gone = await mk(payee, st, { store_id: st.ZT02.id, service_identifier: ident(), amount: 77 });
  await attach(good);
  {
    const r = await callFn(users.clerk.client, 'ga_ws_ub_delete', { p_id: gone.id, p_reason: '劇本刪除', p_confirm_paid_change: false, p_expected_updated_at: (await dbBill(gone.id)).updated_at });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
  const c1 = await apis.clerk.post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: payee.id, bill_month: '2038-03', bill_ids: [good.id], idempotency_key: key() } });
  expect(c1.status(), await c1.text()).toBe(201);
  const pr1 = (await c1.json()).data;
  // 兩個人同時用同一張帳單建立：只有一個成功（第二張已被第一張占用）
  const [r1, r2] = await Promise.all([
    apis.clerk.post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: payee.id, bill_month: '2038-03', bill_ids: [good.id], idempotency_key: key() } }),
    apis.clerk.post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: payee.id, bill_month: '2038-03', bill_ids: [good.id], idempotency_key: key() } }),
  ]);
  expect([r1.status(), r2.status()].every((s) => s === 409)).toBe(true);
  expect((await r1.json()).error).toContain(pr1.pr_no);
  for (const [b, code] of [[decimal, 'BILL_AMOUNT_INVALID'], [gone, 'BILL_DELETED']] as const) {
    const r = await apis.clerk.post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: payee.id, bill_month: '2038-03', bill_ids: [b.id], idempotency_key: key() } });
    expect(r.status()).toBe(409);
    expect((await r.json()).code).toBe(code);
  }
  // 有請款沒水電：不能建立，但能對已送出的水電請款單退回
  const blocked = await apis.ga45_clerk.post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: payee.id, bill_month: '2038-03', idempotency_key: key() } });
  expect(blocked.status()).toBe(403);
  const sub = await apis.clerk.post(`${P}/payment-requests/${pr1.id}/actions`, { data: { action: 'submit', expected_updated_at: pr1.updated_at, idempotency_key: key() } });
  expect(sub.status(), await sub.text()).toBe(200);
  const sd = (await sub.json()).data;
  const ret = await apis.ga45_accountant.post(`${P}/payment-requests/${pr1.id}/actions`, { data: { action: 'return', reason: '沒有水電權限也能退回', expected_updated_at: sd.updated_at, idempotency_key: key() } });
  expect(ret.status(), await ret.text()).toBe(200);
  expect((await dbBill(good.id)).paid_at).toBeNull();
  const rd = (await ret.json()).data;
  const vd = await apis.ga45_accountant.post(`${P}/payment-requests/${pr1.id}/actions`, { data: { action: 'void', reason: '作廢', expected_updated_at: rd.updated_at, idempotency_key: key() } });
  expect(vd.status(), await vd.text()).toBe(200);
  // 店長、管理員身分無角色：看不到入口、API 403
  for (const who of ['store_mgr', 'admin', 'billonly']) {
    expect((await apis[who].get(`${P}/payment-requests?source=UTILITY`)).status(), who).toBe(403);
    expect((await apis[who].post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: payee.id, bill_month: '2038-03', idempotency_key: key() } })).status(), who).toBe(403);
  }
  const { ctx, page, errors } = await pageForUser(browser, states.store_mgr, testInfo);
  try {
    await page.goto('/');
    await expect(page.getByTestId('pr-card')).toHaveCount(0);
    expect(errors.filter((e) => !/403|Failed to load resource/.test(e)), errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('劇本 4 採購與水電並存：同一個列表、來源標籤與篩選、待付款數字與點進去筆數一致、採購 CSV 預設不含水電、採購主線不受水電影響', async ({ browser }, testInfo) => {
  const st = await stores();
  // 採購主線（API）：採購單→進貨→請款單→送出
  const vendor = await seedGa45Vendor(`J4${Date.now() % 100000}`);
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const r: any = await callFn(users.ga45_clerk.client, name, args);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    return r.data as any;
  };
  const d = await rpc('ga_ws_po_create', { p_header: { notes: m7Name('J4'), vendor_id: vendor.id }, p_items: [{ item_name: 'QA-GAUP 採購品', unit: '個', quantity: 10, unit_price: 100 }], p_create_key: key() });
  const po = await rpc('ga_ws_po_action', { p_id: d.id, p_action: 'place_order', p_expected_updated_at: d.updated_at, p_note: null });
  const rc = await rpc('ga_ws_po_receive', { p_po_id: po.id, p_header: {}, p_lines: [{ po_item_id: po.items.find((i: any) => i.line_no === 1).id, delivered_qty: 10 }], p_key: key() });
  const cp = await apis.ga45_clerk.post(`${P}/payment-requests`, { data: { vendor_id: vendor.id, lines: [{ receipt_id: rc.id }], idempotency_key: key() } });
  expect(cp.status(), await cp.text()).toBe(201);
  const purchase = (await cp.json()).data;
  expect(purchase.source).toBe('PURCHASE');
  const subP = await apis.ga45_clerk.post(`${P}/payment-requests/${purchase.id}/actions`, { data: { action: 'submit', expected_updated_at: purchase.updated_at, idempotency_key: key() } });
  expect(subP.status(), await subP.text()).toBe(200);
  // 水電請款單（已送出）
  const payee = await seedPayee('J4');
  const b = await mk(payee, st, { store_id: st.VW001.id, service_identifier: ident(), amount: 555 });
  await attach(b);
  const cu = await apis.clerk.post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: payee.id, bill_month: '2038-03', idempotency_key: key() } });
  const util = (await cu.json()).data;
  const subU = await apis.clerk.post(`${P}/payment-requests/${util.id}/actions`, { data: { action: 'submit', expected_updated_at: util.updated_at, idempotency_key: key() } });
  expect(subU.status(), await subU.text()).toBe(200);
  const { ctx, page, errors } = await pageForUser(browser, states.accountant, testInfo);
  try {
    await openGaCenter(page);
    await nav(page, '請款單');
    await vis(page, 'pr-search').fill('PY-');
    await vis(page, 'pr-filter-source').selectOption('');
    const total = await page.getByTestId('pr-pay-count').locator('visible=true').innerText();
    await vis(page, 'pr-tab-pay').click();
    await expect(vis(page, 'pr-total')).toContainText(`共 ${total} 張`);
    // 兩種來源都在待付款裡
    await vis(page, 'pr-search').fill(purchase.pr_no);
    await expect(cards(page, 'pr-card')).toHaveCount(1);
    await expect(vis(page, 'pr-source')).toHaveText('採購');
    await vis(page, 'pr-search').fill(util.pr_no);
    await expect(cards(page, 'pr-card')).toHaveCount(1);
    await expect(vis(page, 'pr-source')).toHaveText('水電話費');
    // 來源篩選
    await vis(page, 'pr-search').fill('');
    await vis(page, 'pr-filter-source').selectOption('UTILITY');
    await expect(cards(page, 'pr-card').filter({ hasText: util.pr_no })).toHaveCount(1);
    await expect(cards(page, 'pr-card').filter({ hasText: purchase.pr_no })).toHaveCount(0);
    expect(await noPageOverflow(page)).toBe(true);
    expect(real(errors), errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
  // 採購 CSV 預設不含水電；水電 CSV 是另一份
  const ym = todayIso().slice(0, 7);
  const csvP = await apis.accountant.get(`${P}/payment-requests/export?month=${ym}&vendorId=${vendor.id}`);
  const tp = await csvP.text();
  expect(csvP.status()).toBe(200);
  expect(tp).toContain(purchase.pr_no);
  expect(tp).not.toContain(util.pr_no);
  const csvU = await apis.accountant.get(`${P}/payment-requests/export?month=${ym}&vendorId=${payee.id}&source=UTILITY`);
  const tu = await csvU.text();
  expect(csvU.status()).toBe(200);
  expect(tu).toContain(util.pr_no);
  expect(tu).not.toContain('採購單號');
  // 採購額度不受水電單影響：這張採購單已請滿
  const sum: any = await callFn(users.ga45_clerk.client, 'ga_ws_pay_po_summary', { p_po_id: po.id });
  expect(sum.ok, JSON.stringify(sum)).toBe(true);
  expect(Number(sum.data.claimed_total)).toBe(1050);
});
