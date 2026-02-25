import { getCurrentUser } from '@/app/auth/actions';
import { getAssignments } from '@/app/actions';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ClipboardList, ArrowRight, Activity, Cake } from 'lucide-react';
import { createClient, createAdminClient } from '@/lib/supabase/server';

export default async function HomePage() {
  const { user } = await getCurrentUser();

  // If not logged in, show landing page
  if (!user) {
    const supabase = createClient();
    const { count: storeCount } = await supabase
      .from('stores')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);

    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="text-center px-4">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-gradient-to-br from-slate-700 to-slate-800 rounded-2xl flex items-center justify-center border border-amber-500/30 shadow-2xl">
              <ClipboardList className="w-10 h-10 text-amber-400" />
            </div>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white mb-3 tracking-wide">
            FK連鎖藥局菁英業務管理系統
          </h1>

          <div className="flex items-center justify-center gap-2 mb-8">
            <Activity className="w-4 h-4 text-amber-400 animate-pulse" />
            <p className="text-base sm:text-lg text-slate-400">
              {storeCount
                ? `正在同步 ${storeCount} 間門市的營運脈動...`
                : '正在同步門市營運脈動...'}
            </p>
          </div>

          <div className="flex flex-wrap gap-4 justify-center">
            <Link
              href="/login"
              className="px-8 py-3 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 rounded-xl hover:from-amber-400 hover:to-amber-500 transition-all font-bold shadow-lg tracking-wider"
            >
              登入
            </Link>
            <Link
              href="/register"
              className="px-8 py-3 bg-transparent text-white border-2 border-slate-500 rounded-xl hover:border-amber-500 hover:text-amber-400 transition-all font-semibold"
            >
              註冊帳號
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Get assignments for My Tasks section
  const assignmentsResult = await getAssignments();
  const allAssignments = assignmentsResult.success ? assignmentsResult.data : [];
  const myAssignments = allAssignments.filter(
    (assignment) => assignment.assigned_to === user.id
  );

  // ── 本月壽星 ──────────────────────────────────────────────
  const adminSupabase = createAdminClient();
  const currentMonth = new Date().getMonth() + 1; // 1-12
  const jobTitle = user.profile?.job_title || '';
  const role = user.profile?.role || '';
  const isSupervisor = jobTitle.includes('督導');
  const isStoreManager = ['店長', '代理店長'].includes(jobTitle) && !isSupervisor;
  const isManagerOrAdmin = role === 'admin' || (role === 'manager' && !isSupervisor && !isStoreManager);

  let birthdayEmployees: { employee_code: string; employee_name: string; birthday: string }[] = [];

  if (isManagerOrAdmin) {
    // 經理/系統管理員 → 全部壽星
    const { data } = await adminSupabase
      .from('store_employees')
      .select('employee_code, employee_name, birthday')
      .eq('is_active', true)
      .not('birthday', 'is', null);
    
    birthdayEmployees = (data || []).filter(emp => {
      if (!emp.birthday) return false;
      const month = parseInt(emp.birthday.split('-')[1], 10);
      return month === currentMonth;
    });

  } else if (isSupervisor || isStoreManager) {
    // 督導/店長 → 先取得管轄門市 ID 清單
    const { data: managedStores } = await adminSupabase
      .from('store_managers')
      .select('store_id')
      .eq('user_id', user.id);

    const storeIds = (managedStores || []).map(s => s.store_id);

    if (storeIds.length > 0) {
      const { data } = await adminSupabase
        .from('store_employees')
        .select('employee_code, employee_name, birthday')
        .eq('is_active', true)
        .in('store_id', storeIds)
        .not('birthday', 'is', null);

      birthdayEmployees = (data || []).filter(emp => {
        if (!emp.birthday) return false;
        const month = parseInt(emp.birthday.split('-')[1], 10);
        return month === currentMonth;
      });
    }
  }

  // 去重（同員編可能多筆） + 依月/日排序
  const uniqueBirthdays = Object.values(
    birthdayEmployees.reduce((acc, emp) => {
      if (!acc[emp.employee_code]) acc[emp.employee_code] = emp;
      return acc;
    }, {} as Record<string, typeof birthdayEmployees[0]>)
  ).sort((a, b) => {
    const [, am, ad] = a.birthday.split('-').map(Number);
    const [, bm, bd] = b.birthday.split('-').map(Number);
    return am !== bm ? am - bm : ad - bd;
  });
  // ─────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 px-3 py-4 sm:px-4 sm:py-6 lg:p-8">
      <div className="w-full max-w-7xl mx-auto">
        {/* Welcome Header */}
        <div className="mb-4 sm:mb-6 lg:mb-8">
          <h1 className="text-xl sm:text-2xl lg:text-4xl font-bold text-gray-900 mb-2 break-words leading-tight">
            歡迎回來, {user.profile?.full_name || user.email}
          </h1>
          <p className="text-xs sm:text-sm lg:text-base text-gray-600 break-words leading-relaxed">
            {user.profile?.role === 'admin' && '您是系統管理員，擁有完整的系統控制權限'}
            {user.profile?.role === 'manager' && '您是專案經理，可以管理流程和指派任務'}
            {user.profile?.role === 'member' && '查看並執行指派給您的任務'}
          </p>
        </div>

        {/* Cards Row */}
        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 items-start">

          {/* My Tasks Section */}
          <div className="bg-white rounded-lg shadow-lg p-3 sm:p-4 lg:p-6 w-full lg:max-w-xl">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h2 className="text-base sm:text-xl lg:text-2xl font-bold text-gray-900">我的任務</h2>
              <Link
                href="/my-tasks"
                className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 text-xs sm:text-sm whitespace-nowrap"
              >
                查看全部
                <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4" />
              </Link>
            </div>

            {myAssignments.length === 0 ? (
              <p className="text-gray-500 text-center py-6 sm:py-8 text-xs sm:text-sm">目前沒有指派的任務</p>
            ) : (
              <div className="space-y-2 sm:space-y-3">
                {myAssignments.slice(0, 3).map((assignment) => (
                  <Link
                    key={assignment.id}
                    href={`/assignment/${assignment.id}`}
                    className="block p-2 sm:p-3 lg:p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 mb-1 text-xs sm:text-sm lg:text-base break-words leading-tight">
                          {assignment.template?.title || '未知專案'}
                        </h3>
                        <p className="text-[10px] sm:text-xs lg:text-sm text-gray-500 break-words">
                          狀態: {assignment.status === 'pending' && '待處理'}
                          {assignment.status === 'in_progress' && '進行中'}
                          {assignment.status === 'completed' && '已完成'}
                        </p>
                      </div>
                      <ArrowRight className="text-gray-400 flex-shrink-0 w-4 h-4 sm:w-5 sm:h-5" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* 本月壽星 Section */}
          {(isManagerOrAdmin || isSupervisor || isStoreManager) && (
            <div className="bg-white rounded-lg shadow-lg p-3 sm:p-4 lg:p-6 w-full lg:max-w-xl">
              <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <Cake className="w-5 h-5 text-pink-500 flex-shrink-0" />
                <h2 className="text-base sm:text-xl lg:text-2xl font-bold text-gray-900">
                  本月壽星
                  <span className="ml-2 text-sm font-normal text-gray-400">({currentMonth}月)</span>
                </h2>
              </div>

              {uniqueBirthdays.length === 0 ? (
                <p className="text-gray-500 text-center py-6 sm:py-8 text-xs sm:text-sm">本月沒有壽星</p>
              ) : (
                <div className="overflow-hidden">
                  {/* Header */}
                  <div className="grid grid-cols-3 gap-2 px-3 py-2 bg-gray-50 rounded-t-lg border border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    <span>員編</span>
                    <span>姓名</span>
                    <span>日期</span>
                  </div>
                  {/* Rows */}
                  <div className="border border-t-0 border-gray-200 rounded-b-lg divide-y divide-gray-100 max-h-72 overflow-y-auto">
                    {uniqueBirthdays.map((emp) => {
                      const [, mm, dd] = emp.birthday.split('-');
                      return (
                        <div
                          key={emp.employee_code}
                          className="grid grid-cols-3 gap-2 px-3 py-2 text-xs sm:text-sm hover:bg-pink-50 transition-colors"
                        >
                          <span className="text-gray-600 font-mono">{emp.employee_code}</span>
                          <span className="text-gray-900 font-medium truncate">{emp.employee_name}</span>
                          <span className="text-pink-600 font-semibold">{parseInt(mm, 10)}/{parseInt(dd, 10)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-right text-xs text-gray-400 mt-2">共 {uniqueBirthdays.length} 人</p>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
