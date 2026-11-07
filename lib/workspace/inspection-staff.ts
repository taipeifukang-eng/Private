/** M4 Q13：當班人員自動帶入／換店確認。純函式。 */
export type DutyStaff = {
  employee_code: string;
  employee_name: string;
  position: string;
  is_duty_supervisor: boolean;
  is_manually_added: boolean;
};
export type RosterRow = {
  employee_code?: string | null;
  employee_name?: string | null;
  position?: string | null;
};
export const rosterToStaff = (roster: RosterRow[]): DutyStaff[] =>
  roster.map((s) => ({
    employee_code: s.employee_code || "",
    employee_name: s.employee_name || "",
    position: s.position || "",
    is_duty_supervisor: false,
    is_manually_added: false,
  }));
/** 已有手動修改＝有手動新增的人、勾了當班督導，或自動帶入的資料被改過（員編／姓名／職位與名冊不同或被移除）。 */
export function hasManualStaffEdits(staff: DutyStaff[], autoRoster: DutyStaff[]): boolean {
  if (staff.length === 0) return false;
  if (staff.some((s) => s.is_manually_added || s.is_duty_supervisor)) return true;
  if (staff.length !== autoRoster.length) return true;
  const key = (s: DutyStaff) => [s.employee_code, s.employee_name, s.position].join("\u0001");
  const a = staff.map(key).sort();
  const b = autoRoster.map(key).sort();
  return a.some((v, i) => v !== b[i]);
}
