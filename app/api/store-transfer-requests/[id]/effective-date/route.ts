import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 2000 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function daysInMonth(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const admin = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const [{ data: profile }, canConfirm] = await Promise.all([
      supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
      hasPermission(user.id, 'employee.store_transfer.confirm'),
    ]);
    const isAdmin = profile?.role === 'admin';
    if (!isAdmin && !canConfirm) {
      return NextResponse.json({ success: false, error: '沒有調店確認權限' }, { status: 403 });
    }

    const body = await request.json();
    const effectiveDate = String(body.effective_date || '').trim();
    const reason = String(body.reason || '').trim();
    if (!isValidDate(effectiveDate)) {
      return NextResponse.json({ success: false, error: '生效日期格式錯誤，年份須為 2000 至 2100' }, { status: 400 });
    }
    if (!reason) return NextResponse.json({ success: false, error: '請填寫更正原因' }, { status: 400 });

    const { data: transfer } = await admin
      .from('store_transfer_requests')
      .select('*')
      .eq('id', params.id)
      .maybeSingle();
    if (!transfer) return NextResponse.json({ success: false, error: '找不到調店申請' }, { status: 404 });
    if (transfer.status !== 'confirmed' || !transfer.effective_date || !transfer.movement_history_id) {
      return NextResponse.json({ success: false, error: '只有已確認且具備異動紀錄的申請可以更正' }, { status: 400 });
    }
    if (transfer.effective_date === effectiveDate) {
      return NextResponse.json({ success: false, error: '新日期與目前生效日期相同' }, { status: 400 });
    }

    if (!isAdmin) {
      const { data: managed } = await supabase
        .from('store_managers')
        .select('store_id')
        .eq('user_id', user.id)
        .in('store_id', [transfer.from_store_id, transfer.to_store_id]);
      if (!managed?.length) {
        return NextResponse.json({ success: false, error: '您不是此調店相關據點的督導' }, { status: 403 });
      }
    }

    const oldYearMonth = String(transfer.effective_date).slice(0, 7);
    const newYearMonth = effectiveDate.slice(0, 7);
    const affectedStart = oldYearMonth < newYearMonth ? oldYearMonth : newYearMonth;
    const affectedEnd = oldYearMonth > newYearMonth ? oldYearMonth : newYearMonth;
    const employeeCode = String(transfer.employee_code).toUpperCase();

    const { data: lockedRows } = await admin
      .from('monthly_staff_status')
      .select('id')
      .eq('employee_code', employeeCode)
      .in('store_id', [transfer.from_store_id, transfer.to_store_id])
      .gte('year_month', affectedStart)
      .lte('year_month', affectedEnd)
      .eq('status', 'confirmed')
      .limit(1);
    if (lockedRows?.length) {
      return NextResponse.json({ success: false, error: '受影響月份已有確認結案的人員狀態，請先解除該月份確認後再更正' }, { status: 409 });
    }

    const { data: duplicate } = await admin
      .from('employee_movement_history')
      .select('id')
      .eq('employee_code', employeeCode)
      .eq('movement_type', 'store_transfer')
      .eq('movement_date', effectiveDate)
      .neq('id', transfer.movement_history_id)
      .maybeSingle();
    if (duplicate) {
      return NextResponse.json({ success: false, error: '該員工在新日期已有調店異動紀錄' }, { status: 409 });
    }

    const [{ data: fromStore }, { data: toStore }] = await Promise.all([
      admin.from('stores').select('store_name').eq('id', transfer.from_store_id).maybeSingle(),
      admin.from('stores').select('store_name').eq('id', transfer.to_store_id).maybeSingle(),
    ]);
    const correctionText = `生效日更正 ${transfer.effective_date} → ${effectiveDate}（${reason}）`;
    const oldMovementNotes = String(transfer.notes || '').trim();

    const { error: movementError } = await admin
      .from('employee_movement_history')
      .update({
        movement_date: effectiveDate,
        notes: [oldMovementNotes, correctionText].filter(Boolean).join('；'),
      })
      .eq('id', transfer.movement_history_id);
    if (movementError) throw movementError;

    const { error: transferError } = await admin
      .from('store_transfer_requests')
      .update({
        effective_date: effectiveDate,
        corrected_at: new Date().toISOString(),
        corrected_by: user.id,
        correction_reason: reason,
      })
      .eq('id', transfer.id);
    if (transferError) throw transferError;

    // 清除原生效月的調出／調入標記，再依新日期重算。
    const oldDays = daysInMonth(oldYearMonth);
    await admin.from('monthly_staff_status').update({
      monthly_status: 'full_month', work_days: oldDays, total_days_in_month: oldDays,
      partial_month_reason: null, partial_month_notes: null, updated_at: new Date().toISOString(),
    }).eq('employee_code', employeeCode).eq('store_id', transfer.from_store_id)
      .eq('year_month', oldYearMonth).eq('monthly_status', 'transferred_out').neq('status', 'confirmed');

    await admin.from('monthly_staff_status').update({
      monthly_status: 'full_month', work_days: oldDays, total_days_in_month: oldDays,
      partial_month_reason: null, partial_month_notes: null, updated_at: new Date().toISOString(),
    }).eq('employee_code', employeeCode).eq('store_id', transfer.to_store_id)
      .eq('year_month', oldYearMonth).eq('monthly_status', 'transferred_in').neq('status', 'confirmed');

    const [, month, day] = effectiveDate.split('-').map(Number);
    const monthDay = `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
    const newDays = daysInMonth(newYearMonth);
    await admin.from('monthly_staff_status').update({
      monthly_status: 'transferred_out', work_days: Math.max(day - 1, 0), total_days_in_month: newDays,
      partial_month_reason: '調出店',
      partial_month_notes: `${monthDay}調出至${toStore?.store_name || transfer.to_store_id}`,
      is_manually_added: false, updated_at: new Date().toISOString(),
    }).eq('employee_code', employeeCode).eq('store_id', transfer.from_store_id)
      .eq('year_month', newYearMonth).neq('status', 'confirmed');

    await admin.from('monthly_staff_status').update({
      monthly_status: 'transferred_in', work_days: Math.max(newDays - day + 1, 0), total_days_in_month: newDays,
      partial_month_reason: '調入店',
      partial_month_notes: `${monthDay}自${fromStore?.store_name || transfer.from_store_id}調入`,
      is_manually_added: false, updated_at: new Date().toISOString(),
    }).eq('employee_code', employeeCode).eq('store_id', transfer.to_store_id)
      .eq('year_month', newYearMonth).neq('status', 'confirmed');

    const { data: destinationRecord } = await admin
      .from('monthly_staff_status')
      .select('id')
      .eq('employee_code', employeeCode)
      .eq('store_id', transfer.to_store_id)
      .eq('year_month', newYearMonth)
      .maybeSingle();

    if (!destinationRecord) {
      const [{ data: initializedMonth }, { data: employee }] = await Promise.all([
        admin.from('monthly_staff_status').select('id').eq('store_id', transfer.to_store_id).eq('year_month', newYearMonth).limit(1).maybeSingle(),
        admin.from('store_employees')
          .select('user_id, employee_name, current_position, position, employment_type, is_pharmacist, start_date')
          .eq('employee_code', employeeCode)
          .eq('store_id', transfer.to_store_id)
          .order('last_movement_date', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (initializedMonth) {
        const { error: insertError } = await admin.from('monthly_staff_status').insert({
          year_month: newYearMonth,
          store_id: transfer.to_store_id,
          user_id: employee?.user_id || null,
          employee_code: employeeCode,
          employee_name: transfer.employee_name || employee?.employee_name || '',
          position: employee?.current_position || employee?.position || '',
          employment_type: employee?.employment_type || 'full_time',
          is_pharmacist: Boolean(employee?.is_pharmacist),
          start_date: employee?.start_date || null,
          monthly_status: 'transferred_in',
          work_days: Math.max(newDays - day + 1, 0),
          total_days_in_month: newDays,
          work_hours: employee?.employment_type === 'part_time' ? 0 : null,
          is_dual_position: false,
          has_manager_bonus: false,
          is_supervisor_rotation: false,
          is_acting_manager: false,
          partial_month_reason: '調入店',
          partial_month_days: null,
          partial_month_notes: `${monthDay}自${fromStore?.store_name || transfer.from_store_id}調入`,
          extra_tasks: null,
          is_manually_added: false,
          status: 'draft',
        });
        if (insertError) throw insertError;
      }
    }

    return NextResponse.json({ success: true, message: `生效日期已更正為 ${effectiveDate}` });
  } catch (error: any) {
    console.error('Correct store transfer effective date error:', error);
    return NextResponse.json({ success: false, error: error.message || '更正失敗' }, { status: 500 });
  }
}
