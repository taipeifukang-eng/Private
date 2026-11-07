import path from 'node:path';
import fs from 'node:fs';
import { expect, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { storageStateFor } from './auth';
import { makePng } from './png';
import { gpsPanel, workPage } from './i01-fixtures';

// W14／W15 e2e 共用：編輯器操作、離線暫存（IndexedDB）檢查與寫入、換帳號。

export const ed = (page: Page) => workPage(page);
export const DB_NAME = 'workspace-inspection-drafts';

export async function waitUnlocked(page: Page) {
  await expect(gpsPanel(page)).toHaveAttribute('data-gps-status', 'success', { timeout: 30_000 });
}
export async function selectStore(page: Page, code: string) {
  const select = ed(page).getByLabel('巡店門市');
  const read = () => select.locator('option').allTextContents();
  await expect.poll(async () => (await read()).some((l) => l.includes(code)), { timeout: 30_000 }).toBe(true);
  await select.selectOption({ label: (await read()).find((l) => l.includes(code))! });
}
export const item = (page: Page, index = 0) => ed(page).locator('section.inspection-score-item').nth(index);
export const photoInput = (page: Page, index = 0) => item(page, index).getByTestId('photo-capture-input');
export const thumbs = (page: Page, index = 0) => item(page, index).locator('.photo-thumb');
export const png = (n = 0) => ({ name: `shot-${n}.png`, mimeType: 'image/png', buffer: makePng({ width: 640, height: 480, inkPixels: 60 + n }) });

/** 在簽名板（第 index 個簽名欄位）畫一筆並確認。 */
export async function sign(page: Page, index: number) {
  await ed(page).getByRole('button', { name: /開啟簽名板|重新簽名/ }).nth(index).click();
  const canvas = page.locator('dialog[open] canvas');
  await expect(canvas).toBeVisible();
  const confirm = page.getByTestId('signature-confirm');
  await expect(confirm).toBeDisabled();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + box.width * (0.2 + i * 0.05), box.y + box.height * (0.5 + (i % 2 ? 0.15 : -0.15)));
  await page.mouse.up();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

export async function sessionUserId(page: Page): Promise<string> {
  const res = await page.request.get('/api/workspace/session');
  return (await res.json()).user.id as string;
}

// ---- IndexedDB（與 vue-workspace/src/inspection-offline.ts 同一個資料庫）----
export async function idbAll(page: Page): Promise<any[]> {
  return page.evaluate(
    (name) =>
      new Promise<any[]>((resolve, reject) => {
        const open = indexedDB.open(name, 1);
        open.onupgradeneeded = () => open.result.createObjectStore('drafts', { keyPath: 'key' });
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('drafts', 'readonly').objectStore('drafts').getAll();
          req.onsuccess = () => {
            db.close();
            resolve(req.result);
          };
          req.onerror = () => reject(req.error);
        };
      }),
    DB_NAME,
  );
}
export async function idbPut(page: Page, draft: any) {
  await page.evaluate(
    ([name, d]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name as string, 1);
        open.onupgradeneeded = () => open.result.createObjectStore('drafts', { keyPath: 'key' });
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('drafts', 'readwrite');
          tx.objectStore('drafts').put(d);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    [DB_NAME, draft] as const,
  );
}
export async function idbClear(page: Page) {
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name, 1);
        open.onupgradeneeded = () => open.result.createObjectStore('drafts', { keyPath: 'key' });
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('drafts', 'readwrite');
          tx.objectStore('drafts').clear();
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    DB_NAME,
  );
}
export const draftCount = async (page: Page, userId?: string) => (await idbAll(page)).filter((d) => !userId || d.userId === userId).length;

/** 同一個瀏覽器（同一份 IndexedDB）換成另一個帳號登入：只換 cookie，不動儲存空間。 */
export async function switchAccount(ctx: BrowserContext, role: string) {
  const state = JSON.parse(fs.readFileSync(await storageStateFor(role, { force: true }), 'utf8'));
  await ctx.clearCookies();
  await ctx.addCookies(state.cookies);
}

export async function shot(page: Page, testInfo: TestInfo, name: string) {
  const dir = path.resolve(__dirname, '..', 'reports', process.env.TEST_RUN_ID || 'adhoc', 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${testInfo.project.name}.png`);
  await page.screenshot({ path: file });
  await testInfo.attach(name, { path: file, contentType: 'image/png' });
  return file;
}
