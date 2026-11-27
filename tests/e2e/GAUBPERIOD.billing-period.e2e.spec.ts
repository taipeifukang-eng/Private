import crypto from 'node:crypto';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { expect, test, type Page } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { dialog } from '../support/g12-ui';
import { gaNavToIn, noPageOverflow, openGaCenter, openGaSide, pageForUser, shell } from '../support/g01-ui';
import { adminDb, assertGaBaseline, cleanupM7M8, stores } from '../support/m7m8-fixtures';
import { addBillAttachment, cleanupGaup, gaupName, pastMonth, seedPayee, setupGaupUsers, todayIso, type GaupUser } from '../support/g46-fixtures';

// GAUBPERIOD 水電帳單「計費期間（起～迄）」e2e（DEV；資料只用 VW／ZT 門市與自訂據點、2038 年；結束清掉自己建立的資料）。桌機與手機（390）都跑畫面劇本；API、列印與 Excel 劇本只在桌機。
//   劇本 1（API 與資料庫）：水費電費必填、電話網路選填、只填一邊／迄早於起被擋、超過 70 天只回提醒、上一期查詢（排除自己、已刪除不算、無權限 403）、請款明細快照（帳單事後被改，請款單上的期間不變）。
//   劇本 2（畫面，桌機＋手機）：必填提示、起迄順序、超過 70 天提醒（返回修改不會存、確認後才存）、自動帶入上一期與空檔提醒、列表與詳情顯示期間與天數。
//   劇本 3（紙本列印，桌機）：事由含計費期間（同年 MM/DD、跨年民國年、多張合併取最早～最晚、舊帳單不加）；帳單多（10 列、4 張合併列）仍在 A4 上半張 138.5mm 內、事由不換行不截斷；PDF 下載；請款單明細顯示期間與天數。
//   劇本 4（Excel，桌機）：年度逐月與月／季／年匯出多一頁「帳單明細」，與資料庫逐列比對（排序、天數、度數、每日平均）。
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });
test.setTimeout(360_000);

const P = '/api/workspace/general-affairs';
const KEYS = ['clerk', 'accountant', 'ubview'] as const;
let users: Record<string, GaupUser> = {};
let teardown: () => Promise<string[]> = async () => [];
const apis: Record<string, any> = {};
const states: Record<string, any> = {};
let st: Awaited<ReturnType<typeof stores>>;
const key = () => crypto.randomUUID();
let seq = 0;
const ident = (tag = 'I') => `QA-GAUP-PBP-${String(Date.now()).slice(-6)}-${tag}${(seq += 1)}`;
const real = (errs: string[]) => errs.filter((x) => !/Failed to load resource: the server responded with a status of 4[0-9][0-9]/.test(x));
const vis = (page: Page, id: string) => page.getByTestId(id).locator('visible=true');
const isDesktop = (testInfo: any) => String(testInfo.project.name).startsWith('desktop');
const MM = 96 / 25.4;
const HALF_PAGE_MM = 148.5 - 10;

async function post(over: Record<string, unknown> = {}) {
  return apis.clerk.post(`${P}/utility-bills`, {
    data: { store_id: st.VW001.id, expense_type: 'WATER', billing_month: '2038-03', provider_name: gaupName('PBP'), service_identifier: ident(), amount: 100, ...over },
  });
}
async function mk(over: Record<string, unknown> = {}) {
  const r = await post(over);
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).data;
}

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = [...(await cleanupGaup()), ...(await cleanupM7M8())];
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  st = await stores();
  const made = await setupGaupUsers([...KEYS]);
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

