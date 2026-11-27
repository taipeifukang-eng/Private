import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { expect, type Page, test } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { gaNavToIn, noPageOverflow, openGaCenter, pageForUser, visibleHeading } from '../support/g01-ui';
import { adminDb, assertGaBaseline, callFn, cleanupM7M8, stores } from '../support/m7m8-fixtures';
import { ga6Name, setupGa6Users, type Ga6User } from '../support/m7m8-ga6-fixtures';

// GAUBMATRIX 水電話費總表 e2e（DEV；資料只用 VW／ZT 門市、2038 年（另放一筆 2039 驗證不混入）；結束清掉自己建立的資料）。
//   劇本 1（資料庫與 API）：年度逐月函式回傳每據點 12 個月；數字與資料庫直接加總一致；只含該年度；無權限 403、年度錯誤 400。
//   劇本 2（畫面）：月模式仍是每據點一列、橫向各費用類型（含數字）→ 年度逐月（逐月數字、合計列、費用類型切換）
//                 → 匯出 Excel（合計＋水電電話網路各一頁、內容與畫面相同、檔名含年度）→ 月／季／年各自匯出目前表。
const GROUP = '水電電話網路費';
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

let users: Record<string, Ga6User> = {};
let teardown: () => Promise<string[]> = async () => [];
let state: any;
let st: Awaited<ReturnType<typeof stores>>;
const apis: Record<string, any> = {};
const P = '/api/workspace/general-affairs';
const noConsole = (errors: string[]) => errors.filter((e) => !/Failed to load resource/.test(e));
const vis = (page: Page, testid: string) => page.getByTestId(testid).locator('visible=true');
let seq = 0;

// [門市, 類型, 月份, 金額]
const PLAN: Array<['VW001' | 'ZT02', 'WATER' | 'ELECTRICITY' | 'PHONE' | 'INTERNET', string, number]> = [
  ['VW001', 'WATER', '2038-01-01', 100],
  ['VW001', 'ELECTRICITY', '2038-01-01', 1000],
  ['VW001', 'ELECTRICITY', '2038-03-01', 2000],
  ['VW001', 'PHONE', '2038-03-01', 300],
  ['VW001', 'INTERNET', '2038-12-01', 400],
  ['ZT02', 'WATER', '2038-03-01', 50],
  ['ZT02', 'ELECTRICITY', '2038-06-01', 700],
  ['VW001', 'ELECTRICITY', '2039-03-01', 999], // 2039：不能混進 2038
];
const TYPE_LABEL = { WATER: '水費', ELECTRICITY: '電費', PHONE: '電話費', INTERNET: '網路費' } as const;
const SHEET_OF = { ALL: '合計', ...TYPE_LABEL } as const;
const exp = (store: string, kind: 'ALL' | keyof typeof TYPE_LABEL, month: number) =>
  PLAN.filter((p) => p[0] === store && p[2].startsWith('2038-') && Number(p[2].slice(5, 7)) === month && (kind === 'ALL' || p[1] === kind)).reduce((s, p) => s + p[3], 0);

