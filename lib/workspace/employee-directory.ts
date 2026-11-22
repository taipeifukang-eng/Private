// Mirrors the existing employee-management source precedence; does not mutate records.
type EmployeeSource = {
  employee_code: string;
  employee_name: string | null;
  start_date: string | null;
  birthday: string | null;
  current_position: string | null;
  is_active: boolean | null;
  employment_status: string | null;
  last_movement_date: string | null;
  /** H.4：員工主檔階段（新人／行政才有值），跟著升職異動自動更新。 */
  newbie_level?: string | null;
};

type MonthlyStaffStatusSource = {
  employee_code: string;
  employee_name: string | null;
  position: string | null;
  year_month: string;
  monthly_status: string | null;
  start_date: string | null;
};

type EmployeeMovementSource = {
  employee_code: string;
  employee_name: string | null;
  movement_type: string;
  new_value: string | null;
  movement_date: string;
};


export function employeeDirectory(storeEmployees: EmployeeSource[], allStatuses: MonthlyStaffStatusSource[], allMovements: EmployeeMovementSource[]) {
  const latestStatusMap = new Map<string, { position: string | null; year_month: string; monthly_status: string | null; employee_name: string | null; start_date: string | null }>();
  for (const s of allStatuses || []) {
    const employeeCode = String(s.employee_code || '').trim().toUpperCase();
    if (!employeeCode || latestStatusMap.has(employeeCode)) continue;
    latestStatusMap.set(employeeCode, {
      position: s.position,
      year_month: s.year_month,
      monthly_status: s.monthly_status,
      employee_name: s.employee_name,
      start_date: s.start_date,
    });
  }

  const latestMovementMap = new Map<string, { movement_type: string; new_value: string | null; movement_date: string; employee_name: string | null }>();
  for (const movement of allMovements || []) {
    const employeeCode = String(movement.employee_code || '').trim().toUpperCase();
    if (!employeeCode || latestMovementMap.has(employeeCode)) continue;
    latestMovementMap.set(employeeCode, {
      movement_type: movement.movement_type,
      new_value: movement.new_value,
      movement_date: movement.movement_date,
      employee_name: movement.employee_name,
    });
  }

  // 先去重（同一員編可能有多筆門市記錄；跨店調動時優先採用仍在職的門市資料）
  const uniqueMap = new Map<string, EmployeeSource>();
  for (const emp of storeEmployees) {
    const employeeCode = String(emp.employee_code || '').trim().toUpperCase();
    if (!employeeCode) continue;

    const existing = uniqueMap.get(employeeCode);
    if (!existing) {
      uniqueMap.set(employeeCode, { ...emp, employee_code: employeeCode });
      continue;
    }

    const isEmpActive = emp.is_active !== false && emp.employment_status !== 'resigned';
    const isExistingActive = existing.is_active !== false && existing.employment_status !== 'resigned';
    const shouldUseEmp =
      (isEmpActive && !isExistingActive) ||
      (isEmpActive === isExistingActive &&
        String(emp.last_movement_date || '') > String(existing.last_movement_date || ''));

    const preferred = shouldUseEmp ? emp : existing;
    const fallback = shouldUseEmp ? existing : emp;
    uniqueMap.set(employeeCode, {
      ...preferred,
      start_date: preferred.start_date || fallback.start_date,
      birthday: preferred.birthday || fallback.birthday,
      current_position: preferred.current_position || fallback.current_position,
      newbie_level: preferred.newbie_level || (preferred.current_position ? null : fallback.newbie_level) || null,
    });
  }

  for (const [employeeCode, status] of Array.from(latestStatusMap.entries())) {
    if (uniqueMap.has(employeeCode)) continue;
    uniqueMap.set(employeeCode, {
      employee_code: employeeCode,
      employee_name: status.employee_name || '',
      start_date: status.start_date,
      birthday: null,
      current_position: status.position,
      is_active: status.monthly_status !== 'resigned',
      employment_status: status.monthly_status === 'resigned' ? 'resigned' : 'active',
      last_movement_date: null,
    });
  }

  for (const [employeeCode, movement] of Array.from(latestMovementMap.entries())) {
    if (uniqueMap.has(employeeCode)) continue;
    uniqueMap.set(employeeCode, {
      employee_code: employeeCode,
      employee_name: movement.employee_name || '',
      start_date: null,
      birthday: null,
      current_position: movement.movement_type === 'promotion' ? movement.new_value : null,
      is_active: movement.movement_type !== 'resignation',
      employment_status: movement.movement_type === 'resignation' ? 'resigned' : 'active',
      last_movement_date: movement.movement_date,
    });
  }

  const uniqueEmpList = Array.from(uniqueMap.values());

  // 每位員工只保留最新升遷
  const latestPromotionMap = new Map<string, { position: string; movement_date: string }>();
  for (const movement of allMovements || []) {
    const employeeCode = String(movement.employee_code || '').trim().toUpperCase();
    if (
      employeeCode &&
      movement.movement_type === 'promotion' &&
      movement.new_value &&
      !latestPromotionMap.has(employeeCode)
    ) {
      latestPromotionMap.set(employeeCode, { position: movement.new_value, movement_date: movement.movement_date });
    }
  }

  // 合併：比較 monthly_staff_status 和最新升遷記錄，取較新者
  const uniqueEmployees = uniqueEmpList.map(emp => {
    const latestStatus = latestStatusMap.get(emp.employee_code);
    const latestPromotion = latestPromotionMap.get(emp.employee_code);
    const latestMovement = latestMovementMap.get(emp.employee_code);

    let currentPosition = emp.current_position || null;
    let currentStatus = latestStatus?.monthly_status || null;

    if (latestStatus && latestPromotion) {
      // 升遷日期 vs 最新月報年月（取較新）
      const statusDate = latestStatus.year_month + '-01';
      currentPosition = latestPromotion.movement_date >= statusDate
        ? latestPromotion.position
        : latestStatus.position;
    } else if (latestPromotion) {
      currentPosition = latestPromotion.position;
    } else if (latestStatus) {
      currentPosition = latestStatus.position;
    }

    const latestMovementIsResignation =
      latestMovement?.movement_type === 'resignation' &&
      latestMovement.new_value === 'resigned';
    const hasResignedInMasterFallback =
      !latestMovement && (emp.is_active === false || emp.employment_status === 'resigned');

    if (latestMovementIsResignation) {
      currentStatus = 'resigned';
    } else if (hasResignedInMasterFallback) {
      currentStatus = 'resigned';
    }

    // A later return/onboarding/transfer must supersede an old resigned monthly snapshot.
    const employmentMovement=(allMovements||[]).find(m=>String(m.employee_code||'').trim().toUpperCase()===emp.employee_code&&['onboarding','return_to_work','resignation','leave_without_pay','store_transfer'].includes(m.movement_type));
    if(employmentMovement&&employmentMovement.movement_date>=(latestStatus?.year_month||'0000-01')+'-01'){
      currentStatus=employmentMovement.movement_type==='resignation'?'resigned':employmentMovement.movement_type==='leave_without_pay'?'leave_of_absence':'full_month';
    }

    return {
      id: emp.employee_code,
      employee_code: emp.employee_code,
      employee_name: emp.employee_name || '',
      current_position: currentPosition,
      start_date: emp.start_date,
      birthday: emp.birthday || null,
      newbie_level: ['新人', '行政'].includes(String(currentPosition || '')) ? emp.newbie_level || null : null,
      current_status: currentStatus,
      is_active: currentStatus !== 'resigned',
    };
  });

  // 按員編排序
  uniqueEmployees.sort((a, b) => a.employee_code.localeCompare(b.employee_code));
  return uniqueEmployees;
}
