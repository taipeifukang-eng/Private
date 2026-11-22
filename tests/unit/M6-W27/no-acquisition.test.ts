import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { workspaceNavigation } from '../../../lib/workspace/navigation';
import { WORKSPACE_NAV_KINDS } from '../../../lib/workspace/page-kinds';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const BANNED = '併購';

function listFiles(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

describe('M6-W27 B5：新版不含併購藥局商品整理', () => {
  it('新版導覽（所有項目標籤與連結）不含「併購」，商品主檔在工作頁內開啟', () => {
    const ctx: any = { has: () => true, roleCodes: new Set(), permissions: new Set(), isAdmin: true };
    const nav = workspaceNavigation(ctx, {});
    expect(JSON.stringify(nav)).not.toContain(BANNED);
    const item = nav.flatMap((g: any) => g.items).find((i: any) => i.label === '商品主檔');
    expect(item).toMatchObject({ kind: 'products-master', href: '/cross-dept/products-master' });
    expect(WORKSPACE_NAV_KINDS).toContain('products-master');
  });
  it('新版頁面、API、共用規則與工具的文字不含「併購」或 acquisition', () => {
    const files = [
      'vue-workspace/src/pages/ProductsMaster.vue',
      'vue-workspace/src/lib/xlsx.ts',
      'lib/products-master/rules.ts',
      'lib/workspace/products-master.ts',
      ...listFiles('app/api/workspace/products-master'),
    ];
    for (const f of files) {
      expect(read(f), f).not.toContain(BANNED);
      expect(read(f).toLowerCase(), f).not.toContain('acquisition');
    }
  });
  it('lib/workspace/modules.ts 沒有註冊併購相關項目', () => {
    expect(read('lib/workspace/modules.ts')).not.toContain(BANNED);
  });
  it('舊版商品主檔頁與併購元件仍在（本輪不修改、不刪除）', () => {
    expect(fs.existsSync(path.join(root, 'app/cross-dept/products-master/page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'components/products-master/AcquisitionProductsTab.tsx'))).toBe(true);
  });
});
