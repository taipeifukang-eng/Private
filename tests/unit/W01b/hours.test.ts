import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { inputMode, monthStatusAdvice, plannedExtraTaskHours, PARTIAL_MONTH_POSSIBLE_REASONS } from '../../../lib/monthly-staff/hours';
import { isSupervisorActingManagerDual, savedWorkDays } from '../../../lib/monthly-staff/block';

// W01b：時數自動換算對照舊版公式（app/monthly-status/edit/[id]/page.tsx「自動計算該店規劃實上時數」useEffect，逐字抄錄）。
type Args = Parameters<typeof plannedExtraTaskHours>[0];

function legacyPlannedHours(a: { position: string; employmentType: string; monthlyStatus: string; workDays: number; workHours: number; isDualPosition: boolean }): number | null {
  let calculatedHours = 0;
  if (a.position === '督導(代理店長)' || (a.position.includes('督導') && a.position.includes('代理店長') && a.isDualPosition)) {
    calculatedHours = a.workHours || 0;
  } else if (a.employmentType === 'full_time' && a.monthlyStatus === 'full_month') {
    calculatedHours = 160;
  } else if (a.employmentType === 'full_time' && a.monthlyStatus !== 'full_month' && a.workDays > 0) {
    calculatedHours = Math.round((a.workDays / 5 * 32) * 10) / 10;
  }
  return calculatedHours || null; // 舊版儲存時 extraTaskPlannedHours || null
}

const POSITIONS = ['專員', '店長', '督導', '督導(代理店長)', '督導(店長)', '區經理(代理店長)', '助理'];
const STATUSES = ['full_month', 'new_hire', 'resigned', 'leave_of_absence'];
const DAYS = [0, 0.5, 1, 7, 10, 15.5, 22, 29, 30, 31];
const HOURS = [0, 8, 80, 160, 163.5];

describe('plannedExtraTaskHours 對照舊版公式', () => {
  it('案例：雙職督導(代理店長) → 工作時數；正職整月 → 160；正職 10 天 → 64；兼職 → null', () => {
    const base = { position: '專員', employment_type: 'full_time', is_dual_position: false, monthly_status: 'full_month', work_days: 30, work_hours: 0 } satisfies Args;
    expect(plannedExtraTaskHours({ ...base, position: '督導(代理店長)', is_dual_position: true, work_hours: 120 })).toBe(120);
    expect(plannedExtraTaskHours(base)).toBe(160);
    expect(plannedExtraTaskHours({ ...base, monthly_status: 'new_hire', work_days: 10 })).toBe(64);
    expect(plannedExtraTaskHours({ ...base, employment_type: 'part_time', work_hours: 50 })).toBeNull();
    expect(plannedExtraTaskHours({ ...base, monthly_status: 'new_hire', work_days: 0 })).toBeNull();
  });
  it('四捨五入到小數 1 位：7 天 → 44.8；15.5 天 → 99.2；22 天 → 140.8', () => {
    const base = { position: '專員', employment_type: 'full_time', is_dual_position: false, monthly_status: 'resigned', work_days: 7, work_hours: 0 } satisfies Args;
    expect(plannedExtraTaskHours(base)).toBe(44.8);
    expect(plannedExtraTaskHours({ ...base, work_days: 15.5 })).toBe(99.2);
    expect(plannedExtraTaskHours({ ...base, work_days: 22 })).toBe(140.8);
  });
  it('全組合與舊版公式逐一相同（誤差 0）', () => {
    let count = 0;
    for (const position of POSITIONS)
      for (const employmentType of ['full_time', 'part_time'])
        for (const monthlyStatus of STATUSES)
          for (const isDual of [false, true])
            for (const workDays of DAYS)
              for (const workHours of HOURS) {
                const expected = legacyPlannedHours({ position, employmentType, monthlyStatus, workDays, workHours, isDualPosition: isDual });
                const actual = plannedExtraTaskHours({ position, employment_type: employmentType, is_dual_position: isDual, monthly_status: monthlyStatus, work_days: workDays, work_hours: workHours });
                expect(actual, JSON.stringify({ position, employmentType, monthlyStatus, isDual, workDays, workHours })).toBe(expected);
                count += 1;
              }
    expect(count).toBe(POSITIONS.length * 2 * STATUSES.length * 2 * DAYS.length * HOURS.length);
  });
  it('空白字串與 null 當 0', () => {
    expect(plannedExtraTaskHours({ position: '專員', employment_type: 'full_time', is_dual_position: false, monthly_status: 'resigned', work_days: '', work_hours: null })).toBeNull();
  });
});

