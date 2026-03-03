import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * 獲取所有員工列表（包含離職員工及手動新增員工，用於下拉選單及獎金模組）
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    // 來源 1：正式員工（store_employees）
    const { data: storeEmployees, error: storeError } = await supabase
      .from('store_employees')
      .select('employee_code, employee_name, position, start_date')
      .order('employee_code');

    if (storeError) {
      console.error('store_employees query error:', storeError);
      return NextResponse.json({ error: storeError.message }, { status: 500 });
    }

    // 來源 2：手動新增的員工（monthly_staff_status，is_manually_added = true）
    // 抓取所有有員編的手動新增員工，依員編去重後和正式員工合併
    const { data: manualRows, error: manualError } = await supabase
      .from('monthly_staff_status')
      .select('employee_code, employee_name, position')
      .eq('is_manually_added', true)
      .not('employee_code', 'is', null);

    if (manualError) {
      console.error('monthly_staff_status manual query error:', manualError);
      // 不中斷，僅使用 store_employees 結果
    }

    // 以正式員工為基底，補入手動新增中不存在於正式員工的員編
    const codeSet = new Set((storeEmployees || []).map((e: any) => e.employee_code));
    const manualUnique: any[] = [];
    const seenManual = new Set<string>();
    for (const row of (manualRows || [])) {
      if (!row.employee_code) continue;
      const code = row.employee_code.toUpperCase();
      if (!codeSet.has(code) && !seenManual.has(code)) {
        seenManual.add(code);
        manualUnique.push({
          employee_code: row.employee_code,
          employee_name: row.employee_name,
          position: row.position,
          start_date: null,
        });
      }
    }

    const employees = [
      ...(storeEmployees || []),
      ...manualUnique,
    ].sort((a, b) => (a.employee_code || '').localeCompare(b.employee_code || ''));

    return NextResponse.json({
      success: true,
      employees,
    });

  } catch (error: any) {
    console.error('Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || '查詢失敗' 
    }, { status: 500 });
  }
}
