export const USER_MANAGEMENT_VIEW_PERMISSION_CODES = [
  'user.user.view',
] as const;

export const USER_MANAGEMENT_MUTATION_PERMISSION_CODES = [
  'user.user.create',
  'user.user.edit',
  'user.user.delete',
  'user.user.change_role',
  'role.user_role.assign',
  'role.user_role.revoke',
] as const;

export const USER_MANAGEMENT_NAV_PERMISSION_CODES = [
  ...USER_MANAGEMENT_VIEW_PERMISSION_CODES,
  ...USER_MANAGEMENT_MUTATION_PERMISSION_CODES,
] as const;

export const ROLE_MANAGEMENT_VIEW_PERMISSION_CODES = [
  'role.role.view',
] as const;

export const ROLE_MANAGEMENT_MUTATION_PERMISSION_CODES = [
  'role.role.create',
  'role.role.edit',
  'role.role.delete',
] as const;

export const ROLE_PERMISSION_MANAGEMENT_PERMISSION_CODES = [
  'role.permission.view',
  'role.permission.assign',
] as const;

export const ROLE_USER_MANAGEMENT_PERMISSION_CODES = [
  'role.user_role.view',
  'role.user_role.assign',
  'role.user_role.revoke',
] as const;

export const ROLE_MANAGEMENT_NAV_PERMISSION_CODES = [
  ...ROLE_MANAGEMENT_VIEW_PERMISSION_CODES,
  ...ROLE_MANAGEMENT_MUTATION_PERMISSION_CODES,
  ...ROLE_PERMISSION_MANAGEMENT_PERMISSION_CODES,
  ...ROLE_USER_MANAGEMENT_PERMISSION_CODES,
] as const;

export const ROLE_LIST_PAGE_PERMISSION_CODES = ROLE_MANAGEMENT_NAV_PERMISSION_CODES;

export const ROLE_EDIT_PAGE_PERMISSION_CODES = [
  ...ROLE_MANAGEMENT_MUTATION_PERMISSION_CODES,
  ...ROLE_PERMISSION_MANAGEMENT_PERMISSION_CODES,
  ...ROLE_USER_MANAGEMENT_PERMISSION_CODES,
] as const;

export function hasAnyCode(
  permissionSet: Set<string>,
  permissionCodes: readonly string[]
): boolean {
  return permissionCodes.some((code) => permissionSet.has(code));
}
