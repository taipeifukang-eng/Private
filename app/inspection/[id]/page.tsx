import { createClient } from '@/lib/supabase/server';
import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  Store,
  User,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Edit,
  Printer,
  FileCheck,
} from 'lucide-react';

// 評級顏色配置
const getGradeBadgeStyle = (grade: string) => {
  switch (grade) {
    case 'S':
      return 'bg-purple-100 text-purple-800 border-purple-300';
    case 'A':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'B':
      return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    case 'F':
      return 'bg-red-100 text-red-800 border-red-300';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-300';
  }
};

// 狀態顯示配置
const getStatusBadgeStyle = (status: string) => {
  switch (status) {
    case 'completed':
      return 'bg-green-50 text-green-700 border-green-200';
    case 'in_progress':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'draft':
      return 'bg-gray-50 text-gray-700 border-gray-200';
    case 'closed':
      return 'bg-purple-50 text-purple-700 border-purple-200';
    default:
      return 'bg-gray-50 text-gray-700 border-gray-200';
  }
};

const getStatusLabel = (status: string) => {
  const labels: Record<string, string> = {
    draft: '草稿',
    in_progress: '進行中',
    completed: '已完成',
    closed: '已結案',
  };
  return labels[status] || status;
};

export default async function InspectionDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createClient();

  // 1. 驗證登入
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // 2. 獲取巡店記錄（RLS 會自動過濾權限）
  const { data: inspection, error } = await supabase
    .from('inspection_masters')
    .select(
      `
      id,
      store_id,
      inspector_id,
      inspection_date,
      status,
      initial_score,
      total_deduction,
      final_score,
      grade,
      needs_improvement_count,
      remarks,
      created_at,
      updated_at,
      store:stores!inner (
        id,
        store_name,
        store_code,
        address
      ),
      inspector:profiles!inspection_masters_inspector_id_fkey (
        id,
        full_name
      )
    `
    )
    .eq('id', params.id)
    .single();

  if (error || !inspection) {
    console.error('❌ 獲取巡店記錄失敗:', error);
    notFound();
  }

  // 3. 獲取檢查結果明細
  const { data: results, error: resultsError } = await supabase
    .from('inspection_results')
    .select(
      `
      id,
      template_id,
      deduction,
      earned_score,
      needs_improvement,
      improvement_notes,
      template:inspection_templates!inner (
        id,
        section,
        section_name,
        section_order,
        item_name,
        item_description,
        item_order,
        max_score,
        scoring_type
      )
    `
    )
    .eq('inspection_id', params.id)
    .order('template(section_order)', { ascending: true })
    .order('template(item_order)', { ascending: true });

  if (resultsError) {
    console.error('❌ 獲取檢查結果失敗:', resultsError);
  }

  // 按區塊分組結果
  const groupedResults = (results || []).reduce((acc, result: any) => {
    const section = result.template.section;
    if (!acc[section]) {
      acc[section] = {
        section_name: result.template.section_name,
        section_order: result.template.section_order,
        items: [],
        total_max: 0,
        total_earned: 0,
      };
    }
    acc[section].items.push(result);
    acc[section].total_max += result.template.max_score;
    acc[section].total_earned += result.earned_score;
    return acc;
  }, {} as Record<string, any>);

  const sortedSections = Object.entries(groupedResults).sort(
    ([, a], [, b]) => a.section_order - b.section_order
  );

  // 需改善項目
  const improvementItems = (results || []).filter((r: any) => r.needs_improvement);

  // 檢查是否可編輯
  const canEdit =
    inspection.inspector_id === user.id &&
    (inspection.status === 'draft' || inspection.status === 'in_progress');

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 頁面標題 */}
        <div className="mb-6">
          <Link
            href="/inspection"
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft size={20} />
            返回列表
          </Link>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">巡店記錄詳情</h1>
              <p className="mt-2 text-sm text-gray-600">
                建立於 {new Date(inspection.created_at).toLocaleString('zh-TW')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {canEdit && (
                <Link
                  href={`/inspection/${params.id}/edit`}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  <Edit size={18} />
                  編輯
                </Link>
              )}
              <button
                onClick={() => window.print()}
                className="flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                <Printer size={18} />
                列印
              </button>
            </div>
          </div>
        </div>

        {/* 基本資訊卡片 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Store className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">巡店門市</p>
                <p className="text-lg font-semibold text-gray-900 mt-0.5">
                  {inspection.store.store_name}
                </p>
                <p className="text-xs text-gray-500">{inspection.store.store_code}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <Calendar className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">巡店日期</p>
                <p className="text-lg font-semibold text-gray-900 mt-0.5">
                  {new Date(inspection.inspection_date).toLocaleDateString('zh-TW')}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <User className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">督導人員</p>
                <p className="text-lg font-semibold text-gray-900 mt-0.5">
                  {inspection.inspector.full_name}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center flex-shrink-0">
                <FileCheck className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">狀態</p>
                <span
                  className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border mt-1 ${getStatusBadgeStyle(
                    inspection.status
                  )}`}
                >
                  {getStatusLabel(inspection.status)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 分數總覽 */}
        <div className="bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl shadow-lg p-6 mb-6 text-white">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-sm opacity-90">初始分數</p>
              <p className="text-3xl font-bold mt-1">{inspection.initial_score}</p>
            </div>
            <div>
              <p className="text-sm opacity-90">總扣分</p>
              <p className="text-3xl font-bold mt-1 text-red-200">
                -{inspection.total_deduction}
              </p>
            </div>
            <div>
              <p className="text-sm opacity-90">最終得分</p>
              <p className="text-3xl font-bold mt-1">{inspection.final_score}</p>
            </div>
            <div>
              <p className="text-sm opacity-90">評級</p>
              <div className="mt-1">
                <span
                  className={`inline-flex items-center px-4 py-2 rounded-full text-2xl font-bold border-2 ${getGradeBadgeStyle(
                    inspection.grade
                  )}`}
                >
                  {inspection.grade}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 需改善項目 */}
        {improvementItems.length > 0 && (
          <div className="bg-red-50 border-2 border-red-200 rounded-xl p-6 mb-6">
            <div className="flex items-center gap-3 mb-4">
              <AlertCircle className="w-6 h-6 text-red-600" />
              <h2 className="text-xl font-bold text-red-900">
                需改善項目 ({improvementItems.length} 項)
              </h2>
            </div>
            <div className="space-y-3">
              {improvementItems.map((item: any, index) => (
                <div
                  key={item.id}
                  className="bg-white border border-red-200 rounded-lg p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-red-600">
                        {index + 1}
                      </span>
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900">
                        {item.template.item_name}
                        <span className="ml-2 text-sm font-normal text-red-600">
                          扣 {item.deduction} 分
                        </span>
                      </h3>
                      <p className="text-sm text-gray-600 mt-1">
                        {item.template.item_description}
                      </p>
                      {item.improvement_notes && (
                        <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                          <p className="text-sm text-gray-700">
                            <strong>改善建議：</strong>
                            {item.improvement_notes}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 檢查項目詳情 */}
        <div className="space-y-4 mb-6">
          <h2 className="text-xl font-bold text-gray-900">檢查項目詳情</h2>
          {sortedSections.map(([sectionKey, section]) => (
            <div
              key={sectionKey}
              className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden"
            >
              <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {section.section_name}
                  </h3>
                  <div className="text-right">
                    <span className="text-2xl font-bold text-gray-900">
                      {section.total_earned}
                    </span>
                    <span className="text-gray-500"> / {section.total_max}</span>
                  </div>
                </div>
              </div>

              <div className="divide-y divide-gray-200">
                {section.items.map((result: any) => (
                  <div
                    key={result.id}
                    className={`px-6 py-4 ${
                      result.needs_improvement ? 'bg-red-50' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {result.needs_improvement ? (
                            <AlertCircle className="w-5 h-5 text-red-500" />
                          ) : (
                            <CheckCircle className="w-5 h-5 text-green-500" />
                          )}
                          <h4 className="font-semibold text-gray-900">
                            {result.template.item_name}
                          </h4>
                        </div>
                        <p className="text-sm text-gray-600 mt-1 ml-7">
                          {result.template.item_description}
                        </p>
                      </div>
                      <div className="text-right ml-4">
                        <p className="text-sm text-gray-600">得分</p>
                        <p
                          className={`text-xl font-bold ${
                            result.needs_improvement
                              ? 'text-red-600'
                              : 'text-green-600'
                          }`}
                        >
                          {result.earned_score}
                          <span className="text-sm text-gray-500">
                            /{result.template.max_score}
                          </span>
                        </p>
                        {result.deduction > 0 && (
                          <p className="text-xs text-red-600">扣 {result.deduction} 分</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 備註 */}
        {inspection.remarks && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">備註說明</h2>
            <p className="text-gray-700 whitespace-pre-wrap">{inspection.remarks}</p>
          </div>
        )}
      </div>
    </div>
  );
}
