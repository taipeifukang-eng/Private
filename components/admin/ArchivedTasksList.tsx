'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Archive, Calendar, User, Clock, CheckCircle, ChevronDown, ChevronRight, Copy } from 'lucide-react';

interface ArchivedTasksListProps {
  groupedByMonth: Record<string, any[]>;
  sortedMonths: string[];
}

export default function ArchivedTasksList({ groupedByMonth, sortedMonths }: ArchivedTasksListProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(sortedMonths[0] || '');
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [isDuplicating, setIsDuplicating] = useState(false);

  console.log('[ArchivedTasksList] Received data:', {
    sortedMonths,
    activeTab,
    tasksInActiveTab: groupedByMonth[activeTab]?.map(a => ({
      id: a.id,
      created_by: a.created_by,
      creator: a.creator,
      assignee: a.assignee
    }))
  });

  const toggleTask = (taskId: string) => {
    const newExpanded = new Set(expandedTasks);
    if (newExpanded.has(taskId)) {
      newExpanded.delete(taskId);
    } else {
      newExpanded.add(taskId);
    }
    setExpandedTasks(newExpanded);
  };

  const handleDuplicate = async (assignmentId: string, originalTitle: string) => {
    console.log('[ArchivedTasksList] handleDuplicate called for:', assignmentId);
    
    const confirmed = confirm(
      `複製已封存任務「${originalTitle}」\n\n` +
      `將建立一個新的任務並指派給您。\n` +
      `新任務將使用相同的流程模板，所有步驟重置為未完成狀態。\n\n` +
      `確定要複製嗎？`
    );

    // User cancelled
    if (!confirmed) {
      console.log('[ArchivedTasksList] Duplicate cancelled by user');
      return;
    }

    setIsDuplicating(true);
    console.log('[ArchivedTasksList] Duplicating assignment:', assignmentId);

    try {
      const { duplicateArchivedAssignment } = await import('@/app/actions');
      console.log('[ArchivedTasksList] Action imported successfully');
      
      const result = await duplicateArchivedAssignment(assignmentId);
      console.log('[ArchivedTasksList] Duplicate result:', result);
      
      if (result.success) {
        alert(`✅ 成功複製任務\n\n新任務已指派給您，可在「我的任務」頁面查看。`);
        router.refresh();
      } else {
        console.error('[ArchivedTasksList] Duplicate failed:', result.error);
        alert(`❌ 複製失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('[ArchivedTasksList] Error duplicating assignment:', error);
      alert(`❌ 複製失敗: ${error instanceof Error ? error.message : '未知錯誤'}`);
    } finally {
      setIsDuplicating(false);
      console.log('[ArchivedTasksList] Duplicate process ended');
    }
  };

  return (
    <div>
      {/* Tabs */}
      <div className="mb-6 border-b border-gray-200">
        <div className="flex flex-wrap gap-2">
          {sortedMonths.map((month) => (
            <button
              key={month}
              onClick={() => setActiveTab(month)}
              className={`px-4 py-2 font-medium text-sm transition-colors border-b-2 ${
                activeTab === month
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {month}
              <span className="ml-2 text-xs bg-gray-100 px-2 py-1 rounded-full">
                {groupedByMonth[month].length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Tasks List */}
      <div className="space-y-3">
        {groupedByMonth[activeTab]?.map((assignment) => {
          const isExpanded = expandedTasks.has(assignment.id);
          const createdDate = new Date(assignment.created_at).toLocaleDateString('zh-TW', {
            year: 'numeric', month: '2-digit', day: '2-digit', 
            hour: '2-digit', minute: '2-digit'
          });
          const completedDate = assignment.completed_at 
            ? new Date(assignment.completed_at).toLocaleDateString('zh-TW', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit'
              })
            : '-';
          const archivedDate = assignment.archived_at
            ? new Date(assignment.archived_at).toLocaleDateString('zh-TW', {
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit'
              })
            : '-';
          
          const totalSteps = assignment.template?.steps_schema?.length || 0;
          const completeLogs = assignment.logs?.filter((log: any) => log.action === 'complete') || [];
          const completedSteps = completeLogs.length;

          return (
            <div key={assignment.id} className="bg-white rounded-lg shadow hover:shadow-md transition-all">
              {/* Collapsed View - 點擊展開 */}
              <button
                onClick={() => toggleTask(assignment.id)}
                className="w-full px-6 py-4 text-left hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between gap-4">
                  {/* Left side - Task Name */}
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {isExpanded ? (
                      <ChevronDown size={20} className="text-gray-400 flex-shrink-0" />
                    ) : (
                      <ChevronRight size={20} className="text-gray-400 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-bold text-gray-900 truncate">
                        {assignment.template?.title || '未知模板'}
                      </h3>
                    </div>
                  </div>

                  {/* Right side - Key Info */}
                  <div className="flex items-center gap-6 flex-shrink-0">
                    {/* Created Date */}
                    <div className="hidden md:flex items-center gap-2">
                      <Calendar size={16} className="text-gray-400" />
                      <div className="text-sm">
                        <p className="text-xs text-gray-500">建立</p>
                        <p className="font-medium text-gray-900">{createdDate}</p>
                      </div>
                    </div>

                    {/* Completed Date */}
                    <div className="hidden md:flex items-center gap-2">
                      <CheckCircle size={16} className="text-gray-400" />
                      <div className="text-sm">
                        <p className="text-xs text-gray-500">完成</p>
                        <p className="font-medium text-gray-900">{completedDate}</p>
                      </div>
                    </div>

                    {/* Creator */}
                    <div className="hidden lg:flex items-center gap-2">
                      <User size={16} className="text-gray-400" />
                      <div className="text-sm">
                        <p className="text-xs text-gray-500">發起人</p>
                        <p className="font-medium text-gray-900">
                          {assignment.creator?.full_name || '未知'}
                        </p>
                      </div>
                    </div>

                    {/* Status Badge */}
                    <span className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-medium">
                      <Archive size={12} />
                      已封存
                    </span>
                  </div>
                </div>
              </button>

              {/* Expanded View - 詳細資訊 */}
              {isExpanded && (
                <div className="px-6 pb-6 border-t border-gray-100">
                  {/* Template Description */}
                  {assignment.template?.description && (
                    <div className="mt-4 mb-4">
                      <p className="text-sm text-gray-600">{assignment.template.description}</p>
                    </div>
                  )}

                  {/* Additional Status */}
                  <div className="flex items-center gap-2 mb-4">
                    <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                      <CheckCircle size={14} />
                      已完成
                    </span>
                  </div>

                  {/* Mobile: Show dates that are hidden in collapsed view */}
                  <div className="md:hidden grid grid-cols-2 gap-4 mb-4">
                    <div className="flex items-start gap-2">
                      <Calendar size={16} className="text-gray-400 mt-1" />
                      <div>
                        <p className="text-xs text-gray-500">建立日期</p>
                        <p className="text-sm font-medium text-gray-900">{createdDate}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <CheckCircle size={16} className="text-gray-400 mt-1" />
                      <div>
                        <p className="text-xs text-gray-500">完成日期</p>
                        <p className="text-sm font-medium text-gray-900">{completedDate}</p>
                      </div>
                    </div>
                  </div>

                  {/* Details Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                    {/* Assigned To */}
                    <div className="flex items-start gap-2">
                      <User size={16} className="text-gray-400 mt-1" />
                      <div>
                        <p className="text-xs text-gray-500">負責人</p>
                        <p className="text-sm font-medium text-gray-900">
                          {assignment.assignee?.full_name || '未知'}
                        </p>
                      </div>
                    </div>

                    {/* Creator - Show on mobile */}
                    <div className="lg:hidden flex items-start gap-2">
                      <User size={16} className="text-gray-400 mt-1" />
                      <div>
                        <p className="text-xs text-gray-500">發起人</p>
                        <p className="text-sm font-medium text-gray-900">
                          {assignment.creator?.full_name || '未知'}
                        </p>
                      </div>
                    </div>

                    {/* Archived Date */}
                    <div className="flex items-start gap-2">
                      <Archive size={16} className="text-gray-400 mt-1" />
                      <div>
                        <p className="text-xs text-gray-500">封存日期</p>
                        <p className="text-sm font-medium text-gray-900">{archivedDate}</p>
                      </div>
                    </div>

                    {/* Archived By */}
                    <div className="flex items-start gap-2">
                      <User size={16} className="text-gray-400 mt-1" />
                      <div>
                        <p className="text-xs text-gray-500">封存者</p>
                        <p className="text-sm font-medium text-gray-900">
                          {assignment.archived_by_user?.full_name || '未知'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Progress */}
                  <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">步驟完成度</span>
                      <span className="text-sm font-bold text-green-600">
                        {completedSteps} / {totalSteps}
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-green-500 h-2 rounded-full transition-all"
                        style={{ width: totalSteps > 0 ? `${(completedSteps / totalSteps) * 100}%` : '0%' }}
                      />
                    </div>
                  </div>

                  {/* Collaborators */}
                  {assignment.collaborators && assignment.collaborators.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs text-gray-500 mb-2">協作者</p>
                      <div className="flex flex-wrap gap-2">
                        {assignment.collaborators.map((collab: any) => (
                          <span
                            key={collab.user_id}
                            className="inline-flex items-center gap-1 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm"
                          >
                            <User size={12} />
                            {collab.user?.full_name || '未知'}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Department */}
                  {assignment.department && (
                    <div className="mb-4">
                      <p className="text-xs text-gray-500 mb-1">部門</p>
                      <span className="inline-flex items-center px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full text-sm font-medium">
                        {assignment.department}
                      </span>
                    </div>
                  )}

                  {/* Timeline of Step Completions */}
                  {completeLogs.length > 0 && (
                    <div className="mb-4">
                      <p className="text-sm font-medium text-gray-700 mb-3">任務執行時間軌跡</p>
                      <div className="bg-gray-50 rounded-lg p-4 max-h-64 overflow-y-auto">
                        <div className="space-y-3">
                          {completeLogs
                            .sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                            .map((log: any, index: number) => {
                              const step = assignment.template?.steps_schema?.find((s: any) => s.id === log.step_id);
                              const logDate = new Date(log.created_at).toLocaleDateString('zh-TW', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit'
                              });
                              
                              return (
                                <div key={log.id} className="flex items-start gap-3 pb-3 border-b border-gray-200 last:border-0">
                                  <div className="flex-shrink-0 w-8 h-8 bg-green-100 text-green-700 rounded-full flex items-center justify-center text-sm font-bold">
                                    {index + 1}
                                  </div>
                                  <div className="flex-1">
                                    <p className="text-sm font-medium text-gray-900">
                                      {step?.label || `步驟 ${log.step_id}`}
                                    </p>
                                    {step?.description && (
                                      <p className="text-xs text-gray-600 mt-1">{step.description}</p>
                                    )}
                                    <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                                      <Clock size={12} />
                                      <span>{logDate}</span>
                                    </div>
                                  </div>
                                  <CheckCircle size={20} className="text-green-500 flex-shrink-0" />
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* View Details Button */}
                  <div className="flex gap-2 pt-4 border-t border-gray-200">
                    <button
                      onClick={() => handleDuplicate(assignment.id, assignment.template?.title || assignment.title)}
                      disabled={isDuplicating}
                      className="flex-1 text-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Copy size={16} />
                      {isDuplicating ? '複製中...' : '複製為新任務'}
                    </button>
                    <Link
                      href={`/assignment/${assignment.id}`}
                      className="flex-1 text-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
                    >
                      查看詳細記錄
                    </Link>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
