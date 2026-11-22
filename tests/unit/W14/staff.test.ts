import { describe, expect, it } from 'vitest';
import { hasManualStaffEdits, rosterToStaff } from '../../../lib/workspace/inspection-staff';

// M4 Q13：自動帶入並換成新門市名單；已有手動修改先確認。
const roster = [
  { employee_code: 'A1', employee_name: '甲', position: '店長' },
  { employee_code: 'A2', employee_name: '乙', position: null },
];
describe('rosterToStaff', () => {
  it('帶入上月在職名單，預設非當班督導、非手動新增，空值補空字串', () => {
    expect(rosterToStaff(roster)).toEqual([
      { employee_code: 'A1', employee_name: '甲', position: '店長', is_duty_supervisor: false, is_manually_added: false },
      { employee_code: 'A2', employee_name: '乙', position: '', is_duty_supervisor: false, is_manually_added: false },
    ]);
  });
});
describe('hasManualStaffEdits', () => {
  const auto = rosterToStaff(roster);
  it('剛自動帶入、沒動過：沒有手動修改，換店直接換', () => {
    expect(hasManualStaffEdits(rosterToStaff(roster), auto)).toBe(false);
  });
  it('空名單：沒有東西會被清掉', () => {
    expect(hasManualStaffEdits([], auto)).toBe(false);
  });
  it('勾了當班督導、手動新增、改名、移除人員：都算手動修改', () => {
    const a = rosterToStaff(roster);
    a[0].is_duty_supervisor = true;
    expect(hasManualStaffEdits(a, auto)).toBe(true);
    const b = [...rosterToStaff(roster), { employee_code: '', employee_name: '丙', position: '', is_duty_supervisor: false, is_manually_added: true }];
    expect(hasManualStaffEdits(b, auto)).toBe(true);
    const c = rosterToStaff(roster);
    c[1].employee_name = '乙乙';
    expect(hasManualStaffEdits(c, auto)).toBe(true);
    expect(hasManualStaffEdits(rosterToStaff(roster).slice(1), auto)).toBe(true);
  });
  it('編輯既有單（沒有自動名單基準）有人員就一律確認', () => {
    expect(hasManualStaffEdits(rosterToStaff(roster), [])).toBe(true);
  });
});
