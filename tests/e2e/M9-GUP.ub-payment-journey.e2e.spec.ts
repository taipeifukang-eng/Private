import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Browser, type BrowserContext, type Locator, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { storageStateFor, TEST_ORIGIN } from '../support/auth';
import { gaNavToIn, noPageOverflow, openGaCenter, openGaSide, shell } from '../support/g01-ui';
import { dialog } from '../support/g12-ui';
import { uniqueTaxId } from '../support/m7m8-po-fixtures';
import { adminDb, assertDevOnly, cleanupGupData, GUP_PREFIX, type GupKey, type GupUser, keepData, setupGupUsers, SHOTS_DIR, SHOTS_ROOT, stores } from '../support/m9-gup-fixtures';
import { makePng } from '../support/png';

// M9-GUP 角色接力劇本「水電話費帳單接進請款單」（老闆定案規格 U1～U8 的實際走一遍，桌機 1920x1080 跑一次）：
//  2038 年 11 月，總務登錄 ZT01～ZT03 三家測試門市的電費（台電）、電話費與網路費（中華電信）、水費（自來水）帳單並附上帳單照片；
//  繳費單位在廠商資料建為「公用事業」（名稱 ZTU- 開頭）。
//  1. 台電 2038-11：系統自動帶入 3 家電費 → 勾選自動標記已繳（預設）→ 送出 → 帳單立即已繳（繳費日＝送出日）→ 會計標記已付款（轉帳、日期、參考號）。
//  2. 中華電信 2038-11：不勾自動標記 → 先示範缺附件被擋 → 補照片後送出 → 帳單仍待繳。
//  3. 同一張帳單不能放進第二張請款單；只能加同單位的帳單。
//  4. 手動標記已繳：2038 年的帳單日期上不可能手動標記（繳費日不能是未來、也不能早於帳單月份前 1 個月），所以另外用 2026-10 兩張補充帳單（中華電信，同樣不勾自動）示範。
//  5. 列印請款單（明細改列門市、費用類型、帳單月份、電號／水號／用戶號碼、金額）、請款單列表來源篩選。
// 資料全部帶 ZTU- 前綴。GUP_KEEP 預設 1：跑完保留資料給老闆在測試區查看；GUP_KEEP=0 才在結束時呼叫 scripts/ga-ub-pay-cleanup.cjs 的清除函式。
// 步驟結果寫在 tests/reports/_shots_ga_ub_pay/journey/steps.json，截圖也存在同一個資料夾。
const P = '/api/workspace/general-affairs';
const MONTH = '2038-11';
const SUPP_MONTH = '2026-10'; // 手動標記已繳用的過去月份（見上面第 4 點）

type Status = '通過' | '失敗';
type Rec = { no: string; role: string; title: string; status: Status; shot: string[]; note: string };
const recs: Rec[] = [];
const consoleIssues: string[] = [];
const layoutIssues: string[] = [];
let cur: { no: string; shots: string[]; notes: string[]; errors: string[] } = { no: '', shots: [], notes: [], errors: [] };

const taipeiDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const db = () => adminDb();
const vis = (page: Page, testid: string): Locator => page.getByTestId(testid).locator('visible=true');
const cards = (page: Page, testid: string): Locator => page.locator(`[data-testid="${testid}"]:visible`);
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('visible=true').first();
const realErrors = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const key = () => crypto.randomUUID();
const money = (n: number) => n.toLocaleString('en-US');

let users = {} as Record<GupKey, GupUser>;
let sid: Record<string, string> = {};
const states: Record<string, any> = {};
const apis: Record<string, any> = {};
const V: Record<'tpc' | 'cht' | 'water', { id: string; name: string }> = { tpc: { id: '', name: `${GUP_PREFIX}台電` }, cht: { id: '', name: `${GUP_PREFIX}中華電信` }, water: { id: '', name: `${GUP_PREFIX}自來水` } };

