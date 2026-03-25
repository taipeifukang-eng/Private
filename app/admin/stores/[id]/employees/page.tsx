'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronLeft,
  Users,
  Loader2,
  Calendar,
  UserCheck,
  UserX,
  Info,
} from 'lucide-react';

interface MonthlyEmployee {
  id: string;
  employee_code: string | null;
  employee_name: string | null;
  position: string | null;
  employment_type: 'full_time' | 'part_time' | null;
  is_pharmacist: boolean | null;
  monthly_status: string | null;
  year_month: string;
}

interface StoreInfo {
  id: string;
  store_code: string;
  store_name: string;
}

const POSITION_ORDER: { [key: string]: number } = {
  '督導': 1,
  '督導(代理店長)': 2,
  '店長': 3,
  '代理店長': 4,
  '副店長': 5,
  '主任': 6,
  '組長': 7,
  '專員': 8,
  '新人': 9,
  '行政': 10,
  '兼職藥師': 11,
  '兼職專員': 12,
  '兼職助理': 13,
};

const STATUS_LABELS: { [key: string]: string } = {
  full_month: '整月在職',
  new_hire: '到職',
  resigned: '離職',
  leave_of_absence: '留停',
  transferred_in: '調入',
  transferred_out: '調出',
  promoted: '升職',
  support_rotation: '支援卡班',
  dual_store_manager: '雙店長',
  leave_return: '留停復職',
};

const STATUS_BADGE: { [key: string]: string } = {
  full_month: 'bg-green-100 text-green-700',
  new_hire: 'bg-blue-100 text-blue-700',
  resigned: 'bg-gray-100 text-gray-500',
  leave_of_absence: 'bg-yellow-100 text-yellow-700',
  transferred_in: 'bg-purple-100 text-purple-700',
  transferred_out: 'bg-orange-100 text-orange-700',
  promoted: 'bg-teal-100 text-teal-700',
  support_rotation: 'bg-indigo-100 text-indigo-700',
  dual_store_manager: 'bg-pink-100 text-pink-700',
  leave_return: 'bg-cyan-100 text-cyan-700',
};

