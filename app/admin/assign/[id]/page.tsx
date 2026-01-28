import { getTemplates } from '@/app/actions';
import AssignTemplateForm from '@/components/admin/AssignTemplateForm';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function AssignPage({ params }: { params: { id: string } }) {
  const result = await getTemplates();
  
  if (!result.success) {
    return <div>載入失敗</div>;
  }

  const template = result.data.find(t => t.id === params.id);

  if (!template) {
    notFound();
  }

  return <AssignTemplateForm templateId={template.id} templateTitle={template.title} />;
}
