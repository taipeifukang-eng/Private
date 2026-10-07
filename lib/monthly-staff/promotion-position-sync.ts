import { getPromotionLevelFromNotes } from '@/lib/monthly-staff/promotion-level';

interface PromotionPositionSyncInput {
  employee_code: string;
  effective_date: string;
  position: string;
  newbie_level?: string | null;
}

interface OnboardingPharmacistSyncInput {
  employee_code: string;
  effective_date: string;
  is_pharmacist: boolean;
}

type SupabaseLikeClient = {
  from: (table: string) => any;
};

type PromotionTimelineRow = {
  id?: string;
  created_at?: string;
  movement_type: string;
  movement_date: string;
  new_value: string | null;
  old_value: string | null;
  notes: string | null;
};

function getYearMonth(date: string) {
  return String(date || '').slice(0, 7);
}

function normalizeEmployeeCode(employeeCode: string) {
  return String(employeeCode || '').trim().toUpperCase();
}

function normalizeOptionalText(value: string | null | undefined) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function isActingManagerPromotion(position: string | null | undefined) {
  return String(position || '').trim() === '代理店長';
}

async function getNextPromotionYearMonth(
  supabase: SupabaseLikeClient,
  employeeCode: string,
  effectiveDate: string
) {
  const { data, error } = await supabase
    .from('employee_movement_history')
    .select('movement_date')
    .eq('employee_code', employeeCode)
    .eq('movement_type', 'promotion')
    .neq('new_value', '代理店長')
    .gt('movement_date', effectiveDate)
    .order('movement_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`查詢後續升職紀錄失敗：${error.message}`);
  }

  return data?.movement_date ? getYearMonth(data.movement_date) : null;
}

