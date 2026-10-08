import { redirect } from 'next/navigation';
import OrganizationCalendarClient from '@/components/organization/OrganizationCalendarClient';
import { hasPermission } from '@/lib/permissions/check';
import {
  ORGANIZATION_CALENDAR_COMPANY_CREATE_PERMISSION,
  ORGANIZATION_CALENDAR_COMPANY_EDIT_PERMISSION,
  ORGANIZATION_CALENDAR_HOLIDAY_MANAGE_PERMISSION,
} from '@/lib/admin/organization-calendar';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function OrganizationCalendarPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const [canCreateCompanyEvents, canEditCompanyEvents, canManageHolidays] = await Promise.all([
    hasPermission(user.id, ORGANIZATION_CALENDAR_COMPANY_CREATE_PERMISSION),
    hasPermission(user.id, ORGANIZATION_CALENDAR_COMPANY_EDIT_PERMISSION),
    hasPermission(user.id, ORGANIZATION_CALENDAR_HOLIDAY_MANAGE_PERMISSION),
  ]);

  return (
    <OrganizationCalendarClient
      currentUserId={user.id}
      canCreateCompanyEvents={canCreateCompanyEvents}
      canEditCompanyEvents={canEditCompanyEvents}
      canManageHolidays={canManageHolidays}
    />
  );
}
