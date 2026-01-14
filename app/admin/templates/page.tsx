import { getTemplates } from '@/app/actions';
import { Plus, FileText, Calendar, Trash2 } from 'lucide-react';
import Link from 'next/link';
import type { Template } from '@/types/workflow';

export default async function TemplatesPage() {
  const result = await getTemplates();
  const templates = result.success ? result.data : [];

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
            {templates.map((template) => (
              <TemplateCard key={template.id} template={template} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateCard({ template }: { template: Template }) {
  const stepCount = template.steps_schema?.length || 0;
  const createdDate = new Date(template.created_at).toLocaleDateString('zh-TW');

  return (
    <div className="bg-white rounded-lg shadow-lg hover:shadow-xl transition-shadow overflow-hidden">
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h3 className="text-xl font-bold text-gray-900 mb-2 line-clamp-2">
              {template.title}
            </h3>
            {template.description && (
              <p className="text-sm text-gray-600 line-clamp-2">
                {template.description}
              </p>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 mb-4 text-sm text-gray-600">
          <div className="flex items-center gap-1">
            <FileText size={16} />
            <span>{stepCount} 個步驟</span>
          </div>
          <div className="flex items-center gap-1">
            <Calendar size={16} />
            <span>{createdDate}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-4 border-t border-gray-200">
          <Link
            href={`/admin/assign/${template.id}`}
            className="flex-1 text-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium"
          >
            指派任務
          </Link>
          <Link
            href={`/admin/template/${template.id}`}
            className="flex-1 text-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            查看詳情
          </Link>
        </div>
      </div>
    </div>
  );
}
