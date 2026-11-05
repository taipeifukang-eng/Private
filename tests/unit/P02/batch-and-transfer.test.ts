import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { transferMonthPlan } from '../../../lib/workspace/transfer-months';
import { validateMovementReferences } from '../../../lib/workspace/movement-references';
import type { MovementDraft } from '../../../lib/workspace/movement-fields';

// P02 單元層（M2 規格 D.1、D.2）：
//   D.1 重複列略過（不再當錯誤）；D.2 調店不再因已送審月份整筆拒絕，改列出不會被修改的月份；
//   批次輸入的調店只建立待確認申請（員工主檔要等兩側督導都確認才換門市）。
//   SQL 的行為由整合層（tests/integration/P02.stores-people）回讀資料庫驗證；這裡檢查 SQL／rollback 的結構與純函式。

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SQL = read('supabase/workspace-dev/20261106200000_p02_d_batch_transfer.sql');
const ROLLBACK = read('supabase/workspace-dev/20261106200000_p02_d_batch_transfer.rollback.sql');
const fn = (text: string, name: string) => {
  const start = text.indexOf(`FUNCTION public.${name}(`);
  expect(start, `找不到函式 ${name}`).toBeGreaterThanOrEqual(0);
  const end = text.indexOf('\n$$;', start);
  return text.slice(start, end);
};

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('D.2 調店月份計畫：已送審月份不整筆拒絕', () => {
  const base = { effectiveDate: '2099-07-15', fromStore: A, toStore: B, fromName: '甲店', toName: '乙店', destinationDraftMonths: ['2099-07'] };
  it('調入店該月已送審：不列為衝突，列入 lockedMonths（日後進需重新確認清單），也不產生該月變更', () => {
    const plan = transferMonthPlan({ ...base, rows: [{ id: 'x', store_id: B, year_month: '2099-07', status: 'submitted', monthly_status: 'full_month', work_days: 31 }] });
    expect(plan.conflicts).toEqual([]);
    expect(plan.lockedMonths).toEqual(['2099-07']);
    expect(plan.changes.filter((c) => c.store_id === B)).toEqual([]);
  });
  it('重複的月份列仍是衝突（資料異常要先處理）', () => {
    const row = { id: 'a', store_id: B, year_month: '2099-07', status: 'draft', monthly_status: 'full_month', work_days: 31 };
    const plan = transferMonthPlan({ ...base, rows: [row, { ...row, id: 'b' }] });
    expect(plan.conflicts.join()).toContain('重複');
  });
});

describe('D.1 異動批次：完全重複列略過、調店只是待確認申請', () => {
  const store = (id: string, code: string) => ({ id, store_code: code, store_name: code, is_active: true });
  const draft = (o: Partial<MovementDraft>): MovementDraft => ({
    employee_code: 'FKF60001', employee_name: '甲', store_id: A, movement_type: 'promotion', birthday: '', position: '組長', newbie_level: '',
    effective_date: '2099-06-01', notes: '', from_store_id: '', to_store_id: '', onboarding_is_pharmacist: false, ...o,
  });
  const sources = (history: any[] = []) => ({
    stores: [store(A, 'ZT01'), store(B, 'ZT02')],
    units: [],
    employees: [{ employee_code: 'FKF60001', employee_name: '甲', store_id: A }],
    history,
  });

  it('已有相同員工、日期、職位的升職：列入 skipped，不是錯誤，整批仍有效', () => {
    const r = validateMovementReferences([draft({})], sources([{ employee_code: 'FKF60001', movement_date: '2099-06-01', movement_type: 'promotion', new_value: '組長', notes: null }]));
    expect(r.errors).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.skipped.map((x) => x.row)).toEqual([1]);
  });
  it('內容不同（職位不同）不算重複', () => {
    const r = validateMovementReferences([draft({ position: '主任' })], sources([{ employee_code: 'FKF60001', movement_date: '2099-06-01', movement_type: 'promotion', new_value: '組長', notes: null }]));
    expect(r.skipped).toEqual([]);
  });
  it('其他錯誤仍然是錯誤（找不到員工）', () => {
    const r = validateMovementReferences([draft({ employee_code: 'FKF69999' })], sources());
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'employee_code')).toBe(true);
  });
  it('調店列不會改變後續列看到的任職門市：調店後同批的新店列仍要等調店確認生效', () => {
    const transfer = draft({ movement_type: 'store_transfer', position: '', store_id: '', from_store_id: A, to_store_id: B, effective_date: '2099-06-10' });
    const next = draft({ movement_type: 'promotion', store_id: B, effective_date: '2099-06-20' });
    const r = validateMovementReferences([transfer, next], sources());
    expect(r.errors.some((e) => e.row === 2 && e.field === 'store_id')).toBe(true);
  });
});