describe('inputMode', () => {
  it('督導(代理店長)-雙 與兼職填時數；其餘正職填天數', () => {
    expect(inputMode('督導(代理店長)', 'full_time', true)).toBe('hours');
    expect(inputMode('督導(代理店長)', 'full_time', false)).toBe('days');
    expect(inputMode('專員', 'part_time', false)).toBe('hours');
    expect(inputMode('專員', 'full_time', false)).toBe('days');
    expect(inputMode('店長', 'full_time', true)).toBe('days');
  });
  it('isSupervisorActingManagerDual 與 savedWorkDays（與 API 儲存規則一致）', () => {
    expect(isSupervisorActingManagerDual('督導(代理店長)', true)).toBe(true);
    expect(isSupervisorActingManagerDual('督導', true)).toBe(false);
    expect(savedWorkDays({ position: '專員', employment_type: 'full_time', is_dual_position: false, work_days: 12 })).toBe(12);
    expect(savedWorkDays({ position: '專員', employment_type: 'part_time', is_dual_position: false, work_days: 12 })).toBeNull();
    expect(savedWorkDays({ position: '督導(代理店長)', employment_type: 'full_time', is_dual_position: true, work_days: 12 })).toBeNull();
    expect(savedWorkDays({ position: '專員', employment_type: 'full_time', is_dual_position: false, work_days: '' })).toBe(0);
  });
});

describe('monthStatusAdvice（W01b-q3）', () => {
  const total = 31;
  it('天數等於當月天數 → 自動設整月在職', () => {
    expect(monthStatusAdvice({ employment_type: 'full_time', monthly_status: 'new_hire', work_days: 31, total_days_in_month: total })).toEqual({ autoSet: 'full_month', needsConfirm: false });
    expect(monthStatusAdvice({ employment_type: 'full_time', monthly_status: 'full_month', work_days: 31, total_days_in_month: total })).toEqual({ autoSet: null, needsConfirm: false });
  });
  it('不滿月：不自動改（舊版會把整月改成新進），只提示請確認本月狀態', () => {
    expect(monthStatusAdvice({ employment_type: 'full_time', monthly_status: 'full_month', work_days: 20, total_days_in_month: total })).toEqual({ autoSet: null, needsConfirm: true });
    expect(monthStatusAdvice({ employment_type: 'full_time', monthly_status: 'resigned', work_days: 20, total_days_in_month: total })).toEqual({ autoSet: null, needsConfirm: true });
  });
  it('0 天、兼職、沒有總天數：不提示', () => {
    expect(monthStatusAdvice({ employment_type: 'full_time', monthly_status: 'full_month', work_days: 0, total_days_in_month: total }).needsConfirm).toBe(false);
    expect(monthStatusAdvice({ employment_type: 'part_time', monthly_status: 'full_month', work_days: 10, total_days_in_month: total })).toEqual({ autoSet: null, needsConfirm: false });
    expect(monthStatusAdvice({ employment_type: 'full_time', monthly_status: 'full_month', work_days: 10, total_days_in_month: undefined })).toEqual({ autoSet: null, needsConfirm: false });
  });
  it('列出的可能原因：新進、調店、留職停薪、復職、離職', () => {
    expect([...PARTIAL_MONTH_POSSIBLE_REASONS]).toEqual(['新進', '調店', '留職停薪', '復職', '離職']);
  });
});

describe('API 與 Vue 引用同一份計算', () => {
  const root = path.resolve(__dirname, '..', '..', '..');
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
  it('workspace/monthly route 的規劃時數用 plannedExtraTaskHours，不再自己寫公式', () => {
    const route = read('app/api/workspace/monthly/route.ts');
    expect(route).toContain('plannedExtraTaskHours');
    expect(route).toContain('isSupervisorActingManagerDual');
    expect(route).not.toMatch(/\/ 5\) \* 32/);
  });
  it('MonthlyEdit.vue 引用共用模組（區塊預覽、時數、升階提醒、規則表）', () => {
    const vue = read('vue-workspace/src/pages/MonthlyEdit.vue');
    for (const name of ['previewBonusBlock', 'plannedExtraTaskHours', 'monthStatusAdvice', 'newbiePromotionPrompt', 'canDoMonthlyAction', 'lib/monthly-staff/block', 'lib/monthly-staff/hours', 'lib/monthly-staff/newbie'])
      expect(vue, name).toContain(name);
  });
});
