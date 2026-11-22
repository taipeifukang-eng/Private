import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { buildSupportHoursResponse } from '@/lib/workspace/support-hours-export';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const yearMonth = searchParams.get('year_month');

    if (!yearMonth) {
      return NextResponse.json(
        { success: false, error: '缺少年月參數' },
        { status: 400 }
      );
    }

    const supabase = createClient();

    // 權限檢查
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: '未登入' },
        { status: 401 }
      );
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    // 權限：admin 或營業部的 manager
    const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '');
    const isBusinessManager = profile?.department?.startsWith('營業') && profile?.role === 'manager' && !needsAssignment;
    const isAdmin = ['admin', 'supervisor', 'area_manager'].includes(profile?.role || '');
    
    if (!profile || (!isAdmin && !isBusinessManager)) {
      return NextResponse.json(
        { success: false, error: '權限不足' },
        { status: 403 }
      );
    }

    return await buildSupportHoursResponse(supabase, yearMonth);

  } catch (error) {
    console.error('Export support hours error:', error);
    return NextResponse.json(
      { success: false, error: '匯出失敗' },
      { status: 500 }
    );
  }
}
