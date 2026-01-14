import { getTemplates, getAssignments } from '@/app/actions';
import { Plus, FileText } from 'lucide-react';
import Link from 'next/link';
import type { Template } from '@/types/workflow';
import TemplateCardWithStats from '@/components/admin/TemplateCardWithStats';

export default async function TemplatesPage() {
  const result = await getTemplates();
  const templates = result.success ? result.data : [];
  
  // Get all assignments to calculate statistics
  const assignmentsResult = await getAssignments();
  const allAssignments = assignmentsResult.success ? assignmentsResult.data : [];

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">流程管理</h1>
            <p className="text-gray-600">管理所有工作流程</p>
          </div>
          <Link
            href="/admin/create"
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
          >
            <Plus size={20} />
            建立新流程
          </Link>
        </div>

        {/* Templates Grid */}
        {templates.length === 0 ? (
          <div className="bg-white rounded-lg shadow-lg p-12 text-center">
            <FileText className="w-16 h-16 mx-auto text-gray-400 mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">尚未建立任何流程</h3>
            <p className="text-gray-600 mb-6">點擊上方按鈕開始建立您的第一個工作流程</p>
            <Link
              href="/admin/create"
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-semibold"
            >
              <Plus size={20} />
              建立流程
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {templates.map((template) => {
              // Calculate statistics for this template
              const templateAssignments = allAssignments.filter((a: any) => a.template_id === template.id);
              const totalAssignments = templateAssignments.length;
              const completedAssignments = templateAssignments.filter((a: any) => a.status === 'completed').length;
              const inProgressAssignments = templateAssignments.filter((a: any) => a.status === 'in_progress').length;
              const pendingAssignments = templateAssignments.filter((a: any) => a.status === 'pending').length;
              
              return (
                <TemplateCardWithStats
                  key={template.id}
                  template={template}
                  totalAssignments={totalAssignments}
                  completedAssignments={completedAssignments}
                  inProgressAssignments={inProgressAssignments}
                  pendingAssignments={pendingAssignments}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
