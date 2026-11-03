import { createRequire } from 'node:module';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { readRowsAsServiceRole } from './parity';
import { addManual, registerFixtureRows, registry, staffCode, testStoreIds } from './w01a-fixtures';

const nodeRequire = createRequire(__filename);

/**
 * P01 測試資料（D15）：
 *  - 員工購物：POS 銷售月份固定用保留月份 2099-xx（每個測試層各用一個月，避免互相覆蓋），門市只用 ZT01／ZT02。
 *    匯入一律走 app 自己的 API（admin），再以 service role 只讀回查 id 並登錄到 registry（employee_purchase_sales、
 *    employee_purchase_import_batches、monthly_staff_status）；sweeper 另有保留月份機制清除 2099 的 employee_purchase_sales。
 *  - 藥師：只對 ZT01 寫入 2099-xx 的月份快照（手動補入），月份關帳用 2099-xx；結束時解除關帳並登錄 id。
 *    不對 2099 月份讀取「督導區總覽」，因為總覽會替所有可見門市自動同步該月快照，會在非測試門市留下 2099 資料。
 */
export const P01_MONTHS = {
  smoke: '2099-09',
  smokeMobile: '2099-10',
  integration: '2099-08',
  e2eDesktop: '2099-11',
  e2eMobile: '2099-12',
  parity: '2099-06',
} as const;

export { staffCode, registry };

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface PosRow {
  store: string;
  date: string;
  seq: string;
  member: string;
  name: string;
  product: string;
  productName: string;
  qty: number;
  profit: number;
  amount: number;
}

export function posBuffer(rows: PosRow[], extra: Record<string, unknown>[] = [], opts: { omitHeader?: string; noBand?: boolean } = {}): Buffer {
  const XLSX = nodeRequire('xlsx') as typeof import('xlsx');
  const header = ['門市代號', '銷售日期', '銷售序號', '會員編號', '會員名稱', '品號', '品名', '數量', '毛利', '總金額'].filter((h) => h !== opts.omitHeader);
  const all: unknown[][] = [header];
  const toCells = (r: Record<string, unknown>): unknown[] => header.map((h) => r[h] ?? null);
  for (const r of rows) {
    all.push(
      toCells({ 門市代號: r.store, 銷售日期: r.date, 銷售序號: r.seq, 會員編號: r.member, 會員名稱: r.name, 品號: r.product, 品名: r.productName, 數量: r.qty, 毛利: r.profit, 總金額: r.amount }),
    );
  }
  for (const r of extra) all.push(toCells(r));
  const aoa = opts.noBand ? all : [['GridBand1'], ...all];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '銷售明細');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function xlsxFile(buffer: Buffer, name = 'p01-pos.xlsx') {
  return { name, mimeType: XLSX_MIME, buffer };
}

/** 標準 POS 測試檔（五列有效＋合計列＋未知門市列）。 */
export function standardPos(month: string, codes: { a: string; b: string }) {
  const d = (day: number) => `${month}-${String(day).padStart(2, '0')} 10:00`;
  const rows: PosRow[] = [
    { store: 'ZT01', date: d(5), seq: 'ZTP-001', member: codes.a, name: 'ZT員購甲', product: 'P-001', productName: '測試品一', qty: 2, profit: 30, amount: 120 },
    { store: 'ZT01', date: d(6), seq: 'ZTP-002', member: codes.a, name: 'ZT員購甲', product: 'P-002', productName: '測試品二', qty: 1, profit: 10, amount: 80 },
    { store: 'ZT02', date: d(7), seq: 'ZTP-003', member: codes.b, name: 'ZT員購乙', product: 'P-001', productName: '測試品一', qty: 4, profit: 60, amount: 200 },
    { store: 'ZT01', date: d(8), seq: 'ZTP-004', member: 'ZTX-NOMATCH', name: '測試未比對甲', product: 'P-003', productName: '測試品三', qty: 1, profit: 5, amount: 50 },
    { store: 'ZZ999', date: d(9), seq: 'ZTP-005', member: codes.a, name: 'ZT員購甲', product: 'P-004', productName: '測試品四', qty: 1, profit: 1, amount: 10 },
  ];
  const extra = [{ 銷售序號: '合計', 數量: 9, 毛利: 106, 總金額: 460 }];
  return { rows, extra, expected: { imported: 4, skipped: 1, matched: 3, unmatched: 1, total: 450, count: 4 } };
}

export interface SeededPurchases {
  month: string;
  codes: { a: string; b: string };
  expected: ReturnType<typeof standardPos>['expected'];
  result: Record<string, any>;
  roster: { store: string; id: string }[];
}

