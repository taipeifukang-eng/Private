import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';

/**
 * 刪除人員異動歷史記錄
 * DELETE /api/employee-movements/[id]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: '未登入' },
        { status: 401 }
      );
    }

    // 檢查權限
    const permission = await requirePermission(user.id, 'employee.promotion.delete');
    if (!permission.allowed) {
      return NextResponse.json(
        { success: false, error: '權限不足，無法刪除人員異動記錄' },
        { status: 403 }
      );
    }

    // 檢查記錄是否存在
    const { data: movement, error: fetchError } = await supabase
      .from('employee_movement_history')
      .select('id, employee_code, employee_name, movement_type, movement_date')
      .eq('id', params.id)
      .single();

    if (fetchError || !movement) {
      return NextResponse.json(
        { success: false, error: '找不到該異動記錄' },
        { status: 404 }
      );
    }

    // 刪除記錄
    const { error: deleteError } = await supabase
      .from('employee_movement_history')
      .delete()
      .eq('id', params.id);

    if (deleteError) {
      console.error('Error deleting movement record:', deleteError);
      return NextResponse.json(
        { success: false, error: deleteError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `已刪除 ${movement.employee_name} (${movement.employee_code}) 的異動記錄`
    });

  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '刪除失敗' },
      { status: 500 }
    );
  }
}
