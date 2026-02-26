'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Wand2, Save, X, AlertTriangle, Calendar as CalendarIcon, Store as StoreIcon, CheckCircle, Send, ClipboardList, Edit2 } from 'lucide-react';
import Link from 'next/link';
import { Campaign, CampaignSchedule, Store, StoreActivitySettings, EventDate } from '@/types/workflow';
import CampaignStoreDetailModal from '@/components/CampaignStoreDetailModal';
import CampaignDetailPreviewTable from '@/components/CampaignDetailPreviewTable';
import { createClient } from '@/lib/supabase/client';

interface StoreWithManager extends Store {
  supervisor_id?: string;
  supervisor_code?: string;
  supervisor_name?: string;
}

export default function ScheduleEditPage() {
  const params = useParams();
  const router = useRouter();
  const campaignId = params.id as string;

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [stores, setStores] = useState<StoreWithManager[]>([]);
  const [schedules, setSchedules] = useState<CampaignSchedule[]>([]); // 本地狀態
  const [originalSchedules, setOriginalSchedules] = useState<CampaignSchedule[]>([]); // 原始資料（用於比較）
  const [settings, setSettings] = useState<StoreActivitySettings[]>([]);
  const [events, setEvents] = useState<EventDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  
  // 暫存區（未安排的門市）
  const [unscheduledStores, setUnscheduledStores] = useState<string[]>([]);
  
  // === Tab 狀態 ===
  const [activeTab, setActiveTab] = useState<'schedule' | 'store_details' | 'preview'>('schedule');

  // 預覽表：全部已載入的細節資料
  const [allDetails, setAllDetails] = useState<import('@/types/workflow').CampaignStoreDetail[]>([]);

  // 門市細節 Modal
  const [detailModal, setDetailModal] = useState<{
    open: boolean;
    storeId: string;
    storeName: string;
    activityDate?: string;
  }>({ open: false, storeId: '', storeName: '' });

  // 已經填寫細節的門市記錄（用於 Tab 2 顯示狀態）
  const [filledStoreIds, setFilledStoreIds] = useState<Set<string>>(new Set());
  
  // 日曆資料
  const [calendarDates, setCalendarDates] = useState<Date[]>([]);

  // 當前用戶權限
  const [canEditCalendar,    setCanEditCalendar]    = useState(false); // activity.campaign.edit
  const [canEditStoreDetail, setCanEditStoreDetail] = useState(false); // activity.store_detail.edit

  // 督導顏色映射（使用 state 確保一致性）
  const [supervisorColorMap, setSupervisorColorMap] = useState<Record<string, { bg: string; border: string; text: string; name: string }>>({});

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

  // 獲取督導顏色
  const getSupervisorColor = (supervisorId?: string) => {
    if (!supervisorId) return DEFAULT_COLOR;
    return supervisorColorMap[supervisorId] || DEFAULT_COLOR;
  };

  // 建立督導顏色映射（根據督導 ID 排序後分配顏色，確保一致性）
  const buildSupervisorColorMap = (storeList: StoreWithManager[]) => {
    console.log('=== 建立督導顏色映射（管理頁面）===');
    console.log('門市總數:', storeList.length);
    console.log('前3家門市範例:', storeList.slice(0, 3).map(s => ({
      name: s.store_name,
      supervisor_id: s.supervisor_id,
      supervisor_code: s.supervisor_code,
      supervisor_name: s.supervisor_name
    })));
    
    const uniqueSupervisors = Array.from(new Set(
      storeList.map(s => s.supervisor_id).filter(Boolean)
    )) as string[];

    // 排序督導 ID 以確保一致性
    uniqueSupervisors.sort();

    console.log('督導總數:', uniqueSupervisors.length);
    console.log('督導 IDs:', uniqueSupervisors);

    const colorMap: Record<string, { bg: string; border: string; text: string; name: string }> = {};
    
    // 按排序後的順序分配顏色
    uniqueSupervisors.forEach((supervisorId, index) => {
      colorMap[supervisorId] = AVAILABLE_COLORS[index % AVAILABLE_COLORS.length];
      
      // 找出這個督導管理的門市
      const supervisorStores = storeList.filter(s => s.supervisor_id === supervisorId);
      console.log(`督導 ${supervisorId}: ${colorMap[supervisorId].name} (${supervisorStores.length}家) - ${supervisorStores.map(s => s.store_name).join(', ')}`);
    });

    console.log('顏色映射表:', colorMap);
    setSupervisorColorMap(colorMap);
  };

  useEffect(() => {
    loadData();
  }, [campaignId]);

  // 切換到門市細節 Tab 時自動載入已填寫狀態
  useEffect(() => {
    if ((activeTab === 'store_details' || activeTab === 'preview') && campaignId) {
      fetch(`/api/campaign-store-details?campaign_id=${campaignId}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && Array.isArray(data.data)) {
            const ids = new Set<string>(data.data.map((d: { store_id: string }) => d.store_id));
            setFilledStoreIds(ids);
            setAllDetails(data.data);
          }
        })
        .catch(err => console.error('Error loading store details:', err));
    }
  }, [activeTab, campaignId]);

  // 離開頁面時的警告
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = ''; // Chrome 需要這個
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

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
      console.log('Stores API response:', storesData);
      const loadedStores = storesData.data || storesData.stores || [];
      console.log('Loaded stores count:', loadedStores.length);
      console.log('Sample stores:', loadedStores.slice(0, 3));
      setStores(loadedStores);

      // 建立督導顏色映射
      buildSupervisorColorMap(loadedStores);

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
      const loadedSchedules = schedulesData.schedules || [];
      setSchedules(loadedSchedules);
      setOriginalSchedules(JSON.parse(JSON.stringify(loadedSchedules))); // 深拷貝保存原始資料
      setHasUnsavedChanges(false);

      // 建立日曆範圍
      generateCalendar(currentCampaign.start_date, currentCampaign.end_date);

      // 初始化未安排門市列表
      const scheduledStoreIds = new Set(loadedSchedules.map((s: CampaignSchedule) => s.store_id));
      const unscheduled = (storesData.data || storesData.stores || [])
        .filter((store: Store) => !scheduledStoreIds.has(store.id))
        .map((store: Store) => store.id);
      console.log('Unscheduled stores:', unscheduled);
      setUnscheduledStores(unscheduled);

      // 檢查權限
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: userRoles } = await supabase.from('user_roles').select(`
            role:roles!inner (
              code,
              role_permissions!inner (
                is_allowed,
                permission:permissions!inner (code)
              )
            )
          `).eq('user_id', user.id).eq('is_active', true);

          const permSet = new Set<string>();
          let isRbacAdmin = false;
          (userRoles ?? []).forEach((ur: any) => {
            if (ur.role?.code === 'admin') isRbacAdmin = true;
            ur.role?.role_permissions?.forEach((rp: any) => {
              if (rp.is_allowed && rp.permission?.code) permSet.add(rp.permission.code);
            });
          });
          // 僅 RBAC admin 角色才跳過權限檢查（不再依賴舊 profiles.role）
          setCanEditCalendar(isRbacAdmin || permSet.has('activity.campaign.edit'));
          setCanEditStoreDetail(isRbacAdmin || permSet.has('activity.store_detail.edit'));
        }
      } catch (permErr) {
        console.warn('權限檢查失敗，使用預設禁用編輯：', permErr);
      }

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

    console.log('=== 開始自動排程 ===');
    console.log('門市總數:', stores.length);
    console.log('門市資料:', stores.map(s => ({ 
      name: s.store_name, 
      supervisor: s.supervisor_id || 'unassigned' 
    })));

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

    console.log('督導區分組:', Array.from(supervisorGroups.entries()).map(([sup, stores]) => ({
      supervisor: sup,
      storeCount: stores.length
    })));

    // 取得可用日期（過濾掉被阻擋的日期）
    const availableDates = calendarDates.filter(date => {
      const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay(); // 轉換為 1-7
      if (!allowedDays.includes(dayOfWeek)) return false;

      const dateStr = date.toISOString().split('T')[0];
      const event = events.find(e => e.event_date.split('T')[0] === dateStr);
      return !event?.is_blocked;
    });

    console.log('可用日期數:', availableDates.length);
    console.log('可用日期:', availableDates.map(d => d.toISOString().split('T')[0]));

    if (availableDates.length === 0) {
      alert('活動期間內沒有可用的排程日期（週三、週六、週日且未被阻擋）');
      return;
    }

    // 排程結果
    const newSchedules: { store_id: string; activity_date: string }[] = [];
    const failedStores: { store: StoreWithManager; reason: string }[] = [];
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

      console.log(`\n處理門市: ${store.store_name}, 督導: ${supervisorId}`);

      let assigned = false;
      let failReason = '';
      let attemptCount = 0;

      for (const date of availableDates) {
        attemptCount++;
        const dateStr = date.toISOString().split('T')[0];
        const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay();

        // 檢查門市特定限制
        if (storeSettings) {
          if (storeSettings.forbidden_days?.includes(dayOfWeek)) {
            failReason = `不能在週${['', '一', '二', '三', '四', '五', '六', '日'][dayOfWeek]}`;
            continue;
          }
          if (storeSettings.allowed_days && storeSettings.allowed_days.length > 0 && !storeSettings.allowed_days.includes(dayOfWeek)) {
            failReason = `只能在指定日期`;
            continue;
          }
        }

        // 檢查該日是否已滿
        if ((dateCount.get(dateStr) || 0) >= maxPerDay) {
          failReason = `${dateStr} 已滿 (${dateCount.get(dateStr)}/${maxPerDay})`;
          continue;
        }

        // 檢查同一天是否已有同督導區的門市
        if (dateSupervisors.get(dateStr)?.has(supervisorId)) {
          failReason = `${dateStr} 已有同督導區門市`;
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
            failReason = `${dateStr} 前後有同督導區 (${checkDateStr})`;
            break;
          }
        }
        if (hasAdjacentConflict) continue;

        // 安排此日期
        console.log(`  ✓ 成功排程: ${dateStr}`);
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
        console.log(`  ✗ 失敗: ${failReason} (嘗試 ${attemptCount} 個日期)`);
        failedStores.push({ store, reason: failReason || '無可用日期' });
      }
    }

    console.log(`\n第一階段完成: ${newSchedules.length}/${stores.length} 成功`);

    // 第二輪：嘗試為失敗的門市放寬限制（允許連續，但不同天）
    if (failedStores.length > 0) {
      console.log('\n=== 第二階段：放寬連續限制 ===');
      const remainingFailed: typeof failedStores = [];
      
      for (const { store } of failedStores) {
        const storeSettings = settings.find(s => s.store_id === store.id);
        const supervisorId = store.supervisor_id || 'unassigned';
        let assigned = false;

        console.log(`\n重試門市: ${store.store_name}`);

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
          console.log(`  ✓ 放寬後成功: ${dateStr}`);
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
          console.log(`  ✗ 仍然失敗`);
          remainingFailed.push({ store, reason: '即使放寬限制仍無法排程' });
        }
      }

      console.log(`\n最終結果: ${newSchedules.length}/${stores.length} 成功`);

      // 顯示詳細結果
      let message = `系統已自動排程 ${newSchedules.length}/${stores.length} 間門市。`;
      
      if (remainingFailed.length > 0) {
        message += `\n\n⚠️ 以下 ${remainingFailed.length} 間門市無法排程：\n`;
        remainingFailed.forEach(({ store, reason }) => {
          message += `\n• ${store.store_name}：${reason}`;
        });
        message += '\n\n建議：\n1. 檢查門市活動設定是否過於嚴格\n2. 延長活動期間以增加可用日期\n3. 手動安排這些門市\n4. 查看瀏覽器 Console 的詳細除錯資訊';
      }
      
      message += '\n\n⚠️ 執行後會覆蓋現有排程！\n確定要套用此排程嗎？';
      
      if (confirm(message)) {
        applyAutoSchedules(newSchedules);
      }
    } else {
      // 全部成功
      if (confirm(`系統已自動排程 ${newSchedules.length}/${stores.length} 間門市。\n\n⚠️ 執行後會覆蓋現有排程！\n確定要套用此排程嗎？`)) {
        applyAutoSchedules(newSchedules);
      }
    }
  };

  // 自動排程：直接套用到本地狀態
  const applyAutoSchedules = (newSchedules: { store_id: string; activity_date: string }[]) => {
    // 生成新的排程物件（加上臨時 ID）
    const scheduleObjects: CampaignSchedule[] = newSchedules.map((s, index) => ({
      id: `temp-${Date.now()}-${index}`, // 臨時 ID
      campaign_id: campaignId,
      store_id: s.store_id,
      activity_date: s.activity_date,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      store: stores.find(store => store.id === s.store_id)
    }));

    setSchedules(scheduleObjects);
    setHasUnsavedChanges(true);

    // 更新未安排門市列表
    const scheduledStoreIds = new Set(scheduleObjects.map(s => s.store_id));
    const unscheduled = stores
      .filter(store => !scheduledStoreIds.has(store.id))
      .map(store => store.id);
    setUnscheduledStores(unscheduled);
  };

  // 統一儲存所有變更
  const saveAllChanges = async () => {
    if (!hasUnsavedChanges) {
      alert('沒有需要儲存的變更');
      return;
    }

    if (!confirm('確定要儲存所有變更嗎？')) {
      return;
    }

    try {
      setSaving(true);

      // 準備要儲存的資料
      const schedulesToSave = schedules.map(s => ({
        store_id: s.store_id,
        activity_date: s.activity_date
      }));

      const res = await fetch('/api/campaign-schedules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: campaignId,
          schedules: schedulesToSave
        })
      });

      const data = await res.json();

      if (data.success) {
        alert('儲存成功！');
        // 重新載入資料以獲取真實 ID
        await loadData();
      } else {
        alert(data.error || '儲存失敗');
      }
    } catch (error) {
      console.error('Error saving changes:', error);
      alert('儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  // 取消變更
  const cancelChanges = () => {
    if (!hasUnsavedChanges) {
      return;
    }

    if (confirm('確定要放棄所有未儲存的變更嗎？')) {
      setSchedules(JSON.parse(JSON.stringify(originalSchedules)));
      setHasUnsavedChanges(false);
      
      // 更新未安排門市列表
      const scheduledStoreIds = new Set(originalSchedules.map(s => s.store_id));
      const unscheduled = stores
        .filter(store => !scheduledStoreIds.has(store.id))
        .map(store => store.id);
      setUnscheduledStores(unscheduled);
    }
  };

  // 發布/取消發布
  const handlePublish = async (publishType: 'supervisors' | 'store_managers' | 'inventory_team') => {
    if (!campaign) return;

    const publishMap: Record<string, { field: keyof typeof campaign; label: string }> = {
      supervisors: { field: 'published_to_supervisors', label: '督導' },
      store_managers: { field: 'published_to_store_managers', label: '店長' },
      inventory_team: { field: 'published_to_inventory_team', label: '盤點組人員' },
    };
    const { field, label: target } = publishMap[publishType];
    const isCurrentlyPublished = campaign[field];
    
    const action = isCurrentlyPublished ? '取消發布' : '發布';

    if (!confirm(`確定要${action}給${target}嗎？`)) {
      return;
    }

    try {
      setSaving(true);

      const res = await fetch('/api/campaigns/publish', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: campaign.id,
          publishType,
          status: !isCurrentlyPublished
        })
      });

      const data = await res.json();

      if (data.success) {
        alert(`${action}成功！`);
        // 更新本地 campaign 狀態
        setCampaign(data.campaign);
      } else {
        alert(data.error || `${action}失敗`);
      }
    } catch (error) {
      console.error('Error publishing:', error);
      alert(`${action}失敗`);
    } finally {
      setSaving(false);
    }
  };

  // 手動調整：將門市加到指定日期（只更新本地狀態）
  const assignStoreToDate = (storeId: string, date: Date) => {
    const dateStr = date.toISOString().split('T')[0];

    // 檢查該日是否已有兩間門市
    const schedulesOnDate = schedules.filter(s => s.activity_date.split('T')[0] === dateStr);
    if (schedulesOnDate.length >= 2) {
      alert('該日已有兩間門市，請先移除其中一間');
      return;
    }

    // 檢查該門市是否已有排程
    const existingSchedule = schedules.find(s => s.store_id === storeId);
    if (existingSchedule) {
      // 更新現有排程
      const updatedSchedules = schedules.map(s =>
        s.store_id === storeId
          ? { ...s, activity_date: dateStr, updated_at: new Date().toISOString() }
          : s
      );
      setSchedules(updatedSchedules);
    } else {
      // 新增排程
      const newSchedule: CampaignSchedule = {
        id: `temp-${Date.now()}`,
        campaign_id: campaignId,
        store_id: storeId,
        activity_date: dateStr,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        store: stores.find(s => s.id === storeId)
      };
      setSchedules([...schedules, newSchedule]);
      
      // 從未安排列表移除
      setUnscheduledStores(unscheduledStores.filter(id => id !== storeId));
    }

    setHasUnsavedChanges(true);
  };

  // 移除排程（只更新本地狀態）
  const removeSchedule = (scheduleId: string) => {
    const schedule = schedules.find(s => s.id === scheduleId);
    if (!schedule) return;

    const updatedSchedules = schedules.filter(s => s.id !== scheduleId);
    setSchedules(updatedSchedules);

    // 加回未安排列表
    if (!unscheduledStores.includes(schedule.store_id)) {
      setUnscheduledStores([...unscheduledStores, schedule.store_id]);
    }

    setHasUnsavedChanges(true);
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

  // 按月份分組日期，每個月份獨立成區塊
  const monthGroups: { year: number; month: number; weeks: (Date | null)[][] }[] = [];
  
  // 按月份分組
  const datesByMonth = new Map<string, Date[]>();
  calendarDates.forEach(date => {
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    if (!datesByMonth.has(key)) {
      datesByMonth.set(key, []);
    }
    datesByMonth.get(key)!.push(date);
  });

  // 為每個月份生成完整的週行（包含空白日期）
  datesByMonth.forEach((dates, key) => {
    const [year, month] = key.split('-').map(Number);
    const firstDate = dates[0];
    const lastDate = dates[dates.length - 1];
    
    // 找到該月第一天是星期幾（0=週日, 1=週一）
    const firstDayOfWeek = firstDate.getDay();
    const startDayOfWeek = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1; // 轉換為週一=0
    
    // 找到該月最後一天是星期幾
    const lastDayOfWeek = lastDate.getDay();
    const endDayOfWeek = lastDayOfWeek === 0 ? 6 : lastDayOfWeek - 1;
    
    const weeks: (Date | null)[][] = [];
    let currentWeek: (Date | null)[] = [];
    
    // 補齊第一週前面的空白
    for (let i = 0; i < startDayOfWeek; i++) {
      currentWeek.push(null);
    }
    
    // 加入所有日期
    dates.forEach(date => {
      currentWeek.push(date);
      if (currentWeek.length === 7) {
        weeks.push([...currentWeek]);
        currentWeek = [];
      }
    });
    
    // 補齊最後一週後面的空白
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) {
        currentWeek.push(null);
      }
      weeks.push([...currentWeek]);
    }
    
    monthGroups.push({ year, month, weeks });
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
            {canEditCalendar && (
              <button
                onClick={autoSchedule}
                disabled={saving}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                <Wand2 className="w-4 h-4" />
                自動排程
              </button>
            )}
            {/* 發布按鈕 */}
            <div className="flex gap-3 border-l border-gray-300 pl-3">
              <button
                onClick={() => handlePublish('supervisors')}
                disabled={saving}
                className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 ${
                  campaign?.published_to_supervisors
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {campaign?.published_to_supervisors ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    已發布給督導
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    發布給督導
                  </>
                )}
              </button>

              <button
                onClick={() => handlePublish('store_managers')}
                disabled={saving}
                className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 ${
                  campaign?.published_to_store_managers
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {campaign?.published_to_store_managers ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    已發布給店長
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    發布給店長
                  </>
                )}
              </button>

              <button
                onClick={() => handlePublish('inventory_team')}
                disabled={saving}
                className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50 ${
                  campaign?.published_to_inventory_team
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-orange-600 text-white hover:bg-orange-700'
                }`}
              >
                {campaign?.published_to_inventory_team ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    已發布給盤點組/行銷部/營業部助理
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    發布給盤點組/行銷部/營業部助理
                  </>
                )}
              </button>
            </div>
            
            {hasUnsavedChanges && canEditCalendar && (
              <>
                <button
                  onClick={saveAllChanges}
                  disabled={saving}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {saving ? '儲存中...' : '儲存變更'}
                </button>
                
                <button
                  onClick={cancelChanges}
                  disabled={saving}
                  className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors flex items-center gap-2 disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                  取消
                </button>
              </>
            )}
          </div>
        </div>

        {/* === Tab 切換按鈕 === */}
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('schedule')}
            className={`px-5 py-2.5 font-medium text-sm border-b-2 -mb-px transition-colors flex items-center gap-2 ${
              activeTab === 'schedule'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <CalendarIcon className="w-4 h-4" />
            排程管理
          </button>
          <button
            onClick={() => setActiveTab('store_details')}
            className={`px-5 py-2.5 font-medium text-sm border-b-2 -mb-px transition-colors flex items-center gap-2 ${
              activeTab === 'store_details'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <ClipboardList className="w-4 h-4" />
            門市細節
            {schedules.length > 0 && (
              <span className="ml-1 px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs">
                {schedules.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('preview')}
            className={`px-5 py-2.5 font-medium text-sm border-b-2 -mb-px transition-colors flex items-center gap-2 ${
              activeTab === 'preview'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className="text-base leading-none">📄</span>
            預覽表
          </button>
        </div>

        {/* Tab 1: 排程管理 */}
        {activeTab === 'schedule' && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* 暫存區 */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sticky top-6">
              <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <StoreIcon className="w-5 h-5" />
                未安排門市 ({unscheduledStores.length})
              </h3>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {unscheduledStores
                  .map(storeId => stores.find(s => s.id === storeId))
                  .filter((store): store is StoreWithManager => store !== undefined)
                  .map(store => {
                    const color = getSupervisorColor(store.supervisor_id);
                    return (
                      <div
                        key={store.id}
                        {...(canEditCalendar ? { draggable: true, onDragStart: (e: React.DragEvent) => handleDragStart(e, store.id) } : {})}
                        className={`p-3 ${color.bg} rounded-lg border ${color.border} ${canEditCalendar ? 'cursor-move hover:opacity-80' : 'cursor-default'} transition-opacity`}
                      >
                        <div className={`font-medium text-sm ${color.text}`}>{store.store_name}</div>
                        <div className="text-xs opacity-70">{store.store_code}</div>
                      </div>
                    );
                  })}
                {unscheduledStores.filter(id => stores.find(s => s.id === id)).length === 0 && (
                  <p className="text-gray-400 text-sm text-center py-4">
                    {unscheduledStores.length > 0 ? '未找到門市資料' : '所有門市已安排'}
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
                    {monthGroups.map((monthGroup, monthIndex) => (
                      <React.Fragment key={`${monthGroup.year}-${monthGroup.month}`}>
                        {/* 月份標題行 */}
                        <tr className="bg-gradient-to-r from-indigo-50 to-purple-50 border-t-4 border-indigo-400">
                          <td colSpan={7} className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <CalendarIcon className="w-5 h-5 text-indigo-600" />
                              <span className="text-lg font-bold text-indigo-900">
                                {monthGroup.year}年 {monthGroup.month + 1}月
                              </span>
                            </div>
                          </td>
                        </tr>
                        
                        {/* 該月份的所有週 */}
                        {monthGroup.weeks.map((week, weekIndex) => (
                          <tr key={weekIndex} className="divide-x divide-gray-200">
                            {week.map((date, dayIndex) => {
                              if (!date) {
                                // 空白日期格子
                                return <td key={dayIndex} className="p-2 bg-gray-100 min-h-[120px]"></td>;
                              }

                              const dateStr = date.toISOString().split('T')[0];
                              const daySchedules = schedules.filter(s => s.activity_date.split('T')[0] === dateStr);
                              const event = events.find(e => e.event_date.split('T')[0] === dateStr);
                              const dayOfWeek = date.getDay() === 0 ? 7 : date.getDay();
                              const isPreferred = [3, 6, 7].includes(dayOfWeek);

                              return (
                                <td
                                  key={dayIndex}
                                  {...(canEditCalendar ? { onDrop: (e: React.DragEvent) => handleDrop(e, date), onDragOver: handleDragOver } : {})}
                                  className={`p-2 align-top min-h-[120px] border-l-2 ${
                                    date.getDate() === 1 ? 'border-l-indigo-400' : ''
                                  } ${isPreferred ? 'bg-blue-50' : 'bg-white'}`}
                                >
                                  <div className="text-xs text-gray-600 mb-2">
                                    <span className={date.getDate() === 1 ? 'font-bold text-indigo-700' : ''}>
                                      {date.getDate()}
                                      {date.getDate() === 1 && (
                                        <span className="ml-1 text-indigo-600">({date.getMonth() + 1}月)</span>
                                      )}
                                    </span>
                                    {event && (
                                      <div className="text-xs text-purple-600 mt-1">
                                        {event.event_type === 'holiday' ? '🎉' : '📅'} {event.description}
                                      </div>
                                    )}
                                  </div>

                                  <div className="space-y-1">
                                    {daySchedules.map(schedule => {
                                      const store = stores.find(s => s.id === schedule.store_id);
                                      const color = getSupervisorColor(store?.supervisor_id);
                                      return (
                                        <div
                                          key={schedule.id}
                                          {...(canEditCalendar ? { draggable: true, onDragStart: (e: React.DragEvent) => handleDragStart(e, schedule.store_id) } : {})}
                                          className={`p-2 ${color.bg} border ${color.border} rounded text-xs ${canEditCalendar ? 'cursor-move hover:shadow-md' : 'cursor-default'} transition-shadow`}
                                        >
                                          <div className={`font-medium ${color.text}`}>
                                            {schedule.store?.store_name}
                                          </div>
                                          {canEditCalendar && (
                                            <button
                                              onClick={() => removeSchedule(schedule.id)}
                                              className="text-red-500 hover:text-red-700 mt-1 text-xs"
                                            >
                                              ❌ 移除
                                            </button>
                                          )}
                                        </div>
                                      );
                                    })}

                                    {daySchedules.length < 2 && canEditCalendar && (
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
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 圖例說明 */}
            <div className="mt-4 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
              <h4 className="font-semibold text-gray-900 mb-3">圖例</h4>
              
              {/* 督導顏色圖例 */}
              <div className="mb-3">
                <div className="text-sm font-medium text-gray-700 mb-2">督導區分（共 {Object.keys(supervisorColorMap).length} 個督導）</div>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                  {Array.from(new Set(stores.map(s => s.supervisor_id).filter(Boolean))).map(supervisorId => {
                    const color = getSupervisorColor(supervisorId);
                    const supervisorStores = stores.filter(s => s.supervisor_id === supervisorId);
                    const firstStoreName = supervisorStores[0]?.store_name || '';
                    return (
                      <div key={supervisorId} className="flex items-center gap-2 p-2 border border-gray-200 rounded">
                        <div className={`w-8 h-8 ${color.bg} border-2 ${color.border} rounded flex-shrink-0`}></div>
                        <div>
                          <div className="font-medium">{color.name}</div>
                          <div className="text-xs text-gray-600">{firstStoreName} 等 {supervisorStores.length} 家</div>
                        </div>
                      </div>
                    );
                  })}
                  {stores.some(s => !s.supervisor_id) && (
                    <div className="flex items-center gap-2 p-2 border border-gray-200 rounded">
                      <div className="w-8 h-8 bg-gray-100 border-2 border-gray-300 rounded flex-shrink-0"></div>
                      <div>
                        <div className="font-medium">未分配</div>
                        <div className="text-xs text-gray-600">無督導門市</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* 日期類型圖例 */}
              <div>
                <div className="text-sm font-medium text-gray-700 mb-2">日期類型</div>
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
        )} {/* end Tab 1: 排程管理 */}

        {/* Tab 2: 門市細節 */}
        {activeTab === 'store_details' && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <ClipboardList className="w-6 h-6 text-purple-600" />
                門市細節設定
              </h2>
              <p className="text-sm text-gray-500">點擊「編輯」為每間門市填寫人員安排細節</p>
            </div>

            {schedules.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p>尚無已排程門市，請先在「排程管理」Tab 中安排門市</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-3 font-semibold text-gray-700">門市</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-700">督導</th>
                      <th className="text-left px-4 py-3 font-semibold text-gray-700">活動日期</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-700">細節狀態</th>
                      <th className="text-center px-4 py-3 font-semibold text-gray-700">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {schedules
                      .map(schedule => ({
                        schedule,
                        store: stores.find(s => s.id === schedule.store_id)
                      }))
                      .filter(item => item.store !== undefined)
                      .sort((a, b) => (a.store?.store_code || '').localeCompare(b.store?.store_code || ''))
                      .map(({ schedule, store }) => {
                        if (!store) return null;
                        const color = getSupervisorColor(store.supervisor_id);
                        const isFilled = filledStoreIds.has(store.id);
                        return (
                          <tr key={schedule.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className={`w-3 h-3 rounded-full ${color.bg} border-2 ${color.border}`} />
                                <div>
                                  <div className="font-medium text-gray-900">{store.store_name}</div>
                                  <div className="text-xs text-gray-500">{store.store_code}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-gray-600">{store.supervisor_name || '—'}</td>
                            <td className="px-4 py-3 text-gray-600">
                              {new Date(schedule.activity_date).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit', weekday: 'short' })}
                            </td>
                            <td className="px-4 py-3 text-center">
                              {isFilled ? (
                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                                  <CheckCircle className="w-3 h-3" />
                                  已設定
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-500 rounded-full text-xs font-medium">
                                  待填寫
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                onClick={() => setDetailModal({
                                  open: true,
                                  storeId: store.id,
                                  storeName: store.store_name,
                                  activityDate: schedule.activity_date,
                                })}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-xs font-medium"
                              >
                                <Edit2 className="w-3 h-3" />
                                編輯細節
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 門市細節 Modal（在 Tab 2 批次編輯用）*/}
        {campaign && detailModal.open && (
          <CampaignStoreDetailModal
            isOpen={detailModal.open}
            onClose={() => {
              setDetailModal(prev => ({ ...prev, open: false }));
              // 關閉後標記為已填寫，並同步更新預覽表資料
              if (detailModal.storeId) {
                setFilledStoreIds(prev => new Set(Array.from(prev).concat(detailModal.storeId)));
                fetch(`/api/campaign-store-details?campaign_id=${campaignId}`)
                  .then(r => r.json())
                  .then(d => { if (d.success) setAllDetails(d.data); })
                  .catch(() => {});
              }
            }}
            campaignId={campaignId}
            storeId={detailModal.storeId}
            storeName={detailModal.storeName}
            activityName={campaign.name}
            campaignType={campaign.campaign_type || 'promotion'}
            activityDate={detailModal.activityDate}
            canEdit={canEditStoreDetail}
          />
        )}

        {/* Tab 3: 預覽表 */}
        {activeTab === 'preview' && campaign && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                <span className="text-xl">📄</span>
                門市細節預覽表
              </h2>
            </div>
            {schedules.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <p>尚無已排程門市，請先在「排程管理」Tab 中安排門市</p>
              </div>
            ) : (
              <CampaignDetailPreviewTable
                campaignName={campaign.name}
                campaignType={campaign.campaign_type || 'promotion'}
                stores={stores}
                schedules={schedules}
                details={allDetails}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
