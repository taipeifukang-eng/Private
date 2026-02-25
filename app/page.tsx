import { getCurrentUser } from '@/app/auth/actions';
import { getAssignments } from '@/app/actions';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ClipboardList, ArrowRight, Activity } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

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

        {/* My Tasks Section */}
        <div className="bg-white rounded-lg shadow-lg p-3 sm:p-4 lg:p-6 max-w-2xl">
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
      </div>
    </div>
  );
}