export default function StoreEmployeesPage() {
  const router = useRouter();
  const params = useParams();
  const storeId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [employees, setEmployees] = useState<MonthlyEmployee[]>([]);
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [showResigned, setShowResigned] = useState(false);

  useEffect(() => {
    loadStore();
  }, [storeId]);

  useEffect(() => {
    if (selectedMonth) {
      loadEmployees(selectedMonth);
    }
  }, [selectedMonth, showResigned]);

  const loadStore = async () => {
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();

      const { data: storeData } = await supabase
        .from('stores')
        .select('id, store_code, store_name')
        .eq('id', storeId)
        .single();

      if (!storeData) {
        alert('找不到該門市');
        router.push('/admin/stores');
        return;
      }
      setStore(storeData);

      // 取得此門市所有有紀錄的月份
      const { data: monthRows } = await supabase
        .from('monthly_staff_status')
        .select('year_month')
        .eq('store_id', storeId)
        .order('year_month', { ascending: false });

      const uniqueMonths = Array.from(
        new Set((monthRows || []).map((m: any) => m.year_month as string))
      );
      setAvailableMonths(uniqueMonths);

      if (uniqueMonths.length > 0) {
        setSelectedMonth(uniqueMonths[0]);
      } else {
        setLoading(false);
      }
    } catch (error) {
      console.error('載入門市資料錯誤:', error);
      setLoading(false);
    }
  };

  const loadEmployees = async (yearMonth: string) => {
    try {
      setLoading(true);
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();

      let query = supabase
        .from('monthly_staff_status')
        .select('id, employee_code, employee_name, position, employment_type, is_pharmacist, monthly_status, year_month')
        .eq('store_id', storeId)
        .eq('year_month', yearMonth);

      if (!showResigned) {
        query = query.neq('monthly_status', 'resigned');
      }

      const { data } = await query;

      const sorted = (data || []).sort((a: any, b: any) => {
        const orderA = POSITION_ORDER[a.position || ''] ?? 999;
        const orderB = POSITION_ORDER[b.position || ''] ?? 999;
        if (orderA !== orderB) return orderA - orderB;
        return (a.employee_name || '').localeCompare(b.employee_name || '', 'zh-TW');
      });

      setEmployees(sorted as MonthlyEmployee[]);
    } catch (error) {
      console.error('載入員工資料錯誤:', error);
    } finally {
      setLoading(false);
    }
  };

  const activeCount = employees.filter(e => e.monthly_status !== 'resigned').length;
  const resignedCount = employees.filter(e => e.monthly_status === 'resigned').length;

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        {/* 返回按鈕 */}
        <Link
          href="/admin/stores"
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6 transition-colors"
        >
          <ChevronLeft size={20} />
          返回門市管理
        </Link>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
              <Users className="text-blue-600" size={36} />
              {store?.store_name || '載入中...'}
            </h1>
            <p className="text-gray-500 mt-1 text-sm">
              門市代碼：{store?.store_code}
            </p>
          </div>

          {/* 月份選擇 */}
          {availableMonths.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <Calendar size={16} className="text-gray-500" />
              <select
                value={selectedMonth}
                onChange={e => setSelectedMonth(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500"
              >
                {availableMonths.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* 資料來源說明 */}
        <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-5 text-sm text-blue-700">
          <Info size={16} className="mt-0.5 shrink-0" />
          <span>員工清單來源為每月人員狀態資料，請至
            <Link href="/monthly-status" className="underline font-medium mx-1">每月人員狀態</Link>
            匯入或更新人員資料。
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="animate-spin text-blue-600" size={40} />
          </div>
        ) : availableMonths.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-14 text-center">
            <Users className="w-16 h-16 mx-auto text-gray-300 mb-4" />
            <h3 className="text-lg font-semibold text-gray-600">尚無每月人員狀態資料</h3>
            <p className="text-gray-400 mt-2 text-sm">請至每月人員狀態頁面匯入資料後即可在此查看員工名單</p>
            <Link
              href="/monthly-status"
              className="inline-block mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
            >
              前往每月人員狀態
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            {/* 統計列 */}
            <div className="bg-gray-50 border-b px-6 py-3 flex items-center justify-between">
              <div className="flex items-center gap-5 text-sm">
                <span className="flex items-center gap-1.5 text-green-700 font-medium">
                  <UserCheck size={15} />
                  在職 {activeCount} 人
                </span>
                {resignedCount > 0 && (
                  <span className="flex items-center gap-1.5 text-gray-500">
                    <UserX size={15} />
                    含離職 {resignedCount} 人
                  </span>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showResigned}
                  onChange={e => setShowResigned(e.target.checked)}
                  className="rounded accent-blue-600"
                />
                顯示離職員工
              </label>
            </div>

            {/* 表頭 */}
            <div className="grid grid-cols-12 bg-gray-100 border-b px-5 py-2.5 text-xs font-semibold text-gray-600 uppercase tracking-wide">
              <div className="col-span-2">員編</div>
              <div className="col-span-3">姓名</div>
              <div className="col-span-3">職位</div>
              <div className="col-span-2">類型</div>
              <div className="col-span-2">本月狀態</div>
            </div>

            {/* 內容 */}
            {employees.length === 0 ? (
              <div className="py-12 text-center text-gray-400 text-sm">
                {selectedMonth} 無人員資料
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {employees.map(emp => {
                  const isResigned = emp.monthly_status === 'resigned';
                  return (
                    <div
                      key={emp.id}
                      className={`grid grid-cols-12 px-5 py-3 text-sm items-center transition-colors hover:bg-gray-50 ${isResigned ? 'opacity-50' : ''}`}
                    >
                      <div className="col-span-2 font-mono text-gray-500 text-xs">
                        {emp.employee_code || '-'}
                      </div>
                      <div className="col-span-3 font-medium text-gray-900">
                        {emp.employee_name || '-'}
                        {emp.is_pharmacist && (
                          <span className="ml-1.5 px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-xs rounded-full font-normal">藥師</span>
                        )}
                      </div>
                      <div className="col-span-3 text-gray-600">
                        {emp.position || '-'}
                      </div>
                      <div className="col-span-2 text-gray-500">
                        {emp.employment_type === 'part_time' ? '兼職' : emp.employment_type === 'full_time' ? '全職' : '-'}
                      </div>
                      <div className="col-span-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[emp.monthly_status || ''] || 'bg-gray-100 text-gray-600'}`}>
                          {STATUS_LABELS[emp.monthly_status || ''] || emp.monthly_status || '-'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
