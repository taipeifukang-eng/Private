import { hasAnyPermission, hasPermission } from '@/lib/permissions/check';

export const SUPERVISOR_MANAGEMENT_LOG_VIEW_PERMISSIONS = [
  'supervisor.management_log.view_own',
  'supervisor.management_log.view_team',
  'supervisor.management_log.create',
  'supervisor.management_log.update_own',
  'supervisor.management_log.follow_up',
  'supervisor.management_log.manage',
] as const;

export const SUPERVISOR_MANAGEMENT_LOG_CREATE_PERMISSIONS = [
  'supervisor.management_log.create',
  'supervisor.management_log.manage',
] as const;

export const SUPERVISOR_MANAGEMENT_LOG_UPDATE_PERMISSIONS = [
  'supervisor.management_log.update_own',
  'supervisor.management_log.follow_up',
  'supervisor.management_log.manage',
] as const;

export async function canViewSupervisorManagementLog(userId: string) {
  return hasAnyPermission(userId, SUPERVISOR_MANAGEMENT_LOG_VIEW_PERMISSIONS);
}

export async function canCreateSupervisorManagementLog(userId: string) {
  return hasAnyPermission(userId, SUPERVISOR_MANAGEMENT_LOG_CREATE_PERMISSIONS);
}

export async function canUpdateSupervisorManagementLog(userId: string) {
  return hasAnyPermission(userId, SUPERVISOR_MANAGEMENT_LOG_UPDATE_PERMISSIONS);
}

export async function canManageSupervisorManagementLog(userId: string) {
  return hasPermission(userId, 'supervisor.management_log.manage');
}

export async function canWriteSupervisorManagementDailyPlan(userId: string) {
  return hasAnyPermission(userId, [
    'supervisor.management_log.create',
    'supervisor.management_log.update_own',
    'supervisor.management_log.follow_up',
    'supervisor.management_log.manage',
  ]);
}