type BillSpec = { tag: string; store: 'ZT01' | 'ZT02' | 'ZT03'; type: 'ELECTRICITY' | 'PHONE' | 'INTERNET' | 'WATER'; month: string; vendor: keyof typeof V; ident: string; amount: number; kwh?: number; due: string; attach: boolean };
const BILLS: BillSpec[] = [
  // 電費（台電）
  { tag: 'E1', store: 'ZT01', type: 'ELECTRICITY', month: MONTH, vendor: 'tpc', ident: '07-12-3456-78-0', amount: 18640, kwh: 5320, due: '2038-12-10', attach: true },
  { tag: 'E2', store: 'ZT02', type: 'ELECTRICITY', month: MONTH, vendor: 'tpc', ident: '07-12-3456-79-1', amount: 9420, kwh: 2680, due: '2038-12-10', attach: true },
  { tag: 'E3', store: 'ZT03', type: 'ELECTRICITY', month: MONTH, vendor: 'tpc', ident: '07-12-3457-01-5', amount: 12350, kwh: 3540, due: '2038-12-10', attach: true },
  // 電話費與網路費（中華電信）；ZT03 的網路費先不附照片（示範缺附件被擋）
  { tag: 'C1', store: 'ZT01', type: 'PHONE', month: MONTH, vendor: 'cht', ident: '02-2711-0001', amount: 1280, due: '2038-12-15', attach: true },
  { tag: 'C2', store: 'ZT01', type: 'INTERNET', month: MONTH, vendor: 'cht', ident: 'HN-ZT01-8801', amount: 1680, due: '2038-12-15', attach: true },
  { tag: 'C3', store: 'ZT02', type: 'PHONE', month: MONTH, vendor: 'cht', ident: '02-2711-0002', amount: 960, due: '2038-12-15', attach: true },
  { tag: 'C4', store: 'ZT03', type: 'INTERNET', month: MONTH, vendor: 'cht', ident: 'HN-ZT03-8803', amount: 1590, due: '2038-12-15', attach: false },
  // 水費（自來水）：只登錄、不請款，保持待繳
  { tag: 'W1', store: 'ZT01', type: 'WATER', month: MONTH, vendor: 'water', ident: '21-0345-01', amount: 560, due: '2038-12-20', attach: true },
  { tag: 'W2', store: 'ZT02', type: 'WATER', month: MONTH, vendor: 'water', ident: '21-0345-02', amount: 480, due: '2038-12-20', attach: true },
  { tag: 'W3', store: 'ZT03', type: 'WATER', month: MONTH, vendor: 'water', ident: '21-0345-03', amount: 720, due: '2038-12-20', attach: true },
  // 手動標記示範用的補充帳單（過去月份）
  { tag: 'M1', store: 'ZT01', type: 'PHONE', month: SUPP_MONTH, vendor: 'cht', ident: '02-2711-0001', amount: 1250, due: '2026-11-30', attach: true },
  { tag: 'M2', store: 'ZT02', type: 'PHONE', month: SUPP_MONTH, vendor: 'cht', ident: '02-2711-0002', amount: 940, due: '2026-11-30', attach: true },
];
const B: Record<string, { id: string; spec: BillSpec }> = {};
const S = { tpc: { id: '', no: '' }, cht: { id: '', no: '' }, supp: { id: '', no: '' } };

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });

test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop-1440') return; // 手機 project 不跑，也不准動資料（否則會把桌機剛建的資料清掉）
  test.setTimeout(300_000);
  assertDevOnly();
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
  for (const f of fs.readdirSync(SHOTS_DIR)) if (/^\d.*\.png$/.test(f) || f === 'steps.json') fs.rmSync(path.join(SHOTS_DIR, f), { force: true });
  const left = await cleanupGupData(); // 可重跑：上次留下的 ZTU- 資料先清掉再重建
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  users = await setupGupUsers();
  const st = await stores();
  sid = { ZT01: st.ZT01.id, ZT02: st.ZT02.id, ZT03: st.ZT03.id };
  for (const k of Object.keys(users) as GupKey[]) {
    apis[k] = await apiForUser({ key: k, email: users[k].email, password: users[k].password } as any);
    states[k] = await apis[k].storageState();
  }
  void storageStateFor;
});

test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'desktop-1440') return;
  for (const c of Object.values(apis)) await c.dispose();
  if (!keepData()) {
    expect(await cleanupGupData(), '清除 ZTU- 資料').toEqual([]);
  }
});

type Who = { ctx: BrowserContext; page: Page };
async function open(browser: Browser, who: GupKey): Promise<Who> {
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
  fs.writeFileSync(path.join(SHOTS_DIR, 'steps.json'), JSON.stringify({ recs, consoleIssues, layoutIssues, ids: { S, V, bills: Object.fromEntries(Object.entries(B).map(([k, v]) => [k, v.id])) }, keep: keepData() }, null, 2));
}

async function nav(page: Page, label: string) {
  await openGaSide(page);
  await shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first().click();
}
async function openBillList(page: Page) {
  await openGaCenter(page);
  await gaNavToIn(page, '水電電話網路費', '帳單列表');
  await expect(heading(page, '水電電話網路費')).toBeVisible();
}
async function openPrList(page: Page) {
  await openGaCenter(page);
  await nav(page, '請款單');
  await expect(heading(page, '請款單')).toBeVisible();
}
/** 請款單列表搜尋單號後開啟。 */
async function openPr(page: Page, prNo: string) {
  await vis(page, 'pr-search').fill(prNo);
  const card = page.locator('[data-testid="pr-card"]:visible', { hasText: prNo });
  await expect(card).toHaveCount(1);
  await card.getByTestId('open-pr').click();
  await expect(vis(page, 'pu-status')).toBeVisible();
}
const dbBill = async (id: string) => (await db().from('ga_utility_bills').select('*').eq('id', id).single()).data as any;
const dbPr = async (id: string) => (await db().from('ga_payment_requests').select('*').eq('id', id).single()).data as any;
const apiPr = async (who: GupKey, id: string) => {
  const r = await apis[who].get(`${P}/payment-requests/${id}`);
  expect(r.status(), `GET 請款單 ${id}`).toBe(200);
  return (await r.json()).data as any;
};
const apiBill = async (who: GupKey, id: string) => {
  const r = await apis[who].get(`${P}/utility-bills/${id}`);
  expect(r.status(), `GET 帳單 ${id}`).toBe(200);
  const j = await r.json();
  return (j.data ?? j) as any;
};
const total = (tags: string[]) => tags.reduce((s, t) => s + B[t].spec.amount, 0);

