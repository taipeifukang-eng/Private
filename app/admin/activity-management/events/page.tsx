'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Plus, Trash2, Calendar } from 'lucide-react';
import Link from 'next/link';
import { EventDate } from '@/types/workflow';

export default function EventDatesPage() {
  const [events, setEvents] = useState<EventDate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  
  // 表單狀態
  const [formData, setFormData] = useState({
    event_date: '',
    description: '',
    event_type: 'holiday' as 'holiday' | 'company_event' | 'other',
    is_blocked: false
  });

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/event-dates');
      const data = await res.json();
      if (data.success) {
        setEvents(data.events || []);
      }
    } catch (error) {
      console.error('Error loading events:', error);
      alert('載入資料失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.event_date) {
      alert('請選擇日期');
      return;
    }

    try {
      const res = await fetch('/api/event-dates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await res.json();

      if (data.success) {
        alert('新增成功');
        setShowModal(false);
        setFormData({
          event_date: '',
          description: '',
          event_type: 'holiday',
          is_blocked: false
        });
        loadEvents();
      } else {
        alert(data.error || '新增失敗');
      }
    } catch (error) {
      console.error('Error saving event:', error);
      alert('新增失敗');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除此特殊日期嗎？')) {
      return;
    }

    try {
      const res = await fetch(`/api/event-dates?id=${id}`, {
        method: 'DELETE'
      });

      const data = await res.json();

      if (data.success) {
        alert('刪除成功');
        loadEvents();
      } else {
        alert(data.error || '刪除失敗');
      }
    } catch (error) {
      console.error('Error deleting event:', error);
      alert('刪除失敗');
    }
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

  // 按月份分組
  const eventsByMonth = events.reduce((acc, event) => {
    const month = event.event_date.substring(0, 7); // YYYY-MM
    if (!acc[month]) acc[month] = [];
    acc[month].push(event);
    return acc;
  }, {} as Record<string, EventDate[]>);

  const sortedMonths = Object.keys(eventsByMonth).sort();

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        {/* 標題 */}
        <div className="mb-6">
          <div className="flex items-center gap-4 mb-4">
            <Link
              href="/admin/activity-management"
              className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-6 h-6" />
            </Link>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">特殊日期管理</h1>
              <p className="text-gray-600 mt-1">管理國定假日、公司活動等特殊日期</p>
            </div>
          </div>

          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            新增特殊日期
          </button>
        </div>

        {/* 日期列表 */}
        <div className="space-y-6">
          {sortedMonths.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 text-lg">尚無特殊日期</p>
              <p className="text-gray-400 text-sm mt-2">點擊「新增特殊日期」開始建立</p>
            </div>
          ) : (
            sortedMonths.map(month => (
              <div key={month} className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="p-4 bg-gray-50 border-b border-gray-200">
                  <h3 className="font-semibold text-gray-900">
                    {new Date(month + '-01').toLocaleDateString('zh-TW', { year: 'numeric', month: 'long' })}
                  </h3>
                </div>
                <div className="divide-y divide-gray-200">
                  {eventsByMonth[month].map(event => (
                    <div key={event.id} className="p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl">
                              {event.event_type === 'holiday' ? '🎉' : event.event_type === 'company_event' ? '📅' : '📌'}
                            </span>
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900">
                                  {new Date(event.event_date).toLocaleDateString('zh-TW', { 
                                    month: 'long', 
                                    day: 'numeric',
                                    weekday: 'short'
                                  })}
                                </span>
                                {event.is_blocked && (
                                  <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded-full">
                                    禁止排程
                                  </span>
                                )}
                              </div>
                              <div className="text-sm text-gray-600 mt-1">
                                {event.description || '無說明'}
                              </div>
                              <div className="text-xs text-gray-500 mt-1">
                                類型：
                                {event.event_type === 'holiday' && '國定假日'}
                                {event.event_type === 'company_event' && '公司活動'}
                                {event.event_type === 'other' && '其他'}
                              </div>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => handleDelete(event.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="刪除"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 新增 Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">新增特殊日期</h2>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  日期 *
                </label>
                <input
                  type="date"
                  value={formData.event_date}
                  onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  說明
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="例：農曆春節"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  類型 *
                </label>
                <select
                  value={formData.event_type}
                  onChange={(e) => setFormData({ ...formData, event_type: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="holiday">國定假日</option>
                  <option value="company_event">公司活動</option>
                  <option value="other">其他</option>
                </select>
              </div>

              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="is_blocked"
                  checked={formData.is_blocked}
                  onChange={(e) => setFormData({ ...formData, is_blocked: e.target.checked })}
                  className="mr-2"
                />
                <label htmlFor="is_blocked" className="text-sm text-gray-700">
                  禁止在此日排程門市活動
                </label>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false);
                    setFormData({
                      event_date: '',
                      description: '',
                      event_type: 'holiday',
                      is_blocked: false
                    });
                  }}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  新增
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
