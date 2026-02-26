'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Calendar as CalendarIcon, Store as StoreIcon, FileDown, ClipboardList } from 'lucide-react';
import Link from 'next/link';
import { Campaign, CampaignSchedule, Store, EventDate } from '@/types/workflow';
import CampaignStoreDetailModal from '@/components/CampaignStoreDetailModal';

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
  const [supervisorColorMap, setSupervisorColorMap] = useState<Record<string, { bg: string; border: string; text: string; name: string; supervisorName: string; isDisplay?: boolean; hexBg?: string; hexBorder?: string; hexText?: string }>>({});
  const [exporting, setExporting] = useState(false);
  const calendarRef = useRef<HTMLDivElement>(null);
  // 門市細節 Modal 狀態
  const [detailModal, setDetailModal] = useState<{
    open: boolean;
    storeId: string;
    storeName: string;
    activityDate?: string;
  }>({ open: false, storeId: '', storeName: '' });
  const [canEdit, setCanEdit] = useState(false);  // superviosr/admin 可編輯
  // 預設顏色組合（使用對比度更強的顏色）- Tailwind class 和 inline style 版本
  const AVAILABLE_COLORS = [
    { bg: 'bg-blue-200', border: 'border-blue-400', text: 'text-blue-900', name: '藍色', hexBg: '#BFDBFE', hexBorder: '#60A5FA', hexText: '#1E3A5F' },
    { bg: 'bg-emerald-200', border: 'border-emerald-400', text: 'text-emerald-900', name: '翠綠', hexBg: '#A7F3D0', hexBorder: '#34D399', hexText: '#064E3B' },
    { bg: 'bg-purple-200', border: 'border-purple-400', text: 'text-purple-900', name: '紫色', hexBg: '#DDD6FE', hexBorder: '#A78BFA', hexText: '#4C1D95' },
    { bg: 'bg-amber-200', border: 'border-amber-400', text: 'text-amber-900', name: '琥珀', hexBg: '#FDE68A', hexBorder: '#FBBF24', hexText: '#78350F' },
    { bg: 'bg-pink-200', border: 'border-pink-400', text: 'text-pink-900', name: '粉紅', hexBg: '#FBCFE8', hexBorder: '#F472B6', hexText: '#831843' },
    { bg: 'bg-cyan-200', border: 'border-cyan-400', text: 'text-cyan-900', name: '青色', hexBg: '#A5F3FC', hexBorder: '#22D3EE', hexText: '#164E63' },
    { bg: 'bg-rose-200', border: 'border-rose-400', text: 'text-rose-900', name: '玫瑰', hexBg: '#FECDD3', hexBorder: '#FB7185', hexText: '#881337' },
    { bg: 'bg-lime-200', border: 'border-lime-400', text: 'text-lime-900', name: '萊姆', hexBg: '#D9F99D', hexBorder: '#A3E635', hexText: '#365314' },
    { bg: 'bg-indigo-200', border: 'border-indigo-400', text: 'text-indigo-900', name: '靛藍', hexBg: '#C7D2FE', hexBorder: '#818CF8', hexText: '#312E81' },
    { bg: 'bg-orange-200', border: 'border-orange-400', text: 'text-orange-900', name: '橙色', hexBg: '#FED7AA', hexBorder: '#FB923C', hexText: '#7C2D12' },
    { bg: 'bg-teal-200', border: 'border-teal-400', text: 'text-teal-900', name: '藍綠', hexBg: '#99F6E4', hexBorder: '#2DD4BF', hexText: '#134E4A' },
    { bg: 'bg-fuchsia-200', border: 'border-fuchsia-400', text: 'text-fuchsia-900', name: '紫紅', hexBg: '#F5D0FE', hexBorder: '#E879F9', hexText: '#701A75' },
  ];

  const DEFAULT_COLOR = { bg: 'bg-gray-100', border: 'border-gray-300', text: 'text-gray-900', name: '灰色', hexBg: '#F3F4F6', hexBorder: '#D1D5DB', hexText: '#111827' };

  // 獲取督導顏色（使用員工代碼或 ID）
  const getSupervisorColor = (store?: StoreWithManager) => {
    if (!store) return DEFAULT_COLOR;
    
    // 嘗試使用 supervisor_code 作為主要 key
    if (store.supervisor_code && supervisorColorMap[store.supervisor_code]) {
      return supervisorColorMap[store.supervisor_code];
    }
    
    // Fallback: 使用 supervisor_id
    if (store.supervisor_id && supervisorColorMap[store.supervisor_id]) {
      return supervisorColorMap[store.supervisor_id];
    }
    
    // 沒有督導資訊
    return DEFAULT_COLOR;
  };

  // 建立督導顏色映射（根據督導代碼排序後分配顏色，確保一致性）
  const buildSupervisorColorMap = (storeList: StoreWithManager[]) => {
    console.log('=== Building supervisor color map ===');
    console.log('Total stores:', storeList.length);
    
    // 建立唯一督導列表，記錄 code 和 id 的對應關係
    const supervisorInfo = new Map<string, { id: string; code: string | null; name: string }>();
    storeList.forEach(store => {
      if (store.supervisor_id) {
        const key = store.supervisor_code || store.supervisor_id;
        if (!supervisorInfo.has(key)) {
          supervisorInfo.set(key, {
            id: store.supervisor_id,
            code: store.supervisor_code || null,
            name: store.supervisor_name || '未知督導'
          });
          console.log(`Found supervisor: ${store.supervisor_name} (code: ${store.supervisor_code}, id: ${store.supervisor_id})`);
        }
      }
    });

    console.log(`Total unique supervisors found: ${supervisorInfo.size}`);

    // 按代碼/ID 排序以確保一致性
    const sortedSupervisors = Array.from(supervisorInfo.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    const colorMap: Record<string, { bg: string; border: string; text: string; name: string; supervisorName: string; isDisplay?: boolean; hexBg?: string; hexBorder?: string; hexText?: string }> = {};
    
    // 按排序後的順序分配顏色
    sortedSupervisors.forEach(([key, info], index) => {
      const color = AVAILABLE_COLORS[index % AVAILABLE_COLORS.length];
      const colorInfo = {
        ...color,
        supervisorName: info.name,
        isDisplay: true, // 標記這是主要 key，用於圖例顯示
        hexBg: color.hexBg,
        hexBorder: color.hexBorder,
        hexText: color.hexText,
      };
      
      // 只標記一個 key 為 display（優先使用 code）
      if (info.code) {
        colorMap[info.code] = colorInfo;
        // id 作為備用 key，但不用於顯示
        colorMap[info.id] = { ...colorInfo, isDisplay: false };
      } else {
        colorMap[info.id] = colorInfo;
      }
      
      console.log(`Assigned ${color.name} to supervisor: ${info.name} (code: ${info.code}, id: ${info.id})`);
    });

    console.log('Built supervisor color map with keys:', Object.keys(colorMap));
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

      // 用 RBAC 權限的判斷可編輯（activity.store_detail.edit）
      const permRes = await fetch('/api/permissions/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionCode: 'activity.store_detail.edit' })
      });
      const permData = await permRes.json();
      setCanEdit(permData.allowed === true);

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
            const user = supervisor 
              ? (Array.isArray(supervisor.user) ? supervisor.user[0] : supervisor.user)
              : null;
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

  // 開啟門市細節 Modal
  const handleOpenDetail = (store: StoreWithManager, schedule?: CampaignSchedule) => {
    setDetailModal({
      open: true,
      storeId: store.id,
      storeName: store.store_name,
      activityDate: schedule?.activity_date,
    });
  };

  const handleCloseDetail = () => {
    setDetailModal(prev => ({ ...prev, open: false }));
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

  // PDF 匯出功能 - 使用 off-screen HTML 渲染，確保中文不亂碼
  const handleExportPDF = async () => {
    if (!campaign) return;
    setExporting(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      });

      const monthKeys = Object.keys(monthGroups).sort();
      
      // 建立督導圖例 HTML
      const legendEntries = Object.entries(supervisorColorMap)
        .filter(([_, c]) => c.isDisplay !== false)
        .map(([_, c]) => `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:6px;border:2px solid ${c.hexBorder};background:${c.hexBg};font-size:13px;font-weight:600;color:${c.hexText};">${c.supervisorName}</span>`)
        .join('');

      for (let i = 0; i < monthKeys.length; i++) {
        const monthKey = monthKeys[i];
        const dates = monthGroups[monthKey];
        const firstDate = dates[0];
        const monthYear = `${firstDate.getFullYear()}年 ${firstDate.getMonth() + 1}月`;

        // 計算日曆格子
        const firstDayOfWeek = firstDate.getDay();
        const blanksBeforeCount = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
        const calendarRows: (Date | null)[][] = [];
        let currentRow: (Date | null)[] = new Array(blanksBeforeCount).fill(null);
        dates.forEach(date => {
          if (currentRow.length === 7) {
            calendarRows.push(currentRow);
            currentRow = [];
          }
          currentRow.push(date);
        });
        while (currentRow.length < 7) currentRow.push(null);
        if (currentRow.length > 0) calendarRows.push(currentRow);

        // 建立 off-screen HTML 容器（不設固定高度，讓內容自適應）
        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.left = '-9999px';
        container.style.width = '1400px';
        container.style.backgroundColor = 'white';
        container.style.padding = '0';
        container.style.overflow = 'visible';
        document.body.appendChild(container);

        // 日期格子 HTML
        const dayHeaders = ['一', '二', '三', '四', '五', '六', '日'].map(d =>
          `<div style="text-align:center;font-weight:700;font-size:15px;color:#374151;padding:8px 0;">${d}</div>`
        ).join('');

        let rowsHtml = '';
        calendarRows.forEach(week => {
          let cellsHtml = '';
          week.forEach(date => {
            if (!date) {
              cellsHtml += `<div style="background:#F9FAFB;border-radius:8px;border:1px solid #E5E7EB;min-height:96px;"></div>`;
              return;
            }
            const dateStr = date.toISOString().split('T')[0];
            const schedForDate = schedules.filter(s => s.activity_date.split('T')[0] === dateStr);
            const isToday = new Date().toDateString() === date.toDateString();
            const borderColor = isToday ? '#A855F7' : '#E5E7EB';
            const bgColor = isToday ? '#FAF5FF' : '#FFFFFF';

            let storesHtml = '';
            schedForDate.forEach(schedule => {
              const store = stores.find(s => s.id === schedule.store_id);
              if (!store) return;
              const color = getSupervisorColor(store);
              const hexBg = color.hexBg || '#F3F4F6';
              const hexBorder = color.hexBorder || '#D1D5DB';
              const hexText = color.hexText || '#111827';
              storesHtml += `<div style="font-size:12px;background:${hexBg};color:${hexText};padding:3px 8px;border-radius:4px;border:2px solid ${hexBorder};margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${store.store_name}</div>`;
            });

            cellsHtml += `<div style="border:2px solid ${borderColor};border-radius:8px;padding:6px 8px;background:${bgColor};min-height:96px;">
              <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:4px;">${date.getDate()}</div>
              ${storesHtml}
            </div>`;
          });
          rowsHtml += `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px;">${cellsHtml}</div>`;
        });

        container.innerHTML = `
          <div style="font-family:'Microsoft JhengHei','Noto Sans TC',Arial,sans-serif;padding:20px 30px;box-sizing:border-box;">
            <!-- 標題 -->
            <div style="text-align:center;margin-bottom:12px;">
              <div style="font-size:26px;font-weight:800;color:#1F2937;">${campaign.name}</div>
              <div style="font-size:13px;color:#6B7280;margin-top:4px;">
                活動期間：${new Date(campaign.start_date).toLocaleDateString('zh-TW')} ~ ${new Date(campaign.end_date).toLocaleDateString('zh-TW')}
                &nbsp;&nbsp;|&nbsp;&nbsp;總門市數：${stores.length} 間&nbsp;&nbsp;|&nbsp;&nbsp;已排程：${schedules.length} 間
              </div>
            </div>
            <!-- 督導圖例 -->
            <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
              <span style="font-size:13px;color:#6B7280;font-weight:600;">督導：</span>
              ${legendEntries}
            </div>
            <!-- 月份標題 -->
            <div style="background:linear-gradient(to right,#A855F7,#EC4899);color:white;padding:8px 16px;border-radius:8px 8px 0 0;margin-bottom:8px;">
              <span style="font-size:18px;font-weight:700;">${monthYear}</span>
            </div>
            <!-- 星期標題 -->
            <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-bottom:6px;">
              ${dayHeaders}
            </div>
            <!-- 日期格子 -->
            ${rowsHtml}
          </div>
        `;

        // 等待渲染
        await new Promise(resolve => setTimeout(resolve, 150));

        const canvas = await html2canvas(container, {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
        });

        document.body.removeChild(container);

        const imgData = canvas.toDataURL('image/png');
        const pdfWidth = 297;
        const pdfHeight = 210;
        const margin = 5;
        const contentWidth = pdfWidth - margin * 2;
        const contentHeight = (canvas.height / canvas.width) * contentWidth;

        if (i > 0) pdf.addPage();

        // 如果內容高度超出頁面，等比縮放
        if (contentHeight > pdfHeight - margin * 2) {
          const scaledWidth = ((pdfHeight - margin * 2) / contentHeight) * contentWidth;
          const xOffset = margin + (contentWidth - scaledWidth) / 2;
          pdf.addImage(imgData, 'PNG', xOffset, margin, scaledWidth, pdfHeight - margin * 2);
        } else {
          pdf.addImage(imgData, 'PNG', margin, margin, contentWidth, contentHeight);
        }
      }

      pdf.save(`${campaign.name}_活動排程.pdf`);
    } catch (error) {
      console.error('PDF 匯出失敗:', error);
      alert('PDF 匯出失敗，請稍後再試');
    } finally {
      setExporting(false);
    }
  };

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
    <>
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
        <div ref={calendarRef} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">活動排程</h2>

            <div className="flex items-center gap-4">
              {/* 匯出 PDF 按鈕 */}
              <button
                onClick={handleExportPDF}
                disabled={exporting}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 text-sm font-medium"
              >
                <FileDown className="w-4 h-4" />
                {exporting ? '匯出中...' : '匯出PDF'}
              </button>
            
              {/* 督導顏色圖例 */}
              {Object.keys(supervisorColorMap).length > 0 && (
                <div className="flex flex-wrap gap-2 items-center">
                  <span className="text-sm text-gray-600 font-medium">督導：</span>
                  {Object.entries(supervisorColorMap)
                    .filter(([_, color]) => color.isDisplay !== false) // 只顯示標記為 display 的
                    .map(([key, color]) => (
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
                            className="min-h-[80px] bg-gray-100 rounded-lg border border-gray-200"
                          />
                        );
                      }

                      const schedForDate = getSchedulesForDate(date);
                      const eventForDate = getEventForDate(date);
                      const isToday = new Date().toDateString() === date.toDateString();

                      return (
                        <div
                          key={date.toISOString()}
                          className={`min-h-[80px] border-2 rounded-lg p-2 ${
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
                              if (!store) {
                                console.warn('Store not found for schedule:', schedule.id);
                                return null;
                              }

                              const color = getSupervisorColor(store);
                              // 詳細日誌（僅在開發環境）
                              if (schedForDate.indexOf(schedule) === 0) {
                                console.log('Store color info:', {
                                  storeName: store.store_name,
                                  supervisor_id: store.supervisor_id,
                                  supervisor_code: store.supervisor_code,
                                  supervisor_name: store.supervisor_name,
                                  color: color,
                                  colorMapKeys: Object.keys(supervisorColorMap)
                                });
                              }

                              return (
                                <div
                                  key={schedule.id}
                                  onClick={() => handleOpenDetail(store, schedule)}
                                  className={`text-xs ${color.bg} ${color.text} px-2 py-1 rounded border-2 ${color.border} cursor-pointer hover:opacity-80 transition-opacity flex items-center justify-between gap-1`}
                                  title={`${store.store_code} - ${store.store_name}${store.supervisor_name ? ` (督導: ${store.supervisor_name})` : ''} — 點擊查看細節`}
                                >
                                  <span className="truncate">{store.store_name}</span>
                                  <ClipboardList size={10} className="flex-shrink-0 opacity-60" />
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
                      onClick={() => handleOpenDetail(store, schedule)}
                      className={`flex items-center justify-between p-3 border-2 ${color.border} ${color.bg} rounded-lg hover:opacity-90 hover:shadow-md transition-all cursor-pointer`}
                      title={store.supervisor_name ? `督導: ${store.supervisor_name} — 點擊查看細節` : '點擊查看細節'}
                    >
                      <div>
                        <div className={`font-medium ${color.text}`}>{store.store_name}</div>
                        <div className="text-sm text-gray-500">
                          {store.store_code}
                          {store.supervisor_name && <span className="ml-2 text-gray-600">({store.supervisor_name})</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-sm text-purple-600 font-medium">
                          {new Date(schedule.activity_date).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' })}
                        </div>
                        <ClipboardList size={16} className="text-gray-400" />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </div>

    {/* 門市細節 Modal */}
    {campaign && (
      <CampaignStoreDetailModal
        isOpen={detailModal.open}
        onClose={handleCloseDetail}
        campaignId={campaignId}
        storeId={detailModal.storeId}
        storeName={detailModal.storeName}
        activityName={campaign.name}
        activityDate={detailModal.activityDate}
        canEdit={canEdit}
      />
    )}
    </>
  );
}