/** 在已打開的帳單列表新增一張帳單（含附件照片）。 */
async function createBillUi(page: Page, s: BillSpec) {
  await vis(page, 'new-bill').click();
  const form = page.getByTestId('utility-form');
  await expect(form).toBeVisible();
  await form.getByTestId('uf-store').selectOption(sid[s.store]);
  await form.getByTestId('uf-type').selectOption(s.type);
  await form.getByTestId('uf-month').fill(s.month);
  await form.getByTestId('uf-provider').fill(V[s.vendor].name);
  await form.getByTestId('uf-payee').selectOption(V[s.vendor].id);
  await form.getByTestId('uf-ident').fill(s.ident);
  await form.getByTestId('uf-amount').fill(String(s.amount));
  if (s.kwh) await form.getByTestId('uf-kwh').fill(String(s.kwh));
  await form.getByTestId('uf-due').fill(s.due);
  await form.getByTestId('uf-notes').fill(`${GUP_PREFIX}劇本 ${s.tag}`);
  await form.getByTestId('uf-save').click();
  const anyway = vis(page, 'uf-save-anyway');
  if (await anyway.isVisible({ timeout: 1500 }).catch(() => false)) await anyway.click();
  await expect(vis(page, 'bill-saved')).toBeVisible();
  const detail = page.getByTestId('bill-detail');
  await expect(detail).toBeVisible();
  if (s.attach) await uploadPhoto(page, s.tag);
  const row = (await db().from('ga_utility_bills').select('*').eq('service_identifier', s.ident).eq('billing_month', `${s.month}-01`).like('provider_name', `${GUP_PREFIX}%`).single()).data as any;
  B[s.tag] = { id: row.id, spec: s };
  await vis(page, 'bd-close').click();
  await expect(detail).toBeHidden();
}
/** 在已打開的帳單詳情上傳一張帳單照片。 */
async function uploadPhoto(page: Page, tag: string) {
  const detail = page.getByTestId('bill-detail');
  const name = `${GUP_PREFIX}帳單照片-${tag}.png`;
  await detail.getByTestId('upload-input').setInputFiles({ name, mimeType: 'image/png', buffer: makePng({ width: 640, height: 420, colorful: true }) });
  await detail.getByRole('button', { name: /上傳 1 個檔案/ }).click();
  await expect(detail.locator('.notice.success')).toContainText('已上傳 1 個檔案');
}
async function openBillBy(page: Page, ident: string, month: string) {
  await vis(page, 'filter-month').fill(month);
  await vis(page, 'bill-search').fill(ident);
  const card = page.locator('[data-testid="bill-card"]:visible', { hasText: ident });
  await expect(card).toHaveCount(1);
  await card.getByTestId('open-bill').click();
  await expect(page.getByTestId('bill-detail')).toBeVisible();
}

