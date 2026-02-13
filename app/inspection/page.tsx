import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Plus, Search, Filter, TrendingUp, Calendar, Store, User } from 'lucide-react';
import InspectionCalendar from '@/components/InspectionCalendar';

// 評級顏色配置 (0-10 分數系統)
const getGradeBadgeStyle = (grade: string) => {
  const score = parseInt(grade);
  if (score >= 8) {
    return 'bg-purple-100 text-purple-800 border-purple-300'; // 8-10: 優秀
  } else if (score >= 6) {
    return 'bg-green-100 text-green-800 border-green-300'; // 6-7: 良好
  } else if (score >= 4) {
    return 'bg-yellow-100 text-yellow-800 border-yellow-300'; // 4-5: 尚可
  } else {
    return 'bg-red-100 text-red-800 border-red-300'; // 0-3: 需改善
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
    'draft': '草稿',
    'in_progress': '進行中',
    'completed': '已完成',
    'closed': '已結案',
  };
  return labels[status] || status;
};

export default async function InspectionListPage() {
  const supabase = await createClient();

  // 1. 驗證登入
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // 2. 獲取使用者資料
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', user.id)
    .single();

  if (!profile) {
    redirect('/login');
  }

  // 3. 檢查權限（透過 RLS 自動過濾，這裡只做基本檢查）
  const { data: userPermissions } = await supabase
    .from('user_roles')
    .select(`
      role:roles!inner (
        role_permissions!inner (
          is_allowed,
          permission:permissions!inner (code)
        )
      )
    `)
    .eq('user_id', user.id)
    .eq('is_active', true);

  const permissionSet = new Set<string>();
  userPermissions?.forEach((ur: any) => {
    ur.role?.role_permissions?.forEach((rp: any) => {
      if (rp.is_allowed && rp.permission?.code) {
        permissionSet.add(rp.permission.code);
      }
    });
  });

  const canCreateInspection = permissionSet.has('inspection.create');

  // 4. 獲取巡店記錄（發取近 6 個月的數據供日曆顯示）
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  
  const { data: inspections, error } = await supabase
    .from('inspection_masters')
    .select(`
      id,
      store_id,
      inspector_id,
      inspection_date,
      status,
      total_score,
      max_possible_score,
      grade,
      score_percentage,
      created_at,
      store:stores!inner (
        id,
        store_name,
        store_code
      ),
      inspector:profiles (
        id,
        full_name
      )
    `)
    .gte('inspection_date', sixMonthsAgo.toISOString())
    .order('inspection_date', { ascending: false });

  if (error) {
    console.error('❌ 獲取巡店記錄失敗:', error);
  }

  // 規範化資料：確保 store 和 inspector 是單個對象（Supabase 關聯查詢的類型修正）
  const normalizedInspections = (inspections || []).map((ins: any) => ({
    ...ins,
    store: Array.isArray(ins.store) ? ins.store[0] : ins.store,
    inspector: Array.isArray(ins.inspector) ? ins.inspector[0] : ins.inspector || { id: ins.inspector_id, full_name: '(資料載入中)' },
  }));

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 頁面標題與操作 */}
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
                  {normalizedInspections?.length || 0}
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
                  {normalizedInspections?.filter((i) => parseInt(i.grade) >= 8).length || 0}
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
                  {normalizedInspections?.filter((i) => {
                    const score = parseInt(i.grade);
                    return score >= 6 && score < 8;
                  }).length || 0}
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
                  {normalizedInspections?.filter((i) => parseInt(i.grade) < 6).length || 0}
                </p>
              </div>
              <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                <span className="text-xl font-bold text-red-600">!</span>
              </div>
            </div>
          </div>
        </div>

        {/* 日曆視圖 */}
        <div className="mb-8">
          <InspectionCalendar inspections={normalizedInspections || []} />
        </div>

        {/* 巡店記錄列表 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">巡店記錄</h2>
          </div>

          {!normalizedInspections || normalizedInspections.length === 0 ? (
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
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      門市
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      巡店日期
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      督導
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      分數
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      得分數(滿分10分)
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      狀態
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      改善項目
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {normalizedInspections.slice(0, 30).map((inspection) => (
                    <tr
                      key={inspection.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <Store className="w-5 h-5 text-gray-400 mr-2" />
                          <div>
                            <div className="text-sm font-medium text-gray-900">
                              {inspection.store.store_name}
                            </div>
                            <div className="text-xs text-gray-500">
                              {inspection.store.store_code}
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
                          {inspection.inspector.full_name}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm">
                          <span className="font-bold text-lg text-gray-900">
                            {inspection.total_score}
                          </span>
                          <span className="text-gray-500"> / 220</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-bold border ${getGradeBadgeStyle(
                            inspection.grade
                          )}`}
                        >
                          {inspection.grade}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${getStatusBadgeStyle(
                            inspection.status
                          )}`}
                        >
                          {getStatusLabel(inspection.status)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span className="text-sm text-gray-400">無數據</span>
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
          
          {normalizedInspections && normalizedInspections.length > 30 && (
            <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 text-center text-sm text-gray-600">
              顯示最近 30 筆記錄，共 {normalizedInspections.length} 筆。使用上方日曆查看更多記錄。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