/** 建立員購測試資料：ZT01／ZT02 各一位 2099-xx 月份人員（供比對職稱）→ 以 admin 匯入標準 POS 檔 → 登錄所有列。 */
export async function seedPurchases(admin: APIRequestContext, month: string, tags: [string, string] = ['U', 'V']): Promise<SeededPurchases> {
  const ids = await testStoreIds(admin, month);
  // 員編欄位長度有限：單字元標籤；每個測試層用不同的保留月份，所以同標籤不會重複。
  const codes = { a: staffCode(tags[0]), b: staffCode(tags[1]) };
  const r1 = await addManual(admin, ids.ZT01, month, { name: 'ZT員購甲', code: codes.a, position: '專員' });
  const r2 = await addManual(admin, ids.ZT02, month, { name: 'ZT員購乙', code: codes.b, position: '店長' });
  const pos = standardPos(month, codes);
  const res = await admin.post('/api/workspace/employee-purchases/import', { multipart: { file: xlsxFile(posBuffer(pos.rows, pos.extra), `p01-${month}.xlsx`) } });
  if (res.status() !== 200) throw new Error(`匯入員購測試檔失敗 HTTP ${res.status()} ${(await res.text()).slice(0, 160)}`);
  const result = await res.json();
  await registerPurchases(month, [ids.ZT01, ids.ZT02]);
  return { month, codes, expected: pos.expected, result, roster: [{ store: ids.ZT01, id: r1.id }, { store: ids.ZT02, id: r2.id }] };
}

/** 測完刪除自己建立的月份人員（草稿可刪），避免同月份的其他頁面測試看到多出來的人。刪除失敗不影響結果，sweeper 仍會清除。 */
export async function purgeSeededRoster(admin: APIRequestContext, seeded: { month: string; roster: { store: string; id: string }[] } | undefined) {
  if (!seeded) return;
  for (const r of seeded.roster) {
    try {
      await admin.post('/api/workspace/monthly', { data: { action: 'delete', store: r.store, month: seeded.month, id: String(r.id) } });
    } catch {
      /* sweeper 後備 */
    }
  }
}

/** 登錄該月份的員購列、匯入批次與月份人員（供 sweeper 依 id 清除）。 */
export async function registerPurchases(month: string, storeIds: string[]) {
  const reg = registry();
  const sales = await readRowsAsServiceRole('employee_purchase_sales', { eq: { year_month: month }, select: 'id' });
  if (sales.length) reg.record({ table: 'employee_purchase_sales', values: sales.map((r) => String(r.id)), note: `P01 ${month}` });
  const batches = await readRowsAsServiceRole('employee_purchase_import_batches', { eq: { year_month: month }, select: 'id' });
  if (batches.length) reg.record({ table: 'employee_purchase_import_batches', values: batches.map((r) => String(r.id)), note: `P01 ${month}` });
  for (const id of storeIds) await registerFixtureRows(id, month);
}

/** 登錄藥師月份快照與關帳列。 */
export async function registerPharmacists(month: string, storeId: string) {
  const reg = registry();
  const snap = await readRowsAsServiceRole('pharmacist_monthly_snapshot', { eq: { year_month: month, store_id: storeId }, select: 'id' });
  if (snap.length) reg.record({ table: 'pharmacist_monthly_snapshot', values: snap.map((r) => String(r.id)), note: `P01 ${month}` });
  const locks = await readRowsAsServiceRole('pharmacist_snapshot_locks', { eq: { year_month: month }, select: 'year_month' });
  if (locks.length) reg.record({ table: 'pharmacist_snapshot_locks', column: 'year_month', values: locks.map((r) => String(r.year_month)), note: `P01 ${month}` });
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

export const PHARMACIST_TITLE = '藥師管理';
export const PURCHASE_TITLE = '員工購物管理';

export const panel = (page: Page) => page.locator('section.work-page:visible');

export async function openNativePage(page: Page, title: string) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.locator(`.workspace-menu button.catalog-item[title="${title}"]`).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

export async function noPageOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // 刻意測試的錯誤回應（400/403/409）會在 console 留下「Failed to load resource」，不算頁面錯誤。
    if (/Failed to load resource/.test(t)) return;
    errors.push(t);
  });
  return errors;
}

export const money = (n: number) => Math.round(n).toLocaleString('zh-TW');

// ---------------------------------------------------------------------------
// 真實月份只讀防護（parity 專用）
// ---------------------------------------------------------------------------

export interface RealDataFootprint {
  snapshotRows: number;
  masterRows: number;
}

/**
 * 只讀（service role SELECT）：真實月份快照與年度主檔的列數。
 * parity 需要讀舊版總覽／主檔，但舊版與新版 overview 會替所有可見真實門市同步該月快照、舊版主檔 sync 會寫 2026 年度主檔。
 * 這些列不在 registry、sweeper 不會清；因此測試前後以此計數比對，證明沒有新增資料。
 */
export async function realDataFootprint(yearMonth: string, year: number): Promise<RealDataFootprint> {
  const snap = await readRowsAsServiceRole('pharmacist_monthly_snapshot', { eq: { year_month: yearMonth }, select: 'id', limit: 50000 });
  const master = await readRowsAsServiceRole('pharmacist_annual_master', { eq: { year }, select: 'employee_code', limit: 50000 });
  return { snapshotRows: snap.length, masterRows: master.length };
}

/** 使用者核可才允許對「尚未同步過」的真實月份觸發同步寫入。 */
export const REAL_SYNC_APPROVAL_ENV = 'P01_APPROVE_REAL_SYNC';