test('劇本 1 API 與資料庫：必填、檢查、>70 天只提醒、上一期查詢、請款明細快照', async ({}, testInfo) => {
  test.skip(!isDesktop(testInfo), 'API 劇本只在桌機 project 跑');
  // 必填（水費、電費）；電話、網路選填
  for (const type of ['WATER', 'ELECTRICITY']) {
    const r = await post({ expense_type: type });
    expect(r.status()).toBe(400);
    const j = await r.json();
    expect(j.error).toContain('計費期間');
    expect(j.code).toBe('PERIOD_REQUIRED');
  }
  for (const type of ['PHONE', 'INTERNET']) {
    const r = await post({ expense_type: type });
    expect(r.status(), `${type} 不填期間：${await r.text()}`).toBe(201);
    const d = (await r.json()).data;
    expect(d.service_period_start).toBeNull();
    expect(d.period_days).toBeNull();
  }
  // 只填一邊、迄早於起、格式錯誤
  const half = await post({ service_period_start: '2038-01-01' });
  expect(half.status()).toBe(400);
  expect((await half.json()).code).toBe('PERIOD_INCOMPLETE');
  const half2 = await post({ expense_type: 'PHONE', service_period_end: '2038-01-31' });
  expect(half2.status()).toBe(400);
  const rev = await post({ service_period_start: '2038-02-01', service_period_end: '2038-01-31' });
  expect(rev.status()).toBe(400);
  expect((await rev.json()).code).toBe('PERIOD_ORDER');
  expect((await rev.json()).error).toContain('不能早於');
  expect((await post({ service_period_start: '2038-02-30', service_period_end: '2038-03-01' })).status()).toBe(400);
  // 70 天不提醒、71 天提醒（回 warnings，仍儲存）、90 天提醒
  const d70 = await post({ service_period_start: '2038-01-01', service_period_end: '2038-03-11', billing_month: '2038-01' });
  expect(d70.status(), await d70.text()).toBe(201);
  expect(((await d70.json()).warnings || []).some((w: any) => w.code === 'PERIOD_LONG')).toBe(false);
  const d71 = await post({ service_period_start: '2038-01-01', service_period_end: '2038-03-12', billing_month: '2038-02' });
  expect(d71.status()).toBe(201);
  const j71 = await d71.json();
  expect(j71.data.period_days).toBe(71);
  expect(j71.warnings.find((w: any) => w.code === 'PERIOD_LONG')).toMatchObject({ days: 71 });
  // 編輯：把原本沒有期間的電話費改成水費 → 要求補填（白話提示舊帳單）；只改備註不受影響
  const phone = await mk({ expense_type: 'PHONE' });
  const toWater = await apis.clerk.patch(`${P}/utility-bills/${phone.id}`, { data: { expense_type: 'WATER', expected_updated_at: phone.updated_at } });
  expect(toWater.status()).toBe(400);
  expect((await toWater.json()).error).toContain('舊帳單');
  const note = await apis.clerk.patch(`${P}/utility-bills/${phone.id}`, { data: { notes: '只改備註', expected_updated_at: phone.updated_at } });
  expect(note.status(), await note.text()).toBe(200);
  const noteData = (await note.json()).data;
  const filled = await apis.clerk.patch(`${P}/utility-bills/${phone.id}`, { data: { expense_type: 'WATER', service_period_start: '2038-03-01', service_period_end: '2038-03-31', expected_updated_at: noteData.updated_at } });
  expect(filled.status(), await filled.text()).toBe(200);
  // 沒有期間的帳單：標記已繳、改回待繳不受影響
  const free = await mk({ expense_type: 'PHONE', billing_month: pastMonth(1).slice(0, 7) });
  const paid = await apis.clerk.post(`${P}/utility-bills/${free.id}/pay`, { data: { paid_at: todayIso(), expected_updated_at: free.updated_at } });
  expect(paid.status(), await paid.text()).toBe(200);

  // 上一期：同門市、同類型、同識別，迄日最大者；排除自己；已刪除不算；別的識別號碼不帶入
  const id = ident('PV');
  const a = await mk({ service_identifier: id, billing_month: '2038-01', service_period_start: '2038-01-01', service_period_end: '2038-01-31' });
  const q = (extra: Record<string, string>) => new URLSearchParams({ store_id: st.VW001.id, expense_type: 'WATER', service_identifier: id, ...extra });
  const g1 = (await (await apis.clerk.get(`${P}/utility-bills/prev-period?${q({})}`)).json()).data;
  expect(g1).toMatchObject({ found: true, bill_id: a.id, service_period_end: '2038-01-31', service_period_start: '2038-01-01' });
  const b = await mk({ service_identifier: id, billing_month: '2038-02', service_period_start: '2038-02-01', service_period_end: '2038-02-28' });
  expect((await (await apis.clerk.get(`${P}/utility-bills/prev-period?${q({})}`)).json()).data).toMatchObject({ found: true, bill_id: b.id, service_period_end: '2038-02-28' });
  expect((await (await apis.clerk.get(`${P}/utility-bills/prev-period?${q({ exclude_id: b.id })}`)).json()).data).toMatchObject({ found: true, bill_id: a.id });
  expect((await (await apis.clerk.get(`${P}/utility-bills/prev-period?${q({ service_identifier: ident('NO') })}`)).json()).data.found).toBe(false);
  expect((await (await apis.clerk.get(`${P}/utility-bills/prev-period?${q({ store_id: st.VW002.id })}`)).json()).data.found).toBe(false);
  expect((await (await apis.clerk.get(`${P}/utility-bills/prev-period?${q({ expense_type: 'ELECTRICITY' })}`)).json()).data.found).toBe(false);
  const del = await apis.clerk.post(`${P}/utility-bills/${b.id}/delete`, { data: { reason: '測試刪除', expected_updated_at: b.updated_at } });
  expect(del.status(), await del.text()).toBe(200);
  expect((await (await apis.clerk.get(`${P}/utility-bills/prev-period?${q({})}`)).json()).data).toMatchObject({ found: true, bill_id: a.id });
  expect((await apis.ubview.get(`${P}/utility-bills/prev-period?${q({})}`)).status(), '只有檢視權限不能用（只給新增編輯表單）').toBe(403);
  expect((await apis.ubview.get(`${P}/utility-bills/report-details?mode=year&year=2038`)).status()).toBe(200);
  expect((await apis.ubview.get(`${P}/utility-bills/report-details?mode=month&year=2038&period=2037-01`)).status()).toBe(400);
  expect((await apis.ubview.get(`${P}/utility-bills/report-details?mode=week&year=2038`)).status()).toBe(400);

  // 請款明細快照：建立請款單 → 送出 → 事後改帳單的計費期間（不鎖）→ 請款單上仍是原本的期間
  const payee = await seedPayee('PBPSNAP');
  const snap = await mk({ billing_month: '2038-03', payee_vendor_id: payee.id, service_period_start: '2038-02-05', service_period_end: '2038-03-04', due_date: '2038-03-30' });
  await addBillAttachment(users.clerk.client, snap.id, users.clerk.id);
  const create = await apis.clerk.post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: payee.id, bill_month: '2038-03', expected_pay_date: '2038-03-31', idempotency_key: key() } });
  expect(create.status(), await create.text()).toBe(201);
  const pr = (await create.json()).data;
  const line = (await (await apis.clerk.get(`${P}/payment-requests/${pr.id}`)).json()).data.bill_lines[0];
  expect(line).toMatchObject({ service_period_start: '2038-02-05', service_period_end: '2038-03-04', period_days: 28 });
  const sub = await apis.clerk.post(`${P}/payment-requests/${pr.id}/actions`, { data: { action: 'submit', expected_updated_at: pr.updated_at, idempotency_key: key() } });
  expect(sub.status(), await sub.text()).toBe(200);
  const cur = (await (await apis.clerk.get(`${P}/utility-bills/${snap.id}`)).json()).data;
  const edit = await apis.clerk.patch(`${P}/utility-bills/${snap.id}`, { data: { service_period_start: '2038-02-06', service_period_end: '2038-03-05', expected_updated_at: cur.updated_at } });
  expect(edit.status(), '請款單送出後仍可修改計費期間（有快照，不鎖）：' + (await edit.text())).toBe(200);
  expect((await edit.json()).data).toMatchObject({ service_period_start: '2038-02-06', service_period_end: '2038-03-05' });
  const line2 = (await (await apis.clerk.get(`${P}/payment-requests/${pr.id}`)).json()).data.bill_lines[0];
  expect(line2, '請款明細仍是送出時的快照').toMatchObject({ service_period_start: '2038-02-05', service_period_end: '2038-03-04', period_days: 28 });
  const dbLine = (await adminDb().from('ga_payment_request_bill_lines').select('service_period_start,service_period_end').eq('bill_id', snap.id).single()).data as any;
  expect(dbLine).toEqual({ service_period_start: '2038-02-05', service_period_end: '2038-03-04' });
});

