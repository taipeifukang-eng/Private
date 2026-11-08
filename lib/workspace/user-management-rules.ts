// M5 P06 使用者與角色規則（純函式，無相依；Next 端、Vue 工作台與 Vitest 共用）。
// Q12：「新增使用者」連到公開註冊頁，不再由管理員直接建立。
// Q13：授予管理員前加醒目確認（後端規則不變）。
// Q14：重置密碼維持只有舊式身分為管理員。
// Q15：待開通 = 沒有任何生效角色的有效帳號。

/** 「新增使用者」連到的公開註冊頁（舊版 app/admin/users/page.tsx 的 href）。 */
export const REGISTER_PATH = "/register";

/** 與 lib/workspace/permission-semantics.ts 的 ADMIN_LIKE_ROLE_CODES、lib/admin/user-rbac-view.ts 相同的管理員等級角色代碼。 */
export const ADMIN_LEVEL_ROLE_CODES: readonly string[] = [
  "admin", "system_admin", "full_admin", "full_admin_role", "dev_full_admin", "owner", "owner_role", "admin_role",
];
export const isAdminLevelRoleCode = (code: string | null | undefined) => ADMIN_LEVEL_ROLE_CODES.includes(String(code || ""));

/** 變更相容角色：改成 admin 要確認；其他（含從 admin 降級）不需要。 */
export const compatRoleNeedsAdminConfirm = (current: string | null | undefined, next: string | null | undefined) =>
  next === "admin" && current !== "admin";
/** 把人加進角色：目標角色是管理員等級才需要確認。 */
export const roleAssignmentNeedsAdminConfirm = (role: { code?: string | null } | null | undefined) => isAdminLevelRoleCode(role?.code);

export const ADMIN_GRANT_WARNING = "此人將擁有完整管理權限。管理員可進入並操作系統內所有功能，請確認這是你要的結果。";

type RoleAssignmentLike = { assignment_active?: boolean; is_expired?: boolean };
type UserLike = {
  has_auth?: boolean;
  is_disabled?: boolean;
  is_admin_compatibility?: boolean;
  rbac_roles?: readonly RoleAssignmentLike[] | null;
};
/**
 * 待開通：有登入帳號、沒有被停用、沒有管理員相容身分，且沒有任何生效的角色指派（指派啟用且未到期）。
 * 與正式區 has_permission 一致，不看 roles.is_active。
 */
export function isPendingActivation(user: UserLike): boolean {
  if (user.has_auth === false || user.is_disabled || user.is_admin_compatibility) return false;
  return !(user.rbac_roles || []).some((r) => r.assignment_active === true && !r.is_expired);
}
export const pendingCount = (users: readonly UserLike[]) => users.filter(isPendingActivation).length;

/** 帳號停用：封鎖時間尚未到期才算（Q 差異清單：停用判定改為封鎖時間未到期）。 */
export const isBanActive = (bannedUntil: string | null | undefined, now: number = Date.now()) =>
  !!bannedUntil && Date.parse(bannedUntil) > now;
