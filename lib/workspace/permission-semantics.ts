/**
 * Vue 工作台 context() 的權限解析（純函式，可單元測試）。
 *
 * 對齊「舊版在正式區的實際判斷」：
 *  - permissions（對應正式區 DB 的 has_permission）：
 *      user_roles.is_active AND (expires_at IS NULL OR expires_at > NOW())
 *      AND role_permissions.is_allowed AND permissions.is_active
 *    不檢查 roles.is_active；DB 端沒有 admin 繞過，所以 admin 角色也只有明確授權的碼。
 *  - isAdmin（對應舊版 lib/permissions/check.ts 的 isAdminLikeUser 應用層保底）：
 *      profiles.role === 'admin'，或持有有效（未過期）的管理員類角色；同樣不檢查 roles.is_active。
 *    舊版 hasPermission() 對 isAdmin 的人任何權限碼都回 true。
 */
export const ADMIN_LIKE_ROLE_CODES: readonly string[] = [
  "admin",
  "system_admin",
  "full_admin",
  "full_admin_role",
  "dev_full_admin",
  "owner",
  "owner_role",
  "admin_role",
];

const one = (value: any) => (Array.isArray(value) ? value[0] : value);

export type RoleAssignment = {
  is_active?: boolean | null;
  expires_at?: string | null;
  role?: any;
};

export function resolveAccess(
  assignments: RoleAssignment[] | null | undefined,
  profileRole: string | null | undefined,
  now: number = Date.now(),
) {
  const permissions = new Set<string>();
  const roleCodes = new Set<string>();
  let isAdmin = profileRole === "admin";
  for (const assignment of assignments || []) {
    // user_roles.is_active（查詢端已篩，這裡再保險一次）與到期時間：與正式區 has_permission 相同。
    if (assignment.is_active === false) continue;
    if (assignment.expires_at && Date.parse(assignment.expires_at) <= now)
      continue;
    const role = one(assignment.role);
    if (!role) continue;
    // 刻意不檢查 roles.is_active：正式區 has_permission 與舊版 isAdminLikeUser 都不檢查。
    if (role.code) {
      roleCodes.add(role.code);
      if (ADMIN_LIKE_ROLE_CODES.includes(role.code)) isAdmin = true;
    }
    for (const rp of role.role_permissions || []) {
      const p = one(rp.permission);
      if (rp.is_allowed && p?.is_active && p.code) permissions.add(p.code);
    }
  }
  return {
    permissions,
    roleCodes,
    isAdmin,
    has: (...codes: string[]) =>
      isAdmin || codes.some((code) => permissions.has(code)),
  };
}
