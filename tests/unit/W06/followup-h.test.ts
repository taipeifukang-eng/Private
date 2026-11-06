import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { HQ_POSITIONS, PART_TIME_POSITIONS, isHeadquartersPosition, splitPromotionPositions, positionRank } from '../../../lib/workspace/position-rank';
import { POSITION_OPTIONS } from '../../../types/workflow';

// W06 單元層（M2 規格 H.3、H.5、H.6、H.9、H.4）。SQL 行為由整合層回讀資料庫驗證；這裡檢查純函式與 SQL／畫面結構。

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const body = (text: string, name: string) => {
  const start = text.indexOf('FUNCTION public.' + name + '(');
  expect(start, '找不到函式 ' + name).toBeGreaterThanOrEqual(0);
  const end = text.indexOf('\n$$;', start);
  return text.slice(start, end > 0 ? end : text.indexOf('$$;', start + 10));
};
const W06 = read('supabase/workspace-dev/20261106100000_w06_roster_recompute.sql');
const C = read('supabase/workspace-dev/20261106110000_w06_c_movement_edit_delete.sql');

describe('H.6 升職職位下拉分組', () => {
  it('總部職位共 9 個，兼職四職位與其他門市職位都在門市組', () => {
    expect([...HQ_POSITIONS]).toEqual(['總經理', '副總經理', '資深經理', '資深副理', '副理', '資深專員', '高級專員', '出納專員', '助理']);
    const { store, headquarters } = splitPromotionPositions([...POSITION_OPTIONS, '代理店長']);
    expect(headquarters).toEqual(['總經理', '副總經理', '資深經理', '資深副理', '副理', '資深專員', '高級專員', '出納專員', '助理']);
    for (const p of PART_TIME_POSITIONS) expect(store).toContain(p);
    for (const p of ['經理', '督導', '店長', '副店長', '主任', '組長', '專員', '新人', '行政', '代理店長']) expect(store, p).toContain(p);
    expect(store.length + headquarters.length).toBe(POSITION_OPTIONS.length + 1);
  });
  it('保留原順序、沒有遺漏；isHeadquartersPosition 容忍前後空白', () => {
    const { store, headquarters } = splitPromotionPositions(POSITION_OPTIONS);
    expect([...store, ...headquarters].sort()).toEqual([...POSITION_OPTIONS].sort());
    expect(isHeadquartersPosition(' 副理 ')).toBe(true);
    expect(isHeadquartersPosition('專員')).toBe(false);
    expect(isHeadquartersPosition(undefined)).toBe(false);
  });
  it('不改排名規則：總部職位仍沒有職等（不參與比較）', () => {
    for (const p of HQ_POSITIONS) expect(positionRank(p), p).toBeNull();
  });
  it('三個升職職位下拉（批次輸入、歷史修改、批次升遷）都使用分組元件，預設收起總部職位', () => {
    const comp = read('vue-workspace/src/components/PromotionPositionSelect.vue');
    expect(comp).toContain('顯示總部職位');
    expect(comp).toContain('splitPromotionPositions');
    expect(comp).toContain('const showHq=ref(isHeadquartersPosition(props.modelValue))');
    for (const page of ['MovementDraft', 'MovementHistory', 'StorePromotions']) expect(read('vue-workspace/src/pages/' + page + '.vue'), page).toContain('PromotionPositionSelect');
  });
  it('批次升遷 Excel 匯入與 API 仍接受總部職位（只是畫面分組，不限制）', () => {
    const src = read('lib/workspace/promotion-import.ts');
    expect(src).toContain('POSITION_OPTIONS as readonly string[]).includes(item.position)');
    for (const p of HQ_POSITIONS) expect((POSITION_OPTIONS as readonly string[]).includes(p), p).toBe(true);
    expect(read('app/api/workspace/store-promotions/route.ts')).toContain('...POSITION_OPTIONS');
    expect(read('lib/workspace/movement-fields.ts')).toContain('POSITION_OPTIONS as readonly string[]).includes(r.position)');
  });
});

