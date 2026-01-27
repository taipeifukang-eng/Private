import { getTemplates, getAllAssignments } from '@/app/actions';
import { Plus, FileText } from 'lucide-react';
import Link from 'next/link';
import type { Template } from '@/types/workflow';
import TemplateCardWithStats from '@/components/admin/TemplateCardWithStats';

export default async function TemplatesPage() {
  const result = await getTemplates();
  const templates = result.success ? result.data : [];
  
  const assignmentsResult = await getAllAssignments();
  const allAssignments = assignmentsResult.success ? assignmentsResult.data : [];

  // Filter: only show templates that have active (non-archived) assignments
  const templatesWithActiveAssignments = templates.filter((template) => {
    const templateAssignments = allAssignments.filter((a: any) => a.template_id === template.id);
    return templateAssignments.length > 0;
  });

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">任務管理</h1>
            <p className="text-gray-600">管理所有工作流程</p>
          </div>
          <Link
            href="/admin/create"
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
          >
            <Plus size={20} />
            建立新任務
          </Link>
        </div>

        {templatesWithActiveAssignments.length === 0 ? (
          <div className="bg-white rounded-lg shadow-lg p-12 text-center">
            <FileText className="w-16 h-16 mx-auto text-gray-400 mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">目前沒有進行中的任務</h3>
            <p className="text-gray-600 mb-6">所有任務已完成並封存，或尚未指派任何任務</p>
            <Link
              href="/admin/create"
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
            >
              <Plus size={20} />
              建立新任務
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {templatesWithActiveAssignments.map((template) => {
              const templateAssignments = allAssignments.filter((a: any) => a.template_id === template.id);
              
              return (
                <TemplateCardWithStats
                  key={template.id}
                  template={template}
                  assignments={templateAssignments}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
