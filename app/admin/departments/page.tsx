import { redirect } from 'next/navigation';
import OrganizationManagementClient from '@/components/admin/OrganizationManagementClient';
import { createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';
import {
  ORGANIZATION_DEPARTMENT_CREATE_PERMISSION_CODES,
  ORGANIZATION_DEPARTMENT_EDIT_PERMISSION_CODES,
  ORGANIZATION_DEPARTMENT_VIEW_PERMISSION_CODES,
  ORGANIZATION_MANAGER_MANAGE_PERMISSION_CODES,
  ORGANIZATION_MEMBER_MANAGE_PERMISSION_CODES,
} from '@/lib/admin/organization-management';

export const dynamic = 'force-dynamic';

export default async function DepartmentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const [
    canView,
    canCreateDepartment,
    canEditDepartment,
    canManageMembers,
    canManageManagers,
  ] = await Promise.all([
    hasAnyPermission(user.id, ORGANIZATION_DEPARTMENT_VIEW_PERMISSION_CODES),
    hasAnyPermission(user.id, ORGANIZATION_DEPARTMENT_CREATE_PERMISSION_CODES),
    hasAnyPermission(user.id, ORGANIZATION_DEPARTMENT_EDIT_PERMISSION_CODES),
    hasAnyPermission(user.id, ORGANIZATION_MEMBER_MANAGE_PERMISSION_CODES),
    hasAnyPermission(user.id, ORGANIZATION_MANAGER_MANAGE_PERMISSION_CODES),
  ]);

  if (!canView && !canCreateDepartment && !canEditDepartment && !canManageMembers && !canManageManagers) {
    redirect('/dashboard');
  }

  return (
    <OrganizationManagementClient
      mode="departments"
      canCreateDepartment={canCreateDepartment}
      canEditDepartment={canEditDepartment}
      canManageMembers={canManageMembers}
      canManageManagers={canManageManagers}
    />
  );
}
