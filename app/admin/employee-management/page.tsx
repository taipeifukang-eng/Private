import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import EmployeeManagementClient from './EmployeeManagementClient';

export const dynamic = 'force-dynamic';

type EmployeeSource = {
  employee_code: string;
  employee_name: string | null;
  start_date: string | null;
  birthday: string | null;
  current_position: string | null;
  is_active: boolean | null;
  employment_status: string | null;
  last_movement_date: string | null;
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

async function fetchAllPages<T>(createQuery: (from: number, to: number) => any): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await createQuery(from, to);
    if (error) throw error;
    rows.push(...((data || []) as T[]));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

export default async function EmployeeManagementPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, department, job_title')
    .eq('id', user.id)
    .single();

  // 檢查是否為需要指派的職位
  const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '');

  // 檢查權限：admin、營業部助理和營業部主管
  const isBusinessAssistant = profile?.department?.startsWith('營業') && profile?.role === 'member' && !needsAssignment;
  const isBusinessSupervisor = profile?.department?.startsWith('營業') && profile?.role === 'manager' && !needsAssignment;
  
  if (!profile || (profile.role !== 'admin' && !isBusinessAssistant && !isBusinessSupervisor)) {
    redirect('/dashboard');
  }

  // 獲取所有員工來源：主檔、月人員狀態、人員異動。
  // 有些復職/歷史匯入資料只存在月報或異動紀錄，仍應出現在員工管理。
  const [storeEmployees, allStatuses, allMovements] = await Promise.all([
    fetchAllPages<EmployeeSource>((from, to) => supabase
      .from('store_employees')
      .select('employee_code, employee_name, start_date, birthday, current_position, is_active, employment_status, last_movement_date')
      .range(from, to)
    ),
    fetchAllPages<MonthlyStaffStatusSource>((from, to) => supabase
      .from('monthly_staff_status')
      .select('employee_code, employee_name, position, year_month, monthly_status, start_date')
      .order('year_month', { ascending: false })
      .range(from, to)
    ),
    fetchAllPages<EmployeeMovementSource>((from, to) => supabase
      .from('employee_movement_history')
      .select('employee_code, employee_name, movement_type, new_value, movement_date')
      .order('movement_date', { ascending: false })
      .range(from, to)
    ),
  ]);

  if (storeEmployees.length === 0 && allStatuses.length === 0 && allMovements.length === 0) {
    return <EmployeeManagementClient 
      initialEmployees={[]} 
      totalCount={0}
      activeCount={0}
    />;
  }

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

    const statusDate = latestStatus ? `${latestStatus.year_month}-01` : null;
    const latestMovementIsNewerOrSame =
      latestMovement && (!statusDate || latestMovement.movement_date >= statusDate);
    const latestMovementIsResignation =
      latestMovement?.movement_type === 'resignation' &&
      latestMovement.new_value === 'resigned';
    const hasResignedInMasterFallback =
      !latestMovement && (emp.is_active === false || emp.employment_status === 'resigned');

    if (latestMovementIsNewerOrSame && latestMovementIsResignation) {
      currentStatus = 'resigned';
    } else if (hasResignedInMasterFallback) {
      currentStatus = 'resigned';
    }

    return {
      id: emp.employee_code,
      employee_code: emp.employee_code,
      employee_name: emp.employee_name || '',
      current_position: currentPosition,
      start_date: emp.start_date,
      birthday: emp.birthday || null,
      current_status: currentStatus,
      is_active: currentStatus !== 'resigned',
    };
  });

  // 按員編排序
  uniqueEmployees.sort((a, b) => a.employee_code.localeCompare(b.employee_code));
  const activeEmployeesCount = uniqueEmployees.filter(emp => emp.is_active).length;

  return <EmployeeManagementClient 
    initialEmployees={uniqueEmployees} 
    totalCount={uniqueEmployees.length}
    activeCount={activeEmployeesCount}
  />;
}
