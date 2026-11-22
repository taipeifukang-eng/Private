import { describe, expect, it } from 'vitest';
import { gaFlags } from '@/lib/workspace/general-affairs/access';
import { GA_PAGE_BY_HREF, gaNavigation } from '@/lib/workspace/general-affairs/nav';
import { WORKSPACE_TAB_KINDS } from '@/lib/workspace/page-kinds';
import { resolveAccess } from '@/lib/workspace/permission-semantics';
import { WORKSPACE_PAGE_META } from '../../../vue-workspace/src/workspace-page-meta';

// G12：入口旗標（餘額／流水查看或交易管理，或門市名單任何身分）、側欄兩個入口（庫存總覽、庫存流水）以完整 href 對應同一頁的不同 payload、頁面註冊。
const access = (codes: string[], opts: { roleCode?: string } = {}) =>
  resolveAccess([{ is_active: true, role: { code: opts.roleCode || 'x', role_permissions: codes.map((c) => ({ is_allowed: true, permission: { code: c, is_active: true } })) } }]);
const items = (a: ReturnType<typeof access>, o: { storeMember?: boolean; rosterMember?: boolean } = {}) =>
  gaNavigation({ has: a.has, permissions: a.permissions as any, roleCodes: a.roleCodes, isAdmin: a.isAdmin, storeMember: !!o.storeMember, rosterMember: !!o.rosterMember })
    .flatMap((g) => g.items.flatMap((i: any) => [i, ...(i.children || [])])) as any[];

describe('gaInventory 旗標', () => {
  it('餘額查看、流水查看、交易管理：有；位置、調撥、料件權限不算', () => {
    for (const c of ['general_affairs.inventory_balance.view', 'general_affairs.inventory_transaction.view', 'general_affairs.inventory_transaction.manage']) {
      expect(gaFlags(access([c]).has, false).gaInventory, c).toBe(true);
    }
    for (const c of ['general_affairs.inventory_location.manage', 'general_affairs.inventory_transfer.manage', 'general_affairs.part.view', 'general_affairs.service_center.access']) {
      expect(gaFlags(access([c]).has, false).gaInventory, c).toBe(false);
    }
  });
  it('門市名單任何身分：有；只有店長角色代碼但不在名單：沒有', () => {
    expect(gaFlags(access([]).has, false, false, true).gaInventory).toBe(true);
    expect(gaFlags(access([]).has, true, true, false).gaInventory).toBe(false);
    expect(gaFlags(access([]).has, false).gaInventory).toBe(false);
  });
});

describe('側欄：庫存總覽與庫存流水', () => {
  const full = access(['general_affairs.service_center.access', 'general_affairs.inventory_balance.view', 'general_affairs.inventory_transaction.view']);
  it('完整 href 對應：/inventory 與 /inventory?view=transactions 是同一個頁面 kind、不同 payload.view', () => {
    expect(GA_PAGE_BY_HREF['/general-affairs/inventory']).toEqual({ kind: 'ga-inventory', flag: 'gaInventory', payload: { view: 'balances' } });
    expect(GA_PAGE_BY_HREF['/general-affairs/inventory?view=transactions']).toEqual({ kind: 'ga-inventory', flag: 'gaInventory', payload: { view: 'transactions' } });
  });
  it('有餘額與流水權限：兩個入口都在，payload 各自帶 view', () => {
    const list = items(full).filter((i) => i.kind === 'ga-inventory');
    expect(list.map((i) => i.payload?.view).sort()).toEqual(['balances', 'transactions']);
  });
  it('只有流水查看（沒有餘額權限）：舊側欄規則兩個入口都列（庫存總覽入口進去後頁面自動落在「流水」分頁）；只有位置權限沒有入口', () => {
    const list = items(access(['general_affairs.service_center.access', 'general_affairs.inventory_transaction.view'])).filter((i) => i.kind === 'ga-inventory');
    expect(list.map((i) => i.payload?.view).sort()).toEqual(['balances', 'transactions']);
    expect(items(access(['general_affairs.service_center.access', 'general_affairs.inventory_location.view'])).filter((i) => i.kind === 'ga-inventory')).toHaveLength(0);
  });
  it('門市名單身分：有店長角色時舊側欄本來就列兩個入口；只在名單（沒有店長角色）時補一個「庫存總覽」（唯讀）；無權限沒有', () => {
    const sm = items(access([], { roleCode: 'store_manager' }), { rosterMember: true }).filter((i) => i.kind === 'ga-inventory');
    expect(sm.map((i) => i.payload?.view).sort()).toEqual(['balances', 'transactions']);
    const r = items(access([]), { rosterMember: true }).filter((i) => i.kind === 'ga-inventory');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ label: '庫存總覽', payload: { view: 'balances' } });
    expect(items(access([])).filter((i) => i.kind === 'ga-inventory')).toHaveLength(0);
  });
  it('頁面 kind 已註冊並綁旗標', () => {
    expect(WORKSPACE_TAB_KINDS).toContain('ga-inventory');
    expect(WORKSPACE_PAGE_META['ga-inventory'].permission).toEqual(['gaInventory']);
  });
});