describe('H.5 代理店長自動結束（recompute 規則）', () => {
  it('結束事件：升職為店長、調店、離職、留職停薪；代理與其他升職不結束', () => {
    expect(body(W06, 'workspace_acting_end_event')).toContain("p_type IN('store_transfer','resignation','leave_without_pay') OR (p_type='promotion' AND p_new='店長')");
  });
  it('名冊代理標記：代理之後沒有（依登記先後更晚的）結束事件才標，結束事件所在月份起不標；只標在登記代理的門市', () => {
    const rc = body(W06, 'workspace_roster_recompute');
    expect(rc).toContain('workspace_acting_end_event(e.movement_type,e.new_value)');
    expect(rc).toContain('(e.movement_date,e.created_at,e.id)>(a.movement_date,a.created_at,a.id)');
    expect(rc).toContain("to_char(e.movement_date,'YYYY-MM')<=ym");
    expect(rc).toContain('a.store_id=tgt.sid');
  });
  it('查詢函式 workspace_acting_active 與名冊規則一致，p_store 為 NULL 時不分門市', () => {
    const f = body(W06, 'workspace_acting_active');
    expect(f).toContain('p_store IS NULL OR a.store_id IS NULL OR a.store_id=p_store');
    expect(f).toContain('workspace_acting_end_event(e.movement_type,e.new_value)');
  });
  it('仍可手動取消：月份名冊編輯頁保留代理店長勾選', () => {
    expect(read('vue-workspace/src/pages/MonthlyEdit.vue')).toContain('is_acting_manager');
  });
});

describe('H.9 修改異動姓名同步全部月份（含已鎖定）', () => {
  it('movement_update 的名冊姓名更新不再排除已送審／已確認月份，也不限制起始月份', () => {
    const f = body(C, 'workspace_movement_update');
    const idx = f.indexOf('UPDATE monthly_staff_status s SET employee_name=nm');
    expect(idx).toBeGreaterThan(0);
    const stmt = f.slice(idx, f.indexOf(';', idx));
    expect(stmt).not.toContain('workspace_staff_month_locked');
    expect(stmt).not.toContain('year_month>=');
    expect(stmt).toContain('s.employee_code=m.employee_code');
    expect(C).toContain('H.9');
  });
  it('姓名同步不寫需重新確認（沒有針對 employee_name 的 recheck）', () => {
    const f = body(C, 'workspace_movement_update');
    expect(f).not.toMatch(/workspace_monthly_recheck_add\([^)]*employee_name/);
  });
});

describe('H.3 刪除唯一一筆入職', () => {
  it('員工停用（不刪主檔）、未鎖定月份列移除並留調整紀錄、已鎖定月份列記需重新確認', () => {
    const f = body(C, 'workspace_movement_delete');
    expect(f).toContain("kind='onboarding'");
    expect(f).toContain('NOT EXISTS(SELECT 1 FROM employee_movement_history h WHERE h.employee_code=m.employee_code)');
    expect(f).toContain('workspace_staff_month_locked(rr.store_id,rr.year_month,rr.status)');
    expect(f).toContain('workspace_monthly_recheck_add(p_actor,m.employee_code');
    expect(f).toContain('DELETE FROM monthly_staff_status WHERE id=rr.id');
    expect(f).toContain("UPDATE store_employees SET is_active=false,employment_status='resigned'");
    expect(f).not.toMatch(/DELETE FROM store_employees/);
  });
});

describe('H.4 升職同步員工主檔階段', () => {
  it('刪除升職而退回原職位時階段清空；修改／新增升職都經過同一個主檔同步函式', () => {
    expect(body(C, 'workspace_movement_delete')).toContain('newbie_level=NULL');
    expect(body(C, 'workspace_movement_update')).toContain('workspace_employee_master_position_sync');
    const p02 = read('supabase/workspace-dev/20261106200000_p02_d_batch_transfer.sql');
    expect(body(p02, 'workspace_promotion_save')).toContain('workspace_employee_master_position_sync');
    expect(body(p02, 'workspace_transfer_confirm')).toContain('newbie_level');
  });
});
