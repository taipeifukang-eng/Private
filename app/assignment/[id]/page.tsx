import { getCurrentUser } from '@/app/auth/actions';
import { getAssignment } from '@/app/actions';
import ChecklistRunner from '@/components/user/ChecklistRunner';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Log } from '@/types/workflow';

export default async function AssignmentPage({
  params,
}: {
  params: { id: string };
}) {
  const { user } = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  const result = await getAssignment(params.id);

  if (!result.success || !result.data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">任務不存在</h1>
          <Link
            href="/my-tasks"
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            返回我的任務
          </Link>
        </div>
      </div>
    );
  }

  const assignment = result.data;

  // Check if user has access to this assignment (must be a collaborator or admin)
  const isCollaborator = assignment.collaborators?.some((c: any) => c.id === user.id);
  const isAdmin = user.profile?.role === 'admin' || user.profile?.role === 'manager';
  
  if (!isCollaborator && !isAdmin) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">無權訪問</h1>
          <p className="text-gray-600 mb-4">您沒有權限查看此任務</p>
          <Link
            href="/my-tasks"
            className="text-blue-600 hover:text-blue-800 font-medium"
          >
            返回我的任務
          </Link>
        </div>
      </div>
    );
  }

  // Calculate initially checked steps from logs
  const checkedStepIds = new Set<string>();
  assignment.logs.forEach((log: Log) => {
    if (log.step_id !== null && log.step_id !== undefined) {
      if (log.action === 'complete') {
        checkedStepIds.add(log.step_id.toString());
      } else if (log.action === 'uncomplete') {
        checkedStepIds.delete(log.step_id.toString());
      }
    }
  });

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link
            href="/my-tasks"
            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium mb-4"
          >
            <ArrowLeft size={20} />
            返回我的任務
          </Link>

          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                {assignment.template?.title || '任務執行'}
              </h1>
              {assignment.template?.description && (
                <p className="text-gray-600">{assignment.template.description}</p>
              )}
            </div>
          </div>
        </div>

        {/* Checklist Runner */}
        <ChecklistRunner
          assignment={assignment as any}
          initialCheckedSteps={checkedStepIds}
        />
      </div>
    </div>
  );
}
