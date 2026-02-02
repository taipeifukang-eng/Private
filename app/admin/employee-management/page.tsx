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

  // 獲取所有員工資料（使用 DISTINCT ON 避免重複）
  const { data: employees } = await supabase
    .from('store_employees')
    .select(`
      id,
      employee_code,
      employee_name,
      current_position,
      is_active,
      start_date
    `)
    .eq('is_active', true)
    .order('employee_code');

  // 統計資訊
  const totalEmployees = employees?.length || 0;
  const activeEmployees = employees?.filter(e => e.is_active).length || 0;

  // 去重：相同員編只保留一個
  const uniqueEmployees = employees?.reduce((acc: any[], emp) => {
    if (!acc.find(e => e.employee_code === emp.employee_code)) {
      acc.push(emp);
    }
    return acc;
  }, []) || [];

  return <EmployeeManagementClient 
    initialEmployees={uniqueEmployees} 
    totalCount={uniqueEmployees.length}
    activeCount={uniqueEmployees.length}
  />;
}
