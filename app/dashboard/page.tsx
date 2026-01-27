'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Activity, CheckCircle2, Clock, User, RefreshCw, Store, ArrowRight, Calendar } from 'lucide-react';
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

interface ManagedStore {
  id: number;
  store_code: string;
  store_name: string;
}

interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  job_title: string | null;
}

// Calculate progress for an assignment
function calculateProgress(assignment: AssignmentWithDetails): number {
  if (!assignment.template?.steps_schema) return 0;
  
  // Calculate total steps including sub-steps
  const totalSteps = assignment.template.steps_schema.reduce((count, step) => {
    return count + 1 + (step.subSteps?.length || 0);
  }, 0);
  
  if (totalSteps === 0) return 0;
  
  // Sort logs by created_at to ensure correct order
  const sortedLogs = [...(assignment.logs || [])].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  
  // Process logs in order to determine final state of each step
  const checkedStepIds = new Set<string>();
  
  sortedLogs.forEach((log) => {
    if (log.step_id !== null && log.step_id !== undefined) {
      const stepIdStr = log.step_id.toString();
      if (log.action === 'complete') {
        checkedStepIds.add(stepIdStr);
      } else if (log.action === 'uncomplete') {
        checkedStepIds.delete(stepIdStr);
      }
    }
  });
  
  const completedSteps = checkedStepIds.size;
  const progress = Math.round((completedSteps / totalSteps) * 100);
  
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

export default function DashboardPage() {
  const router = useRouter();
  const [assignments, setAssignments] = useState<AssignmentWithDetails[]>([]);
  const [managedStores, setManagedStores] = useState<ManagedStore[]>([]);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    loadData();
    
    // Set up an interval to refresh data periodically
    const interval = setInterval(() => {
      loadData();
    }, 2000); // Refresh every 2 seconds
    
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    await Promise.all([
      loadAssignments(),
      loadManagedStores(),
      loadUserProfile()
    ]);
  };

  const loadUserProfile = async () => {
    try {
      const response = await fetch('/api/user/profile');
      if (response.ok) {
        const data = await response.json();
        setUserProfile(data.profile);
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const loadManagedStores = async () => {
    try {
      const response = await fetch('/api/user/managed-stores');
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setManagedStores(data.stores || []);
        }
      }
    } catch (error) {
      console.error('Error loading managed stores:', error);
    }
  };

  const loadAssignments = async () => {
    try {
      const { getAssignments } = await import('@/app/actions');
      const result = await getAssignments();
      
      if (result.success) {
        console.log('[Dashboard] Loaded assignments:', result.data.length);
        // Log each assignment's progress for debugging
        result.data.forEach((assignment: any) => {
          const progress = calculateProgress(assignment as AssignmentWithDetails);
          console.log(`[Dashboard] ${assignment.template?.title}: ${progress}%, logs count: ${assignment.logs?.length || 0}`);
        });
        setAssignments(result.data as AssignmentWithDetails[]);
      }
    } catch (error) {
      console.error('Error loading assignments:', error);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await loadData();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-gray-600">載入中...</div>
      </div>
    );
  }
  
  // Calculate statistics
  const totalAssignments = assignments.length;
  const completedAssignments = assignments.filter(a => a.status === 'completed').length;
  const inProgressAssignments = assignments.filter(a => a.status === 'in_progress').length;
  const pendingAssignments = assignments.filter(a => a.status === 'pending').length;
  
  // 獲取當前年月
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            歡迎回來，{userProfile?.full_name || userProfile?.email}
          </h1>
          <p className="text-gray-600">您是專案經理 · 可以管理流程和指派任務</p>
        </div>

        {/* 管理功能區 */}
        {managedStores && managedStores.length > 0 && (
          <div className="mb-8 bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Store className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">管理功能</h2>
                  <p className="text-sm text-gray-600">查看和管理所負責門市和團隊狀態</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 指派檔案表數 */}
              <Link
                href="/admin/assign/create"
                className="flex items-center justify-between p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center group-hover:bg-purple-200 transition-colors">
                    <Activity className="w-6 h-6 text-purple-600" />
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">指派檔案表數</div>
                    <div className="text-sm text-gray-500">建立和指派工作流程</div>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-gray-400 group-hover:text-blue-600 transition-colors" />
              </Link>

              {/* 月人員狀態管理 */}
              <Link
                href="/monthly-status"
                className="flex items-center justify-between p-4 border-2 border-blue-200 bg-blue-50 rounded-lg hover:border-blue-500 hover:bg-blue-100 transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                    <Calendar className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">月人員狀態</div>
                    <div className="text-sm text-gray-600">
                      {currentYear}年{currentMonth}月 · {managedStores.length} 間門市
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-5 h-5 text-blue-600 group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>
          </div>
        )}

        {/* 快速連結區（適用於所有人員） */}
        {(!managedStores || managedStores.length === 0) && (
          <div className="mb-8 bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Calendar className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">快速功能</h2>
                <p className="text-sm text-gray-600">查看個人相關資訊</p>
              </div>
            </div>

            <Link
              href="/monthly-status"
              className="flex items-center justify-between p-4 border-2 border-blue-200 bg-blue-50 rounded-lg hover:border-blue-500 hover:bg-blue-100 transition-all group"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                  <Calendar className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <div className="font-semibold text-gray-900">查看本月人員狀態</div>
                  <div className="text-sm text-gray-600">
                    {currentYear}年{currentMonth}月
                  </div>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-blue-600 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        )}

        {/* Assignments Table */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">我的任務</h2>
            <button
              onClick={handleManualRefresh}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              {isRefreshing ? '更新中' : '刷新'}
            </button>
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
                          <StatusBadge status={progress === 100 ? 'completed' : progress > 0 ? 'in_progress' : 'pending'} />
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
