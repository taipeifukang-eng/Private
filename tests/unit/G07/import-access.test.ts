import { describe, expect, it } from 'vitest';
import { gaFlags } from '@/lib/workspace/general-affairs/access';
import { gaNavigation } from '@/lib/workspace/general-affairs/nav';
import { WORKSPACE_TAB_KINDS } from '@/lib/workspace/page-kinds';
import { resolveAccess } from '@/lib/workspace/permission-semantics';
import { WORKSPACE_PAGE_META } from '../../../vue-workspace/src/workspace-page-meta';

// Q29：Excel 匯入與上線貼標進度的入口旗標、側欄、頁面註冊。
const access = (codes: string[], opts: { roleCode?: string } = {}) =>
  resolveAccess([{ is_active: true, role: { code: opts.roleCode || 'x', role_permissions: codes.map((c) => ({ is_allowed: true, permission: { code: c, is_active: true } })) } }]);
const kinds = (a: ReturnType<typeof access>, storeMember = false) =>
  gaNavigation({ has: a.has, permissions: a.permissions as any, roleCodes: a.roleCodes, isAdmin: a.isAdmin, storeMember }).flatMap((g) => g.items.flatMap((i: any) => [i, ...(i.children || [])])).map((i: any) => i.kind);

describe('gaAssetImport 旗標', () => {
  it('設備或設施管理才有；查看權限、店長、無權限都沒有', () => {
    expect(gaFlags(access(['general_affairs.equipment.manage']).has, false).gaAssetImport).toBe(true);
    expect(gaFlags(access(['general_affairs.facility.manage']).has, false).gaAssetImport).toBe(true);
    expect(gaFlags(access(['general_affairs.equipment.view']).has, false).gaAssetImport).toBe(false);
    expect(gaFlags(access(['general_affairs.facility.view']).has, false).gaAssetImport).toBe(false);
    expect(gaFlags(access([]).has, true, true).gaAssetImport).toBe(false);
    expect(gaFlags(access([]).has, false).gaAssetImport).toBe(false);
  });
});
describe('gaOnboardingProgress 旗標', () => {
  it('設備／設施查看或管理、店長、名單內人員有；無權限沒有', () => {
    for (const c of ['equipment.view', 'equipment.manage', 'facility.view', 'facility.manage']) expect(gaFlags(access([`general_affairs.${c}`]).has, false).gaOnboardingProgress).toBe(true);
    expect(gaFlags(access([]).has, true).gaOnboardingProgress).toBe(true);
    expect(gaFlags(access([]).has, false, true).gaOnboardingProgress).toBe(true);
    expect(gaFlags(access([]).has, false).gaOnboardingProgress).toBe(false);
  });
});
describe('側欄與頁面註冊', () => {
  it('總務管理者：側欄有「上線貼標進度」與「Excel 匯入」；店長只有進度；無權限都沒有', () => {
    const ga = kinds(access(['general_affairs.service_center.access', 'general_affairs.equipment.manage']));
    expect(ga).toEqual(expect.arrayContaining(['ga-onboarding-progress', 'ga-asset-import']));
    const sm = kinds(access([], { roleCode: 'store_manager' }), true);
    expect(sm).toContain('ga-onboarding-progress');
    expect(sm).not.toContain('ga-asset-import');
    const none = kinds(access([]));
    expect(none).not.toContain('ga-onboarding-progress');
    expect(none).not.toContain('ga-asset-import');
  });
  it('頁面 kind 已註冊並綁旗標', () => {
    expect(WORKSPACE_TAB_KINDS).toEqual(expect.arrayContaining(['ga-onboarding-progress', 'ga-asset-import']));
    expect(WORKSPACE_PAGE_META['ga-onboarding-progress'].permission).toEqual(['gaOnboardingProgress']);
    expect(WORKSPACE_PAGE_META['ga-asset-import'].permission).toEqual(['gaAssetImport']);
  });
});
