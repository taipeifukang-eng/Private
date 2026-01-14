import { getAllUsers } from '@/app/auth/actions';
import { Users, UserPlus, Shield, User as UserIcon } from 'lucide-react';
import Link from 'next/link';
import UserManagementTable from '@/components/admin/UserManagementTable';

export default async function UsersManagementPage() {
  const result = await getAllUsers();
  const users = result.success ? result.data : [];

  if (!result.success && result.error === '權限不足') {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <h2 className="text-2xl font-bold text-red-900 mb-2">權限不足</h2>
            <p className="text-red-700 mb-4">只有管理員可以訪問使用者管理頁面</p>
            <Link
              href="/dashboard"
              className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              返回儀表板
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const adminCount = users.filter(u => u.role === 'admin').length;
  const managerCount = users.filter(u => u.role === 'manager').length;
  const memberCount = users.filter(u => u.role === 'member').length;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">使用者管理</h1>
            <p className="text-gray-600">管理系統所有使用者與權限</p>
          </div>
          <Link
            href="/register"
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
          >
            <UserPlus size={20} />
            新增使用者
          </Link>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="總使用者"
            value={users.length}
            icon={<Users className="w-6 h-6" />}
            color="blue"
          />
          <StatCard
            title="管理員"
            value={adminCount}
            icon={<Shield className="w-6 h-6" />}
            color="purple"
          />
          <StatCard
            title="主管"
            value={managerCount}
            icon={<UserIcon className="w-6 h-6" />}
            color="green"
          />
          <StatCard
            title="成員"
            value={memberCount}
            icon={<UserIcon className="w-6 h-6" />}
            color="gray"
          />
        </div>

        {/* Users Table */}
        <UserManagementTable users={users} />
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: 'blue' | 'purple' | 'green' | 'gray';
}) {
  const colorClasses = {
    blue: 'bg-blue-500',
    purple: 'bg-purple-500',
    green: 'bg-green-500',
    gray: 'bg-gray-500',
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
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
  );
}
