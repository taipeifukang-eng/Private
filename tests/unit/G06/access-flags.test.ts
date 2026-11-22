import { describe, expect, it } from 'vitest';
import { gaFlags } from '@/lib/workspace/general-affairs/access';
import { gaNavigation } from '@/lib/workspace/general-affairs/nav';
import { resolveAccess } from '@/lib/workspace/permission-semantics';

const access = (codes: string[], opts: { profileRole?: string; roleCode?: string } = {}) =>
  resolveAccess([{ is_active: true, role: { code: opts.roleCode || 'x', role_permissions: codes.map((c) => ({ is_allowed: true, permission: { code: c, is_active: true } })) } }], opts.profileRole);
const flatten = (groups: any[]): any[] => groups.flatMap((g) => g.items.flatMap((i: any) => [i, ...(i.children || [])]));
const nav = (a: ReturnType<typeof access>) => gaNavigation({ has: a.has, permissions: a.permissions as any, roleCodes: a.roleCodes, isAdmin: a.isAdmin });

describe('第 2 批旗標：設備清冊、新增設備、貼標待辦、貼標複核', () => {
  it('完全沒權限全部 false', () => {
    const f = gaFlags(access([]).has, false);
    expect([f.gaEquipment, f.gaEquipmentCreate, f.gaOnboardingTasks, f.gaOnboardingReview]).toEqual([false, false, false, false]);
  });
  it('設備查看：能看清冊與貼標待辦，不能新增、不能複核', () => {
    const f = gaFlags(access(['general_affairs.equipment.view']).has, false);
    expect(f).toMatchObject({ gaEquipment: true, gaEquipmentCreate: false, gaOnboardingTasks: true, gaOnboardingReview: false });
  });
  it('設備管理：全部可用', () => {
    const f = gaFlags(access(['general_affairs.equipment.manage']).has, false);
    expect(f).toMatchObject({ gaEquipment: true, gaEquipmentCreate: true, gaOnboardingTasks: true, gaOnboardingReview: true });
  });
  it('設施管理也能進貼標待辦與複核（設施比照設備），但不能進設備清冊', () => {
    const f = gaFlags(access(['general_affairs.facility.manage']).has, false);
    expect(f).toMatchObject({ gaEquipment: false, gaEquipmentCreate: false, gaOnboardingTasks: true, gaOnboardingReview: true });
  });
  it('店長身分：設備清冊與貼標待辦，不能新增或複核', () => {
    const f = gaFlags(access([]).has, true);
    expect(f).toMatchObject({ gaEquipment: true, gaEquipmentCreate: false, gaOnboardingTasks: true, gaOnboardingReview: false });
  });
  it('側欄：貼標待辦與複核追加在「資產與庫存」群組最後', () => {
    const a = access(['general_affairs.service_center.access', 'general_affairs.equipment.manage']);
    const groups = nav(a);
    const group = groups.find((g) => g.id === 'assets-inventory')!;
    expect(group.items.slice(-4).map((i: any) => i.kind)).toEqual(['ga-onboarding-tasks', 'ga-onboarding-review', 'ga-onboarding-progress', 'ga-asset-import']);
    expect(flatten(groups).find((i) => i.id === 'equipment-new')).toMatchObject({ kind: 'ga-equipment-create' });
  });
  it('店長側欄只有貼標待辦、沒有複核', () => {
    const items = flatten(nav(access([], { roleCode: 'store_manager' })));
    expect(items.find((i) => i.kind === 'ga-onboarding-tasks')).toBeTruthy();
    expect(items.find((i) => i.kind === 'ga-onboarding-review')).toBeUndefined();
  });
});
