import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

const GENERAL_AFFAIRS_SERVICE_ACCESS_PERMISSION = 'general_affairs.service_center.access';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ allowed: false, error: '未登入' }, { status: 401 });
    }

    const allowed = await hasPermission(user.id, GENERAL_AFFAIRS_SERVICE_ACCESS_PERMISSION);

    return NextResponse.json({ allowed });
  } catch (error) {
    console.error('總務服務中心入口權限檢查失敗:', error);
    return NextResponse.json({ allowed: false, error: '權限檢查失敗' }, { status: 500 });
  }
}
