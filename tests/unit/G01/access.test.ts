import { describe, expect, it } from 'vitest';
import { categoryPermissions, dbCan, gaFlags, GA_CENTER_CODES, isCategoryType } from '@/lib/workspace/general-affairs/access';
import { resolveAccess } from '@/lib/workspace/permission-semantics';
import { gaNavigation, GA_PAGE_BY_HREF } from '@/lib/workspace/general-affairs/nav';

const access = (codes: string[], opts: { profileRole?: string; roleCode?: string } = {}) =>
  resolveAccess(
    [{ is_active: true, role: { code: opts.roleCode || 'x', role_permissions: codes.map((c) => ({ is_allowed: true, permission: { code: c, is_active: true } })) } }],
    opts.profileRole,
  );
const flatten = (groups: any[]): any[] => groups.flatMap((g) => g.items.flatMap((i: any) => [i, ...(i.children || [])]));
const nav = (a: ReturnType<typeof access>) => gaNavigation({ has: a.has, permissions: a.permissions as any, roleCodes: a.roleCodes, isAdmin: a.isAdmin });
const kinds = (a: ReturnType<typeof access>) => flatten(nav(a)).map((i) => i.kind).filter(Boolean).sort();

describe('G01 入口旗標', () => {
  it('完全沒權限：全部 false', () => {
    const a = access([]);
    expect(Object.values(gaFlags(a.has, false)).every((v) => v === false)).toBe(true);
    expect(kinds(a)).toEqual([]); // 已移植的頁面一個都不列（舊版只寫權限碼的項目會對所有人顯示，那是舊版行為，不在此保證）
  });
  it('料件查看：只有料件列表；新增與適用料件設定需要管理權限', () => {
    const f = gaFlags(access(['general_affairs.part.view']).has, false);
    expect(f).toMatchObject({ gaCenter: true, gaParts: true, gaPartCreate: false, gaPartCompat: false, gaPartCategories: false });
    const m = gaFlags(access(['general_affairs.part.manage']).has, false);
    expect(m).toMatchObject({ gaParts: true, gaPartCreate: true, gaPartCompat: true });
  });
  it('三種分類各自獨立；型號與架型各自的權限', () => {
    expect(gaFlags(access(['general_affairs.equipment_category.view']).has, false)).toMatchObject({ gaEquipmentCategories: true, gaFacilityCategories: false, gaPartCategories: false });
    expect(gaFlags(access(['general_affairs.facility_category.manage']).has, false)).toMatchObject({ gaFacilityCategories: true });
    expect(gaFlags(access(['general_affairs.equipment_template.view']).has, false)).toMatchObject({ gaEquipmentTemplates: true, gaFacilityTemplates: false });
    expect(gaFlags(access(['general_affairs.facility.view']).has, false)).toMatchObject({ gaFacilityTemplates: true, gaEquipmentTemplates: false });
  });
  it('店長身分：看得到服務中心與料件列表，但沒有分類、新增、型號', () => {
    const f = gaFlags(access([]).has, true);
    expect(f).toMatchObject({ gaCenter: true, gaParts: true, gaPartCreate: false, gaEquipmentTemplates: false, gaFacilityTemplates: false, gaPartCategories: false });
  });
  it('服務中心入口碼清單包含維修、工單與廠商類權限', () => {
    for (const c of ['general_affairs.maintenance_request.create', 'general_affairs.work_order.view_all', 'general_affairs.service_category.view', 'general_affairs.cooperation_record.view']) expect(GA_CENTER_CODES).toContain(c);
  });
});

