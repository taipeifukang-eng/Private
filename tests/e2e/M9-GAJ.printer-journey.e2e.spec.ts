import fs from 'node:fs';
import path from 'node:path';
import { expect, type Browser, type BrowserContext, type Locator, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { storageStateFor, TEST_ORIGIN } from '../support/auth';
import { gaNavTo, noPageOverflow, openGaCenter, openGaSide, shell } from '../support/g01-ui';
import { balanceRow, dialog, invNavTo, notice } from '../support/g12-ui';
import {
  adminDb, assertDevOnly, cleanupGajData, GAJ_PREFIX, type GajKey, type GajSeed, type GajUser, keepData, seedGajMaster, setupGajUsers, SHOTS_DIR, stores,
} from '../support/m9-gaj-fixtures';
import { makePng } from '../support/png';

// M9-GAJ 角色接力劇本「總務採購印表機到門市配發」（老闆自己寫的劇本，桌機 1920x1080 跑一次）。
//  劇本 1：總務依預定計畫第一次向 MOMO 買 10 台 EPSON L6490（MOMO 1111 活動，原價 13,490、特價 11,490/台，發票抬頭富康活力醫藥股份有限公司）：
//          設請款買受人 → 建採購單 → 送核准 → 簽核主管核准 → 下訂 → 到貨入總部庫存 → 登錄三聯式發票（傳圖）→ 請款 → 會計付款 → 對庫存 → 10 台 QR 與拍照。
//  劇本 2：ZT01 店長（代替南港店）提需求 → 總務受理 → 從剛買的 10 台配發 1 台給 ZT01 → 店長貼標拍照收貨 → 另一位總務複核 → 送門市確認 → 店長確認結案 → 庫存剩 9 台。
// 新版不支援的步驟：用「不支援」標記並寫明驗證到的實際行為（不改產品程式）；劇本盡量往下走。每步先畫面、再用資料庫與 API 對照。
// 資料全部帶 ZTJ- 前綴。GAJ_KEEP 預設 1：跑完保留資料給老闆在測試區查看；GAJ_KEEP=0 才在結束時呼叫 scripts/m9-gaj-cleanup.cjs 的清除函式。
// 步驟結果寫在 tests/reports/_shots_ga_journey/steps.json，截圖也存在同一個資料夾。
const BASE = '/api/workspace/general-affairs';
const SCRIPT = {
  unitPrice: 11490, listPrice: 13490, qty: 10, scriptTotal: 114900, buyerTitle: '富康活力醫藥股份有限公司', buyerTaxId: '12345678',
  poDate: '2038-11-02', payDate: '2038-11-10', receiptDate: '2038-11-11', requestDate: '2038-11-15',
};
// 系統規則：單價是未稅，採購單加 5% 稅（ga_workflow_settings po_tax_rate）。
const SYS_SUBTOTAL = 114900;
const SYS_TAX = 5745;
const SYS_TOTAL = 120645;
const REQ_TITLE = `${GAJ_PREFIX}需求 EPSON L6490 一台（ZT01 代替南港店）`;
const PO_NOTE = `${GAJ_PREFIX}MOMO 1111 活動：EPSON L6490 連續供墨印表機 10 台；原價 13,490／台、特價 11,490／台（劇本總額 114,900）；發票抬頭：${SCRIPT.buyerTitle}`;

type Status = '通過' | '失敗' | '不支援';
type Rec = { no: string; role: string; title: string; status: Status; shot: string[]; note: string };
const recs: Rec[] = [];
const consoleIssues: string[] = [];
const layoutIssues: string[] = [];
let cur: { no: string; shots: string[]; notes: string[]; unsupported: boolean; errors: string[] } = { no: '', shots: [], notes: [], unsupported: false, errors: [] };

const png = () => makePng({ width: 160, height: 100, inkPixels: 30 });
const taipeiDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const db = () => adminDb();
const vis = (page: Page, testid: string): Locator => page.getByTestId(testid).locator('visible=true');
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('visible=true').first();
const searchBox = (page: Page) => page.getByRole('searchbox', { name: /^搜尋$/ }).locator('visible=true').first();
const realErrors = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));

let users = {} as Record<GajKey, GajUser>;
let seed: GajSeed;
let sid: Record<string, string> = {};
const states: Record<string, any> = {};
const S = {
  po: { id: '', no: '', itemId: '' }, receipt: { id: '', no: '' }, invoice: { id: '', no: '' }, pr: { id: '', no: '' },
  req: { id: '', no: '' }, eq: { id: '', code: '' },
};

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });

test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop-1440') return; // 手機 project 不跑，也不准動資料（否則會把桌機剛建的資料清掉）
  test.setTimeout(300_000);
  assertDevOnly();
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  for (const f of fs.readdirSync(SHOTS_DIR)) if (/^\d.*\.png$/.test(f) || f === 'steps.json') fs.rmSync(path.join(SHOTS_DIR, f), { force: true });
  const left = await cleanupGajData(); // 可重跑：上次留下的 ZTJ- 資料先清掉再重建
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  users = await setupGajUsers();
  seed = await seedGajMaster();
  const st = await stores();
  sid = { ZT01: st.ZT01.id };
  for (const k of Object.keys(users) as GajKey[]) {
    const c = await apiForUser({ key: k, email: users[k].email, password: users[k].password } as any);
    states[k] = await c.storageState();
    await c.dispose();
  }
  states.approver = await storageStateFor('ga_po_approver');
});

test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop-1440') return;
  // steps.json 在每個步驟結束時就寫好（失敗後 Playwright 會換 worker，這裡的模組變數已經不是本次的）。
  if (!keepData()) {
    expect(await cleanupGajData(), '清除 ZTJ- 資料').toEqual([]);
  }
});

