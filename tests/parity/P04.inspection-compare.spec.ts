import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { apiAs, loginAs } from '../support/auth';
import { assertNoUnlistedDiffs, loadMap, ParityRecorder, valueDiffsToDiffs } from '../support/parity';
import { diffNormalized } from '../support/normalize';
import { M4B_MONTH, activeTemplates, deleteRunMasters, seedMaster, seedResults } from '../support/m4b-fixtures';
import { adminDb, runIdOrThrow } from '../support/m4-fixtures';
import { legacyCompareStatus } from '../../lib/workspace/inspection-compare';

// P04 對等層（M4 Q23）：督導與經理巡店比較。
//  status-rule：同一份督導單與經理單，舊版 handleCompare 判定（逐行對照原始碼）與新版 API 逐項相同；只有「兩邊都沒有紀錄」是已核可差異。
//  store-list：管理員（可看全部門市）舊版門市下拉（真實頁面）與新版門市清單相同。
//     （舊版門市下拉走使用者身分讀 stores；DEV 的 stores 讀取政策讓沒有門市任命的角色讀不到，例如營業部主管下拉是空的，新版用伺服端讀取不受影響。）
//  permission-ui：沒有權限的角色，舊版顯示「權限不足」、新版 API 403。
//  access-rule：Q23 的權限與門市範圍規則（舊版事實由原始碼讀出），已核可差異。

const map = loadMap('inspection-compare');
const recorder = new ParityRecorder('inspection-compare');
const find = (id: string) => map.entries.find((e) => e.id === id)!;
const root = path.resolve(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');

function report(entry: string, title: string, legacy: any, native: any, role = 'ops_manager') {
  const e = find(entry);
  assertNoUnlistedDiffs(
    recorder.record({
      entry,
      mechanism: e.mechanism,
      role,
      title,
      legacy: { endpoint: e.legacy.ui?.route || e.legacy.source || '' },
      native: { endpoint: e.native.api?.path || e.native.source || '' },
      compared: legacy,
      diffs: valueDiffsToDiffs(diffNormalized(legacy, native)),
    }),
  );
}

let sup = '';
let mgr = '';
let store = '';
let t: Awaited<ReturnType<typeof activeTemplates>> = [];
test.beforeAll(async () => {
  runIdOrThrow();
  t = await activeTemplates(8);
  sup = await seedMaster({ store: 'ZT05', inspector: 'supervisor', date: `${M4B_MONTH.compare}-25`, status: 'completed', total: 200, tag: 'p04-par-sup' });
  mgr = await seedMaster({ store: 'ZT05', inspector: 'ops_manager', date: `${M4B_MONTH.compare}-26`, status: 'completed', total: 190, type: 'manager', tag: 'p04-par-mgr' });
  // t0：5 vs 2、t1：0 vs 4、t2：3 vs 無、t3：無 vs 6、t4：4 vs 4、t5：0 vs 0；t6、t7 兩邊都沒有
  await seedResults(sup, [t[0], t[2], t[4], t[5], t[1]].map((template, i) => ({ template, deduction: [5, 3, 4, 0, 0][i] })));
  await seedResults(mgr, [t[0], t[1], t[3], t[4], t[5]].map((template, i) => ({ template, deduction: [2, 4, 6, 4, 0][i] })));
  const s = await adminDb().from('stores').select('id').eq('store_code', 'ZT05').single();
  store = s.data.id;
});
test.afterAll(async () => {
  await deleteRunMasters();
});

test('status-rule：舊版 handleCompare 判定與新版逐項相同；兩邊都沒有紀錄時舊版當成相同、新版標缺少明細（已核可）', async () => {
  test.setTimeout(300_000);
  // 舊版判定逐行確認在原始碼（lib 的 legacyCompareStatus 是它的等價實作）
  const src = read('app/inspection/compare/page.tsx');
  for (const line of [
    "if (supDeduction > 0 && mgrDeduction > 0) {",
    "status = supDeduction === mgrDeduction ? 'same' : 'both_different';",
    "} else if (supDeduction > 0 && mgrDeduction === 0) {",
    "status = 'supervisor_only';",
    "} else if (supDeduction === 0 && mgrDeduction > 0) {",
    "status = 'manager_only';",
  ])
    expect(src, line).toContain(line);
  const db = adminDb();
  const rows = (await db.from('inspection_results').select('inspection_id,template_id,deduction_amount').in('inspection_id', [sup, mgr])).data as any[];
  const side = (inspection: string, template: string) => rows.find((r) => r.inspection_id === inspection && r.template_id === template) || null;
  const api = await apiAs('ops_manager');
  try {
    const res = await api.get('/api/workspace/inspection-compare', { params: { store, supervisor: sup, manager: mgr } });
    expect(res.status(), (await res.text()).slice(0, 200)).toBe(200);
    const items = (await res.json()).items as any[];
    const nativeOf = (id: string) => items.find((x) => x.template.id === id)?.status;
    const legacy: Record<string, string> = {};
    const native: Record<string, string> = {};
    // 至少一邊有紀錄的項目：必須逐項相同
    for (const [i, tpl] of t.slice(0, 6).entries()) {
      legacy[`item${i}`] = legacyCompareStatus(side(sup, tpl.id), side(mgr, tpl.id));
      native[`item${i}`] = nativeOf(tpl.id);
    }
    // 兩邊都沒有紀錄的項目
    legacy.bothMissingStatus = legacyCompareStatus(side(sup, t[6].id), side(mgr, t[6].id));
    native.bothMissingStatus = nativeOf(t[6].id);
    expect(native.item0).toBe('both_different');
    expect(native.item2).toBe('supervisor_only');
    expect(native.item3).toBe('manager_only');
    report('status-rule', '差異判定（含缺的一邊視為 0 扣分）', legacy, native, 'ops_manager');
  } finally {
    await api.dispose();
  }
});

test('store-list 與 permission-ui：有權限者門市下拉相同；沒有權限者舊版「權限不足」、新版 403', async ({ browser }) => {
  test.setTimeout(300_000);
  for (const role of ['admin']) {
    const ctx = await loginAs(browser, role);
    try {
      const page = await ctx.newPage();
      await page.goto('/inspection/compare', { waitUntil: 'networkidle' });
      await page.waitForSelector('select', { timeout: 30_000 });
      await expect.poll(async () => (await page.locator('select').first().locator('option').count()) > 1, { timeout: 30_000 }).toBe(true);
      const legacyIds = (await page.locator('select').first().locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean))).sort();
      const api = await apiAs(role);
      let nativeIds: string[] = [];
      try {
        nativeIds = ((await (await api.get('/api/workspace/inspection-compare')).json()).stores as { id: string }[]).map((s) => s.id).sort();
      } finally {
        await api.dispose();
      }
      report('store-list', `${role}：門市下拉`, { stores: legacyIds }, { stores: nativeIds }, role);
      expect(nativeIds.length).toBeGreaterThan(5);
    } finally {
      await ctx.close();
    }
  }
  for (const role of ['supervisor', 'employee']) {
    const ctx = await loginAs(browser, role);
    try {
      const page = await ctx.newPage();
      await page.goto('/inspection/compare', { waitUntil: 'networkidle' });
      const legacyDenied = await page.getByText('權限不足').first().isVisible({ timeout: 30_000 }).catch(() => false);
      const api = await apiAs(role);
      let status = 0;
      try {
        status = (await api.get('/api/workspace/inspection-compare')).status();
      } finally {
        await api.dispose();
      }
      report('permission-ui', `${role}：沒有權限`, { denied: legacyDenied }, { denied: status === 403 }, role);
      expect(status).toBe(403);
    } finally {
      await ctx.close();
    }
  }
});

