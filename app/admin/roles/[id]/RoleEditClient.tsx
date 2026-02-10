'use client';

// ============================================
// 角色編輯 Client Component
// ============================================

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Role, Permission, MODULE_NAMES, ACTION_NAMES } from '@/types/rbac';

interface PermissionWithGrant extends Permission {
  granted: boolean;
}

interface PermissionGroup {
  module: string;
  permissions: PermissionWithGrant[];
}

interface UserWithRole {
  id: string;
  email: string;
  name: string;
  employee_code: string;
  is_active: boolean;
  assigned_at: string;
  expires_at: string | null;
}

interface SearchUser {
  id: string;
  email: string;
  name: string;
  employee_code: string;
}

interface Props {
  roleId: string;
  canEdit: boolean;
  canAssignPermissions: boolean;
}

export default function RoleEditClient({ roleId, canEdit, canAssignPermissions }: Props) {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  const [permissions, setPermissions] = useState<PermissionWithGrant[]>([]);
  const [groupedPermissions, setGroupedPermissions] = useState<PermissionGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // 編輯狀態
  const [editMode, setEditMode] = useState(false);
  const [editedRole, setEditedRole] = useState({ name: '', description: '' });

  // 使用者管理狀態
  const [activeTab, setActiveTab] = useState<'permissions' | 'users'>('permissions');
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [employeeCodesInput, setEmployeeCodesInput] = useState('');
  const [assigningUser, setAssigningUser] = useState(false);

  useEffect(() => {
    fetchRoleData();
  }, [roleId]);

  useEffect(() => {
    if (permissions.length > 0) {
      groupPermissions();
    }
  }, [permissions]);

  async function fetchRoleData() {
    try {
      // 取得角色資料
      const roleResponse = await fetch(`/api/roles/${roleId}`);
      const roleData = await roleResponse.json();

      if (!roleResponse.ok) {
        setError(roleData.error || '取得角色資料失敗');
        setLoading(false);
        return;
      }

      setRole(roleData.role);
      setEditedRole({
        name: roleData.role.name,
        description: roleData.role.description || ''
      });

      // 取得權限資料
      const permResponse = await fetch(`/api/roles/${roleId}/permissions`);
      const permData = await permResponse.json();

      if (permResponse.ok) {
        setPermissions(permData.permissions || []);
      }
    } catch (err) {
      setError('網路錯誤，請稍後再試');
    } finally {
      setLoading(false);
    }
  }

  function groupPermissions() {
    const groups = new Map<string, PermissionWithGrant[]>();

    permissions.forEach(perm => {
      if (!groups.has(perm.module)) {
        groups.set(perm.module, []);
      }
      groups.get(perm.module)!.push(perm);
    });

    const result: PermissionGroup[] = Array.from(groups.entries())
      .map(([module, perms]) => ({
        module,
        permissions: perms.sort((a, b) => {
          if (a.feature !== b.feature) return a.feature.localeCompare(b.feature);
          return a.action.localeCompare(b.action);
        })
      }))
      .sort((a, b) => a.module.localeCompare(b.module));

    setGroupedPermissions(result);
  }

  function togglePermission(permissionId: string) {
    setPermissions(prev =>
      prev.map(p =>
        p.id === permissionId ? { ...p, granted: !p.granted } : p
      )
    );
  }

  function toggleModule(module: string, grant: boolean) {
    setPermissions(prev =>
      prev.map(p =>
        p.module === module ? { ...p, granted: grant } : p
      )
    );
  }

  async function handleSavePermissions() {
    if (!canAssignPermissions) {
      alert('您沒有權限分配角色權限');
      return;
    }

    setSaving(true);
    try {
      const grantedPermissionIds = permissions
        .filter(p => p.granted)
        .map(p => p.id);

      const response = await fetch(`/api/roles/${roleId}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionIds: grantedPermissionIds })
      });

      const data = await response.json();

      if (response.ok) {
        alert('權限已儲存');
      } else {
        alert(data.error || '儲存失敗');
      }
    } catch (err) {
      alert('網路錯誤');
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveRole() {
    if (!canEdit) {
      alert('您沒有權限編輯角色資料');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/roles/${roleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editedRole)
      });

      const data = await response.json();

      if (response.ok) {
        setRole(data.role);
        setEditMode(false);
        alert('角色資料已更新');
      } else {
        alert(data.error || '更新失敗');
      }
    } catch (err) {
      alert('網路錯誤');
    } finally {
      setSaving(false);
    }
  }

  // ============================================
  // 使用者管理功能
  // ============================================

  useEffect(() => {
    if (activeTab === 'users') {
      fetchUsers();
    }
  }, [activeTab]);

  async function fetchUsers() {
    setLoadingUsers(true);
    try {
      const response = await fetch(`/api/roles/${roleId}/users`);
      const data = await response.json();

      if (response.ok) {
        setUsers(data.users || []);
      } else {
        console.error('取得使用者列表失敗:', data.error);
      }
    } catch (err) {
      console.error('網路錯誤:', err);
    } finally {
      setLoadingUsers(false);
    }
  }

  // 搜尋使用者（移除，改用批次輸入員工編號）
  async function handleAssignUsers() {
    const codes = employeeCodesInput
      .split(/[,，\n\s]+/) // 支援逗號、換行、空格分隔
      .map(code => code.trim())
      .filter(code => code.length > 0);

    if (codes.length === 0) {
      alert('請輸入至少一個員工編號');
      return;
    }

    setAssigningUser(true);
    try {
      const response = await fetch(`/api/roles/${roleId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_codes: codes })
      });

      const data = await response.json();

      if (response.ok) {
        alert(data.details || data.message);
        setShowAddUserModal(false);
        setEmployeeCodesInput('');
        fetchUsers(); // 重新載入使用者列表
      } else {
        alert(data.error || '指派失敗');
      }
    } catch (err) {
      alert('網路錯誤');
    } finally {
      setAssigningUser(false);
    }
  }

  async function handleRemoveUser(userId: string, userName: string) {
    if (!confirm(`確定要移除使用者 ${userName} 的角色？`)) {
      return;
    }

    try {
      const response = await fetch(`/api/roles/${roleId}/users/${userId}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (response.ok) {
        alert('使用者角色已移除');
        fetchUsers(); // 重新載入使用者列表
      } else {
        alert(data.error || '移除失敗');
      }
    } catch (err) {
      alert('網路錯誤');
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error || !role) {
    return (
      <div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-600">{error || '角色不存在'}</p>
        </div>
        <div className="mt-4">
          <Link href="/admin/roles" className="text-blue-600 hover:underline">
            ← 返回角色列表
          </Link>
        </div>
      </div>
    );
  }

  const grantedCount = permissions.filter(p => p.granted).length;

  return (
    <div>
      {/* 頁首 */}
      <div className="mb-8">
        <Link href="/admin/roles" className="text-blue-600 hover:underline mb-4 inline-block">
          ← 返回角色列表
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">編輯角色</h1>
      </div>

      {/* 角色資訊 */}
      <div className="bg-white rounded-lg shadow p-6 mb-6">
        <div className="flex justify-between items-start mb-6">
          <h2 className="text-xl font-semibold">角色資訊</h2>
          {canEdit && !editMode && (
            <button
              onClick={() => setEditMode(true)}
              className="text-blue-600 hover:text-blue-700"
            >
              編輯
            </button>
          )}
        </div>

        {editMode ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                角色名稱
              </label>
              <input
                type="text"
                value={editedRole.name}
                onChange={(e) => setEditedRole({ ...editedRole, name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                說明
              </label>
              <textarea
                value={editedRole.description}
                onChange={(e) => setEditedRole({ ...editedRole, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSaveRole}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? '儲存中...' : '儲存'}
              </button>
              <button
                onClick={() => {
                  setEditMode(false);
                  setEditedRole({
                    name: role.name,
                    description: role.description || ''
                  });
                }}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">角色名稱</p>
              <p className="text-lg font-medium">{role.name}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">角色代碼</p>
              <code className="text-lg text-gray-700 bg-gray-100 px-2 py-1 rounded">
                {role.code}
              </code>
            </div>
            <div className="col-span-2">
              <p className="text-sm text-gray-500">說明</p>
              <p className="text-gray-700">{role.description || '無'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">類型</p>
              <p className="text-gray-700">
                {role.is_system ? '系統角色' : '自訂角色'}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">狀態</p>
              <p className="text-gray-700">
                {role.is_active ? '啟用' : '停用'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 分頁選單 */}
      <div className="bg-white rounded-lg shadow mb-6">
        <div className="border-b border-gray-200">
          <div className="flex">
            <button
              onClick={() => setActiveTab('permissions')}
              className={`px-6 py-3 font-medium ${
                activeTab === 'permissions'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              權限設定
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={`px-6 py-3 font-medium ${
                activeTab === 'users'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              使用者管理
            </button>
          </div>
        </div>
      </div>

      {/* 權限設定分頁 */}
      {activeTab === 'permissions' && (
        <div className="bg-white rounded-lg shadow p-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-xl font-semibold">權限設定</h2>
            <p className="text-sm text-gray-500 mt-1">
              已授予 {grantedCount} / {permissions.length} 個權限
            </p>
          </div>
          {canAssignPermissions && (
            <button
              onClick={handleSavePermissions}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? '儲存中...' : '儲存權限'}
            </button>
          )}
        </div>

        {/* 權限矩陣 */}
        <div className="space-y-6">
          {groupedPermissions.map(group => {
            const moduleGranted = group.permissions.filter(p => p.granted).length;
            const moduleTotal = group.permissions.length;
            const allGranted = moduleGranted === moduleTotal;

            return (
              <div key={group.module} className="border rounded-lg overflow-hidden">
                {/* 模組標題 */}
                <div className="bg-gray-50 px-4 py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-gray-900">
                      {MODULE_NAMES[group.module] || group.module}
                    </h3>
                    <span className="text-sm text-gray-500">
                      ({moduleGranted}/{moduleTotal})
                    </span>
                  </div>
                  {canAssignPermissions && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => toggleModule(group.module, true)}
                        className="text-sm text-blue-600 hover:text-blue-700"
                      >
                        全選
                      </button>
                      <button
                        onClick={() => toggleModule(group.module, false)}
                        className="text-sm text-gray-600 hover:text-gray-700"
                      >
                        全不選
                      </button>
                    </div>
                  )}
                </div>

                {/* 權限列表 */}
                <div className="divide-y divide-gray-200">
                  {group.permissions.map(perm => (
                    <label
                      key={perm.id}
                      className={`flex items-center px-4 py-3 hover:bg-gray-50 cursor-pointer ${
                        !canAssignPermissions ? 'cursor-not-allowed opacity-60' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={perm.granted}
                        onChange={() => togglePermission(perm.id)}
                        disabled={!canAssignPermissions}
                        className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                      />
                      <div className="ml-3 flex-1">
                        <div className="flex items-center gap-2">
                          <code className="text-sm text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                            {perm.code}
                          </code>
                          <span className="text-xs text-gray-500">
                            [{ACTION_NAMES[perm.action] || perm.action}]
                          </span>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">
                          {perm.description}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* 使用者管理分頁 */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">使用者管理</h2>
            <button
              onClick={() => setShowAddUserModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              + 新增使用者
            </button>
          </div>

          {loadingUsers ? (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>此角色尚未指派任何使用者</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">姓名</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">員工編號</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">狀態</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">指派日期</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {users.map(user => (
                    <tr key={user.id}>
                      <td className="px-4 py-3 text-sm">{user.email}</td>
                      <td className="px-4 py-3 text-sm">{user.name || '-'}</td>
                      <td className="px-4 py-3 text-sm">
                        <code className="bg-gray-100 px-2 py-1 rounded text-xs">
                          {user.employee_code || '-'}
                        </code>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          user.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {user.is_active ? '啟用' : '停用'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {new Date(user.assigned_at).toLocaleDateString('zh-TW')}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        <button
                          onClick={() => handleRemoveUser(user.id, user.name || user.email)}
                          className="text-red-600 hover:text-red-700"
                        >
                          移除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 新增使用者 Modal */}
      {showAddUserModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
            <div className="flex justify-between items-center px-6 py-4 border-b">
              <h3 className="text-lg font-semibold">批次新增使用者</h3>
              <button
                onClick={() => {
                  setShowAddUserModal(false);
                  setEmployeeCodesInput('');
                }}
                className="text-gray-400 hover:text-gray-500"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* 員工編號輸入 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  員工編號（支援批次）
                </label>
                <textarea
                  value={employeeCodesInput}
                  onChange={(e) => setEmployeeCodesInput(e.target.value)}
                  placeholder="請輸入員工編號，可使用逗號、換行或空格分隔&#10;範例：FK0278, FK0279&#10;或&#10;FK0278&#10;FK0279"
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  支援多種分隔方式：逗號、換行、空格
                </p>
              </div>

              {/* 提示訊息 */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm text-blue-800">
                  💡 <strong>批次新增說明：</strong>
                </p>
                <ul className="text-xs text-blue-700 mt-1 ml-4 list-disc space-y-1">
                  <li>一次可新增多個員工編號</li>
                  <li>系統會自動過濾已有此角色的使用者</li>
                  <li>只有已綁定使用者帳號的員工才能指派</li>
                </ul>
              </div>
            </div>

            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowAddUserModal(false);
                  setEmployeeCodesInput('');
                }}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleAssignUsers}
                disabled={!employeeCodesInput.trim() || assigningUser}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {assigningUser ? '指派中...' : '批次指派'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
