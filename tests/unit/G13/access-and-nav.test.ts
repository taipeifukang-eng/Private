import { describe, expect, it } from 'vitest';
import { gaFlags } from '@/lib/workspace/general-affairs/access';
import { GA_PAGE_BY_HREF, gaNavigation } from '@/lib/workspace/general-affairs/nav';
import { WORKSPACE_TAB_KINDS } from '@/lib/workspace/page-kinds';
import { resolveAccess } from '@/lib/workspace/permission-semantics';
import { WORKSPACE_PAGE_META } from '../../../vue-workspace/src/workspace-page-meta';

// G13：入口旗標（調撥／流水查看或管理、餘額查看，或門市名單任何身分）、側欄「調撥與收貨」入口、頁面註冊。
const access = (codes: string[], opts: { roleCode?: string } = {}) =>
  resolveAccess([{ is_active: true, role: { code: opts.roleCode || 'x', role_permissions: codes.map((c) => ({ is_allowed: true, permission: { code: c, is_active: true } })) } }]);
const items = (a: ReturnType<typeof access>, o: { storeMember?: boolean; rosterMember?: boolean } = {}) =>
  gaNavigation({ has: a.has, permissions: a.permissions as any, roleCodes: a.roleCodes, isAdmin: a.isAdmin, storeMember: !!o.storeMember, rosterMember: !!o.rosterMember })
    .flatMap((g) => g.items.flatMap((i: any) => [i, ...(i.children || [])])) as any[];

describe('gaInventoryTransfers 旗標', () => {
  it('調撥查看／管理、流水查看／交易管理、餘額查看：有；位置與料件權限不算', () => {
    for (const c of ['general_affairs.inventory_transfer.view', 'general_affairs.inventory_transfer.manage', 'general_affairs.inventory_transaction.view', 'general_affairs.inventory_transaction.manage', 'general_affairs.inventory_balance.view']) {
      expect(gaFlags(access([c]).has, false).gaInventoryTransfers, c).toBe(true);
    }
    for (const c of ['general_affairs.inventory_location.manage', 'general_affairs.part.view', 'general_affairs.service_center.access']) {
      expect(gaFlags(access([c]).has, false).gaInventoryTransfers, c).toBe(false);
    }
  });
  it('門市名單任何身分：有；只有店長角色代碼但不在名單：沒有', () => {
    expect(gaFlags(access([]).has, false, false, true).gaInventoryTransfers).toBe(true);
    expect(gaFlags(access([]).has, true, true, false).gaInventoryTransfers).toBe(false);
    expect(gaFlags(access([]).has, false).gaInventoryTransfers).toBe(false);
  });
});

describe('側欄：調撥與收貨', () => {
  it('舊網址 /general-affairs/inventory/transfers 對應到新頁面 kind 與旗標（不轉址，舊路徑先保留）', () => {
    expect(GA_PAGE_BY_HREF['/general-affairs/inventory/transfers']).toEqual({ kind: 'ga-inventory-transfers', flag: 'gaInventoryTransfers' });
  });
  it('導覽共四個庫存 href：總覽、流水（完整 href 對應）、位置、調撥', () => {
    const hrefs = Object.keys(GA_PAGE_BY_HREF).filter((h) => h.startsWith('/general-affairs/inventory'));
    expect(hrefs.sort()).toEqual(['/general-affairs/inventory', '/general-affairs/inventory/locations', '/general-affairs/inventory/transfers', '/general-affairs/inventory?view=transactions'].sort());
  });
  it('有調撥權限：舊側欄在「作業管理」與「庫存管理」各有一個調撥與收貨入口，都指向同一頁；沒有任何相關權限：沒有', () => {
    const list = items(access(['general_affairs.service_center.access', 'general_affairs.inventory_transfer.manage'])).filter((i) => i.kind === 'ga-inventory-transfers');
    expect(list).toHaveLength(2);
    expect(list.every((i) => i.href === '/general-affairs/inventory/transfers')).toBe(true);
    expect(items(access(['general_affairs.service_center.access'])).filter((i) => i.kind === 'ga-inventory-transfers')).toHaveLength(0);
  });
  it('只憑門市名單身分（舊側欄不列）：補一個「調撥與收貨」入口（唯讀）；有店長角色時舊側欄已列，不再補', () => {
    const r = items(access([]), { rosterMember: true }).filter((i) => i.kind === 'ga-inventory-transfers');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ label: '調撥與收貨' });
    const sm = items(access([], { roleCode: 'store_manager' }), { rosterMember: true }).filter((i) => i.kind === 'ga-inventory-transfers');
    expect(sm.every((i) => i.href === '/general-affairs/inventory/transfers')).toBe(true);
    expect(items(access([])).filter((i) => i.kind === 'ga-inventory-transfers')).toHaveLength(0);
  });
  it('頁面 kind 已註冊並綁旗標', () => {
    expect(WORKSPACE_TAB_KINDS).toContain('ga-inventory-transfers');
    expect(WORKSPACE_PAGE_META['ga-inventory-transfers'].permission).toEqual(['gaInventoryTransfers']);
  });
});
