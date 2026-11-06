import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkEmployeeId, employmentTypeForEmployeeId, EMPLOYMENT_TYPE_BY_CODE_LABEL } from '../../../lib/workspace/employee-id-rule';
import { employeeDirectory } from '../../../lib/workspace/employee-directory';

// W05 單元層（M2 規格 H.2、H.8、H.4）：每月人員狀態手動新增員編必填、類型依員編；員工主檔階段欄位與回填／比對 SQL。

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const fn = (text: string, name: string) => {
  const start = text.indexOf('FUNCTION public.' + name + '(');
  expect(start, '找不到函式 ' + name).toBeGreaterThanOrEqual(0);
  const end = text.indexOf('\n$$;', start);
  return text.slice(start, end > 0 ? end : text.indexOf('$$;', start + 10));
};

describe('H.2 每月手動新增：員編必填且符合 E.1', () => {
  it('空白、FKI、格式錯誤都被擋；合法格式通過（前後空白與大小寫先正規化）', () => {
    for (const bad of ['', '   ', undefined, null, 'FKI001', 'FK12', 'FKF1234', 'ABCDEFG', 'FKPT12']) expect(checkEmployeeId(bad).ok, String(bad)).toBe(false);
    const blank = checkEmployeeId('');
    expect(blank.ok === false && blank.reason).toBe('empty');
    expect(checkEmployeeId(' fk1234 ')).toEqual({ ok: true, code: 'FK1234' });
    expect(checkEmployeeId('FKF12345').ok).toBe(true);
    expect(checkEmployeeId('FKPT123').ok).toBe(true);
  });
  it('API：員編必填（不再有留空例外），畫面欄位為必填', () => {
    const api = read('app/api/workspace/monthly/tools/route.ts');
    expect(api).toContain('const employeeId = checkEmployeeId(d.employee_code); if (!employeeId.ok) throw new WorkspaceError(400,employeeId.message);');
    expect(api).not.toContain('留空維持舊版行為');
    const vue = read('vue-workspace/src/components/MonthlyTools.vue');
    expect(vue).toMatch(/員工代號<input v-model="form.employee_code" required/);
    expect(vue).not.toContain('可留空');
    expect(vue).toContain('checkEmployeeId(form.value.employee_code)');
  });
  it('資料庫守衛：手動新增列沒有合法員編就拒絕（含空白）', () => {
    const f = fn(read('supabase/workspace-dev/20261105200000_w05_employee_id_rule.sql'), 'workspace_guard_manual_staff_code');
    expect(f).toContain('coalesce(NEW.is_manually_added,false)');
    expect(f).toContain('NOT workspace_employee_id_valid(NEW.employee_code)');
    expect(f).not.toContain("nullif(btrim(coalesce(NEW.employee_code,'')),'') IS NOT NULL");
  });
});

describe('H.8 每月手動新增：類型依員編，不再讓人選', () => {
  it('FKPT 開頭兼職、其餘正職；顯示文字「兼職（依員編）」', () => {
    expect(employmentTypeForEmployeeId('FKPT007')).toBe('part_time');
    expect(employmentTypeForEmployeeId('fk1234')).toBe('full_time');
    expect(employmentTypeForEmployeeId('FKF12345')).toBe('full_time');
    expect(EMPLOYMENT_TYPE_BY_CODE_LABEL).toBe('兼職（依員編）');
  });
  it('API 忽略送來的類型、一律依員編；畫面不再有正職／兼職下拉', () => {
    const api = read('app/api/workspace/monthly/tools/route.ts');
    expect(api).toContain('employment_type:employmentTypeForEmployeeId(employeeId.code)');
    expect(api).not.toContain("['full_time','part_time'].includes(d.employment_type)");
    const vue = read('vue-workspace/src/components/MonthlyTools.vue');
    expect(vue).not.toMatch(/<label>僱用類型<select/);
    expect(vue).toContain('manual-employment-type');
    expect(vue).toContain('EMPLOYMENT_TYPE_BY_CODE_LABEL');
  });
  it('資料庫守衛：手動新增列的 employment_type 由員編決定', () => {
    const f = fn(read('supabase/workspace-dev/20261105200000_w05_employee_id_rule.sql'), 'workspace_guard_manual_staff_code');
    expect(f).toContain('NEW.employment_type:=workspace_employee_id_type(NEW.employee_code)');
  });
  it('新增員工與員工匯入維持依員編判斷（E.3）', () => {
    expect(read('supabase/workspace-dev/20261105200000_w05_employee_id_rule.sql')).toContain('kind:=workspace_employee_id_type(code)');
    expect(read('supabase/workspace-dev/20261105200000_w05_employee_id_rule.sql')).toContain("workspace_employee_id_type(r->>'employee_code')");
  });
});

