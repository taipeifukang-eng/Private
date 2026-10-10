import { NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions/check';
import { ORGANIZATION_CALENDAR_GOOGLE_MANAGE_PERMISSION } from '@/lib/admin/organization-calendar';
import { revokeGoogleCalendarConnection } from '@/lib/organization/google-calendar';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });
    if (!(await hasPermission(user.id, ORGANIZATION_CALENDAR_GOOGLE_MANAGE_PERMISSION))) {
      return NextResponse.json({ error: '沒有管理 Google 行事曆同步的權限' }, { status: 403 });
    }
    await revokeGoogleCalendarConnection();
    return NextResponse.json({ disconnected: true });
  } catch (error: any) {
    console.error('解除 Google 行事曆連結失敗:', error);
    return NextResponse.json({ error: error.message || '解除連結失敗' }, { status: 500 });
  }
}