describe('權限語意：導覽用應用層後備，API 用資料庫語意', () => {
  it('舊式管理員（profiles.role=admin 沒掛角色）：導覽與旗標全開，但資料庫語意沒有任何權限', () => {
    const a = access([], { profileRole: 'admin' });
    expect(Object.values(gaFlags(a.has, false)).every(Boolean)).toBe(true);
    expect(dbCan(a.permissions, 'general_affairs.part.manage')).toBe(false);
    expect(categoryPermissions('part', a.permissions)).toEqual({ read: false, manage: false });
  });
  it('分類讀取：服務中心入口、查看或管理任一個都可讀（選擇器需要）；寫入只有管理', () => {
    expect(categoryPermissions('part', access(['general_affairs.service_center.access']).permissions)).toEqual({ read: true, manage: false });
    expect(categoryPermissions('part', access(['general_affairs.part_category.view']).permissions)).toEqual({ read: true, manage: false });
    expect(categoryPermissions('part', access(['general_affairs.part_category.manage']).permissions)).toEqual({ read: true, manage: true });
    expect(categoryPermissions('equipment', access(['general_affairs.part_category.manage']).permissions)).toEqual({ read: false, manage: false });
  });
  it('分類類型只收三種', () => {
    expect(isCategoryType('part') && isCategoryType('equipment') && isCategoryType('facility')).toBe(true);
    expect(isCategoryType('vendor')).toBe(false);
  });
});

describe('G01 側欄：沿用舊版分組與權限顯示', () => {
  it('總務角色：舊版全部項目都在，已移植的頁面標上 kind', () => {
    const a = access([
      'general_affairs.service_center.access', 'general_affairs.equipment.view', 'general_affairs.equipment_category.view', 'general_affairs.equipment_template.manage',
      'general_affairs.facility.view', 'general_affairs.facility_category.manage', 'general_affairs.part.manage', 'general_affairs.part_category.view',
    ]);
    const groups = nav(a);
    expect(groups.map((g) => g.id)).toEqual(expect.arrayContaining(['workspace', 'assets-inventory']));
    expect(kinds(a)).toEqual([
      'ga-center', 'ga-equipment', 'ga-equipment-categories', 'ga-equipment-history', 'ga-equipment-labels', 'ga-equipment-templates', 'ga-equipment-warranties', 'ga-facilities', 'ga-facility-categories', 'ga-facility-history', 'ga-facility-labels', 'ga-facility-templates', 'ga-facility-warranties', 'ga-onboarding-tasks', 'ga-part-categories', 'ga-part-compat', 'ga-part-create', 'ga-parts',
    ]);
    // 第 2 批：設備清冊已移植；尚未移植的項目仍在（用舊頁網址另開），例如保固管理
    expect(flatten(groups).find((i) => i.id === 'equipment-list')).toMatchObject({ href: '/general-affairs/equipment', kind: 'ga-equipment' });
    expect(flatten(groups).find((i) => i.id === 'equipment-warranties')?.kind).toBe('ga-equipment-warranties'); // G09 已移植
  });
  it('只有料件查看：已移植的頁面只列料件列表（新增、分類、適用料件設定都不列；服務首頁在舊版側欄需要服務中心入口權限）', () => {
    const a = access(['general_affairs.part.view']);
    expect(kinds(a)).toEqual(['ga-parts']);
  });
  it('店長身分：不列設施架型（API 會擋），仍可看料件列表', () => {
    const a = access([], { roleCode: 'store_manager' });
    expect(kinds(a)).toEqual(['ga-equipment', 'ga-equipment-history', 'ga-facilities', 'ga-facility-history', 'ga-onboarding-tasks', 'ga-parts']); // G08／G09：店長有設施清冊與兩種維修紀錄
    expect(flatten(nav(a)).find((i) => i.id === 'facility-templates')).toBeUndefined();
  });
  it('「規劃中」的項目照舊顯示成不可點', () => {
    const a = access(['general_affairs.inventory_balance.view']);
    const item = flatten(nav(a)).find((i) => i.id === 'inventory-count');
    expect(item?.disabled).toBeTruthy();
  });
  it('頁面對照表涵蓋第 1 批九個頁面與第 2 批設備清冊、新增設備', () => {
    expect(Object.keys(GA_PAGE_BY_HREF)).toHaveLength(18); // 第 2 批 G08／G09 再加 6 個（設施清冊、新增設施、設備與設施保固頁、維修紀錄），G10 再加設備 QR 標籤列印
  });
});
