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

function extractNewbieLevelFromNotes(notes: string | null | undefined) {
  const value = String(notes || '');
  const match = value.match(/(?:新人等級|行政階級):([^；\n]+)/);
  return match?.[1]?.trim() || null;
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
    .gt('movement_date', effectiveDate)
    .order('movement_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`查詢後續升職紀錄失敗：${error.message}`);
  }

  return data?.movement_date ? getYearMonth(data.movement_date) : null;
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
    const nextPromotionYearMonth = await getNextPromotionYearMonth(
      supabase,
      promotion.employeeCode,
      promotion.effectiveDate
    );

    const updatePayload: Record<string, string | boolean | null> = isActingManagerPromotion(promotion.position)
      ? {
          is_acting_manager: true,
          updated_at: new Date().toISOString(),
        }
      : {
          position: promotion.position,
          is_acting_manager: false,
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
  affectedFromDate: string
) {
  const employeeCode = normalizeEmployeeCode(employeeCodeInput);
  const affectedDate = String(affectedFromDate || '').trim();
  const affectedYearMonth = getYearMonth(affectedDate);

  if (!employeeCode || !/^\d{4}-\d{2}$/.test(affectedYearMonth)) {
    return;
  }

  const { data: promotions, error } = await supabase
    .from('employee_movement_history')
    .select('id, movement_date, new_value, old_value, notes')
    .eq('employee_code', employeeCode)
    .eq('movement_type', 'promotion')
    .order('movement_date', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`查詢升職時間線失敗：${error.message}`);
  }

  const rows = ((promotions || []) as PromotionTimelineRow[])
    .map((row: PromotionTimelineRow) => ({
      movementDate: String(row.movement_date || '').trim(),
      yearMonth: getYearMonth(row.movement_date),
      position: String(row.new_value || '').trim(),
      oldPosition: normalizeOptionalText(row.old_value),
      newbieLevel: extractNewbieLevelFromNotes(row.notes),
      isActingManager: isActingManagerPromotion(row.new_value),
    }))
    .filter((row) => /^\d{4}-\d{2}$/.test(row.yearMonth) && row.position);

  if (rows.length === 0) {
    return;
  }

  let currentPosition: string | null = null;
  let currentNewbieLevel: string | null = null;
  let currentIsActingManager = false;
  let intervalStartYearMonth = affectedYearMonth;

  for (const promotion of rows) {
    if (promotion.movementDate < affectedDate) {
      if (promotion.isActingManager) {
        currentPosition = currentPosition || promotion.oldPosition;
        currentIsActingManager = true;
      } else {
        currentPosition = promotion.position;
        currentNewbieLevel = promotion.newbieLevel;
        currentIsActingManager = false;
      }
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
          is_acting_manager: currentIsActingManager,
          updated_at: new Date().toISOString(),
        })
        .eq('employee_code', employeeCode)
        .gte('year_month', intervalStartYearMonth)
        .lt('year_month', promotion.yearMonth);

      if (updateError) {
        throw new Error(`重算升職前月度職位失敗：${updateError.message}`);
      }
    }

    if (promotion.isActingManager) {
      currentPosition = currentPosition || promotion.oldPosition;
      currentIsActingManager = true;
    } else {
      currentPosition = promotion.position;
      currentNewbieLevel = promotion.newbieLevel;
      currentIsActingManager = false;
    }
    intervalStartYearMonth = promotion.yearMonth;
  }

  if (currentPosition) {
    const { error: updateError } = await supabase
      .from('monthly_staff_status')
      .update({
        position: currentPosition,
        newbie_level: ['新人', '行政'].includes(currentPosition) ? currentNewbieLevel : null,
        is_acting_manager: currentIsActingManager,
        updated_at: new Date().toISOString(),
      })
      .eq('employee_code', employeeCode)
      .gte('year_month', intervalStartYearMonth);

    if (updateError) {
      throw new Error(`重算升職後月度職位失敗：${updateError.message}`);
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
