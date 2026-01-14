import { getAssignments } from '@/app/actions';
import { Activity, CheckCircle2, Clock, User } from 'lucide-react';
import type { Assignment, Template, Log } from '@/types/workflow';

// Extended types for joined data
interface AssignmentWithDetails extends Assignment {
  template: Template | null;
  logs: Log[];
  assigned_user?: {
    email: string;
    full_name?: string;
  };
}

async function fetchAssignments(): Promise<AssignmentWithDetails[]> {
  const result = await getAssignments();
  
  if (!result.success) {
    console.error('Failed to fetch assignments:', result.error);
    return [];
  }
  
  return result.data as AssignmentWithDetails[];
}

// Calculate progress for an assignment
function calculateProgress(assignment: AssignmentWithDetails): number {
  if (!assignment.template?.steps_schema) return 0;
  
  const totalSteps = assignment.template.steps_schema.length;
  if (totalSteps === 0) return 0;
  
  // Debug logging
  console.log('Assignment ID:', assignment.id);
  console.log('Total steps:', totalSteps);
  console.log('Logs:', assignment.logs);
  console.log('Steps schema:', assignment.template.steps_schema);
  
  // Process logs in order to determine final state of each step
  const checkedStepIds = new Set<string>();
  
  assignment.logs.forEach((log) => {
    console.log('Processing log:', log);
    if (log.step_id !== null && log.step_id !== undefined) {
      const stepIdStr = log.step_id.toString();
      if (log.action === 'complete') {
        checkedStepIds.add(stepIdStr);
        console.log('Added step:', stepIdStr);
      } else if (log.action === 'uncomplete') {
        checkedStepIds.delete(stepIdStr);
        console.log('Removed step:', stepIdStr);
      }
    }
  });
  
  console.log('Final checked steps:', Array.from(checkedStepIds));
  const completedSteps = checkedStepIds.size;
  const progress = Math.round((completedSteps / totalSteps) * 100);
  console.log('Progress:', progress, '%');
  
  return progress;
}

// Get last activity time
function getLastActivity(assignment: AssignmentWithDetails): Date | null {
  if (assignment.logs.length === 0) return null;
  
  const sortedLogs = assignment.logs.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  
  return new Date(sortedLogs[0].created_at);
}

// Format relative time
function formatRelativeTime(date: Date | null): string {
  if (!date) return '無活動記錄';
  
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

export default async function DashboardPage() {
  const assignments = await fetchAssignments();
  
  // Calculate statistics
  const totalAssignments = assignments.length;
  const completedAssignments = assignments.filter(a => a.status === 'completed').length;
  const inProgressAssignments = assignments.filter(a => a.status === 'in_progress').length;
  const pendingAssignments = assignments.filter(a => a.status === 'pending').length;

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">管理儀表板</h1>
          <p className="text-gray-600">檢視所有專案進度與任務狀態</p>
        </div>

        {/* Statistics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <StatCard
            title="總任務數"
            value={totalAssignments}
            icon={<Activity className="w-6 h-6" />}
            color="blue"
          />
          <StatCard
            title="進行中"
            value={inProgressAssignments}
            icon={<Clock className="w-6 h-6" />}
            color="yellow"
          />
          <StatCard
            title="已完成"
            value={completedAssignments}
            icon={<CheckCircle2 className="w-6 h-6" />}
            color="green"
          />
          <StatCard
            title="待處理"
            value={pendingAssignments}
            icon={<User className="w-6 h-6" />}
            color="gray"
          />
        </div>

        {/* Assignments Table */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900">所有任務</h2>
          </div>

          {assignments.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <div className="text-gray-400 mb-4">
                <Activity className="w-16 h-16 mx-auto" />
              </div>
              <p className="text-gray-600 text-lg">目前沒有任何任務</p>
              <p className="text-gray-500 text-sm mt-2">建立流程並指派給使用者後，任務將會顯示在這裡</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      專案名稱
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      指派使用者
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      狀態
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      完成進度
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      最後活動時間
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {assignments.map((assignment) => {
                    const progress = calculateProgress(assignment);
                    const lastActivity = getLastActivity(assignment);
                    
                    return (
                      <tr key={assignment.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">
                            {assignment.template?.title || '未知專案'}
                          </div>
                          <div className="text-sm text-gray-500">
                            {assignment.template?.description || '無描述'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                              {assignment.assigned_user?.full_name?.[0] || 
                               assignment.assigned_user?.email?.[0]?.toUpperCase() || 
                               '?'}
                            </div>
                            <div className="ml-3">
                              <div className="text-sm font-medium text-gray-900">
                                {assignment.assigned_user?.full_name || '未命名'}
                              </div>
                              <div className="text-sm text-gray-500">
                                {assignment.assigned_user?.email || '無郵件'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <StatusBadge status={assignment.status} />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-1 mr-3">
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
                            <span className="text-sm font-semibold text-gray-700 min-w-[3rem]">
                              {progress}%
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {formatRelativeTime(lastActivity)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <a
                            href={`/assignment/${assignment.id}`}
                            className="text-blue-600 hover:text-blue-800 font-medium"
                          >
                            查看詳情
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Stat Card Component
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

// Status Badge Component
function StatusBadge({ status }: { status: string }) {
  const statusConfig = {
    pending: { label: '待處理', classes: 'bg-gray-100 text-gray-800' },
    in_progress: { label: '進行中', classes: 'bg-blue-100 text-blue-800' },
    completed: { label: '已完成', classes: 'bg-green-100 text-green-800' },
  };

  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;

  return (
    <span
      className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${config.classes}`}
    >
      {config.label}
    </span>
  );
}
