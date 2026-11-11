import { expect, type Locator, type Page } from '@playwright/test';
import { expandGroup, openGaSide, shell } from './g01-ui';

// G12 頁面測試共用：從總務側欄進入庫存頁（有權限的人在「庫存管理」群組底下；只有門市名單身分的人舊側欄不列，入口補在最上層，所以先看群組在不在）。
export async function invNavTo(page: Page, label: '庫存總覽' | '庫存流水' | '庫存位置' | '調撥與收貨') {
  await openGaSide(page);
  const side = shell(page).locator('aside');
  if (await side.getByRole('button', { name: '庫存管理', exact: true }).count()) await expandGroup(page, '庫存管理');
  // 「調撥與收貨」舊側欄在「作業管理」與「庫存管理」各有一個入口（同一頁），取看得見的第一個。
  await side.getByRole('button', { name: label, exact: true }).locator('visible=true').first().click();
}

export const dialog = (page: Page) => page.locator('dialog[open]').last();
export const notice = (page: Page, text: string | RegExp) => page.locator('.notice:visible', { hasText: text }).first();
/** 餘額、流水、持有狀態的列：桌機是表格列，手機是卡片。 */
export const balanceRow = (page: Page, text: string): Locator => page.locator('[data-testid="balance-row"]:visible, [data-testid="balance-card"]:visible', { hasText: text });
export const txnRow = (page: Page, text?: string): Locator => page.locator('[data-testid="txn-row"]:visible, [data-testid="txn-card"]:visible', text ? { hasText: text } : undefined);
export const holdingRow = (page: Page, text: string): Locator => page.locator('[data-testid="holding-row"]:visible, [data-testid="holding-card"]:visible', { hasText: text });

/** 在庫存選擇器（位置、料件）輸入關鍵字並點選結果。 */
export async function pick(scope: Locator, label: string | RegExp, listName: string, term: string, optionText: string) {
  const input = scope.getByLabel(label).first();
  await input.fill(term);
  const opt = scope.getByRole('listbox', { name: listName }).getByRole('button', { name: optionText });
  await expect(opt.first()).toBeVisible();
  await opt.first().click();
}

/** 調撥單清單的列：桌機是表格列，手機是卡片。 */
export const trRow = (page: Page, text?: string): Locator => page.locator('[data-testid="tr-row"]:visible, [data-testid="tr-card"]:visible', text ? { hasText: text } : undefined);
/** 直接用網址深連結開調撥頁（舊網址參數完整保留：fromRequestId、requestNo、partId、quantity、sourceLocationId、destinationStoreId、reason、notes）。 */
export async function openTransferLink(page: Page, params: Record<string, string>) {
  const q = new URLSearchParams(params).toString();
  // 只改網址的 # 部分不會重新載入頁面，所以先離開再進入，確保深連結一定被重新處理。
  await page.goto('about:blank');
  await page.goto(`/workspace/index.html#/open/ga-inventory-transfers${q ? `?${q}` : ''}`, { waitUntil: 'networkidle' });
}
