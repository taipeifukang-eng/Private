'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar, X } from 'lucide-react';
import Link from 'next/link';

type InspectionRecord = {
  id: string;
  inspection_date: string;
  store: {
    store_name: string;
    store_code: string;
    short_name?: string | null;
  };
  grade: string;
};

type InspectionCalendarProps = {
  inspections: InspectionRecord[];
  currentDate: Date;
  onMonthChange: (date: Date) => void;
};

export default function InspectionCalendar({ inspections, currentDate, onMonthChange }: InspectionCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogTitleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!selectedDate || !dialog) return;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedDate]);

  // 獲取當前月份的年月
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // 獲取當月第一天和最後一天
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);
  
  // 獲取日曆開始日期（週日為一週開始）
  const startDate = new Date(firstDayOfMonth);
  startDate.setDate(startDate.getDate() - startDate.getDay());
  
  // 獲取日曆結束日期
  const endDate = new Date(lastDayOfMonth);
  endDate.setDate(endDate.getDate() + (6 - endDate.getDay()));

  // 生成日曆日期陣列
  const calendarDays: Date[] = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    calendarDays.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  // 根據日期分組巡店記錄
  const inspectionsByDate = useMemo(() => {
    const grouped = new Map<string, InspectionRecord[]>();
    inspections.forEach((inspection) => {
      const dateKey = inspection.inspection_date.split('T')[0];
      if (!grouped.has(dateKey)) {
        grouped.set(dateKey, []);
      }
      grouped.get(dateKey)!.push(inspection);
    });
    return grouped;
  }, [inspections]);

  const selectedInspections = selectedDate ? inspectionsByDate.get(selectedDate) || [] : [];

  // 格式化日期為本地時間字串（避免 toISOString 的 UTC 偏移）
  const formatDateKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // 切換月份
  const goToPreviousMonth = () => {
    onMonthChange(new Date(year, month - 1, 1));
  };

  const goToNextMonth = () => {
    onMonthChange(new Date(year, month + 1, 1));
  };

  const goToToday = () => {
    onMonthChange(new Date());
  };

  // 評級顏色
  const getGradeColor = (grade: string) => {
    const score = parseInt(grade);
    if (score >= 8) return 'bg-purple-100 text-purple-700 border-purple-300';
    if (score >= 6) return 'bg-green-100 text-green-700 border-green-300';
    if (score >= 4) return 'bg-yellow-100 text-yellow-700 border-yellow-300';
    return 'bg-red-100 text-red-700 border-red-300';
  };

  // 月份名稱
  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* 日曆標題列 */}
      <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-purple-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Calendar className="w-6 h-6 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-900">
              {year} 年 {monthNames[month]}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={goToToday}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              今天
            </button>
            <button
              onClick={goToPreviousMonth}
              className="p-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={goToNextMonth}
              className="p-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* 日曆網格 */}
      <div className="p-6">
        {/* 星期標題 */}
        <div className="grid grid-cols-7 gap-2 mb-2">
          {weekDays.map((day) => (
            <div
              key={day}
              className="text-center text-sm font-semibold text-gray-600 py-2"
            >
              {day}
            </div>
          ))}
        </div>

        {/* 日期格子 */}
        <div className="grid grid-cols-7 gap-2">
          {calendarDays.map((date) => {
            const dateKey = formatDateKey(date);
            const dayInspections = inspectionsByDate.get(dateKey) || [];
            const isCurrentMonth = date.getMonth() === month;
            const isToday = 
              date.getDate() === new Date().getDate() &&
              date.getMonth() === new Date().getMonth() &&
              date.getFullYear() === new Date().getFullYear();

            return (
              <button
                key={dateKey}
                type="button"
                onClick={() => setSelectedDate(dateKey)}
                aria-label={`${dateKey}，共 ${dayInspections.length} 筆巡店紀錄，查看全部`}
                aria-haspopup="dialog"
                className={`
                  min-w-0 min-h-[120px] p-2 rounded-lg border-2 transition-all text-left flex flex-col
                  hover:border-blue-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
                  ${isCurrentMonth ? 'bg-white' : 'bg-gray-50'}
                  ${isToday ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'}
                  ${dayInspections.length > 0 ? 'hover:border-blue-400 hover:shadow-md' : ''}
                `}
              >
                {/* 日期數字 */}
                <span className={`
                  text-sm font-semibold mb-1
                  ${isCurrentMonth ? 'text-gray-900' : 'text-gray-400'}
                  ${isToday ? 'text-blue-600' : ''}
                `}>
                  {date.getDate()}
                </span>

                {/* 巡店記錄 */}
                <span className="block w-full space-y-1">
                  {dayInspections.slice(0, 3).map((inspection) => (
                    <span
                      key={inspection.id}
                      className={`
                        block px-2 py-1 rounded text-xs font-medium border
                        transition-all hover:scale-105
                        ${getGradeColor(inspection.grade)}
                      `}
                      title={`${inspection.store.short_name || inspection.store.store_name} - 得分: ${inspection.grade}/10`}
                    >
                      <span className="block truncate">{inspection.store.short_name || inspection.store.store_code}</span>
                      <span className="block text-[10px] opacity-75">得分 {inspection.grade}</span>
                    </span>
                  ))}
                  {dayInspections.length > 3 && (
                    <span className="block text-[10px] text-blue-700 text-center py-1 font-medium">
                      +{dayInspections.length - 3} 筆・查看全部
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 圖例 */}
      <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <span className="font-semibold text-gray-700">圖例：</span>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded bg-purple-100 border border-purple-300"></span>
            <span className="text-gray-600">優秀 (8-10分)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded bg-green-100 border border-green-300"></span>
            <span className="text-gray-600">良好 (6-7分)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded bg-yellow-100 border border-yellow-300"></span>
            <span className="text-gray-600">尚可 (4-5分)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded bg-red-100 border border-red-300"></span>
            <span className="text-gray-600">需改善 (0-3分)</span>
          </div>
        </div>
      </div>

      <dialog
        ref={dialogRef}
        aria-labelledby={dialogTitleId}
        onCancel={() => setSelectedDate(null)}
        onClose={() => setSelectedDate(null)}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
            setSelectedDate(null);
          }
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-lg max-h-[85dvh] rounded-2xl border border-gray-200 p-0 bg-white shadow-2xl backdrop:bg-gray-900/50"
      >
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 bg-blue-50 px-5 py-4">
            <div>
              <h3 id={dialogTitleId} className="text-lg font-bold text-gray-900">
                {selectedDate?.replace(/-/g, '/')} 巡店紀錄
              </h3>
              <p className="mt-1 text-sm text-gray-600">共 {selectedInspections.length} 筆，點選門市查看詳細內容</p>
            </div>
            <button type="button" autoFocus onClick={() => setSelectedDate(null)} aria-label="關閉巡店紀錄視窗" className="shrink-0 rounded-lg p-2 text-gray-600 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
            {selectedInspections.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">當日沒有巡店紀錄</p>
            ) : (
              <ul className="space-y-2">
                {selectedInspections.map((inspection) => (
                  <li key={inspection.id}>
                    <Link href={`/inspection/${inspection.id}`} className="flex items-center gap-3 rounded-xl border border-gray-200 p-4 hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-gray-500">{inspection.store.store_code}</p>
                        <p className="mt-1 break-words font-semibold text-gray-900">{inspection.store.store_name}</p>
                      </div>
                      <span className={`shrink-0 rounded-lg border px-2 py-1 text-xs font-medium ${getGradeColor(inspection.grade)}`}>
                        {inspection.grade ? `${inspection.grade} / 10` : '未評分'}
                      </span>
                      <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-gray-400" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </dialog>
    </div>
  );
}
