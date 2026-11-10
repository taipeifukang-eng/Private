import { NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { canAccessEmployeeManagement } from '@/lib/monthly-staff/employee-management-access';
import { loadPositionHeadcountData, YEAR_MONTH_PATTERN } from '@/lib/monthly-staff/position-headcount-data';

export const dynamic = 'force-dynamic';

// GET /api/admin/position-headcount?month=YYYY-MM[&trend=1]
// 唯讀。權限與員工管理頁相同（admin 或擁有 employee.manage），在伺服器端檢查。
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (!(await canAccessEmployeeManagement(user.id, profile))) {
      return NextResponse.json({ success: false, error: '沒有權限' }, { status: 403 });
    }

    const url = new URL(request.url);
    const month = url.searchParams.get('month') || '';
    if (!YEAR_MONTH_PATTERN.test(month)) {
      return NextResponse.json({ success: false, error: '月份格式錯誤，需為 YYYY-MM' }, { status: 400 });
    }
    const trend = url.searchParams.get('trend') === '1';

    const data = await loadPositionHeadcountData(createAdminClient(), month, trend);
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('position-headcount error:', error);
    return NextResponse.json({ success: false, error: '伺服器錯誤' }, { status: 500 });
  }
}