type Who = { ctx: BrowserContext; page: Page };
async function open(browser: Browser, who: GajKey | 'approver'): Promise<Who> {
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
const unsupported = (t: string) => { cur.unsupported = true; cur.notes.push(t); };

/** 一個劇本步驟：用 test.step 包起來，例外記為失敗但不中斷後面步驟。 */
async function step(no: string, role: string, title: string, fn: () => Promise<void>) {
  cur = { no, shots: [], notes: [], unsupported: false, errors: [] };
  let status: Status = '通過';
  await test.step(`${no} ${title}（${role}）`, async () => {
    try {
      await fn();
      if (cur.unsupported) status = '不支援';
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
  fs.writeFileSync(path.join(SHOTS_DIR, 'steps.json'), JSON.stringify({ recs, consoleIssues, layoutIssues, ids: S, keep: keepData() }, null, 2));
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
const dbPo = async () => (await db().from('ga_purchase_orders').select('*').eq('id', S.po.id).single()).data as any;
const dbBal = async () => Number(((await db().from('ga_inventory_balances').select('quantity_base').eq('location_id', seed.loc.id).eq('part_id', seed.part.id).maybeSingle()).data as any)?.quantity_base ?? 0);
const dbEquip = async () => ((await db().from('ga_equipment').select('*').eq('source_purchase_order_id', S.po.id).order('created_at')).data || []) as any[];
const dbReq = async () => (await db().from('ga_service_requests').select('*').eq('id', S.req.id).single()).data as any;
const dbPr = async () => (await db().from('ga_payment_requests').select('*').eq('id', S.pr.id).single()).data as any;

async function openPo(page: Page) {
  await openGaCenter(page);
  await nav(page, '採購單');
  await expect(heading(page, '採購單')).toBeVisible();
  await vis(page, 'po-search').fill(S.po.no);
  const card = page.locator('[data-testid="po-card"]:visible', { hasText: S.po.no });
  await expect(card).toHaveCount(1);
  await card.getByTestId('open-detail').click();
  await expect(dialog(page).getByTestId('po-detail')).toBeVisible();
}
async function poAct(page: Page, action: string, noteText?: string, expectNotice?: RegExp) {
  const d = dialog(page);
  await d.getByTestId(`act-${action}`).click();
  await expect(d.getByTestId('action-form')).toBeVisible();
  if (noteText !== undefined) await d.getByTestId('f-note').fill(noteText);
  await d.getByTestId('action-submit').click();
  await expect(d.getByTestId('pd-notice')).toContainText(expectNotice || /已/);
}
async function openRq(page: Page, where: 'rq' | 'mr') {
  await searchBox(page).fill(S.req.no);
  const row = page.locator(where === 'rq' ? '[data-testid="rq-row"]:visible, [data-testid="rq-card"]:visible' : '[data-testid="mr-card"]:visible', { hasText: S.req.no });
  await expect(row).toHaveCount(1);
  await row.getByTestId('open-detail').click();
  await expect(dialog(page).getByTestId('request-detail')).toBeVisible();
}
async function reqAct(page: Page, action: string, fill: Record<string, string> = {}) {
  const d = dialog(page);
  await d.getByTestId(`act-${action}`).click();
  await expect(d.getByTestId('action-form')).toBeVisible();
  for (const [id, v] of Object.entries(fill)) {
    const el = d.getByTestId(id);
    if ((await el.evaluate((n) => n.tagName)) === 'SELECT') await el.selectOption(v); else await el.fill(v);
  }
  await d.getByTestId('action-submit').click();
  await expect(d.getByTestId('action-form')).toBeHidden();
  await expect(d.getByTestId('detail-notice')).toBeVisible();
}

test('M9-GAJ 總務採購印表機到門市配發（劇本 1 採購到入庫、劇本 2 門市需求到出貨配發）', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用 1920x1080 桌機，只在桌機 project 跑一次');
  test.setTimeout(1_500_000);

  // ============================================================ 劇本 1
  await step('1-0', '總務（請款管理）', '設定請款買受人抬頭「富康活力醫藥股份有限公司」', async () => {
    const w = await open(browser, 'buyer');
    try {
      await openGaCenter(w.page);
      await nav(w.page, '請款單');
      await expect(heading(w.page, '請款單')).toBeVisible();
      await vis(w.page, 'pr-settings').click();
      const form = vis(w.page, 'pay-settings-form');
      await expect(form).toBeVisible();
      await vis(w.page, 'ps-title').fill(SCRIPT.buyerTitle);
      await vis(w.page, 'ps-tax').fill(SCRIPT.buyerTaxId);
      await vis(w.page, 'ps-save').click();
      await expect(vis(w.page, 'ps-notice')).toBeVisible();
      await shot(w.page, '請款設定買受人抬頭');
      const rows = ((await db().from('ga_workflow_settings').select('key,value_text').in('key', ['pay_buyer_title', 'pay_buyer_tax_id'])).data || []) as any[];
      expect(rows.find((r) => r.key === 'pay_buyer_title')?.value_text).toBe(SCRIPT.buyerTitle);
      expect(rows.find((r) => r.key === 'pay_buyer_tax_id')?.value_text).toBe(SCRIPT.buyerTaxId);
      note('抬頭是全公司共用的請款設定（買受人抬頭＋統編），不是每張發票或每張採購單各自的欄位；單張三聯式發票只有「買受人統編」欄。買受人統編 12345678 是測試用假值（劇本沒給真實統編）');
    } finally { await w.ctx.close(); }
  });

  await step('1-1', '系統前置（fixture）', '建立廠商 ZTJ-MOMO（含銀行資料）', async () => {
    const v = (await db().from('ga_vendors').select('name,tax_id,status').eq('id', seed.vendor.id).single()).data as any;
    expect(v).toMatchObject({ name: `${GAJ_PREFIX}MOMO`, status: 'active' });
    note('DEV 本來沒有 MOMO 廠商，以 fixture 新建（統編為 9 開頭隨機碼）；廠商管理頁需要廠商管理權限，總務基本角色看不到');
  });

  await step('1-2', '系統前置（fixture）', '建立設備型號、料件（對應型號）、庫存位置 ZTJ-總部倉', async () => {
    const part = (await db().from('ga_parts').select('name,base_unit,equipment_template_id').eq('id', seed.part.id).single()).data as any;
    expect(part).toMatchObject({ base_unit: '台', equipment_template_id: seed.tpl.id });
    const lp = await db().from('ga_inventory_location_parts').select('id').eq('location_id', seed.loc.id).eq('part_id', seed.part.id);
    expect((lp.data || []).length).toBe(1);
    note('DEV 沒有任何 EPSON 型號：型號 ZTJ-EPSON L6490（噴墨印表機 IC0202）、料件基本單位「台」、庫存位置 ZTJ-總部倉皆用 fixture 建立');
  });

  await step('1-3', '總務採購（開單人）', '新增採購單：MOMO、EPSON L6490 × 10、單價 11,490，原價與活動寫備註', async () => {
    const w = await open(browser, 'buyer');
    try {
      await openGaCenter(w.page);
      await nav(w.page, '採購單');
      await vis(w.page, 'new-po').click();
      await expect(heading(w.page, '新增採購單')).toBeVisible();
      const form = vis(w.page, 'po-form');
      await pickIn(form, 'pe-vendor', seed.vendor.name);
      await pickIn(form, 'pe-location', seed.loc.name);
      await pickIn(form, 'pe-part-0', seed.part.name);
      await expect(form.getByTestId('pe-part-template-0')).toContainText(seed.tpl.name);
      await expect(form.getByTestId('pe-history-empty')).toBeVisible(); // 第一次買：沒有歷史價
      await form.getByTestId('pe-qty-0').fill(String(SCRIPT.qty));
      await form.getByTestId('pe-price-0').fill(String(SCRIPT.unitPrice));
      await form.getByTestId('pe-expected').fill(SCRIPT.receiptDate); // 預計到貨日可以填 2038（只是備註性質）
      await form.getByTestId('pe-notes').fill(PO_NOTE);
      await expect(form.getByTestId('pe-subtotal')).toHaveText('$114,900');
      const totalText = (await form.getByTestId('pe-total').innerText()).trim();
      await shot(w.page, '新增採購單');
      await form.getByTestId('pe-totals').scrollIntoViewIfNeeded(); // 首屏看不到未稅／稅額／含稅總額，再補一張金額區
      await shot(w.page, '新增採購單金額');
      await form.getByTestId('pe-save').click();
      await expect(vis(w.page, 'pe-saved')).toBeVisible();
      S.po.no = (await vis(w.page, 'pe-po-no').textContent())!.trim();
      expect(S.po.no).toMatch(/^PO-\d{8}-\d{3,}$/);
      const po = (await db().from('ga_purchase_orders').select('*').eq('po_no', S.po.no).single()).data as any;
      S.po.id = po.id;
      const item = (await db().from('ga_purchase_order_items').select('*').eq('po_id', po.id)).data as any[];
      S.po.itemId = item[0].id;
      expect(po).toMatchObject({ status: 'DRAFT', vendor_id: seed.vendor.id, receiving_location_id: seed.loc.id, approval_required: true });
      expect(Number(po.subtotal)).toBe(SYS_SUBTOTAL);
      expect(Number(po.tax_amount)).toBe(SYS_TAX);
      expect(Number(po.total_amount)).toBe(SYS_TOTAL);
      expect(item).toHaveLength(1);
      expect(Number(item[0].unit_price)).toBe(SCRIPT.unitPrice);
      expect(Number(item[0].quantity)).toBe(SCRIPT.qty);
      expect(String(po.notes)).toContain('13,490');
      expect(String(po.notes)).toContain('MOMO 1111');
      expect(String(po.notes)).toContain(SCRIPT.buyerTitle);
      expect(String(po.expected_delivery_date).slice(0, 10)).toBe(SCRIPT.receiptDate);
      note(`單價 11,490 × 10：未稅小計 114,900（等於劇本的「總額」），系統另加 5% 稅 5,745，含稅總額 ${totalText}；劇本寫的 114,900 其實是未稅小計，網購的含稅總額會是 120,645`);
      unsupported('採購單沒有「原價」「活動名稱」欄位，原價 13,490 與 MOMO 1111 只能寫在備註（已寫入並回讀）；沒有折扣欄位，系統也不算折讓');
      unsupported('採購單建立時間是資料庫當下時間，無法填「2038/11/2」；只有「預計到貨日」可填 2038-11-11（已填並回讀）');
    } finally { await w.ctx.close(); }
  });

  await step('1-4', '總務採購（開單人）', '儲存後送核准（含稅超過門檻 5,000）', async () => {
    const w = await open(browser, 'buyer');
    try {
      await openPo(w.page);
      await expect(dialog(w.page).getByTestId('pd-status')).toHaveText('草稿');
      await expect(dialog(w.page).getByTestId('act-place_order')).toHaveCount(0); // 超過門檻只留送核准
      await poAct(w.page, 'submit', '請核准採購 EPSON L6490 × 10（MOMO 1111 活動）', /已送核准/);
      await expect(dialog(w.page).getByTestId('pd-status')).toHaveText('待核准');
      await shot(w.page, '送核准');
      expect(await dbPo()).toMatchObject({ status: 'PENDING_APPROVAL', submitted_by: users.buyer.id });
      // 開單人自己沒有核准權限：API 核准被擋
      const api = await apiForUser({ key: 'buyer', email: users.buyer.email, password: users.buyer.password } as any);
      const r = await api.post(`${BASE}/purchase-orders/${S.po.id}/actions`, { data: { action: 'approve', expected_updated_at: (await dbPo()).updated_at } });
      expect(r.status()).toBe(403);
      await api.dispose();
      expect((await dbPo()).status).toBe('PENDING_APPROVAL');
    } finally { await w.ctx.close(); }
  });

  await step('1-5', '簽核主管（採購核准人）', '待簽核清單看到並核准，備註「同意採購」', async () => {
    const w = await open(browser, 'approver');
    try {
      await openGaCenter(w.page);
      await nav(w.page, '待簽核採購單');
      await expect(heading(w.page, '待簽核採購單')).toBeVisible();
      const card = w.page.locator('[data-testid="ap-card"]:visible', { hasText: S.po.no });
      await expect(card).toHaveCount(1);
      await expect(card.getByTestId('ap-amount')).toHaveText(`$${SYS_TOTAL.toLocaleString('en-US')}`);
      await shot(w.page, '待簽核清單');
      await card.getByTestId('open-approve').click();
      await expect(dialog(w.page).getByTestId('po-detail')).toBeVisible();
      await poAct(w.page, 'approve', '同意採購', /已核准/);
      await shot(w.page, '核准後');
      const po = await dbPo();
      expect(po).toMatchObject({ status: 'APPROVED', approval_note: '同意採購' });
      expect(po.approved_by).not.toBe(users.buyer.id);
      expect(po.approved_at).toBeTruthy();
      note('簽核只有單一金額門檻（5,000）與單一核准權限；沒有「超過多少錢要老闆加簽」的分級簽核');
    } finally { await w.ctx.close(); }
  });

  await step('1-6', '總務採購', '下訂（廠商名稱、統編、付款條件快照）', async () => {
    const w = await open(browser, 'buyer');
    try {
      await openPo(w.page);
      await expect(dialog(w.page).getByTestId('pd-status')).toContainText('已核准');
      await poAct(w.page, 'place_order', undefined, /已下訂/);
      await shot(w.page, '下訂後');
      const po = await dbPo();
      expect(po).toMatchObject({ status: 'ORDERED', vendor_name_snapshot: seed.vendor.name, vendor_tax_id_snapshot: seed.vendor.tax_id, vendor_payment_terms_snapshot: seed.vendor.payment_terms, ordered_by: users.buyer.id });
      expect(po.ordered_at).toBeTruthy();
      unsupported('下訂時間是資料庫當下時間，無法指定劇本的 2038/11/2');
    } finally { await w.ctx.close(); }
  });

  await step('1-7a', '總務（請款管理）', '【劇本 11/10 先付款】到貨前申請付款：沒有進貨可選，請款單建不起來', async () => {
    const w = await open(browser, 'buyer');
    try {
      await openGaCenter(w.page);
      await nav(w.page, '請款單');
      await vis(w.page, 'new-pr').click();
      await vis(w.page, 'pe-search').fill(S.po.no);
      await expect(vis(w.page, 'pe-candidates')).toBeVisible({ timeout: 20_000 }).catch(() => undefined);
      await w.page.waitForTimeout(1200);
      await expect(w.page.locator('[data-testid^="pe-add-"]:visible')).toHaveCount(0);
      await shot(w.page, '到貨前不能請款');
      const prs = await db().from('ga_payment_requests').select('id').eq('vendor_id', seed.vendor.id);
      expect((prs.data || []).length).toBe(0);
      unsupported('新版規格 P2「到貨驗入後才能請款，不做預付」：沒有驗入的採購單在請款單頁找不到可選的進貨，無法先付款。MOMO 這類網購先付款再出貨的做法，新版不支援');
    } finally { await w.ctx.close(); }
  });

  await step('1-7', '總務採購', '登錄到貨 10 台並驗入總部庫存（劇本 11/11 到貨）', async () => {
    const w = await open(browser, 'buyer');
    try {
      await openPo(w.page);
      await dialog(w.page).getByTestId('act-receipt').click();
      const form = dialog(w.page).getByTestId('receipt-form');
      await expect(form).toBeVisible();
      await form.getByTestId('rc-delivered-0').fill(String(SCRIPT.qty));
      // 劇本的到貨日 2038/11/11 是未來日期：先試一次，應該被擋
      await form.getByTestId('rc-date').fill(SCRIPT.receiptDate);
      await form.getByTestId('rc-submit').click();
      await w.page.waitForTimeout(1200);
      const blocked = await db().from('ga_purchase_receipts').select('id').eq('po_id', S.po.id);
      expect((blocked.data || []).length).toBe(0);
      await shot(w.page, '到貨日填2038被擋');
      unsupported('到貨日不能晚於今天，填劇本的 2038/11/11 送不出去（資料庫沒有建立進貨單）；實際到貨日只能是今天或過去');
      await form.getByTestId('rc-date').fill(taipeiDay());
      await form.getByTestId('rc-submit').click();
      await expect(dialog(w.page).getByTestId('pd-notice')).toContainText('到貨已登錄並驗入');
      await expect(dialog(w.page).getByTestId('pd-status')).toHaveText('全部到貨');
      await shot(w.page, '到貨驗入後');
      expect(await dbBal()).toBe(SCRIPT.qty);
      const rc = (await db().from('ga_purchase_receipts').select('*').eq('po_id', S.po.id)).data as any[];
      expect(rc).toHaveLength(1);
      S.receipt.id = rc[0].id;
      S.receipt.no = rc[0].receipt_no;
      expect(String(rc[0].received_date).slice(0, 10)).toBe(taipeiDay());
      const ri = (await db().from('ga_purchase_receipt_items').select('*').eq('receipt_id', rc[0].id)).data as any[];
      expect(ri).toHaveLength(1);
      expect(Number(ri[0].accepted_qty ?? ri[0].quantity_base ?? SCRIPT.qty)).toBe(SCRIPT.qty);
      expect((await dbPo()).status).toMatch(/RECEIVED/);
      const tx = (await db().from('ga_inventory_transactions').select('quantity_base,location_id').eq('part_id', seed.part.id)).data as any[];
      expect(tx.reduce((a, t) => a + Number(t.quantity_base), 0)).toBe(SCRIPT.qty);
    } finally { await w.ctx.close(); }
  });

  await step('1-8', '總務（請款管理）', '登錄進貨憑證與三聯式發票（連結進貨單、上傳發票圖片）', async () => {
    const w = await open(browser, 'buyer');
    try {
      await openGaCenter(w.page);
      await nav(w.page, '進貨發票');
      await vis(w.page, 'new-invoice').click();
      const form = vis(w.page, 'invoice-form');
      await form.getByTestId('ie-receipt-search').fill(S.po.no);
      await form.getByTestId('ie-option').first().getByRole('button', { name: '加入' }).click();
      await form.getByTestId('ie-type').selectOption('TRIPLE');
      S.invoice.no = `ZJ${String(Date.now()).slice(-8)}`;
      await form.getByTestId('ie-no').fill(S.invoice.no);
      await form.getByTestId('ie-untaxed').fill(String(SYS_SUBTOTAL));
      await expect(form.getByTestId('ie-total')).toContainText('120,645');
      await shot(w.page, '登錄三聯式發票');
      await form.getByTestId('ie-save').click();
      await expect(vis(w.page, 'ie-saved')).toBeVisible();
      await expect(vis(w.page, 'ie-missing')).toContainText('缺圖');
      await vis(w.page, 'ie-images').locator('input[type=file]').setInputFiles({ name: 'ztj-invoice.png', mimeType: 'image/png', buffer: png() });
      await vis(w.page, 'ie-images').getByRole('button', { name: /上傳 1 個檔案/ }).click();
      await expect(vis(w.page, 'ie-image-count')).toContainText('1 張');
      await expect(vis(w.page, 'ie-missing')).toHaveCount(0);
      await shot(w.page, '發票圖片上傳後');
      const inv = (await db().from('ga_purchase_invoices').select('*').eq('invoice_no', S.invoice.no).single()).data as any;
      S.invoice.id = inv.id;
      expect(inv).toMatchObject({ invoice_type: 'TRIPLE', status: 'ACTIVE', vendor_id: seed.vendor.id });
      expect(Number(inv.amount_untaxed)).toBe(SYS_SUBTOTAL);
      expect(Number(inv.tax_amount)).toBe(SYS_TAX);
      expect(Number(inv.amount_total)).toBe(SYS_TOTAL);
      const buyerKey = Object.keys(inv).find((k) => /buyer/.test(k));
      note(`發票買受人統編欄位 ${buyerKey || '（資料表沒有 buyer 欄位）'} = ${buyerKey ? String(inv[buyerKey]) : '—'}（新增畫面此欄留白，不填就用請款設定的買受人）`);
      expect(String(inv.invoice_date).slice(0, 10)).toBe(taipeiDay());
      const links = (await db().from('ga_purchase_invoice_receipts').select('receipt_id').eq('invoice_id', inv.id)).data as any[];
      expect(links.map((l) => l.receipt_id)).toEqual([S.receipt.id]);
      expect(((await db().from('ga_purchase_receipts').select('voucher_status').eq('id', S.receipt.id).single()).data as any).voucher_status).toBe('LINKED');
      const imgs = ((await db().from('ga_resource_attachments').select('id,deleted_at,storage_path').eq('resource_type', 'PURCHASE_INVOICE').eq('resource_id', inv.id)).data || []) as any[];
      expect(imgs.filter((i) => !i.deleted_at)).toHaveLength(1);
      unsupported('發票沒有「抬頭」欄位：單張發票只有買受人統編（已帶入 12345678）；抬頭只存在全公司的請款設定，會印在請款單上（見 1-10）。若集團有多家買受人公司，新版不能每張單指定');
      unsupported('發票日期不能是未來日期，一律是真實日期（今天），無法填 2038');
    } finally { await w.ctx.close(); }
  });

  await step('1-9', '總務（請款管理）', '建立請款單（選剛到貨的進貨與發票）並送出', async () => {
    const w = await open(browser, 'buyer');
    try {
      await openGaCenter(w.page);
      await nav(w.page, '請款單');
      await vis(w.page, 'new-pr').click();
      await vis(w.page, 'pe-search').fill(S.po.no);
      await expect(vis(w.page, `pe-add-${S.receipt.no}`)).toBeVisible();
      await vis(w.page, `pe-add-${S.receipt.no}`).click();
      await vis(w.page, 'pe-notes').fill(`${GAJ_PREFIX}MOMO 1111 活動貨款（原價 13,490、特價 11,490 × 10 台）`);
      await expect(vis(w.page, 'pe-grand')).toContainText('120,645');
      await vis(w.page, 'pe-save').click();
      await expect(vis(w.page, 'pe-status')).toHaveText('草稿');
      S.pr.no = (await w.page.locator('h1:visible').first().innerText()).match(/PY-\d{8}-\d{3,}/)![0];
      await shot(w.page, '請款單草稿');
      await vis(w.page, 'pe-submit').click();
      await vis(w.page, 'act-confirm').click();
      await expect(vis(w.page, 'pe-status')).toHaveText('已送出');
      await shot(w.page, '請款單已送出');
      const pr = (await db().from('ga_payment_requests').select('*').eq('pr_no', S.pr.no).single()).data as any;
      S.pr.id = pr.id;
      expect(pr).toMatchObject({ status: 'SUBMITTED', vendor_id: seed.vendor.id, created_by: users.buyer.id, submitted_by: users.buyer.id });
      expect(Number(pr.amount_total)).toBe(SYS_TOTAL);
      const lines = (await db().from('ga_payment_request_lines').select('*').eq('pr_id', pr.id)).data as any[];
      expect(lines).toHaveLength(1);
      expect(lines[0].receipt_id).toBe(S.receipt.id);
    } finally { await w.ctx.close(); }
  });

  await step('1-10', '會計（付款負責人）', '標記已付款（轉帳、參考號），付款日劇本為 2038/11/10', async () => {
    const w = await open(browser, 'accountant');
    try {
      await openGaCenter(w.page);
      await nav(w.page, '請款單');
      await vis(w.page, 'pr-tab-pay').click();
      await vis(w.page, 'pr-search').fill(S.pr.no);
      await expect(w.page.locator('[data-testid="pr-card"]:visible')).toHaveCount(1);
      await w.page.locator('[data-testid="pr-card"]:visible').first().getByTestId('open-pr').click();
      await expect(vis(w.page, 'pe-status')).toHaveText('已送出');
      await expect(vis(w.page, 'pe-bank')).toContainText('123-456-789012');
      await vis(w.page, 'pe-paid').click();
      await vis(w.page, 'act-method').selectOption('TRANSFER');
      await vis(w.page, 'act-ref').fill('ZTJ-MOMO-1111-PAY');
      await vis(w.page, 'act-date').fill(SCRIPT.payDate);
      await vis(w.page, 'act-confirm').click();
      await expect(vis(w.page, 'act-error')).toBeVisible();
      note(`付款日填 2038-11-10 被擋，系統訊息：${(await vis(w.page, 'act-error').innerText()).trim().slice(0, 80)}`);
      await shot(w.page, '付款日填2038被擋');
      expect((await dbPr()).status).toBe('SUBMITTED');
      unsupported('付款日不能是未來日期（也不能比請款單建立日早超過 30 天），無法填劇本的 2038/11/10；付款日只能是今天或近 30 天內');
      await vis(w.page, 'act-date').fill(taipeiDay());
      await vis(w.page, 'act-confirm').click();
      await expect(vis(w.page, 'pe-status')).toHaveText('已付款');
      await expect(vis(w.page, 'pe-paid-info')).toContainText('ZTJ-MOMO-1111-PAY');
      await shot(w.page, '已付款');
      const pr = await dbPr();
      expect(pr).toMatchObject({ status: 'PAID', pay_method: 'TRANSFER', paid_ref: 'ZTJ-MOMO-1111-PAY', paid_by: users.accountant.id });
      expect(String(pr.paid_date).slice(0, 10)).toBe(taipeiDay());
      expect(Number(pr.amount_total)).toBe(SYS_TOTAL);
      // 請款單列印頁：買受人抬頭
      await vis(w.page, 'pe-print').click();
      await expect(vis(w.page, 'pp-sign-ga')).toBeVisible();
      await expect(vis(w.page, 'pp-buyer')).toContainText(SCRIPT.buyerTitle);
      await shot(w.page, '請款單列印含買受人抬頭');
      note('請款單只有「送出→已付款」：沒有獨立的付款簽核主管；總務與會計權限相同，系統沒規定必須由不同人送出與付款（本劇本用兩個帳號）');
    } finally { await w.ctx.close(); }
  });

  await step('1-11', '總務', '確認總部庫存 10 台、採購單已到貨、發票與請款分頁顯示已付款', async () => {
    const w = await open(browser, 'buyer');
    try {
      await openGaCenter(w.page);
      await invNavTo(w.page, '庫存總覽');
      await expect(heading(w.page, '庫存餘額')).toBeVisible();
      await searchBox(w.page).fill(GAJ_PREFIX);
      const row = balanceRow(w.page, seed.part.name);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(seed.loc.name);
      await expect(row).toContainText('10');
      await shot(w.page, '庫存總覽10台');
      expect(await dbBal()).toBe(SCRIPT.qty);
      await openPo(w.page);
      await expect(dialog(w.page).getByTestId('pd-status')).toHaveText('全部到貨');
      await dialog(w.page).getByTestId('pd-tab-pay').click();
      await expect(w.page.getByTestId('pp-invoice').first()).toBeVisible();
      await expect(w.page.getByTestId('pp-request').first()).toBeVisible();
      await shot(w.page, '採購單發票與請款分頁');
      await expect(dialog(w.page).getByTestId('po-payment-panel')).toContainText(S.pr.no);
      await expect(dialog(w.page).getByTestId('po-payment-panel')).toContainText('已付款');
    } finally { await w.ctx.close(); }
  });

  await step('1-12', '總務', '到貨當天為 10 台設備產生 QR、貼標、拍照（劇本要求）', async () => {
    const w = await open(browser, 'buyer');
    try {
      const eq = await dbEquip();
      expect(eq).toHaveLength(0); // 到貨入總部庫存時沒有任何設備、沒有 QR
      const withName = ((await db().from('ga_equipment').select('id').like('name', `${GAJ_PREFIX}%`)).data || []) as any[];
      expect(withName).toHaveLength(0);
      await openGaCenter(w.page);
      await gaNavTo(w.page, '設備清冊', '設備管理');
      await expect(heading(w.page, '設備清冊')).toBeVisible();
      await w.page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first().fill(GAJ_PREFIX);
      await w.page.waitForTimeout(1200);
      await shot(w.page, '設備清冊找不到10台');
      unsupported('新版總部庫存只記「數量」（ZTJ-總部倉 10 台），不是 10 台各自有編號的設備；沒有設備就沒有 QR Code，也沒有地方貼標拍照。設備、資產編號、QR 要等「配發給門市」時才依門市建立（見 2-3），貼標拍照也是該門市店長做，不是總務。「10 台先有 QR 再入總部庫存」要使用者決定要不要新增');
    } finally { await w.ctx.close(); }
  });

  // ============================================================ 劇本 2
  await step('2-1', '店長（ZT01 代替南港店）', '在總務服務中心新增需求：料件添購補充 EPSON L6490 × 1 台', async () => {
    const w = await open(browser, 'store');
    try {
      await openGaCenter(w.page);
      await nav(w.page, '新增需求');
      await expect(vis(w.page, 'report-form')).toBeVisible();
      await w.page.getByTestId('type-purchase').check();
      await w.page.getByTestId('f-resource').selectOption('PART');
      await w.page.getByTestId('f-part-search').fill(seed.part.name);
      const opt = w.page.getByTestId('f-part').locator(`option:has-text("${seed.part.name}")`);
      await expect(opt).toHaveCount(1);
      await w.page.getByTestId('f-part').selectOption((await opt.getAttribute('value'))!);
      await w.page.getByTestId('f-qty').fill('1');
      await w.page.getByTestId('f-unit').fill('台');
      await w.page.getByTestId('f-title').fill(REQ_TITLE);
      await w.page.getByTestId('f-description').fill('門市櫃台印表機不堪使用，需要一台 EPSON L6490 連續供墨印表機');
      await shot(w.page, '新增需求');
      await w.page.getByTestId('create-submit').click();
      await expect(w.page.getByTestId('create-done')).toBeVisible();
      S.req.no = (await w.page.getByTestId('created-no').textContent())!.trim();
      expect(S.req.no).toMatch(/^GA-/);
      const row = (await db().from('ga_service_requests').select('*').eq('request_no', S.req.no).single()).data as any;
      S.req.id = row.id;
      expect(row).toMatchObject({ main_status: 'PENDING_INTAKE', request_type: 'PURCHASE_SUPPLEMENT', resource_type: 'PART', part_id: seed.part.id, store_id: sid.ZT01, title: REQ_TITLE });
      expect(Number(row.desired_quantity)).toBe(1);
      await w.page.getByTestId('go-mine').click();
      await expect(w.page.locator('[data-testid="mr-card"]:visible', { hasText: S.req.no })).toHaveCount(1);
      await shot(w.page, '我的追蹤待受理');
      note('補充類型只有「料件／一般耗材／其他採購」，沒有「設備」，印表機要用料件模式（料件已對應設備型號）；需求建立時間是現在，無法填 2038/11/15。DEV 的 store_manager 角色沒有提需求的 4 個權限，所以本劇本用自建的 ztj_store_requester 角色');
    } finally { await w.ctx.close(); }
  });

  await step('2-2', '總務', '在需求單工作台看到該單、搜尋、開啟並受理', async () => {
    const w = await open(browser, 'buyer');
    try {
      await openGaCenter(w.page);
      await nav(w.page, '總務需求工作台');
      await openRq(w.page, 'rq');
      await dialog(w.page).getByTestId('act-accept').click();
      const routes = await dialog(w.page).getByTestId('f-route').locator('option').allTextContents();
      note(`受理時的後續處理方式：${routes.join('、')}`);
      await shot(w.page, '受理需求選分流');
      await dialog(w.page).getByTestId('f-route').selectOption('ASSET_TASK');
      await dialog(w.page).getByTestId('f-role').selectOption('GENERAL_AFFAIRS');
      await dialog(w.page).getByTestId('action-submit').click();
      await expect(dialog(w.page).getByTestId('detail-notice')).toBeVisible();
      await shot(w.page, '受理後');
      expect(await dbReq()).toMatchObject({ main_status: 'ACCEPTED', intake_route: 'ASSET_TASK' });
      note('受理選「資產異動／門市配合」：選「庫存出庫」或「調撥處理」只會扣庫存數量、不會建出有資產編號的設備；要變成門市設備只能走採購單「配發」（2-3），所以這張需求單與配發是兩條各自獨立的路');
    } finally { await w.ctx.close(); }
  });

  await step('2-3', '總務採購', '從剛買的 10 台採購單配發 1 台給 ZT01（庫存 10→9，建立門市設備與 QR）', async () => {
    const w = await open(browser, 'buyer');
    try {
      await openPo(w.page);
      await dialog(w.page).getByTestId('act-dispatch').click();
      const dp = dialog(w.page).getByTestId('dispatch-form');
      await expect(dp).toBeVisible();
      await expect(dp.getByTestId('dp-template-mapped')).toBeVisible();
      await pickIn(dp, 'dp-store', 'ZT01');
      await dp.getByTestId('dp-qty').fill('1');
      await dp.getByTestId('dp-notes').fill(`${GAJ_PREFIX}依需求單 ${S.req.no} 配發（人工備註，系統不會自動連回需求單）`);
      await shot(w.page, '配發表單');
      await dp.getByTestId('dp-submit').click();
      await expect(dialog(w.page).getByTestId('pd-notice')).toContainText('已配發並建立 1 筆設備');
      await shot(w.page, '配發完成');
      expect(await dbBal()).toBe(SCRIPT.qty - 1);
      const eq = await dbEquip();
      expect(eq).toHaveLength(1);
      S.eq.id = eq[0].id;
      S.eq.code = eq[0].asset_code;
      expect(eq[0]).toMatchObject({ store_id: sid.ZT01, template_id: seed.tpl.id, onboarding_status: 'NEEDS_EQUIPMENT_PHOTO', source_purchase_order_id: S.po.id, vendor_id: seed.vendor.id, serial_number: null });
      expect(eq[0].asset_code).toBeTruthy();
      expect(eq[0].qr_token).toBeTruthy();
      expect(String(eq[0].warranty_start_date).slice(0, 10)).toBe(taipeiDay());
      expect(eq[0].source_dispatch_id).toBeTruthy();
      const dsp = (await db().from('ga_stock_dispatches').select('*').eq('id', eq[0].source_dispatch_id).single()).data as any;
      expect(dsp).toMatchObject({ store_id: sid.ZT01, part_id: seed.part.id });
      expect(Number(dsp.quantity)).toBe(1);
      expect(dsp.request_id).toBeNull(); // 缺口：配發沒有連回需求單
      expect(eq[0].source_request_id).toBeNull();
      expect(await dbBal()).toBe(9);
      note(`設備 ${S.eq.code} 已建立（ZT01、含 QR、保固起算日=到貨日、連結採購單與進貨）`);
      note('缺口：設備與配發紀錄沒有連到需求單（source_request_id、dispatch.request_id 皆為空）；只有採購單品項當初掛了需求單才會連。本劇本是先採購、後有門市需求，只能靠人工備註對照，需求單頁也看不到配發出的設備');
    } finally { await w.ctx.close(); }
  });

  await step('2-4', '店長（ZT01）', '收貨確認：貼標待辦補序號、先傳設備照再傳貼標位置照', async () => {
    const w = await open(browser, 'store');
    try {
      await openGaCenter(w.page);
      await gaNavTo(w.page, '貼標待辦');
      const card = w.page.locator('li[data-testid="onb-card"]:visible', { hasText: S.eq.code });
      await expect(card).toHaveCount(1);
      await shot(w.page, '貼標待辦');
      await card.getByTestId('serial-input').fill(`ZTJ-SN-${S.eq.code}`);
      await card.getByTestId('serial-save').click();
      await expect(notice(w.page, '已記錄')).toBeVisible();
      for (const done of [/已上傳.*設備照片，接著請上傳貼標位置照片/, /已上傳.*貼標位置照片，等總務複核/]) {
        await card.getByTestId('upload-input').setInputFiles({ name: 'ztj-photo.png', mimeType: 'image/png', buffer: png() });
        await card.getByRole('button', { name: '上傳照片' }).click();
        await expect(notice(w.page, done)).toBeVisible();
      }
      await expect(card).toHaveCount(0);
      await shot(w.page, '貼標拍照完成');
      const eq = (await db().from('ga_equipment').select('serial_number,onboarding_status').eq('id', S.eq.id).single()).data as any;
      expect(eq).toMatchObject({ serial_number: `ZTJ-SN-${S.eq.code}`, onboarding_status: 'PENDING_GA_REVIEW' });
      const photos = ((await db().from('ga_resource_attachments').select('id,purpose,storage_path,deleted_at').eq('resource_id', S.eq.id)).data || []) as any[];
      expect(photos.filter((p) => !p.deleted_at)).toHaveLength(2);
      note('新版沒有獨立的「收貨確認」按鈕：門市收貨＝店長在貼標待辦補序號並拍設備照與貼標位置照，之後狀態變「等總務複核」');
    } finally { await w.ctx.close(); }
  });

  await step('2-5', '另一位總務（設備管理）', '貼標複核通過，設備正式屬於 ZT01', async () => {
    const w = await open(browser, 'reviewer');
    try {
      await openGaCenter(w.page);
      await gaNavTo(w.page, '貼標複核');
      const rc = w.page.locator('li[data-testid="review-card"]:visible', { hasText: S.eq.code });
      await expect(rc).toBeVisible();
      await shot(w.page, '貼標複核');
      await rc.getByRole('button', { name: '通過' }).click();
      await dialog(w.page).getByRole('button', { name: '確認通過' }).click();
      await expect(notice(w.page, /已通過.*的貼標複核/)).toBeVisible();
      await expect(rc).toHaveCount(0);
      await shot(w.page, '複核通過');
      const eq = (await db().from('ga_equipment').select('onboarding_status,store_id,status').eq('id', S.eq.id).single()).data as any;
      expect(eq).toMatchObject({ onboarding_status: 'COMPLETED', store_id: sid.ZT01 });
    } finally { await w.ctx.close(); }
  });

  await step('2-6', '總務送門市確認、店長確認結案', '需求單：送門市確認 → 店長在我的追蹤確認完成', async () => {
    const ga = await open(browser, 'buyer');
    try {
      await openGaCenter(ga.page);
      await nav(ga.page, '總務需求工作台');
      await openRq(ga.page, 'rq');
      if ((await dialog(ga.page).getByTestId('act-request_store_confirmation').count()) === 0) {
        note('受理後（已受理）不能直接送門市確認，要先「更新處理進度」變處理中');
        await reqAct(ga.page, 'update_progress');
      }
      await reqAct(ga.page, 'request_store_confirmation');
      await shot(ga.page, '送門市確認');
      expect(await dbReq()).toMatchObject({ main_status: 'WAITING_STORE_CONFIRMATION' });
    } finally { await ga.ctx.close(); }
    const st = await open(browser, 'store');
    try {
      await openGaCenter(st.page);
      await nav(st.page, '我的追蹤');
      await openRq(st.page, 'mr');
      await shot(st.page, '店長待確認');
      await reqAct(st.page, 'confirm_complete');
      await expect(dialog(st.page)).not.toContainText('載入中', { timeout: 20_000 });
      await expect(dialog(st.page)).toContainText('已完成', { timeout: 20_000 }); // 等畫面狀態更新才截圖（否則會拍到舊的「待門市確認」）
      await shot(st.page, '店長確認完成');
      const row = await dbReq();
      expect(row.main_status).toBe('COMPLETED');
      expect(row.confirmed_at).toBeTruthy();
    } finally { await st.ctx.close(); }
  });

  await step('2-7', '總務', '驗收：庫存 9 台、門市設備 1 台、需求單結案、歷史價 11,490 查得到', async () => {
    const w = await open(browser, 'buyer');
    try {
      expect(await dbBal()).toBe(9);
      const eq = await dbEquip();
      expect(eq).toHaveLength(1);
      expect(eq[0]).toMatchObject({ store_id: sid.ZT01, onboarding_status: 'COMPLETED' });
      expect((await dbReq()).main_status).toBe('COMPLETED');
      await openGaCenter(w.page);
      await invNavTo(w.page, '庫存總覽');
      await searchBox(w.page).fill(GAJ_PREFIX);
      await expect(balanceRow(w.page, seed.part.name)).toContainText('9');
      await shot(w.page, '庫存總覽剩9台');
      await gaNavTo(w.page, '設備清冊', '設備管理');
      await w.page.getByRole('searchbox', { name: /搜尋/ }).locator('visible=true').first().fill(S.eq.code);
      await expect(w.page.locator('body')).toContainText(S.eq.code, { timeout: 20_000 });
      await shot(w.page, '設備清冊門市設備');
      // 歷史價：API 與新增採購單畫面
      const api = await apiForUser({ key: 'buyer', email: users.buyer.email, password: users.buyer.password } as any);
      const hr = await api.get(`${BASE}/purchase-orders/price-history?partId=${seed.part.id}`);
      expect(hr.status()).toBe(200);
      const hist = ((await hr.json()).data || []) as any[];
      expect(hist.map((h) => Number(h.unit_price))).toContain(SCRIPT.unitPrice);
      expect(hist[0]).toMatchObject({ po_no: S.po.no });
      await api.dispose();
      await nav(w.page, '採購單');
      await vis(w.page, 'new-po').click();
      const form = vis(w.page, 'po-form');
      await pickIn(form, 'pe-part-0', seed.part.name);
      await expect(form.getByTestId('pe-history-row').first()).toContainText('11,490');
      await expect(form.getByTestId('pe-history-row').first()).toContainText(seed.vendor.name);
      await shot(w.page, '歷史價顯示11490');
    } finally { await w.ctx.close(); }
  });

  // ============================================================ 彙整
  const failed = recs.filter((r) => r.status === '失敗');
  expect(failed.map((r) => `${r.no} ${r.title}：${r.note}`), '失敗的步驟（劇本寫錯或產品問題，詳見 steps.json）').toEqual([]);
});
