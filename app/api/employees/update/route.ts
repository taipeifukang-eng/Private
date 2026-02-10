import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // 檢查權限
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    // 使用 RBAC 權限檢查
    const permission = await requirePermission(user.id, 'employee.employee.edit');
    if (!permission.allowed) {
      return NextResponse.json(
        { success: false, error: permission.message },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { employee_code, employee_name, current_position, start_date } = body;

    if (!employee_code || !employee_name) {
      return NextResponse.json({ success: false, error: '缺少必填欄位' }, { status: 400 });
    }

    // 更新 store_employees 的基本資料
    const { error: storeEmpError } = await supabase
      .from('store_employees')
      .update({
        employee_name: employee_name.trim(),
        start_date: start_date || null,
        position: current_position || null,
        current_position: current_position || null
      })
      .eq('employee_code', employee_code.toUpperCase());

    if (storeEmpError) {
      console.error('Error updating store_employees:', storeEmpError);
    }

    // 如果有更新職位，則更新所有 monthly_staff_status 的職位
    if (current_position) {
      const { error: monthlyError } = await supabase
        .from('monthly_staff_status')
        .update({
          position: current_position,
          name: employee_name.trim()
        })
        .eq('employee_code', employee_code.toUpperCase());

      if (monthlyError) {
        console.error('Error updating monthly_staff_status:', monthlyError);
      }
    } else {
      // 如果只更新姓名
      const { error: monthlyError } = await supabase
        .from('monthly_staff_status')
        .update({
          name: employee_name.trim()
        })
        .eq('employee_code', employee_code.toUpperCase());

      if (monthlyError) {
        console.error('Error updating monthly_staff_status name:', monthlyError);
      }
    }

    return NextResponse.json({
      success: true,
      message: '更新員工資料成功'
    });

  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '處理失敗' },
      { status: 500 }
    );
  }
}