test('M9-GUP 水電話費帳單接進請款單（登錄帳單、台電自動標記、中華電信不勾、缺附件、重複請款、列印）', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440', '劇本固定使用 1920x1080 桌機，只在桌機 project 跑一次');
  test.setTimeout(1_500_000);
  const today = taipeiDay();

  // ============================================================ 1 廠商資料：建立公用事業繳費單位
  await step('1', '總務', '在廠商資料建立三個公用事業繳費單位（台電、中華電信、自來水）', async () => {
    const w = await open(browser, 'clerk');
    try {
      await openGaCenter(w.page);
      await nav(w.page, '廠商資料');
      await expect(heading(w.page, '廠商資料')).toBeVisible();
      for (const k of ['tpc', 'cht', 'water'] as const) {
        await vis(w.page, 'new-vendor').click();
        const d = dialog(w.page);
        await expect(d.getByTestId('vendor-form')).toBeVisible();
        await d.getByTestId('vf-name').fill(V[k].name);
        await d.getByTestId('vf-tax').fill(uniqueTaxId());
        await d.getByTestId('vf-phone').fill('02-2345-6789');
        await d.getByTestId('vf-next').click();
        await d.getByTestId('vf-cat-公用事業').check();
        await d.getByTestId('vf-next').click();
        await d.getByTestId('vf-next').click();
        await d.getByTestId('vf-bank-name').fill('測試銀行');
        await d.getByTestId('vf-bank-branch').fill('測試分行');
        await d.getByTestId('vf-bank-account').fill(k === 'tpc' ? '000123456781' : k === 'cht' ? '000123456782' : '000123456783');
        await d.getByTestId('vf-bank-account-name').fill(`${V[k].name}（測試戶名）`);
        await d.getByTestId('vf-save').click();
        await expect(vis(w.page, 'vendor-saved')).toContainText(V[k].name);
        const row = (await db().from('ga_vendors').select('id,service_category_ids').eq('name', V[k].name).single()).data as any;
        V[k].id = row.id;
        expect(row.service_category_ids.length).toBeGreaterThan(0);
      }
      await vis(w.page, 'vendor-search').fill(GUP_PREFIX);
      await expect(cards(w.page, 'vendor-card')).toHaveCount(3);
      await shot(w.page, '廠商資料三個公用事業');
    } finally { await w.ctx.close(); }
  });

  // ============================================================ 2 登錄帳單
  await step('2', '總務', '登錄 2038 年 11 月帳單：ZT01～ZT03 的電費（台電）、電話費與網路費（中華電信）、水費（自來水），並附帳單照片', async () => {
    const w = await open(browser, 'clerk');
    try {
      await openBillList(w.page);
      for (const s of BILLS.filter((b) => b.month === MONTH)) await createBillUi(w.page, s);
      await vis(w.page, 'filter-month').fill(MONTH);
      await vis(w.page, 'bill-search').fill(GUP_PREFIX);
      await expect(vis(w.page, 'bill-total')).toHaveText('共 10 筆');
      await shot(w.page, '2038-11帳單列表');
      // 用 API 核對金額與繳費單位
      for (const s of BILLS.filter((b) => b.month === MONTH)) {
        const b = await apiBill('clerk', B[s.tag].id);
        expect(Number(b.amount), `${s.tag} 金額`).toBe(s.amount);
        expect(b.payee_vendor_id, `${s.tag} 繳費單位`).toBe(V[s.vendor].id);
        expect(b.paid_at, `${s.tag} 待繳`).toBeNull();
        expect(b.store_id).toBe(sid[s.store]);
      }
      const att = (await db().from('ga_resource_attachments').select('resource_id').eq('resource_type', 'UTILITY_BILL').is('deleted_at', null).in('resource_id', Object.values(B).map((x) => x.id))).data || [];
      expect(new Set(att.map((a: any) => a.resource_id)).size, '有照片的帳單數（10 張中少 ZT03 網路費）').toBe(9);
      note('10 張帳單：電費 3、電話費 2、網路費 2、水費 3；金額與繳費單位以 API 核對無誤；9 張已附照片，ZT03 網路費故意先不附。');
    } finally { await w.ctx.close(); }
  });

  // ============================================================ 3 台電請款單（自動帶入）
  await step('3', '總務', '建立「台電 2038-11」請款單：系統自動帶入 3 家電費，預設勾選送出後自動標記已繳，存成草稿', async () => {
    const w = await open(browser, 'clerk');
    try {
      await openPrList(w.page);
      await vis(w.page, 'new-pr-utility').click();
      await vis(w.page, 'pu-month').fill(MONTH);
      await vis(w.page, 'pu-vendor').selectOption(V.tpc.id);
      await expect(cards(w.page, 'pu-bill')).toHaveCount(3);
      await expect(vis(w.page, 'pu-count')).toHaveText('3');
      const sum = total(['E1', 'E2', 'E3']);
      await expect(vis(w.page, 'pu-grand')).toContainText(money(sum));
      await expect(vis(w.page, 'pu-auto')).toBeChecked();
      await shot(w.page, '台電自動帶入3家電費');
      await vis(w.page, 'pu-save').click();
      await expect(vis(w.page, 'pu-status')).toHaveText('草稿');
      const pr = (await db().from('ga_payment_requests').select('*').eq('vendor_id', V.tpc.id).single()).data as any;
      S.tpc = { id: pr.id, no: pr.pr_no };
      const api = await apiPr('clerk', pr.id);
      expect(api).toMatchObject({ source: 'UTILITY', status: 'DRAFT', auto_mark_paid: true, bill_count: 3 });
      expect(Number(api.amount_total)).toBe(sum);
      expect(String(api.bill_month).slice(0, 7)).toBe(MONTH);
      await shot(w.page, '台電請款單草稿');
      note(`請款單 ${pr.pr_no}：3 張、合計 ${money(sum)}、草稿、自動標記＝是`);
    } finally { await w.ctx.close(); }
  });

  // ============================================================ 4 送出（自動標記已繳）
  await step('4', '總務', '台電請款單送出：確認視窗提醒「3 張帳單會標記為已繳」，送出後帳單立即變已繳、繳費日＝今天', async () => {
    const w = await open(browser, 'clerk');
    try {
      await openPrList(w.page);
      await openPr(w.page, S.tpc.no);
      await vis(w.page, 'pu-submit').click();
      await expect(vis(w.page, 'act-auto-note')).toContainText('這 3 張帳單會標記為已繳');
      await shot(w.page, '送出確認提醒自動標記');
      await vis(w.page, 'act-confirm').click();
      await expect(vis(w.page, 'pu-status')).toHaveText('已送出');
      await expect(vis(w.page, 'pu-auto-info')).toContainText('已標記 3 張');
      await expect(cards(w.page, 'pu-line')).toHaveCount(3);
      const api = await apiPr('clerk', S.tpc.id);
      expect(api.status).toBe('SUBMITTED');
      for (const tag of ['E1', 'E2', 'E3']) {
        const b = await apiBill('clerk', B[tag].id);
        expect(String(b.paid_at).slice(0, 10), `${tag} 繳費日期＝送出日（台北今天）`).toBe(today);
        expect((await dbBill(B[tag].id)).paid_by_pr_id, `${tag} 記錄由哪張請款單標記`).toBe(S.tpc.id);
      }
      await shot(w.page, '台電已送出帳單自動已繳');
      note(`3 張電費帳單繳費日期＝${today}，paid_by_pr_id＝${S.tpc.no} 的請款單`);
    } finally { await w.ctx.close(); }
  });

  await step('5', '總務', '回到帳單列表看台電 3 張電費：已繳、顯示「請款單自動標記」；中華電信與水費維持待繳', async () => {
    const w = await open(browser, 'clerk');
    try {
      await openBillList(w.page);
      await vis(w.page, 'filter-month').fill(MONTH);
      await vis(w.page, 'bill-search').fill(GUP_PREFIX);
      await expect(vis(w.page, 'bill-total')).toHaveText('共 10 筆');
      await expect(cards(w.page, 'bill-auto-paid')).toHaveCount(3);
      await shot(w.page, '帳單列表台電已繳其餘待繳');
      await w.page.locator('[data-testid="bill-card"]:visible', { hasText: B.E1.spec.ident }).getByTestId('open-bill').click();
      await expect(vis(w.page, 'bd-auto-marked')).toBeVisible();
      await shot(w.page, '電費帳單詳情自動標記');
    } finally { await w.ctx.close(); }
  });

  // ============================================================ 6 會計標記已付款
  await step('6', '會計', '會計標記「台電 2038-11」已付款（轉帳、日期、參考號）；帳單不受影響、請款單鎖定', async () => {
    const w = await open(browser, 'accountant');
    try {
      await openPrList(w.page);
      await expect(vis(w.page, 'pr-pending')).toBeVisible();
      await shot(w.page, '會計請款單列表待付款');
      await openPr(w.page, S.tpc.no);
      await expect(vis(w.page, 'pu-status')).toHaveText('已送出');
      const before = await Promise.all(['E1', 'E2', 'E3'].map((t) => dbBill(B[t].id)));
      await vis(w.page, 'pu-paid').click();
      await vis(w.page, 'act-method').selectOption('TRANSFER');
      await vis(w.page, 'act-date').fill(today);
      await vis(w.page, 'act-ref').fill('38112');
      await shot(w.page, '會計標記已付款表單');
      await vis(w.page, 'act-confirm').click();
      await expect(vis(w.page, 'pu-status')).toHaveText('已付款');
      await expect(vis(w.page, 'pu-locked')).toBeVisible();
      const api = await apiPr('accountant', S.tpc.id);
      expect(api).toMatchObject({ status: 'PAID', pay_method: 'TRANSFER', paid_ref: '38112' });
      expect(String(api.paid_date).slice(0, 10)).toBe(today);
      const after = await Promise.all(['E1', 'E2', 'E3'].map((t) => dbBill(B[t].id)));
      expect(after.map((b) => [b.paid_at, b.paid_by_pr_id])).toEqual(before.map((b) => [b.paid_at, b.paid_by_pr_id]));
      await shot(w.page, '台電已付款鎖定');
      note(`已付款：轉帳、${today}、參考號 38112；3 張帳單狀態與日期沒有被改動`);
    } finally { await w.ctx.close(); }
  });

  // ============================================================ 7 中華電信請款單（不勾自動）
  await step('7', '總務', '建立「中華電信 2038-11」請款單：自動帶入 4 張（電話費 2、網路費 2），取消勾選「送出後帳單自動標記已繳」', async () => {
    const w = await open(browser, 'clerk');
    try {
      await openPrList(w.page);
      await vis(w.page, 'new-pr-utility').click();
      await vis(w.page, 'pu-month').fill(MONTH);
      await vis(w.page, 'pu-vendor').selectOption(V.cht.id);
      await expect(cards(w.page, 'pu-bill')).toHaveCount(4);
      await expect(vis(w.page, 'pu-count')).toHaveText('4');
      const sum = total(['C1', 'C2', 'C3', 'C4']);
      await expect(vis(w.page, 'pu-grand')).toContainText(money(sum));
      await expect(vis(w.page, 'pu-missing')).toHaveCount(1); // ZT03 網路費還沒有照片
      await vis(w.page, 'pu-auto').uncheck();
      await expect(vis(w.page, 'pu-auto')).not.toBeChecked();
      await shot(w.page, '中華電信帶入4張且缺1附件');
      await vis(w.page, 'pu-save').click();
      await expect(vis(w.page, 'pu-status')).toHaveText('草稿');
      const pr = (await db().from('ga_payment_requests').select('*').eq('vendor_id', V.cht.id).eq('bill_month', `${MONTH}-01`).single()).data as any;
      S.cht = { id: pr.id, no: pr.pr_no };
      const api = await apiPr('clerk', pr.id);
      expect(api).toMatchObject({ source: 'UTILITY', status: 'DRAFT', auto_mark_paid: false, bill_count: 4 });
      expect(Number(api.amount_total)).toBe(sum);
      note(`請款單 ${pr.pr_no}：4 張、合計 ${money(sum)}、草稿、自動標記＝否`);
    } finally { await w.ctx.close(); }
  });

  await step('8', '總務', '送出被擋：ZT03 網路費沒有附件，列出缺的帳單；補上照片後送出，帳單仍維持待繳', async () => {
    const w = await open(browser, 'clerk');
    try {
      await openPrList(w.page);
      await openPr(w.page, S.cht.no);
      await vis(w.page, 'pu-submit').click();
      await expect(vis(w.page, 'act-auto-note')).toContainText('沒有勾選自動標記');
      await vis(w.page, 'act-confirm').click();
      await expect(cards(w.page, 'missing-item')).toHaveCount(1);
      await expect(cards(w.page, 'missing-item').first()).toContainText('網路費');
      await expect(cards(w.page, 'missing-item').first()).toContainText('ZT 測試門市 03');
      await shot(w.page, '缺附件被擋列出缺的帳單');
      await vis(w.page, 'missing-close').click();
      expect((await dbPr(S.cht.id)).status, '被擋後仍是草稿').toBe('DRAFT');
      for (const t of ['C1', 'C2', 'C3', 'C4']) expect((await dbBill(B[t].id)).paid_at).toBeNull();
      // 補照片
      await openBillList(w.page);
      await openBillBy(w.page, B.C4.spec.ident, MONTH);
      await uploadPhoto(w.page, 'C4');
      await shot(w.page, '補上帳單照片');
      await vis(w.page, 'bd-close').click();
      // 回請款單送出
      await openPrList(w.page);
      await openPr(w.page, S.cht.no);
      await vis(w.page, 'pu-submit').click();
      await vis(w.page, 'act-confirm').click();
      await expect(vis(w.page, 'pu-status')).toHaveText('已送出');
      await expect(vis(w.page, 'pu-auto-info')).toContainText('否');
      expect((await apiPr('clerk', S.cht.id)).status).toBe('SUBMITTED');
      for (const t of ['C1', 'C2', 'C3', 'C4']) {
        const b = await apiBill('clerk', B[t].id);
        expect(b.paid_at, `${t} 不勾自動標記：帳單維持待繳`).toBeNull();
      }
      await shot(w.page, '中華電信已送出帳單仍待繳');
    } finally { await w.ctx.close(); }
  });

  // ============================================================ 9 重複請款防護
  await step('9', '總務', '同一張帳單不能放進第二張有效請款單（未繳但已在中華電信請款單內）；中華電信請款單也不能加入台電的電費', async () => {
    const w = await open(browser, 'clerk');
    try {
      await openPrList(w.page);
      await vis(w.page, 'new-pr-utility').click();
      await vis(w.page, 'pu-month').fill(MONTH);
      // (a) 中華電信 4 張帳單未繳（步驟 8 不勾自動標記）但已在 PY-…-003 內：畫面列出、不能再選，理由指出那張請款單號
      await vis(w.page, 'pu-vendor').selectOption(V.cht.id);
      await expect(cards(w.page, 'pu-bill')).toHaveCount(4);
      await expect(vis(w.page, 'pu-count')).toHaveText('0');
      await expect(cards(w.page, 'pu-reason')).toHaveCount(4);
      for (const r of await cards(w.page, 'pu-reason').all()) await expect(r).toContainText(`已在請款單 ${S.cht.no}`);
      await shot(w.page, '中華電信帳單未繳但已在請款單內不能再請');
      // (b) 台電畫面只列台電自己的 3 張電費（已繳優先，理由是已標記已繳）；其他單位的帳單根本不會出現在候選清單
      await vis(w.page, 'pu-vendor').selectOption(V.tpc.id);
      await expect(cards(w.page, 'pu-bill')).toHaveCount(3);
      await expect(vis(w.page, 'pu-count')).toHaveText('0');
      for (const t of ['C1', 'C2', 'C3', 'C4']) await expect(w.page.locator('[data-testid="pu-bill"]:visible', { hasText: B[t].spec.ident })).toHaveCount(0);
      await shot(w.page, '台電畫面不列其他單位帳單');
      // API：未繳但已在別張有效請款單 → 409 BILL_IN_OTHER_REQUEST，理由含請款單號
      const r1 = await apis.clerk.post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: V.cht.id, bill_month: MONTH, bill_ids: [B.C1.id], idempotency_key: key() } });
      const j1 = await r1.json().catch(() => ({}));
      expect(r1.status(), JSON.stringify(j1)).toBe(409);
      expect(j1.code).toBe('BILL_IN_OTHER_REQUEST');
      expect(j1.pr_no).toBe(S.cht.no);
      expect(String(j1.error)).toContain(`已在請款單 ${S.cht.no} 內`);
      // API：中華電信請款單不能加入台電的電費；台電請款單也不能加入中華電信的電話費（繳費單位不同）
      const r2 = await apis.clerk.post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: V.cht.id, bill_month: MONTH, bill_ids: [B.E1.id], idempotency_key: key() } });
      const j2 = await r2.json().catch(() => ({}));
      expect(r2.status(), JSON.stringify(j2)).toBe(409);
      expect(j2.code).toBe('BILL_PAYEE_MISMATCH');
      expect(String(j2.error)).toContain(`繳費單位不是 ${V.cht.name}`);
      const r3 = await apis.clerk.post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: V.tpc.id, bill_month: MONTH, bill_ids: [B.C1.id], idempotency_key: key() } });
      const j3 = await r3.json().catch(() => ({}));
      expect(r3.status(), JSON.stringify(j3)).toBe(409);
      expect(j3.code).toBe('BILL_PAYEE_MISMATCH');
      // 資料沒被動到：C1 仍只在中華電信那一張，E1 仍只在台電那一張，請款單數量不變
      const cht = await apiPr('clerk', S.cht.id);
      expect(cht.bill_count, '中華電信那張沒有被塞進電費').toBe(4);
      for (const [t, prId] of [['C1', S.cht.id], ['E1', S.tpc.id]] as const) {
        const act = (await db().from('ga_payment_request_bill_lines').select('pr_id').eq('bill_id', B[t].id).eq('active', true)).data || [];
        expect(act.map((x: any) => x.pr_id), `${t} 只在一張有效請款單`).toEqual([prId]);
      }
      note(`未繳但已在 ${S.cht.no} 的 C1：HTTP ${r1.status()} ${j1.code}（${String(j1.error).slice(0, 70)}）；中華電信加台電電費：HTTP ${r2.status()} ${j2.code}；台電加中華電信電話費：HTTP ${r3.status()} ${j3.code}`);
    } finally { await w.ctx.close(); }
  });

  // ============================================================ 10 手動標記已繳
  await step('10', '總務', '手動標記已繳：2038 年的帳單日期上標不了（系統規則），改用 2026-10 補充帳單（中華電信、不勾自動）示範手動標記', async () => {
    const w = await open(browser, 'clerk');
    try {
      // 先在 2038-11 帳單上試一次：今天的日期早於「帳單月份前 1 個月」，被系統擋下
      await openBillList(w.page);
      await openBillBy(w.page, B.C1.spec.ident, MONTH);
      await vis(w.page, 'bd-pay').click();
      await vis(w.page, 'bd-pay-date').fill(today);
      await vis(w.page, 'bd-pay-ok').click();
      const err = await vis(w.page, 'bd-error').innerText({ timeout: 8000 }).catch(() => '');
      note(`2038-11 帳單手動標記已繳（日期 ${today}）：${err ? `被擋「${err.slice(0, 80)}」` : '沒有看到錯誤訊息（請看截圖）'}`);
      expect((await dbBill(B.C1.id)).paid_at, '2038 帳單仍待繳').toBeNull();
      await shot(w.page, '2038帳單手動標記被規則擋下');
      await vis(w.page, 'bd-close').click();

      // 補充帳單：建兩張 2026-10 中華電信電話費，附照片
      await vis(w.page, 'filter-month').fill('');
      for (const s of BILLS.filter((b) => b.month === SUPP_MONTH)) await createBillUi(w.page, s);
      // 建請款單（不勾自動）→ 送出
      await openPrList(w.page);
      await vis(w.page, 'new-pr-utility').click();
      await vis(w.page, 'pu-month').fill(SUPP_MONTH);
      await vis(w.page, 'pu-vendor').selectOption(V.cht.id);
      await expect(cards(w.page, 'pu-bill')).toHaveCount(2);
      await vis(w.page, 'pu-auto').uncheck();
      await vis(w.page, 'pu-save').click();
      await expect(vis(w.page, 'pu-status')).toHaveText('草稿');
      const pr = (await db().from('ga_payment_requests').select('*').eq('vendor_id', V.cht.id).eq('bill_month', `${SUPP_MONTH}-01`).single()).data as any;
      S.supp = { id: pr.id, no: pr.pr_no };
      await vis(w.page, 'pu-submit').click();
      await vis(w.page, 'act-confirm').click();
      await expect(vis(w.page, 'pu-status')).toHaveText('已送出');
      for (const t of ['M1', 'M2']) expect((await apiBill('clerk', B[t].id)).paid_at).toBeNull();
      // 總務確認付款後，手動標記 M1 已繳（沿用既有「標記已繳」）
      await openBillList(w.page);
      await openBillBy(w.page, B.M1.spec.ident, SUPP_MONTH);
      await vis(w.page, 'bd-pay').click();
      await vis(w.page, 'bd-pay-date').fill(today);
      await vis(w.page, 'bd-pay-ok').click();
      await expect(vis(w.page, 'bd-notice')).toContainText('已標記為已繳');
      const m1 = await apiBill('clerk', B.M1.id);
      expect(String(m1.paid_at).slice(0, 10)).toBe(today);
      expect((await dbBill(B.M1.id)).paid_by_pr_id, '手動標記沒有請款單記錄').toBeNull();
      expect((await apiBill('clerk', B.M2.id)).paid_at, 'M2 還沒標').toBeNull();
      await shot(w.page, '手動標記已繳');
      await vis(w.page, 'bd-close').click();
      await vis(w.page, 'bill-search').fill(`${GUP_PREFIX}`);
      await vis(w.page, 'filter-month').fill(SUPP_MONTH);
      await expect(vis(w.page, 'bill-total')).toHaveText('共 2 筆');
      await shot(w.page, '補充帳單一已繳一待繳');
      note(`補充請款單 ${pr.pr_no}（中華電信 ${SUPP_MONTH}，不勾自動）：送出後兩張待繳；總務手動標記 ${B.M1.spec.ident} 已繳（${today}，沒有 paid_by_pr_id）；另一張維持待繳`);
    } finally { await w.ctx.close(); }
  });

  // ============================================================ 11 列印
  await step('11', '總務', '列印「台電 2038-11」請款單：明細改列門市、費用類型、帳單月份、電號、金額', async () => {
    const w = await open(browser, 'clerk');
    try {
      await openPrList(w.page);
      await openPr(w.page, S.tpc.no);
      await vis(w.page, 'pu-print-detail').click();
      const sheet = vis(w.page, 'pp-sheet');
      await expect(sheet).toBeVisible();
      await expect(vis(w.page, 'pp-no')).toHaveText(S.tpc.no);
      await expect(vis(w.page, 'pp-source')).toHaveText('水電話費');
      await expect(vis(w.page, 'pp-bill-month')).toHaveText(MONTH);
      await expect(cards(w.page, 'pp-line')).toHaveCount(3);
      const lines = await vis(w.page, 'pp-lines').innerText();
      for (const x of ['ZT 測試門市 01', 'ZT 測試門市 02', 'ZT 測試門市 03', '電費', '電號', '帳單月份', '07-12-3456-78-0', '18,640']) expect(lines, `列印明細要有「${x}」`).toContain(x);
      await expect(vis(w.page, 'pp-total')).toContainText(money(total(['E1', 'E2', 'E3'])));
      await expect(vis(w.page, 'pp-paid')).toContainText('轉帳');
      await shot(w.page, '台電請款單列印預覽');
      note(`列印明細：${lines.replace(/\s+/g, ' ').slice(0, 160)}`);
    } finally { await w.ctx.close(); }
  });

  // ============================================================ 12 列表與彙整
  await step('12', '會計', '請款單列表：來源「水電話費」篩選，看台電（已付款）、中華電信 2038-11 與 2026-10（已送出）', async () => {
    const w = await open(browser, 'accountant');
    try {
      await openPrList(w.page);
      await vis(w.page, 'pr-filter-source').selectOption('UTILITY');
      await vis(w.page, 'pr-search').fill(GUP_PREFIX);
      await expect(cards(w.page, 'pr-card')).toHaveCount(3);
      await expect(cards(w.page, 'pr-source').first()).toHaveText('水電話費');
      await shot(w.page, '請款單列表水電話費來源');
      const want: [string, string, number, string][] = [
        [S.tpc.id, 'PAID', total(['E1', 'E2', 'E3']), MONTH],
        [S.cht.id, 'SUBMITTED', total(['C1', 'C2', 'C3', 'C4']), MONTH],
        [S.supp.id, 'SUBMITTED', total(['M1', 'M2']), SUPP_MONTH],
      ];
      for (const [id, status, sum, m] of want) {
        const p = await apiPr('accountant', id);
        expect(p.status).toBe(status);
        expect(Number(p.amount_total)).toBe(sum);
        expect(String(p.bill_month).slice(0, 7)).toBe(m);
      }
      // 已送出的兩張：帳單狀態彙整
      const state = await Promise.all(Object.entries(B).map(async ([tag, v]) => [tag, (await dbBill(v.id)).paid_at ? '已繳' : '待繳'] as const));
      note(`最終帳單狀態：${state.map(([t, s]) => `${t}${s}`).join('、')}`);
      expect(Object.fromEntries(state)).toMatchObject({ E1: '已繳', E2: '已繳', E3: '已繳', C1: '待繳', C2: '待繳', C3: '待繳', C4: '待繳', W1: '待繳', W2: '待繳', W3: '待繳', M1: '已繳', M2: '待繳' });
    } finally { await w.ctx.close(); }
  });

  // ============================================================ 彙整
  const failed = recs.filter((r) => r.status === '失敗');
  expect(failed.map((r) => `${r.no} ${r.title}：${r.note}`), '失敗的步驟（劇本寫錯或產品問題，詳見 steps.json）').toEqual([]);
});
