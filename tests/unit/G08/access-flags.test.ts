import { describe, expect, it } from 'vitest';
import { gaFlags } from '@/lib/workspace/general-affairs/access';
import { GA_PAGE_BY_HREF, gaNavigation } from '@/lib/workspace/general-affairs/nav';
import { resolveAccess } from '@/lib/workspace/permission-semantics';

const access = (codes: string[], opts: { profileRole?: string; roleCode?: string } = {}) =>
  resolveAccess([{ is_active: true, role: { code: opts.roleCode || 'x', role_permissions: codes.map((c) => ({ is_allowed: true, permission: { code: c, is_active: true } })) } }], opts.profileRole);
const flatten = (groups: any[]): any[] => groups.flatMap((g) => g.items.flatMap((i: any) => [i, ...(i.children || [])]));
const nav = (a: ReturnType<typeof access>, storeMember = false) => gaNavigation({ has: a.has, permissions: a.permissions as any, roleCodes: a.roleCodes, isAdmin: a.isAdmin, storeMember });
const KEYS = ['gaFacilities', 'gaFacilityCreate', 'gaEquipmentWarranties', 'gaFacilityWarranties', 'gaEquipmentHistory', 'gaFacilityHistory'] as const;
const pick = (f: Record<string, boolean>) => KEYS.map((k) => f[k]);

describe('第 2 批 G08／G09 旗標：設施清冊、新增設施、保固頁、維修紀錄', () => {
  it('完全沒權限全部 false', () => {
    expect(pick(gaFlags(access([]).has, false) as any)).toEqual([false, false, false, false, false, false]);
  });
  it('設施查看：清冊、設施保固、設施維修紀錄；不能新增設施；設備相關都不行', () => {
    const f = gaFlags(access(['general_affairs.facility.view']).has, false) as any;
    expect(pick(f)).toEqual([true, false, false, true, false, true]);
  });
  it('設施管理：可新增設施', () => {
    expect(gaFlags(access(['general_affairs.facility.manage']).has, false)).toMatchObject({ gaFacilities: true, gaFacilityCreate: true, gaFacilityWarranties: true });
  });
  it('設備查看：設備保固與設備維修紀錄，沒有設施頁', () => {
    expect(pick(gaFlags(access(['general_affairs.equipment.view']).has, false) as any)).toEqual([false, false, true, false, true, false]);
  });
  it('店長身分：設施清冊與兩種維修紀錄（只看自己門市），沒有保固頁與新增', () => {
    expect(pick(gaFlags(access([]).has, true) as any)).toEqual([true, false, false, false, true, true]);
  });
  it('名單內任何身分（督導、區經理）也進得了設施清冊與維修紀錄', () => {
    expect(pick(gaFlags(access([]).has, false, true) as any)).toEqual([true, false, false, false, true, true]);
  });
});

describe('側欄接線（舊網址對應新版頁面）', () => {
  it('六個舊網址都有對應', () => {
    expect(GA_PAGE_BY_HREF['/general-affairs/facilities']).toEqual({ kind: 'ga-facilities', flag: 'gaFacilities' });
    expect(GA_PAGE_BY_HREF['/general-affairs/facilities/new']).toEqual({ kind: 'ga-facility-create', flag: 'gaFacilityCreate' });
    expect(GA_PAGE_BY_HREF['/general-affairs/facilities/warranties'].kind).toBe('ga-facility-warranties');
    expect(GA_PAGE_BY_HREF['/general-affairs/facilities/maintenance-history'].kind).toBe('ga-facility-history');
    expect(GA_PAGE_BY_HREF['/general-affairs/equipment/warranties'].kind).toBe('ga-equipment-warranties');
    expect(GA_PAGE_BY_HREF['/general-affairs/equipment/maintenance-history'].kind).toBe('ga-equipment-history');
  });
  it('設施管理者側欄的設施清冊、新增設施、維修紀錄都開新版頁籤', () => {
    const items = flatten(nav(access(['general_affairs.service_center.access', 'general_affairs.facility.manage'])));
    expect(items.find((i) => i.id === 'facility-list')).toMatchObject({ kind: 'ga-facilities' });
    expect(items.find((i) => i.id === 'facility-new')).toMatchObject({ kind: 'ga-facility-create' });
    expect(items.find((i) => i.id === 'facility-maintenance-history')).toMatchObject({ kind: 'ga-facility-history' });
  });
  it('設施查看者側欄沒有「新增設施」', () => {
    const items = flatten(nav(access(['general_affairs.service_center.access', 'general_affairs.facility.view'])));
    expect(items.find((i) => i.id === 'facility-new')).toBeUndefined();
    expect(items.find((i) => i.id === 'facility-list')).toMatchObject({ kind: 'ga-facilities' });
  });
  it('名單內身分（沒有 store_manager 角色代碼）沒有舊版的「設施管理」群組：新版把設施清冊與設施維修紀錄補在「資產與庫存」，沒有新增設施與保固管理', () => {
    const groups = nav(access([]), true);
    const items = flatten(groups);
    expect(items.find((i) => i.id === 'facility-list-new')).toMatchObject({ kind: 'ga-facilities' });
    expect(items.find((i) => i.id === 'facility-history-new')).toMatchObject({ kind: 'ga-facility-history' });
    expect(items.find((i) => i.kind === 'ga-facility-create')).toBeUndefined();
    expect(items.find((i) => i.kind === 'ga-facility-warranties')).toBeUndefined();
    expect(groups.find((g) => g.id === 'assets-inventory')!.items.some((i) => i.id === 'facility-list-new')).toBe(true);
  });
  it('店長角色代碼：舊版側欄本來就有「設施管理」群組，不重複補', () => {
    const items = flatten(nav(access([], { roleCode: 'store_manager' })));
    expect(items.find((i) => i.id === 'facility-list')).toMatchObject({ kind: 'ga-facilities' });
    expect(items.find((i) => i.id === 'facility-list-new')).toBeUndefined();
  });
  it('有設施權限時走舊版「設施管理」群組，不重複補；設施保固管理補在該群組最後', () => {
    const items = flatten(nav(access(['general_affairs.service_center.access', 'general_affairs.facility.view'])));
    expect(items.find((i) => i.id === 'facility-list-new')).toBeUndefined();
    const fac = items.find((i) => i.id === 'facilities');
    expect(fac.children.at(-1)).toMatchObject({ id: 'facility-warranties', kind: 'ga-facility-warranties' });
  });
  it('設備查看者：保固管理與維修紀錄開新版頁籤', () => {
    const items = flatten(nav(access(['general_affairs.service_center.access', 'general_affairs.equipment.view'])));
    expect(items.find((i) => i.id === 'equipment-warranties')).toMatchObject({ kind: 'ga-equipment-warranties' });
    expect(items.find((i) => i.id === 'equipment-maintenance-history')).toMatchObject({ kind: 'ga-equipment-history' });
  });
});
