import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * 查詢指定月份的支援人員獎金
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const year_month = searchParams.get('year_month');

    if (!year_month) {
      return NextResponse.json({ error: '缺少 year_month 參數' }, { status: 400 });
    }

    // 查詢該月份的支援人員獎金
    const { data: records, error } = await supabase
      .from('support_staff_bonus')
      .select('*')
      .eq('year_month', year_month)
      .order('employee_code');

    if (error) {
      console.error('Query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      records: records || []
    });

  } catch (error: any) {
    console.error('Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || '查詢失敗' 
    }, { status: 500 });
  }
}