export async function resolveOfficialPositionBeforeDate(
  supabase: SupabaseLikeClient,
  employeeCodeInput: string,
  effectiveDateInput: string,
  fallbackPositionInput: string | null | undefined
) {
  const employeeCode = normalizeEmployeeCode(employeeCodeInput);
  const effectiveDate = String(effectiveDateInput || '').trim();
  const fallbackPosition = normalizeOptionalText(fallbackPositionInput);

  if (!employeeCode || !isActingManagerPromotion(fallbackPosition)) {
    return fallbackPosition;
  }

  const { data: priorPromotion, error: promotionError } = await supabase
    .from('employee_movement_history')
    .select('new_value')
    .eq('employee_code', employeeCode)
    .eq('movement_type', 'promotion')
    .neq('new_value', '代理店長')
    .lt('movement_date', effectiveDate)
    .order('movement_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (promotionError) {
    throw new Error(`查詢原職位失敗：${promotionError.message}`);
  }

  if (priorPromotion?.new_value) {
    return String(priorPromotion.new_value).trim();
  }

  const targetYearMonth = getYearMonth(effectiveDate);
  const { data: priorMonthlyStatus, error: monthlyStatusError } = await supabase
    .from('monthly_staff_status')
    .select('position')
    .eq('employee_code', employeeCode)
    .lt('year_month', targetYearMonth)
    .not('position', 'is', null)
    .neq('position', '代理店長')
    .order('year_month', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (monthlyStatusError) {
    throw new Error(`查詢前月正式職位失敗：${monthlyStatusError.message}`);
  }

  if (priorMonthlyStatus?.position) {
    return String(priorMonthlyStatus.position).trim();
  }

  const { data: actingAppointment, error: appointmentError } = await supabase
    .from('employee_movement_history')
    .select('old_value')
    .eq('employee_code', employeeCode)
    .in('movement_type', ['promotion', 'acting_manager'])
    .eq('new_value', '代理店長')
    .lt('movement_date', effectiveDate)
    .order('movement_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (appointmentError) {
    throw new Error(`查詢代理任用前職位失敗：${appointmentError.message}`);
  }

  const appointmentPosition = normalizeOptionalText(actingAppointment?.old_value);
  return isActingManagerPromotion(appointmentPosition) ? null : appointmentPosition;
}

export async function syncPromotionPositionToMonthlyStaffStatus(
  supabase: SupabaseLikeClient,
  promotions: PromotionPositionSyncInput[]
) {
  const normalizedPromotions = promotions
    .map((promotion) => ({
      employeeCode: normalizeEmployeeCode(promotion.employee_code),
      effectiveDate: String(promotion.effective_date || '').trim(),
      targetYearMonth: getYearMonth(promotion.effective_date),
      position: String(promotion.position || '').trim(),
      newbieLevel: normalizeOptionalText(promotion.newbie_level),
    }))
    .filter((promotion) =>
      promotion.employeeCode &&
      /^\d{4}-\d{2}$/.test(promotion.targetYearMonth) &&
      promotion.position
    );

  for (const promotion of normalizedPromotions) {
    const isActingManager = isActingManagerPromotion(promotion.position);
    const nextPromotionYearMonth = isActingManager
      ? null
      : await getNextPromotionYearMonth(supabase, promotion.employeeCode, promotion.effectiveDate);

    const updatePayload: Record<string, string | boolean | null> = isActingManager
        ? {
          is_acting_manager: true,
          updated_at: new Date().toISOString(),
        }
      : {
          position: promotion.position,
          updated_at: new Date().toISOString(),
          newbie_level: ['新人', '行政'].includes(promotion.position) ? promotion.newbieLevel : null,
        };

    let updateQuery = supabase
      .from('monthly_staff_status')
      .update(updatePayload)
      .eq('employee_code', promotion.employeeCode)
      .gte('year_month', promotion.targetYearMonth);

    if (nextPromotionYearMonth && nextPromotionYearMonth > promotion.targetYearMonth) {
      updateQuery = updateQuery.lt('year_month', nextPromotionYearMonth);
    }

    const { error } = await updateQuery;
    if (error) {
      throw new Error(`同步月度人員職位失敗：${error.message}`);
    }
  }
}

export async function syncEmployeePromotionTimelineToMonthlyStaffStatus(
  supabase: SupabaseLikeClient,
  employeeCodeInput: string,
  affectedFromDate: string,
  syncActingManager = false
) {
  const employeeCode = normalizeEmployeeCode(employeeCodeInput);
  const affectedDate = String(affectedFromDate || '').trim();
  const affectedYearMonth = getYearMonth(affectedDate);

  if (!employeeCode || !/^\d{4}-\d{2}$/.test(affectedYearMonth)) {
    return;
  }

  const { data: promotions, error } = await supabase
    .from('employee_movement_history')
    .select('id, created_at, movement_type, movement_date, new_value, old_value, notes')
    .eq('employee_code', employeeCode)
    .in('movement_type', ['promotion', 'acting_manager'])
    .order('movement_date', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`查詢升職時間線失敗：${error.message}`);
  }

  const rows = ((promotions || []) as PromotionTimelineRow[])
    .map((row: PromotionTimelineRow) => ({
      id: row.id,
      createdAt: String(row.created_at || ''),
      movementDate: String(row.movement_date || '').trim(),
      yearMonth: getYearMonth(row.movement_date),
      position: String(row.new_value || '').trim(),
      oldPosition: normalizeOptionalText(row.old_value),
      newbieLevel: getPromotionLevelFromNotes(row.notes),
      isActingManager: row.movement_type === 'acting_manager' || isActingManagerPromotion(row.new_value),
    }))
    .filter((row) => /^\d{4}-\d{2}$/.test(row.yearMonth) && row.position);

  rows.sort((a, b) => {
    const dateOrder = a.movementDate.localeCompare(b.movementDate);
    if (dateOrder !== 0) return dateOrder;

    // 同日同時通過新人兩階時，月度職位以較高階段為準。
    if (a.position === '新人' && b.position === '新人') {
      const levelRank = (level: string | null) =>
        level === '二階新人' ? 2 : level === '一階新人' ? 1 : 0;
      const levelOrder = levelRank(a.newbieLevel) - levelRank(b.newbieLevel);
      if (levelOrder !== 0) return levelOrder;
    }

    const createdAtOrder = a.createdAt.localeCompare(b.createdAt);
    if (createdAtOrder !== 0) return createdAtOrder;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  if (rows.length === 0 && !syncActingManager) {
    return;
  }

  for (const row of rows) {
    if (isActingManagerPromotion(row.oldPosition)) {
      row.oldPosition = await resolveOfficialPositionBeforeDate(
        supabase,
        employeeCode,
        row.movementDate,
        row.oldPosition
      );
    }
  }

  const positionRows = rows.filter((row) => !row.isActingManager);
  let currentPosition: string | null = null;
  let currentNewbieLevel: string | null = null;
  let intervalStartYearMonth = affectedYearMonth;

  for (const promotion of positionRows) {
    if (promotion.movementDate < affectedDate) {
      currentPosition = promotion.position;
      currentNewbieLevel = promotion.newbieLevel;
      continue;
    }

    if (!currentPosition && promotion.yearMonth > intervalStartYearMonth) {
      currentPosition = promotion.oldPosition;
      currentNewbieLevel = null;
    }

    if (currentPosition && intervalStartYearMonth < promotion.yearMonth) {
      const { error: updateError } = await supabase
        .from('monthly_staff_status')
        .update({
          position: currentPosition,
          newbie_level: ['新人', '行政'].includes(currentPosition) ? currentNewbieLevel : null,
          updated_at: new Date().toISOString(),
        })
        .eq('employee_code', employeeCode)
        .gte('year_month', intervalStartYearMonth)
        .lt('year_month', promotion.yearMonth);

      if (updateError) {
        throw new Error(`重算升職前月度職位失敗：${updateError.message}`);
      }
    }

    currentPosition = promotion.position;
    currentNewbieLevel = promotion.newbieLevel;
    intervalStartYearMonth = promotion.yearMonth;
  }

  if (currentPosition) {
    const { error: updateError } = await supabase
      .from('monthly_staff_status')
      .update({
        position: currentPosition,
        newbie_level: ['新人', '行政'].includes(currentPosition) ? currentNewbieLevel : null,
        updated_at: new Date().toISOString(),
      })
      .eq('employee_code', employeeCode)
      .gte('year_month', intervalStartYearMonth);

    if (updateError) {
      throw new Error(`重算升職後月度職位失敗：${updateError.message}`);
    }
  }

  if (syncActingManager) {
    const actingStarts = rows
      .filter((row) => row.isActingManager)
      .map((row) => row.yearMonth)
      .sort();
    const alreadyAssigned = actingStarts.some((yearMonth) => yearMonth <= affectedYearMonth);
    const nextAssignmentMonth = actingStarts.find((yearMonth) => yearMonth > affectedYearMonth);

    const updates = alreadyAssigned
      ? [{ value: true, from: affectedYearMonth, to: null }]
      : nextAssignmentMonth
        ? [
            { value: false, from: affectedYearMonth, to: nextAssignmentMonth },
            { value: true, from: nextAssignmentMonth, to: null },
          ]
        : [{ value: false, from: affectedYearMonth, to: null }];

    for (const update of updates) {
      let query = supabase
        .from('monthly_staff_status')
        .update({
          is_acting_manager: update.value,
          updated_at: new Date().toISOString(),
        })
        .eq('employee_code', employeeCode)
        .gte('year_month', update.from);

      if (update.to) {
        query = query.lt('year_month', update.to);
      }

      const { error: actingManagerError } = await query;
      if (actingManagerError) {
        throw new Error(`同步代理店長任用月份失敗：${actingManagerError.message}`);
      }
    }
  }
}

export async function syncMovementEmployeeNameToMonthlyStaffStatus(
  supabase: SupabaseLikeClient,
  employeeCodeInput: string,
  employeeNameInput: string,
  affectedFromDate: string
) {
  const employeeCode = normalizeEmployeeCode(employeeCodeInput);
  const employeeName = String(employeeNameInput || '').trim();
  const affectedYearMonth = getYearMonth(affectedFromDate);

  if (!employeeCode || !employeeName || !/^\d{4}-\d{2}$/.test(affectedYearMonth)) {
    return;
  }

  const { error } = await supabase
    .from('monthly_staff_status')
    .update({
      employee_name: employeeName,
      updated_at: new Date().toISOString(),
    })
    .eq('employee_code', employeeCode)
    .gte('year_month', affectedYearMonth);

  if (error) {
    throw new Error(`同步月度人員姓名失敗：${error.message}`);
  }
}

export async function syncOnboardingPharmacistToMonthlyStaffStatus(
  supabase: SupabaseLikeClient,
  inputs: OnboardingPharmacistSyncInput[]
) {
  const normalizedInputs = inputs
    .map((input) => ({
      employeeCode: normalizeEmployeeCode(input.employee_code),
      targetYearMonth: getYearMonth(input.effective_date),
      isPharmacist: Boolean(input.is_pharmacist),
    }))
    .filter((input) => input.employeeCode && /^\d{4}-\d{2}$/.test(input.targetYearMonth));

  for (const input of normalizedInputs) {
    const { error: employeeError } = await supabase
      .from('store_employees')
      .update({
        is_pharmacist: input.isPharmacist,
        updated_at: new Date().toISOString(),
      })
      .eq('employee_code', input.employeeCode);

    if (employeeError) {
      throw new Error(`同步員工主檔藥師身分失敗：${employeeError.message}`);
    }

    const { error: monthlyError } = await supabase
      .from('monthly_staff_status')
      .update({
        is_pharmacist: input.isPharmacist,
        updated_at: new Date().toISOString(),
      })
      .eq('employee_code', input.employeeCode)
      .gte('year_month', input.targetYearMonth);

    if (monthlyError) {
      throw new Error(`同步月度人員藥師身分失敗：${monthlyError.message}`);
    }
  }
}
