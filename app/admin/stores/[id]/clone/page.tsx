'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ChevronLeft, Store, Hash, User, Tag, Building2,
  Loader2, History, Calendar, ArrowRight, CheckCircle,
} from 'lucide-react';
import { relocateStore, getStoreRelocationHistory } from '@/app/store/actions';

interface StoreData {
  id: string;
  store_code: string;
  store_name: string;
  short_name: string | null;
  hr_store_code: string | null;
  manager_name: string | null;
  address: string | null;
  phone: string | null;
  is_active: boolean;
}

interface RelocationRecord {
  id: string;
  relocation_date: string;
  old_store_code: string | null;
  new_store_code: string | null;
  old_store_name: string | null;
  new_store_name: string | null;
  old_short_name: string | null;
  new_short_name: string | null;
  old_hr_store_code: string | null;
  new_hr_store_code: string | null;
  old_manager_name: string | null;
  new_manager_name: string | null;
  note: string | null;
  created_at: string;
}

export default function CloneStorePage() {
  const router = useRouter();
  const params = useParams();
  const storeId = params.id as string;

  const today = new Date().toISOString().split('T')[0];

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [store, setStore] = useState<StoreData | null>(null);
  const [history, setHistory] = useState<RelocationRecord[]>([]);

  // 搬遷表單
  const [newStoreCode, setNewStoreCode] = useState('');
  const [newStoreName, setNewStoreName] = useState('');
  const [newShortName, setNewShortName] = useState('');
  const [newHrStoreCode, setNewHrStoreCode] = useState('');
  const [newManagerName, setNewManagerName] = useState('');
  const [relocationDate, setRelocationDate] = useState(today);
  const [note, setNote] = useState('');

  useEffect(() => {
    loadData();
  }, [storeId]);

  const loadData = async () => {
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();

      const { data: storeData, error } = await supabase
        .from('stores')
        .select('*')
        .eq('id', storeId)
        .single();

      if (error || !storeData) {
        alert('找不到該門市');
        router.push('/admin/stores');
        return;
      }

      setStore(storeData);
      setNewStoreCode(storeData.store_code);
      setNewStoreName(storeData.store_name);
      setNewShortName(storeData.short_name || '');
      setNewHrStoreCode(storeData.hr_store_code || '');
      setNewManagerName(storeData.manager_name || '');

      const histResult = await getStoreRelocationHistory(storeId);
      if (histResult.success) {
        setHistory(histResult.data as RelocationRecord[]);
      }
    } catch (error) {
      console.error('Error loading store:', error);
      alert('載入失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleRelocate = async () => {
    if (!newStoreCode.trim()) {
      alert('請填寫門市代碼');
      return;
    }
    if (!newStoreName.trim()) {
      alert('請填寫門市名稱');
      return;
    }
    if (!relocationDate) {
      alert('請選擇搬遷日期');
      return;
    }

    const codeChanged = newStoreCode.trim() !== store?.store_code;
    const nameChanged = newStoreName.trim() !== store?.store_name;
    const confirmLines = [
      '確定要更新以下門市資料嗎？',
      '',
      codeChanged ? `門市代碼：${store?.store_code} → ${newStoreCode}` : null,
      nameChanged ? `門市名稱：${store?.store_name} → ${newStoreName}` : null,
      `搬遷日期：${relocationDate}`,
    ].filter(Boolean).join('\n');

    if (!confirm(confirmLines)) return;

    setSaving(true);
    try {
      const result = await relocateStore({
        store_id: storeId,
        new_store_code: newStoreCode.trim(),
        new_store_name: newStoreName.trim(),
        new_short_name: newShortName.trim() || null,
        new_hr_store_code: newHrStoreCode.trim() || null,
        new_manager_name: newManagerName.trim() || null,
        relocation_date: relocationDate,
        note: note.trim() || undefined,
      });

      if (result.error) {
        alert(`❌ 更新失敗：${result.error}`);
        return;
      }

      alert('✅ 門市資料更新成功！搬遷記錄已保存。');

      // 直接更新本地狀態，不重新 loading
      setStore(prev =>
        prev
          ? {
              ...prev,
              store_code: newStoreCode.trim(),
              store_name: newStoreName.trim(),
              short_name: newShortName.trim() || null,
              hr_store_code: newHrStoreCode.trim() || null,
              manager_name: newManagerName.trim() || null,
            }
          : prev
      );
      setNote('');
      setRelocationDate(today);

      // 重新載入歷史
      const histResult = await getStoreRelocationHistory(storeId);
      if (histResult.success) setHistory(histResult.data as RelocationRecord[]);
    } catch (error) {
      console.error('Error relocating store:', error);
      alert('操作失敗');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 lg:p-8 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-2" />
          <p className="text-gray-600">載入中...</p>
        </div>
      </div>
    );
  }

  if (!store) return null;

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link
            href="/admin/stores"
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 text-sm"
          >
            <ChevronLeft size={18} />
            返回門市管理
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Store className="text-orange-500" size={32} />
            門市搬遷 / 更名
          </h1>
          <p className="text-gray-500 mt-1 text-sm">
            更新門市代碼、名稱或負責人資料，員工及管理關係不受影響，系統自動保留完整變更記錄。
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 目前門市資訊 */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Store className="text-blue-600" size={20} />
              目前門市資訊
            </h2>

            <div className="space-y-3 bg-gray-50 rounded-lg p-4 text-sm">
              <InfoRow label="門市代碼">
                <span className="font-mono font-semibold text-blue-600">{store.store_code}</span>
              </InfoRow>
              <InfoRow label="門市名稱">{store.store_name}</InfoRow>
              <InfoRow label="簡稱">{store.short_name || '-'}</InfoRow>
              <InfoRow label="人資系統代碼">{store.hr_store_code || '-'}</InfoRow>
              <InfoRow label="負責人">{store.manager_name || '-'}</InfoRow>
              {store.address && <InfoRow label="地址">{store.address}</InfoRow>}
              <InfoRow label="狀態">
                <span
                  className={`px-2 py-0.5 text-xs rounded-full ${
                    store.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}
                >
                  {store.is_active ? '營運中' : '已停止'}
                </span>
              </InfoRow>
            </div>

            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
              <p className="font-semibold mb-1">📋 說明</p>
              <p>搬遷功能僅更新門市代碼、名稱、簡稱、人資代碼及負責人等基本資料。</p>
              <p className="mt-1 text-blue-600">
                門市員工、店長、督導及區經理的管理關係，以及所有歷史紀錄均保持不變。
              </p>
            </div>
          </div>

          {/* 搬遷表單 */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <ArrowRight className="text-orange-500" size={20} />
              更新資料
            </h2>

            <div className="space-y-4">
              {/* 搬遷日期 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <Calendar size={14} className="inline mr-1" />
                  搬遷日期 *
                </label>
                <input
                  type="date"
                  value={relocationDate}
                  onChange={(e) => setRelocationDate(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                />
                <p className="text-xs text-gray-400 mt-1">記錄本次搬遷／更名的生效日期</p>
              </div>

              {/* 門市代碼 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <Hash size={14} className="inline mr-1" />
                  門市代碼 *
                </label>
                <input
                  type="text"
                  value={newStoreCode}
                  onChange={(e) => setNewStoreCode(e.target.value.toUpperCase())}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent uppercase text-sm"
                  placeholder="門市代碼"
                />
              </div>

              {/* 門市名稱 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <Store size={14} className="inline mr-1" />
                  門市名稱 *
                </label>
                <input
                  type="text"
                  value={newStoreName}
                  onChange={(e) => setNewStoreName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                  placeholder="門市名稱"
                />
              </div>

              {/* 簡稱 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <Tag size={14} className="inline mr-1" />
                  簡稱
                </label>
                <input
                  type="text"
                  value={newShortName}
                  onChange={(e) => setNewShortName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                  placeholder="門市簡稱（選填，清空則移除）"
                />
              </div>

              {/* 人資系統門市代碼 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <Building2 size={14} className="inline mr-1" />
                  人資系統門市代碼
                </label>
                <input
                  type="text"
                  value={newHrStoreCode}
                  onChange={(e) => setNewHrStoreCode(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                  placeholder="人資系統代碼（選填）"
                />
              </div>

              {/* 負責人 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  <User size={14} className="inline mr-1" />
                  負責人
                </label>
                <input
                  type="text"
                  value={newManagerName}
                  onChange={(e) => setNewManagerName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent text-sm"
                  placeholder="負責人姓名（選填，清空則移除）"
                />
              </div>

              {/* 備註 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">備註</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent resize-none text-sm"
                  placeholder="本次搬遷備註（選填）"
                />
              </div>
            </div>

            {/* 操作按鈕 */}
            <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
              <Link
                href="/admin/stores"
                className="px-5 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm"
              >
                取消
              </Link>
              <button
                onClick={handleRelocate}
                disabled={saving || !newStoreCode.trim() || !newStoreName.trim() || !relocationDate}
                className="px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
              >
                {saving ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    儲存中...
                  </>
                ) : (
                  <>
                    <CheckCircle size={16} />
                    確認搬遷
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 搬遷歷史記錄 */}
        <div className="mt-8 bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <History className="text-purple-600" size={20} />
            搬遷歷史記錄
            {history.length > 0 && (
              <span className="text-sm font-normal text-gray-400 ml-1">（{history.length} 筆）</span>
            )}
          </h2>

          {history.length === 0 ? (
            <p className="text-center text-gray-400 py-10 text-sm">尚無搬遷紀錄</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-600 text-left">
                    <th className="px-4 py-3 font-semibold whitespace-nowrap">搬遷日期</th>
                    <th className="px-4 py-3 font-semibold">門市代碼</th>
                    <th className="px-4 py-3 font-semibold">門市名稱</th>
                    <th className="px-4 py-3 font-semibold">簡稱</th>
                    <th className="px-4 py-3 font-semibold">負責人</th>
                    <th className="px-4 py-3 font-semibold">備註</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {history.map((rec) => (
                    <tr key={rec.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{rec.relocation_date}</td>
                      <td className="px-4 py-3">
                        <ChangeCell old={rec.old_store_code} next={rec.new_store_code} mono />
                      </td>
                      <td className="px-4 py-3">
                        <ChangeCell old={rec.old_store_name} next={rec.new_store_name} />
                      </td>
                      <td className="px-4 py-3">
                        <ChangeCell old={rec.old_short_name} next={rec.new_short_name} />
                      </td>
                      <td className="px-4 py-3">
                        <ChangeCell old={rec.old_manager_name} next={rec.new_manager_name} />
                      </td>
                      <td className="px-4 py-3 text-gray-400">{rec.note || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center gap-4">
      <span className="text-gray-500 shrink-0">{label}：</span>
      <span className="font-medium text-right">{children}</span>
    </div>
  );
}

function ChangeCell({
  old: oldVal,
  next: newVal,
  mono,
}: {
  old: string | null;
  next: string | null;
  mono?: boolean;
}) {
  const cls = mono ? 'font-mono' : '';
  if (oldVal === newVal) {
    return <span className={`text-gray-700 ${cls}`}>{oldVal || '-'}</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1 flex-wrap ${cls}`}>
      <span className="text-gray-400 line-through">{oldVal || '-'}</span>
      <ArrowRight size={11} className="text-orange-400 shrink-0" />
      <span className="text-orange-600 font-semibold">{newVal || '-'}</span>
    </span>
  );
}