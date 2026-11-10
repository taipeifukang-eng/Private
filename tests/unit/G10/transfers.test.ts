import { describe, expect, it } from 'vitest';
import { gaFlags } from '@/lib/workspace/general-affairs/access';
import { gaNavigation } from '@/lib/workspace/general-affairs/nav';
import { WORKSPACE_TAB_KINDS } from '@/lib/workspace/page-kinds';
import { resolveAccess } from '@/lib/workspace/permission-semantics';
import { WORKSPACE_PAGE_META } from '../../../vue-workspace/src/workspace-page-meta';
import { assetNoun, formatDateTime, TRANSFER_EVENT_LABEL, TRANSFER_STATUS_LABEL, TRANSFER_STATUS_SHORT } from '../../../vue-workspace/src/lib/ga-transfers';

// Q28 轉移單：導覽旗標（總務管理或店長身分才有入口，純查看者沒有）、頁面註冊、文字對照。
const access = (codes: string[], opts: { roleCode?: string } = {}) =>
  resolveAccess([{ is_active: true, role: { code: opts.roleCode || 'x', role_permissions: codes.map((c) => ({ is_allowed: true, permission: { code: c, is_active: true } })) } }]);
const flatten = (groups: any[]): any[] => groups.flatMap((g) => g.items.flatMap((i: any) => [i, ...(i.children || [])]));
const nav = (a: ReturnType<typeof access>, storeMember = false) => gaNavigation({ has: a.has, permissions: a.permissions as any, roleCodes: a.roleCodes, isAdmin: a.isAdmin, storeMember });

describe('gaTransfers 旗標', () => {
  it('完全沒權限：沒有', () => expect(gaFlags(access([]).has, false).gaTransfers).toBe(false));
  it('設備或設施管理：有（可發起與取消）', () => {
    expect(gaFlags(access(['general_affairs.equipment.manage']).has, false).gaTransfers).toBe(true);
    expect(gaFlags(access(['general_affairs.facility.manage']).has, false).gaTransfers).toBe(true);
  });
  it('只有查看權限：沒有入口（只能由資料庫列級權限讀取）', () => {
    expect(gaFlags(access(['general_affairs.equipment.view']).has, false).gaTransfers).toBe(false);
    expect(gaFlags(access(['general_affairs.facility.view']).has, false).gaTransfers).toBe(false);
  });
  it('店長身分或名單內人員：有', () => {
    expect(gaFlags(access([]).has, true).gaTransfers).toBe(true);
    expect(gaFlags(access([]).has, false, true).gaTransfers).toBe(true);
  });
});

describe('導覽與頁面註冊', () => {
  it('側欄「轉移單」放在資產與庫存群組，先於貼標待辦', () => {
    const groups = nav(access(['general_affairs.service_center.access', 'general_affairs.equipment.manage']));
    const kinds = groups.find((g) => g.id === 'assets-inventory')!.items.map((i: any) => i.kind);
    expect(kinds.slice(-3)).toEqual(['ga-transfers', 'ga-onboarding-tasks', 'ga-onboarding-review']);
  });
  it('店長側欄有轉移單', () => {
    expect(flatten(nav(access([], { roleCode: 'store_manager' }), true)).some((i) => i.kind === 'ga-transfers')).toBe(true);
  });
  it('設備查看者沒有轉移單入口', () => {
    expect(flatten(nav(access(['general_affairs.service_center.access', 'general_affairs.equipment.view']))).some((i) => i.kind === 'ga-transfers')).toBe(false);
  });
  it('ga-transfers 是已註冊頁面，進頁需要 gaTransfers', () => {
    expect(WORKSPACE_TAB_KINDS).toContain('ga-transfers');
    expect(WORKSPACE_PAGE_META['ga-transfers'].permission).toEqual(['gaTransfers']);
  });
});

describe('文字對照', () => {
  it('四個狀態都有說明與簡稱', () => {
    for (const s of ['PENDING_HANDOVER', 'PENDING_RECEIVE', 'COMPLETED', 'CANCELLED']) {
      expect(TRANSFER_STATUS_LABEL[s]).toBeTruthy();
      expect(TRANSFER_STATUS_SHORT[s]).toBeTruthy();
    }
  });
  it('四種異動事件都有中文', () => {
    for (const e of ['TRANSFER_REQUESTED', 'TRANSFER_HANDED_OVER', 'STORE_TRANSFER', 'TRANSFER_CANCELLED']) expect(TRANSFER_EVENT_LABEL[e]).toBeTruthy();
  });
  it('設備與設施用語、台北時間格式', () => {
    expect(assetNoun('EQUIPMENT')).toBe('設備');
    expect(assetNoun('FACILITY')).toBe('設施');
    expect(formatDateTime('2026-11-10T16:30:00Z')).toContain('11/11'); // UTC 16:30 = 台北隔天 00:30
    expect(formatDateTime(null)).toBe('—');
  });
});
