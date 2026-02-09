'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Calendar as CalendarIcon, Store as StoreIcon } from 'lucide-react';
import Link from 'next/link';
import { Campaign, CampaignSchedule, Store, EventDate } from '@/types/workflow';

interface StoreWithManager extends Store {
  supervisor_id?: string;
  supervisor_code?: string;
  supervisor_name?: string;
}

export default function ActivityViewPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.id as string;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [schedules, setSchedules] = useState<CampaignSchedule[]>([]);
  const [stores, setStores] = useState<StoreWithManager[]>([]);
  const [events, setEvents] = useState<EventDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [calendarDates, setCalendarDates] = useState<Date[]>([]);
  const [supervisorColorMap, setSupervisorColorMap] = useState<Record<string, { bg: string; border: string; text: string; name: string; supervisorName: string }>>({});

  // 預設顏色組合（使用對比度更強的顏色）
  const AVAILABLE_COLORS = [
    { bg: 'bg-blue-200', border: 'border-blue-400', text: 'text-blue-900', name: '藍色' },
    { bg: 'bg-emerald-200', border: 'border-emerald-400', text: 'text-emerald-900', name: '翠綠' },
    { bg: 'bg-purple-200', border: 'border-purple-400', text: 'text-purple-900', name: '紫色' },
    { bg: 'bg-amber-200', border: 'border-amber-400', text: 'text-amber-900', name: '琥珀' },
    { bg: 'bg-pink-200', border: 'border-pink-400', text: 'text-pink-900', name: '粉紅' },
    { bg: 'bg-cyan-200', border: 'border-cyan-400', text: 'text-cyan-900', name: '青色' },
    { bg: 'bg-rose-200', border: 'border-rose-400', text: 'text-rose-900', name: '玫瑰' },
    { bg: 'bg-lime-200', border: 'border-lime-400', text: 'text-lime-900', name: '萊姆' },
    { bg: 'bg-indigo-200', border: 'border-indigo-400', text: 'text-indigo-900', name: '靛藍' },
    { bg: 'bg-orange-200', border: 'border-orange-400', text: 'text-orange-900', name: '橙色' },
    { bg: 'bg-teal-200', border: 'border-teal-400', text: 'text-teal-900', name: '藍綠' },
    { bg: 'bg-fuchsia-200', border: 'border-fuchsia-400', text: 'text-fuchsia-900', name: '紫紅' },
  ];

  const DEFAULT_COLOR = { bg: 'bg-gray-100', border: 'border-gray-300', text: 'text-gray-900', name: '灰色' };

  // 獲取督導顏色（使用員工代碼或 ID）
  const getSupervisorColor = (store?: StoreWithManager) => {
    if (!store) return DEFAULT_COLOR;
    const key = store.supervisor_code || store.supervisor_id;
    if (!key) return DEFAULT_COLOR;
    return supervisorColorMap[key] || DEFAULT_COLOR;
  };

  // 建立督導顏色映射（根據督導代碼排序後分配顏色，確保一致性）
  const buildSupervisorColorMap = (storeList: StoreWithManager[]) => {
    console.log('Building supervisor color map from stores:', storeList.length);
    
    // 建立唯一督導列表 {code/id, name}
    const supervisorMap = new Map<string, string>();
    storeList.forEach(store => {
      const key = store.supervisor_code || store.supervisor_id;
      if (key && !supervisorMap.has(key)) {
        supervisorMap.set(key, store.supervisor_name || '未知督導');
        console.log(`Found supervisor: ${key} - ${store.supervisor_name}`);
      }
    });

    console.log(`Total unique supervisors found: ${supervisorMap.size}`);

    // 按代碼/ID 排序以確保一致性
    const uniqueSupervisors = Array.from(supervisorMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    const colorMap: Record<string, { bg: string; border: string; text: string; name: string; supervisorName: string }> = {};
    
    // 按排序後的順序分配顏色
    uniqueSupervisors.forEach(([key, name], index) => {
      const color = AVAILABLE_COLORS[index % AVAILABLE_COLORS.length];
      colorMap[key] = {
        ...color,
        supervisorName: name
      };
      console.log(`Assigned ${color.name} to supervisor: ${name} (${key})`);
    });

    console.log('Built supervisor color map:', colorMap);
    setSupervisorColorMap(colorMap);
  };

  useEffect(() => {
    loadData();
  }, [campaignId]);

  const loadData = async () => {
    try {
      setLoading(true);

      // 載入活動和排程資料
      const campaignRes = await fetch(`/api/campaigns/${campaignId}/view`);
      const campaignData = await campaignRes.json();

      if (!campaignData.success) {
        alert(campaignData.error || '載入失敗');
        router.push('/activity-management');
        return;
      }

      setCampaign(campaignData.campaign);
      setSchedules(campaignData.schedules || []);

      // 載入所有門市（使用與管理者介面相同的 API，確保督導資訊一致）
      const storesRes = await fetch('/api/stores-with-supervisors');
      const storesData = await storesRes.json();
      
      console.log('Stores API response:', storesData);
      
      if (storesData.success && storesData.data) {
        const allStores = storesData.data || [];
        console.log('Loaded stores count:', allStores.length);
        console.log('Sample stores with supervisor info:', allStores.slice(0, 3));
        
        // 檢查有多少門市有督導資訊
        const storesWithSupervisor = allStores.filter((s: StoreWithManager) => s.supervisor_id || s.supervisor_code);
        console.log(`Stores with supervisor info: ${storesWithSupervisor.length}/${allStores.length}`);
        
        setStores(allStores);
        
        // 建立督導顏色映射
        buildSupervisorColorMap(allStores);
      } else {
        console.error('Failed to load stores:', storesData.error);
        // 如果 API 失敗，使用備用方案直接查詢，並加入督導資訊
        console.log('Using fallback mechanism to load stores...');
        const supabase = (await import('@/lib/supabase/client')).createClient();
        const { data: allStores, error: storesError } = await supabase
          .from('stores')
          .select('*')
          .eq('is_active', true)
          .order('store_code');
        
        if (!storesError && allStores) {
          // 獲取督導資訊（包含用戶資料）
          const { data: storeManagers } = await supabase
            .from('store_managers')
            .select('store_id, user_id, role_type, user:profiles!store_managers_user_id_fkey(full_name, employee_code)')
            .eq('role_type', 'supervisor');

          console.log('Fetched store managers from fallback:', storeManagers?.length);

          // 將督導資訊加入門市
          const storesWithSupervisors = allStores.map(store => {
            const supervisor = storeManagers?.find(m => m.store_id === store.id);
            const user = supervisor && Array.isArray(supervisor.user) ? supervisor.user[0] : supervisor?.user;
            return {
              ...store,
              supervisor_id: supervisor?.user_id || null,
              supervisor_code: user?.employee_code || null,
              supervisor_name: user?.full_name || null
            };
          });
          
          console.log('Loaded stores from fallback with supervisors:', storesWithSupervisors.length);
          const fallbackWithSupervisor = storesWithSupervisors.filter((s: StoreWithManager) => s.supervisor_id);
          console.log(`Fallback stores with supervisor: ${fallbackWithSupervisor.length}`);
          
          setStores(storesWithSupervisors);
          buildSupervisorColorMap(storesWithSupervisors);
        }
      }

      // 載入特殊日期
      const eventsRes = await fetch('/api/event-dates');
      const eventsData = await eventsRes.json();
      if (eventsData.success) {
        setEvents(eventsData.data || []);
      }

      // 生成日曆日期
      if (campaignData.campaign) {
        const start = new Date(campaignData.campaign.start_date);
        const end = new Date(campaignData.campaign.end_date);
        const dates: Date[] = [];
        
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          dates.push(new Date(d));
        }
        
        setCalendarDates(dates);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      alert('載入失敗');
    } finally {
      setLoading(false);
    }
  };

  // 獲取指定日期的排程門市
  const getSchedulesForDate = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    return schedules.filter(s => s.activity_date.split('T')[0] === dateStr);
  };

  // 獲取特殊日期資訊
  const getEventForDate = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    return events.find(e => e.event_date.split('T')[0] === dateStr);
  };

  // 按月份分組日期
  const groupDatesByMonth = () => {
    const grouped: { [key: string]: Date[] } = {};
    
    calendarDates.forEach(date => {
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!grouped[monthKey]) {
        grouped[monthKey] = [];
      }
      grouped[monthKey].push(date);
    });

    return grouped;
  };

  const monthGroups = groupDatesByMonth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-gray-600">載入中...</div>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-gray-600">找不到活動資料</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link
            href="/activity-management"
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            返回活動列表
          </Link>
          
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center gap-3 mb-2">
              <CalendarIcon className="w-8 h-8 text-purple-600" />
              <h1 className="text-2xl font-bold text-gray-900">{campaign.name}</h1>
            </div>
            <div className="flex items-center gap-6 text-sm text-gray-600">
              <div>
                <span className="font-medium">活動期間：</span>
                {new Date(campaign.start_date).toLocaleDateString('zh-TW')} ~ {new Date(campaign.end_date).toLocaleDateString('zh-TW')}
              </div>
              <div>
                <span className="font-medium">總門市數：</span>
                {stores.length} 間
              </div>
              <div>
                <span className="font-medium">已排程：</span>
                {schedules.length} 間
              </div>
            </div>
          </div>
        </div>

        {/* 日曆 */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">活動排程</h2>
            
            {/* 督導顏色圖例 */}
            {Object.keys(supervisorColorMap).length > 0 && (
              <div className="flex flex-wrap gap-2 items-center">
                <span className="text-sm text-gray-600 font-medium">督導：</span>
                {Object.entries(supervisorColorMap).map(([key, color]) => (
                  <div
                    key={key}
                    className={`flex items-center gap-1 px-2 py-1 rounded border-2 ${color.border} ${color.bg}`}
                  >
                    <div className={`text-xs font-medium ${color.text}`}>
                      {color.supervisorName}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {Object.entries(monthGroups).map(([monthKey, dates]) => {
            // 取得該月第一天
            const firstDate = dates[0];
            const firstDayOfWeek = firstDate.getDay(); // 0=日, 1=一, ..., 6=六
            
            // 計算需要的空白格數（從週一開始）
            const blanksBeforeCount = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
            
            // 創建完整的周數組
            const calendarRows: (Date | null)[][] = [];
            let currentRow: (Date | null)[] = new Array(blanksBeforeCount).fill(null);
            
            dates.forEach(date => {
              if (currentRow.length === 7) {
                calendarRows.push(currentRow);
                currentRow = [];
              }
              currentRow.push(date);
            });
            
            // 補充最後一行的空白格
            while (currentRow.length < 7) {
              currentRow.push(null);
            }
            if (currentRow.length > 0) {
              calendarRows.push(currentRow);
            }

            return (
              <div key={monthKey} className="mb-8 last:mb-0">
                {/* 月份標題 */}
                <div className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-4 py-3 rounded-t-lg mb-2">
                  <h3 className="text-lg font-bold">
                    {firstDate.getFullYear()}年 {firstDate.getMonth() + 1}月
                  </h3>
                </div>

                {/* 星期標題 */}
                <div className="grid grid-cols-7 gap-2 mb-2">
                  {['一', '二', '三', '四', '五', '六', '日'].map(day => (
                    <div key={day} className="text-center font-semibold text-gray-700 py-2">
                      {day}
                    </div>
                  ))}
                </div>

                {/* 日期格子 */}
                {calendarRows.map((week, weekIdx) => (
                  <div key={`${monthKey}-week-${weekIdx}`} className="grid grid-cols-7 gap-2 mb-2">
                    {week.map((date, dayIdx) => {
                      if (!date) {
                        return (
                          <div
                            key={`empty-${weekIdx}-${dayIdx}`}
                            className="aspect-square bg-gray-100 rounded-lg border border-gray-200"
                          />
                        );
                      }

                      const schedForDate = getSchedulesForDate(date);
                      const eventForDate = getEventForDate(date);
                      const isToday = new Date().toDateString() === date.toDateString();

                      return (
                        <div
                          key={date.toISOString()}
                          className={`aspect-square border-2 rounded-lg p-2 ${
                            isToday ? 'border-purple-500 bg-purple-50' : 'border-gray-200 bg-white'
                          }`}
                        >
                          <div className="text-sm font-semibold text-gray-900 mb-1">
                            {date.getDate()}
                          </div>
                          
                          {eventForDate && (
                            <div className="text-xs text-red-600 mb-1">
                              🎉 {eventForDate.description || '特殊日期'}
                            </div>
                          )}
                          
                          <div className="space-y-1">
                            {schedForDate.map(schedule => {
                              const store = stores.find(s => s.id === schedule.store_id);
                              if (!store) return null;

                              const color = getSupervisorColor(store);

                              return (
                                <div
                                  key={schedule.id}
                                  className={`text-xs ${color.bg} ${color.text} px-2 py-1 rounded border-2 ${color.border}`}
                                  title={`${store.store_code} - ${store.store_name}${store.supervisor_name ? ` (督導: ${store.supervisor_name})` : ''}`}
                                >
                                  {store.store_name}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {/* 門市列表 */}
        {schedules.length > 0 && (
          <div className="mt-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <StoreIcon className="w-6 h-6 text-purple-600" />
              已排程門市 ({schedules.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {schedules
                .map(schedule => ({
                  schedule,
                  store: stores.find(s => s.id === schedule.store_id)
                }))
                .filter(item => item.store !== undefined)
                .sort((a, b) => a.store!.store_code.localeCompare(b.store!.store_code))
                .map(({ schedule, store }) => {
                  if (!store) return null;

                  const color = getSupervisorColor(store);

                  return (
                    <div
                      key={schedule.id}
                      className={`flex items-center justify-between p-3 border-2 ${color.border} ${color.bg} rounded-lg hover:opacity-90 transition-opacity`}
                      title={store.supervisor_name ? `督導: ${store.supervisor_name}` : ''}
                    >
                      <div>
                        <div className={`font-medium ${color.text}`}>{store.store_name}</div>
                        <div className="text-sm text-gray-500">
                          {store.store_code}
                          {store.supervisor_name && <span className="ml-2 text-gray-600">({store.supervisor_name})</span>}
                        </div>
                      </div>
                      <div className="text-sm text-purple-600 font-medium">
                        {new Date(schedule.activity_date).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
