import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';
import { ORGANIZATION_NAV_PERMISSION_CODES } from '@/lib/admin/organization-management';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const canViewOrganization = await hasAnyPermission(user.id, ORGANIZATION_NAV_PERMISSION_CODES);
    if (!canViewOrganization) return NextResponse.json({ error: '權限不足' }, { status: 403 });

    const query = (request.nextUrl.searchParams.get('q') || '').trim().toLowerCase();
    const adminSupabase = createAdminClient();
    const { data, error } = await adminSupabase
      .from('profiles')
      .select('id, email, full_name, employee_code, department, job_title')
      .order('employee_code', { ascending: true });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const users = (data || [])
      .filter((profile: any) => {
        if (!query) return true;
        return [
          profile.email,
          profile.full_name,
          profile.employee_code,
          profile.department,
          profile.job_title,
        ].some(value => String(value || '').toLowerCase().includes(query));
      })
      .slice(0, 80);

    return NextResponse.json({ users }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    console.error('搜尋組織人員失敗:', error);
    return NextResponse.json({ error: error.message || '搜尋組織人員失敗' }, { status: 500 });
  }
}
