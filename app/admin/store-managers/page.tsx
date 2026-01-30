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
  store_ids?: string[]; // 一個店長管理的所有門市ID列表
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
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([]); // 改為複數，支援多選
  
  // 現有指派
  const [assignments, setAssignments] = useState<StoreManagerAssignment[]>([]);
  const [currentAssignments, setCurrentAssignments] = useState<string[]>([]); // 該店長目前管理的門市ID列表

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    // 當選擇店長後，查找其當前管理的所有門市
    if (selectedManager) {
      const managerStores = assignments
        .filter(a => a.user_id === selectedManager.id)
        .map(a => a.store_id);
      setCurrentAssignments(managerStores);
      setSelectedStoreIds(managerStores);
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
    setSelectedStoreIds([]);
    setCurrentAssignments([]);
  };

  const handleSave = async () => {
    if (!selectedManager) {
      alert('請選擇店長');
      return;
    }

    if (selectedStoreIds.length === 0) {
      alert('請至少選擇一個門市');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/store-managers/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedManager.id,
          storeIds: selectedStoreIds // 傳送門市ID陣列
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

  const handleRemoveAssignment = async (userId: string, storeId?: string) => {
    // 如果指定 storeId，只移除該門市；否則移除所有門市
    const confirmMsg = storeId 
      ? '確定要移除此店長對該門市的指派嗎？'
      : '確定要移除此店長的所有指派嗎？';
    
    if (!confirm(confirmMsg)) {
      return;
    }

    try {
      const response = await fetch('/api/store-managers/assign', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          storeId: storeId || null // null 表示移除所有指派
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

  const handleToggleStore = (storeId: string) => {
    setSelectedStoreIds(prev => {
      if (prev.includes(storeId)) {
        // 如果已選擇，則移除
        return prev.filter(id => id !== storeId);
      } else {
        // 如果未選擇，則新增
        return [...prev, storeId];
      }
    });
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
                  {currentAssignments.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-blue-300">
                      <div className="text-xs text-blue-600 font-medium mb-1">
                        目前管理 {currentAssignments.length} 間門市：
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {currentAssignments.map(storeId => {
                          const store = stores.find(s => s.id === storeId);
                          return store ? (
                            <span key={storeId} className="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                              {store.store_code}
                            </span>
                          ) : null;
                        })}
                      </div>
                    </div>
                  )}
                </div>

                <div className="mb-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    <Store size={16} className="inline mr-2" />
                    指派門市 (可複選)
                  </label>
                  <div className="border border-gray-300 rounded-lg max-h-60 overflow-y-auto">
                    {stores.map((store) => {
                      const isSelected = selectedStoreIds.includes(store.id);
                      const otherManager = assignments.find(
                        a => a.store_id === store.id && a.user_id !== selectedManager.id
                      );
                      
                      return (
                        <label
                          key={store.id}
                          className={`flex items-center px-3 py-2 border-b border-gray-200 last:border-0 cursor-pointer hover:bg-gray-50 transition-colors ${
                            isSelected ? 'bg-blue-50' : ''
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleStore(store.id)}
                            className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <div className="ml-3 flex-1">
                            <div className="text-sm font-medium text-gray-900">
                              {store.store_code} - {store.store_name}
                            </div>
                            {otherManager && (
                              <div className="text-xs text-amber-600">
                                已有店長: {otherManager.user_name}
                              </div>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {selectedStoreIds.length > 0 && (
                    <div className="mt-2 text-sm text-gray-600">
                      已選擇 {selectedStoreIds.length} 間門市
                    </div>
                  )}
                </div>

                {currentAssignments.length > 0 && 
                 JSON.stringify([...currentAssignments].sort()) !== JSON.stringify([...selectedStoreIds].sort()) && (
                  <div className="mb-6 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-2">
                    <AlertCircle size={16} className="text-yellow-600 mt-0.5" />
                    <div className="text-sm text-yellow-800">
                      注意：此操作會更新店長的門市指派關係。
                    </div>
                  </div>
                )}

                <button
                  onClick={handleSave}
                  disabled={saving || selectedStoreIds.length === 0}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                >
                  <Save size={20} />
                  {saving ? '儲存中...' : '儲存指派'}
                </button>
              </>
            )}
          </div>

          {/* 右側：現有指派列表 */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-6">
              現有店長指派
            </h2>

            {assignments.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Store size={48} className="mx-auto mb-4 text-gray-300" />
                <p>尚無店長指派</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* 按店長分組顯示 */}
                {(() => {
                  // 將 assignments 按 user_id 分組
                  const groupedByUser = assignments.reduce((acc, assignment) => {
                    if (!acc[assignment.user_id]) {
                      acc[assignment.user_id] = {
                        userId: assignment.user_id,
                        userName: assignment.user_name,
                        employeeCode: assignment.employee_code,
                        storeIds: []
                      };
                    }
                    acc[assignment.user_id].storeIds.push(assignment.store_id);
                    return acc;
                  }, {} as Record<string, { userId: string; userName: string; employeeCode: string | null; storeIds: string[] }>);

                  return Object.values(groupedByUser)
                    .sort((a, b) => a.userName.localeCompare(b.userName))
                    .map((group) => (
                      <div
                        key={group.userId}
                        className="p-4 border border-gray-200 rounded-lg hover:border-blue-300 transition-colors"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="font-semibold text-gray-900">
                              {group.userName}
                              {group.employeeCode && ` (${group.employeeCode})`}
                            </div>
                            <div className="text-sm text-gray-500 mt-1">
                              管理 {group.storeIds.length} 間門市
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveAssignment(group.userId)}
                            className="ml-4 p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="移除所有指派"
                          >
                            <X size={18} />
                          </button>
                        </div>
                        
                        {/* 門市列表 */}
                        <div className="space-y-2">
                          {group.storeIds
                            .map(storeId => stores.find(s => s.id === storeId))
                            .filter(Boolean)
                            .sort((a, b) => a!.store_code.localeCompare(b!.store_code))
                            .map((store) => (
                              <div
                                key={store!.id}
                                className="flex items-center justify-between p-2 bg-gray-50 rounded text-sm"
                              >
                                <div className="flex items-center gap-2">
                                  <Store size={14} className="text-gray-400" />
                                  <span className="text-gray-700">
                                    {store!.store_code} - {store!.store_name}
                                  </span>
                                </div>
                                <button
                                  onClick={() => handleRemoveAssignment(group.userId, store!.id)}
                                  className="p-1 text-red-500 hover:bg-red-50 rounded transition-colors"
                                  title="移除此門市"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ))}
                        </div>
                      </div>
                    ));
                })()}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