test.beforeAll(async () => {
  test.setTimeout(300_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  st = await stores();
  const made = await setupGa6Users(['util_mgr', 'nobody']);
  users = made.users;
  teardown = made.teardown;
  state = await (await apiForUser(users.util_mgr as any)).storageState();
  apis.mgr = await apiForUser(users.util_mgr as any);
  apis.nobody = await apiForUser(users.nobody as any);
  for (const [store, type, month, amount] of PLAN) {
    seq += 1;
    const r = await callFn(users.util_mgr.client, 'ga_ws_ub_save', {
      p_id: null,
      p_payload: { store_id: st[store].id, expense_type: type, billing_month: month, provider_name: ga6Name('MTX'), service_identifier: `QA-GA6-MTX-${String(seq).padStart(4, '0')}`, amount, due_date: '2039-06-20' },
      p_expected_updated_at: null, p_confirm_paid_change: false,
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  }
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await cleanupM7M8(), '清除總務測試資料').toEqual([]);
  expect(await teardown(), '清除測試帳號').toEqual([]);
});

test('劇本 1 資料庫與 API：每據點 12 個月、數字與資料庫加總一致、只含該年度、權限與年度檢查', async () => {
  const res = await apis.mgr.get(`${P}/utility-bills/report-monthly?year=2038`);
  expect(res.status(), await res.text()).toBe(200);
  const data = (await res.json()).data as { year: number; rows: any[]; month_totals: any[] };
  expect(data.year).toBe(2038);
  expect(data.month_totals).toHaveLength(12);
  const row = (code: string) => data.rows.find((r) => String(r.store_code) === code);
  const vw = row('VW001');
  const zt = row('ZT02');
  expect(vw.months).toHaveLength(12);
  expect(vw.months[0]).toMatchObject({ WATER: 100, ELECTRICITY: 1000, PHONE: 0, INTERNET: 0, total: 1100, bill_count: 2 });
  expect(vw.months[2]).toMatchObject({ ELECTRICITY: 2000, PHONE: 300, total: 2300, bill_count: 2 });
  expect(vw.months[11]).toMatchObject({ INTERNET: 400, total: 400 });
  expect(vw.months[1]).toMatchObject({ total: 0, bill_count: 0 });
  expect(zt.months[2]).toMatchObject({ WATER: 50, total: 50 });
  expect(zt.months[5]).toMatchObject({ ELECTRICITY: 700 });
  // 2039 那筆不在 2038；2039 年自己能看到
  const sum2038 = (r: any) => r.months.reduce((s: number, m: any) => s + Number(m.total), 0);
  expect(sum2038(vw)).toBe(3800);
  expect(sum2038(zt)).toBe(750);
  const r39 = (await (await apis.mgr.get(`${P}/utility-bills/report-monthly?year=2039`)).json()).data;
  expect(r39.rows.find((r: any) => String(r.store_code) === 'VW001').months[2].total).toBe(999);
  // 與資料庫直接加總一致（各月合計）
  const { data: bills } = await adminDb().from('ga_utility_bills').select('billing_month,amount,expense_type').is('deleted_at', null).gte('billing_month', '2038-01-01').lt('billing_month', '2039-01-01');
  for (let m = 1; m <= 12; m += 1) {
    const mine = (bills || []).filter((b: any) => Number(String(b.billing_month).slice(5, 7)) === m);
    expect(Number(data.month_totals[m - 1].total), `${m} 月合計`).toBe(mine.reduce((s: number, b: any) => s + Number(b.amount), 0));
    expect(Number(data.month_totals[m - 1].bill_count)).toBe(mine.length);
    for (const t of Object.keys(TYPE_LABEL)) expect(Number(data.month_totals[m - 1][t]), `${m} 月 ${t}`).toBe(mine.filter((b: any) => b.expense_type === t).reduce((s: number, b: any) => s + Number(b.amount), 0));
    // 逐據點相加＝各月合計（沒有漏列）
    expect(data.rows.reduce((s: number, r: any) => s + Number(r.months[m - 1].total), 0)).toBe(Number(data.month_totals[m - 1].total));
  }
  // 與既有月報表同口徑
  const mon = (await (await apis.mgr.get(`${P}/utility-bills/report?mode=month&year=2038&period=2038-03`)).json()).data;
  expect(mon.rows.find((r: any) => String(r.store_code) === 'VW001')).toMatchObject({ ELECTRICITY: 2000, PHONE: 300, total: 2300 });
  expect(Number(mon.totals.total)).toBe(Number(data.month_totals[2].total));
  // 權限與年度
  expect((await apis.nobody.get(`${P}/utility-bills/report-monthly?year=2038`)).status()).toBe(403);
  for (const bad of ['', '?year=1999', '?year=abc', '?year=2101']) expect((await apis.mgr.get(`${P}/utility-bills/report-monthly${bad}`)).status(), bad).toBe(400);
  const direct = await callFn(users.nobody.client, 'ga_ws_ub_year_matrix', { p_year: 2038 });
  expect(direct).toMatchObject({ ok: false, status: 403 });
});

test('劇本 2 畫面：月模式仍每據點一列橫向各費用類型 → 年度逐月與類型切換 → 匯出 Excel 內容與畫面一致', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await pageForUser(browser, state, testInfo);
  try {
    await openGaCenter(page);
    await gaNavToIn(page, GROUP, '費用報表');
    await expect(visibleHeading(page, '費用報表')).toBeVisible();
    await vis(page, 'rp-year').fill('2038');

    // 月模式（確認沒壞）：VW001 一列，水、電、電話、網路各一欄
    await vis(page, 'rp-month').selectOption('03');
    const mrow = page.locator('[data-testid="rp-row"]:visible', { hasText: 'VW001' }).first();
    await expect(mrow).toContainText('NT$ 2,300');
    await expect(mrow.locator('td[data-label="電費"]')).toContainText('2,000');
    await expect(mrow.locator('td[data-label="電話費"]')).toContainText('300');
    await expect(vis(page, 'rp-table').locator('thead')).toContainText('水費');
    await expect(vis(page, 'rp-table').locator('thead')).toContainText('網路費');
    // 月模式匯出目前這張表
    const [dl0] = await Promise.all([page.waitForEvent('download'), vis(page, 'rp-export').click()]);
    expect(dl0.suggestedFilename()).toBe('水電話費報表_2038-03月報表.xlsx');
    const wb0 = XLSX.read(fs.readFileSync(await dl0.path()), { type: 'buffer' });
    expect(wb0.SheetNames).toEqual(['03月']);
    const a0 = XLSX.utils.sheet_to_json<any[]>(wb0.Sheets['03月'], { header: 1 });
    expect(a0[0]).toEqual(['據點', '水費', '電費', '電話費', '網路費', '合計', '筆數']);
    const v0 = a0.find((r) => String(r[0]).includes('VW001'))!;
    expect(v0.slice(1)).toEqual([0, 2000, 300, 0, 2300, 2]);
    expect(a0[a0.length - 1][0]).toBe('合計');

    // 季、年各自匯出
    await vis(page, 'rp-mode').selectOption('quarter');
    await vis(page, 'rp-quarter').selectOption('1');
    await expect(page.locator('[data-testid="rp-row"]:visible', { hasText: 'VW001' }).first()).toContainText('NT$ 3,400');
    const [dlq] = await Promise.all([page.waitForEvent('download'), vis(page, 'rp-export').click()]);
    expect(dlq.suggestedFilename()).toBe('水電話費報表_2038年第1季.xlsx');
    const aq = XLSX.utils.sheet_to_json<any[]>(XLSX.read(fs.readFileSync(await dlq.path()), { type: 'buffer' }).Sheets['第1季'], { header: 1 });
    expect(aq.find((r) => String(r[0]).includes('VW001'))!.slice(1)).toEqual([100, 3000, 300, 0, 3400, 4]);
    await vis(page, 'rp-mode').selectOption('year');
    await expect(page.locator('[data-testid="rp-row"]:visible', { hasText: 'VW001' }).first()).toContainText('NT$ 3,800');
    const [dly] = await Promise.all([page.waitForEvent('download'), vis(page, 'rp-export').click()]);
    expect(dly.suggestedFilename()).toBe('水電話費報表_2038年報表.xlsx');
    const ay = XLSX.utils.sheet_to_json<any[]>(XLSX.read(fs.readFileSync(await dly.path()), { type: 'buffer' }).Sheets['年報表'], { header: 1 });
    expect(ay.find((r) => String(r[0]).includes('VW001'))!.slice(1)).toEqual([100, 3000, 300, 400, 3800, 5]);

    // 年度逐月
    await vis(page, 'rp-mode').selectOption('matrix');
    await expect(vis(page, 'rp-matrix')).toBeVisible();
    const vwRow = page.locator('[data-testid="rp-mrow"]:visible', { hasText: 'VW001' }).first();
    const ztRow = page.locator('[data-testid="rp-mrow"]:visible', { hasText: 'ZT02' }).first();
    await expect(vwRow.getByTestId('rp-m1')).toHaveText('1,100');
    await expect(vwRow.getByTestId('rp-m2')).toHaveText('-');
    await expect(vwRow.getByTestId('rp-m3')).toHaveText('2,300');
    await expect(vwRow.getByTestId('rp-m12')).toHaveText('400');
    await expect(vwRow.getByTestId('rp-msum')).toHaveText('3,800');
    await expect(ztRow.getByTestId('rp-m3')).toHaveText('50');
    await expect(ztRow.getByTestId('rp-m6')).toHaveText('700');
    await expect(ztRow.getByTestId('rp-msum')).toHaveText('750');
    await expect(vis(page, 'rp-mfoot')).toContainText('合計');
    expect(await noPageOverflow(page)).toBe(true);
    // 切換費用類型
    await vis(page, 'rp-kind').selectOption('ELECTRICITY');
    await expect(vwRow.getByTestId('rp-m1')).toHaveText('1,000');
    await expect(vwRow.getByTestId('rp-m3')).toHaveText('2,000');
    await expect(vwRow.getByTestId('rp-m12')).toHaveText('-');
    await expect(vwRow.getByTestId('rp-msum')).toHaveText('3,000');
    await vis(page, 'rp-kind').selectOption('PHONE');
    await expect(vwRow.getByTestId('rp-m3')).toHaveText('300');
    await expect(vwRow.getByTestId('rp-msum')).toHaveText('300');
    await expect(ztRow.getByTestId('rp-msum')).toHaveText('0');
    await vis(page, 'rp-kind').selectOption('ALL');

    // 匯出：合計＋水電電話網路各一頁，內容與畫面、與計畫一致
    const [dl] = await Promise.all([page.waitForEvent('download'), vis(page, 'rp-export').click()]);
    expect(dl.suggestedFilename()).toBe('水電話費總表_2038年度逐月.xlsx');
    const wb = XLSX.read(fs.readFileSync(await dl.path()), { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['合計', '水費', '電費', '電話費', '網路費']);
    for (const kind of ['ALL', 'WATER', 'ELECTRICITY', 'PHONE', 'INTERNET'] as const) {
      const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[SHEET_OF[kind]], { header: 1 });
      expect(rows[0]).toEqual(['據點', ...Array.from({ length: 12 }, (_, i) => `${i + 1}月`), '全年合計']);
      for (const store of ['VW001', 'ZT02'] as const) {
        const r = rows.find((x) => String(x[0]).includes(store));
        expect(r, `${SHEET_OF[kind]} ${store}`).toBeTruthy();
        const months = Array.from({ length: 12 }, (_, i) => exp(store, kind, i + 1));
        expect(r!.slice(1), `${SHEET_OF[kind]} ${store}`).toEqual([...months, months.reduce((a, b) => a + b, 0)]);
      }
      const foot = rows[rows.length - 1];
      expect(foot[0]).toBe('合計');
      // 合計列＝上面各列相加
      for (let c = 1; c <= 13; c += 1) expect(foot[c], `${SHEET_OF[kind]} 合計列第 ${c} 欄`).toBe(rows.slice(1, -1).reduce((s, r) => s + Number(r[c] || 0), 0));
    }
    // 四類相加＝合計頁
    const grand = (name: string) => { const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1 }); return rows[rows.length - 1][13] as number; };
    expect(grand('水費') + grand('電費') + grand('電話費') + grand('網路費')).toBe(grand('合計'));
    expect(noConsole(errors), errors.join('\n')).toEqual([]);
  } finally {
    await ctx.close();
  }
});
