import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Browser, type BrowserContext, type Locator, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { TEST_ORIGIN } from '../support/auth';
import { noPageOverflow, openGaCenter, openGaSide, shell } from '../support/g01-ui';
import { dialog } from '../support/g12-ui';
import {
  adminDb, assertDevOnly, cleanupGk1Data, GK1_PREFIX, type Gk1Key, type Gk1Seed, type Gk1User, keepData, mkUtilityBill, seedGk1Master, setupGk1Users, SHOTS_DIR, stores, uniqueTaxId,
} from '../support/m9-gk1-fixtures';

// M9-GK1 角色接力劇本「總務採購與請款改善第一批（ga-improve-b1）整套走一遍」（桌機 1920x1080 跑一次，資料跑完保留給老闆查看）：
//  1. 請款單頁設定兩家買受人公司（假名）。
//  2. MOMO 網購 EPSON L6490 印表機 10 台，單價 11,490 選「含稅」，加運費 0 與折價券 -500；含稅總額 114,400；簽核主管核准、總務下訂。
//  3. 到貨前，總務開「預付」請款單（全額）、送出，會計用信用卡（末四碼）付款。另造一張預計到貨日已過的採購單加預付，確認出現在逾期追蹤（採購單列表、請款單「預付逾期」篩選、首頁待辦）。
//  4. 到貨驗入後預付自動核銷，進貨單含稅額與核銷金額一致；請款單挑不到這張進貨單、強制呼叫 API 也被擋。
//  5. 同仁代墊：小額採購由同仁甲代墊（請款單付款對象是同仁甲，會計轉帳還給同仁）；一張電費帳單由門市同仁乙先繳，水電請款單付款對象選同仁乙。
//  6. 另一張請款單選第二家公司抬頭，會計用網購平台付款，列印頁印出所選抬頭。
//  7. 權限名稱「水電話網費管理」、兩個小錯字（確認完成。／已核銷進貨單不再顯示登錄憑證）。
// 資料全部帶 ZTK- 前綴。GK1_KEEP 預設 1：跑完保留資料給老闆在測試區查看；GK1_KEEP=0 才在結束時呼叫 scripts/ga-improve-b1-cleanup.cjs 的清除函式。
// 步驟結果寫在 tests/reports/_shots_ga_improve_b1/journey/steps.json，截圖也存在同一個資料夾。
const P = '/api/workspace/general-affairs';
const BASE = P;
const SCRIPT = { qty: 10, unitPrice: 11490, freight: 0, coupon: 500, total: 114400, subtotal: 108952, tax: 5448, listPrice: 13490 };
const CARD_LAST4 = '5678';
const NIGHT = '2038-11'; // 水電帳單月份

type Status = '通過' | '失敗';
type Rec = { no: string; role: string; title: string; status: Status; shot: string[]; note: string };
const recs: Rec[] = [];
const consoleIssues: string[] = [];
const layoutIssues: string[] = [];
const practical: string[] = [];
let cur: { no: string; shots: string[]; notes: string[]; errors: string[] } = { no: '', shots: [], notes: [], errors: [] };

const key = () => crypto.randomUUID();
const taipeiDay = (offset = 0) => new Date(Date.now() + 8 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);
const db = () => adminDb();
const vis = (page: Page, testid: string): Locator => page.getByTestId(testid).locator('visible=true');
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('visible=true').first();
const realErrors = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const money = (n: number) => n.toLocaleString('en-US');

let users = {} as Record<Gk1Key, Gk1User>;
let seed: Gk1Seed;
let sid: Record<string, string> = {};
const states: Record<string, any> = {};
const apis: Record<string, any> = {};
const S = {
  companyA: { id: '', name: `${GK1_PREFIX}富康示範甲股份有限公司`, tax: '' }, companyB: { id: '', name: `${GK1_PREFIX}富康示範乙有限公司`, tax: '' },
  po1: { id: '', no: '' }, prepay1: { id: '', no: '' }, receipt1: { id: '', no: '' },
  po2: { id: '', no: '' }, prepay2: { id: '', no: '' },
  po3: { id: '', no: '' }, receipt3: { id: '', no: '' }, pr3: { id: '', no: '' },
  bill: { id: '' }, prUb: { id: '', no: '' },
  po4: { id: '', no: '' }, receipt4: { id: '', no: '' }, pr4: { id: '', no: '' },
  po5: { id: '', no: '' }, receipt5: { id: '', no: '' },
  req: { id: '', no: '' },
};

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });

test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop-1440') return; // 手機 project 不跑，也不准動資料（否則會把桌機剛建的資料清掉）
  test.setTimeout(400_000);
  assertDevOnly();
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  for (const f of fs.readdirSync(SHOTS_DIR)) if (/^\d.*\.png$/.test(f) || f === 'steps.json') fs.rmSync(path.join(SHOTS_DIR, f), { force: true });
  const left = await cleanupGk1Data(); // 可重跑：上次留下的 ZTK- 資料先清掉再重建
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  users = await setupGk1Users();
  seed = await seedGk1Master();
  const st = await stores();
  sid = { ZT01: st.ZT01.id };
  S.companyA.tax = uniqueTaxId();
  S.companyB.tax = uniqueTaxId();
  for (const k of Object.keys(users) as Gk1Key[]) {
    apis[k] = await apiForUser({ key: k, email: users[k].email, password: users[k].password } as any);
    states[k] = await apis[k].storageState();
  }
});

test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop-1440') return;
  for (const c of Object.values(apis)) await c.dispose();
  if (!keepData()) expect(await cleanupGk1Data(), '清除 ZTK- 資料').toEqual([]);
});

type Who = { ctx: BrowserContext; page: Page };
async function open(browser: Browser, who: Gk1Key): Promise<Who> {
  const ctx = await browser.newContext({ baseURL: TEST_ORIGIN, storageState: states[who], serviceWorkers: 'block', viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => cur.errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && cur.errors.push(m.text()));
  return { ctx, page };
}
async function shot(page: Page, name: string) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.evaluate(() => (document as any).fonts?.ready).catch(() => undefined);
  const file = `${cur.no}-${name}.png`;
  await page.screenshot({ path: path.join(SHOTS_DIR, file) });
  cur.shots.push(file);
  if (!(await noPageOverflow(page).catch(() => true))) layoutIssues.push(`${cur.no} ${name}：頁面有橫向捲動`);
}
const note = (t: string) => cur.notes.push(t);
const issue = (t: string) => { practical.push(`${cur.no}：${t}`); cur.notes.push(`實務問題：${t}`); };

