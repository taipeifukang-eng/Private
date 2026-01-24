'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Save, Store, MapPin, Phone, Hash } from 'lucide-react';

export default function CreateStorePage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  
  const [storeCode, setStoreCode] = useState('');
  const [storeName, setStoreName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');

  const handleSave = async () => {
    if (!storeCode.trim() || !storeName.trim()) {
      alert('請填寫門市代碼和名稱');
      return;
    }

    setSaving(true);
    try {
      const { createStore } = await import('@/app/store/actions');
      const result = await createStore({
        store_code: storeCode.trim(),
        store_name: storeName.trim(),
        address: address.trim() || undefined,
        phone: phone.trim() || undefined
      });

      if (result.success) {
        alert('✅ 門市建立成功');
        router.push('/admin/stores');
      } else {
        alert(`❌ 建立失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('Error:', error);
      alert('建立失敗');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
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
              新增門市
            </h1>
            <p className="text-gray-600">建立新的門市資料</p>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-lg p-6 space-y-6">
          {/* 門市代碼 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Hash size={16} className="inline mr-1" />
              門市代碼 *
            </label>
            <input
              type="text"
              value={storeCode}
              onChange={(e) => setStoreCode(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="例如: F001"
            />
            <p className="text-sm text-gray-500 mt-1">
              唯一識別碼，建立後無法修改
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
              disabled={saving || !storeCode.trim() || !storeName.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={18} />
              {saving ? '建立中...' : '建立門市'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
