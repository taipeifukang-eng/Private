import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * 查詢指定月份的交通費用
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
    const store_id = searchParams.get('store_id');

    if (!year_month || !store_id) {
      return NextResponse.json({ error: '缺少必要參數' }, { status: 400 });
    }

    // 查詢該月份該門市有交通費用的員工
    const { data: records, error } = await supabase
      .from('monthly_staff_status')
      .select('id, employee_code, employee_name, monthly_transport_expense, transport_expense_notes')
      .eq('year_month', year_month)
      .eq('store_id', store_id)
      .not('monthly_transport_expense', 'is', null)
      .gt('monthly_transport_expense', 0)
      .order('employee_code');

    if (error) {
      console.error('Query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 轉換為前端需要的格式
    const formattedRecords = (records || []).map(r => ({
      id: r.id,
      employee_code: r.employee_code,
      employee_name: r.employee_name,
      transport_expense: r.monthly_transport_expense,
      expense_notes: r.transport_expense_notes || ''
    }));

    return NextResponse.json({
      success: true,
      records: formattedRecords
    });

  } catch (error: any) {
    console.error('Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || '查詢失敗' 
    }, { status: 500 });
  }
}
