'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Shield, Users, Store, Save, Search, X } from 'lucide-react';
import Link from 'next/link';

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  job_title: string | null;
  employee_code: string | null;
}

interface StoreData {
  id: number;
  store_code: string;
  store_name: string;
  is_active: boolean;
}

export default function SupervisorsManagementPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [supervisors, setSupervisors] = useState<Profile[]>([]);
  const [stores, setStores] = useState<StoreData[]>([]);
  const [assignments, setAssignments] = useState<Map<string, Set<number>>>(new Map());
  
  // 搜尋和選擇狀態
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSupervisor, setSelectedSupervisor] = useState<Profile | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      // 載入所有經理/督導
      const usersRes = await fetch('/api/supervisors/users');
      if (!usersRes.ok) throw new Error('Failed to load users');
      const usersData = await usersRes.json();
      setSupervisors(usersData.users || []);

      // 載入所有門市
      const storesRes = await fetch('/api/supervisors/stores');
      if (!storesRes.ok) throw new Error('Failed to load stores');
      const storesData = await storesRes.json();
      setStores(storesData.stores || []);

      // 載入現有分配
      const assignmentsRes = await fetch('/api/supervisors/assignments');
      if (!assignmentsRes.ok) throw new Error('Failed to load assignments');
      const assignmentsData = await assignmentsRes.json();

      // 建立 Map: user_id -> Set<store_id>
      const assignmentsMap = new Map<string, Set<number>>();
      const assignmentsList = assignmentsData.assignments || [];
      assignmentsList.forEach((assignment: { user_id: string; store_id: number }) => {
        if (!assignmentsMap.has(assignment.user_id)) {
          assignmentsMap.set(assignment.user_id, new Set());
        }
        assignmentsMap.get(assignment.user_id)!.add(assignment.store_id);
      });
      setAssignments(assignmentsMap);
    } catch (error) {
      console.error('Error loading data:', error);
      alert('載入資料失敗，請重新整理頁面');
    } finally {
      setLoading(false);
    }
  };

  const toggleStoreAssignment = (userId: string, storeId: number) => {
    setAssignments((prev) => {
      const newMap = new Map(prev);
      const userStores = newMap.get(userId) || new Set<number>();
      const newUserStores = new Set(userStores);

      if (newUserStores.has(storeId)) {
        newUserStores.delete(storeId);
      } else {
        newUserStores.add(storeId);
      }

      newMap.set(userId, newUserStores);
      return newMap;
    });
  };

  const handleSave = async () => {
    if (!selectedSupervisor) return;
    
    try {
      setSaving(true);
      const userStores = assignments.get(selectedSupervisor.id) || new Set();
      const storeIds = Array.from(userStores);

      const res = await fetch('/api/supervisors/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedSupervisor.id, storeIds }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save assignments');
      }

      alert('儲存成功！');
    } catch (error: any) {
      console.error('Error saving assignments:', error);
      alert(`儲存失敗: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  // 過濾符合搜尋條件的經理/督導
  const filteredSupervisors = supervisors.filter((supervisor) => {
    if (!searchTerm) return false;
    const term = searchTerm.toLowerCase();
    return (
      supervisor.full_name?.toLowerCase().includes(term) ||
      supervisor.email.toLowerCase().includes(term) ||
      supervisor.employee_code?.toLowerCase().includes(term)
    );
  });

  // 選擇人員
  const handleSelectSupervisor = (supervisor: Profile) => {
    setSelectedSupervisor(supervisor);
    setSearchTerm(supervisor.full_name || supervisor.email);
    setShowDropdown(false);
  };

  // 清除選擇
  const handleClearSelection = () => {
    setSelectedSupervisor(null);
    setSearchTerm('');
    setShowDropdown(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 lg:p-8 flex items-center justify-center">
        <div className="text-gray-600">載入中...</div>
      </div>
    );
  }

  const userStores = selectedSupervisor ? (assignments.get(selectedSupervisor.id) || new Set()) : new Set();

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2 flex items-center gap-3">
              <Shield className="w-10 h-10 text-blue-600" />
              經理/督導管理
            </h1>
            <p className="text-gray-600">為每位經理或督導分配可管理的門市</p>
          </div>
        </div>

        {/* Info Card */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-semibold mb-1">使用說明</p>
              <p>1. 在搜尋框輸入姓名、Email 或員編來搜尋經理/督導</p>
              <p>2. 選擇人員後，勾選該人員可管理的門市</p>
              <p>3. 點擊儲存按鈕完成設定</p>
            </div>
          </div>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm">經理/督導人數</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{supervisors.length}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm">門市總數</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">{stores.length}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <Store className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-600 text-sm">已分配管理者</p>
                <p className="text-3xl font-bold text-gray-900 mt-1">
                  {Array.from(assignments.values()).filter(s => s.size > 0).length}
                </p>
              </div>
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <Shield className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </div>
        </div>

        {/* Search Section */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">搜尋經理/督導</h2>
          
          {supervisors.length === 0 ? (
            <div className="text-center py-8">
              <Users className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">尚無經理或督導</h3>
              <p className="text-gray-600 mb-6">請先在使用者管理中將使用者設定為「主管」角色</p>
              <Link
                href="/admin/users"
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                前往使用者管理
              </Link>
            </div>
          ) : (
            <div className="relative">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  placeholder="輸入姓名、Email 或員編搜尋..."
                  className="w-full pl-10 pr-10 py-3 border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none text-lg"
                />
                {selectedSupervisor && (
                  <button
                    onClick={handleClearSelection}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-5 h-5" />
                  </button>
                )}
              </div>

              {/* Dropdown */}
              {showDropdown && searchTerm && !selectedSupervisor && filteredSupervisors.length > 0 && (
                <div className="absolute z-10 w-full mt-2 bg-white border-2 border-gray-200 rounded-lg shadow-lg max-h-96 overflow-y-auto">
                  {filteredSupervisors.map((supervisor) => (
                    <button
                      key={supervisor.id}
                      onClick={() => handleSelectSupervisor(supervisor)}
                      className="w-full px-4 py-3 text-left hover:bg-blue-50 border-b border-gray-100 last:border-b-0 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                          <span className="text-sm font-bold text-blue-600">
                            {supervisor.full_name?.[0]?.toUpperCase() || supervisor.email[0].toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1">
                          <div className="font-semibold text-gray-900">
                            {supervisor.full_name || supervisor.email}
                          </div>
                          <div className="text-sm text-gray-600">{supervisor.email}</div>
                          {supervisor.employee_code && (
                            <div className="text-sm text-blue-600">員編: {supervisor.employee_code}</div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {showDropdown && searchTerm && !selectedSupervisor && filteredSupervisors.length === 0 && (
                <div className="absolute z-10 w-full mt-2 bg-white border-2 border-gray-200 rounded-lg shadow-lg p-4 text-center text-gray-500">
                  查無符合的經理/督導
                </div>
              )}
            </div>
          )}
        </div>

        {/* Store Assignment Section */}
        {selectedSupervisor && (
          <div className="bg-white rounded-lg shadow-lg overflow-hidden">
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center">
                    <span className="text-xl font-bold text-blue-600">
                      {selectedSupervisor.full_name?.[0]?.toUpperCase() || selectedSupervisor.email[0].toUpperCase()}
                    </span>
                  </div>
                  <div className="text-white">
                    <h3 className="text-xl font-bold">{selectedSupervisor.full_name || selectedSupervisor.email}</h3>
                    <p className="text-blue-100 text-sm">{selectedSupervisor.email}</p>
                    {selectedSupervisor.job_title && (
                      <p className="text-blue-100 text-sm">{selectedSupervisor.job_title}</p>
                    )}
                    {selectedSupervisor.employee_code && (
                      <p className="text-blue-100 text-sm">員編: {selectedSupervisor.employee_code}</p>
                    )}
                  </div>
                </div>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-6 py-3 bg-white text-blue-600 rounded-lg hover:bg-blue-50 transition-colors font-semibold disabled:opacity-50 text-lg"
                >
                  <Save size={20} />
                  儲存
                </button>
              </div>
            </div>

            <div className="p-6">
              <div className="mb-4">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-lg font-semibold text-gray-700">
                    可管理門市 ({userStores.size}/{stores.length})
                  </h4>
                </div>

                {stores.length === 0 ? (
                  <p className="text-gray-500 text-sm">尚無門市資料</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {stores.map((store) => {
                      const isAssigned = userStores.has(store.id);

                      return (
                        <label
                          key={store.id}
                          className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                            isAssigned
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:border-gray-300 bg-white'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isAssigned}
                            onChange={() => toggleStoreAssignment(selectedSupervisor.id, store.id)}
                            className="w-5 h-5 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                          />
                          <div className="flex-1">
                            <div className="font-medium text-gray-900">{store.store_name}</div>
                            <div className="text-sm text-gray-500">{store.store_code}</div>
                          </div>
                          {isAssigned && (
                            <div className="text-blue-600">
                              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                            </div>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
