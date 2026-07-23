'use client';

import { useState } from 'react';
import { Copy, Edit2, Eye, Key, Search, Shield, Store, Trash2, User as UserIcon, CheckCircle, Crown, X } from 'lucide-react';
import { updateUserProfile, deleteUser } from '@/app/auth/actions';
import type { Profile } from '@/types/workflow';

type UserRbacRoleSummary = {
  id: string;
  name: string;
  code: string;
  assignment_id: string;
  is_system: boolean;
  is_active: boolean;
  assignment_active: boolean;
  assigned_at: string | null;
  assigned_by: string | null;
  expires_at: string | null;
  is_expired: boolean;
  is_current: boolean;
  permission_count: number;
  is_dev_verification_role: boolean;
};

type UserRbacPermissionSummary = {
  code: string;
  module: string;
  feature: string;
  action: string;
  description: string | null;
  source_roles: Array<{ id: string; name: string; code: string }>;
};

type UserStoreScopeSummary = {
  id: string;
  store_id: string;
  store_code: string | null;
  store_name: string | null;
  short_name: string | null;
  role_type: string;
  is_primary: boolean;
  store_is_active: boolean | null;
};

type UserRbacDetail = {
  user: {
    id: string;
    email: string | null;
    full_name: string | null;
    employee_code: string | null;
    legacy_role: string | null;
    department: string | null;
    job_title: string | null;
    is_disabled: boolean;
    is_dev_test_account: boolean;
  };
  roles: UserRbacRoleSummary[];
  effective_permissions: UserRbacPermissionSummary[];
  legacy_compatibility: {
    is_admin_like: boolean;
    source: string | null;
    note: string | null;
  };
  store_scopes: UserStoreScopeSummary[];
  validation_summary: {
    can_view_users: boolean;
    can_view_roles: boolean;
    can_access_general_affairs_service: boolean;
    can_view_inventory_balances: boolean;
    can_view_inventory_transactions: boolean;
    can_post_inventory_transactions: boolean;
    can_view_parts: boolean;
    store_scope_count: number;
    store_manager_scope_label: string;
  };
};

type UserRow = Profile & {
  rbac_roles?: UserRbacRoleSummary[];
  effective_permission_count?: number;
  store_scope_count?: number;
  is_admin_compatibility?: boolean;
  is_dev_test_account?: boolean;
};

