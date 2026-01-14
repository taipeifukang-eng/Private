import { getTemplates, getAssignments } from '@/app/actions';
import { redirect } from 'next/navigation';
import WorkflowBuilder from '@/components/admin/WorkflowBuilder';

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

  // Collect all step IDs that have been checked in any assignment
  const checkedStepIds = new Set<number>();
  if (hasActiveAssignments) {
    templateAssignments.forEach((assignment: any) => {
      if (assignment.status === 'in_progress' || assignment.status === 'completed') {
        assignment.logs?.forEach((log: any) => {
          if (log.step_id !== null && log.step_id !== undefined && log.action === 'checked') {
            checkedStepIds.add(log.step_id);
          }
        });
      }
    });
  }

  return (
    <WorkflowBuilder 
      template={template}
      isEditing={true}
      hasActiveAssignments={hasActiveAssignments}
      hasCompletedAssignments={hasCompletedAssignments}
      checkedStepIds={Array.from(checkedStepIds)}
    />
  );
}
