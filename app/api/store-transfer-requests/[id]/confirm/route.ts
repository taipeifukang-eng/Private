import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

function getDaysInMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

function getYearMonth(dateText: string): string {
  return String(dateText || '').slice(0, 7);
}

// POST - 督導確認調店申請，填入生效日期並寫入異動歷程
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const isAdmin = profile?.role === 'admin';
    const canConfirm = await hasPermission(user.id, 'employee.store_transfer.confirm');

    if (!isAdmin && !canConfirm) {
      return NextResponse.json({ success: false, error: '只有督導可以確認調店申請' }, { status: 403 });
    }

    const { effective_date } = await request.json();
    if (!effective_date) {
      return NextResponse.json({ success: false, error: '請填入生效日期' }, { status: 400 });
    }

    // 取得申請記錄
    const { data: req, error: fetchError } = await supabase
      .from('store_transfer_requests')
      .select('*')
      .eq('id', params.id)
      .single();

    if (fetchError || !req) {
      return NextResponse.json({ success: false, error: '找不到此申請記錄' }, { status: 404 });
    }

    if (req.status !== 'pending') {
      return NextResponse.json({ success: false, error: '此申請已被處理，無法重複確認' }, { status: 400 });
    }

    // 非 admin 的督導必須管轄原任職門市或新任職門市其中一個才能確認
    if (!isAdmin) {
      const { data: managedList } = await supabase
        .from('store_managers')
        .select('store_id')
        .eq('user_id', user.id)
        .in('store_id', [req.from_store_id, req.to_store_id]);

      if (!managedList || managedList.length === 0) {
        return NextResponse.json({ success: false, error: '您不是此調店相關門市的督導，無法確認此調店申請' }, { status: 403 });
      }
    }

    // 查詢門市名稱
    const [{ data: fromStore }, { data: toStore }] = await Promise.all([
      supabase.from('stores').select('store_name').eq('id', req.from_store_id).single(),
      supabase.from('stores').select('store_name').eq('id', req.to_store_id).single(),
    ]);

    // 查詢員工目前資料（取得 store_id）
    const { data: empData } = await supabase
      .from('store_employees')
      .select('store_id, position, current_position, employment_status')
      .eq('employee_code', req.employee_code)
      .eq('is_active', true)
      .maybeSingle();

    // 檢查是否有重複異動記錄
    const { data: existingRecord } = await supabase
      .from('employee_movement_history')
      .select('id')
      .eq('employee_code', req.employee_code)
      .eq('movement_date', effective_date)
      .eq('movement_type', 'store_transfer')
      .maybeSingle();

    if (existingRecord) {
      return NextResponse.json({
        success: false,
        error: `此員工（${req.employee_code}）在 ${effective_date} 已存在調店記錄，請確認日期`
      }, { status: 400 });
    }

    // 寫入 employee_movement_history
    const { data: movementRecord, error: movementError } = await supabase
      .from('employee_movement_history')
      .insert({
        employee_code: req.employee_code,
        employee_name: req.employee_name,
        store_id: req.to_store_id,
        movement_type: 'store_transfer',
        movement_date: effective_date,
        old_value: fromStore?.store_name || req.from_store_id,
        new_value: toStore?.store_name || req.to_store_id,
        notes: req.notes || null,
        created_by: user.id,
      })
      .select()
      .single();

    if (movementError) {
      console.error('Error creating movement history:', movementError);
      return NextResponse.json({ success: false, error: movementError.message }, { status: 500 });
    }

    // 更新申請狀態
    const { error: updateError } = await supabase
      .from('store_transfer_requests')
      .update({
        status: 'confirmed',
        confirmed_by: user.id,
        confirmed_at: new Date().toISOString(),
        effective_date,
        movement_history_id: movementRecord.id,
      })
      .eq('id', params.id);

    if (updateError) {
      console.error('Error updating transfer request:', updateError);
      return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
    }

    // 若該員工在生效月份/後續月份的新門市已初始化月資料，則自動補齊人員，避免手動新增
    try {
      const employeeCode = String(req.employee_code || '').toUpperCase();
      const transferYearMonth = getYearMonth(effective_date);
      const transferDay = new Date(effective_date).getDate();

      const { data: initializedMonths } = await supabase
        .from('monthly_staff_status')
        .select('year_month')
        .eq('store_id', req.to_store_id)
        .eq('status', 'draft')
        .gte('year_month', transferYearMonth)
        .order('year_month', { ascending: true });

      const monthList = Array.from(
        new Set((initializedMonths || []).map((m: any) => String(m.year_month || '')))
      ).filter(Boolean);

      if (monthList.length > 0) {
        const { data: targetEmployee } = await supabase
          .from('store_employees')
          .select('user_id, employee_name, current_position, position, employment_type, is_pharmacist, start_date')
          .eq('employee_code', employeeCode)
          .eq('store_id', req.to_store_id)
          .order('last_movement_date', { ascending: false })
          .limit(1)
          .maybeSingle();

        let resolvedStartDate = targetEmployee?.start_date || null;
        if (!resolvedStartDate) {
          const { data: firstOnboarding } = await supabase
            .from('employee_movement_history')
            .select('movement_date')
            .eq('employee_code', employeeCode)
            .eq('movement_type', 'onboarding')
            .order('movement_date', { ascending: true })
            .limit(1)
            .maybeSingle();

          if (firstOnboarding?.movement_date) {
            resolvedStartDate = firstOnboarding.movement_date;
          }
        }

        for (const ym of monthList) {
          const daysInMonth = getDaysInMonth(ym);
          const isEffectiveMonth = ym === transferYearMonth;

          const monthlyStatus = isEffectiveMonth ? 'transferred_in' : 'full_month';
          const workDays = isEffectiveMonth
            ? Math.max(daysInMonth - transferDay + 1, 0)
            : daysInMonth;

          const partialMonthReason = isEffectiveMonth ? '調入店' : null;
          const partialMonthNotes = isEffectiveMonth
            ? `${String(new Date(effective_date).getMonth() + 1).padStart(2, '0')}/${String(transferDay).padStart(2, '0')}自${fromStore?.store_name || req.from_store_id}調入`
            : null;

          const { data: exists } = await supabase
            .from('monthly_staff_status')
            .select('id')
            .eq('year_month', ym)
            .eq('store_id', req.to_store_id)
            .eq('employee_code', employeeCode)
            .maybeSingle();

          if (exists?.id) {
            await supabase
              .from('monthly_staff_status')
              .update({
                monthly_status: monthlyStatus,
                work_days: workDays,
                total_days_in_month: daysInMonth,
                partial_month_reason: partialMonthReason,
                partial_month_notes: partialMonthNotes,
                is_manually_added: false,
                updated_at: new Date().toISOString(),
              })
              .eq('id', exists.id);
            continue;
          }

          await supabase
            .from('monthly_staff_status')
            .insert({
              year_month: ym,
              store_id: req.to_store_id,
              user_id: targetEmployee?.user_id || null,
              employee_code: employeeCode,
              employee_name: req.employee_name || targetEmployee?.employee_name || '',
              position: targetEmployee?.current_position || targetEmployee?.position || '新人',
              employment_type: targetEmployee?.employment_type || 'full_time',
              is_pharmacist: Boolean(targetEmployee?.is_pharmacist),
              start_date: resolvedStartDate,
              monthly_status: monthlyStatus,
              work_days: workDays,
              total_days_in_month: daysInMonth,
              work_hours: targetEmployee?.employment_type === 'part_time' ? 0 : null,
              is_dual_position: false,
              has_manager_bonus: false,
              is_supervisor_rotation: false,
              is_acting_manager: false,
              partial_month_reason: partialMonthReason,
              partial_month_days: null,
              partial_month_notes: partialMonthNotes,
              extra_tasks: null,
              is_manually_added: false,
              status: 'draft',
            });
        }
      }
    } catch (syncError) {
      // 同步失敗不阻斷調店確認主流程
      console.error('Transfer monthly status sync warning:', syncError);
    }

    return NextResponse.json({ success: true, message: `✅ 調店確認完成，已寫入異動歷程（生效日期：${effective_date}）` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
