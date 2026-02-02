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

  // 獲取所有在職員工的基本資料
  const { data: storeEmployees } = await supabase
    .from('store_employees')
    .select('employee_code, employee_name, start_date')
    .eq('is_active', true);

  if (!storeEmployees || storeEmployees.length === 0) {
    return <EmployeeManagementClient 
      initialEmployees={[]} 
      totalCount={0}
      activeCount={0}
    />;
  }

  // 獲取每個員工的最新職位（從 monthly_staff_status）
  const employeesWithPosition = await Promise.all(
    storeEmployees.map(async (emp) => {
      const { data: latestStatus } = await supabase
        .from('monthly_staff_status')
        .select('position, year_month')
        .eq('employee_code', emp.employee_code)
        .order('year_month', { ascending: false })
        .limit(1)
        .single();

      return {
        id: emp.employee_code, // 使用 employee_code 作為 id
        employee_code: emp.employee_code,
        employee_name: emp.employee_name,
        current_position: latestStatus?.position || null,
        start_date: emp.start_date,
        is_active: true
      };
    })
  );

  // 去重：相同員編只保留一個
  const uniqueEmployees = employeesWithPosition.reduce((acc: any[], emp) => {
    if (!acc.find(e => e.employee_code === emp.employee_code)) {
      acc.push(emp);
    }
    return acc;
  }, []);

  return <EmployeeManagementClient 
    initialEmployees={uniqueEmployees} 
    totalCount={uniqueEmployees.length}
    activeCount={uniqueEmployees.length}
  />;
}
