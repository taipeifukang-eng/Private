import { getCurrentUser } from '@/app/auth/actions';
import { getTemplates, getAssignments } from '@/app/actions';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ClipboardList, Users, FileText, TrendingUp, ArrowRight, CheckCircle2 } from 'lucide-react';

export default async function HomePage() {
  const { user } = await getCurrentUser();

  // If not logged in, show landing page
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center px-4">
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            動態工作流程與檢查清單系統
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            歡迎使用富康程式開發流程審核系統
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link
              href="/login"
              className="px-8 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold shadow-lg"
            >
              登入
            </Link>
            <Link
              href="/register"
              className="px-8 py-3 bg-white text-blue-600 border-2 border-blue-600 rounded-lg hover:bg-blue-50 transition-colors font-semibold"
            >
              註冊帳號
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Get data for dashboard
  const templatesResult = await getTemplates();
  const assignmentsResult = await getAssignments();

  const templates = templatesResult.success ? templatesResult.data : [];
  const allAssignments = assignmentsResult.success ? assignmentsResult.data : [];

  // Filter user's assignments
  const myAssignments = allAssignments.filter(
    (assignment) => assignment.assigned_to === user.id
  );

  const myPendingCount = myAssignments.filter(a => a.status === 'pending').length;
  const myInProgressCount = myAssignments.filter(a => a.status === 'in_progress').length;
  const myCompletedCount = myAssignments.filter(a => a.status === 'completed').length;

  // Admin/Manager additional stats
  const totalAssignmentsCount = allAssignments.length;
  const templatesCount = templates.length;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Welcome Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            歡迎回來, {user.profile?.full_name || user.email}
          </h1>
          <p className="text-gray-600">
            {user.profile?.role === 'admin' && '您是系統管理員，擁有完整的系統控制權限'}
            {user.profile?.role === 'manager' && '您是專案經理，可以管理流程和指派任務'}
            {user.profile?.role === 'member' && '查看並執行指派給您的任務'}
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="我的任務"
            value={myAssignments.length}
            icon={<ClipboardList className="w-6 h-6" />}
            color="blue"
            href="/my-tasks"
          />
          <StatCard
            title="進行中"
            value={myInProgressCount}
            icon={<TrendingUp className="w-6 h-6" />}
            color="yellow"
            href="/my-tasks"
          />
          <StatCard
            title="已完成"
            value={myCompletedCount}
            icon={<CheckCircle2 className="w-6 h-6" />}
            color="green"
            href="/my-tasks"
          />
          {(user.profile?.role === 'admin' || user.profile?.role === 'manager') && (
            <StatCard
              title="流程總數"
              value={templatesCount}
              icon={<FileText className="w-6 h-6" />}
              color="purple"
              href="/admin/templates"
            />
          )}
          {user.profile?.role === 'member' && (
            <StatCard
              title="待處理"
              value={myPendingCount}
              icon={<ClipboardList className="w-6 h-6" />}
              color="gray"
              href="/my-tasks"
            />
          )}
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* My Tasks Section */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-900">我的任務</h2>
              <Link
                href="/my-tasks"
                className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
              >
                查看全部
                <ArrowRight size={16} />
              </Link>
            </div>

            {myAssignments.length === 0 ? (
              <p className="text-gray-500 text-center py-8">目前沒有指派的任務</p>
            ) : (
              <div className="space-y-3">
                {myAssignments.slice(0, 3).map((assignment) => (
                  <Link
                    key={assignment.id}
                    href={`/assignment/${assignment.id}`}
                    className="block p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900 mb-1">
                          {assignment.template?.title || '未知專案'}
                        </h3>
                        <p className="text-sm text-gray-500">
                          狀態: {assignment.status === 'pending' && '待處理'}
                          {assignment.status === 'in_progress' && '進行中'}
                          {assignment.status === 'completed' && '已完成'}
                        </p>
                      </div>
                      <ArrowRight className="text-gray-400" size={20} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Admin/Manager Actions */}
          {(user.profile?.role === 'admin' || user.profile?.role === 'manager') && (
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">管理功能</h2>
              <div className="space-y-3">
                <Link
                  href="/admin/templates"
                  className="block p-4 border border-gray-200 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-purple-100 p-2 rounded-lg">
                        <FileText className="text-purple-600" size={24} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">流程管理</h3>
                        <p className="text-sm text-gray-500">建立和編輯工作流程</p>
                      </div>
                    </div>
                    <ArrowRight className="text-gray-400" size={20} />
                  </div>
                </Link>

                <Link
                  href="/dashboard"
                  className="block p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-blue-100 p-2 rounded-lg">
                        <TrendingUp className="text-blue-600" size={24} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">指派儀表板</h3>
                        <p className="text-sm text-gray-500">查看和管理所有任務指派</p>
                      </div>
                    </div>
                    <ArrowRight className="text-gray-400" size={20} />
                  </div>
                </Link>

                {user.profile?.role === 'admin' && (
                  <Link
                    href="/admin/users"
                    className="block p-4 border border-gray-200 rounded-lg hover:border-green-500 hover:bg-green-50 transition-all"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="bg-green-100 p-2 rounded-lg">
                          <Users className="text-green-600" size={24} />
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900">使用者管理</h3>
                          <p className="text-sm text-gray-500">管理系統使用者和權限</p>
                        </div>
                      </div>
                      <ArrowRight className="text-gray-400" size={20} />
                    </div>
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Member additional info */}
          {user.profile?.role === 'member' && (
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-4">系統資訊</h2>
              <div className="space-y-4">
                <div className="p-4 bg-blue-50 rounded-lg">
                  <h3 className="font-semibold text-gray-900 mb-2">如何使用</h3>
                  <ul className="text-sm text-gray-600 space-y-2">
                    <li>• 查看「我的任務」查看所有指派給您的工作</li>
                    <li>• 點擊任務開始執行檢查清單</li>
                    <li>• 完成所有步驟後，任務將自動標記為完成</li>
                  </ul>
                </div>
                <div className="p-4 bg-green-50 rounded-lg">
                  <h3 className="font-semibold text-gray-900 mb-2">進度追蹤</h3>
                  <p className="text-sm text-gray-600">
                    系統會自動記錄您的進度，您可以隨時暫停並稍後繼續。
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  color,
  href,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: 'blue' | 'yellow' | 'green' | 'gray' | 'purple';
  href: string;
}) {
  const colorClasses = {
    blue: 'bg-blue-500',
    yellow: 'bg-yellow-500',
    green: 'bg-green-500',
    gray: 'bg-gray-500',
    purple: 'bg-purple-500',
  };

  return (
    <Link href={href} className="block">
      <div className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600 mb-1">{title}</p>
            <p className="text-3xl font-bold text-gray-900">{value}</p>
          </div>
          <div className={`${colorClasses[color]} text-white p-3 rounded-lg`}>
            {icon}
          </div>
        </div>
      </div>
    </Link>
  );
}
