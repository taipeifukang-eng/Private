import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Plus, TrendingUp, Calendar, Store, User } from 'lucide-react';

// 強制動態渲染，禁用快取
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 評級顏色配置 (0-10 分數系統)
const getGradeBadgeStyle = (grade: string | null) => {
  const score = parseInt(grade || '0');
  if (score >= 8) {
    return 'bg-purple-100 text-purple-800 border-purple-300';
  } else if (score >= 6) {
    return 'bg-green-100 text-green-800 border-green-300';
  } else if (score >= 4) {
    return 'bg-yellow-100 text-yellow-800 border-yellow-300';
  } else {
    return 'bg-red-100 text-red-800 border-red-300';
  }
};

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
    'draft': '草稿',
    'in_progress': '進行中',
    'completed': '已完成',
    'closed': '已結案',
  };
  return labels[status] || status;
};

export default async function InspectionListPage() {
  // 把整個函數包在 try/catch 中，確保捕獲所有錯誤
  let supabase: any;
  let user: any;
  let profile: any;

  try {
    supabase = createClient();
  } catch (e: any) {
    return <div className="p-8"><h1 className="text-red-600">createClient 錯誤: {e.message}</h1></div>;
  }

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) {
      redirect('/login');
    }
    user = data.user;
  } catch (e: any) {
    // redirect 也會拋出錯誤，需要重新拋出
    if (e?.digest === 'NEXT_REDIRECT') throw e;
    return <div className="p-8"><h1 className="text-red-600">getUser 錯誤: {e.message}</h1></div>;
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', user.id)
      .single();
    if (error || !data) {
      redirect('/login');
    }
    profile = data;
  } catch (e: any) {
    if (e?.digest === 'NEXT_REDIRECT') throw e;
    return <div className="p-8"><h1 className="text-red-600">profile 錯誤: {e.message}</h1></div>;
  }

  try {
    const canCreateInspection = profile.role === 'admin' || profile.role === 'supervisor';

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    // 第一步：獲取基本巡店記錄
    const { data: rawInspections, error: inspectionError } = await supabase
      .from('inspection_masters')
      .select('id, store_id, inspector_id, inspection_date, status, total_score, max_possible_score, grade, score_percentage, created_at')
      .gte('inspection_date', sixMonthsAgo.toISOString())
      .order('inspection_date', { ascending: false });

    if (inspectionError) {
      return <div className="p-8"><h1 className="text-red-600">inspection_masters 查詢錯誤: {inspectionError.message}</h1></div>;
    }

    // 第二步：批量獲取 store 和 inspector
    const storeIds = Array.from(new Set((rawInspections || []).map((i: any) => i.store_id).filter(Boolean)));
    const inspectorIds = Array.from(new Set((rawInspections || []).map((i: any) => i.inspector_id).filter(Boolean)));

    let stores: any[] = [];
    let inspectors: any[] = [];

    if (storeIds.length > 0) {
      const { data: storeData } = await supabase
        .from('stores')
        .select('id, store_name, store_code, short_name')
        .in('id', storeIds);
      stores = storeData || [];
    }

    if (inspectorIds.length > 0) {
      const { data: inspectorData } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', inspectorIds);
      inspectors = inspectorData || [];
    }

    // 第三步：組合資料
    const storeMap = new Map(stores.map((s: any) => [s.id, s]));
    const inspectorMap = new Map(inspectors.map((i: any) => [i.id, i]));

    const normalizedInspections = (rawInspections || []).map((ins: any) => ({
      ...ins,
      store: storeMap.get(ins.store_id) || { id: ins.store_id, store_name: '未知門市', store_code: '', short_name: null },
      inspector: inspectorMap.get(ins.inspector_id) || { id: ins.inspector_id, full_name: '未知' },
    }));

    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* 頁面標題 */}
          <div className="mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-white" />
                  </div>
                  督導巡店記錄
                </h1>
                <p className="mt-2 text-sm text-gray-600">
                  檢視所有門市巡店紀錄，追蹤改善進度
                </p>
              </div>

              {canCreateInspection && (
                <Link
                  href="/inspection/new"
                  className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-all shadow-lg hover:shadow-xl"
                >
                  <Plus size={20} />
                  新增巡店
                </Link>
              )}
            </div>
          </div>

          {/* 統計卡片 */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">總巡店次數</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">
                    {normalizedInspections.length}
                  </p>
                </div>
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                  <Store className="w-6 h-6 text-blue-600" />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">優秀 (8-10分)</p>
                  <p className="text-2xl font-bold text-purple-600 mt-1">
                    {normalizedInspections.filter((i: any) => parseInt(i.grade || '0') >= 8).length}
                  </p>
                </div>
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                  <TrendingUp className="w-6 h-6 text-purple-600" />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">良好 (6-7分)</p>
                  <p className="text-2xl font-bold text-green-600 mt-1">
                    {normalizedInspections.filter((i: any) => {
                      const score = parseInt(i.grade || '0');
                      return score >= 6 && score < 8;
                    }).length}
                  </p>
                </div>
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                  <span className="text-xl font-bold text-green-600">✓</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">需改善 (0-5分)</p>
                  <p className="text-2xl font-bold text-red-600 mt-1">
                    {normalizedInspections.filter((i: any) => parseInt(i.grade || '0') < 6).length}
                  </p>
                </div>
                <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                  <span className="text-xl font-bold text-red-600">!</span>
                </div>
              </div>
            </div>
          </div>

          {/* 巡店記錄列表 */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">巡店記錄</h2>
            </div>

            {normalizedInspections.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Store className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">尚無巡店記錄</h3>
                <p className="text-gray-600 mb-6">
                  開始第一次巡店紀錄，建立門市品質管理軌跡
                </p>
                {canCreateInspection && (
                  <Link
                    href="/inspection/new"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <Plus size={20} />
                    新增巡店
                  </Link>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">門市</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">巡店日期</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">督導</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">分數</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">得分數(滿分10分)</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">狀態</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">操作</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {normalizedInspections.slice(0, 30).map((inspection: any) => (
                      <tr key={inspection.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <Store className="w-5 h-5 text-gray-400 mr-2" />
                            <div>
                              <div className="text-sm font-medium text-gray-900">
                                {inspection.store?.short_name || inspection.store?.store_name || '未知'}
                              </div>
                              <div className="text-xs text-gray-500">
                                {inspection.store?.store_code || ''}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center text-sm text-gray-600">
                            <Calendar className="w-4 h-4 mr-2 text-gray-400" />
                            {new Date(inspection.inspection_date).toLocaleDateString('zh-TW')}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center text-sm text-gray-600">
                            <User className="w-4 h-4 mr-2 text-gray-400" />
                            {inspection.inspector?.full_name || '未知'}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm">
                            <span className="font-bold text-lg text-gray-900">
                              {inspection.total_score || 0}
                            </span>
                            <span className="text-gray-500"> / 220</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-bold border ${getGradeBadgeStyle(inspection.grade)}`}>
                            {inspection.grade || '-'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${getStatusBadgeStyle(inspection.status)}`}>
                            {getStatusLabel(inspection.status)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                          <Link
                            href={`/inspection/${inspection.id}`}
                            className="text-blue-600 hover:text-blue-900 font-medium"
                          >
                            查看詳情
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            
            {normalizedInspections.length > 30 && (
              <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-center text-sm text-gray-600">
                顯示最近 30 筆記錄，共 {normalizedInspections.length} 筆
              </div>
            )}
          </div>
        </div>
      </div>
    );
  } catch (error: any) {
    // 重要：必須重新拋出 redirect 和 notFound 等特殊錯誤
    if (error?.digest) throw error;
    
    console.error('❌ 巡店列表頁發生錯誤:', error);
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-2xl w-full">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">❌</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">載入巡店記錄時發生錯誤</h1>
            <p className="text-gray-600 mb-6">{error?.message || '未知錯誤'}</p>
            <div className="mt-6 flex gap-4 justify-center">
              <Link
                href="/dashboard"
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                返回首頁
              </Link>
              <a
                href="/inspection"
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                重新載入
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
