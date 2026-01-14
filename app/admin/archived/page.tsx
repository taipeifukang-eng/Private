import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getArchivedAssignments } from '@/app/actions';
import Link from 'next/link';
import { Archive, Calendar, User, Clock, CheckCircle, FileText, ChevronLeft } from 'lucide-react';

export default async function ArchivedPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, full_name')
    .eq('id', user.id)
    .single();

  if (!profile || (profile.role !== 'admin' && profile.role !== 'manager')) {
    redirect('/dashboard');
  }

  const result = await getArchivedAssignments();

  if (!result.success) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-800">錯誤: {result.error}</p>
          </div>
        </div>
      </div>
    );
  }

  const archivedAssignments = result.data || [];

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/admin/templates"
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <ChevronLeft size={24} />
            </Link>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
                <Archive className="text-purple-600" size={32} />
                已封存任務
              </h1>
              <p className="text-gray-600 mt-1">
                查看所有已完成並封存的任務記錄
              </p>
            </div>
          </div>
          <div className="text-sm text-gray-600">
            共 {archivedAssignments.length} 個已封存任務
          </div>
        </div>

        {/* Archived Assignments List */}
        {archivedAssignments.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <Archive size={64} className="mx-auto text-gray-300 mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              尚無已封存任務
            </h3>
            <p className="text-gray-600">
              當任務完成後，您可以選擇封存以保存歷史記錄
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {archivedAssignments.map((assignment) => {
              const createdDate = new Date(assignment.created_at).toLocaleDateString('zh-TW');
              const completedDate = assignment.completed_at 
                ? new Date(assignment.completed_at).toLocaleDateString('zh-TW')
                : '-';
              const archivedDate = assignment.archived_at
                ? new Date(assignment.archived_at).toLocaleDateString('zh-TW')
                : '-';
              
              const totalSteps = assignment.template?.steps_schema?.length || 0;
              const completedSteps = assignment.logs?.filter((log: any) => log.action === 'complete').length || 0;

              return (
                <div key={assignment.id} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6">
                  {/* Template Title and Status */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <h3 className="text-xl font-bold text-gray-900 mb-1">
                        {assignment.template?.title || '未知模板'}
                      </h3>
                      {assignment.template?.description && (
                        <p className="text-sm text-gray-600 mb-2">
                          {assignment.template.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 text-purple-800 rounded-full text-sm font-medium">
                          <Archive size={14} />
                          已封存
                        </span>
                        <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-medium">
                          <CheckCircle size={14} />
                          已完成
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Assignment Details Grid */}
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

                    {/* Creator */}
                    <div className="flex items-start gap-2">
                      <User size={16} className="text-gray-400 mt-1" />
                      <div>
                        <p className="text-xs text-gray-500">發起人</p>
                        <p className="text-sm font-medium text-gray-900">
                          {assignment.creator?.full_name || '未知'}
                        </p>
                      </div>
                    </div>

                    {/* Created Date */}
                    <div className="flex items-start gap-2">
                      <Calendar size={16} className="text-gray-400 mt-1" />
                      <div>
                        <p className="text-xs text-gray-500">建立日期</p>
                        <p className="text-sm font-medium text-gray-900">{createdDate}</p>
                      </div>
                    </div>

                    {/* Completed Date */}
                    <div className="flex items-start gap-2">
                      <CheckCircle size={16} className="text-gray-400 mt-1" />
                      <div>
                        <p className="text-xs text-gray-500">完成日期</p>
                        <p className="text-sm font-medium text-gray-900">{completedDate}</p>
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

                  {/* View Details Button */}
                  <div className="flex gap-2 pt-4 border-t border-gray-200">
                    <Link
                      href={`/assignment/${assignment.id}`}
                      className="flex-1 text-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
                    >
                      查看詳細記錄
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
