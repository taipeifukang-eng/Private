import { getCurrentUser } from '@/app/auth/actions';
import { getAssignments } from '@/app/actions';
import { redirect } from 'next/navigation';
import { ClipboardList, CheckCircle2, Clock, AlertCircle, Users } from 'lucide-react';
import Link from 'next/link';

export default async function MyTasksPage() {
  const { user } = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  // Get all assignments (already filtered by collaborations in getAssignments)
  const result = await getAssignments();
  const myAssignments = result.success ? result.data : [];

  // Group assignments by department
  const assignmentsByDepartment = myAssignments.reduce((acc: any, assignment: any) => {
    const dept = assignment.department || '未分類';
    if (!acc[dept]) {
      acc[dept] = [];
    }
    acc[dept].push(assignment);
    return acc;
  }, {});

  const departments = Object.keys(assignmentsByDepartment).sort();

  // Calculate stats
  const pendingCount = myAssignments.filter(a => a.status === 'pending').length;
  const inProgressCount = myAssignments.filter(a => a.status === 'in_progress').length;
  const completedCount = myAssignments.filter(a => a.status === 'completed').length;

  // Calculate progress for each assignment
  const getProgress = (assignment: any) => {
    if (!assignment.template?.steps_schema) return 0;
    const totalSteps = assignment.template.steps_schema.length;
    if (totalSteps === 0) return 0;

    const checkedStepIds = new Set();
    assignment.logs.forEach((log: any) => {
      if (log.action === 'checked') {
        checkedStepIds.add(log.step_id);
      } else if (log.action === 'unchecked') {
        checkedStepIds.delete(log.step_id);
      }
    });

    return Math.round((checkedStepIds.size / totalSteps) * 100);
  };

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
            value={myAssignments.length}
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
        {myAssignments.length === 0 ? (
          <div className="bg-white rounded-lg shadow-lg p-12 text-center">
            <ClipboardList className="w-16 h-16 mx-auto text-gray-400 mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">目前沒有任務</h3>
            <p className="text-gray-600">當主管指派任務給您時，會顯示在這裡</p>
          </div>
        ) : (
          <div className="space-y-8">
            {departments.map((department) => (
              <div key={department} className="bg-white rounded-lg shadow-lg p-6">
                {/* Department Header */}
                <div className="mb-6 pb-4 border-b border-gray-200">
                  <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                    <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-600 text-lg font-bold">
                      {department[0]}
                    </span>
                    {department}
                  </h2>
                  <p className="text-gray-600 mt-2">
                    共 {assignmentsByDepartment[department].length} 個任務
                  </p>
                </div>

                {/* Tasks in this department */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {assignmentsByDepartment[department].map((assignment: any) => {
              const progress = getProgress(assignment);
              const lastActivity = assignment.logs.length > 0
                ? new Date(assignment.logs[assignment.logs.length - 1].created_at)
                : new Date(assignment.created_at);

              return (
                <div key={assignment.id} className="bg-white rounded-lg shadow-lg hover:shadow-xl transition-shadow overflow-hidden">
                  <div className="p-6">
                    {/* Status Badge */}
                    <div className="flex items-start justify-between mb-4">
                      <h3 className="text-xl font-bold text-gray-900 flex-1">
                        {assignment.template?.title || '未知專案'}
                      </h3>
                      <StatusBadge status={assignment.status} />
                    </div>

                    {assignment.template?.description && (
                      <p className="text-sm text-gray-600 mb-4">
                        {assignment.template.description}
                      </p>
                    )}

                    {/* Progress Bar */}
                    <div className="mb-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-700">完成進度</span>
                        <span className="text-sm font-semibold text-blue-600">{progress}%</span>
                      </div>
                      <div className="w-full bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full transition-all ${
                            progress === 100
                              ? 'bg-green-500'
                              : progress > 50
                              ? 'bg-blue-500'
                              : 'bg-yellow-500'
                          }`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    {/* Meta Info */}
                    <div className="flex items-center gap-4 text-sm text-gray-500 mb-4 flex-wrap">
                      <div className="flex items-center gap-1">
                        <ClipboardList size={16} />
                        <span>{assignment.template?.steps_schema?.length || 0} 個步驟</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock size={16} />
                        <span>{formatRelativeTime(lastActivity)}</span>
                      </div>
                      {assignment.collaborators && assignment.collaborators.length > 1 && (
                        <div className="flex items-center gap-1 text-purple-600">
                          <Users size={16} />
                          <span>{assignment.collaborators.length} 人協作</span>
                        </div>
                      )}
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
            ))}
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
    pending: { label: '待處理', classes: 'bg-gray-100 text-gray-800' },
    in_progress: { label: '進行中', classes: 'bg-blue-100 text-blue-800' },
    completed: { label: '已完成', classes: 'bg-green-100 text-green-800' },
  };

  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;

  return (
    <span className={`px-3 py-1 text-xs font-semibold rounded-full ${config.classes}`}>
      {config.label}
    </span>
  );
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '剛剛';
  if (diffMins < 60) return `${diffMins} 分鐘前`;
  if (diffHours < 24) return `${diffHours} 小時前`;
  if (diffDays < 7) return `${diffDays} 天前`;

  return date.toLocaleDateString('zh-TW');
}
