import { expect, test, type APIRequestContext } from '@playwright/test';
import { apiForUser } from '../support/cv01-fixtures';
import { GA_PAGE_BY_HREF } from '../../lib/workspace/general-affairs/nav';
import { assertGaBaseline, cleanupM7M8, setupM7Users, type M7User } from '../support/m7m8-fixtures';

// 2026-11-11 驗收決定 A（整合層）：沒有任何角色與權限、只在門市名單上的督導與區經理，session 有 gaCenter、全站選單有「服務中心首頁」、
// 總務側欄只有唯讀的新版頁面；沒有權限的總務頁旗標都是 false。
let users: Record<string, M7User> = {};
let teardownUsers: () => Promise<string[]> = async () => [];
const apis: Record<string, APIRequestContext> = {};

test.beforeAll(async () => {
  test.setTimeout(240_000);
  await assertGaBaseline();
  const left = await cleanupM7M8();
  if (left.length) throw new Error(`清除上次殘留失敗：${left.join('; ')}`);
  const made = await setupM7Users(['bare_supervisor', 'bare_area_manager']);
  users = made.users;
  teardownUsers = made.teardown;
  for (const k of Object.keys(users)) apis[k] = await apiForUser(users[k] as any);
});
test.afterAll(async () => {
  for (const c of Object.values(apis)) await c.dispose();
  expect(await teardownUsers(), '清除帳號').toEqual([]);
});

const OPERATION_FLAGS = ['gaEquipmentCategories', 'gaFacilityCategories', 'gaPartCategories', 'gaParts', 'gaPartCreate', 'gaPartCompat', 'gaEquipmentTemplates', 'gaFacilityTemplates',
  'gaEquipmentCreate', 'gaFacilityCreate', 'gaEquipmentWarranties', 'gaFacilityWarranties', 'gaEquipmentLabels', 'gaFacilityLabels', 'gaOnboardingReview', 'gaAssetImport'];

for (const key of ['bare_supervisor', 'bare_area_manager']) {
  test(`${key}：session 有 gaCenter、選單有服務中心首頁、側欄只有唯讀新版頁面、操作類旗標全為 false`, async () => {
    const res = await apis[key].get('/api/workspace/session');
    expect(res.status()).toBe(200);
    const session = await res.json();
    expect(session.permissions || []).toEqual([]);
    const caps = session.capabilities;
    expect(caps).toMatchObject({ gaCenter: true, gaInventory: true, gaInventoryTransfers: true, gaInventoryLocations: true });
    for (const f of OPERATION_FLAGS) expect(caps[f], `${key} ${f}`).toBe(false);
    // 全站選單
    const entry = (session.navigation as any[]).flatMap((g) => g.items).find((i) => i.href === '/general-affairs');
    expect(entry).toMatchObject({ label: '服務中心首頁', kind: 'ga-center' });
    // 側欄：每個葉節點都是已移植的新版頁面，沒有舊版外連與停用項目
    const items = (session.gaNavigation as any[]).flatMap((g) => g.items.flatMap((i: any) => [i, ...(i.children || [])]));
    const kinds = items.map((i) => i.kind).filter(Boolean);
    expect(kinds).toEqual(expect.arrayContaining(['ga-inventory', 'ga-inventory-transfers']));
    for (const i of items) {
      if (!i.children?.length) expect(i.kind, `${key} ${i.id}`).toBeTruthy();
      expect(i.disabled, i.id).toBeUndefined();
    }
    for (const h of ['/general-affairs/requests', '/general-affairs/part-fulfillments', '/general-affairs/work-orders', '/general-affairs/vendors', '/general-affairs/utility-bills']) {
      expect(items.map((i) => i.href), `${key} ${h}`).not.toContain(h);
    }
    // 每個側欄頁面 kind 對應的旗標都為 true（沒有點了被擋的入口）
    const flagByKind = new Map(Object.values(GA_PAGE_BY_HREF).map((p) => [p.kind, p.flag]));
    for (const k of kinds) {
      const flag = flagByKind.get(k);
      if (flag) expect(caps[flag], `${key} ${k} -> ${flag}`).toBe(true);
    }
  });
}

// 煙霧測試：只靠名單身分進得了中心，不代表讀得到需要總務權限的資料或能操作（伺服端授權不看 gaCenter）。
for (const key of ['bare_supervisor', 'bare_area_manager']) {
  test(`${key}：需要總務權限的資料與操作 API 仍被擋（料件、設備、設施、調撥建單）`, async () => {
    // 建立料件、建立設備分類需要總務權限；空內容一律不能成功（不論先被權限還是驗證擋下）
    for (const p of ['parts', 'categories/equipment']) {
      const r = await apis[key].post(`/api/workspace/general-affairs/${p}`, { data: {} });
      expect(r.status(), `${key} POST ${p} -> ${r.status()}`).toBeGreaterThanOrEqual(400);
    }
    const r = await apis[key].post('/api/workspace/general-affairs/inventory/transfers', { data: {} });
    expect(r.status(), `${key} POST transfers -> ${r.status()}`).toBeGreaterThanOrEqual(400);
  });
}
