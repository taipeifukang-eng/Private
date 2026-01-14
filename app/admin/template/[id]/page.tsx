import { getCurrentUser } from '@/app/auth/actions';
import { getTemplates } from '@/app/actions';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileText, Calendar, User, CheckSquare } from 'lucide-react';

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

  const createdDate = new Date(template.created_at).toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link
            href="/admin/templates"
            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium mb-4"
          >
            <ArrowLeft size={20} />
            返回流程列表
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
                  {template.steps_schema.map((step, index) => (
                    <div
                      key={index}
                      className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200"
                    >
                      <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-semibold">
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <p className="text-gray-900 font-medium">{step.title}</p>
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
      </div>
    </div>
  );
}
