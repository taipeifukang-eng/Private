import { expect, type Locator, type Page } from '@playwright/test';
import { openGaSide, shell } from './g01-ui';

/**
 * ga-improve-b1 畫面測試共用工具（冒煙與 e2e 共用）。
 * innerOverflow：除了整頁水平溢出，還檢查「內層容器」——
 *   (a) 元素右緣超出視窗寬度，且不在水平捲動容器（overflow-x:auto|scroll）裡；
 *   (b) 區塊容器本身的內容比它寬（scrollWidth > clientWidth），且它沒有設水平捲動（內容被擠出框外）。
 * 只檢查看得見的元素（隱藏的頁籤用 v-show，不算），表單欄位（input/textarea/select）本身的長文字不算。
 */
export async function innerOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    const scrollAncestor = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll') return true;
      }
      return false;
    };
    const roots = Array.from(document.querySelectorAll('[data-testid="ga-shell"], dialog[open]')).filter((r) => (r as HTMLElement).checkVisibility?.() ?? true);
    const seen = new Set<Element>();
    const label = (el: Element) => {
      const t = el.getAttribute('data-testid');
      return `${el.tagName.toLowerCase()}${t ? `[${t}]` : el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}`;
    };
    for (const root of roots) {
      for (const el of Array.from(root.querySelectorAll('*'))) {
        if (seen.has(el)) continue;
        seen.add(el);
        const h = el as HTMLElement;
        if (['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'SVG', 'PATH', 'SCRIPT', 'STYLE'].includes(el.tagName.toUpperCase())) continue;
        if (h.checkVisibility && !h.checkVisibility()) continue;
        const r = h.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cs = getComputedStyle(h);
        if (cs.position === 'fixed') continue;
        if (r.right > vw + 1 && !scrollAncestor(el)) out.push(`右緣超出視窗 ${label(el)} right=${Math.round(r.right)} vw=${vw}`);
        if (cs.display !== 'inline' && cs.overflowX === 'visible' && h.scrollWidth > h.clientWidth + 1 && h.clientWidth > 0 && !scrollAncestor(el)) {
          out.push(`內容擠出容器 ${label(el)} scrollWidth=${h.scrollWidth} clientWidth=${h.clientWidth}`);
        }
      }
    }
    return Array.from(new Set(out)).slice(0, 12);
  });
}

export const vis = (page: Page, id: string): Locator => page.getByTestId(id).locator('visible=true');
export const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true }).locator('visible=true').first();
export const real = (errs: string[]) => errs.filter((x) => !/Failed to load resource: the server responded with a status of 4[0-9][0-9]/.test(x));
export const dlg = (page: Page) => page.locator('dialog[open]').last();

export async function navTo(page: Page, label: string) {
  await openGaSide(page);
  await shell(page).locator('aside').getByRole('button', { name: label, exact: true }).locator('visible=true').first().click();
}

/** 搜尋式選單（PoPicker）：輸入關鍵字、選第一個符合的選項。 */
export async function pickIn(scope: Locator, testid: string, term: string) {
  const input = scope.getByTestId(testid).locator('visible=true').first();
  await input.click();
  await input.fill(term);
  const opt = scope.getByTestId(`${testid}-option`).filter({ hasText: term }).first();
  await expect(opt).toBeVisible();
  await opt.click();
  await expect(scope.getByTestId(`${testid}-picked`).locator('visible=true').first()).toBeVisible();
}

/** 斷言整頁與內層容器都沒有橫向溢出（附上是哪個元素）。 */
export async function expectNoOverflow(page: Page, where: string) {
  const page_ok = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(page_ok, `${where}：整頁水平溢出`).toBe(true);
  expect(await innerOverflow(page), `${where}：內層容器橫向溢出`).toEqual([]);
}
