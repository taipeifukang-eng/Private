import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // 檢查權限
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const staffStatusId = searchParams.get('staff_status_id');

    if (!staffStatusId) {
      return NextResponse.json({ success: false, error: '缺少員工狀態ID' }, { status: 400 });
    }

    // 獲取該員工的業績明細
    const { data, error } = await supabase
      .from('monthly_performance_details')
      .select('*')
      .eq('staff_status_id', staffStatusId)
      .order('store_code');

    if (error) {
      console.error('Error fetching performance details:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: data || []
    });

  } catch (error: any) {
    console.error('Get performance details error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '獲取失敗' },
      { status: 500 }
    );
  }
}
