import { redirect } from 'next/navigation';
import OrganizationManagementClient from '@/components/admin/OrganizationManagementClient';
import { createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';
import { ORGANIZATION_NAV_PERMISSION_CODES } from '@/lib/admin/organization-management';

export const dynamic = 'force-dynamic';

export default async function CompanyOrganizationPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const canView = await hasAnyPermission(user.id, ORGANIZATION_NAV_PERMISSION_CODES);
  if (!canView) redirect('/dashboard');

  return <OrganizationManagementClient mode="overview" />;
}
