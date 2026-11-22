import fs from 'node:fs';
import { expect, type Download, type Page } from '@playwright/test';
import * as XLSX from 'xlsx';

/** M6-W25 離線盤點工具（新版 Vue 與舊版 Next）的畫面操作共用工具。 */
export const LABEL = {
  base: '1F當日商品資料',
  external: '外盤公司原始檔',
  pre: '預盤資料',
  fks: 'FKS0701盤點紀錄',
  modified: '外盤公司盤點Stock明細檔',
  internal: '修改後內部複盤資料',
  missing: '修改後未盤點檔案',
} as const;

// ---------------------------------------------------------------- 新版
export async function openNativeOffline(page: Page) {
  await page.goto('/workspace/index.html', { waitUntil: 'networkidle' });
  await page.waitForSelector('.menu-toggle');
  await page.click('.menu-toggle');
  await page.locator('.workspace-menu button.catalog-item[title="盤點管理"]').click();
  await page.getByRole('button', { name: '離線盤點匯入匯出工具' }).click();
  await expect(page.getByRole('heading', { name: '離線盤點匯入匯出工具' })).toBeVisible();
}
const fileRow = (page: Page, label: string) => page.locator('.offline-inventory label.file-row', { hasText: label });
export async function nativePick(page: Page, label: string, files: string | string[]) {
  await fileRow(page, label).locator('input[type=file]').setInputFiles(files);
  await expect(page.getByRole('button', { name: /讀取檔案/ })).toHaveCount(0);
}
export const nativeStep = (page: Page, n: 1 | 2 | 3) => page.locator('.offline-inventory .module-actions button', { hasText: new RegExp(`^\\s*${n}\\.`) }).first().click();
export const nativeGenerate = (page: Page) => page.getByRole('button', { name: '產生結果', exact: true }).click();
export async function nativeDownload(page: Page, buttonName: string | RegExp): Promise<Download> {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: buttonName }).click()]);
  return dl;
}

// ---------------------------------------------------------------- 舊版（/inventory）
export type LegacyHarness = { dialogs: string[]; downloads: Download[]; page: Page };
export async function openLegacyOffline(page: Page): Promise<LegacyHarness> {
  const h: LegacyHarness = { dialogs: [], downloads: [], page };
  page.on('dialog', (d) => {
    h.dialogs.push(d.message());
    void d.accept();
  });
  page.on('download', (d) => h.downloads.push(d));
  await page.goto('/inventory', { waitUntil: 'networkidle' });
  await expect(page.getByText('1F當日商品資料（必填）')).toBeVisible({ timeout: 30_000 });
  return h;
}
/** 舊版檔案欄位依序：基準檔在第 0 個，模組內的上傳欄從第 1 個開始。 */
export async function legacyUpload(h: LegacyHarness, index: number, files: string | string[]) {
  const before = h.dialogs.length;
  await h.page.locator('input[type=file]').nth(index).setInputFiles(files);
  await expect.poll(() => h.dialogs.length, { timeout: 20_000 }).toBeGreaterThan(before);
}
export const legacyModule = (h: LegacyHarness, n: 1 | 2 | 3) => h.page.getByRole('button', { name: new RegExp(`^模組${['', '一', '二', '三'][n]}：`) }).click();
export async function legacyGenerate(h: LegacyHarness, name: string | RegExp, expectDownloads: number) {
  const before = h.downloads.length;
  const dialogsBefore = h.dialogs.length;
  await h.page.getByRole('button', { name }).click();
  if (expectDownloads) await expect.poll(() => h.downloads.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(before + expectDownloads);
  else await expect.poll(() => h.dialogs.length, { timeout: 20_000 }).toBeGreaterThan(dialogsBefore);
  return h.downloads.slice(before);
}

// ---------------------------------------------------------------- 下載檔讀取
export async function readDownload(dl: Download): Promise<{ name: string; buffer: Buffer; sheetNames: string[]; rows: Record<string, unknown>[] }> {
  const file = await dl.path();
  const buffer = fs.readFileSync(file);
  const book = XLSX.read(buffer, { type: 'buffer' });
  return { name: dl.suggestedFilename(), buffer, sheetNames: book.SheetNames, rows: XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]) as Record<string, unknown>[] };
}
/** 台北時間的今天：{ iso: YYYY-MM-DD, md: M月D日 }。 */
export function taipeiToday(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]));
  return { iso: `${p.year}-${p.month}-${p.day}`, md: `${Number(p.month)}月${Number(p.day)}日` };
}
