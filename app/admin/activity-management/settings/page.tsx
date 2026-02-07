'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Save, Store as StoreIcon } from 'lucide-react';
import Link from 'next/link';
import { Store, StoreActivitySettings } from '@/types/workflow';

const WEEKDAY_OPTIONS = [
  { value: 1, label: '週一' },
  { value: 2, label: '週二' },
  { value: 3, label: '週三' },
  { value: 4, label: '週四' },
  { value: 5, label: '週五' },
  { value: 6, label: '週六' },
  { value: 7, label: '週日' }
];

export default function ActivitySettingsPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [settings, setSettings] = useState<Map<string, StoreActivitySettings>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedStore, setSelectedStore] = useState<string>('');

  // 表單狀態
  const [allowedDays, setAllowedDays] = useState<number[]>([]);
  const [forbiddenDays, setForbiddenDays] = useState<number[]>([]);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      // 載入門市
      const storesRes = await fetch('/api/supervisors/stores');
      const storesData = await storesRes.json();
      setStores(storesData.stores || []);

      // 載入設定
      const settingsRes = await fetch('/api/store-activity-settings');
      const settingsData = await settingsRes.json();
      
      const settingsMap = new Map<string, StoreActivitySettings>();
      (settingsData.settings || []).forEach((setting: StoreActivitySettings) => {
        settingsMap.set(setting.store_id, setting);
      });
      setSettings(settingsMap);

    } catch (error) {
      console.error('Error loading data:', error);
      alert('載入資料失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleStoreSelect = (storeId: string) => {
    setSelectedStore(storeId);
    const setting = settings.get(storeId);
    
    if (setting) {
      setAllowedDays(setting.allowed_days || []);
      setForbiddenDays(setting.forbidden_days || []);
      setNotes(setting.notes || '');
    } else {
      setAllowedDays([]);
      setForbiddenDays([]);
      setNotes('');
    }
  };

  const toggleAllowedDay = (day: number) => {
    setAllowedDays(prev => 
      prev.includes(day) 
        ? prev.filter(d => d !== day)
        : [...prev, day]
    );
  };

  const toggleForbiddenDay = (day: number) => {
    setForbiddenDays(prev => 
      prev.includes(day) 
        ? prev.filter(d => d !== day)
        : [...prev, day]
    );
  };

  const handleSave = async () => {
    if (!selectedStore) {
      alert('請選擇門市');
      return;
    }

    try {
      setSaving(true);

      const res = await fetch('/api/store-activity-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: selectedStore,
          allowed_days: allowedDays.length > 0 ? allowedDays : null,
          forbidden_days: forbiddenDays.length > 0 ? forbiddenDays : null,
          notes: notes || null
        })
      });

      const data = await res.json();

      if (data.success) {
        alert('儲存成功');
        loadData();
      } else {
        alert(data.error || '儲存失敗');
      }
    } catch (error) {
      console.error('Error saving setting:', error);
      alert('儲存失敗');
    } finally {
      setSaving(false);
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

  const selectedStoreData = stores.find(s => s.id === selectedStore);

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
              <h1 className="text-3xl font-bold text-gray-900">門市活動設定</h1>
              <p className="text-gray-600 mt-1">設定各門市可辦或不可辦活動的日期規則</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* 門市列表 */}
          <div className="md:col-span-1">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900 mb-3">選擇門市</h3>
              <div className="space-y-1 max-h-[600px] overflow-y-auto">
                {stores.map(store => {
                  const hasSetting = settings.has(store.id);
                  return (
                    <button
                      key={store.id}
                      onClick={() => handleStoreSelect(store.id)}
                      className={`w-full text-left p-3 rounded-lg transition-colors ${
                        selectedStore === store.id
                          ? 'bg-blue-100 border-blue-300 border'
                          : 'hover:bg-gray-50 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-sm">{store.store_name}</div>
                          <div className="text-xs text-gray-500">{store.store_code}</div>
                        </div>
                        {hasSetting && (
                          <div className="text-xs text-green-600">✓ 已設定</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 設定表單 */}
          <div className="md:col-span-2">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              {selectedStore ? (
                <>
                  <div className="mb-6">
                    <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
                      <StoreIcon className="w-6 h-6 text-blue-600" />
                      {selectedStoreData?.store_name}
                    </h3>
                    <p className="text-sm text-gray-600 mt-1">{selectedStoreData?.store_code}</p>
                  </div>

                  <div className="space-y-6">
                    {/* 允許的星期 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        限定只能辦活動的星期
                        <span className="text-gray-500 font-normal ml-2">（若不設定則使用預設規則）</span>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {WEEKDAY_OPTIONS.map(option => (
                          <button
                            key={option.value}
                            onClick={() => toggleAllowedDay(option.value)}
                            className={`px-4 py-2 rounded-lg border transition-colors ${
                              allowedDays.includes(option.value)
                                ? 'bg-green-100 border-green-400 text-green-700'
                                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      {allowedDays.length > 0 && (
                        <p className="text-sm text-gray-600 mt-2">
                          此門市只能在 {allowedDays.map(d => WEEKDAY_OPTIONS.find(o => o.value === d)?.label).join('、')} 辦活動
                        </p>
                      )}
                    </div>

                    {/* 禁止的星期 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        禁止辦活動的星期
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {WEEKDAY_OPTIONS.map(option => (
                          <button
                            key={option.value}
                            onClick={() => toggleForbiddenDay(option.value)}
                            className={`px-4 py-2 rounded-lg border transition-colors ${
                              forbiddenDays.includes(option.value)
                                ? 'bg-red-100 border-red-400 text-red-700'
                                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      {forbiddenDays.length > 0 && (
                        <p className="text-sm text-gray-600 mt-2">
                          此門市不能在 {forbiddenDays.map(d => WEEKDAY_OPTIONS.find(o => o.value === d)?.label).join('、')} 辦活動
                        </p>
                      )}
                    </div>

                    {/* 備註 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        備註
                      </label>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="例：因人力配置，優先週六"
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>

                    {/* 衝突警告 */}
                    {allowedDays.length > 0 && forbiddenDays.length > 0 && allowedDays.some(d => forbiddenDays.includes(d)) && (
                      <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                        <p className="text-red-700 text-sm">
                          ⚠️ 警告：有星期同時設為「允許」和「禁止」，請檢查設定
                        </p>
                      </div>
                    )}

                    {/* 儲存按鈕 */}
                    <div className="flex gap-3 pt-4">
                      <button
                        onClick={handleSave}
                        disabled={saving}
                        className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                      >
                        <Save className="w-4 h-4" />
                        {saving ? '儲存中...' : '儲存設定'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-12">
                  <StoreIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                  <p className="text-gray-500">請從左側選擇門市進行設定</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
