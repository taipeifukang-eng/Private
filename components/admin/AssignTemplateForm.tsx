'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { UserPlus, ArrowLeft, Search } from 'lucide-react';
import Link from 'next/link';

interface User {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  job_title: string | null;
}

interface AssignTemplateFormProps {
  templateId: string;
  templateTitle: string;
}

export default function AssignTemplateForm({ templateId, templateTitle }: AssignTemplateFormProps) {
  const router = useRouter();
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [plannedStartDate, setPlannedStartDate] = useState('');
  const [plannedEndDate, setPlannedEndDate] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Load users and existing collaborators on component mount
  useEffect(() => {
    loadUsersAndCollaborators();
  }, [templateId]);

  const loadUsersAndCollaborators = async () => {
    try {
      // Load all users
      const { getAllUsers } = await import('@/app/auth/actions');
      const result = await getAllUsers();
      
      if (result.success && result.data) {
        setUsers(result.data);
      }

      // Load existing collaborators for this template
      const { getExistingCollaborators } = await import('@/app/actions');
      const collaborators = await getExistingCollaborators(templateId);
      
      if (collaborators.success && collaborators.data) {
        const existingUserIds = collaborators.data.collaborators
          .map((c: any) => c.user_id)
          .filter((id: string) => id);  // Remove null/undefined
        setSelectedUserIds(existingUserIds);
        setPlannedStartDate(collaborators.data.planned_start_date || '');
        setPlannedEndDate(collaborators.data.planned_end_date || '');
        console.log('[AssignTemplateForm] Loaded existing collaborators:', existingUserIds);
      }
    } catch (error) {
      console.error('Error loading users and collaborators:', error);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const filteredUsers = users.filter(user => 
    user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (user.full_name && user.full_name.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (user.job_title && user.job_title.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    console.log('[AssignTemplateForm] ===== SUBMIT START =====');
    console.log('[AssignTemplateForm] Template ID:', templateId);
    console.log('[AssignTemplateForm] Selected User IDs (before call):', selectedUserIds);
    console.log('[AssignTemplateForm] Number of selected users:', selectedUserIds.length);
    console.log('[AssignTemplateForm] Selected IDs array:', JSON.stringify(selectedUserIds));

    if (plannedStartDate && plannedEndDate && plannedStartDate > plannedEndDate) {
      alert('❌ 預計起始日不可晚於預計完成日');
      return;
    }
    
    // If no users selected, assignment will be automatically assigned to creator
    // The createAssignment function will add the creator automatically
    
    setIsLoading(true);

    try {
      const { createAssignment } = await import('@/app/actions');
      
      console.log('[AssignTemplateForm] Calling createAssignment...');
      console.log('[AssignTemplateForm] Passing assigned_to:', selectedUserIds);
      
      // If no users selected, pass empty array - creator will be added automatically
      const result = await createAssignment({
        template_id: templateId,
        assigned_to: selectedUserIds,
        planned_start_date: plannedStartDate || null,
        planned_end_date: plannedEndDate || null,
      });

      console.log('[AssignTemplateForm] Result:', result);
      console.log('[AssignTemplateForm] Result success:', result.success);

      if (result.success) {
        const userCount = selectedUserIds.length;
        if (userCount === 0) {
          console.log('[AssignTemplateForm] ✅ Task assigned to creator only');
          alert(`✅ 任務建立成功！已指派給您自己`);
        } else {
          console.log('[AssignTemplateForm] ✅ Task assigned to', userCount, 'users');
          alert(`✅ 任務指派成功！已指派給 ${userCount} 位使用者`);
        }
        console.log('[AssignTemplateForm] Redirecting to dashboard...');
        router.push('/dashboard');
      } else {
        console.error('[AssignTemplateForm] ❌ Assignment failed:', result.error);
        alert(`❌ 指派失敗：${result.error}`);
      }
    } catch (error) {
      console.error('[AssignTemplateForm] ❌ Exception occurred:', error);
      alert('❌ 發生錯誤，請稍後再試');
    } finally {
      setIsLoading(false);
      console.log('[AssignTemplateForm] ===== SUBMIT END =====');
    }
  };

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds(prev => {
      if (prev.includes(userId)) {
        return prev.filter(id => id !== userId);
      } else {
        return [...prev, userId];
      }
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="w-full max-w-4xl">
        <Link
          href="/admin/templates"
          className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 mb-6"
        >
          <ArrowLeft size={20} />
          返回流程列表
        </Link>

        <div className="bg-white rounded-lg shadow-lg p-8">
          <div className="flex items-center gap-3 mb-6">
            <UserPlus className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">指派任務</h1>
          </div>

          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-semibold text-gray-900 mb-1">流程名稱</h3>
            <p className="text-gray-700">{templateTitle}</p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                任務預計時程（選填）
              </label>
              <p className="text-sm text-gray-500 mb-3">
                若此任務可預先規劃時程，請設定起始日與完成日，甘特圖會依此區間顯示每週時間軸。
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">預計起始日</label>
                  <input
                    type="date"
                    value={plannedStartDate}
                    onChange={(e) => setPlannedStartDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">預計完成日</label>
                  <input
                    type="date"
                    value={plannedEndDate}
                    onChange={(e) => setPlannedEndDate(e.target.value)}
                    min={plannedStartDate || undefined}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                選擇協作使用者（可多選，不選則僅指派給自己）
              </label>
              <p className="text-sm text-gray-500 mb-3">
                💡 提示：任務會自動指派給您（創建者）。您可以額外選擇其他使用者進行協作。
              </p>
              
              {selectedUserIds.length > 0 && (
                <div className="mb-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm text-green-800 font-medium">
                    已選擇 {selectedUserIds.length} 位協作者（加上您自己共 {selectedUserIds.length + 1} 人）
                  </p>
                </div>
              )}

              {isLoadingUsers ? (
                <div className="text-center py-8 text-gray-500">
                  載入使用者清單中...
                </div>
              ) : users.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  目前沒有使用者
                </div>
              ) : (
                <>
                  {/* Search bar */}
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                      placeholder="搜尋使用者（Email、姓名或職稱）"
                    />
                  </div>

                  {/* User list */}
                  <div className="border border-gray-300 rounded-lg max-h-64 overflow-y-auto">
                    {filteredUsers.length === 0 ? (
                      <div className="text-center py-4 text-gray-500">
                        沒有符合的使用者
                      </div>
                    ) : (
                      filteredUsers.map((user) => {
                        const isSelected = selectedUserIds.includes(user.id);
                        return (
                          <label
                            key={user.id}
                            className={`flex items-center gap-3 p-3 hover:bg-gray-50 cursor-pointer transition-colors border-b last:border-b-0 ${
                              isSelected ? 'bg-green-50 border-l-4 border-l-green-500' : ''
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleUserSelection(user.id)}
                              className="w-4 h-4 text-blue-600"
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900">
                                  {user.job_title || user.full_name || user.email}
                                </span>
                                <span
                                  className={`px-2 py-0.5 text-xs font-semibold rounded ${
                                    user.role === 'admin'
                                      ? 'bg-purple-100 text-purple-800'
                                      : user.role === 'manager'
                                      ? 'bg-green-100 text-green-800'
                                      : 'bg-gray-100 text-gray-800'
                                  }`}
                                >
                                  {user.role === 'admin' && '管理員'}
                                  {user.role === 'manager' && '主管'}
                                  {user.role === 'member' && '成員'}
                                </span>
                              </div>
                              {user.job_title && user.full_name && (
                                <span className="text-sm text-gray-600">{user.full_name}</span>
                              )}
                              {(user.job_title || user.full_name) && (
                                <span className="text-sm text-gray-500">{user.email}</span>
                              )}
                            </div>
                          </label>
                        );
                      })
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-4">
              <button
                type="submit"
                disabled={isLoading}
                className="flex-1 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-semibold"
              >
                {isLoading ? '處理中...' : '確認指派'}
              </button>
              <Link
                href="/admin/templates"
                className="px-6 py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-semibold text-center"
              >
                取消
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
