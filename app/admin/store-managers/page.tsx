'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Store, User, Search, Save, X, ChevronLeft, AlertCircle } from 'lucide-react';

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  employee_code: string | null;
  job_title: string | null;
}

interface StoreData {
  id: string;
  store_code: string;
  store_name: string;
}

interface StoreManagerAssignment {
  store_id: string;
  user_id: string;
  user_name: string;
  employee_code: string | null;
}

export default function StoreManagersPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  
  // 搜尋相關
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedManager, setSelectedManager] = useState<Profile | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [users, setUsers] = useState<Profile[]>([]);
  
  // 門市相關
  const [stores, setStores] = useState<StoreData[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  
  // 現有指派
  const [assignments, setAssignments] = useState<StoreManagerAssignment[]>([]);
  const [currentAssignment, setCurrentAssignment] = useState<string | null>(null); // 該店長目前管理的門市ID

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    // 當選擇店長後，查找其當前管理的門市
    if (selectedManager) {
      const existing = assignments.find(a => a.user_id === selectedManager.id);
      setCurrentAssignment(existing?.store_id || null);
      setSelectedStoreId(existing?.store_id || '');
    }
  }, [selectedManager, assignments]);

  const loadData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadUsers(),
        loadStores(),
        loadAssignments()
      ]);
    } catch (error) {
      console.error('Error loading data:', error);
      alert('載入資料失敗');
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    try {
      const response = await fetch('/api/store-managers/users');
      const data = await response.json();
      
      if (data.success) {
        setUsers(data.users || []);
      } else {
        console.error('Failed to load users:', data.error);
      }
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  const loadStores = async () => {
    try {
      const response = await fetch('/api/store-managers/stores');
      const data = await response.json();
      
      if (data.success) {
        setStores(data.stores || []);
      } else {
        console.error('Failed to load stores:', data.error);
      }
    } catch (error) {
      console.error('Error loading stores:', error);
    }
  };

  const loadAssignments = async () => {
    try {
      const response = await fetch('/api/store-managers/assignments');
      const data = await response.json();
      
      if (data.success) {
        setAssignments(data.assignments || []);
      } else {
        console.error('Failed to load assignments:', data.error);
      }
    } catch (error) {
      console.error('Error loading assignments:', error);
    }
  };

  const handleSearch = (value: string) => {
    setSearchTerm(value);
    setShowDropdown(value.length > 0);
  };

  const handleSelectManager = (user: Profile) => {
    setSelectedManager(user);
    setSearchTerm(user.full_name || user.email);
    setShowDropdown(false);
  };

  const handleClearSelection = () => {
    setSelectedManager(null);
    setSearchTerm('');
    setSelectedStoreId('');
    setCurrentAssignment(null);
  };

  const handleSave = async () => {
    if (!selectedManager) {
      alert('請選擇店長');
      return;
    }

    if (!selectedStoreId) {
      alert('請選擇門市');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/store-managers/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedManager.id,
          storeId: selectedStoreId
        })
      });

      const data = await response.json();

      if (data.success) {
        alert('店長指派成功！');
        await loadAssignments();
        handleClearSelection();
      } else {
        alert(`指派失敗：${data.error}`);
      }
    } catch (error) {
      console.error('Error saving assignment:', error);
      alert('儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAssignment = async (userId: string) => {
    if (!confirm('確定要移除此店長的指派嗎？')) {
      return;
    }

    try {
      const response = await fetch('/api/store-managers/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          storeId: null // null 表示移除指派
        })
      });

      const data = await response.json();

      if (data.success) {
        alert('移除成功！');
        await loadAssignments();
      } else {
        alert(`移除失敗：${data.error}`);
      }
    } catch (error) {
      console.error('Error removing assignment:', error);
      alert('移除失敗');
    }
  };

  const filteredUsers = users.filter(user => {
    if (!searchTerm) return false;
    const search = searchTerm.toLowerCase();
    return (
      user.full_name?.toLowerCase().includes(search) ||
      user.email.toLowerCase().includes(search) ||
      user.employee_code?.toLowerCase().includes(search)
    );
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-gray-600">載入中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">店長指派管理</h1>
            <p className="text-gray-600">指派店長到各個門市</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 左側：指派表單 */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-6">新增/編輯店長指派</h2>

            {/* 搜尋店長 */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                <User size={16} className="inline mr-2" />
                搜尋店長
              </label>
              <div className="relative">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => handleSearch(e.target.value)}
                    onFocus={() => setShowDropdown(searchTerm.length > 0)}
                    placeholder="輸入姓名、Email 或員工代號"
                    className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {selectedManager && (
                    <button
                      onClick={handleClearSelection}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X size={20} />
                    </button>
                  )}
                </div>

                {/* 搜尋下拉選單 */}
                {showDropdown && filteredUsers.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {filteredUsers.map((user) => (
                      <button
                        key={user.id}
                        onClick={() => handleSelectManager(user)}
                        className="w-full px-4 py-3 text-left hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-0"
                      >
                        <div className="font-medium text-gray-900">
                          {user.full_name || user.email}
                        </div>
                        <div className="text-sm text-gray-500 flex items-center gap-2">
                          <span>{user.employee_code || '無員編'}</span>
                          <span>·</span>
                          <span>{user.job_title || '無職稱'}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 選擇門市 */}
            {selectedManager && (
              <>
                <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center gap-2 text-blue-800 mb-1">
                    <User size={16} />
                    <span className="font-semibold">已選擇店長</span>
                  </div>
                  <div className="text-sm text-blue-700">
                    <div>{selectedManager.full_name || selectedManager.email}</div>
                    <div className="text-blue-600">
                      {selectedManager.employee_code || '無員編'} · {selectedManager.job_title || '無職稱'}
                    </div>
                  </div>
                  {currentAssignment && (
                    <div className="mt-2 pt-2 border-t border-blue-300">
                      <div className="text-xs text-blue-600">
                        目前管理：{stores.find(s => s.id === currentAssignment)?.store_name || '未知門市'}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <Store size={16} className="inline mr-2" />
                    指派門市
                  </label>
                  <select
                    value={selectedStoreId}
                    onChange={(e) => setSelectedStoreId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">-- 請選擇門市 --</option>
                    {stores.map((store) => {
                      const hasManager = assignments.find(a => a.store_id === store.id);
                      return (
                        <option key={store.id} value={store.id}>
                          {store.store_code} - {store.store_name}
                          {hasManager && hasManager.user_id !== selectedManager.id ? ` (已有店長: ${hasManager.user_name})` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {currentAssignment && currentAssignment !== selectedStoreId && selectedStoreId && (
                  <div className="mb-6 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-2">
                    <AlertCircle size={16} className="text-yellow-600 mt-0.5" />
                    <div className="text-sm text-yellow-800">
                      注意：此操作會將店長從原門市移除，並指派到新門市。
                    </div>
                  </div>
                )}

                <button
                  onClick={handleSave}
                  disabled={saving || !selectedStoreId}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  <Save size={20} />
                  {saving ? '儲存中...' : currentAssignment === selectedStoreId ? '更新指派' : '儲存指派'}
                </button>
              </>
            )}
          </div>

          {/* 右側：現有指派列表 */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-6">
              現有店長指派 ({assignments.length})
            </h2>

            {assignments.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Store size={48} className="mx-auto mb-4 text-gray-300" />
                <p>尚無店長指派</p>
              </div>
            ) : (
              <div className="space-y-3">
                {assignments.map((assignment) => {
                  const store = stores.find(s => s.id === assignment.store_id);
                  return (
                    <div
                      key={assignment.user_id}
                      className="p-4 border border-gray-200 rounded-lg hover:border-blue-300 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-semibold text-gray-900">
                            {store?.store_code} - {store?.store_name}
                          </div>
                          <div className="text-sm text-gray-600 mt-1">
                            店長：{assignment.user_name}
                            {assignment.employee_code && ` (${assignment.employee_code})`}
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveAssignment(assignment.user_id)}
                          className="ml-4 p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="移除指派"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
