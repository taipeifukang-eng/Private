import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { STORE_RANK_ORDER, ADMIN_RANK_ORDER, positionRank } from '../../../lib/workspace/position-rank';
import { validateMovementReferences } from '../../../lib/workspace/movement-references';
import type { MovementDraft } from '../../../lib/workspace/movement-fields';

// W06 單元層（M2 規格 A、B 組）：異動回寫名冊的規則落在 DEV SQL（單一真相 workspace_roster_recompute），
// 這裡用靜態檢查確保各入口都走同一支計算、舊的整筆拒絕已取消、職等表與 TS 一致、檢查 SQL 只讀；
// 行為本身由整合層（tests/integration/W06.*）以資料庫回讀驗證。

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SQL = read('supabase/workspace-dev/20261106100000_w06_roster_recompute.sql');
const ROLLBACK = read('supabase/workspace-dev/20261106100000_w06_roster_recompute.rollback.sql');

/** 取出指定函式的完整內容（CREATE OR REPLACE FUNCTION name( ... 到下一個 CREATE 或結尾）。 */
function fn(name: string): string {
  const start = SQL.indexOf(`FUNCTION public.${name}(`);
  const alt = start >= 0 ? start : SQL.indexOf(`FUNCTION ${name}(`);
  expect(alt, `找不到函式 ${name}`).toBeGreaterThanOrEqual(0);
  const next = SQL.indexOf('CREATE OR REPLACE FUNCTION', alt + 10);
  return SQL.slice(alt, next < 0 ? undefined : next);
}

describe('單一計算：所有入口都呼叫 workspace_roster_recompute', () => {
  for (const name of ['workspace_movement_save', 'workspace_promotion_save', 'workspace_apply_due_promotions', 'workspace_transfer_confirm', 'workspace_transfer_correct', 'workspace_roster_apply_store_month']) {
    it(`${name} 呼叫 workspace_roster_recompute`, () => {
      expect(fn(name)).toContain('workspace_roster_recompute(');
    });
  }
  it('異動登記不再直接改月份名冊（入職藥師、代理店長的舊式直接 UPDATE 已移除）', () => {
    const save = fn('workspace_movement_save');
    expect(save).not.toMatch(/UPDATE monthly_staff_status SET is_pharmacist/);
    expect(save).not.toMatch(/UPDATE monthly_staff_status SET is_acting_manager/);
    expect(save).not.toMatch(/UPDATE monthly_staff_status SET monthly_status/);
  });
  it('API：初始化成功後套用同一套計算，月結頁提供「依異動重算」並回傳需重新確認與近期調整清單', () => {
    const route = read('app/api/workspace/monthly/route.ts');
    expect(route).toContain('workspace_roster_apply_store_month');
    expect(route).toMatch(/body\.action === "recompute"/);
    expect(route).toContain('monthly_staff_recheck');
    expect(route).toContain('monthly_staff_adjustment_log');
    expect(route).toContain('recheck,');
    expect(route).toContain('adjustments,');
  });
  it('畫面：月結頁有需重新確認、近期因異動自動調整、依異動重算與調店提示', () => {
    const vue = read('vue-workspace/src/pages/Monthly.vue');
    for (const id of ['monthly-recheck', 'monthly-adjustments', 'monthly-recompute', 'movement-hint']) expect(vue).toContain(id);
    expect(read('vue-workspace/src/pages/MovementDraft.vue')).toContain('return-store-hint');
  });
});

describe('A.2／B.1：取消整筆拒絕', () => {
  for (const name of ['workspace_movement_save', 'workspace_transfer_confirm', 'workspace_transfer_correct']) {
    it(`${name} 不再因已送審月份而拒絕（WORKSPACE_MONTH_LOCKED）`, () => {
      expect(fn(name)).not.toContain("RAISE EXCEPTION 'WORKSPACE_MONTH_LOCKED'");
    });
  }
  for (const name of ['workspace_movement_save', 'workspace_transfer_confirm']) {
    it(`${name} 補登較早的調店不再整筆拒絕（WORKSPACE_LATER_MOVEMENT），改為只寫歷史`, () => {
      const text = fn(name);
      expect(text).not.toContain("RAISE EXCEPTION 'WORKSPACE_LATER_MOVEMENT'");
      expect(text).toContain('is_latest');
    });
  }
  it('復職可指定門市：放寬 WORKSPACE_OTHER_STORE，只擋「在職中」的其他門市', () => {
    const save = fn('workspace_movement_save');
    expect(save).toContain("employment_status IS DISTINCT FROM 'leave_without_pay'");
    expect(save).toContain("INSERT INTO store_employees");
  });
  it('已送審月份寫入需重新確認：沿用 W05 的 monthly_staff_recheck 與 workspace_monthly_recheck_add', () => {
    const recompute = fn('workspace_roster_recompute');
    expect(recompute).toContain('workspace_monthly_recheck_add(');
    expect(recompute).toContain('workspace_staff_month_locked(');
  });
});