function writeSteps() {
  fs.writeFileSync(path.join(SHOTS_DIR, 'steps.json'), JSON.stringify({ recs, consoleIssues, layoutIssues, practical, ids: S, keep: keepData(), finishedAt: new Date().toISOString() }, null, 2));
}
/** 一個劇本步驟：用 test.step 包起來，例外記為失敗但不中斷後面步驟。 */
async function step(no: string, role: string, title: string, fn: () => Promise<void>) {
  cur = { no, shots: [], notes: [], errors: [] };
  let status: Status = '通過';
  await test.step(`${no} ${title}（${role}）`, async () => {
    try {
      await fn();
    } catch (e) {
      status = '失敗';
      cur.notes.push(`失敗：${String((e as Error).message).split('\n').slice(0, 6).join(' / ').slice(0, 700)}`);
    }
  });
  const errs = realErrors(cur.errors);
  if (errs.length) {
    cur.notes.push(`console 錯誤：${errs.slice(0, 3).join(' | ').slice(0, 300)}`);
    consoleIssues.push(`${no} ${title}：${errs.slice(0, 3).join(' | ').slice(0, 300)}`);
  }
  recs.push({ no, role, title, status, shot: cur.shots, note: cur.notes.join('；') });
  writeSteps();
}

async function nav(page: Page, label: string) {
  await openGaSide(page);
  await shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first().click();
}
async function pickIn(scope: Locator, testid: string, term: string) {
  const input = scope.getByTestId(testid).locator('visible=true').first();
  await input.click();
  await input.fill(term);
  const opt = scope.getByTestId(`${testid}-option`).filter({ hasText: term }).first();
  await expect(opt).toBeVisible();
  await opt.click();
  await expect(scope.getByTestId(`${testid}-picked`).locator('visible=true').first()).toBeVisible();
}
async function post(who: Gk1Key, p: string, data: unknown, expectOk = true) {
  const r = await apis[who].post(`${P}${p}`, { data });
  if (expectOk) expect(r.status(), `${p}: ${await r.text()}`).toBeLessThan(300);
  return { status: r.status() as number, body: (await r.json().catch(() => ({}))) as any };
}
const dbPo = async (id: string) => (await db().from('ga_purchase_orders').select('*').eq('id', id).single()).data as any;
const dbPr = async (id: string) => (await db().from('ga_payment_requests').select('*').eq('id', id).single()).data as any;
const dbBal = async () => Number(((await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', seed.loc.id).eq('part_id', seed.part.id).maybeSingle()).data as any)?.quantity_base ?? 0);
const dbLedger = async (prId: string) => ((await db().from('ga_payment_prepay_ledger').select('*').eq('prepay_pr_id', prId).order('created_at').order('id')).data || []) as any[];

async function openPoDetail(page: Page, no: string) {
  await nav(page, '採購單');
  await expect(heading(page, '採購單')).toBeVisible();
  await vis(page, 'po-search').fill(no);
  const card = page.locator('[data-testid="po-card"]:visible', { hasText: no });
  await expect(card).toHaveCount(1);
  await card.getByTestId('open-detail').click();
  await expect(dialog(page).getByTestId('po-detail')).toBeVisible();
}
async function poAct(page: Page, action: string, noteText?: string, expectNotice: RegExp = /已/) {
  const d = dialog(page);
  await d.getByTestId(`act-${action}`).click();
  await expect(d.getByTestId('action-form')).toBeVisible();
  if (noteText !== undefined) await d.getByTestId('f-note').fill(noteText);
  await d.getByTestId('action-submit').click();
  await expect(d.getByTestId('pd-notice')).toContainText(expectNotice);
}
async function openPr(page: Page, prNo: string) {
  await nav(page, '請款單');
  await expect(heading(page, '請款單')).toBeVisible();
  await vis(page, 'pr-search').fill(prNo);
  const card = page.locator('[data-testid="pr-card"]:visible', { hasText: prNo });
  await expect(card).toHaveCount(1);
  await card.getByTestId('open-pr').click();
}
const prNoOnPage = async (page: Page) => (await page.locator('h1:visible').first().innerText()).match(/PY-\d{8}-\d{3,}/)![0];
async function confirmAction(page: Page, btn: string, fill?: { reason?: string }) {
  await vis(page, btn).click();
  if (fill?.reason !== undefined) await vis(page, 'act-reason').fill(fill.reason);
  await vis(page, 'act-confirm').click();
}
/** 以 API 建立並下訂一張免核准的小額採購單（品項不進庫存）。 */
async function apiPo(title: string, qty: number, price: number, header: Record<string, unknown> = {}) {
  const c = (await post('buyer', '/purchase-orders', {
    header: { vendor_id: seed.vendor.id, notes: `${GK1_PREFIX}${title}`, ...header },
    items: [{ item_name: `${GK1_PREFIX}${title}`, unit: '個', quantity: qty, unit_price: price, fulfil_mode: 'NO_STOCK' }], idempotency_key: key(),
  })).body.data;
  return (await post('buyer', `/purchase-orders/${c.id}/actions`, { action: 'place_order', expected_updated_at: c.updated_at })).body.data;
}
async function apiReceive(po: any, qty: number) {
  const r = await post('buyer', `/purchase-orders/${po.id}/receipts`, { header: {}, lines: [{ po_item_id: po.items[0].id, delivered_qty: qty, accepted_qty: qty }], idempotency_key: key() });
  return { receipt: (r.body.receiving.receipts as any[]).find((x) => !x.voided_at), order: r.body.order };
}
/** 同仁登錄匯款帳戶（畫面：我的代墊款）。 */
async function staffRegisterAccount(browser: Browser, who: 'staffA' | 'staffB', account: string, shotName?: string) {
  const w = await open(browser, who);
  try {
    await w.page.goto('/workspace/index.html');
    await w.page.getByTestId('open-my-reimbursements').click();
    await expect(w.page.getByTestId('mr-no-account')).toBeVisible();
    await w.page.getByTestId('mr-edit-account').click();
    await w.page.getByTestId('payout-bank').fill('測試銀行');
    await w.page.getByTestId('payout-account').fill(account);
    await w.page.getByTestId('payout-name').fill(`${users[who].name} 測試戶名`);
    await w.page.getByTestId('payout-save').click();
    await expect(w.page.getByTestId('mr-account')).toContainText(account.slice(-4));
    if (shotName) await shot(w.page, shotName);
  } finally { await w.ctx.close(); }
}

test('M9-GK1 ga-improve-b1 多角色劇本（多家抬頭、含稅採購單與調整列、預付款、同仁代墊、付款方式、權限名稱與小錯字）', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用 1920x1080 桌機，只在桌機 project 跑一次');
  test.setTimeout(2_400_000);

  // ============================================================ 0 前置
  await step('0', '系統前置（fixture）', '建立測試帳號（總務、簽核主管、會計、水電總務、店長、兩位同仁）與廠商 ZTK-MOMO、繳費單位 ZTK-台電、印表機料件與總部倉', async () => {
    const v = (await db().from('ga_vendors').select('name,status').eq('id', seed.vendor.id).single()).data as any;
    expect(v).toMatchObject({ name: `${GK1_PREFIX}MOMO`, status: 'active' });
    expect(Object.keys(users).sort()).toEqual(['accountant', 'approver', 'buyer', 'staffA', 'staffB', 'store', 'ubclerk']);
    note('帳號清單與密碼在 accounts.json（只存在本機，測試區專用）；一律用既有真實角色，只有「店長」「同仁」兩個臨時角色（ztk_store_requester、ztk_staff）');
  });

  // ============================================================ 1 買受人公司
  await step('1', '總務（請款管理）', '請款單頁設定兩家買受人公司（假名＋統編）', async () => {
    const w = await open(browser, 'buyer');
    try {
      await openGaCenter(w.page);
      await nav(w.page, '請款單');
      await expect(heading(w.page, '請款單')).toBeVisible();
      await vis(w.page, 'pr-settings').click();
      const form = vis(w.page, 'pay-settings-form');
      await expect(form).toBeVisible();
      for (const c of [S.companyA, S.companyB]) {
        await expect(form.getByTestId('ps-company-new-name')).toHaveValue(''); // 上一家新增完成、輸入框清空後才填下一家（否則會被清掉）
        await form.getByTestId('ps-company-new-name').fill(c.name);
        await form.getByTestId('ps-company-new-tax').fill(c.tax);
        await form.getByTestId('ps-company-add').click();
        await expect(form.getByTestId('ps-company').filter({ hasText: c.name })).toHaveCount(1);
        await expect(form.getByTestId('ps-company-new-name')).toHaveValue('');
      }
      const rowsNow = ((await db().from('ga_buyer_companies').select('*').like('name', `${GK1_PREFIX}%`)).data || []) as any[];
      expect(rowsNow).toHaveLength(2);
      S.companyA.id = rowsNow.find((r) => r.tax_id === S.companyA.tax).id;
      S.companyB.id = rowsNow.find((r) => r.tax_id === S.companyB.tax).id;
      // 甲公司設為預設（採購單與請款單不另選時用它）
      if (!rowsNow.find((r) => r.id === S.companyA.id).is_default) {
        await form.getByTestId('ps-company-default-' + S.companyA.tax).click();
        await expect(form.getByTestId('ps-company').filter({ hasText: S.companyA.name }).getByTestId('ps-company-default')).toBeVisible();
      }
      await expect(form.getByTestId('ps-title')).toHaveValue(S.companyA.name);
      await shot(w.page, '兩家買受人公司');
      const after = ((await db().from('ga_buyer_companies').select('id,is_default,is_active').in('id', [S.companyA.id, S.companyB.id])).data || []) as any[];
      expect(after.find((r) => r.id === S.companyA.id)).toMatchObject({ is_default: true, is_active: true });
      expect(after.find((r) => r.id === S.companyB.id)).toMatchObject({ is_default: false, is_active: true });
      note(`甲公司 ${S.companyA.name}（統編 ${S.companyA.tax}，預設）、乙公司 ${S.companyB.name}（統編 ${S.companyB.tax}）；統編為測試隨機碼`);
    } finally { await w.ctx.close(); }
  });

  // ============================================================ 2 MOMO 採購單（含稅、運費 0、折價券 -500）
  await step('2-1', '總務採購（開單人）', 'MOMO 網購 EPSON L6490 × 10：單價 11,490 選「含稅」、運費 0、折價券 -500、抬頭選甲公司', async () => {
    const w = await open(browser, 'buyer');
    try {
      await openGaCenter(w.page);
      await nav(w.page, '採購單');
      await vis(w.page, 'new-po').click();
      await expect(heading(w.page, '新增採購單')).toBeVisible();
      const form = vis(w.page, 'po-form');
      await pickIn(form, 'pe-vendor', seed.vendor.name);
      await pickIn(form, 'pe-location', seed.loc.name);
      await form.getByTestId('pe-price-mode').selectOption('INCL');
      await pickIn(form, 'pe-part-0', seed.part.name);
      await form.getByTestId('pe-qty-0').fill(String(SCRIPT.qty));
      await form.getByTestId('pe-price-0').fill(String(SCRIPT.unitPrice));
      await form.getByTestId('pe-adj-add-FREIGHT').click();
      await form.getByTestId('pe-adj-amount-0').fill(String(SCRIPT.freight));
      await form.getByTestId('pe-adj-add-COUPON').click();
      await form.getByTestId('pe-adj-label-1').fill('MOMO 折價券');
      await form.getByTestId('pe-adj-amount-1').fill(String(SCRIPT.coupon));
      await form.getByTestId('pe-adj-orig-1').fill(String(SCRIPT.listPrice));
      await form.getByTestId('pe-adj-campaign-1').fill('MOMO 1111 活動');
      await form.getByTestId('pe-buyer').selectOption(S.companyA.id);
      await form.getByTestId('pe-expected').fill(taipeiDay(7));
      await form.getByTestId('pe-notes').fill(`${GK1_PREFIX}MOMO 1111：EPSON L6490 × 10，單價 11,490（含稅），折價券 -500，運費 0`);
      await expect(form.getByTestId('pe-total')).toHaveText(`$${money(SCRIPT.total)}`);
      // 運費 0：系統規定調整列金額不能是 0（免運費就不要加這一列），先照老闆劇本填 0 看系統怎麼回，再把這一列移除
      await form.getByTestId('pe-save').click();
      await expect(vis(w.page, 'pe-error')).toContainText('不能是 0');
      note(`運費填 0 按儲存：系統擋下並提示「${(await vis(w.page, 'pe-error').innerText()).trim().slice(0, 60)}」`);
      issue('調整列的「運費 0」存不進去（金額不能是 0）。免運費不用加運費列，總額一樣；若老闆希望能記一筆「運費 0（免運）」留痕，需要另外決定');
      await shot(w.page, '運費填0被擋');
      await form.getByTestId('pe-adj-remove-0').click(); // 移除運費列，折價券列變成第 0 列
      await expect(form.getByTestId('pe-adj-amount-0')).toHaveValue(String(SCRIPT.coupon));
      await expect(form.getByTestId('pe-total')).toHaveText(`$${money(SCRIPT.total)}`);
      await shot(w.page, '新增採購單含稅與調整列');
      await form.getByTestId('pe-totals').scrollIntoViewIfNeeded();
      await shot(w.page, '新增採購單金額換算');
      await form.getByTestId('pe-save').click();
      await expect(vis(w.page, 'pe-saved')).toBeVisible();
      S.po1.no = (await vis(w.page, 'pe-po-no').textContent())!.trim();
      const po = (await db().from('ga_purchase_orders').select('*').eq('po_no', S.po1.no).single()).data as any;
      S.po1.id = po.id;
      expect(po).toMatchObject({ status: 'DRAFT', price_mode: 'INCL', buyer_company_id: S.companyA.id, vendor_id: seed.vendor.id });
      expect(Number(po.total_amount)).toBe(SCRIPT.total);
      expect(Number(po.subtotal)).toBe(SCRIPT.subtotal);
      expect(Number(po.tax_amount)).toBe(SCRIPT.tax);
      expect(Number(po.subtotal) + Number(po.tax_amount)).toBe(Number(po.total_amount));
      const adj = ((await db().from('ga_purchase_order_adjustments').select('*').eq('po_id', po.id).order('line_no')).data || []) as any[];
      expect(adj.map((a) => [a.kind, Number(a.amount)])).toEqual([['COUPON', -SCRIPT.coupon]]);
      expect(adj[0]).toMatchObject({ campaign_name: 'MOMO 1111 活動' });
      expect(Number(adj[0].original_price)).toBe(SCRIPT.listPrice);
      note(`含稅總額 ${money(SCRIPT.total)}（10 × 11,490 = 114,900，折價券 −500）；系統換算未稅 ${money(SCRIPT.subtotal)}、稅額 ${money(SCRIPT.tax)}，兩者相加剛好等於含稅總額；調整列：折價券 −500（原價 13,490、活動 MOMO 1111 活動 記在調整列備註）；運費 0 不能記成一列（見上）`);
    } finally { await w.ctx.close(); }
  });

  await step('2-2', '總務採購、簽核主管、總務採購', '送核准（超過 5,000 門檻）→ 主管在待簽核清單核准 → 總務下訂', async () => {
    const w = await open(browser, 'buyer');
    try {
      await openGaCenter(w.page);
      await openPoDetail(w.page, S.po1.no);
      await expect(dialog(w.page).getByTestId('pd-status')).toHaveText('草稿');
      await expect(dialog(w.page).getByTestId('act-place_order')).toHaveCount(0);
      await poAct(w.page, 'submit', `請核准採購 EPSON L6490 × 10（含稅 ${money(SCRIPT.total)}）`, /已送核准/);
      expect((await dbPo(S.po1.id)).status).toBe('PENDING_APPROVAL');
    } finally { await w.ctx.close(); }
    const ap = await open(browser, 'approver');
    try {
      await openGaCenter(ap.page);
      await nav(ap.page, '待簽核採購單');
      await expect(heading(ap.page, '待簽核採購單')).toBeVisible();
      const card = ap.page.locator('[data-testid="ap-card"]:visible', { hasText: S.po1.no });
      await expect(card).toHaveCount(1);
      await expect(card.getByTestId('ap-amount')).toHaveText(`$${money(SCRIPT.total)}`);
      await shot(ap.page, '待簽核清單');
      await card.getByTestId('open-approve').click();
      await expect(dialog(ap.page).getByTestId('po-detail')).toBeVisible();
      await shot(ap.page, '主管看採購單詳情');
      await poAct(ap.page, 'approve', '同意採購', /已核准/);
      const po = await dbPo(S.po1.id);
      expect(po).toMatchObject({ status: 'APPROVED', approval_note: '同意採購' });
      expect(po.approved_by).toBe(users.approver.id);
    } finally { await ap.ctx.close(); }
    const w2 = await open(browser, 'buyer');
    try {
      await openGaCenter(w2.page);
      await openPoDetail(w2.page, S.po1.no);
      await expect(dialog(w2.page).getByTestId('pd-status')).toContainText('已核准');
      await poAct(w2.page, 'place_order', undefined, /已下訂/);
      await expect(dialog(w2.page).getByTestId('pd-status')).toHaveText('已下訂');
      await expect(dialog(w2.page).getByTestId('pd-buyer')).toContainText(S.companyA.name);
      await shot(w2.page, '下訂後採購單詳情');
      const po = await dbPo(S.po1.id);
      expect(po.status).toBe('ORDERED');
      expect(po.buyer_company_id).toBe(S.companyA.id);
    } finally { await w2.ctx.close(); }
  });

  // ============================================================ 3 預付（信用卡）與逾期追蹤
  await step('3-1', '總務採購', '到貨前在採購單詳情按「預付」，建立全額預付請款單並送出', async () => {
    const w = await open(browser, 'buyer');
    try {
      await openGaCenter(w.page);
      await openPoDetail(w.page, S.po1.no);
      await dialog(w.page).getByTestId('act-prepay').click();
      const pf = w.page.getByTestId('prepay-form');
      await expect(pf).toBeVisible();
      await expect(pf.getByTestId('prepay-no-eta')).toHaveCount(0); // 有填預計到貨日，不會出現沒填的提醒
      await pf.getByTestId('prepay-amount').fill(String(SCRIPT.total));
      await pf.getByTestId('prepay-notes').fill(`${GK1_PREFIX}MOMO 網購先付款（信用卡）`);
      await shot(w.page, '建立預付款表單');
      await pf.getByTestId('prepay-submit').click();
      await expect(vis(w.page, 'pe-kind')).toHaveText('預付款');
      await expect(vis(w.page, 'pe-status')).toHaveText('草稿');
      S.prepay1.no = await prNoOnPage(w.page);
      const pre = (await db().from('ga_payment_requests').select('*').eq('pr_no', S.prepay1.no).single()).data as any;
      S.prepay1.id = pre.id;
      expect(pre).toMatchObject({ pay_kind: 'PREPAY', prepay_po_id: S.po1.id, status: 'DRAFT', buyer_company_id: S.companyA.id });
      expect(Number(pre.amount_total)).toBe(SCRIPT.total);
      await confirmAction(w.page, 'pe-submit');
      await expect(vis(w.page, 'pe-status')).toHaveText('已送出');
      await shot(w.page, '預付請款單已送出');
      expect((await dbPr(S.prepay1.id)).status).toBe('SUBMITTED');
      note(`預付請款單 ${S.prepay1.no}：採購單 ${S.po1.no} 下訂後、還沒到貨就開得出來（單據類型「預付款」）`);
    } finally { await w.ctx.close(); }
  });

  await step('3-2', '會計（付款負責人）', '預付請款單標記已付款：付款方式「信用卡」、卡號末四碼', async () => {
    const w = await open(browser, 'accountant');
    try {
      await openGaCenter(w.page);
      await openPr(w.page, S.prepay1.no);
      await expect(vis(w.page, 'pe-prepay-total')).toHaveText(`$${money(SCRIPT.total)}`);
      await vis(w.page, 'pe-paid').click();
      const opts = await dialog(w.page).getByTestId('act-method').locator('option').allTextContents();
      note(`付款方式選單：${opts.join('、')}`);
      await dialog(w.page).getByTestId('act-method').selectOption('CREDIT_CARD');
      await dialog(w.page).getByTestId('act-card').fill(CARD_LAST4);
      await dialog(w.page).getByTestId('act-ref').fill('ZTK-MOMO-1111-CC');
      await shot(w.page, '標記已付款信用卡');
      await vis(w.page, 'act-confirm').click();
      await expect(vis(w.page, 'pe-status')).toHaveText('已付款');
      await expect(vis(w.page, 'pe-paid-info')).toContainText(`卡號末四碼 ${CARD_LAST4}`);
      await shot(w.page, '預付已付款');
      expect(await dbPr(S.prepay1.id)).toMatchObject({ status: 'PAID', pay_method: 'CREDIT_CARD', pay_card_last4: CARD_LAST4 });
      const led = await dbLedger(S.prepay1.id);
      expect(led.filter((g) => !g.reversed_at)).toEqual([]); // 預付款付清後餘額來自已付款預付單金額；核銷帳本只記核銷與退款，到貨前沒有任何核銷
      note('只存卡號末四碼，不存完整卡號');
    } finally { await w.ctx.close(); }
  });

  await step('3-3', '總務採購、會計', '逾期預付追蹤：另造一張預計到貨日已過 3 天的採購單，預付 1,000 後出現在採購單列表、請款單「預付逾期」篩選與首頁待辦', async () => {
    const po2 = await apiPo('逾期未到貨墨水匣（預計到貨日已過）', 4, 500, { expected_delivery_date: taipeiDay(-3) });
    S.po2 = { id: po2.id, no: po2.po_no };
    const pre = (await post('buyer', '/payment-requests/prepay', { po_id: po2.id, amount: 1000, notes: `${GK1_PREFIX}墨水匣先付訂金（網購平台）`, idempotency_key: key() })).body.data;
    const sub = (await post('buyer', `/payment-requests/${pre.id}/actions`, { action: 'submit', expected_updated_at: pre.updated_at, idempotency_key: key() })).body.data;
    await post('accountant', `/payment-requests/${pre.id}/actions`, { action: 'mark_paid', pay_method: 'ONLINE_PLATFORM', platform: '蝦皮', paid_ref: 'ZTK-INK-PREPAY', expected_updated_at: sub.updated_at, idempotency_key: key() });
    S.prepay2 = { id: pre.id, no: pre.pr_no };
    expect(await dbPr(pre.id)).toMatchObject({ status: 'PAID', pay_method: 'ONLINE_PLATFORM', pay_platform: '蝦皮', pay_kind: 'PREPAY' });
    const w = await open(browser, 'buyer');
    try {
      await openGaCenter(w.page);
      // 首頁待辦（等「待我處理」載入完成）
      await expect(w.page.getByText('載入中')).toHaveCount(0, { timeout: 20_000 });
      await w.page.waitForTimeout(800);
      await shot(w.page, '總務服務中心首頁待辦');
      const todo = await w.page.getByText('逾期未到貨採購單').first().isVisible().catch(() => false);
      note(`首頁待辦「逾期未到貨採購單」${todo ? '有出現' : '沒有出現'}`);
      expect(todo).toBe(true);
      // 採購單列表
      await nav(w.page, '採購單');
      await vis(w.page, 'po-search').fill(S.po2.no);
      const card = w.page.locator('[data-testid="po-card"]:visible', { hasText: S.po2.no });
      await expect(card).toHaveCount(1);
      await expect(card.getByTestId('po-prepaid')).toContainText('已預付 $1,000');
      await expect(card.getByTestId('po-prepaid')).toContainText('逾期未到貨');
      await shot(w.page, '採購單列表預付逾期');
      await card.getByTestId('open-detail').click();
      await expect(dialog(w.page).getByTestId('po-detail')).toBeVisible();
      await shot(w.page, '逾期採購單詳情預付摘要');
      await dialog(w.page).getByTestId('pd-close').click();
      // 請款單列表「只看逾期未到貨的預付款」
      await nav(w.page, '請款單');
      await vis(w.page, 'pr-prepay-overdue-toggle').check();
      const pcard = w.page.locator('[data-testid="pr-card"]:visible', { hasText: S.prepay2.no });
      await expect(pcard).toHaveCount(1);
      await expect(pcard.getByTestId('pr-prepay-info')).toContainText('逾期未到貨');
      await expect(w.page.locator('[data-testid="pr-card"]:visible', { hasText: S.prepay1.no })).toHaveCount(0); // 第一張還沒到預計到貨日，不算逾期
      await shot(w.page, '請款單預付逾期篩選');
      note(`逾期預付：採購單 ${S.po2.no}（預計到貨日 ${taipeiDay(-3)}）預付 1,000，請款單 ${S.prepay2.no}；這組資料故意保留在逾期狀態；MOMO 那張預付（${S.prepay1.no}）預計到貨日還沒到，不會被標逾期`);
    } finally { await w.ctx.close(); }
  });

  // ============================================================ 4 到貨自動核銷
  await step('4-1', '總務採購', 'MOMO 到貨 10 台驗入總部庫存：預付自動核銷 114,400，進貨單含稅額與核銷一致', async () => {
    const w = await open(browser, 'buyer');
    try {
      await openGaCenter(w.page);
      await openPoDetail(w.page, S.po1.no);
      await dialog(w.page).getByTestId('act-receipt').click();
      const rf = dialog(w.page).getByTestId('receipt-form');
      await expect(rf).toBeVisible();
      await expect(rf.getByTestId('rc-prepay-note')).toContainText(money(SCRIPT.total));
      await rf.getByTestId('rc-delivered-0').fill(String(SCRIPT.qty));
      await shot(w.page, '登錄到貨提示預付核銷');
      await rf.getByTestId('rc-submit').click();
      await expect(dialog(w.page).getByTestId('pd-notice')).toContainText('到貨已登錄');
      await expect(dialog(w.page).getByTestId('pd-status')).toHaveText('全部到貨');
      await expect(dialog(w.page).getByTestId('pd-receipt-total')).toContainText(`$${money(SCRIPT.total)}`);
      await expect(dialog(w.page).getByTestId('pd-receipt-offset')).toContainText(`$${money(SCRIPT.total)}`);
      await expect(dialog(w.page).getByTestId('pd-prepay-balance')).toHaveText('$0');
      await expect(dialog(w.page).getByTestId('pd-prepay-offset')).toHaveText(`$${money(SCRIPT.total)}`);
      await shot(w.page, '到貨後預付自動核銷');
      expect(await dbBal()).toBe(SCRIPT.qty);
      const rc = ((await db().from('ga_purchase_receipts').select('*').eq('po_id', S.po1.id)).data || []) as any[];
      expect(rc).toHaveLength(1);
      S.receipt1 = { id: rc[0].id, no: rc[0].receipt_no };
      const led = (await dbLedger(S.prepay1.id)).filter((g) => !g.reversed_at);
      expect(led.map((g) => [g.kind, Number(g.amount)])).toEqual([['OFFSET', SCRIPT.total]]);
      expect(led.find((g) => g.kind === 'OFFSET').receipt_id).toBe(S.receipt1.id);
      issue('預付核銷後，進貨單在採購單詳情不再顯示「登錄憑證」連結，但請款被擋的訊息寫「仍可登錄憑證與連結發票」：發票要改到「進貨發票」頁登錄，採購單詳情沒有入口，總務可能找不到');
      note(`進貨單 ${S.receipt1.no} 含稅額 ${money(SCRIPT.total)}（折價券 −500 的調整列併入進貨單），預付核銷 ${money(SCRIPT.total)}，預付餘額 0；總部庫存 10 台`);
    } finally { await w.ctx.close(); }
  });

  await step('4-2', '總務（請款管理）', '不能再重複請款：請款單挑不到這張進貨單，強制用 API 請款也被擋', async () => {
    const w = await open(browser, 'buyer');
    try {
      await openGaCenter(w.page);
      await nav(w.page, '請款單');
      await vis(w.page, 'new-pr').click();
      await vis(w.page, 'pe-search').fill(S.po1.no);
      await w.page.waitForTimeout(1500);
      await expect(w.page.locator('[data-testid^="pe-add-"]:visible')).toHaveCount(0);
      await shot(w.page, '已全額核銷的進貨單挑不到');
      const r = await post('buyer', '/payment-requests', { vendor_id: seed.vendor.id, lines: [{ receipt_id: S.receipt1.id }], notes: `${GK1_PREFIX}重複請款測試`, idempotency_key: key() }, false);
      expect(r.status, JSON.stringify(r.body)).toBeGreaterThanOrEqual(400);
      note(`強制呼叫 API 請款：HTTP ${r.status}，系統回覆「${String(r.body.error || r.body.message || '').slice(0, 120)}」`);
      const left = await db().from('ga_payment_requests').select('id').eq('notes', `${GK1_PREFIX}重複請款測試`);
      expect((left.data || []).length).toBe(0);
    } finally { await w.ctx.close(); }
  });

  // ============================================================ 5 同仁代墊
  await step('5-1', '同仁甲、總務（請款管理）', '同仁甲自己墊錢買影印紙：同仁先登錄匯款帳戶，總務開請款單、付款對象選同仁甲', async () => {
    const po3 = await apiPo('同仁代墊 影印紙 5 包', 5, 200);
    S.po3 = { id: po3.id, no: po3.po_no };
    const rc3 = await apiReceive(po3, 5);
    S.receipt3 = { id: rc3.receipt.id, no: rc3.receipt.receipt_no };
    // 同仁甲登錄匯款帳戶（畫面）
    await staffRegisterAccount(browser, 'staffA', '123-456-789012', '同仁甲登錄匯款帳戶');
    const w = await open(browser, 'buyer');
    try {
      await openGaCenter(w.page);
      await nav(w.page, '請款單');
      await vis(w.page, 'new-pr').click();
      await vis(w.page, 'pe-search').fill(S.po3.no);
      await vis(w.page, 'pe-add-' + S.receipt3.no).click();
      await vis(w.page, 'pe-notes').fill(`${GK1_PREFIX}同仁甲代墊影印紙，錢還給同仁`);
      await vis(w.page, 'pe-payee-employee').check();
      await vis(w.page, 'pe-payee-search').fill(users.staffA.name);
      const opt = w.page.locator('[data-testid="pe-payee-opt"]:visible', { hasText: users.staffA.name });
      await expect(opt).toHaveCount(1);
      await expect(opt).toContainText('已登錄匯款帳戶');
      await opt.click();
      await expect(vis(w.page, 'pe-payee-picked')).toContainText(users.staffA.name);
      await shot(w.page, '請款單選同仁甲代墊');
      await vis(w.page, 'pe-save').click();
      await expect(vis(w.page, 'pe-status')).toHaveText('草稿');
      S.pr3.no = await prNoOnPage(w.page);
      await expect(vis(w.page, 'pe-kind-employee')).toBeVisible();
      const pr = (await db().from('ga_payment_requests').select('*').eq('pr_no', S.pr3.no).single()).data as any;
      S.pr3.id = pr.id;
      expect(pr).toMatchObject({ payee_type: 'EMPLOYEE', payee_profile_id: users.staffA.id, vendor_id: seed.vendor.id });
      await confirmAction(w.page, 'pe-submit');
      await expect(vis(w.page, 'pe-status')).toHaveText('已送出');
      await shot(w.page, '同仁代墊請款單已送出');
      const sent = await dbPr(S.pr3.id);
      expect(sent.payee_account_snapshot?.bank_account || JSON.stringify(sent.payee_account_snapshot)).toContain('123-456-789012');
      note(`請款單 ${S.pr3.no}：付款對象＝${users.staffA.name}（廠商 ${seed.vendor.name} 仍記在採購單 ${S.po3.no}）；送出時凍結同仁匯款帳戶快照`);
    } finally { await w.ctx.close(); }
  });

  await step('5-2', '會計、同仁甲', '會計看到同仁匯款帳戶並轉帳（只能轉帳、現金、支票），同仁甲在「我的代墊款」看到已付款', async () => {
    const w = await open(browser, 'accountant');
    try {
      await openGaCenter(w.page);
      await openPr(w.page, S.pr3.no);
      await expect(vis(w.page, 'pe-payee-account')).toContainText('123-456-789012');
      await vis(w.page, 'pe-paid').click();
      expect(await dialog(w.page).getByTestId('act-method').locator('option').allTextContents()).toEqual(['轉帳', '現金', '支票']);
      await dialog(w.page).getByTestId('act-ref').fill('ZTK-REIMB-A');
      await vis(w.page, 'act-confirm').click();
      await expect(vis(w.page, 'pe-status')).toHaveText('已付款');
      await shot(w.page, '會計付款給同仁甲');
      expect(await dbPr(S.pr3.id)).toMatchObject({ status: 'PAID', pay_method: 'TRANSFER' });
      await vis(w.page, 'pe-print').click();
      await expect(vis(w.page, 'pp-payee')).toContainText(users.staffA.name);
      await shot(w.page, '同仁代墊請款單列印');
    } finally { await w.ctx.close(); }
    const emp = await open(browser, 'staffA');
    try {
      await emp.page.goto('/workspace/index.html');
      await emp.page.getByTestId('open-my-reimbursements').click();
      await expect(emp.page.getByTestId('mr-row')).toHaveCount(1);
      await expect(emp.page.getByTestId('mr-row')).toContainText(S.pr3.no);
      await expect(emp.page.getByTestId('mr-row')).toContainText('已付款');
      await shot(emp.page, '同仁甲我的代墊款已付款');
    } finally { await emp.ctx.close(); }
  });

  await step('5-3', '水電總務、同仁乙', '門市同仁乙先繳 ZT01 的 2038-11 電費：水電請款單付款對象選同仁乙（帳戶由同仁乙登錄）', async () => {
    const bill = await mkUtilityBill(users.ubclerk.client, users.ubclerk.id, {
      store_id: sid.ZT01, expense_type: 'ELECTRICITY', billing_month: NIGHT, provider_name: `${GK1_PREFIX}台電`, service_identifier: `ZTK-07-12-3456-78-0`,
      amount: 3860, payee_vendor_id: seed.utilityPayee.id,
    });
    S.bill.id = bill.id;
    await staffRegisterAccount(browser, 'staffB', '555-444-333222', '同仁乙登錄匯款帳戶');
    const w = await open(browser, 'ubclerk');
    try {
      await openGaCenter(w.page);
      await nav(w.page, '請款單');
      await vis(w.page, 'new-pr-utility').click();
      await vis(w.page, 'pu-month').fill(NIGHT);
      await vis(w.page, 'pu-vendor').selectOption(seed.utilityPayee.id);
      await expect(w.page.locator('[data-testid="pu-bill"]:visible')).toHaveCount(1);
      await vis(w.page, 'pu-notes').fill(`${GK1_PREFIX}ZT01 電費由門市同仁乙先繳`);
      await vis(w.page, 'pu-payee-employee').check();
      await vis(w.page, 'pu-payee-search').fill(users.staffB.name);
      const opt = w.page.locator('[data-testid="pu-payee-opt"]:visible', { hasText: users.staffB.name });
      await expect(opt).toContainText('已登錄匯款帳戶');
      await opt.click();
      await shot(w.page, '水電請款單選同仁乙代墊');
      await vis(w.page, 'pu-save').click();
      await expect(vis(w.page, 'pu-status')).toHaveText('草稿');
      S.prUb.no = await prNoOnPage(w.page);
      await expect(vis(w.page, 'pu-kind-employee')).toBeVisible();
      const pr = (await db().from('ga_payment_requests').select('*').eq('pr_no', S.prUb.no).single()).data as any;
      S.prUb.id = pr.id;
      expect(pr).toMatchObject({ source: 'UTILITY', payee_type: 'EMPLOYEE', payee_profile_id: users.staffB.id, vendor_id: seed.utilityPayee.id });
      await vis(w.page, 'pu-refresh-bank').click();
      await expect(vis(w.page, 'pu-payee-account').or(vis(w.page, 'pu-payee-masked'))).toBeVisible();
      await confirmAction(w.page, 'pu-submit');
      await expect(vis(w.page, 'pu-status')).toHaveText('已送出');
      await shot(w.page, '水電代墊請款單已送出');
      const b = (await db().from('ga_utility_bills').select('paid_at,paid_by_pr_id').eq('id', S.bill.id).single()).data as any;
      expect(b.paid_at).not.toBeNull();
      expect(b.paid_by_pr_id).toBe(S.prUb.id);
      note(`水電請款單 ${S.prUb.no}：繳費單位 ${seed.utilityPayee.name}、付款對象同仁乙；送出後帳單自動標已繳（原本只能付給公用事業單位，現在可以選同仁代墊）`);
    } finally { await w.ctx.close(); }
  });

  await step('5-4', '會計、同仁乙', '會計看水電代墊請款單與同仁乙的匯款帳戶並轉帳，同仁乙在「我的代墊款」看到已付款', async () => {
    const w = await open(browser, 'accountant');
    try {
      await openGaCenter(w.page);
      await openPr(w.page, S.prUb.no);
      await expect(vis(w.page, 'pu-payee-name')).toContainText(users.staffB.name);
      await expect(vis(w.page, 'pu-payee-account')).toContainText('555-444-333222');
      await shot(w.page, '會計看水電代墊請款單');
      await vis(w.page, 'pu-paid').click();
      expect(await dialog(w.page).getByTestId('act-method').locator('option').allTextContents()).toEqual(['轉帳', '現金', '支票']);
      await vis(w.page, 'act-confirm').click();
      await expect(vis(w.page, 'pu-status')).toHaveText('已付款');
      await shot(w.page, '水電代墊已付款');
      expect(await dbPr(S.prUb.id)).toMatchObject({ status: 'PAID', pay_method: 'TRANSFER' });
    } finally { await w.ctx.close(); }
    const emp = await open(browser, 'staffB');
    try {
      await emp.page.goto('/workspace/index.html');
      await emp.page.getByTestId('open-my-reimbursements').click();
      await expect(emp.page.getByTestId('mr-row')).toContainText(S.prUb.no);
      await expect(emp.page.getByTestId('mr-row')).toContainText('已付款');
      await shot(emp.page, '同仁乙我的代墊款已付款');
    } finally { await emp.ctx.close(); }
  });

  // ============================================================ 6 第二家公司抬頭＋網購平台付款＋列印
  await step('6', '總務（請款管理）、會計', '另一張請款單選乙公司抬頭，會計用網購平台付款，列印顯示乙公司抬頭', async () => {
    const po4 = await apiPo('辦公用品 網購 3 件', 3, 200, { buyer_company_id: S.companyA.id });
    S.po4 = { id: po4.id, no: po4.po_no };
    const rc4 = await apiReceive(po4, 3);
    S.receipt4 = { id: rc4.receipt.id, no: rc4.receipt.receipt_no };
    const w = await open(browser, 'buyer');
    try {
      await openGaCenter(w.page);
      await openPoDetail(w.page, S.po4.no);
      await expect(dialog(w.page).getByTestId('pd-buyer')).toContainText(S.companyA.name); // 採購單抬頭是甲
      await dialog(w.page).getByTestId('pd-close').click();
      await nav(w.page, '請款單');
      await vis(w.page, 'new-pr').click();
      await vis(w.page, 'pe-search').fill(S.po4.no);
      await vis(w.page, 'pe-add-' + S.receipt4.no).click();
      await vis(w.page, 'pe-notes').fill(`${GK1_PREFIX}辦公用品網購，請款抬頭改開乙公司`);
      await vis(w.page, 'pe-buyer').selectOption(S.companyB.id);
      await shot(w.page, '請款單選乙公司抬頭');
      await vis(w.page, 'pe-save').click();
      await expect(vis(w.page, 'pe-status')).toHaveText('草稿');
      S.pr4.no = await prNoOnPage(w.page);
      S.pr4.id = (await db().from('ga_payment_requests').select('id').eq('pr_no', S.pr4.no).single()).data!.id;
      await confirmAction(w.page, 'pe-submit');
      await expect(vis(w.page, 'pe-status')).toHaveText('已送出');
      const sent = await dbPr(S.pr4.id);
      expect(sent.buyer_company_id).toBe(S.companyB.id);
      expect([sent.buyer_title_snapshot, sent.buyer_tax_id_snapshot]).toEqual([S.companyB.name, S.companyB.tax]);
    } finally { await w.ctx.close(); }
    const acc = await open(browser, 'accountant');
    try {
      await openGaCenter(acc.page);
      await openPr(acc.page, S.pr4.no);
      await vis(acc.page, 'pe-paid').click();
      await dialog(acc.page).getByTestId('act-method').selectOption('ONLINE_PLATFORM');
      await dialog(acc.page).getByTestId('act-platform').fill('蝦皮');
      await dialog(acc.page).getByTestId('act-ref').fill('ZTK-ORDER-6');
      await shot(acc.page, '標記已付款網購平台');
      await vis(acc.page, 'act-confirm').click();
      await expect(vis(acc.page, 'pe-paid-info')).toContainText('平台 蝦皮');
      expect(await dbPr(S.pr4.id)).toMatchObject({ status: 'PAID', pay_method: 'ONLINE_PLATFORM', pay_platform: '蝦皮', pay_card_last4: null });
      await vis(acc.page, 'pe-print').click();
      await expect(vis(acc.page, 'pp-buyer')).toContainText(S.companyB.name);
      await expect(vis(acc.page, 'pp-buyer-tax')).toContainText(S.companyB.tax);
      await expect(vis(acc.page, 'pp-paid')).toContainText('蝦皮');
      await shot(acc.page, '請款單列印乙公司抬頭');
      note(`請款單 ${S.pr4.no}：採購單抬頭甲、請款單改選乙，列印頁印出乙公司名稱與統編 ${S.companyB.tax}；預付請款單 ${S.prepay1.no} 列印則為甲公司`);
    } finally { await acc.ctx.close(); }
  });

  // ============================================================ 7 權限名稱與小錯字
  await step('7-1', '會計（有請款管理、沒有水電話網費管理）', '權限名稱顯示「水電話網費管理」', async () => {
    const w = await open(browser, 'accountant');
    try {
      await openGaCenter(w.page);
      await nav(w.page, '請款單');
      await expect(heading(w.page, '請款單')).toBeVisible();
      await expect(vis(w.page, 'new-pr-utility-need')).toContainText('水電話網費管理');
      await expect(vis(w.page, 'new-pr-utility-need')).not.toContainText('水電網費管理');
      await shot(w.page, '權限名稱水電話網費管理');
      note(`畫面文字：${(await vis(w.page, 'new-pr-utility-need').innerText()).trim().slice(0, 100)}`);
    } finally { await w.ctx.close(); }
  });

  await step('7-2', '店長（ZT01）', '小錯字一：店長按「確認完成」，提示是「確認完成。」不是「確認完成完成。」', async () => {
    const reqRow = (await db().from('ga_service_requests').insert({
      store_id: sid.ZT01, created_by: users.store.id, request_type: 'PURCHASE_SUPPLEMENT', title: `${GK1_PREFIX}需求 補一台印表機（等門市確認）`, description: 'M9-GK1 劇本用需求單',
      resource_type: 'PART', part_id: seed.part.id, desired_unit: '台', desired_quantity: 1, main_status: 'WAITING_STORE_CONFIRMATION', intake_route: 'STOCK_ISSUE',
    }).select('id,request_no').single()).data as any;
    S.req = { id: reqRow.id, no: reqRow.request_no };
    const w = await open(browser, 'store');
    try {
      await openGaCenter(w.page);
      await nav(w.page, '我的追蹤');
      await w.page.getByLabel('狀態').selectOption('WAITING_STORE_CONFIRMATION');
      await w.page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first().fill(S.req.no);
      const row = w.page.locator('[data-testid="mr-card"]:visible', { hasText: S.req.no });
      await expect(row).toHaveCount(1);
      await row.getByTestId('open-detail').click();
      await expect(dialog(w.page).getByTestId('request-detail')).toBeVisible();
      await w.page.getByTestId('act-confirm_complete').click();
      await w.page.getByTestId('action-submit').click();
      const n = w.page.getByTestId('detail-notice');
      await expect(n).toBeVisible();
      await expect(n).toHaveText('確認完成。');
      await expect(n).not.toContainText('完成完成');
      await shot(w.page, '店長確認完成提示');
      expect((await db().from('ga_service_requests').select('main_status').eq('id', S.req.id).single()).data).toMatchObject({ main_status: 'COMPLETED' });
    } finally { await w.ctx.close(); }
  });

  await step('7-3', '總務採購', '小錯字二：已核銷或已付款的進貨單不再顯示「登錄憑證」連結；還沒請款的進貨單仍有（對照）', async () => {
    const po5 = await apiPo('對照組 還沒請款的進貨單', 2, 100);
    S.po5 = { id: po5.id, no: po5.po_no };
    const rc5 = await apiReceive(po5, 2);
    S.receipt5 = { id: rc5.receipt.id, no: rc5.receipt.receipt_no };
    const w = await open(browser, 'buyer');
    try {
      await openGaCenter(w.page);
      // 預付核銷的進貨單
      await openPoDetail(w.page, S.po1.no);
      await expect(dialog(w.page).getByTestId('reg-voucher-' + S.receipt1.no)).toHaveCount(0);
      await shot(w.page, '已預付核銷的進貨單沒有登錄憑證連結');
      await dialog(w.page).getByTestId('pd-close').click();
      // 已付款請款單請過的進貨單
      await openPoDetail(w.page, S.po4.no);
      await expect(dialog(w.page).getByTestId('reg-voucher-' + S.receipt4.no)).toHaveCount(0);
      await shot(w.page, '已付款的進貨單沒有登錄憑證連結');
      await dialog(w.page).getByTestId('pd-close').click();
      // 對照：還沒請款也沒憑證
      await openPoDetail(w.page, S.po5.no);
      await expect(dialog(w.page).getByTestId('reg-voucher-' + S.receipt5.no)).toHaveCount(1);
      await shot(w.page, '對照組未請款進貨單仍有登錄憑證連結');
    } finally { await w.ctx.close(); }
  });

  // ============================================================ 彙整
  const failed = recs.filter((r) => r.status === '失敗');
  writeSteps();
  expect(failed.map((r) => `${r.no} ${r.title}：${r.note}`), '失敗的步驟（劇本寫錯或產品問題，詳見 steps.json）').toEqual([]);
  expect(consoleIssues, 'console 錯誤').toEqual([]);
  void BASE;
});