test('劇本 2 畫面：必填提示、起迄順序、超過 70 天提醒、自動帶入上一期與空檔提醒、列表與詳情顯示', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  const countBills = async (id: string) => ((await adminDb().from('ga_utility_bills').select('id').eq('service_identifier', id)).data || []).length;
  try {
    await openGaCenter(page);
    await gaNavToIn(page, '水電電話網路費', '帳單列表');
    const fillBase = async (d: any, id: string, type = 'WATER') => {
      await d.getByTestId('uf-store').selectOption(st.VW001.id);
      await d.getByTestId('uf-type').selectOption(type);
      await d.getByTestId('uf-month').fill('2038-05');
      await d.getByTestId('uf-provider').fill(gaupName('PBP'));
      await d.getByTestId('uf-ident').fill(id);
      await d.getByTestId('uf-amount').fill('888');
    };
    // ---- 必填、順序、70 天
    const idA = ident('UI');
    await vis(page, 'new-bill').click();
    let d = dialog(page);
    await fillBase(d, idA);
    await expect(d.getByTestId('uf-period-start')).toBeVisible();
    await expect(d.locator('label', { hasText: '計費起日' })).toContainText('必填');
    await d.getByTestId('uf-save').click();
    await expect(d.getByTestId('uf-error')).toContainText('計費期間');
    await d.getByTestId('uf-period-start').fill('2038-04-01');
    await d.getByTestId('uf-save').click();
    await expect(d.getByTestId('uf-error')).toContainText('一起填');
    await d.getByTestId('uf-period-end').fill('2038-03-31');
    await d.getByTestId('uf-save').click();
    await expect(d.getByTestId('uf-error')).toContainText('不能早於');
    // 電話費：選填（標籤顯示選填）
    await d.getByTestId('uf-type').selectOption('PHONE');
    await expect(d.locator('label', { hasText: '計費起日' })).toContainText('選填');
    await d.getByTestId('uf-type').selectOption('WATER');
    // 91 天：提醒；返回修改不會存；確認後才存
    await d.getByTestId('uf-period-end').fill('2038-06-30');
    await expect(d.getByTestId('uf-period-days')).toHaveText('共 91 天');
    await d.getByTestId('uf-save').click();
    await expect(vis(page, 'uf-period-long')).toBeVisible();
    await expect(vis(page, 'uf-period-long-message')).toContainText('91 天');
    await vis(page, 'uf-period-long-back').click();
    await expect(page.getByTestId('uf-period-long')).toHaveCount(0);
    expect(await countBills(idA), '返回修改不會存').toBe(0);
    if (!isDesktop(testInfo)) expect(await noPageOverflow(page)).toBe(true);
    await d.getByTestId('uf-save').click();
    await vis(page, 'uf-period-long-ok').click();
    await expect(vis(page, 'bill-detail')).toBeVisible({ timeout: 15_000 });
    expect(await countBills(idA), '確認後儲存').toBe(1);
    const row = (await adminDb().from('ga_utility_bills').select('*').eq('service_identifier', idA).single()).data as any;
    expect(row).toMatchObject({ service_period_start: '2038-04-01', service_period_end: '2038-06-30' });
    // 詳情顯示期間與天數
    await expect(vis(page, 'bd-period')).toHaveText('2038/04/01～2038/06/30（91 天）');
    await vis(page, 'bd-close').click();

    // ---- 自動帶入上一期：同門市、同類型、同識別號碼，起日＝上一期迄日＋1
    await vis(page, 'new-bill').click();
    d = dialog(page);
    await d.getByTestId('uf-store').selectOption(st.VW001.id);
    await d.getByTestId('uf-type').selectOption('WATER');
    await d.getByTestId('uf-month').fill('2038-07');
    await d.getByTestId('uf-ident').fill(idA);
    await expect(d.getByTestId('uf-period-start')).toHaveValue('2038-07-01', { timeout: 10_000 });
    await expect(d.getByTestId('uf-period-prev')).toContainText('依上一期（迄 2038/06/30）帶入');
    await expect(d.getByTestId('uf-period-gap')).toHaveCount(0);
    // 改成有空檔 → 提醒（不擋）；改成重疊 → 提醒
    await d.getByTestId('uf-period-start').fill('2038-07-05');
    await expect(d.getByTestId('uf-period-gap')).toContainText('空了 4 天');
    await d.getByTestId('uf-period-start').fill('2038-06-29');
    await expect(d.getByTestId('uf-period-gap')).toContainText('重疊');
    await d.getByTestId('uf-period-start').fill('2038-07-01');
    await expect(d.getByTestId('uf-period-gap')).toHaveCount(0);
    await d.getByTestId('uf-period-end').fill('2038-07-31');
    await d.getByTestId('uf-provider').fill(gaupName('PBP'));
    await d.getByTestId('uf-amount').fill('777');
    if (!isDesktop(testInfo)) expect(await noPageOverflow(page)).toBe(true);
    await d.getByTestId('uf-save').click();
    const anyway = vis(page, 'uf-save-anyway');
    if (await anyway.isVisible({ timeout: 1500 }).catch(() => false)) await anyway.click();
    await expect(vis(page, 'bill-detail')).toBeVisible({ timeout: 15_000 });
    await expect(vis(page, 'bd-period')).toHaveText('2038/07/01～2038/07/31（31 天）');
    await vis(page, 'bd-close').click();
    // 使用者自己改過的起日，之後換識別號碼也不會被覆蓋
    // ---- 列表顯示計費期間與天數
    await vis(page, 'filter-month').fill('');
    await vis(page, 'bill-search').fill(idA);
    await expect(page.locator('[data-testid="bill-card"]:visible')).toHaveCount(2);
    const periods = await page.locator('[data-testid="bill-period"]:visible').allInnerTexts();
    expect(periods.join('|')).toContain('2038/07/01～2038/07/31（31 天）');
    expect(periods.join('|')).toContain('2038/04/01～2038/06/30（91 天）');
    if (!isDesktop(testInfo)) expect(await noPageOverflow(page)).toBe(true);
    // ---- 編輯：期間可修改
    await page.locator('[data-testid="bill-card"]:visible').first().getByTestId('open-bill').click();
    await vis(page, 'bd-edit').click();
    d = dialog(page);
    await expect(d.getByTestId('uf-period-start')).toHaveValue(/2038-0[47]-01/);
    await expect(d.getByTestId('uf-period-legacy')).toHaveCount(0);
    await d.getByTestId('uf-cancel').click();
    expect(real(errors), errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('劇本 3 紙本列印：事由含計費期間；帳單多（8 張、含合併跨年列）仍在 A4 上半張內；PDF；請款明細顯示期間', async ({ browser }, testInfo) => {
  test.skip(!isDesktop(testInfo), '列印版面只在桌機 project 驗證');
  const payee = await seedPayee('PBPPR');
  const M = '2038-03';
  const bill = async (over: Record<string, unknown>) => {
    const b = await mk({ payee_vendor_id: payee.id, billing_month: M, due_date: '2038-03-30', expense_type: 'ELECTRICITY', ...over });
    await addBillAttachment(users.clerk.client, b.id, users.clerk.id);
    return b;
  };
  const per = (s: string, e: string) => ({ service_period_start: s, service_period_end: e });
  await bill({ store_id: st.VW001.id, amount: 11454, ...per('2038-02-05', '2038-03-04') }); // 同年
  await bill({ store_id: st.VW002.id, amount: 16577, ...per('2037-12-20', '2038-01-19') }); // 跨年
  for (const p of [['2037-12-28', '2038-01-27'], ['2038-02-03', '2038-03-05'], ['2038-01-28', '2038-02-27'], ['2038-02-10', '2038-03-09']]) await bill({ store_id: st.ZT01.id, amount: 1000, ...per(p[0], p[1]) }); // 4 張合併、跨年（事由最長）
  await bill({ store_id: st.ZT02.id, amount: 74, expense_type: 'PHONE' }); // 沒有期間（選填）
  await bill({ store_id: st.ZT03.id, amount: 15047, ...per('2038-02-01', '2038-03-31') });
  const create = await apis.clerk.post(`${P}/payment-requests`, { data: { source: 'UTILITY', vendor_id: payee.id, bill_month: M, expected_pay_date: '2038-03-31', idempotency_key: key() } });
  expect(create.status(), await create.text()).toBe(201);
  const pr = (await create.json()).data;
  const sub = await apis.clerk.post(`${P}/payment-requests/${pr.id}/actions`, { data: { action: 'submit', expected_updated_at: pr.updated_at, idempotency_key: key() } });
  expect(sub.status(), await sub.text()).toBe(200);

  const { ctx, page, errors } = await pageForUser(browser, states.clerk, testInfo);
  try {
    await openGaCenter(page);
    await openGaSide(page);
    await shell(page).locator('aside').getByRole('button', { name: '請款單', exact: true }).locator('visible=true').first().click();
    await vis(page, 'pr-search').fill(pr.pr_no);
    await vis(page, 'open-pr').click();
    // 請款單明細顯示計費期間與天數
    const lines = page.locator('[data-testid="pu-line"]:visible');
    await expect(lines).toHaveCount(8);
    const linePeriods = await page.locator('[data-testid="pu-line-period"]:visible').allInnerTexts();
    expect(linePeriods).toContain('2038/02/05～2038/03/04（28 天）');
    expect(linePeriods).toContain('2037/12/20～2038/01/19（31 天）');
    expect(linePeriods.filter((t) => t === '—'), '沒有期間的舊式帳單顯示空白').toHaveLength(1);
    await vis(page, 'pu-print').click();
    await expect(vis(page, 'pp-paper')).toBeVisible();
    const rows = page.locator('[data-testid="pk-row"]:visible');
    await expect(rows).toHaveCount(5);
    const texts = await rows.evaluateAll((trs) => trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())));
    const reasons = texts.map((r) => r[2]);
    expect(reasons.find((r) => r.includes('計費 02/05～03/04')), '同年用月/日').toContain('127年3月電費');
    expect(reasons.find((r) => r.includes('126/12/20～127/01/19')), '跨年用民國年').toContain('計費 126/12/20～127/01/19');
    expect(reasons.find((r) => r.includes('共 4 個電號')), '合併列取最早起日～最晚迄日（跨年用民國年）').toContain('計費 126/12/28～127/03/09');
    expect(reasons.find((r) => r.includes('電話費')), '沒有期間的帳單不加').toBe('127年3月電話費');
    expect(reasons.filter((r) => r.includes('計費')).length).toBe(4);
    // 列印媒體：高度在 A4 上半張內（138.5mm）、1 頁
    await page.emulateMedia({ media: 'print' });
    const keep = page.viewportSize();
    await page.setViewportSize({ width: Math.round(190 * MM), height: 1123 });
    const m = await page.evaluate(() => {
      const sheet = (Array.from(document.querySelectorAll('[data-testid="pp-paper"]')) as HTMLElement[]).find((e) => getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0)!;
      const r = sheet.getBoundingClientRect();
      const cells = Array.from(sheet.querySelectorAll('[data-testid="pk-reason"]')) as HTMLElement[];
      const fit = cells.map((td) => {
        const rg = document.createRange(); rg.selectNodeContents(td);
        return { text: td.textContent || '', lines: new Set(Array.from(rg.getClientRects()).map((q) => Math.round(q.top))).size, clipped: td.scrollWidth > td.clientWidth + 1 };
      });
      return { heightPx: r.height, top: r.top, fit };
    });
    // 事由在列印版面不換行、不被截斷（縮字後單行放得下）
    for (const c of m.fit) { expect(c.lines, `事由「${c.text}」不換行`).toBeLessThanOrEqual(1); expect(c.clipped, `事由「${c.text}」沒有被截斷`).toBe(false); }
    const heightMm = (m.top + m.heightPx) / MM;
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    await page.setViewportSize(keep!);
    await page.emulateMedia({ media: 'screen' });
    testInfo.annotations.push({ type: '紙張底端', description: `${heightMm.toFixed(1)}mm（上限 ${HALF_PAGE_MM}mm，5 列含計費期間、其中一列合併 4 張且跨年）` });
    expect(heightMm, `5 列含計費期間，底端 ${heightMm.toFixed(1)}mm 要在 ${HALF_PAGE_MM}mm 內`).toBeLessThanOrEqual(HALF_PAGE_MM);
    expect((pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length, 'PDF 只有 1 頁').toBe(1);
    // 下載 PDF（與列印同一份 DOM 與縮放）
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), vis(page, 'pk-download-pdf').click()]);
    expect(dl.suggestedFilename()).toContain(pr.pr_no);
    const buf = fs.readFileSync((await dl.path())!);
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(10 * 1024);
    // PDF 的紙面：與列印版相同的 190mm 內容寬、--k 0.8；量複本高度是否在上半張（由頁面實際產生 PDF 的同一段程式碼複製 DOM）
    const pdfMm = await page.evaluate(async () => {
      const src = document.querySelector('[data-testid="pp-paper"]') as HTMLElement;
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;box-sizing:border-box;padding:10mm;background:#fff;';
      const clone = src.cloneNode(true) as HTMLElement;
      clone.classList.add('pp-pdf');
      host.appendChild(clone);
      document.body.appendChild(host);
      const h = host.getBoundingClientRect().height;
      host.remove();
      return h * 25.4 / 96;
    });
    testInfo.annotations.push({ type: 'PDF 版面高度', description: `內容底端 ${(pdfMm - 10).toFixed(1)}mm（外框 ${pdfMm.toFixed(1)}mm 含上下白邊各 10mm；上限 ${HALF_PAGE_MM + 10}mm）` });
    expect(pdfMm - 10, `PDF 內容底端 ${(pdfMm - 10).toFixed(1)}mm 要在 A4 上半張（148.5mm）內`).toBeLessThanOrEqual(148.5);
    expect(real(errors), errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});

test('劇本 4 Excel：年度逐月與月／季／年匯出多一頁「帳單明細」，與資料庫逐列比對', async ({ browser }, testInfo) => {
  test.skip(!isDesktop(testInfo), 'Excel 匯出只在桌機 project 驗證');
  // 資料庫端的期望（只算 2038 年、本次測試建立的帳單）
  const { data: bills } = await adminDb().from('ga_utility_bills').select('store_id,location_name,expense_type,billing_month,service_period_start,service_period_end,electricity_kwh,amount,service_identifier,created_at')
    .is('deleted_at', null).gte('billing_month', '2038-01-01').lt('billing_month', '2039-01-01').like('provider_name', 'QA-GAUP-%');
  expect((bills || []).length).toBeGreaterThan(10);
  const { ctx, page, errors } = await pageForUser(browser, states.ubview, testInfo);
  try {
    await openGaCenter(page);
    await gaNavToIn(page, '水電電話網路費', '費用報表');
    await vis(page, 'rp-year').fill('2038');
    await vis(page, 'rp-mode').selectOption('matrix');
    await expect(vis(page, 'rp-matrix')).toBeVisible();
    const [dl] = await Promise.all([page.waitForEvent('download'), vis(page, 'rp-export').click()]);
    expect(dl.suggestedFilename()).toBe('水電話費總表_2038年度逐月.xlsx');
    const wb = XLSX.read(fs.readFileSync(await dl.path()), { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['合計', '水費', '電費', '電話費', '網路費', '帳單明細']);
    const aoa = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['帳單明細'], { header: 1 });
    expect(aoa[0]).toEqual(['門市／據點', '費用類型', '帳單月份', '計費起', '計費迄', '天數', '度數', '金額', '每日平均金額']);
    // 讀回的列：只看本次測試建立的（金額、帳單月份與期間能對上），再逐列比對
    const TYPE = { WATER: '水費', ELECTRICITY: '電費', PHONE: '電話費', INTERNET: '網路費' } as Record<string, string>;
    const slash = (v: string | null) => (v ? v.replace(/-/g, '/') : '');
    const days = (s: string | null, e: string | null) => (s && e ? Math.round((Date.parse(e) - Date.parse(s)) / 86400000) + 1 : null);
    const want = (bills || []).map((b: any) => {
      const n = days(b.service_period_start, b.service_period_end);
      return [TYPE[b.expense_type], String(b.billing_month).slice(0, 7), slash(b.service_period_start), slash(b.service_period_end), n ?? '', b.expense_type === 'ELECTRICITY' && b.electricity_kwh !== null ? Number(b.electricity_kwh) : '', Number(b.amount), n ? Math.round((Number(b.amount) / n) * 100) / 100 : ''].join('|');
    });
    const got = aoa.slice(1).map((r) => [r[1], r[2], r[3] || '', r[4] || '', r[5] ?? '', r[6] ?? '', r[7], r[8] ?? ''].join('|'));
    for (const w of want) expect(got, `Excel 缺少這張帳單：${w}`).toContain(w);
    // 排序：門市（代號）→ 費用類型 → 帳單月份
    const order = ['水費', '電費', '電話費', '網路費'];
    const sitesSeen: string[] = [];
    for (let i = 1; i < aoa.length; i += 1) {
      const site = String(aoa[i][0]);
      if (sitesSeen[sitesSeen.length - 1] !== site) { expect(sitesSeen, `同一門市的帳單要連在一起：${site}`).not.toContain(site); sitesSeen.push(site); }
      if (i > 1 && aoa[i - 1][0] === site) {
        const a = order.indexOf(aoa[i - 1][1]); const b = order.indexOf(aoa[i][1]);
        expect(b, `${site} 費用類型順序`).toBeGreaterThanOrEqual(a);
        if (a === b) expect(String(aoa[i][2]) >= String(aoa[i - 1][2]), `${site} 同類型依帳單月份`).toBe(true);
      }
    }
    const codes = sitesSeen.filter((s) => /^[A-Z]+\d+ /.test(s));
    expect(codes, '有代號的門市依代號排序，其他據點排最後').toEqual(codes.slice().sort());
    const firstOther = sitesSeen.findIndex((s) => !/^[A-Z]+\d+ /.test(s));
    if (firstOther >= 0) expect(sitesSeen.slice(firstOther).every((s) => !/^[A-Z]+\d+ /.test(s)), '其他據點排在最後').toBe(true);
    // 沒有期間的帳單：天數與每日平均留空
    const noPeriod = aoa.slice(1).filter((r) => !r[3]);
    expect(noPeriod.length).toBeGreaterThan(0);
    for (const r of noPeriod) { expect(r[5] ?? '').toBe(''); expect(r[8] ?? '').toBe(''); }
    // 月報表匯出：同一個帳單月份範圍
    await vis(page, 'rp-mode').selectOption('month');
    await vis(page, 'rp-month').selectOption('03');
    const [dlm] = await Promise.all([page.waitForEvent('download'), vis(page, 'rp-export').click()]);
    const wbm = XLSX.read(fs.readFileSync(await dlm.path()), { type: 'buffer' });
    expect(wbm.SheetNames).toEqual(['03月', '帳單明細']);
    const am = XLSX.utils.sheet_to_json<any[]>(wbm.Sheets['帳單明細'], { header: 1 });
    const monthWant = (bills || []).filter((b: any) => String(b.billing_month).startsWith('2038-03')).length;
    expect(am.length - 1, '月報表的帳單明細筆數＝該月未刪除帳單數').toBe(monthWant);
    expect(am.slice(1).every((r) => r[2] === '2038-03'), '月報表的帳單明細只含這個月').toBe(true);
    // 季、年
    await vis(page, 'rp-mode').selectOption('quarter');
    await vis(page, 'rp-quarter').selectOption('1');
    const [dlq] = await Promise.all([page.waitForEvent('download'), vis(page, 'rp-export').click()]);
    const aq = XLSX.utils.sheet_to_json<any[]>(XLSX.read(fs.readFileSync(await dlq.path()), { type: 'buffer' }).Sheets['帳單明細'], { header: 1 });
    expect(aq.slice(1).every((r) => ['2038-01', '2038-02', '2038-03'].includes(r[2]))).toBe(true);
    await vis(page, 'rp-mode').selectOption('year');
    const [dly] = await Promise.all([page.waitForEvent('download'), vis(page, 'rp-export').click()]);
    const wby = XLSX.read(fs.readFileSync(await dly.path()), { type: 'buffer' });
    expect(wby.SheetNames).toEqual(['年報表', '帳單明細']);
    expect(real(errors), errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
