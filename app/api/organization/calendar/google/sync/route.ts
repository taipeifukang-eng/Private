import { NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions/check';
import { ORGANIZATION_CALENDAR_GOOGLE_MANAGE_PERMISSION } from '@/lib/admin/organization-calendar';
import { syncCompanyCalendarSnapshot } from '@/lib/organization/google-calendar';
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
    const result = await syncCompanyCalendarSnapshot();
    return NextResponse.json(result, { status: result.status === 'failed' ? 502 : 200 });
  } catch (error: any) {
    console.error('同步 Google 公司行事曆失敗:', error);
    return NextResponse.json({ error: error.message || '同步失敗' }, { status: 500 });
  }
}
