'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, Copy, Store, Hash, User, MapPin, Phone, Tag, Building2, Loader2, AlertTriangle, CheckCircle, Users } from 'lucide-react';
import { cloneStore } from '@/app/store/actions';

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

interface Manager {
  id: string;
  user_id: string;
  role_type: string;
  user: {
    id: string;
    email: string;
    full_name: string | null;
  };
}

interface Employee {
  id: string;
  employee_name: string;
  job_title: string | null;
  is_active: boolean;
}

export default function CloneStorePage() {
  const router = useRouter();
  const params = useParams();
  const sourceStoreId = params.id as string;
  
  const [loading, setLoading] = useState(true);
  const [cloning, setCloning] = useState(false);
  
  // 來源門市資料
  const [sourceStore, setSourceStore] = useState<StoreData | null>(null);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  
  // 新門市資料
  const [newStoreCode, setNewStoreCode] = useState('');
  const [newStoreName, setNewStoreName] = useState('');
  const [newShortName, setNewShortName] = useState('');
  const [newHrStoreCode, setNewHrStoreCode] = useState('');
  const [newManagerName, setNewManagerName] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newPhone, setNewPhone] = useState('');
  
  // 複製選項
  const [copyManagers, setCopyManagers] = useState(true);
  const [copyEmployees, setCopyEmployees] = useState(true);
  const [deactivateSource, setDeactivateSource] = useState(true);

  useEffect(() => {
    loadSourceStore();
  }, [sourceStoreId]);

  const loadSourceStore = async () => {
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      
      // 載入門市資料
      const { data: store, error } = await supabase
        .from('stores')
        .select('*')
        .eq('id', sourceStoreId)
        .single();

      if (error || !store) {
        alert('找不到該門市');
        router.push('/admin/stores');
        return;
      }

      setSourceStore(store);
      
      // 預設新門市資料
      setNewStoreName(store.store_name);
      setNewShortName(store.short_name || '');
      setNewAddress(store.address || '');
      setNewPhone(store.phone || '');
      setNewManagerName(''); // 負責人通常會換新的
      
      // 載入門市管理者
      const { data: managerData } = await supabase
        .from('store_managers')
        .select(`
          id,
          user_id,
          role_type,
          user:profiles(id, email, full_name)
        `)
        .eq('store_id', sourceStoreId);
      
      if (managerData) {
        setManagers(managerData.map(m => ({
          ...m,
          user: m.user as any
        })));
      }
      
      // 載入門市員工
      const { data: employeeData } = await supabase
        .from('store_employees')
        .select(`
          id,
          position,
          is_active,
          user:profiles(id, full_name)
        `)
        .eq('store_id', sourceStoreId)
        .eq('is_active', true);
      
      if (employeeData) {
        setEmployees(employeeData.map(e => ({
          id: e.id,
          employee_name: (e.user as any)?.full_name || '未命名',
          job_title: e.position,
          is_active: e.is_active
        })));
      }
      
    } catch (error) {
      console.error('Error loading store:', error);
      alert('載入失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleClone = async () => {
    if (!newStoreCode.trim()) {
      alert('請填寫新門市代碼');
      return;
    }
    if (!newStoreName.trim()) {
      alert('請填寫新門市名稱');
      return;
    }

    // 確認操作
    const confirmMsg = deactivateSource 
      ? `確定要將 "${sourceStore?.store_name}" 搬遷到新門市 "${newStoreName}" 嗎？\n\n原門市將被設為停止營運狀態。`
      : `確定要複製 "${sourceStore?.store_name}" 到新門市 "${newStoreName}" 嗎？`;
    
    if (!confirm(confirmMsg)) {
      return;
    }

    setCloning(true);
    try {
      const result = await cloneStore({
        source_store_id: sourceStoreId,
        new_store_code: newStoreCode.trim(),
        new_store_name: newStoreName.trim(),
        new_short_name: newShortName.trim() || undefined,
        new_hr_store_code: newHrStoreCode.trim() || undefined,
        new_manager_name: newManagerName.trim() || undefined,
        new_address: newAddress.trim() || undefined,
        new_phone: newPhone.trim() || undefined,
        copy_managers: copyManagers,
        copy_employees: copyEmployees,
        deactivate_source: deactivateSource
      });

      if (result.error) {
        alert(`❌ 搬遷失敗: ${result.error}`);
        return;
      }

      const successMsg = deactivateSource
        ? `✅ 門市搬遷成功！\n\n新門市: ${newStoreName}\n${copyManagers ? `已搬遷 ${result.copiedManagers} 位管理者\n` : ''}${copyEmployees ? `已搬遷 ${result.copiedEmployees} 位員工\n` : ''}原門市已設為停止營運`
        : `✅ 門市複製成功！\n\n新門市: ${newStoreName}\n${copyManagers ? `已複製 ${result.copiedManagers} 位管理者\n` : ''}${copyEmployees ? `已複製 ${result.copiedEmployees} 位員工` : ''}`;

      alert(successMsg);
      router.push('/admin/stores');
    } catch (error) {
      console.error('Error cloning store:', error);
      alert('操作失敗');
    } finally {
      setCloning(false);
    }
  };

  const getRoleLabel = (roleType: string): string => {
    const labels: Record<string, string> = {
      'store_manager': '店長',
      'supervisor': '督導',
      'area_manager': '區經理'
    };
    return labels[roleType] || roleType;
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

  if (!sourceStore) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full max-w-6xl">
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
              <Copy className="text-orange-500" />
              搬遷 / 複製門市
            </h1>
            <p className="text-gray-600">將現有門市資料複製到新門市代碼</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 來源門市資訊 */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Store className="text-blue-600" size={20} />
              來源門市資訊
            </h2>
            
            <div className="space-y-4 bg-gray-50 rounded-lg p-4">
              <div className="flex justify-between">
                <span className="text-gray-600">門市代碼:</span>
                <span className="font-mono font-semibold text-blue-600">{sourceStore.store_code}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">門市名稱:</span>
                <span className="font-semibold">{sourceStore.store_name}</span>
              </div>
              {sourceStore.short_name && (
                <div className="flex justify-between">
                  <span className="text-gray-600">簡稱:</span>
                  <span>{sourceStore.short_name}</span>
                </div>
              )}
              {sourceStore.manager_name && (
                <div className="flex justify-between">
                  <span className="text-gray-600">負責人:</span>
                  <span>{sourceStore.manager_name}</span>
                </div>
              )}
              {sourceStore.address && (
                <div className="flex justify-between">
                  <span className="text-gray-600">地址:</span>
                  <span className="text-sm">{sourceStore.address}</span>
                </div>
              )}
            </div>

            {/* 管理者列表 */}
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <User size={16} className="text-purple-600" />
                管理者 ({managers.length})
              </h3>
              {managers.length > 0 ? (
                <div className="space-y-2">
                  {managers.map(m => (
                    <div key={m.id} className="flex items-center justify-between bg-purple-50 rounded-lg p-3">
                      <span className="font-medium">{m.user?.full_name || m.user?.email}</span>
                      <span className="text-xs bg-purple-200 text-purple-800 px-2 py-1 rounded">
                        {getRoleLabel(m.role_type)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">尚無管理者</p>
              )}
            </div>

            {/* 員工列表 */}
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Users size={16} className="text-green-600" />
                員工 ({employees.length})
              </h3>
              {employees.length > 0 ? (
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {employees.map(e => (
                    <div key={e.id} className="flex items-center justify-between bg-green-50 rounded-lg p-2">
                      <span className="text-sm font-medium">{e.employee_name}</span>
                      {e.job_title && (
                        <span className="text-xs bg-green-200 text-green-800 px-2 py-0.5 rounded">
                          {e.job_title}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">尚無員工</p>
              )}
            </div>
          </div>

          {/* 新門市設定 */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Store className="text-orange-500" size={20} />
              新門市設定
            </h2>
            
            <div className="space-y-4">
              {/* 新門市代碼 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Hash size={14} className="inline mr-1" />
                  新門市代碼 *
                </label>
                <input
                  type="text"
                  value={newStoreCode}
                  onChange={(e) => setNewStoreCode(e.target.value.toUpperCase())}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent uppercase"
                  placeholder="新的門市代碼（必填）"
                />
                <p className="text-xs text-gray-500 mt-1">
                  例如：原代碼 A001 換負責人後改為 B001
                </p>
              </div>

              {/* 新門市名稱 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Store size={14} className="inline mr-1" />
                  新門市名稱 *
                </label>
                <input
                  type="text"
                  value={newStoreName}
                  onChange={(e) => setNewStoreName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  placeholder="新的門市名稱"
                />
              </div>

              {/* 簡稱 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Tag size={14} className="inline mr-1" />
                  簡稱
                </label>
                <input
                  type="text"
                  value={newShortName}
                  onChange={(e) => setNewShortName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  placeholder="門市簡稱（選填）"
                />
              </div>

              {/* 人資系統門市代碼 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Building2 size={14} className="inline mr-1" />
                  人資系統門市代碼
                </label>
                <input
                  type="text"
                  value={newHrStoreCode}
                  onChange={(e) => setNewHrStoreCode(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  placeholder="人資系統中的門市代碼（選填）"
                />
              </div>

              {/* 新負責人 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <User size={14} className="inline mr-1" />
                  新負責人
                </label>
                <input
                  type="text"
                  value={newManagerName}
                  onChange={(e) => setNewManagerName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  placeholder="新門市負責人姓名（選填）"
                />
                <p className="text-xs text-gray-500 mt-1">
                  門市換負責人時，請填入新負責人姓名
                </p>
              </div>

              {/* 地址 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <MapPin size={14} className="inline mr-1" />
                  地址
                </label>
                <input
                  type="text"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  placeholder="門市地址（選填）"
                />
              </div>

              {/* 電話 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Phone size={14} className="inline mr-1" />
                  電話
                </label>
                <input
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                  placeholder="門市電話（選填）"
                />
              </div>
            </div>

            {/* 複製選項 */}
            <div className="mt-6 pt-6 border-t">
              <h3 className="text-sm font-semibold text-gray-700 mb-4">搬遷選項</h3>
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={copyManagers}
                    onChange={(e) => setCopyManagers(e.target.checked)}
                    className="w-4 h-4 text-orange-600 rounded"
                  />
                  <span className="text-sm text-gray-700">
                    複製管理者（督導/區經理）
                    <span className="text-gray-500 ml-1">({managers.length}人)</span>
                  </span>
                </label>
                
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={copyEmployees}
                    onChange={(e) => setCopyEmployees(e.target.checked)}
                    className="w-4 h-4 text-orange-600 rounded"
                  />
                  <span className="text-sm text-gray-700">
                    複製員工名單
                    <span className="text-gray-500 ml-1">({employees.length}人)</span>
                  </span>
                </label>
                
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={deactivateSource}
                    onChange={(e) => setDeactivateSource(e.target.checked)}
                    className="w-4 h-4 text-orange-600 rounded"
                  />
                  <span className="text-sm text-gray-700">
                    將原門市設為停止營運
                    <span className="text-xs text-orange-600 ml-1">（建議勾選）</span>
                  </span>
                </label>
              </div>
            </div>

            {/* 警告提示 */}
            {deactivateSource && (
              <div className="mt-4 bg-orange-50 border border-orange-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="text-orange-500 flex-shrink-0 mt-0.5" size={20} />
                  <div className="text-sm">
                    <p className="font-semibold text-orange-800 mb-1">搬遷模式</p>
                    <p className="text-orange-700">
                      執行後，原門市「{sourceStore.store_name}」將被設為停止營運狀態，
                      所有管理關係和員工將移至新門市。
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* 操作按鈕 */}
            <div className="flex justify-end gap-4 mt-6 pt-4 border-t">
              <Link
                href="/admin/stores"
                className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
              >
                取消
              </Link>
              <button
                onClick={handleClone}
                disabled={cloning || !newStoreCode.trim() || !newStoreName.trim()}
                className="px-6 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {cloning ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    處理中...
                  </>
                ) : (
                  <>
                    <CheckCircle size={18} />
                    {deactivateSource ? '確認搬遷' : '確認複製'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 說明區塊 */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="font-semibold text-blue-900 mb-3">💡 使用說明</h3>
          <div className="text-sm text-blue-800 space-y-2">
            <p>
              <strong>搬遷模式（建議）：</strong>當門市換負責人時，門市代碼需要更換，但督導、區經理和員工不變。
              勾選「將原門市設為停止營運」後，系統會自動將所有關聯人員移至新門市。
            </p>
            <p>
              <strong>複製模式：</strong>如果需要保留原門市的資料，可以取消勾選「將原門市設為停止營運」，
              系統會複製一份相同的資料到新門市，但原門市仍維持營運。
            </p>
            <p className="text-blue-600">
              <strong>注意：</strong>原門市的任務派發記錄不會受影響，歷史紀錄會保留在原門市代碼下。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
