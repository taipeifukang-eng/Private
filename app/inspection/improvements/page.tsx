'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  Clock,
  XCircle,
  Store,
  Calendar,
  ChevronRight,
  Filter,
  Loader2,
} from 'lucide-react';

interface Improvement {
  id: string;
  inspection_id: string;
  store_id: string;
  section_name: string;
  item_name: string;
  deduction_amount: number;
  issue_description: string | null;
  issue_photo_urls: string[];
  selected_items: string[];
  status: 'pending' | 'improved' | 'overdue';
  deadline: string;
  days_taken: number | null;
  bonus_score: number;
  improved_at: string | null;
  created_at: string;
  // joined
  store_name: string;
  store_code: string;
  inspection_date: string;
  inspector_name: string;
}

type FilterStatus = 'all' | 'pending' | 'improved' | 'overdue';

function ImprovementsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialFilter = (searchParams.get('status') as FilterStatus) || 'all';

  const [loading, setLoading] = useState(true);
  const [improvements, setImprovements] = useState<Improvement[]>([]);
  const [filter, setFilter] = useState<FilterStatus>(initialFilter);
  const [noPermission, setNoPermission] = useState(false);

  const fetchImprovements = useCallback(async () => {
    try {
      setLoading(true);
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }

      // 檢查權限
      const [viewAll, viewOwn] = await Promise.all([
        supabase.rpc('has_permission', {
          p_user_id: user.id,
          p_permission_code: 'inspection.improvement.view_all',
        }),
        supabase.rpc('has_permission', {
          p_user_id: user.id,
          p_permission_code: 'inspection.improvement.view_own_store',
        }),
      ]);

      if (!viewAll.data && !viewOwn.data) {
        // 也檢查 profiles.role 作為兜底
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .single();

        if (profile?.role !== 'admin') {
          setNoPermission(true);
          setLoading(false);
          return;
        }
      }

      // 查詢待改善事項（RLS 會自動過濾）
      const { data, error } = await supabase
        .from('inspection_improvements')
        .select(`
          id, inspection_id, store_id,
          section_name, item_name, deduction_amount,
          issue_description, issue_photo_urls, selected_items,
          status, deadline, days_taken, bonus_score,
          improved_at, created_at,
          stores!inner(store_name, store_code),
          inspection_masters!inner(inspection_date, inspector_id)
        `)
        .order('deadline', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) {
        console.error('查詢失敗:', error);
        // 如果 join 失敗，嘗試不帶 join 的查詢
        const { data: simpleData, error: simpleError } = await supabase
          .from('inspection_improvements')
          .select('*')
          .order('deadline', { ascending: true });

        if (simpleError) {
          console.error('簡單查詢也失敗:', simpleError);
          return;
        }

        // 手動取得關聯資料
        if (simpleData && simpleData.length > 0) {
          const storeIds = Array.from(new Set(simpleData.map((d: any) => d.store_id)));
          const inspectionIds = Array.from(new Set(simpleData.map((d: any) => d.inspection_id)));

          const [storesResult, inspectionsResult] = await Promise.all([
            supabase.from('stores').select('id, store_name, store_code').in('id', storeIds),
            supabase
              .from('inspection_masters')
              .select('id, inspection_date, inspector_id')
              .in('id', inspectionIds),
          ]);

          const storeMap = new Map(
            (storesResult.data || []).map((s: any) => [s.id, s])
          );
          const inspectionMap = new Map(
            (inspectionsResult.data || []).map((i: any) => [i.id, i])
          );

          // 批量查詢督導名稱
          const fallbackInspectorIds = Array.from(new Set(
            (inspectionsResult.data || []).map((i: any) => i.inspector_id).filter(Boolean)
          ));
          let fallbackInspectorMap = new Map<string, string>();
          if (fallbackInspectorIds.length > 0) {
            const { data: inspectorProfiles } = await supabase
              .from('profiles')
              .select('id, full_name')
              .in('id', fallbackInspectorIds);
            if (inspectorProfiles) {
              fallbackInspectorMap = new Map(inspectorProfiles.map((p: any) => [p.id, p.full_name]));
            }
          }

          const mapped: Improvement[] = simpleData.map((item: any) => {
            const store = storeMap.get(item.store_id) || {};
            const inspection = inspectionMap.get(item.inspection_id) || {};
            const inspectorId = (inspection as any).inspector_id;
            return {
              ...item,
              store_name: (store as any).store_name || '未知門市',
              store_code: (store as any).store_code || '',
              inspection_date: (inspection as any).inspection_date || '',
              inspector_name: (inspectorId && fallbackInspectorMap.get(inspectorId)) || '未知',
            };
          });

          // 動態更新逾期狀態
          const today = new Date().toISOString().split('T')[0];
          const overdueItems = mapped.filter(
            (item) => item.status === 'pending' && item.deadline < today
          );
          if (overdueItems.length > 0) {
            await Promise.all(
              overdueItems.map((item) =>
                supabase
                  .from('inspection_improvements')
                  .update({ status: 'overdue', updated_at: new Date().toISOString() })
                  .eq('id', item.id)
              )
            );
            overdueItems.forEach((item) => (item.status = 'overdue'));
          }

          setImprovements(mapped);
        }
        return;
      }

      // 正常帶 join 的結果 - 先收集 inspector_id
      const rawData = data || [];
      const inspectorIds = Array.from(new Set(
        rawData.map((item: any) => item.inspection_masters?.inspector_id).filter(Boolean)
      ));

      // 批量查詢督導名稱
      let inspectorNameMap = new Map<string, string>();
      if (inspectorIds.length > 0) {
        const { data: inspectorProfiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', inspectorIds);
        if (inspectorProfiles) {
          inspectorNameMap = new Map(inspectorProfiles.map((p: any) => [p.id, p.full_name]));
        }
      }

      const mapped: Improvement[] = rawData.map((item: any) => {
        const inspId = item.inspection_masters?.inspector_id;
        return {
          ...item,
          store_name: item.stores?.store_name || '未知門市',
          store_code: item.stores?.store_code || '',
          inspection_date: item.inspection_masters?.inspection_date || '',
          inspector_name: (inspId && inspectorNameMap.get(inspId)) || '未知',
        };
      });

      // 動態更新逾期狀態
      const today = new Date().toISOString().split('T')[0];
      const overdueItems = mapped.filter(
        (item) => item.status === 'pending' && item.deadline < today
      );
      if (overdueItems.length > 0) {
        await Promise.all(
          overdueItems.map((item) =>
            supabase
              .from('inspection_improvements')
              .update({ status: 'overdue', updated_at: new Date().toISOString() })
              .eq('id', item.id)
          )
        );
        overdueItems.forEach((item) => (item.status = 'overdue'));
      }

      setImprovements(mapped);
    } catch (error) {
      console.error('載入失敗:', error);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchImprovements();
  }, [fetchImprovements]);

  // 計算剩餘天數
  const getDaysRemaining = (deadline: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const deadlineDate = new Date(deadline);
    deadlineDate.setHours(0, 0, 0, 0);
    return Math.ceil((deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  };

  // 過濾
  const filtered = improvements.filter((item) => {
    if (filter === 'all') return true;
    return item.status === filter;
  });

  // 統計
  const stats = {
    all: improvements.length,
    pending: improvements.filter((i) => i.status === 'pending').length,
    improved: improvements.filter((i) => i.status === 'improved').length,
    overdue: improvements.filter((i) => i.status === 'overdue').length,
  };

  if (noPermission) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow p-8 text-center max-w-sm">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-gray-800 mb-2">權限不足</h2>
          <p className="text-gray-600 mb-4">您沒有查看待改善事項的權限</p>
          <Link href="/inspection" className="text-blue-600 hover:text-blue-700">
            返回巡店列表
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 頂部導覽 */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link
            href="/inspection"
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-lg font-bold text-gray-800">待改善事項追蹤</h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">
        {/* 統計卡片 */}
        <div className="grid grid-cols-4 gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`p-3 rounded-lg text-center transition-colors ${
              filter === 'all'
                ? 'bg-blue-100 border-2 border-blue-500'
                : 'bg-white border border-gray-200 hover:bg-gray-50'
            }`}
          >
            <div className="text-xl font-bold text-gray-800">{stats.all}</div>
            <div className="text-xs text-gray-500">全部</div>
          </button>
          <button
            onClick={() => setFilter('pending')}
            className={`p-3 rounded-lg text-center transition-colors ${
              filter === 'pending'
                ? 'bg-amber-100 border-2 border-amber-500'
                : 'bg-white border border-gray-200 hover:bg-gray-50'
            }`}
          >
            <div className="text-xl font-bold text-amber-600">{stats.pending}</div>
            <div className="text-xs text-gray-500">待改善</div>
          </button>
          <button
            onClick={() => setFilter('improved')}
            className={`p-3 rounded-lg text-center transition-colors ${
              filter === 'improved'
                ? 'bg-green-100 border-2 border-green-500'
                : 'bg-white border border-gray-200 hover:bg-gray-50'
            }`}
          >
            <div className="text-xl font-bold text-green-600">{stats.improved}</div>
            <div className="text-xs text-gray-500">已改善</div>
          </button>
          <button
            onClick={() => setFilter('overdue')}
            className={`p-3 rounded-lg text-center transition-colors ${
              filter === 'overdue'
                ? 'bg-red-100 border-2 border-red-500'
                : 'bg-white border border-gray-200 hover:bg-gray-50'
            }`}
          >
            <div className="text-xl font-bold text-red-600">{stats.overdue}</div>
            <div className="text-xs text-gray-500">逾期</div>
          </button>
        </div>

        {/* 載入中 */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        )}

        {/* 空狀態 */}
        {!loading && filtered.length === 0 && (
          <div className="bg-white rounded-lg shadow-sm p-8 text-center">
            <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
            <h3 className="text-gray-600 font-medium">
              {filter === 'all' ? '目前沒有待改善事項' : `沒有${filter === 'pending' ? '待改善' : filter === 'improved' ? '已改善' : '逾期'}的事項`}
            </h3>
          </div>
        )}

        {/* 改善事項列表 */}
        {!loading && filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((item) => {
              const daysRemaining = getDaysRemaining(item.deadline);
              const isUrgent = item.status === 'pending' && daysRemaining <= 2;

              return (
                <Link
                  key={item.id}
                  href={`/inspection/improvements/${item.id}`}
                  className={`block bg-white rounded-lg shadow-sm border overflow-hidden transition-all hover:shadow-md ${
                    item.status === 'overdue'
                      ? 'border-red-200'
                      : isUrgent
                      ? 'border-amber-300'
                      : item.status === 'improved'
                      ? 'border-green-200'
                      : 'border-gray-200'
                  }`}
                >
                  {/* 狀態條 */}
                  <div
                    className={`px-4 py-2 flex items-center justify-between ${
                      item.status === 'overdue'
                        ? 'bg-red-50'
                        : item.status === 'improved'
                        ? 'bg-green-50'
                        : isUrgent
                        ? 'bg-amber-50'
                        : 'bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {item.status === 'pending' && (
                        <>
                          <AlertTriangle
                            className={`w-4 h-4 ${
                              isUrgent ? 'text-amber-500' : 'text-amber-400'
                            }`}
                          />
                          <span
                            className={`text-sm font-medium ${
                              isUrgent ? 'text-amber-700' : 'text-amber-600'
                            }`}
                          >
                            待改善
                          </span>
                        </>
                      )}
                      {item.status === 'improved' && (
                        <>
                          <CheckCircle className="w-4 h-4 text-green-500" />
                          <span className="text-sm font-medium text-green-600">已改善</span>
                        </>
                      )}
                      {item.status === 'overdue' && (
                        <>
                          <XCircle className="w-4 h-4 text-red-500" />
                          <span className="text-sm font-medium text-red-600">已逾期</span>
                        </>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-sm">
                      {item.status === 'pending' && (
                        <span
                          className={`font-medium ${
                            isUrgent ? 'text-amber-700' : 'text-gray-500'
                          }`}
                        >
                          {daysRemaining > 0
                            ? `剩 ${daysRemaining} 天`
                            : daysRemaining === 0
                            ? '今天到期'
                            : `逾期 ${Math.abs(daysRemaining)} 天`}
                        </span>
                      )}
                      {item.status === 'improved' && item.bonus_score > 0 && (
                        <span className="text-green-600 font-bold">+{item.bonus_score}分</span>
                      )}
                      {item.status === 'improved' && item.days_taken !== null && (
                        <span className="text-gray-500">{item.days_taken}天完成</span>
                      )}
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </div>
                  </div>

                  {/* 內容 */}
                  <div className="px-4 py-3">
                    {/* 門市 + 項目 */}
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Store className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                          <span className="text-sm font-medium text-gray-700 truncate">
                            {item.store_name}
                          </span>
                        </div>
                        <div className="text-sm text-gray-800">
                          <span className="text-gray-500">{item.section_name}</span>
                          <span className="mx-1 text-gray-300">›</span>
                          <span className="font-medium">{item.item_name}</span>
                        </div>
                      </div>
                      <div className="ml-3 flex-shrink-0">
                        <span className="text-red-500 font-bold text-sm">
                          -{item.deduction_amount}分
                        </span>
                      </div>
                    </div>

                    {/* 缺失項目 */}
                    {item.selected_items && item.selected_items.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {item.selected_items.slice(0, 3).map((si, idx) => (
                          <span
                            key={idx}
                            className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded"
                          >
                            {si}
                          </span>
                        ))}
                        {item.selected_items.length > 3 && (
                          <span className="text-xs text-gray-400">
                            +{item.selected_items.length - 3}項
                          </span>
                        )}
                      </div>
                    )}

                    {/* 底部資訊 */}
                    <div className="flex items-center gap-3 text-xs text-gray-400 mt-2">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        <span>巡店: {item.inspection_date}</span>
                      </div>
                      <span>·</span>
                      <span>期限: {item.deadline}</span>
                      <span>·</span>
                      <span>督導: {item.inspector_name}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ImprovementsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      }
    >
      <ImprovementsContent />
    </Suspense>
  );
}
