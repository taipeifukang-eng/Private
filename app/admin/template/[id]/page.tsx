import { getCurrentUser } from '@/app/auth/actions';
import { getTemplates, getAssignments } from '@/app/actions';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileText, Calendar, User, CheckSquare, Users, Trash2 } from 'lucide-react';
import { WorkflowStep } from '@/types/workflow';
import DeleteAssignmentButton from '@/components/admin/DeleteAssignmentButton';

export default async function TemplateDetailPage({ params }: { params: { id: string } }) {
  const { user } = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  // Check if user has access (admin or manager)
  if (user.profile?.role !== 'admin' && user.profile?.role !== 'manager') {
    redirect('/');
  }

  const result = await getTemplates();
  const templates = result.success ? result.data : [];
  const template = templates.find(t => t.id === params.id);

  if (!template) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">流程不存在</h1>
          <Link
            href="/admin/templates"
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            返回流程管理
          </Link>
        </div>
      </div>
    );
  }

  // Get all assignments for this template
  const assignmentsResult = await getAssignments();
  const allAssignments = assignmentsResult.success ? assignmentsResult.data : [];
  const templateAssignments = allAssignments.filter(a => a.template_id === params.id);

  const createdDate = new Date(template.created_at).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full">
        {/* Header */}
        <div className="mb-6">
          <Link
            href="/admin/templates"
            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium mb-4"
          >
            <ArrowLeft size={20} />
            返回任務管理
          </Link>

          <div className="bg-white rounded-lg shadow-lg p-8">
            {/* Title Section */}
            <div className="mb-6">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                {template.title}
              </h1>
              {template.description && (
                <p className="text-gray-600 text-lg">{template.description}</p>
              )}
            </div>

            {/* Meta Info */}
            <div className="flex flex-wrap items-center gap-6 pb-6 border-b border-gray-200">
              <div className="flex items-center gap-2 text-gray-600">
                <Calendar size={20} />
                <div>
                  <p className="text-xs text-gray-500">建立時間</p>
                  <p className="font-medium">{createdDate}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-gray-600">
                <FileText size={20} />
                <div>
                  <p className="text-xs text-gray-500">步驟數量</p>
                  <p className="font-medium">{template.steps_schema?.length || 0} 個步驟</p>
                </div>
              </div>
            </div>

            {/* Steps Section */}
            <div className="mt-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                <CheckSquare size={24} className="text-blue-600" />
                流程步驟
              </h2>

              {template.steps_schema && template.steps_schema.length > 0 ? (
                <div className="space-y-3">
                  {template.steps_schema.map((step: WorkflowStep, index: number) => (
                    <div
                      key={index}
                      className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-semibold">
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <p className="text-gray-900 font-medium">{step.label}</p>
                        {step.description && (
                          <p className="text-sm text-gray-600 mt-1">{step.description}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-8">此流程尚未設定步驟</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-4 mt-8 pt-6 border-t border-gray-200">
              <Link
                href={`/admin/assign/${template.id}`}
                className="flex-1 text-center px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-semibold"
              >
                指派任務給使用者
              </Link>
              <Link
                href="/admin/templates"
                className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold"
              >
                返回列表
              </Link>
            </div>
          </div>
        </div>

        {/* Assignments Section */}
        <div className="bg-white rounded-lg shadow-lg p-8 mt-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <Users size={24} className="text-green-600" />
            已指派任務
          </h2>

          {templateAssignments.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Users className="w-12 h-12 mx-auto mb-3 text-gray-400" />
              <p>此流程尚未指派給任何使用者</p>
              <Link
                href={`/admin/assign/${template.id}`}
                className="inline-block mt-4 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
              >
                立即指派
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {templateAssignments.map((assignment: any) => {
                // Calculate progress
                const totalSteps = template.steps_schema?.length || 0;
                const checkedStepIds = new Set<string>();
                
                assignment.logs?.forEach((log: any) => {
                  if (log.step_id !== null && log.step_id !== undefined) {
                    const stepIdStr = log.step_id.toString();
                    if (log.action === 'checked') {
                      checkedStepIds.add(stepIdStr);
                    } else if (log.action === 'unchecked') {
                      checkedStepIds.delete(stepIdStr);
                    }
                  }
                });
                
                const progress = totalSteps > 0 ? Math.round((checkedStepIds.size / totalSteps) * 100) : 0;
                const createdDate = new Date(assignment.created_at).toLocaleDateString('zh-TW');
                const collaboratorCount = assignment.collaborators?.length || 0;

                return (
                  <div
                    key={assignment.id}
                    className="border border-gray-200 rounded-lg p-5 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        {/* Status and Collaborators */}
                        <div className="flex items-center gap-3 mb-3">
                          <StatusBadge status={assignment.status} />
                          {collaboratorCount > 1 && (
                            <span className="text-sm text-purple-600 flex items-center gap-1">
                              <Users size={16} />
                              {collaboratorCount} 人協作
                            </span>
                          )}
                        </div>

                        {/* Collaborators List */}
                        {assignment.collaborators && assignment.collaborators.length > 0 && (
                          <div className="mb-3">
                            <p className="text-sm text-gray-600 mb-1">協作成員：</p>
                            <div className="flex flex-wrap gap-2">
                              {assignment.collaborators.map((collaborator: any) => (
                                <span
                                  key={collaborator.id}
                                  className="px-2 py-1 bg-gray-100 text-gray-700 text-sm rounded"
                                >
                                  {collaborator.full_name || collaborator.email}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Progress Bar */}
                        <div className="mb-2">
                          <div className="flex items-center justify-between mb-1">
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

                        {/* Date */}
                        <p className="text-sm text-gray-500">指派日期：{createdDate}</p>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2 ml-4">
                        <Link
                          href={`/assignment/${assignment.id}`}
                          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium whitespace-nowrap"
                        >
                          查看詳情
                        </Link>
                        {assignment.status === 'completed' && (
                          <DeleteAssignmentButton
                            assignmentId={assignment.id}
                            assignmentTitle={template.title}
                            isCompleted={true}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
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