export default function UserManagementTable({ users }: { users: UserRow[] }) {
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ full_name: '', role: 'member' as Profile['role'], department: '', job_title: '', employee_code: '' });
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [resettingPasswordFor, setResettingPasswordFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [rbacDetailUser, setRbacDetailUser] = useState<UserRow | null>(null);
  const [rbacDetail, setRbacDetail] = useState<UserRbacDetail | null>(null);
  const [rbacDetailLoading, setRbacDetailLoading] = useState(false);
  const [rbacDetailError, setRbacDetailError] = useState<string | null>(null);
  const [permissionSearch, setPermissionSearch] = useState('');

  // Filter and sort users
  const filteredUsers = users
    .filter(user => {
      const term = searchTerm.toLowerCase();
      const matchesSearch = 
        user.full_name?.toLowerCase().includes(term) ||
        user.email?.toLowerCase().includes(term) ||
        (user.employee_code && user.employee_code.toLowerCase().includes(term));
      
      const matchesRole = roleFilter === 'all' || user.role === roleFilter;
      
      return matchesSearch && matchesRole;
    })
    .sort((a, b) => {
      // 按員工編號排序，沒有員編的排在最後
      if (!a.employee_code && !b.employee_code) return 0;
      if (!a.employee_code) return 1;
      if (!b.employee_code) return -1;
      return a.employee_code.localeCompare(b.employee_code);
    });

  const handleEdit = (user: Profile) => {
    setEditingUser(user.id);
    setEditForm({
      full_name: user.full_name || '',
      role: user.role,
      department: user.department || '',
      job_title: user.job_title || '',
      employee_code: user.employee_code || '',
    });
  };

  const handleSave = async (userId: string) => {
    const result = await updateUserProfile(userId, editForm);
    
    if (result.success) {
      alert('✅ 更新成功！');
      setEditingUser(null);
      window.location.reload();
    } else {
      alert(`❌ 更新失敗：${result.error}`);
    }
  };

  const handleQuickPromote = async (userId: string, userName: string, newRole: Profile['role']) => {
    const roleNames = {
      admin: '管理員',
      manager: '主管',
      member: '成員'
    };
    
    if (!confirm(`確定要將「${userName}」升級為「${roleNames[newRole]}」嗎？`)) {
      return;
    }

    const result = await updateUserProfile(userId, { role: newRole });
    
    if (result.success) {
      alert('✅ 角色更新成功！');
      window.location.reload();
    } else {
      alert(`❌ 更新失敗：${result.error}`);
    }
  };

  const handleDelete = async (userId: string, userName: string) => {
    if (!confirm(`確定要刪除使用者「${userName}」嗎？此操作無法復原。`)) {
      return;
    }

    const result = await deleteUser(userId);
    
    if (result.success) {
      const message = 'message' in result ? result.message : '刪除成功！';
      alert(`✅ ${message}`);
      window.location.reload();
    } else {
      alert(`❌ 刪除失敗：${result.error}`);
    }
  };

  const handleResetPassword = async (userId: string, userName: string) => {
    setResettingPasswordFor(userId);
    
    // 生成隨機密碼
    const length = 10;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
    let randomPassword = '';
    for (let i = 0; i < length; i++) {
      randomPassword += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    
    setNewPassword(randomPassword);
  };

  const confirmResetPassword = async () => {
    if (!resettingPasswordFor || !newPassword) return;
    
    if (newPassword.length < 6) {
      alert('密碼長度至少需要 6 個字元');
      return;
    }

    setIsResetting(true);

    try {
      const response = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: resettingPasswordFor,
          newPassword: newPassword,
        }),
      });

      const result = await response.json();

      if (result.success) {
        alert('✅ 密碼已成功重置！請將新密碼告知使用者。');
        // 不關閉對話框，讓管理員可以複製密碼
      } else {
        alert(`❌ 重置失敗：${result.error}`);
        setResettingPasswordFor(null);
        setNewPassword('');
      }
    } catch (error) {
      alert('❌ 重置失敗，請稍後再試');
      setResettingPasswordFor(null);
      setNewPassword('');
    } finally {
      setIsResetting(false);
    }
  };

  const cancelResetPassword = () => {
    setResettingPasswordFor(null);
    setNewPassword('');
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('✅ 已複製到剪貼簿');
  };

  const copyEffectivePermissions = () => {
    if (!rbacDetail) return;
    copyToClipboard(rbacDetail.effective_permissions.map(permission => permission.code).join('\n'));
  };

  const openRbacDetail = async (user: UserRow) => {
    setRbacDetailUser(user);
    setRbacDetail(null);
    setRbacDetailError(null);
    setPermissionSearch('');
    setRbacDetailLoading(true);

    try {
      const response = await fetch(`/api/admin/users/${user.id}/rbac`, {
        headers: { Accept: 'application/json' },
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || '取得角色與權限失敗');
      }
      setRbacDetail(result.data);
    } catch (error) {
      setRbacDetailError(error instanceof Error ? error.message : '取得角色與權限失敗');
    } finally {
      setRbacDetailLoading(false);
    }
  };

  const closeRbacDetail = () => {
    setRbacDetailUser(null);
    setRbacDetail(null);
    setRbacDetailError(null);
    setPermissionSearch('');
  };

  const groupedPermissions = (rbacDetail?.effective_permissions || [])
    .filter(permission => {
      const term = permissionSearch.trim().toLowerCase();
      if (!term) return true;
      return (
        permission.code.toLowerCase().includes(term) ||
        permission.module.toLowerCase().includes(term) ||
        permission.feature.toLowerCase().includes(term) ||
        permission.action.toLowerCase().includes(term) ||
        permission.source_roles.some(role => role.code.toLowerCase().includes(term) || role.name.toLowerCase().includes(term))
      );
    })
    .reduce<Record<string, UserRbacPermissionSummary[]>>((groups, permission) => {
      const key = permission.module || 'uncategorized';
      groups[key] = groups[key] || [];
      groups[key].push(permission);
      return groups;
    }, {});

  const getCurrentRbacRoles = (user: UserRow) => (user.rbac_roles || []).filter(role => role.is_current);

  const getRoleBadge = (role: string) => {
    const config = {
      admin: { label: '管理員', classes: 'bg-purple-100 text-purple-800', icon: Shield },
      manager: { label: '主管', classes: 'bg-green-100 text-green-800', icon: Crown },
      member: { label: '成員', classes: 'bg-gray-100 text-gray-800', icon: UserIcon },
    };

    const { label, classes, icon: Icon } = config[role as keyof typeof config] || config.member;

    return (
      <span className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded-full ${classes}`}>
        <Icon size={14} />
        {label}
      </span>
    );
  };

  const getRoleColor = (role: string) => {
    const colors = {
      admin: 'text-purple-600',
      manager: 'text-green-600',
      member: 'text-gray-600',
    };
    return colors[role as keyof typeof colors] || colors.member;
  };

  return (
    <>
      {/* 重置密碼對話框 */}
      {resettingPasswordFor && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                <Key className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900">重置使用者密碼</h3>
                <p className="text-sm text-gray-600">
                  {users.find(u => u.id === resettingPasswordFor)?.full_name || 
                   users.find(u => u.id === resettingPasswordFor)?.email}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  新密碼
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none font-mono"
                    placeholder="輸入新密碼（至少 6 個字元）"
                  />
                  <button
                    onClick={() => copyToClipboard(newPassword)}
                    className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm"
                    title="複製密碼"
                  >
                    複製
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  建議密碼長度至少 8 個字元，包含字母、數字和特殊符號
                </p>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <p className="text-sm text-yellow-800">
                  ⚠️ 請務必將新密碼告知使用者，並建議使用者登入後立即修改密碼。
                </p>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={confirmResetPassword}
                  disabled={isResetting || newPassword.length < 6}
                  className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
                >
                  {isResetting ? '重置中...' : '確認重置'}
                </button>
                <button
                  onClick={cancelResetPassword}
                  disabled={isResetting}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {rbacDetailUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">角色與有效權限</h3>
                <p className="text-sm text-gray-600">
                  {rbacDetailUser.full_name || rbacDetailUser.email || '未命名使用者'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeRbacDetail}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                title="關閉"
              >
                <X size={20} />
              </button>
            </div>

            <div className="overflow-y-auto p-6">
              {rbacDetailLoading && (
                <div className="py-12 text-center text-gray-600">載入角色與權限中...</div>
              )}

              {rbacDetailError && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {rbacDetailError}
                </div>
              )}

              {rbacDetail && (
                <div className="space-y-6">
                  <section className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <div className="border border-gray-200 rounded-lg p-4 md:col-span-2">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">基本資料</h4>
                      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                        <div>
                          <dt className="text-gray-500">姓名</dt>
                          <dd className="font-medium text-gray-900">{rbacDetail.user.full_name || '未設定'}</dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">Email</dt>
                          <dd className="font-medium text-gray-900 break-all">{rbacDetail.user.email || '-'}</dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">員編</dt>
                          <dd className="font-medium text-gray-900">{rbacDetail.user.employee_code || '未設定'}</dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">舊 profiles.role</dt>
                          <dd>{getRoleBadge(rbacDetail.user.legacy_role || 'member')}</dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">狀態</dt>
                          <dd className={rbacDetail.user.is_disabled ? 'font-medium text-red-700' : 'font-medium text-green-700'}>
                            {rbacDetail.user.is_disabled ? '停用' : '啟用'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-gray-500">DEV 測試帳號</dt>
                          <dd>
                            {rbacDetail.user.is_dev_test_account ? (
                              <span className="inline-flex px-2 py-1 rounded bg-indigo-50 text-indigo-700 text-xs font-semibold">DEV</span>
                            ) : (
                              <span className="text-gray-500">否</span>
                            )}
                          </dd>
                        </div>
                      </dl>
                    </div>

                    <div className="border border-gray-200 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">有效權限</h4>
                      <p className="text-3xl font-semibold text-gray-900">{rbacDetail.effective_permissions.length}</p>
                      <p className="text-xs text-gray-500 mt-1">由目前有效 RBAC 角色計算</p>
                      {rbacDetail.legacy_compatibility.is_admin_like && (
                        <div className="mt-3 text-xs rounded bg-purple-50 text-purple-700 p-2">
                          Admin compatibility：{rbacDetail.legacy_compatibility.source}
                        </div>
                      )}
                    </div>

                    <div className="border border-gray-200 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">門市範圍</h4>
                      <p className="text-3xl font-semibold text-gray-900">{rbacDetail.store_scopes.length}</p>
                      <p className="text-xs text-gray-500 mt-1">{rbacDetail.validation_summary.store_manager_scope_label}</p>
                    </div>
                  </section>

                  <section className="border border-gray-200 rounded-lg p-4">
                    <h4 className="text-sm font-semibold text-gray-900 mb-3">已指派角色</h4>
                    <div className="space-y-2">
                      {rbacDetail.roles.length === 0 && (
                        <p className="text-sm text-gray-500">尚未指派 RBAC 角色</p>
                      )}
                      {rbacDetail.roles.map(role => (
                        <div key={role.assignment_id} className="flex flex-col md:flex-row md:items-center gap-2 justify-between border border-gray-100 rounded-lg p-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-gray-900">{role.name}</span>
                              <code className="px-2 py-1 rounded bg-gray-100 text-xs text-gray-700">{role.code}</code>
                              {role.is_system && <span className="px-2 py-1 rounded bg-blue-50 text-xs text-blue-700">系統</span>}
                              {role.is_dev_verification_role && <span className="px-2 py-1 rounded bg-indigo-50 text-xs text-indigo-700">DEV</span>}
                              {!role.is_current && <span className="px-2 py-1 rounded bg-amber-50 text-xs text-amber-700">目前無效</span>}
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                              assigned_at：{role.assigned_at ? new Date(role.assigned_at).toLocaleString('zh-TW') : '-'}，
                              expires_at：{role.expires_at ? new Date(role.expires_at).toLocaleString('zh-TW') : '永久'}
                            </p>
                          </div>
                          <div className="text-sm text-gray-700">
                            權限 {role.permission_count}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="border border-gray-200 rounded-lg p-4">
                    <div className="flex flex-col md:flex-row gap-3 md:items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold text-gray-900">有效權限代碼</h4>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={permissionSearch}
                          onChange={(event) => setPermissionSearch(event.target.value)}
                          placeholder="搜尋權限代碼、模組或來源角色"
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none w-full md:w-72"
                        />
                        <button
                          type="button"
                          onClick={copyEffectivePermissions}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 text-sm"
                        >
                          <Copy size={16} />
                          複製
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                      {Object.keys(groupedPermissions).length === 0 && (
                        <p className="text-sm text-gray-500">沒有符合條件的有效權限</p>
                      )}
                      {Object.entries(groupedPermissions).map(([module, permissions]) => (
                        <div key={module} className="border border-gray-100 rounded-lg overflow-hidden">
                          <div className="px-3 py-2 bg-gray-50 text-sm font-semibold text-gray-800">
                            {module} <span className="text-gray-500 font-normal">({permissions.length})</span>
                          </div>
                          <div className="divide-y divide-gray-100">
                            {permissions.map(permission => (
                              <div key={permission.code} className="px-3 py-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <code className="text-xs bg-gray-100 rounded px-2 py-1 text-gray-800">{permission.code}</code>
                                  <span className="text-xs text-gray-500">{permission.feature} / {permission.action}</span>
                                </div>
                                <p className="text-xs text-gray-500 mt-1">
                                  來源：{permission.source_roles.map(role => `${role.name}(${role.code})`).join('、')}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="border border-gray-200 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">門市範圍</h4>
                      <div className="space-y-2">
                        {rbacDetail.store_scopes.length === 0 && (
                          <p className="text-sm text-gray-500">未設定 store_managers 範圍</p>
                        )}
                        {rbacDetail.store_scopes.map(scope => (
                          <div key={scope.id} className="flex items-start gap-2 text-sm border border-gray-100 rounded p-2">
                            <Store size={16} className="text-gray-500 mt-0.5" />
                            <div>
                              <p className="font-medium text-gray-900">
                                {scope.store_code || '-'} {scope.short_name || scope.store_name || ''}
                              </p>
                              <p className="text-xs text-gray-500">
                                {scope.role_type}{scope.is_primary ? ' / primary' : ''}{scope.store_is_active === false ? ' / 門市停用' : ''}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="border border-gray-200 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3">DEV 人工驗證摘要</h4>
                      <div className="grid grid-cols-1 gap-2 text-sm">
                        {[
                          ['可看使用者管理', rbacDetail.validation_summary.can_view_users],
                          ['可看角色管理', rbacDetail.validation_summary.can_view_roles],
                          ['可進總務服務中心', rbacDetail.validation_summary.can_access_general_affairs_service],
                          ['可看庫存餘額', rbacDetail.validation_summary.can_view_inventory_balances],
                          ['可看庫存流水', rbacDetail.validation_summary.can_view_inventory_transactions],
                          ['可登錄庫存交易', rbacDetail.validation_summary.can_post_inventory_transactions],
                          ['可看料件目錄', rbacDetail.validation_summary.can_view_parts],
                        ].map(([label, allowed]) => (
                          <div key={String(label)} className="flex items-center justify-between border border-gray-100 rounded px-3 py-2">
                            <span>{label}</span>
                            <span className={allowed ? 'text-green-700 font-semibold' : 'text-gray-500'}>
                              {allowed ? '是' : '否'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </section>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-lg overflow-hidden">
      {/* Header with Search and Filters */}
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">所有使用者</h2>
          
          <div className="flex flex-col md:flex-row gap-3 w-full md:w-auto">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-5 h-5 text-gray-400" />
              <input
                type="text"
                placeholder="搜尋姓名、郵件或員編..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none w-full md:w-64"
              />
            </div>

            {/* Role Filter */}
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            >
              <option value="all">所有角色</option>
              <option value="admin">管理員</option>
              <option value="manager">主管</option>
              <option value="member">成員</option>
            </select>
          </div>
        </div>
        
        <p className="text-sm text-gray-600 mt-2">
          共 {filteredUsers.length} 位使用者
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                使用者
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                電子郵件
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                員編
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                部門
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                職稱
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                角色
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                RBAC角色
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                有效權限
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                門市範圍
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                註冊日期
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                快速操作
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                管理
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredUsers.map((user) => (
              <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  {editingUser === user.id ? (
                    <input
                      type="text"
                      value={editForm.full_name}
                      onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
                      className="px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                    />
                  ) : (
                    <div className="flex items-center">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold ${
                        user.role === 'admin' ? 'bg-purple-500' :
                        user.role === 'manager' ? 'bg-green-500' : 'bg-blue-500'
                      }`}>
                        {user.full_name?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="ml-3">
                        <div className="text-sm font-medium text-gray-900">
                          {user.full_name || '未設定'}
                        </div>
                      </div>
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">{user.email}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {editingUser === user.id ? (
                    <input
                      type="text"
                      value={editForm.employee_code}
                      onChange={(e) => setEditForm({ ...editForm, employee_code: e.target.value })}
                      className="px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="輸入員編"
                    />
                  ) : (
                    <div className="text-sm text-gray-900">{user.employee_code || '未設定'}</div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {editingUser === user.id ? (
                    <input
                      type="text"
                      value={editForm.department}
                      onChange={(e) => setEditForm({ ...editForm, department: e.target.value })}
                      className="px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="輸入部門"
                    />
                  ) : (
                    <div className="text-sm text-gray-900">{user.department || '未設定'}</div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {editingUser === user.id ? (
                    <input
                      type="text"
                      value={editForm.job_title}
                      onChange={(e) => setEditForm({ ...editForm, job_title: e.target.value })}
                      className="px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                      placeholder="輸入職稱"
                    />
                  ) : (
                    <div className="text-sm text-gray-900">{user.job_title || '未設定'}</div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {editingUser === user.id ? (
                    <select
                      value={editForm.role}
                      onChange={(e) => setEditForm({ ...editForm, role: e.target.value as Profile['role'] })}
                      className="px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                      <option value="member">成員</option>
                      <option value="manager">主管</option>
                      <option value="admin">管理員</option>
                    </select>
                  ) : (
                    getRoleBadge(user.role)
                  )}
                </td>
                <td className="px-6 py-4 min-w-56">
                  <div className="flex flex-wrap gap-1">
                    {getCurrentRbacRoles(user).slice(0, 3).map(role => (
                      <span key={role.assignment_id} className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-100 text-xs text-gray-700">
                        {role.name}
                        <code className="text-[10px] text-gray-500">{role.code}</code>
                      </span>
                    ))}
                    {getCurrentRbacRoles(user).length === 0 && (
                      <span className="text-sm text-gray-500">未指派</span>
                    )}
                    {getCurrentRbacRoles(user).length > 3 && (
                      <span className="px-2 py-1 rounded bg-gray-50 text-xs text-gray-500">
                        +{getCurrentRbacRoles(user).length - 3}
                      </span>
                    )}
                    {user.is_dev_test_account && (
                      <span className="px-2 py-1 rounded bg-indigo-50 text-xs font-semibold text-indigo-700">DEV</span>
                    )}
                    {user.is_admin_compatibility && (
                      <span className="px-2 py-1 rounded bg-purple-50 text-xs font-semibold text-purple-700">Admin bypass</span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm font-medium text-gray-900">
                    {user.effective_permission_count ?? 0}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-gray-900">
                    {user.store_scope_count ?? 0}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {new Date(user.created_at).toLocaleDateString('zh-TW')}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {editingUser !== user.id && (
                    <div className="flex gap-1">
                      {user.role === 'member' && (
                        <>
                          <button
                            onClick={() => handleQuickPromote(user.id, user.full_name || user.email || '', 'manager')}
                            className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                            title="升級為主管"
                          >
                            → 主管
                          </button>
                          <button
                            onClick={() => handleQuickPromote(user.id, user.full_name || user.email || '', 'admin')}
                            className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition-colors"
                            title="升級為管理員"
                          >
                            → 管理員
                          </button>
                        </>
                      )}
                      {user.role === 'manager' && (
                        <>
                          <button
                            onClick={() => handleQuickPromote(user.id, user.full_name || user.email || '', 'member')}
                            className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
                            title="降級為成員"
                          >
                            → 成員
                          </button>
                          <button
                            onClick={() => handleQuickPromote(user.id, user.full_name || user.email || '', 'admin')}
                            className="px-2 py-1 text-xs bg-purple-100 text-purple-700 rounded hover:bg-purple-200 transition-colors"
                            title="升級為管理員"
                          >
                            → 管理員
                          </button>
                        </>
                      )}
                      {user.role === 'admin' && (
                        <button
                          onClick={() => handleQuickPromote(user.id, user.full_name || user.email || '', 'manager')}
                          className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                          title="降級為主管"
                        >
                          → 主管
                        </button>
                      )}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {editingUser === user.id ? (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleSave(user.id)}
                        className="p-2 text-green-600 hover:bg-green-50 rounded transition-colors"
                        title="儲存"
                      >
                        <CheckCircle size={18} />
                      </button>
                      <button
                        onClick={() => setEditingUser(null)}
                        className="p-2 text-gray-600 hover:bg-gray-50 rounded transition-colors"
                        title="取消"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button
                        onClick={() => openRbacDetail(user)}
                        className="p-2 text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                        title="查看角色與權限"
                      >
                        <Eye size={18} />
                      </button>
                      <button
                        onClick={() => handleEdit(user)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="編輯"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        onClick={() => handleResetPassword(user.id, user.full_name || user.email || '')}
                        className="p-2 text-orange-600 hover:bg-orange-50 rounded transition-colors"
                        title="重置密碼"
                      >
                        <Key size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(user.id, user.full_name || user.email || '未知')}
                        className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                        title="刪除"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredUsers.length === 0 && (
          <div className="text-center py-12">
            <UserIcon className="w-12 h-12 mx-auto text-gray-400 mb-3" />
            <p className="text-gray-600">找不到符合條件的使用者</p>
          </div>
        )}
      </div>
    </div>
    </>
  );
}
