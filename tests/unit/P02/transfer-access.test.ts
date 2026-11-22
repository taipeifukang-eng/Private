import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { transferAccess } from '../../../lib/workspace/transfers';
import { validateMovementFields } from '../../../lib/workspace/movement-fields';

// P02 單元層（M2 規格 H.1、H.7、H.5）：調店確認人判斷（任一方督導／管理員代確認／店長不可）與批次調店列的「新店續任代理」欄位。

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const FROM = '11111111-1111-4111-8111-111111111111';
const TO = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

/** 最小的 Supabase 查詢替身：只支援 transferAccess 用到的 profiles 與 store_managers 讀取。 */
function fakeContext(o: { admin?: boolean; permissions?: string[]; assignments?: { store_id: string; role_type: string }[] }) {
  const table = (name: string) => {
    const rows = name === 'profiles' ? [{ role: o.admin ? 'admin' : 'member' }] : (o.assignments || []);
    const q: any = { select: () => q, eq: () => q, order: () => q, range: () => q, maybeSingle: () => q, then: (ok: any) => ok({ data: name === 'profiles' ? rows[0] : rows, error: null }) };
    return q;
  };
  const perms = new Set(o.permissions || []);
  return { user: { id: 'u' }, auth: { from: table }, admin: { from: table }, has: (c: string) => perms.has(c) } as any;
}
const REQ = { from_store_id: FROM, to_store_id: TO };

describe('H.1／H.7 調店確認人', () => {
  it('原店督導可確認（side=from）', async () => {
    const a = await transferAccess(fakeContext({ permissions: ['employee.store_transfer.confirm'], assignments: [{ store_id: FROM, role_type: 'supervisor' }] }));
    expect(a.canConfirm(REQ)).toBe(true);
    expect(a.sideOf(REQ)).toBe('from');
  });
  it('新店督導可確認（side=to）', async () => {
    const a = await transferAccess(fakeContext({ permissions: ['employee.store_transfer.confirm'], assignments: [{ store_id: TO, role_type: 'supervisor' }] }));
    expect(a.canConfirm(REQ)).toBe(true);
    expect(a.sideOf(REQ)).toBe('to');
  });
  it('同一位督導負責兩店（side=both）', async () => {
    const a = await transferAccess(fakeContext({ permissions: ['employee.store_transfer.confirm'], assignments: [{ store_id: FROM, role_type: 'supervisor' }, { store_id: TO, role_type: 'supervisor' }] }));
    expect(a.sideOf(REQ)).toBe('both');
  });
  it('系統管理員可代確認（side=admin）；管理員本身是督導時不算代確認', async () => {
    const a = await transferAccess(fakeContext({ admin: true }));
    expect(a.canConfirm(REQ)).toBe(true);
    expect(a.sideOf(REQ)).toBe('admin');
  });
  it('店長不能確認：即使有確認權限、也是這家店的店長', async () => {
    const a = await transferAccess(fakeContext({ permissions: ['employee.store_transfer.confirm'], assignments: [{ store_id: FROM, role_type: 'store_manager' }] }));
    expect(a.canConfirm(REQ)).toBe(false);
    expect(a.sideOf(REQ)).toBeNull();
    expect(a.canRead(REQ)).toBe(true); // 看得到，但不能確認
  });
  it('督導指派的是無關門市：不能確認', async () => {
    const a = await transferAccess(fakeContext({ permissions: ['employee.store_transfer.confirm'], assignments: [{ store_id: OTHER, role_type: 'supervisor' }] }));
    expect(a.canConfirm(REQ)).toBe(false);
  });
  it('沒有確認權限的督導不能確認', async () => {
    const a = await transferAccess(fakeContext({ permissions: ['employee.store_transfer.create'], assignments: [{ store_id: FROM, role_type: 'supervisor' }] }));
    expect(a.canConfirm(REQ)).toBe(false);
  });
  it('沒有任何調店權限：直接 403', async () => {
    await expect(transferAccess(fakeContext({}))).rejects.toMatchObject({ status: 403 });
  });
});

describe('H.5 批次調店列：新店續任代理欄位', () => {
  const base = { employee_code: 'FKF60001', employee_name: '甲', store_id: '', movement_type: 'store_transfer', from_store_id: FROM, to_store_id: TO, effective_date: '2099-06-15', notes: '' };
  it('勾選才出現 continue_acting=true；預設（未勾）整個欄位不存在', () => {
    const on = validateMovementFields([{ ...base, continue_acting: true }], '2099-12-31');
    expect(on.valid).toBe(true);
    expect(on.rows[0].continue_acting).toBe(true);
    const off = validateMovementFields([base], '2099-12-31');
    expect('continue_acting' in off.rows[0]).toBe(false);
    const falsy = validateMovementFields([{ ...base, continue_acting: false }], '2099-12-31');
    expect('continue_acting' in falsy.rows[0]).toBe(false);
  });
  it('非調店列忽略 continue_acting', () => {
    const r = validateMovementFields([{ ...base, movement_type: 'leave_without_pay', store_id: FROM, continue_acting: true }], '2099-12-31');
    expect('continue_acting' in r.rows[0]).toBe(false);
  });
});

describe('H.5 登記調店 API 與 SQL 結構', () => {
  it('create API：偵測代理（GET acting_code）、答案只在目前確實是代理店長時才記下', () => {
    const api = read('app/api/workspace/transfers/create/route.ts');
    expect(api).toContain('acting_code');
    expect(api).toContain('workspace_acting_active');
    expect(api).toContain('continue_acting:continueActing');
  });
  it('movement-validation：預覽回傳 actingTransfers（員編｜生效日）供畫面逐列標示', () => {
    const api = read('app/api/workspace/movement-validation/route.ts');
    expect(api).toContain('actingTransfers');
    expect(api).toContain('workspace_acting_active');
  });
  it('刪除調店異動連帶還原自動登記的新店代理、更正調店日期同步移動它', () => {
    const c = read('supabase/workspace-dev/20261106110000_w06_c_movement_edit_delete.sql');
    expect(c).toContain('acting_movement_id');
    expect(c).toContain('DELETE FROM employee_movement_history WHERE id=gen');
    expect(c).toContain('h.id IS DISTINCT FROM gen');
    const w06 = read('supabase/workspace-dev/20261106100000_w06_roster_recompute.sql');
    expect(w06).toContain('id IS DISTINCT FROM req.acting_movement_id');
    expect(w06).toContain('UPDATE employee_movement_history SET movement_date=p_date WHERE id=req.acting_movement_id');
  });
});
