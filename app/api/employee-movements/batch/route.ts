import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';

type MovementType = 'promotion' | 'leave_without_pay' | 'return_to_work' | 'pass_probation' | 'resignation';

interface MovementInput {
  employee_code: string;
  employee_name: string;
  movement_type: MovementType;
  position?: string; // 僅升職時需要
  effective_date: string;
  notes?: string;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // 檢查權限
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    // 使用 RBAC 權限檢查
    const permission = await requirePermission(user.id, 'employee.promotion.batch');
    if (!permission.allowed) {
      return NextResponse.json(
        { success: false, error: permission.message },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { movements } = body as { movements: MovementInput[] };

    if (!movements || movements.length === 0) {
      return NextResponse.json({ success: false, error: '缺少異動資料' }, { status: 400 });
    }

    // 驗證所有資料
    for (const movement of movements) {
      if (!movement.employee_code || !movement.employee_name || !movement.movement_type || !movement.effective_date) {
        return NextResponse.json({ 
          success: false, 
          error: `員工 ${movement.employee_code || movement.employee_name} 資料不完整` 
        }, { status: 400 });
      }

      // 如果是升職，必須提供職位
      if (movement.movement_type === 'promotion' && !movement.position) {
        return NextResponse.json({ 
          success: false, 
          error: `員工 ${movement.employee_code} 升職需要指定職位` 
        }, { status: 400 });
      }
    }

    // 為每筆記錄準備資料
    const movementRecords = [];
    
    for (const movement of movements) {
      // 檢查是否已存在相同的異動記錄（同員工、同日期、同異動類型）
      const { data: existingRecord } = await supabase
        .from('employee_movement_history')
        .select('id')
        .eq('employee_code', movement.employee_code.toUpperCase())
        .eq('movement_date', movement.effective_date)
        .eq('movement_type', movement.movement_type)
        .maybeSingle();

      if (existingRecord) {
        console.log(`跳過重複記錄: ${movement.employee_code} - ${movement.effective_date} - ${movement.movement_type}`);
        continue; // 跳過重複記錄
      }

      // 查詢員工的當前資料
      const { data: empData } = await supabase
        .from('store_employees')
        .select('position, current_position, store_id, employment_status')
        .eq('employee_code', movement.employee_code.toUpperCase())
        .eq('is_active', true)
        .single();

      let oldValue = null;
      let newValue = null;

      // 根據異動類型設定新舊值
      if (movement.movement_type === 'promotion') {
        oldValue = empData?.current_position || empData?.position || null;
        newValue = movement.position;
      } else if (movement.movement_type === 'leave_without_pay') {
        oldValue = empData?.employment_status || 'active';
        newValue = 'leave_without_pay';
      } else if (movement.movement_type === 'return_to_work') {
        oldValue = empData?.employment_status || 'leave_without_pay';
        newValue = 'active';
      } else if (movement.movement_type === 'resignation') {
        oldValue = empData?.employment_status || 'active';
        newValue = 'resigned';
      }

      movementRecords.push({
        employee_code: movement.employee_code.toUpperCase(),
        employee_name: movement.employee_name,
        store_id: empData?.store_id || null,
        movement_type: movement.movement_type,
        movement_date: movement.effective_date,
        new_value: newValue,
        old_value: oldValue,
        notes: movement.notes || null,
        created_by: user.id
      });
    }

    // 如果所有記錄都是重複的
    if (movementRecords.length === 0) {
      return NextResponse.json({
        success: false,
        error: '所有異動記錄均已存在，沒有新增任何記錄'
      }, { status: 400 });
    }

    // 批次插入異動記錄
    const { data, error } = await supabase
      .from('employee_movement_history')
      .insert(movementRecords)
      .select();

    if (error) {
      console.error('Error creating movement records:', error);
      return NextResponse.json({ 
        success: false, 
        error: error.message 
      }, { status: 500 });
    }

    // 觸發器會自動處理相關更新

    const skippedCount = movements.length - data.length;
    const message = skippedCount > 0 
      ? `成功建立 ${data.length} 筆異動記錄（跳過 ${skippedCount} 筆重複記錄），已自動更新員工狀態`
      : `成功建立 ${data.length} 筆異動記錄，已自動更新員工狀態`;

    return NextResponse.json({
      success: true,
      created: data.length,
      skipped: skippedCount,
      message
    });

  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '處理失敗' },
      { status: 500 }
    );
  }
}
