'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Wand2, Save, AlertTriangle, Calendar as CalendarIcon, Store as StoreIcon } from 'lucide-react';
import Link from 'next/link';
import { Campaign, CampaignSchedule, Store, StoreActivitySettings, EventDate } from '@/types/workflow';

interface StoreWithManager extends Store {
  supervisor_id?: string;
}

export default function ScheduleEditPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.id as string;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [stores, setStores] = useState<StoreWithManager[]>([]);
  const [schedules, setSchedules] = useState<CampaignSchedule[]>([]);
  const [settings, setSettings] = useState<StoreActivitySettings[]>([]);
  const [events, setEvents] = useState<EventDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // 暫存區（未安排的門市）
  const [unscheduledStores, setUnscheduledStores] = useState<string[]>([]);
  
  // 日曆資料
  const [calendarDates, setCalendarDates] = useState<Date[]>([]);

  useEffect(() => {
    loadData();
  }, [campaignId]);

  const loadData = async () => {
    try {
      setLoading(true);

      // 載入活動資訊
      const campaignRes = await fetch('/api/campaigns');
      const campaignData = await campaignRes.json();
      const currentCampaign = campaignData.campaigns?.find((c: Campaign) => c.id === campaignId);
      if (!currentCampaign) {
        alert('找不到活動');
        router.push('/admin/activity-management');
        return;
      }
      setCampaign(currentCampaign);

      // 載入門市列表（含督導資訊）
      const storesRes = await fetch('/api/stores-with-supervisors');
      const storesData = await storesRes.json();
      setStores(storesData.stores || []);

      // 載入門市設定
      const settingsRes = await fetch('/api/store-activity-settings');
      const settingsData = await settingsRes.json();
      setSettings(settingsData.settings || []);

      // 載入特殊日期
      const eventsRes = await fetch('/api/event-dates');
      const eventsData = await eventsRes.json();
      setEvents(eventsData.events || []);

      // 載入現有排程
      const schedulesRes = await fetch(`/api/campaign-schedules?campaign_id=${campaignId}`);
      const schedulesData = await schedulesRes.json();
      setSchedules(schedulesData.schedules || []);

      // 建立日曆範圍
      generateCalendar(currentCampaign.start_date, currentCampaign.end_date);

      // 初始化未安排門市列表
      const scheduledStoreIds = new Set((schedulesData.schedules || []).map((s: CampaignSchedule) => s.store_id));
      const unscheduled = (storesData.stores || [])
        .filter((store: Store) => !scheduledStoreIds.has(store.id))
        .map((store: Store) => store.id);
      setUnscheduledStores(unscheduled);

    } catch (error) {
      console.error('Error loading data:', error);
      alert('載入資料失敗');
    } finally {
      setLoading(false);
    }
  };

  const generateCalendar = (startDate: string, endDate: string) => {
    const dates: Date[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(new Date(d));
    }

    setCalendarDates(dates);
  };

  // 自動排程演算法
  const autoSchedule = () => {
    if (!campaign) return;

    const allowedDays = [3, 6, 7]; // 週三(3)、週六(6)、週日(7)
    const maxPerDay = 2;
    
    // 按督導區分組門市
    const supervisorGroups = new Map<string, string[]>();
    stores.forEach(store => {
      const supervisorId = store.supervisor_id || 'unassigned';
      if (!supervisorGroups.has(supervisorId)) {
        supervisorGroups.set(supervisorId, []);
      }
      supervisorGroups.get(supervisorId)!.push(store.id);
    });

    // 取得可用日期（過濾掉被阻擋的日期）
    const availableDates = calendarDates.filter(date => {
      const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay(); // 轉換為 1-7
      if (!allowedDays.includes(dayOfWeek)) return false;

      const dateStr = date.toISOString().split('T')[0];
      const event = events.find(e => e.event_date.split('T')[0] === dateStr);
      return !event?.is_blocked;
    });

    if (availableDates.length === 0) {
      alert('活動期間內沒有可用的排程日期（週三、週六、週日且未被阻擋）');
      return;
    }

    // 排程結果
    const newSchedules: { store_id: string; activity_date: string }[] = [];
    const failedStores: { store: StoreWithManager; reason: string }[] = [];
    const supervisorLastDate = new Map<string, Date>();
    const dateCount = new Map<string, number>();
    const dateSupervisors = new Map<string, Set<string>>(); // 記錄每天已有哪些督導區

    // 初始化日期計數和督導區追蹤
    availableDates.forEach(date => {
      const dateStr = date.toISOString().split('T')[0];
      dateCount.set(dateStr, 0);
      dateSupervisors.set(dateStr, new Set<string>());
    });

    // 為每個門市安排日期（優先嚴格規則）
    for (const store of stores) {
      const storeSettings = settings.find(s => s.store_id === store.id);
      const supervisorId = store.supervisor_id || 'unassigned';

      let assigned = false;
      let failReason = '';

      for (const date of availableDates) {
        const dateStr = date.toISOString().split('T')[0];
        const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay();

        // 檢查門市特定限制
        if (storeSettings) {
          if (storeSettings.forbidden_days?.includes(dayOfWeek)) {
            failReason = `${store.store_name} 不能在週${['', '一', '二', '三', '四', '五', '六', '日'][dayOfWeek]}辦活動`;
            continue;
          }
          if (storeSettings.allowed_days && storeSettings.allowed_days.length > 0 && !storeSettings.allowed_days.includes(dayOfWeek)) {
            failReason = `${store.store_name} 只能在指定日期辦活動`;
            continue;
          }
        }

        // 檢查該日是否已滿
        if ((dateCount.get(dateStr) || 0) >= maxPerDay) {
          failReason = '所有可用日期都已排滿';
          continue;
        }

        // 檢查同一天是否已有同督導區的門市
        if (dateSupervisors.get(dateStr)?.has(supervisorId)) {
          failReason = '同督導區門市不能在同一天';
          continue;
        }

        // 檢查前後一天是否有同督導區的門市
        let hasAdjacentConflict = false;
        for (let offset = -1; offset <= 1; offset += 2) { // 只檢查 -1 和 +1
          const checkDate = new Date(date);
          checkDate.setDate(checkDate.getDate() + offset);
          const checkDateStr = checkDate.toISOString().split('T')[0];
          if (dateSupervisors.get(checkDateStr)?.has(supervisorId)) {
            hasAdjacentConflict = true;
            failReason = '同督導區門市不能連續兩天辦活動';
            break;
          }
        }
        if (hasAdjacentConflict) continue;

        // 安排此日期
        newSchedules.push({
          store_id: store.id,
          activity_date: dateStr
        });

        supervisorLastDate.set(supervisorId, date);
        dateCount.set(dateStr, (dateCount.get(dateStr) || 0) + 1);
        dateSupervisors.get(dateStr)!.add(supervisorId);
        assigned = true;
        break;
      }

      if (!assigned) {
        failedStores.push({ store, reason: failReason || '無可用日期' });
      }
    }

    // 第二輪：嘗試為失敗的門市放寬限制（允許連續，但不同天）
    if (failedStores.length > 0) {
      console.log('第二輪排程：放寬連續限制...');
      const remainingFailed: typeof failedStores = [];
      
      for (const { store } of failedStores) {
        const storeSettings = settings.find(s => s.store_id === store.id);
        const supervisorId = store.supervisor_id || 'unassigned';
        let assigned = false;

        for (const date of availableDates) {
          const dateStr = date.toISOString().split('T')[0];
          const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay();

          // 仍然檢查門市限制
          if (storeSettings) {
            if (storeSettings.forbidden_days?.includes(dayOfWeek)) continue;
            if (storeSettings.allowed_days && storeSettings.allowed_days.length > 0 && !storeSettings.allowed_days.includes(dayOfWeek)) continue;
          }

          // 檢查該日是否已滿
          if ((dateCount.get(dateStr) || 0) >= maxPerDay) continue;

          // 只檢查同一天（放寬連續限制）
          if (dateSupervisors.get(dateStr)?.has(supervisorId)) continue;

          // 安排此日期
          newSchedules.push({
            store_id: store.id,
            activity_date: dateStr
          });

          dateCount.set(dateStr, (dateCount.get(dateStr) || 0) + 1);
          dateSupervisors.get(dateStr)!.add(supervisorId);
          assigned = true;
          break;
        }

        if (!assigned) {
          remainingFailed.push({ store, reason: '即使放寬限制仍無法排程' });
        }
      }

      // 顯示詳細結果
      let message = `系統已自動排程 ${newSchedules.length}/${stores.length} 間門市。`;
      
      if (remainingFailed.length > 0) {
        message += `\n\n⚠️ 以下門市無法排程：\n`;
        remainingFailed.forEach(({ store, reason }) => {
          message += `\n• ${store.store_name}：${reason}`;
        });
        message += '\n\n建議：\n1. 檢查門市活動設定是否過於嚴格\n2. 延長活動期間以增加可用日期\n3. 手動安排這些門市';
      }
      
      message += '\n\n確定要套用此排程嗎？';
      
      if (confirm(message)) {
        applySchedules(newSchedules);
      }
    } else {
      // 全部成功
      if (confirm(`系統已自動排程 ${newSchedules.length}/${stores.length} 間門市。\n確定要套用此排程嗎？`)) {
        applySchedules(newSchedules);
      }
    }
  };

  const applySchedules = async (newSchedules: { store_id: string; activity_date: string }[]) => {
    try {
      setSaving(true);

      const res = await fetch('/api/campaign-schedules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: campaignId,
          schedules: newSchedules
        })
      });

      const data = await res.json();

      if (data.success) {
        alert('排程已更新');
        loadData();
      } else {
        alert(data.error || '更新失敗');
      }
    } catch (error) {
      console.error('Error applying schedules:', error);
      alert('更新失敗');
    } finally {
      setSaving(false);
    }
  };

  // 手動調整：將門市加到指定日期
  const assignStoreToDate = async (storeId: string, date: Date) => {
    const dateStr = date.toISOString().split('T')[0];

    // 檢查該日是否已有兩間門市
    const schedulesOnDate = schedules.filter(s => s.activity_date.split('T')[0] === dateStr);
    if (schedulesOnDate.length >= 2) {
      alert('該日已有兩間門市，請先移除其中一間');
      return;
    }

    try {
      const res = await fetch('/api/campaign-schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: campaignId,
          store_id: storeId,
          activity_date: dateStr
        })
      });

      const data = await res.json();

      if (data.success) {
        loadData();
      } else {
        alert(data.error || '操作失敗');
      }
    } catch (error) {
      console.error('Error assigning store:', error);
      alert('操作失敗');
    }
  };

  // 移除排程
  const removeSchedule = async (scheduleId: string) => {
    try {
      const res = await fetch(`/api/campaign-schedules?id=${scheduleId}`, {
        method: 'DELETE'
      });

      const data = await res.json();

      if (data.success) {
        loadData();
      } else {
        alert(data.error || '刪除失敗');
      }
    } catch (error) {
      console.error('Error removing schedule:', error);
      alert('刪除失敗');
    }
  };

  // 拖放處理
  const handleDragStart = (e: React.DragEvent, storeId: string) => {
    e.dataTransfer.setData('storeId', storeId);
  };

  const handleDrop = (e: React.DragEvent, date: Date) => {
    e.preventDefault();
    const storeId = e.dataTransfer.getData('storeId');
    if (storeId) {
      assignStoreToDate(storeId, date);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  if (!campaign) return null;

  // 按週分組日期
  const weeks: Date[][] = [];
  let currentWeek: Date[] = [];
  
  calendarDates.forEach((date, index) => {
    const dayOfWeek = date.getDay();
    
    if (dayOfWeek === 1 && currentWeek.length > 0) {
      weeks.push([...currentWeek]);
      currentWeek = [];
    }
    
    currentWeek.push(date);
    
    if (index === calendarDates.length - 1) {
      weeks.push([...currentWeek]);
    }
  });

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-[1600px] mx-auto">
        {/* 標題列 */}
        <div className="mb-6">
          <div className="flex items-center gap-4 mb-4">
            <Link
              href="/admin/activity-management"
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-6 h-6" />
            </Link>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">{campaign.name}</h1>
              <p className="text-gray-600 mt-1">
                {new Date(campaign.start_date).toLocaleDateString('zh-TW')} - {new Date(campaign.end_date).toLocaleDateString('zh-TW')}
              </p>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={autoSchedule}
              disabled={saving}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <Wand2 className="w-4 h-4" />
              自動排程
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* 暫存區 */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sticky top-6">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <StoreIcon className="w-5 h-5" />
                未安排門市 ({unscheduledStores.length})
              </h3>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {unscheduledStores.map(storeId => {
                  const store = stores.find(s => s.id === storeId);
                  if (!store) return null;
                  return (
                    <div
                      key={storeId}
                      draggable
                      onDragStart={(e) => handleDragStart(e, storeId)}
                      className="p-3 bg-gray-50 rounded-lg border border-gray-200 cursor-move hover:bg-gray-100 transition-colors"
                    >
                      <div className="font-medium text-sm">{store.store_name}</div>
                      <div className="text-xs text-gray-500">{store.store_code}</div>
                    </div>
                  );
                })}
                {unscheduledStores.length === 0 && (
                  <p className="text-gray-400 text-sm text-center py-4">
                    所有門市已安排
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* 日曆表格 */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {['週一', '週二', '週三', '週四', '週五', '週六', '週日'].map(day => (
                        <th key={day} className="px-2 py-3 text-center text-sm font-medium text-gray-700 min-w-[140px]">
                          {day}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {weeks.map((week, weekIndex) => (
                      <tr key={weekIndex} className="divide-x divide-gray-200">
                        {[1, 2, 3, 4, 5, 6, 0].map(targetDay => {
                          const date = week.find(d => d.getDay() === targetDay);
                          
                          if (!date) {
                            return <td key={targetDay} className="p-2 bg-gray-50"></td>;
                          }

                          const dateStr = date.toISOString().split('T')[0];
                          const daySchedules = schedules.filter(s => s.activity_date.split('T')[0] === dateStr);
                          const event = events.find(e => e.event_date.split('T')[0] === dateStr);
                          const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay();
                          const isPreferred = [3, 6, 7].includes(dayOfWeek);

                          return (
                            <td
                              key={targetDay}
                              onDrop={(e) => handleDrop(e, date)}
                              onDragOver={handleDragOver}
                              className={`p-2 align-top min-h-[120px] ${
                                isPreferred ? 'bg-blue-50' : 'bg-white'
                              } ${event?.is_blocked ? 'bg-red-50' : ''}`}
                            >
                              <div className="text-xs text-gray-600 mb-2">
                                {date.getDate()}
                                {event && (
                                  <div className="text-xs text-purple-600 mt-1">
                                    {event.event_type === 'holiday' ? '🎉' : '📅'} {event.description}
                                  </div>
                                )}
                              </div>

                              <div className="space-y-1">
                                {daySchedules.map(schedule => (
                                  <div
                                    key={schedule.id}
                                    draggable
                                    onDragStart={(e) => handleDragStart(e, schedule.store_id)}
                                    className="p-2 bg-white border border-blue-200 rounded text-xs cursor-move hover:shadow-md transition-shadow"
                                  >
                                    <div className="font-medium text-blue-900">
                                      {schedule.store?.store_name}
                                    </div>
                                    <button
                                      onClick={() => removeSchedule(schedule.id)}
                                      className="text-red-500 hover:text-red-700 mt-1"
                                    >
                                      移除
                                    </button>
                                  </div>
                                ))}

                                {daySchedules.length < 2 && !event?.is_blocked && (
                                  <div className="text-xs text-gray-400 text-center py-2 border border-dashed border-gray-300 rounded">
                                    拖放門市到此
                                  </div>
                                )}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 圖例說明 */}
            <div className="mt-4 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
              <h4 className="font-semibold text-gray-900 mb-2">圖例</h4>
              <div className="flex flex-wrap gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-blue-50 border border-gray-300"></div>
                  <span>優先日期（週三、週六、週日）</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 bg-red-50 border border-gray-300"></div>
                  <span>禁止排程日期</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>🎉</span>
                  <span>國定假日</span>
                </div>
                <div className="flex items-center gap-2">
                  <span>📅</span>
                  <span>公司活動</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
