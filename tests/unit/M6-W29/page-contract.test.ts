import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { workspaceNavigation } from '../../../lib/workspace/navigation';
import { WORKSPACE_NAV_KINDS } from '../../../lib/workspace/page-kinds';
import { WORKSPACE_PAGE_META } from '../../../vue-workspace/src/workspace-page-meta';
import { cleanSearch, escapeLike, orContains } from '../../../lib/products-master/rules';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const listFiles = (dir: string): string[] => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));

describe('M6-W29：導覽、頁面與不含「併購」', () => {
  it('「商品部」導覽在工作頁內開啟（kind merchandise），三個權限碼任一即可看到', () => {
    const none: any = { has: () => false, roleCodes: new Set(), permissions: new Set(), isAdmin: false };
    const only = (code: string): any => ({ ...none, has: (...codes: string[]) => codes.includes(code) });
    const find = (ctx: any) => workspaceNavigation(ctx, {}).flatMap((g: any) => g.items).find((i: any) => i.label === '商品部');
    expect(find(none)).toBeUndefined();
    for (const code of ['cross_dept.stockout.submit', 'cross_dept.stockout.view_all', 'cross_dept.stockout.respond']) {
      expect(find(only(code)), code).toMatchObject({ kind: 'merchandise', href: '/cross-dept/merchandise' });
    }
    expect(WORKSPACE_NAV_KINDS).toContain('merchandise');
    expect(WORKSPACE_PAGE_META.merchandise).toMatchObject({ title: '商品部缺貨回報', permission: ['stockout'] });
  });
  it('新版導覽與頁面、API、共用規則的文字不含「併購」或 acquisition', () => {
    const ctx: any = { has: () => true, roleCodes: new Set(), permissions: new Set(), isAdmin: true };
    expect(JSON.stringify(workspaceNavigation(ctx, {}))).not.toContain('併購');
    const files = ['vue-workspace/src/pages/Merchandise.vue', 'lib/stockout/response.ts', 'lib/workspace/stockout.ts', ...listFiles('app/api/workspace/stockout')];
    for (const f of files) {
      expect(read(f), f).not.toContain('併購');
      expect(read(f).toLowerCase(), f).not.toContain('acquisition');
    }
  });
});

describe('M6-W29 g：舊版畫面沒有「刪除商品部回覆」按鈕，新版同樣沒有', () => {
  it('舊版頁面只呼叫一次 DELETE（刪除回報），沒有呼叫 DELETE /api/stockout-responses', () => {
    const legacy = read('app/cross-dept/merchandise/page.tsx');
    expect(legacy.match(/method:\s*'DELETE'/g)?.length).toBe(1);
    expect(legacy).toContain('/api/stockout-reports?id=${r.id}');
    expect(legacy).toContain("confirm('確定刪除這筆回報？')");
    // 舊版 API 有 DELETE（新版 API 對等提供），但舊畫面沒有按鈕
    expect(read('app/api/stockout-responses/route.ts')).toContain('export async function DELETE');
    expect(read('app/api/workspace/stockout/[[...path]]/route.ts')).toContain('deleteResponse');
  });
  it('新版頁面刪除前保留 confirm 文字，且沒有刪除回覆的按鈕或呼叫', () => {
    const page = read('vue-workspace/src/pages/Merchandise.vue');
    expect(page).toContain('確定刪除這筆回報？');
    expect(page).not.toContain('刪除回覆');
    expect(page).not.toContain('stockout/responses/');
  });
});

describe('M6-W29 f：關鍵字跳脫（共用商品主檔規則）', () => {
  it('逗號、括號、百分比、底線都被當一般文字', () => {
    const q = '含逗號,與(括號)100%_';
    const cond = orContains(escapeLike(cleanSearch(q)));
    expect(cond.startsWith('product_code.ilike."%')).toBe(true);
    expect(cond).toContain('product_name.ilike."%');
    // 值被雙引號包住，且 % 與 _ 已跳脫
    expect(cond).toContain('100\\\\%\\\\_');
    expect(`product_code.ilike.%${q}%,product_name.ilike.%${q}%`.split(',').length).toBeGreaterThan(2);
    expect(cleanSearch('  a  ')).toBe('a');
    expect(cleanSearch(undefined)).toBe('');
  });
});

describe('M6-W29 搜尋：80ms debounce 與舊請求不覆蓋新結果', () => {
  const page = read('vue-workspace/src/pages/Merchandise.vue');
  it('程式內有 80ms 的延遲與序號比對', () => {
    expect(page).toMatch(/\}, 80\)/);
    expect(page).toContain('if (mine !== suggestSeq) return;');
    expect(page).toContain('suggestSeq++');
    expect(page).toContain('products-master/search?q=');
  });
});
