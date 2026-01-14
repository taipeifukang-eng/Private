'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardList, CheckCircle2, Clock, AlertCircle, Users, User as UserIcon } from 'lucide-react';
import Link from 'next/link';

export default function MyTasksPage() {
  const router = useRouter();
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDepartment, setActiveDepartment] = useState<string>('');
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const { getCurrentUser } = await import('@/app/auth/actions');
      const result = await getCurrentUser();
      
      if (!result.user) {
        router.push('/login');
        return;
      }
      
      setUser(result.user);
      loadAssignments();
    } catch (error) {
      console.error('Error checking auth:', error);
      router.push('/login');
    }
  };

  const loadAssignments = async () => {
    try {
      const { getAssignments } = await import('@/app/actions');
      const result = await getAssignments();
      
      if (result.success && result.data) {
        setAssignments(result.data);
        
        // Set first department as active by default
        const depts = getDepartments(result.data);
        if (depts.length > 0) {
          setActiveDepartment(depts[0]);
        }
      }
    } catch (error) {
      console.error('Error loading assignments:', error);
    } finally {
      setLoading(false);
    }
  };

  const getDepartments = (data: any[]) => {
    const deptMap = new Map<string, number>();
    data.forEach(assignment => {
      const dept = assignment.department || '未分類';
      deptMap.set(dept, (deptMap.get(dept) || 0) + 1);
    });
    return Array.from(deptMap.keys()).sort();
  };

  const getDepartmentCount = (dept: string) => {
    return assignments.filter(a => (a.department || '未分類') === dept).length;
  };

  const getDepartmentAssignments = (dept: string) => {
    return assignments.filter(a => (a.department || '未分類') === dept);
  };

  const departments = getDepartments(assignments);
  const pendingCount = assignments.filter(a => a.status === 'pending').length;
  const inProgressCount = assignments.filter(a => a.status === 'in_progress').length;
  const completedCount = assignments.filter(a => a.status === 'completed').length;

  const getProgress = (assignment: any) => {
    if (!assignment.template?.steps_schema) return 0;
    const totalSteps = assignment.template.steps_schema.length;
    if (totalSteps === 0) return 0;

    const checkedStepIds = new Set();
    assignment.logs.forEach((log: any) => {
      if (log.step_id !== null && log.step_id !== undefined) {
        const stepIdStr = log.step_id.toString();
        if (log.action === 'complete') {
          checkedStepIds.add(stepIdStr);
        } else if (log.action === 'uncomplete') {
          checkedStepIds.delete(stepIdStr);
        }
      }
    });

    return Math.round((checkedStepIds.size / totalSteps) * 100);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-gray-600">載入中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">我的任務</h1>
          <p className="text-gray-600">管理和執行指派給您的工作流程檢查清單</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="總任務"
            value={assignments.length}
            icon={<ClipboardList className="w-6 h-6" />}
            color="blue"
          />
          <StatCard
            title="待處理"
            value={pendingCount}
            icon={<AlertCircle className="w-6 h-6" />}
            color="gray"
          />
          <StatCard
            title="進行中"
            value={inProgressCount}
            icon={<Clock className="w-6 h-6" />}
            color="yellow"
          />
          <StatCard
            title="已完成"
            value={completedCount}
            icon={<CheckCircle2 className="w-6 h-6" />}
            color="green"
          />
        </div>

        {/* Tasks List */}
        {assignments.length === 0 ? (
          <div className="bg-white rounded-lg shadow-lg p-12 text-center">
            <ClipboardList className="w-16 h-16 mx-auto text-gray-400 mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">目前沒有任務</h3>
            <p className="text-gray-600">當主管指派任務給您時，會顯示在這裡</p>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            {/* Department Tabs */}
            <div className="border-b border-gray-200">
              <div className="flex overflow-x-auto">
                {departments.map((dept) => {
                  const count = getDepartmentCount(dept);
                  const isActive = activeDepartment === dept;
                  
                  return (
                    <button
                      key={dept}
                      onClick={() => setActiveDepartment(dept)}
                      className={`px-6 py-4 font-medium text-sm whitespace-nowrap border-b-2 transition-colors ${
                        isActive
                          ? 'border-blue-600 text-blue-600'
                          : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                      }`}
                    >
                      {dept}
                      <span className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                        isActive
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Department Content */}
            <div className="p-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {getDepartmentAssignments(activeDepartment).map((assignment) => {
                  const progress = getProgress(assignment);
                  const lastActivity = assignment.logs.length > 0
                    ? new Date(assignment.logs[assignment.logs.length - 1].created_at)
                    : new Date(assignment.created_at);
                  const creator = assignment.template?.creator;

                  return (
                    <div key={assignment.id} className="bg-gray-50 rounded-lg shadow hover:shadow-md transition-shadow overflow-hidden border border-gray-200">
                      <div className="p-6">
                        {/* Status Badge */}
                        <div className="flex items-start justify-between mb-4">
                          <h3 className="text-xl font-bold text-gray-900 flex-1">
                            {assignment.template?.title || '未知專案'}
                          </h3>
                          <StatusBadge status={assignment.status} />
                        </div>

                        {/* Creator Info */}
                        {creator && (
                          <div className="mb-4 flex items-center gap-2 text-sm bg-blue-50 border border-blue-200 rounded-lg p-3">
                            <UserIcon className="w-4 h-4 text-blue-600" />
                            <span className="font-medium text-gray-700">發起人：</span>
                            <span className="text-gray-900 font-semibold">
                              {creator.full_name || creator.email}
                            </span>
                            {creator.department && (
                              <span className="ml-auto px-2 py-0.5 bg-blue-600 text-white rounded text-xs font-medium">
                                {creator.department}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Description */}
                        {assignment.template?.description && (
                          <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                            {assignment.template.description}
                          </p>
                        )}

                        {/* Progress */}
                        <div className="mb-4">
                          <div className="flex items-center justify-between text-sm mb-2">
                            <span className="text-gray-600">完成進度</span>
                            <span className="font-semibold text-gray-900">{progress}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full transition-all ${
                                progress === 100
                                  ? 'bg-green-500'
                                  : progress > 0
                                  ? 'bg-blue-500'
                                  : 'bg-gray-300'
                              }`}
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>

                        {/* Meta Info */}
                        <div className="flex items-center gap-4 text-sm text-gray-500 mb-4">
                          <div className="flex items-center gap-1">
                            <ClipboardList className="w-4 h-4" />
                            <span>{assignment.template?.steps_schema?.length || 0} 個步驟</span>
                          </div>
                          {assignment.collaborators && assignment.collaborators.length > 1 && (
                            <div className="flex items-center gap-1">
                              <Users className="w-4 h-4" />
                              <span>{assignment.collaborators.length} 位協作者</span>
                            </div>
                          )}
                        </div>

                        {/* Last Activity */}
                        <div className="text-xs text-gray-500 mb-4">
                          最後更新：{lastActivity.toLocaleString('zh-TW')}
                        </div>

                        {/* Action Button */}
                        <Link
                          href={`/assignment/${assignment.id}`}
                          className="block w-full text-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                        >
                          {progress === 0 ? '開始執行' : progress === 100 ? '查看詳情' : '繼續執行'}
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
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
  color: 'blue' | 'yellow' | 'green' | 'gray';
}) {
  const colorClasses = {
    blue: 'bg-blue-500',
    yellow: 'bg-yellow-500',
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

function StatusBadge({ status }: { status: string }) {
  const statusConfig = {
    pending: {
      label: '待處理',
      classes: 'bg-gray-100 text-gray-800',
    },
    in_progress: {
      label: '進行中',
      classes: 'bg-yellow-100 text-yellow-800',
    },
    completed: {
      label: '已完成',
      classes: 'bg-green-100 text-green-800',
    },
  };

  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;

  return (
    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${config.classes}`}>
      {config.label}
    </span>
  );
}
