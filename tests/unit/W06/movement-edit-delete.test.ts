import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canDeleteMovement, canEditMovement, MOVEMENT_DELETE_CODES, MOVEMENT_EDIT_CODES } from '../../../lib/workspace/employee-movements';

// W06 單元層（M2 規格 C 組）：C.2 權限規則（純函式）與 C.1 的靜態檢查（刪除只限最新一筆、刪除與修改都走同一支重算、
// 不開放改類型與門市、權限在伺服器端檢查、歷史頁介面）。行為由整合層（tests/integration/W06.movement-edit-delete）回讀資料庫驗證。

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SQL = read('supabase/workspace-dev/20261106110000_w06_c_movement_edit_delete.sql');
const ROLLBACK = read('supabase/workspace-dev/20261106110000_w06_c_movement_edit_delete.rollback.sql');
const fn = (name: string) => {
  const start = SQL.indexOf(`FUNCTION public.${name}(`);
  expect(start, `找不到函式 ${name}`).toBeGreaterThanOrEqual(0);
  const next = SQL.indexOf('CREATE OR REPLACE FUNCTION', start + 10);
  return SQL.slice(start, next < 0 ? undefined : next);
};
const ctxWith = (...codes: string[]) => ({ has: (...need: string[]) => need.some((c) => codes.includes(c)) });

describe('C.2 權限規則', () => {
  it('修改：異動管理、員工管理、批次升遷任一即可', () => {
    expect([...MOVEMENT_EDIT_CODES]).toEqual(['employee.movement.manage', 'employee.manage', 'employee.promotion.batch']);
    for (const code of MOVEMENT_EDIT_CODES) expect(canEditMovement(ctxWith(code)), code).toBe(true);
    expect(canEditMovement(ctxWith('employee.employee.edit', 'employee.promotion.delete', 'employee.promotion.edit'))).toBe(false);
    expect(canEditMovement(ctxWith())).toBe(false);
  });
  it('刪除：只有「刪除異動」權限，修改權限不能刪除', () => {
    expect([...MOVEMENT_DELETE_CODES]).toEqual(['employee.promotion.delete']);
    expect(canDeleteMovement(ctxWith('employee.promotion.delete'))).toBe(true);
    for (const code of MOVEMENT_EDIT_CODES) expect(canDeleteMovement(ctxWith(code)), code).toBe(false);
  });
});

describe('C.1 資料庫函式', () => {
  it('刪除：只能刪最新一筆（有較新的異動丟 WORKSPACE_NOT_LATEST），並呼叫主檔恢復與名冊重算', () => {
    const del = fn('workspace_movement_delete');
    expect(del).toContain("RAISE EXCEPTION 'WORKSPACE_NOT_LATEST'");
    expect(del).toContain('(h.movement_date,h.created_at,h.id)>(m.movement_date,m.created_at,m.id)');
    expect(del).toContain('workspace_employee_master_resync(');
    expect(del).toContain('workspace_employee_master_position_sync(');
    expect(del).toContain('workspace_roster_recompute(p_actor,m.employee_code,ym,NULL,NULL,true,false');
    // A.2：不強制改寫已送審月份（p_apply_locked=false）
    expect(del).not.toMatch(/workspace_roster_recompute\([^)]*true,true/);
  });
  it('修改：只開放姓名、日期、備註、升職職位與階段、入職藥師身分，不開放改類型與門市；修改後重算', () => {
    const upd = fn('workspace_movement_update');
    const histUpdate = /UPDATE employee_movement_history SET([\s\S]*?)WHERE id=m\.id;/.exec(upd)?.[1] ?? '';
    expect(histUpdate).toContain('employee_name=nm');
    expect(histUpdate).not.toMatch(/movement_type\s*=/);
    expect(histUpdate).not.toMatch(/\bstore_id\s*=/);
    expect(upd).toContain('workspace_roster_recompute(p_actor,m.employee_code,from_ym');
    expect(upd).toContain("RAISE EXCEPTION 'WORKSPACE_DUPLICATE'");
    expect(upd).toContain('workspace_staff_month_locked(');
    expect(upd).toContain("'行政階級:'");
    expect(upd).toContain("'新人等級:'");
  });
  it('函式只授權給 service_role，rollback 移除三支新函式', () => {
    for (const name of ['workspace_movement_update(uuid,uuid,jsonb)', 'workspace_movement_delete(uuid,uuid)', 'workspace_employee_master_resync(text)']) {
      expect(SQL).toContain(`REVOKE ALL ON FUNCTION public.${name} FROM PUBLIC,anon,authenticated`);
      expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION public.${name} TO service_role`);
      expect(ROLLBACK).toContain(`DROP FUNCTION IF EXISTS public.${name}`);
    }
  });
  it('DEV 套用腳本包含 C 組檔案', () => {
    expect(read('scripts/apply-workspace-w06-dev.cjs')).toContain('20261106110000_w06_c_movement_edit_delete');
  });
});

describe('C.1／C.2 API 與介面', () => {
  const route = read('app/api/workspace/employee-movements/[id]/route.ts');
  it('PATCH／DELETE 先檢查權限再用管理端讀取該筆異動（與舊版相同，不受門市範圍影響）；權限行為由整合層以單一權限帳號驗證', () => {
    expect(route).toContain("ctx.admin.from('employee_movement_history')");
    expect(route).not.toContain("ctx.auth.from('employee_movement_history')");
    expect(route).toContain('workspace_movement_update');
    expect(route).toContain('workspace_movement_delete');
  });
  it('API 不接受改類型與門市：只轉送白名單欄位', () => {
    for (const key of ['employee_name', 'movement_date', 'notes', 'position', 'newbie_level', 'onboarding_is_pharmacist']) expect(route).toContain(key);
    expect(route).not.toMatch(/fields\.(movement_type|store_id)/);
  });
  it('歷史頁：修改、刪除按鈕；非最新一筆停用並說明；刪除前確認', () => {
    const vue = read('vue-workspace/src/pages/MovementHistory.vue');
    expect(vue).toContain('data-testid="movement-edit"');
    expect(vue).toContain('data-testid="movement-delete"');
    expect(vue).toContain('!r.is_latest');
    expect(vue).toContain('data-testid="movement-delete-hint"');
    expect(vue).toContain('data-testid="movement-delete-confirm"');
    expect(vue).toContain('data.canEdit');
    expect(vue).toContain('data.canDelete');
  });
});
