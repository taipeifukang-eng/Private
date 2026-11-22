import { describe, expect, it } from 'vitest';
import { archiveScope } from '../../../lib/workspace/task-archive';
import { workspaceNavigation } from '../../../lib/workspace/navigation';

// W09 單元層（M3 A.4）：已封存任務頁維持「身分（管理員或主管）加 task.view_archived」；導覽入口只看 task.view_archived（舊 Navbar）。

const ME = '11111111-1111-4111-8111-111111111111';
const ctxOf = (o: { isAdmin?: boolean; role?: string | null; caps?: string[]; department?: string | null }) =>
  ({
    isAdmin: !!o.isAdmin,
    user: { id: ME },
    roleCodes: new Set<string>(),
    has: (...codes: string[]) => !!o.isAdmin || codes.some((c) => (o.caps || []).includes(c)),
    admin: { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: o.role ?? null, department: o.department ?? null }, error: null }) }) }) }) },
  }) as any;

describe('archiveScope（頁面權限）', () => {
  it('系統管理員（profiles.role = admin）：全部範圍，不需權限碼', async () => {
    expect(await archiveScope(ctxOf({ role: 'admin', department: '營業部' }))).toEqual({ all: true, department: '營業部' });
  });
  it('主管加 task.view_archived：可進，只看自己建立或封存的', async () => {
    expect(await archiveScope(ctxOf({ role: 'manager', caps: ['task.view_archived'] }))).toMatchObject({ all: false });
  });
  it('主管沒有 task.view_archived（補授權前）：403', async () => {
    await expect(archiveScope(ctxOf({ role: 'manager' }))).rejects.toMatchObject({ status: 403 });
  });
  it('有 task.view_archived 但不是管理員或主管：403（舊版頁面也會導回首頁）', async () => {
    await expect(archiveScope(ctxOf({ role: 'member', caps: ['task.view_archived'] }))).rejects.toMatchObject({ status: 403 });
    await expect(archiveScope(ctxOf({ role: 'store_manager', caps: ['task.view_archived'] }))).rejects.toMatchObject({ status: 403 });
  });
  it('一般員工、無權限者：403', async () => {
    await expect(archiveScope(ctxOf({ role: 'member' }))).rejects.toMatchObject({ status: 403 });
  });
});

describe('導覽入口（nav-archived-feature-gate 改回舊版）', () => {
  const entry = (ctx: any, features: any = {}) =>
    workspaceNavigation(ctx, features)
      .flatMap((g: any) => g.items)
      .find((i: any) => i.href === '/admin/archived');
  it('持有 task.view_archived：入口可見，不再受功能旗標影響（taskArchive 旗標為 false 也一樣）', () => {
    expect(entry(ctxOf({ caps: ['task.view_archived'] }), { taskArchive: false })).toMatchObject({ kind: 'task-archive', href: '/admin/archived' });
  });
  it('沒有 task.view_archived：入口不可見（即使旗標為 true）', () => {
    expect(entry(ctxOf({ role: 'manager' }), { taskArchive: true })).toBeUndefined();
  });
  it('管理員：入口可見', () => {
    expect(entry(ctxOf({ isAdmin: true }))).toMatchObject({ kind: 'task-archive' });
  });
});
