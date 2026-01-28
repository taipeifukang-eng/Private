import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET: 查詢指定門市和年月的員工列表（用於誤餐費登記）
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const yearMonth = searchParams.get('year_month');
    const storeId = searchParams.get('store_id');

    if (!yearMonth || !storeId) {
      return NextResponse.json({ 
        success: false, 
        error: '缺少必要參數' 
      }, { status: 400 });
    }

    // 查詢當月該門市的所有員工
    const { data: staff, error } = await supabase
      .from('monthly_staff_status')
      .select('employee_code, employee_name, is_pharmacist')
      .eq('year_month', yearMonth)
      .eq('store_id', storeId)
      .order('employee_code', { ascending: true, nullsFirst: false })
      .order('employee_name', { ascending: true });

    if (error) {
      console.error('Error fetching employees:', error);
      return NextResponse.json({ 
        success: false, 
        error: error.message 
      }, { status: 500 });
    }

    // 去重（同一個員工可能有多筆記錄）
    const uniqueEmployees = Array.from(
      new Map(
        staff.map(emp => [
          emp.employee_code || emp.employee_name, 
          {
            employee_code: emp.employee_code,
            employee_name: emp.employee_name,
            is_pharmacist: emp.is_pharmacist
          }
        ])
      ).values()
    );

    return NextResponse.json({ 
      success: true, 
      employees: uniqueEmployees 
    });

  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}
