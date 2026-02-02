import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * 獲取所有在職員工列表（用於下拉選單）
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    // 獲取所有在職員工
    const { data: employees, error } = await supabase
      .from('store_employees')
      .select('employee_code, employee_name')
      .eq('is_active', true)
      .order('employee_code');

    if (error) {
      console.error('Query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      employees: employees || []
    });

  } catch (error: any) {
    console.error('Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || '查詢失敗' 
    }, { status: 500 });
  }
}
