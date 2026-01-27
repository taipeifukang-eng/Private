'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Save, Store, MapPin, Phone, Hash, Tag, Building2, Loader2, User } from 'lucide-react';

export default function EditStorePage() {
  const router = useRouter();
  const params = useParams();
  const storeId = params.id as string;
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  const [storeCode, setStoreCode] = useState('');
  const [storeName, setStoreName] = useState('');
  const [shortName, setShortName] = useState('');
  const [hrStoreCode, setHrStoreCode] = useState('');
  const [managerName, setManagerName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    loadStore();
  }, [storeId]);

  const loadStore = async () => {
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      
      const { data, error } = await supabase
        .from('stores')
        .select('*')
        .eq('id', storeId)
        .single();

      if (error || !data) {
        alert('找不到該門市');
        router.push('/admin/stores');
        return;
      }

      setStoreCode(data.store_code || '');
      setStoreName(data.store_name || '');
      setShortName(data.short_name || '');
      setHrStoreCode(data.hr_store_code || '');
      setManagerName(data.manager_name || '');
      setAddress(data.address || '');
      setPhone(data.phone || '');
      setIsActive(data.is_active ?? true);
    } catch (error) {
      console.error('Error loading store:', error);
      alert('載入失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!storeName.trim()) {
      alert('請填寫門市名稱');
      return;
    }

    setSaving(true);
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      
      const { error } = await supabase
        .from('stores')
        .update({
          store_name: storeName.trim(),
          short_name: shortName.trim() || null,
          hr_store_code: hrStoreCode.trim() || null,
          manager_name: managerName.trim() || null,
          address: address.trim() || null,
          phone: phone.trim() || null,
          is_active: isActive,
          updated_at: new Date().toISOString()
        })
        .eq('id', storeId);

      if (error) {
        console.error('Error updating store:', error);
        alert(`❌ 更新失敗: ${error.message}`);
        return;
      }

      alert('✅ 門市更新成功');
      router.push('/admin/stores');
    } catch (error) {
      console.error('Error:', error);
      alert('更新失敗');
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

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full max-w-4xl">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <Link
            href="/admin/stores"
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <ChevronLeft size={24} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Store className="text-blue-600" />
              編輯門市
            </h1>
            <p className="text-gray-600">修改門市資料</p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6 space-y-6">
          {/* 門市代碼 (唯讀) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Hash size={16} className="inline mr-1" />
              門市代碼
            </label>
            <input
              type="text"
              value={storeCode}
              disabled
              className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed"
            />
            <p className="text-sm text-gray-500 mt-1">
              門市代碼建立後無法修改
            </p>
          </div>

          {/* 門市名稱 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Store size={16} className="inline mr-1" />
              門市名稱 *
            </label>
            <input
              type="text"
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="例如: 富康藥局 中正店"
            />
          </div>

          {/* 簡稱 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Tag size={16} className="inline mr-1" />
              簡稱
            </label>
            <input
              type="text"
              value={shortName}
              onChange={(e) => setShortName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="例如: 中正店（選填）"
            />
            <p className="text-sm text-gray-500 mt-1">
              用於簡化顯示的名稱
            </p>
          </div>

          {/* 人資系統門市代碼 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Building2 size={16} className="inline mr-1" />
              人資系統門市代碼
            </label>
            <input
              type="text"
              value={hrStoreCode}
              onChange={(e) => setHrStoreCode(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="人資系統中的門市代碼（選填）"
            />
            <p className="text-sm text-gray-500 mt-1">
              對應人資系統的門市識別碼，用於資料匯出對接
            </p>
          </div>

          {/* 負責人 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <User size={16} className="inline mr-1" />
              負責人
            </label>
            <input
              type="text"
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="門市負責人姓名（選填）"
            />
            <p className="text-sm text-gray-500 mt-1">
              門市主要負責人（店長）
            </p>
          </div>

          {/* 地址 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <MapPin size={16} className="inline mr-1" />
              地址
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="門市地址（選填）"
            />
          </div>

          {/* 電話 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Phone size={16} className="inline mr-1" />
              電話
            </label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="門市電話（選填）"
            />
          </div>

          {/* 營運狀態 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              營運狀態
            </label>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="isActive"
                  checked={isActive}
                  onChange={() => setIsActive(true)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">營運中</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="isActive"
                  checked={!isActive}
                  onChange={() => setIsActive(false)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-sm text-gray-700">已停止</span>
              </label>
            </div>
          </div>

          {/* 操作按鈕 */}
          <div className="flex justify-end gap-4 pt-4 border-t">
            <Link
              href="/admin/stores"
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              取消
            </Link>
            <button
              onClick={handleSave}
              disabled={saving || !storeName.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={18} />
              {saving ? '儲存中...' : '儲存變更'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
