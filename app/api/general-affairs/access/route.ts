import { NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';

const GENERAL_AFFAIRS_SERVICE_ACCESS_PERMISSION = 'general_affairs.service_center.access';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ allowed: false, error: '未登入' }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from('user_roles')
      .select(`
        is_active,
        expires_at,
        role:roles!inner (
          role_permissions!inner (
            is_allowed,
            permission:permissions!inner (code)
          )
        )
      `)
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (error) throw error;

    const now = Date.now();
    const allowed = (data || []).some((userRole: any) => {
      const expiresAt = userRole.expires_at ? new Date(userRole.expires_at).getTime() : null;
      const notExpired = expiresAt === null || expiresAt > now;
      if (!notExpired) return false;

      return userRole.role?.role_permissions?.some((rolePermission: any) =>
        rolePermission.is_allowed &&
        rolePermission.permission?.code === GENERAL_AFFAIRS_SERVICE_ACCESS_PERMISSION
      );
    });

    return NextResponse.json({ allowed });
  } catch (error) {
    console.error('總務服務中心入口權限檢查失敗:', error);
    return NextResponse.json({ allowed: false, error: '權限檢查失敗' }, { status: 500 });
  }
}
