import { describe, expect, it } from 'vitest';
import { gaFlags } from '@/lib/workspace/general-affairs/access';
import { GA_PAGE_BY_HREF, gaNavigation } from '@/lib/workspace/general-affairs/nav';
import { WORKSPACE_TAB_KINDS } from '@/lib/workspace/page-kinds';
import { resolveAccess } from '@/lib/workspace/permission-semantics';
import { WORKSPACE_PAGE_META } from '../../../vue-workspace/src/workspace-page-meta';

// G11：入口旗標（位置查看／管理，或門市名單任何身分）、側欄、頁面註冊。
const access = (codes: string[], opts: { roleCode?: string } = {}) =>
  resolveAccess([{ is_active: true, role: { code: opts.roleCode || 'x', role_permissions: codes.map((c) => ({ is_allowed: true, permission: { code: c, is_active: true } })) } }]);
const kinds = (a: ReturnType<typeof access>, o: { storeMember?: boolean; rosterMember?: boolean } = {}) =>
  gaNavigation({ has: a.has, permissions: a.permissions as any, roleCodes: a.roleCodes, isAdmin: a.isAdmin, storeMember: !!o.storeMember, rosterMember: !!o.rosterMember })
    .flatMap((g) => g.items.flatMap((i: any) => [i, ...(i.children || [])])).map((i: any) => i.kind);

describe('gaInventoryLocations 旗標', () => {
  it('位置查看或管理：有；其他庫存權限不算', () => {
    expect(gaFlags(access(['general_affairs.inventory_location.view']).has, false).gaInventoryLocations).toBe(true);
    expect(gaFlags(access(['general_affairs.inventory_location.manage']).has, false).gaInventoryLocations).toBe(true);
    for (const c of ['general_affairs.inventory_balance.view', 'general_affairs.inventory_transaction.manage', 'general_affairs.inventory_transfer.manage', 'general_affairs.part.view', 'general_affairs.service_center.access']) {
      expect(gaFlags(access([c]).has, false).gaInventoryLocations, c).toBe(false);
    }
  });
  it('門市名單任何身分（店長、督導、區經理）：有；只有店長角色代碼但不在名單：沒有（資料庫也看不到）', () => {
    expect(gaFlags(access([]).has, false, false, true).gaInventoryLocations).toBe(true);
    expect(gaFlags(access([]).has, true, true, false).gaInventoryLocations).toBe(false);
    expect(gaFlags(access([]).has, false).gaInventoryLocations).toBe(false);
  });
});

describe('側欄與頁面註冊', () => {
  it('總務（位置管理）：側欄有庫存位置；門市名單身分即使沒權限碼也有；無權限沒有', () => {
    expect(kinds(access(['general_affairs.service_center.access', 'general_affairs.inventory_location.manage']))).toContain('ga-inventory-locations');
    expect(kinds(access([], { roleCode: 'store_manager' }), { rosterMember: true })).toContain('ga-inventory-locations');
    expect(kinds(access([]))).not.toContain('ga-inventory-locations');
    expect(kinds(access([], { roleCode: 'store_manager' }))).not.toContain('ga-inventory-locations');
  });
  it('只出現一次（舊側欄已有時不重複補）', () => {
    const k = kinds(access(['general_affairs.inventory_location.manage', 'general_affairs.inventory_balance.view']), { rosterMember: true });
    expect(k.filter((x) => x === 'ga-inventory-locations')).toHaveLength(1);
  });
  it('舊網址對照與頁面 kind 已註冊並綁旗標', () => {
    expect(GA_PAGE_BY_HREF['/general-affairs/inventory/locations']).toEqual({ kind: 'ga-inventory-locations', flag: 'gaInventoryLocations' });
    expect(WORKSPACE_TAB_KINDS).toContain('ga-inventory-locations');
    expect(WORKSPACE_PAGE_META['ga-inventory-locations'].permission).toEqual(['gaInventoryLocations']);
  });
});
