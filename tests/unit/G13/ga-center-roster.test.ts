import { describe, expect, it } from 'vitest';
import { gaFlags } from '@/lib/workspace/general-affairs/access';
import { gaNavigation } from '@/lib/workspace/general-affairs/nav';
import { workspaceNavigation } from '@/lib/workspace/navigation';
import { transferAbilities } from '@/lib/workspace/general-affairs/inventory-transfer-rules';
import { resolveAccess } from '@/lib/workspace/permission-semantics';

// 2026-11-11 第 3 批驗收決定 A：門市名單身分（督導、區經理，沒有任何總務權限也沒有店長角色）也有「總務服務中心」入口，
// 進去只看得到唯讀的庫存總覽、調撥與自己門市的清冊，沒有任何要總務權限的操作入口。
const bare = () => resolveAccess([]);
const nav = (o: { storeMember?: boolean; rosterMember?: boolean }) => {
  const a = bare();
  return gaNavigation({ has: a.has, permissions: a.permissions as any, roleCodes: a.roleCodes, isAdmin: a.isAdmin, storeMember: !!o.storeMember, rosterMember: !!o.rosterMember });
};
const flat = (o: Parameters<typeof nav>[0]) => nav(o).flatMap((g) => g.items.flatMap((i: any) => [i, ...(i.children || [])]));

describe('A：gaCenter 旗標', () => {
  it('門市名單身分（沒有角色、沒有權限）有 gaCenter；不在名單、沒權限、沒店長角色沒有', () => {
    expect(gaFlags(bare().has, false, true, true).gaCenter).toBe(true);
    expect(gaFlags(bare().has, false, false, false).gaCenter).toBe(false);
    expect(gaFlags(bare().has, false).gaCenter).toBe(false);
  });
  it('名單身分只多出唯讀入口：沒有任何需要總務權限的操作旗標', () => {
    const f = gaFlags(bare().has, false, true, true);
    for (const k of ['gaEquipmentCategories', 'gaFacilityCategories', 'gaPartCategories', 'gaParts', 'gaPartCreate', 'gaPartCompat', 'gaEquipmentTemplates', 'gaFacilityTemplates',
      'gaEquipmentCreate', 'gaFacilityCreate', 'gaEquipmentWarranties', 'gaFacilityWarranties', 'gaEquipmentLabels', 'gaFacilityLabels', 'gaOnboardingReview', 'gaAssetImport'] as const) {
      expect(f[k], k).toBe(false);
    }
    expect(f).toMatchObject({ gaInventory: true, gaInventoryTransfers: true, gaInventoryLocations: true });
  });
});

describe('A：中心側欄', () => {
  it('名單身分看得到庫存總覽、調撥與收貨、庫存位置；看不到需要權限的項目', () => {
    const items = flat({ storeMember: true, rosterMember: true });
    const kinds = items.map((i: any) => i.kind);
    expect(kinds).toEqual(expect.arrayContaining(['ga-inventory', 'ga-inventory-transfers', 'ga-inventory-locations']));
    for (const k of ['ga-equipment-create', 'ga-facility-create', 'ga-asset-import', 'ga-onboarding-review', 'ga-parts', 'ga-part-create', 'ga-equipment-categories', 'ga-facility-categories', 'ga-part-categories',
      'ga-equipment-templates', 'ga-facility-templates', 'ga-equipment-labels', 'ga-facility-labels', 'ga-equipment-warranties', 'ga-facility-warranties', 'ga-part-compat']) {
      expect(kinds, k).not.toContain(k);
    }
    // 沒有可點但實際不能用的「壞入口」：每個項目不是有新版頁面 kind，就是有舊版網址／停用說明／子項目
    for (const i of items as any[]) expect(!!(i.kind || i.href || i.disabled || i.children?.length), i.id).toBe(true);
  });
  it('只憑名單身分時，不留舊版外連與停用項目（總務需求工作台、料件處理中心、盤點、工單、廠商、費用等壞入口）', () => {
    const items = flat({ storeMember: true, rosterMember: true }) as any[];
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) {
      if (!i.children?.length) expect(i.kind, i.id).toBeTruthy();
      expect(i.disabled, i.id).toBeUndefined();
    }
    const hrefs = items.map((i) => i.href);
    for (const h of ['/general-affairs/requests', '/general-affairs/part-fulfillments', '/general-affairs/work-orders', '/general-affairs/vendors', '/general-affairs/utility-bills', '/general-affairs/reports/new']) expect(hrefs).not.toContain(h);
  });
  it('有總務權限的人側欄不受影響（仍保留舊版項目）', () => {
    const a = resolveAccess([{ is_active: true, role: { code: 'x', role_permissions: ['general_affairs.service_center.access', 'general_affairs.request.view_all'].map((c) => ({ is_allowed: true, permission: { code: c, is_active: true } })) } }]);
    const g = gaNavigation({ has: a.has, permissions: a.permissions as any, roleCodes: a.roleCodes, isAdmin: a.isAdmin, storeMember: true, rosterMember: true });
    expect(g.flatMap((x) => x.items).map((i: any) => i.href)).toContain('/general-affairs/requests');
  });
});

describe('A：左側選單的「服務中心首頁」', () => {
  const ctx = { isAdmin: false, roleCodes: new Set<string>(), has: () => false } as any;
  const entry = (rosterMember?: boolean) => workspaceNavigation(ctx, { gaRosterMember: rosterMember }).flatMap((g: any) => g.items).find((i: any) => i.href === '/general-affairs');
  it('名單身分有入口且開工作台內的總務中心；沒有名單身分沒有', () => {
    expect(entry(true)).toMatchObject({ label: '服務中心首頁', kind: 'ga-center' });
    expect(entry(false)).toBeUndefined();
    expect(entry(undefined)).toBeUndefined();
  });
  it('不會連帶多出舊版庫存管理入口（舊頁面本身不放行督導、區經理）', () => {
    const all = workspaceNavigation(ctx, { gaRosterMember: true }).flatMap((g: any) => g.items);
    expect(all.find((i: any) => i.href === '/general-affairs/inventory')).toBeUndefined();
  });
});

describe('B：C10 回報者包含督導、區經理（abilities 以目的門市名單身分判斷，與角色無關）', () => {
  const roster = { transferManage: false, transactionManage: false, partView: false, destinationStoreManager: true };
  it('名單身分在已交出、運送中、已收貨可回報；沒有庫存操作能力', () => {
    for (const status of ['SOURCE_CONFIRMED', 'IN_TRANSIT', 'RECEIVED']) expect(transferAbilities(roster, { status }).store_report, status).toBe(true);
    expect(transferAbilities(roster, { status: 'IN_TRANSIT' })).toMatchObject({ receive: false, cancel: false, confirm_source: false, ship: false, mark_unreceived: false });
  });
});