describe('H.4 員工主檔階段', () => {
  const master = (o: Record<string, unknown>) => ({ employee_code: 'FK0001', employee_name: '甲', start_date: null, birthday: null, current_position: '新人', is_active: true, employment_status: 'active', last_movement_date: null, ...o });
  it('員工清單帶出主檔階段；職位不是新人／行政時不顯示階段', () => {
    const a = employeeDirectory([master({ newbie_level: '一階新人' })], [], []);
    expect(a[0].newbie_level).toBe('一階新人');
    const b = employeeDirectory([master({ current_position: '專員', newbie_level: '一階新人' })], [], []);
    expect(b[0].newbie_level).toBeNull();
    const c = employeeDirectory([master({ current_position: '行政', newbie_level: '過階行政' })], [], []);
    expect(c[0].newbie_level).toBe('過階行政');
    const d = employeeDirectory([master({ newbie_level: null })], [], []);
    expect(d[0].newbie_level).toBeNull();
  });
  it('列表與編輯畫面顯示階段（編輯為唯讀）', () => {
    expect(read('vue-workspace/src/pages/Employees.vue')).toContain('employee-stage');
    const edit = read('vue-workspace/src/components/EmployeeEdit.vue');
    expect(edit).toContain('employee-edit-stage');
    expect(edit).toMatch(/<input :value="detail\.employee\.newbie_level\|\|'—'" readonly/);
    expect(read('app/api/workspace/employees/route.ts')).toContain('newbie_level');
  });
  it('SQL：欄位冪等新增、升職同步一併更新階段、員工編輯改成其他職位時清空階段', () => {
    const m2h = read('supabase/workspace-dev/20261107100000_m2h_stage_and_transfer_confirm.sql');
    expect(m2h).toContain('ALTER TABLE public.store_employees ADD COLUMN IF NOT EXISTS newbie_level varchar(20)');
    const sync = fn(read('supabase/workspace-dev/20261106100000_w06_roster_recompute.sql'), 'workspace_employee_master_position_sync');
    expect(sync).toContain("newbie_level=CASE WHEN r.pos IN('新人','行政') THEN r.lvl END");
    const edit = read('supabase/workspace-dev/20261105200100_w05_employee_edit_recheck.sql');
    expect(edit).toContain("newbie_level=CASE WHEN new_pos IN('新人','行政') AND current_position IS NOT DISTINCT FROM new_pos THEN newbie_level ELSE NULL END");
    const rb = read('supabase/workspace-dev/20261107100000_m2h_stage_and_transfer_confirm.rollback.sql');
    expect(rb).toContain('DROP COLUMN IF EXISTS newbie_level');
  });
  it('回填 SQL：DEV 與正式區檔案用同一段 UPDATE；只填空值、不覆蓋既有階段', () => {
    const grab = (t: string) => t.slice(t.indexOf('-- BACKFILL-BEGIN'), t.indexOf('-- BACKFILL-END'));
    const dev = grab(read('supabase/workspace-dev/20261107100000_m2h_stage_and_transfer_confirm.sql'));
    const prodFile = read('docs/vue-workspace/parity-plan/m2-sql/backfill_employee_stage.sql');
    const prod = grab(prodFile);
    expect(dev.length).toBeGreaterThan(500);
    expect(prod).toBe(dev);
    expect(dev).toContain('WHERE e.id = p.id AND e.newbie_level IS NULL AND p.lvl IS NOT NULL');
    expect(prodFile).toContain('ADD COLUMN IF NOT EXISTS newbie_level');
    expect(prodFile).toContain('ROLLBACK');
    // 正式區檔案只動 store_employees.newbie_level（唯一的 UPDATE），不刪資料
    expect((prodFile.match(/^UPDATE /gm) || []).length).toBe(1);
    expect(prodFile).not.toMatch(/\bDELETE\b|\bDROP TABLE\b|\bTRUNCATE\b/i);
  });
  it('check_position_mismatch.sql：職位比對維持唯讀，新增階段比對（唯讀）', () => {
    const sql = read('docs/vue-workspace/parity-plan/m2-sql/check_position_mismatch.sql');
    expect(sql).toContain('第二段：階段比對');
    expect(sql).toContain('e.newbie_level IS DISTINCT FROM l.stage');
    expect(sql).toContain('stage_mismatch_kind');
    expect(sql).not.toMatch(/^\s*(UPDATE|INSERT|DELETE|ALTER|DROP)\b/im);
  });
});
