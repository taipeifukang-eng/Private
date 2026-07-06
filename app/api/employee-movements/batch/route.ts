import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/permissions/check';

type MovementType = 'onboarding' | 'promotion' | 'leave_without_pay' | 'return_to_work' | 'pass_probation' | 'resignation' | 'store_transfer';

interface MovementInput {
  employee_code: string;
  employee_name: string;
  movement_type: MovementType;
  store_id?: string; // 任職門市（入職時必填）
  onboarding_is_pharmacist?: boolean; // 入職時是否為藥師
  birthday?: string; // 入職時必填生日
  position?: string; // 僅升職時需要
  newbie_level?: string; // 升職為新人/行政時的階級
  effective_date: string;
  notes?: string;
  from_store_id?: string; // 調店：原任職門市
  to_store_id?: string;   // 調店：新任職門市
}

function normalizePromotionPosition(position?: string, newbieLevel?: string) {
  const rawPosition = String(position || '').trim();
  const rawLevel = String(newbieLevel || '').trim();

  if (rawPosition === '行政(過階)' || rawLevel === '過階行政') {
    return { position: '行政', newbie_level: '過階行政' };
  }

  if (rawPosition === '行政(未過階)' || rawLevel === '未過階行政') {
    return { position: '行政', newbie_level: '未過階行政' };
  }

  return { position: rawPosition, newbie_level: rawLevel };
}

function getYearMonth(date: string) {
  return String(date || '').slice(0, 7);
}

