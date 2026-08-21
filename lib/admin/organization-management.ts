export const ORGANIZATION_VIEW_PERMISSION_CODES = [
  'organization.organization.view',
  'organization.department.view',
] as const;

export const ORGANIZATION_DEPARTMENT_VIEW_PERMISSION_CODES = [
  'organization.department.view',
] as const;

export const ORGANIZATION_DEPARTMENT_CREATE_PERMISSION_CODES = [
  'organization.department.create',
] as const;

export const ORGANIZATION_DEPARTMENT_EDIT_PERMISSION_CODES = [
  'organization.department.edit',
] as const;

export const ORGANIZATION_DEPARTMENT_WORKSPACE_VIEW_PERMISSION_CODES = [
  'organization.department_workspace.view',
  'organization.department.view',
] as const;

export const ORGANIZATION_DEPARTMENT_WORKSPACE_MANAGE_PERMISSION_CODES = [
  'organization.department_workspace.manage',
  'organization.department.edit',
] as const;

export const ORGANIZATION_MEMBER_VIEW_PERMISSION_CODES = [
  'organization.member.view',
  'organization.member.manage',
] as const;

export const ORGANIZATION_MEMBER_MANAGE_PERMISSION_CODES = [
  'organization.member.manage',
] as const;

export const ORGANIZATION_MANAGER_VIEW_PERMISSION_CODES = [
  'organization.manager.view',
  'organization.manager.manage',
] as const;

export const ORGANIZATION_MANAGER_MANAGE_PERMISSION_CODES = [
  'organization.manager.manage',
] as const;

export const ORGANIZATION_NAV_PERMISSION_CODES = [
  ...ORGANIZATION_VIEW_PERMISSION_CODES,
  ...ORGANIZATION_DEPARTMENT_WORKSPACE_VIEW_PERMISSION_CODES,
  ...ORGANIZATION_DEPARTMENT_CREATE_PERMISSION_CODES,
  ...ORGANIZATION_DEPARTMENT_EDIT_PERMISSION_CODES,
  ...ORGANIZATION_MEMBER_VIEW_PERMISSION_CODES,
  ...ORGANIZATION_MANAGER_VIEW_PERMISSION_CODES,
] as const;

export const ORGANIZATION_MUTATION_PERMISSION_CODES = [
  ...ORGANIZATION_DEPARTMENT_CREATE_PERMISSION_CODES,
  ...ORGANIZATION_DEPARTMENT_EDIT_PERMISSION_CODES,
  ...ORGANIZATION_DEPARTMENT_WORKSPACE_MANAGE_PERMISSION_CODES,
  ...ORGANIZATION_MEMBER_MANAGE_PERMISSION_CODES,
  ...ORGANIZATION_MANAGER_MANAGE_PERMISSION_CODES,
] as const;

export type OrganizationUnitType = 'company' | 'headquarters' | 'department' | 'team';
export type OrganizationStatus = 'active' | 'inactive';
export type OrganizationManagerRole = 'manager' | 'deputy_manager' | 'acting_manager';
