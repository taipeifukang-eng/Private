/**
 * 員工管理的進入條件（伺服器端判斷）：
 *   - profiles.role === 'admin' 一律可進；
 *   - 其他人只看權限碼 employee.manage（與導覽列「員工管理」選單用的是同一個權限碼）。
 * 舊的「部門開頭營業＋身分 member/manager＋職稱非督導/店長類」條件已拿掉，
 * 否則會出現選單看得到、點進去卻被導回 /dashboard 的狀況。
 *
 * 套用的入口：員工管理頁、每月人數統計 API、門市詳情的員工管理頁（透過 /api/admin/employee-management/access）。
 * 權限檢查走 lib/permissions/check.ts 的 hasPermission（底層 rpc has_permission）；
 * RPC 出錯或例外時 hasPermission 會記 log 並回傳 false，所以錯誤一律視為沒有權限，不會變成放行。
 */
import { hasPermission } from '@/lib/permissions/check';

export const EMPLOYEE_MANAGEMENT_PERMISSION = 'employee.manage';

export interface EmployeeManagementProfile {
  role?: string | null;
}

export async function canAccessEmployeeManagement(
  userId: string | null | undefined,
  profile: EmployeeManagementProfile | null | undefined,
): Promise<boolean> {
  if (!userId) return false;
  if (profile?.role === 'admin') return true;
  try {
    return (await hasPermission(userId, EMPLOYEE_MANAGEMENT_PERMISSION)) === true;
  } catch (error) {
    console.error('員工管理權限檢查異常:', error);
    return false;
  }
}