function getDaysInMonth(yearMonth: string) {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

async function syncStoreTransferMonthlyStatus(
  adminSupabase: ReturnType<typeof createAdminClient>,
  movement: MovementInput
) {
  if (movement.movement_type !== 'store_transfer' || !movement.from_store_id || !movement.to_store_id) {
    return;
  }

  const employeeCode = movement.employee_code.toUpperCase();
  const transferYearMonth = getYearMonth(movement.effective_date);
  const transferDate = new Date(movement.effective_date);
  const transferDay = transferDate.getDate();
  const mmdd = `${String(transferDate.getMonth() + 1).padStart(2, '0')}/${String(transferDay).padStart(2, '0')}`;

  const [{ data: fromStore }, { data: toStore }] = await Promise.all([
    adminSupabase.from('stores').select('store_name').eq('id', movement.from_store_id).maybeSingle(),
    adminSupabase.from('stores').select('store_name').eq('id', movement.to_store_id).maybeSingle(),
  ]);

  const { data: fromMonthRecord } = await adminSupabase
    .from('monthly_staff_status')
    .select('id, status')
    .eq('year_month', transferYearMonth)
    .eq('store_id', movement.from_store_id)
    .eq('employee_code', employeeCode)
    .maybeSingle();

  if (fromMonthRecord?.id && fromMonthRecord.status !== 'confirmed') {
    const daysInMonth = getDaysInMonth(transferYearMonth);
    await adminSupabase
      .from('monthly_staff_status')
      .update({
        monthly_status: 'transferred_out',
        work_days: Math.max(transferDay - 1, 0),
        total_days_in_month: daysInMonth,
        partial_month_reason: '調出店',
        partial_month_notes: `${mmdd}調出至${toStore?.store_name || movement.to_store_id}`,
        is_manually_added: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', fromMonthRecord.id);
  }

  const { data: initializedMonths } = await adminSupabase
    .from('monthly_staff_status')
    .select('year_month')
    .eq('store_id', movement.to_store_id)
    .gte('year_month', transferYearMonth)
    .order('year_month', { ascending: true });

  const monthList = Array.from(
    new Set((initializedMonths || []).map((m: any) => String(m.year_month || '')))
  ).filter(Boolean);

  if (monthList.length === 0) {
    return;
  }

  const { data: targetEmployee } = await adminSupabase
    .from('store_employees')
    .select('user_id, employee_name, current_position, position, employment_type, is_pharmacist, start_date')
    .eq('employee_code', employeeCode)
    .eq('store_id', movement.to_store_id)
    .order('last_movement_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  let resolvedStartDate = targetEmployee?.start_date || null;
  if (!resolvedStartDate) {
    const { data: firstOnboarding } = await adminSupabase
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
    const workDays = isEffectiveMonth ? Math.max(daysInMonth - transferDay + 1, 0) : daysInMonth;
    const partialMonthReason = isEffectiveMonth ? '調入店' : null;
    const partialMonthNotes = isEffectiveMonth
      ? `${mmdd}自${fromStore?.store_name || movement.from_store_id}調入`
      : null;

    const { data: exists } = await adminSupabase
      .from('monthly_staff_status')
      .select('id, status')
      .eq('year_month', ym)
      .eq('store_id', movement.to_store_id)
      .eq('employee_code', employeeCode)
      .maybeSingle();

    if (exists?.status === 'confirmed') {
      continue;
    }

    if (exists?.id) {
      await adminSupabase
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

    await adminSupabase
      .from('monthly_staff_status')
      .insert({
        year_month: ym,
        store_id: movement.to_store_id,
        user_id: targetEmployee?.user_id || null,
        employee_code: employeeCode,
        employee_name: movement.employee_name || targetEmployee?.employee_name || '',
        position: targetEmployee?.current_position || targetEmployee?.position || '',
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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const adminSupabase = createAdminClient();
    
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
      const normalizedPromotion = movement.movement_type === 'promotion'
        ? normalizePromotionPosition(movement.position, movement.newbie_level)
        : null;

      if (movement.movement_type === 'promotion' && !normalizedPromotion?.position) {
        return NextResponse.json({ 
          success: false, 
          error: `員工 ${movement.employee_code} 升職需要指定職位` 
        }, { status: 400 });
      }

      if (
        movement.movement_type === 'promotion' &&
        normalizedPromotion?.position === '新人' &&
        !normalizedPromotion.newbie_level
      ) {
        return NextResponse.json({
          success: false,
          error: `員工 ${movement.employee_code} 升職為新人需要指定新人等級`
        }, { status: 400 });
      }

      if (
        movement.movement_type === 'promotion' &&
        normalizedPromotion?.position === '行政' &&
        !normalizedPromotion.newbie_level
      ) {
        return NextResponse.json({
          success: false,
          error: `員工 ${movement.employee_code} 升職為行政需要指定行政(過階)或行政(未過階)`
        }, { status: 400 });
      }

      // 如果是入職，必須提供生日
      if (movement.movement_type === 'onboarding') {
        const birthday = String(movement.birthday || '').trim();
        if (!birthday) {
          return NextResponse.json({
            success: false,
            error: `員工 ${movement.employee_code} 入職需要填寫生日`
          }, { status: 400 });
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) {
          return NextResponse.json({
            success: false,
            error: `員工 ${movement.employee_code} 生日格式錯誤，請使用 YYYY-MM-DD`
          }, { status: 400 });
        }
      }

      // 如果是調店，必須提供原任職門市和新任職門市
      if (movement.movement_type === 'store_transfer') {
        if (!movement.from_store_id || !movement.to_store_id) {
          return NextResponse.json({ 
            success: false, 
            error: `員工 ${movement.employee_code} 調店需要指定原任職門市和新任職門市` 
          }, { status: 400 });
        }
        if (movement.from_store_id === movement.to_store_id) {
          return NextResponse.json({ 
            success: false, 
            error: `員工 ${movement.employee_code} 調店的原任職門市和新任職門市不能相同` 
          }, { status: 400 });
        }
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
        const normalizedPromotion = normalizePromotionPosition(movement.position, movement.newbie_level);
        oldValue = empData?.current_position || empData?.position || null;
        newValue = normalizedPromotion.position;
        movement.position = normalizedPromotion.position;
        movement.newbie_level = normalizedPromotion.newbie_level;
      } else if (movement.movement_type === 'store_transfer') {
        // 調店：查詢原門市名稱和新門市名稱
        const { data: fromStore } = await supabase
          .from('stores')
          .select('store_name')
          .eq('id', movement.from_store_id)
          .single();
        const { data: toStore } = await supabase
          .from('stores')
          .select('store_name')
          .eq('id', movement.to_store_id)
          .single();
        oldValue = fromStore?.store_name || movement.from_store_id || null;
        newValue = toStore?.store_name || movement.to_store_id || null;
      } else if (movement.movement_type === 'onboarding') {
        oldValue = null;
        newValue = 'active';
      } else if (movement.movement_type === 'leave_without_pay') {
        oldValue = empData?.employment_status || 'active';
        newValue = 'leave_without_pay';
      } else if (movement.movement_type === 'return_to_work') {
        oldValue = empData?.employment_status || 'leave_without_pay';
        newValue = 'active';
      } else if (movement.movement_type === 'resignation') {
        oldValue = empData?.employment_status || 'active';
        newValue = 'resigned';
      } else if (movement.movement_type === 'pass_probation') {
        oldValue = empData?.current_position || empData?.position || null;
        newValue = empData?.current_position || empData?.position || '過試用期';
      }

      // 入職時使用前端傳入的 store_id，因為新員工尚未存在於 store_employees
      const recordStoreId = movement.movement_type === 'onboarding'
        ? (movement.store_id || null)
        : movement.movement_type === 'store_transfer'
          ? (movement.to_store_id || empData?.store_id || null)
          : (empData?.store_id || movement.store_id || null);

      const onboardingIsPharmacist = movement.movement_type === 'onboarding'
        ? Boolean(movement.onboarding_is_pharmacist)
        : null;

      const promotionLevelNote = movement.movement_type === 'promotion' && movement.position === '行政' && movement.newbie_level
        ? `行政階級:${movement.newbie_level}`
        : '';
      const normalizedNotes = movement.movement_type === 'onboarding'
        ? `${movement.notes || ''}${movement.notes ? '；' : ''}是否藥師:${onboardingIsPharmacist ? '是' : '否'}`
        : promotionLevelNote
          ? `${movement.notes || ''}${movement.notes ? '；' : ''}${promotionLevelNote}`
          : (movement.notes || null);

      movementRecords.push({
        employee_code: movement.employee_code.toUpperCase(),
        employee_name: movement.employee_name,
        store_id: recordStoreId,
        movement_type: movement.movement_type,
        onboarding_is_pharmacist: onboardingIsPharmacist,
        movement_date: movement.effective_date,
        new_value: newValue,
        old_value: oldValue,
        notes: normalizedNotes,
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

    // 入職異動補寫生日到員工主檔（員工管理頁來源）
    const onboardingWithBirthday = movements.filter(
      (m) => m.movement_type === 'onboarding' && !!m.birthday
    );

    if (onboardingWithBirthday.length > 0) {
      const onboardingCodes = Array.from(
        new Set(onboardingWithBirthday.map((m) => m.employee_code.toUpperCase()))
      );

      const { data: existingEmployees } = await adminSupabase
        .from('store_employees')
        .select('employee_code')
        .in('employee_code', onboardingCodes);

      const existingCodeSet = new Set(
        (existingEmployees || []).map((e: any) => String(e.employee_code).toUpperCase())
      );

      for (const movement of onboardingWithBirthday) {
        const employeeCode = movement.employee_code.toUpperCase();
        const isPartTime = employeeCode.startsWith('FKPT');
        const birthday = String(movement.birthday || '').trim();

        if (existingCodeSet.has(employeeCode)) {
          // 已存在時只更新必要欄位，避免覆蓋既有資料
          await adminSupabase
            .from('store_employees')
            .update({
              employee_name: movement.employee_name,
              birthday,
              start_date: movement.effective_date || null,
              is_pharmacist: Boolean(movement.onboarding_is_pharmacist),
              updated_at: new Date().toISOString(),
            })
            .eq('employee_code', employeeCode);
        } else {
          // 不存在時補建主檔，讓員工管理可直接看到生日
          await adminSupabase
            .from('store_employees')
            .insert({
              employee_code: employeeCode,
              employee_name: movement.employee_name,
              position: null,
              current_position: null,
              start_date: movement.effective_date || null,
              birthday,
              employment_type: isPartTime ? 'part_time' : 'full_time',
              is_pharmacist: Boolean(movement.onboarding_is_pharmacist),
              is_active: true,
              store_id: movement.store_id || null,
            });
        }
      }
    }

    // 觸發器會自動處理相關更新

    const transferMovements = movements.filter((m) => m.movement_type === 'store_transfer');
    for (const movement of transferMovements) {
      try {
        await syncStoreTransferMonthlyStatus(adminSupabase, movement);
      } catch (syncError) {
        console.error('Store transfer monthly status sync warning:', syncError);
      }
    }

    // 升職為「新人」或「行政」且指定階級時，額外更新 monthly_staff_status.newbie_level
    const promotionLevelMovements = movements.filter(
      (m): m is MovementInput & { position: string; newbie_level: string } =>
        m.movement_type === 'promotion' &&
        ['新人', '行政'].includes(String(m.position || '')) &&
        Boolean(m.newbie_level)
    );
    for (const movement of promotionLevelMovements) {
      const targetYearMonth = movement.effective_date.substring(0, 7);
      await adminSupabase
        .from('monthly_staff_status')
        .update({ newbie_level: movement.newbie_level, updated_at: new Date().toISOString() })
        .eq('employee_code', movement.employee_code.toUpperCase())
        .gte('year_month', targetYearMonth);
    }

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