test('access-rule：Q23 權限與門市範圍（舊版事實讀原始碼，新版讀 API 原始碼）', async () => {
  const legacySrc = read('app/inspection/compare/page.tsx');
  const nativeSrc = read('app/api/workspace/inspection-compare/route.ts');
  const legacyCodes = Array.from(new Set(Array.from(legacySrc.matchAll(/p_permission_code: '([a-z_.]+)'/g)).map((m) => m[1]))).sort();
  const nativeCodes = Array.from(new Set(Array.from(nativeSrc.matchAll(/requireCapability\(ctx, \["([a-z_.]+)"\]\)/g)).map((m) => m[1]))).sort();
  expect(legacyCodes).toEqual(['inspection.compare']);
  const storesQuery = legacySrc.slice(legacySrc.indexOf(".from('stores')"), legacySrc.indexOf(".from('stores')") + 200);
  const legacy = {
    requiredPermissions: legacyCodes.join('+'),
    storeScope: storesQuery.includes(".eq('is_active', true)") && !storesQuery.includes('inspector') ? 'all-active-stores' : 'other',
  };
  const native = {
    requiredPermissions: nativeCodes.join('+'),
    storeScope: nativeSrc.includes('inspectionStores(ctx)') && nativeSrc.includes('q.eq("inspector_id", ctx.user.id)') ? 'visible-scope' : 'other',
  };
  expect(native.requiredPermissions).toBe('inspection.compare+inspection.manager_tab');
  expect(legacy.storeScope).toBe('all-active-stores');
  report('access-rule', '權限與門市範圍', legacy, native, 'admin');
});
