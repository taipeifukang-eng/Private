import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import EmployeeManagementClient from './EmployeeManagementClient';

export const dynamic = 'force-dynamic';

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

  // 獲取所有員工的基本資料（包含離職員工），並去重
  const { data: storeEmployees } = await supabase
    .from('store_employees')
    .select('employee_code, employee_name, start_date, birthday, current_position, is_active, employment_status, last_movement_date');

  if (!storeEmployees || storeEmployees.length === 0) {
    return <EmployeeManagementClient 
      initialEmployees={[]} 
      totalCount={0}
      activeCount={0}
    />;
  }

  // 先去重（同一員編可能有多筆門市記錄；跨店調動時優先採用仍在職的門市資料）
  const uniqueMap = new Map<string, typeof storeEmployees[0]>();
  for (const emp of storeEmployees) {
    const existing = uniqueMap.get(emp.employee_code);
    if (!existing) {
      uniqueMap.set(emp.employee_code, emp);
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
    uniqueMap.set(emp.employee_code, {
      ...preferred,
      start_date: preferred.start_date || fallback.start_date,
      birthday: preferred.birthday || fallback.birthday,
      current_position: preferred.current_position || fallback.current_position,
    });
  }
  const uniqueEmpList = Array.from(uniqueMap.values());
  const allCodes = uniqueEmpList.map(e => e.employee_code);

  // 批次查詢：每位員工最新的 monthly_staff_status（取最大 year_month）
  const { data: allStatuses } = await supabase
    .from('monthly_staff_status')
    .select('employee_code, position, year_month, monthly_status')
    .in('employee_code', allCodes)
    .order('year_month', { ascending: false });

  // 每位員工只保留最新 year_month
  const latestStatusMap = new Map<string, { position: string; year_month: string; monthly_status: string }>();
  for (const s of allStatuses || []) {
    if (!latestStatusMap.has(s.employee_code)) {
      latestStatusMap.set(s.employee_code, {
        position: s.position,
        year_month: s.year_month,
        monthly_status: (s as any).monthly_status,
      });
    }
  }

  // 批次查詢：每位員工最新的升遷記錄（movement_type = 'promotion'）
  const { data: allPromotions } = await supabase
    .from('employee_movement_history')
    .select('employee_code, new_value, movement_date')
    .in('employee_code', allCodes)
    .eq('movement_type', 'promotion')
    .order('movement_date', { ascending: false });

  // 每位員工只保留最新升遷
  const latestPromotionMap = new Map<string, { position: string; movement_date: string }>();
  for (const p of allPromotions || []) {
    if (!latestPromotionMap.has(p.employee_code)) {
      latestPromotionMap.set(p.employee_code, { position: p.new_value, movement_date: p.movement_date });
    }
  }

  // 批次查詢：每位員工最新異動，用於判斷是否已在最新月報後離職
  const { data: allMovements } = await supabase
    .from('employee_movement_history')
    .select('employee_code, movement_type, new_value, movement_date')
    .in('employee_code', allCodes)
    .order('movement_date', { ascending: false });

  const latestMovementMap = new Map<string, { movement_type: string; new_value: string; movement_date: string }>();
  for (const movement of allMovements || []) {
    if (!latestMovementMap.has(movement.employee_code)) {
      latestMovementMap.set(movement.employee_code, {
        movement_type: movement.movement_type,
        new_value: movement.new_value,
        movement_date: movement.movement_date,
      });
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
      employee_name: emp.employee_name,
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
