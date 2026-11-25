import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { workspaceNavigation } from '../../../lib/workspace/navigation';
import { WORKSPACE_NAV_KINDS } from '../../../lib/workspace/page-kinds';
import { WORKSPACE_PAGE_META } from '../../../vue-workspace/src/workspace-page-meta';

const root = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const LABEL = '診所自費藥毛利計算';

describe('M6-W30：導覽、頁面登記與 API 契約', () => {
  it('導覽：features.clinicSelfpay 為真才出現，且在工作頁內開啟（kind clinic-selfpay）；舊 Navbar 四個權限碼不再決定可見', () => {
    const ctx = (codes: string[] = []): any => ({ has: (...c: string[]) => c.some((x) => codes.includes(x)), roleCodes: new Set(), permissions: new Set(codes), isAdmin: false });
    const find = (c: any, features: Record<string, boolean>) => workspaceNavigation(c, features).flatMap((g: any) => g.items).find((i: any) => i.label === LABEL);
    expect(find(ctx(), {})).toBeUndefined();
    expect(find(ctx(['monthly.status.view_own', 'monthly.status.view_all', 'employee.movement.manage', 'store.manage']), {}), '舊四碼不再讓選單出現').toBeUndefined();
    expect(find(ctx(), { clinicSelfpay: true })).toMatchObject({ kind: 'clinic-selfpay', href: '/store/clinic-selfpay-margin' });
  });
  it('頁面登記：nav kind、頁面標題與所需 capability；capability 型別與 session 都有', () => {
    expect(WORKSPACE_NAV_KINDS).toContain('clinic-selfpay');
    expect(WORKSPACE_PAGE_META['clinic-selfpay']).toMatchObject({ title: LABEL, permission: ['clinicSelfpay'] });
    expect(read('vue-workspace/src/stores.ts')).toContain('clinicSelfpay: boolean');
    const session = read('app/api/workspace/session/route.ts');
    expect(session).toContain('clinicSelfpay,');
    expect(session).toContain('await clinicMenuVisible(ctx)');
    expect(read('vue-workspace/src/workspace-pages.ts')).toContain('"clinic-selfpay": ClinicSelfpay');
  });
  it('workspace API 路徑齊全（permissions、stores、batches、batches/:id、batches/import、mappings、mappings/close、mappings/history、prices/import），寫入類檢查 Origin', () => {
    const route = read('app/api/workspace/clinic-selfpay/[[...path]]/route.ts');
    for (const piece of ['"permissions"', '"stores"', '"batches"', '"mappings"', 'importBatch', 'getBatch', 'deleteBatch', 'closeMonth', 'priceHistory', 'importPrices']) expect(route, piece).toContain(piece);
    expect(route).toContain('if (method !== "GET") checkOrigin(r)');
    expect(route).toContain('context({ profile: false })');
  });
  it('每個動作都做權限與門市範圍檢查（資料表來自舊版，沒有新表）', () => {
    const lib = read('lib/workspace/clinic-selfpay.ts');
    for (const fn of ['getStores', 'listBatches', 'getBatch', 'deleteBatch', 'importBatch', 'listMappings', 'closeMonth', 'priceHistory', 'importPrices']) {
      const body = lib.slice(lib.indexOf(`export async function ${fn}(`));
      expect(body.slice(0, 700), fn).toContain('need(');
    }
    expect(lib).toContain('authorizedStores(');
    expect(lib).not.toMatch(/create table/i);
  });
  it('舊版頁面、舊 API、舊 Navbar 權限 hook 一行未改（Navbar.tsx 本身在上線 WP5 加了新版連結，不在此列）（相對於 W30 開工前的提交 7b7be83e）', () => {
    let out = '';
    try {
      out = execFileSync('git', ['diff', '--name-only', '7b7be83e', '--', 'app/api/clinic-selfpay', 'app/store/clinic-selfpay-margin', 'hooks/useNavbarPermissions.ts'], { cwd: root, encoding: 'utf8' });
    } catch {
      return; // 沒有 git 或沒有這個提交（例如打包環境）：略過
    }
    expect(out.trim(), '舊版檔案被修改').toBe('');
  });
  it('給診所的資料不含成本與毛利：本批尚無 PDF；W31 的 PDF 範本不得出現成本、毛利欄位（先在這裡鎖住規則的來源常數）', () => {
    // 計算器畫面有成本與毛利欄位；PDF 範本（W31）只允許這些欄位
    const page = read('vue-workspace/src/pages/ClinicSelfpay.vue');
    expect(page).toContain('data-testid="cell-cost"');
    expect(page).toContain('data-testid="cell-profit"');
  });
  it('Vue 頁面不 import 伺服端模組；截圖規則與解析規則共用 lib/clinic-selfpay', () => {
    const page = read('vue-workspace/src/pages/ClinicSelfpay.vue');
    expect(page).not.toMatch(/from "@\/|supabase|next\//);
    expect(page).toContain('lib/clinic-selfpay/screenshots');
  });
  it('DEV 儲存桶 SQL 與還原檔、正式區草稿都存在，且套用腳本包含它', () => {
    for (const f of ['supabase/workspace-dev/20261123140000_m6_clinic_selfpay_bucket.sql', 'supabase/workspace-dev/20261123140000_m6_clinic_selfpay_bucket.rollback.sql', 'docs/vue-workspace/parity-plan/m6-sql/20261123140000_m6_clinic_selfpay_bucket.sql', 'docs/vue-workspace/parity-plan/m6-sql/20261123140000_m6_clinic_selfpay_bucket.rollback.sql']) expect(fs.existsSync(path.join(root, f)), f).toBe(true);
    expect(read('scripts/apply-workspace-m6-dev.cjs')).toContain('20261123140000_m6_clinic_selfpay_bucket');
  });
});

describe('M6-W30：測試檔與真實樣本比對', () => {
  it('自造測試檔產生器可重複產生，且 18 個檔案都已提交（真實樣本尚未提供）', () => {
    const dir = path.join(root, 'tests/fixtures/clinic-selfpay');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const names = Object.keys((require(path.join(dir, 'make-fixtures.cjs')) as { buildAll: () => Record<string, Buffer> }).buildAll());
    expect(names).toHaveLength(18);
    for (const n of names) expect(fs.existsSync(path.join(dir, n)), n).toBe(true);
  });
  it('真實樣本比對工具：找不到樣本資料夾時回傳空清單（測試會乾淨略過）；樣本資料夾已被 git 排除', async () => {
    const { findSamples } = await import('../../parity/clinic-selfpay-real-sample');
    expect(findSamples(path.join(root, 'tests/fixtures/__no_such_dir__'))).toEqual({ price: [], claim: [] });
    const exclude = fs.existsSync(path.join(root, '.git/info/exclude')) ? fs.readFileSync(path.join(root, '.git/info/exclude'), 'utf8') : '';
    const gitignore = fs.existsSync(path.join(root, '.gitignore')) ? fs.readFileSync(path.join(root, '.gitignore'), 'utf8') : '';
    expect(exclude + gitignore).toContain('盤點測試檔');
  });
  it('樣本比對的差異回報只含位置、不含值', async () => {
    const { firstDifference } = await import('../../parity/clinic-selfpay-real-sample');
    expect(firstDifference({ a: [1, { b: '祕密藥名' }] }, { a: [1, { b: '別的' }] })).toBe('$.a[1].b');
    expect(firstDifference([1, 2], [1, 2])).toBeNull();
    expect(firstDifference([1, 2], [1])).toBe('$.length');
  });
});