describe('B.2：職等表 SQL 與 TS 一致', () => {
  it('workspace_position_rank 的對照與 lib/workspace/position-rank.ts 相同', () => {
    const body = fn('workspace_position_rank');
    const sqlRanks = new Map<string, number>();
    for (const m of Array.from(body.matchAll(/WHEN '([^']+)' THEN (\d+)/g))) sqlRanks.set(m[1], Number(m[2]));
    // 專員以上固定值
    (STORE_RANK_ORDER as readonly string[]).forEach((label, index) => {
      if (index < 3) return;
      expect(sqlRanks.get(label), label).toBe(index);
    });
    // 新人三階：SQL 以階段字串判斷，與 TS 的 0/1/2 一致
    expect(positionRank('新人', '未過階新人')!.rank).toBe(0);
    expect(positionRank('新人', '一階新人')!.rank).toBe(1);
    expect(positionRank('新人', '二階新人')!.rank).toBe(2);
    expect(body).toContain("LIKE '%二階%' THEN 2 WHEN coalesce(p_level,'') LIKE '%一階%' THEN 1 ELSE 0");
    expect(ADMIN_RANK_ORDER.length).toBe(2);
    expect(body).toContain("100+CASE WHEN coalesce(p_level,'') LIKE '%未過階%' THEN 0 WHEN coalesce(p_level,'') LIKE '%過階%' THEN 1");
  });
  it('同日取職等最高；無法比較時保留先登錄者；代理店長不參與（SQL 內容）', () => {
    const body = fn('workspace_effective_promotion');
    expect(body).toContain("h.new_value<>'代理店長'");
    expect(body).toContain('comparable');
    expect(body).toContain('g.c ASC');
  });
});

describe('B.3：唯讀檢查 SQL', () => {
  const check = read('docs/vue-workspace/parity-plan/m2-sql/check_position_mismatch.sql');
  const code = check.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  it('只有 SELECT／WITH，沒有任何寫入或結構變更', () => {
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE)\b/i);
    expect(code.trim()).toMatch(/^WITH /);
    expect(code).toContain('store_employees');
    expect(code).toContain("movement_type = 'promotion'");
  });
  it('檔頭寫明用途與不自動修正', () => {
    expect(check).toContain('唯讀');
    expect(check).toContain('不要自動修正');
  });
});

describe('回復與套用腳本', () => {
  it('rollback 還原五支函式並移除新增物件', () => {
    for (const name of ['workspace_movement_save', 'workspace_promotion_save', 'workspace_apply_due_promotions', 'workspace_transfer_confirm', 'workspace_transfer_correct']) expect(ROLLBACK).toContain(`FUNCTION public.${name}(`);
    for (const drop of ['workspace_roster_apply_store_month', 'workspace_roster_recompute', 'workspace_effective_promotion', 'workspace_position_rank', 'monthly_staff_adjustment_log', 'movement_hint']) expect(ROLLBACK).toContain(drop);
  });
  it('套用腳本含 DEV ref 防呆', () => {
    const script = read('scripts/apply-workspace-w06-dev.cjs');
    expect(script).toContain('mjpdfpxqttbhzeimmtqr');
    expect(script).toContain('20261106100000_w06_roster_recompute');
  });
  it('不動 supabase/migrations（新檔只在 workspace-dev）', () => {
    expect(fs.existsSync(path.join(ROOT, 'supabase/workspace-dev/20261106100000_w06_roster_recompute.sql'))).toBe(true);
  });
});

describe('A.4：復職門市驗證', () => {
  const A = '11111111-1111-4111-8111-111111111111';
  const B = '22222222-2222-4222-8222-222222222222';
  const stores = [A, B].map((id, i) => ({ id, store_code: `ZT0${i + 1}`, store_name: `測試${i + 1}`, is_active: true }));
  const row = (type: string): MovementDraft => ({
    employee_code: 'FK1234', employee_name: '甲', store_id: B, movement_type: type, birthday: '', position: '', newbie_level: '', effective_date: '2026-10-01', notes: '', from_store_id: '', to_store_id: '', onboarding_is_pharmacist: false,
  });
  const sources = { stores, units: [], employees: [{ employee_code: 'FK1234', employee_name: '甲', store_id: A }], history: [] };
  it('復職到不同於主檔原店的門市：通過', () => {
    expect(validateMovementReferences([row('return_to_work')], sources).valid).toBe(true);
  });
  it('其他類型（例如離職）仍要求門市與員工主檔相符', () => {
    const r = validateMovementReferences([row('resignation')], sources);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'store_id')).toBe(true);
  });
  it('復職仍要求員工存在且姓名相符', () => {
    const r = validateMovementReferences([{ ...row('return_to_work'), employee_name: '乙' }], sources);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'employee_name')).toBe(true);
  });
});

describe('allowlist：與舊版不同處登記並註明規格條號', () => {
  const list = JSON.parse(read('tests/parity/allowlist.json')) as Array<Record<string, any>>;
  const w06 = list.filter((e) => String(e.id).startsWith('w06-'));
  it('W06 差異條目都有使用者核可與規格條號', () => {
    expect(w06.length).toBeGreaterThanOrEqual(5);
    for (const e of w06) {
      expect(e.approvedBy, e.id).toBe('user (2026-11-05 survey/m2)');
      expect(e.reason, e.id).toMatch(/M2 規格 [AB]\.\d/);
      expect(e.match?.entry, e.id).toBeTruthy();
    }
  });
});
