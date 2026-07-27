import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission, requirePermission } from '@/lib/permissions/check';
import {
  syncEmployeePromotionTimelineToMonthlyStaffStatus,
  syncMovementEmployeeNameToMonthlyStaffStatus,
} from '@/lib/monthly-staff/promotion-position-sync';

function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizePromotionPosition(position: string, newbieLevel?: string | null) {
  const rawPosition = String(position || '').trim();
  const rawLevel = String(newbieLevel || '').trim();

  if (rawPosition === '行政(過階)' || rawLevel === '過階行政') {
    return { position: '行政', newbieLevel: '過階行政' };
  }

  if (rawPosition === '行政(未過階)' || rawLevel === '未過階行政') {
    return { position: '行政', newbieLevel: '未過階行政' };
  }

  return { position: rawPosition, newbieLevel: rawLevel || null };
}

function mergePromotionLevelNote(notes: string | null, position: string, newbieLevel: string | null) {
  const baseNotes = String(notes || '')
    .split('；')
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith('行政階級:') && !part.startsWith('新人等級:'));

  if (position === '行政' && newbieLevel) {
    baseNotes.push(`行政階級:${newbieLevel}`);
  }

  if (position === '新人' && newbieLevel) {
    baseNotes.push(`新人等級:${newbieLevel}`);
  }

  return baseNotes.length > 0 ? baseNotes.join('；') : null;
}

function getEarlierDate(a: string, b: string) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

async function canManageMovements(userId: string) {
  return (
    await hasPermission(userId, 'employee.movement.manage') ||
    await hasPermission(userId, 'employee.manage') ||
    await hasPermission(userId, 'employee.promotion.batch')
  );
}

/**
 * 編輯人員異動歷史記錄
 * PATCH /api/employee-movements/[id]
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const adminSupabase = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: '未登入' },
        { status: 401 }
      );
    }

    if (!(await canManageMovements(user.id))) {
      return NextResponse.json(
        { success: false, error: '權限不足，無法編輯人員異動記錄' },
        { status: 403 }
      );
    }

    const { data: movement, error: fetchError } = await adminSupabase
      .from('employee_movement_history')
      .select('id, employee_code, employee_name, store_id, movement_type, movement_date, new_value, old_value, notes, onboarding_is_pharmacist')
      .eq('id', params.id)
      .maybeSingle();

    if (fetchError || !movement) {
      return NextResponse.json(
        { success: false, error: '找不到該異動記錄' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const employeeName = String(body.employee_name ?? movement.employee_name ?? '').trim();
    const movementDate = String(body.movement_date ?? movement.movement_date ?? '').trim();
    const notes = String(body.notes ?? '').trim() || null;

    if (!employeeName) {
      return NextResponse.json(
        { success: false, error: '請填寫姓名' },
        { status: 400 }
      );
    }

    if (!isValidDate(movementDate)) {
      return NextResponse.json(
        { success: false, error: '生效日期格式錯誤，請使用 YYYY-MM-DD' },
        { status: 400 }
      );
    }

    let newValue = movement.new_value;
    let normalizedNotes = notes;

    if (movement.movement_type === 'promotion') {
      const normalizedPromotion = normalizePromotionPosition(
        String(body.new_value ?? body.position ?? movement.new_value ?? ''),
        body.newbie_level
      );

      if (!normalizedPromotion.position) {
        return NextResponse.json(
          { success: false, error: '升職異動必須填寫新職位' },
          { status: 400 }
        );
      }

      if (normalizedPromotion.position === '新人' && !normalizedPromotion.newbieLevel) {
        return NextResponse.json(
          { success: false, error: '升職為新人時必須填寫新人等級' },
          { status: 400 }
        );
      }

      if (normalizedPromotion.position === '行政' && !normalizedPromotion.newbieLevel) {
        return NextResponse.json(
          { success: false, error: '升職為行政時必須填寫行政階級' },
          { status: 400 }
        );
      }

      newValue = normalizedPromotion.position;
      normalizedNotes = mergePromotionLevelNote(notes, normalizedPromotion.position, normalizedPromotion.newbieLevel);
    }

    const { data: duplicate } = await adminSupabase
      .from('employee_movement_history')
      .select('id')
      .eq('employee_code', String(movement.employee_code).toUpperCase())
      .eq('movement_date', movementDate)
      .eq('movement_type', movement.movement_type)
      .neq('id', params.id)
      .maybeSingle();

    if (duplicate) {
      return NextResponse.json(
        { success: false, error: '同員工、同日期、同異動類型的紀錄已存在' },
        { status: 409 }
      );
    }

    const { data: updated, error: updateError } = await adminSupabase
      .from('employee_movement_history')
      .update({
        employee_name: employeeName,
        movement_date: movementDate,
        new_value: newValue,
        notes: normalizedNotes,
        onboarding_is_pharmacist: typeof body.onboarding_is_pharmacist === 'boolean'
          ? body.onboarding_is_pharmacist
          : movement.onboarding_is_pharmacist,
      })
      .eq('id', params.id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating movement record:', updateError);
      return NextResponse.json(
        { success: false, error: updateError.message },
        { status: 500 }
      );
    }

    const affectedFromDate = getEarlierDate(String(movement.movement_date), movementDate);

    if (employeeName !== movement.employee_name) {
      const { error: employeeUpdateError } = await adminSupabase
        .from('store_employees')
        .update({
          employee_name: employeeName,
          updated_at: new Date().toISOString(),
        })
        .eq('employee_code', String(movement.employee_code).toUpperCase());

      if (employeeUpdateError) {
        return NextResponse.json(
          { success: false, error: `同步員工主檔姓名失敗：${employeeUpdateError.message}` },
          { status: 500 }
        );
      }

      await syncMovementEmployeeNameToMonthlyStaffStatus(
        adminSupabase,
        movement.employee_code,
        employeeName,
        affectedFromDate
      );
    }

    if (movement.movement_type === 'promotion') {
      await syncEmployeePromotionTimelineToMonthlyStaffStatus(
        adminSupabase,
        movement.employee_code,
        affectedFromDate
      );
    }

    return NextResponse.json({
      success: true,
      data: updated,
      message: movement.movement_type === 'promotion'
        ? '已更新升職異動，並同步重算生效月份後的月度職位'
        : '已更新人員異動記錄'
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '編輯失敗' },
      { status: 500 }
    );
  }
}

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
