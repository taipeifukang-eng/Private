/**
 * 員工管理頁的進入條件（與 app/admin/employee-management/page.tsx 原有判斷完全相同，抽出共用）：
 * admin、營業部助理、營業部主管。每月人數統計 API 也用同一個函式在伺服器端檢查。
 */
export interface EmployeeManagementProfile {
  role?: string | null;
  department?: string | null;
  job_title?: string | null;
}

export function canViewEmployeeManagement(profile: EmployeeManagementProfile | null | undefined): boolean {
  if (!profile) return false;
  // 需要指派門市的職位不算營業部助理/主管
  const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile.job_title || '');
  const isBusinessAssistant = profile.department?.startsWith('營業') && profile.role === 'member' && !needsAssignment;
  const isBusinessSupervisor = profile.department?.startsWith('營業') && profile.role === 'manager' && !needsAssignment;
  return profile.role === 'admin' || Boolean(isBusinessAssistant) || Boolean(isBusinessSupervisor);
}
