import { getTemplates, getAssignments } from '@/app/actions';
import { redirect } from 'next/navigation';
import WorkflowBuilderV2 from '@/components/admin/WorkflowBuilderV2';

export const dynamic = 'force-dynamic';

export default async function EditTemplatePage({ params }: { params: { id: string } }) {
  const result = await getTemplates();
  const templates = result.success ? result.data : [];
  const template = templates.find(t => t.id === params.id);

  if (!template) {
    redirect('/admin/templates');
  }

  // Get all assignments for this template to check usage
  const assignmentsResult = await getAssignments();
  const allAssignments = assignmentsResult.success ? assignmentsResult.data : [];
  const templateAssignments = allAssignments.filter(a => a.template_id === params.id);

  // Check if any assignments are in progress or completed
  const hasActiveAssignments = templateAssignments.some(a => 
    a.status === 'in_progress' || a.status === 'completed'
  );
  const hasCompletedAssignments = templateAssignments.some(a => a.status === 'completed');

  return (
    <WorkflowBuilderV2 
      template={template}
      isEditing={true}
      hasActiveAssignments={hasActiveAssignments}
      hasCompletedAssignments={hasCompletedAssignments}
    />
  );
}