describe('SQL 結構（20261106200000_p02_d_batch_transfer）', () => {
  it('兩店確認紀錄：每申請每側一筆，管理員代確認有 is_proxy，申請刪除時一併清除', () => {
    expect(SQL).toContain('CREATE TABLE IF NOT EXISTS public.store_transfer_confirmations');
    expect(SQL).toMatch(/side text NOT NULL CHECK\(side IN\('from','to'\)\)/);
    expect(SQL).toContain('is_proxy boolean NOT NULL DEFAULT false');
    expect(SQL).toContain('UNIQUE(request_id,side)');
    expect(SQL).toContain('ON DELETE CASCADE');
    expect(SQL).toContain('ADD COLUMN IF NOT EXISTS requested_date date');
  });
  it('確認函式：只有督導（role_type=supervisor）或系統管理員可確認某一側；兩側齊全才寫異動', () => {
    const f = fn(SQL, 'workspace_transfer_confirm');
    expect(f).toContain("role_type='supervisor'");
    expect(f).toContain('WORKSPACE_SIDE_DONE');
    expect(f).toContain('WORKSPACE_DATE_REQUIRED');
    expect(f).toContain('will_complete');
    // 單側確認直接回傳，不會走到寫入異動
    expect(f.indexOf("'status','pending'")).toBeLessThan(f.indexOf("INSERT INTO employee_movement_history"));
    // 舊版「任一店 store_managers 就可確認」已移除
    expect(f).not.toContain('store_id IN(req.from_store_id,req.to_store_id)) THEN RAISE EXCEPTION');
    // A.2／B.1 不再整筆拒絕
    expect(f).not.toContain('WORKSPACE_MONTH_LOCKED');
    expect(f).not.toContain('WORKSPACE_LATER_MOVEMENT');
  });
  it('批次輸入的調店列只建立待確認申請，不直接寫調店異動', () => {
    const f = fn(SQL, 'workspace_movement_save');
    expect(f).toContain('INSERT INTO store_transfer_requests');
    expect(f).toContain("'pending'");
    const transferBlock = f.slice(f.indexOf("IF kind='store_transfer' THEN"), f.indexOf('ELSE', f.indexOf("IF kind='store_transfer' THEN")));
    expect(transferBlock).not.toContain("INSERT INTO employee_movement_history");
    expect(transferBlock).not.toContain('UPDATE store_employees');
  });
  it('完全重複的列略過並回報（異動批次、批次升遷、員工匯入），不再整批擋下', () => {
    expect(fn(SQL, 'workspace_movement_save')).toContain('CONTINUE');
    expect(fn(SQL, 'workspace_movement_save')).not.toContain("RAISE EXCEPTION 'WORKSPACE_DUPLICATE'");
    expect(fn(SQL, 'workspace_promotion_save')).toContain("'skipped',skipped");
    expect(fn(SQL, 'workspace_employee_import_check')).toContain("'duplicates',dups");
    expect(fn(SQL, 'workspace_employee_import_save')).toContain("'skipped',skipped");
    // 其他錯誤仍整批不存：員編已存在但內容不同依舊是錯誤
    expect(fn(SQL, 'workspace_employee_import_check')).toContain('員編已存在，不會覆寫既有資料');
  });
  it('rollback 還原函式並移除確認紀錄與欄位', () => {
    expect(ROLLBACK).toContain('DROP TABLE IF EXISTS public.store_transfer_confirmations');
    expect(ROLLBACK).toContain('DROP COLUMN IF EXISTS requested_date');
    expect(ROLLBACK).toContain('FUNCTION public.workspace_transfer_confirm(');
    expect(fn(ROLLBACK, 'workspace_transfer_confirm')).toContain('WORKSPACE_MONTH_DUPLICATE');
    expect(fn(ROLLBACK, 'workspace_employee_import_check')).not.toContain('duplicates');
  });
});

describe('API 與介面', () => {
  it('調店確認走 workspace API，單側確認不需日期，兩側齊全才要求日期與核對版本', () => {
    const api = read('app/api/workspace/transfers/confirm/route.ts');
    expect(api).toContain('completes');
    expect(api).toContain('workspace_transfer_confirm');
    expect(api).toContain('p_date:completes?body.effective_date:null');
  });
  it('調店頁顯示兩位督導各自的確認狀態與代確認標記', () => {
    const page = read('vue-workspace/src/pages/Transfers.vue');
    expect(page).toContain('督導');
    expect(page).toContain('系統管理員代確認');
    const dialog = read('vue-workspace/src/components/TransferConfirm.vue');
    expect(dialog).toContain('approveSide');
    expect(dialog).toContain('willComplete');
  });
  it('F.3：門市列表顯示已停止數量、店長指派提示已有店長', () => {
    expect(read('vue-workspace/src/pages/Stores.vue')).toContain('inactiveCount');
    expect(read('vue-workspace/src/pages/StoreManagerEdit.vue')).toContain('已有店長：');
    expect(read('app/api/workspace/stores/route.ts')).toContain('inactiveCount');
  });
  it('F.2：維持新版，有多位督導的門市必須明確指定主責', () => {
    expect(read('supabase/workspace-dev/20261029160000_vue_supervisor_primary_choice.sql')).toContain('WORKSPACE_PRIMARY_REQUIRED');
  });
});
