'use client';

// ============================================
// 角色列表 Client Component
// ============================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Role } from '@/types/rbac';

interface RoleWithCounts extends Role {
  permission_count: number;
  user_count: number;
}

interface Props {
  canCreate: boolean;
}

export default function RoleListClient({ canCreate }: Props) {
  const [roles, setRoles] = useState<RoleWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRole, setNewRole] = useState({ name: '', code: '', description: '' });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchRoles();
  }, []);

  async function fetchRoles() {
    try {
      const response = await fetch('/api/roles');
      const data = await response.json();

      if (response.ok) {
        setRoles(data.roles || []);
      } else {
        setError(data.error || '取得角色列表失敗');
      }
    } catch (err) {
      setError('網路錯誤，請稍後再試');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newRole.name || !newRole.code) {
      alert('請填寫角色名稱和代碼');
      return;
    }

    setCreating(true);
    try {
      const response = await fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRole)
      });

      const data = await response.json();

      if (response.ok) {
        alert('角色建立成功');
        setShowCreateModal(false);
        setNewRole({ name: '', code: '', description: '' });
        fetchRoles();
      } else {
        alert(data.error || '建立失敗');
      }
    } catch (err) {
      alert('網路錯誤');
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(roleId: string, currentStatus: boolean) {
    if (!confirm(`確定要${currentStatus ? '停用' : '啟用'}此角色嗎？`)) {
      return;
    }

    try {
      const response = await fetch(`/api/roles/${roleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !currentStatus })
      });

      if (response.ok) {
        fetchRoles();
      } else {
        const data = await response.json();
        alert(data.error || '操作失敗');
      }
    } catch (err) {
      alert('網路錯誤');
    }
  }

  async function handleDelete(roleId: string, roleName: string) {
    if (!confirm(`確定要刪除角色「${roleName}」嗎？此操作無法復原。`)) {
      return;
    }

    try {
      const response = await fetch(`/api/roles/${roleId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        alert('角色已刪除');
        fetchRoles();
      } else {
        const data = await response.json();
        alert(data.error || '刪除失敗');
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

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div>
      {/* 操作按鈕 */}
      <div className="mb-6 flex justify-between items-center">
        <div className="text-sm text-gray-600">
          共 {roles.length} 個角色
        </div>
        {canCreate && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            + 新增角色
          </button>
        )}
      </div>

      {/* 角色列表 */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                角色名稱
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                角色代碼
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                說明
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                權限數
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                使用者數
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                狀態
              </th>
              <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {roles.map((role) => (
              <tr key={role.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {role.name}
                      </div>
                      {role.is_system && (
                        <span className="text-xs text-blue-600">系統角色</span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <code className="text-sm text-gray-600 bg-gray-100 px-2 py-1 rounded">
                    {role.code}
                  </code>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-gray-600 max-w-md">
                    {role.description || '-'}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-center">
                  <span className="text-sm text-gray-900">
                    {role.permission_count}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-center">
                  <span className="text-sm text-gray-900">
                    {role.user_count}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-center">
                  {role.is_active ? (
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                      啟用
                    </span>
                  ) : (
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                      停用
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium">
                  <div className="flex items-center justify-center gap-2">
                    <Link
                      href={`/admin/roles/${role.id}`}
                      className="text-blue-600 hover:text-blue-900"
                    >
                      編輯
                    </Link>
                    {!role.is_system && (
                      <>
                        <button
                          onClick={() => handleToggleActive(role.id, role.is_active)}
                          className="text-yellow-600 hover:text-yellow-900"
                        >
                          {role.is_active ? '停用' : '啟用'}
                        </button>
                        <button
                          onClick={() => handleDelete(role.id, role.name)}
                          className="text-red-600 hover:text-red-900"
                        >
                          刪除
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 建立角色 Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">建立新角色</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  角色名稱 *
                </label>
                <input
                  type="text"
                  value={newRole.name}
                  onChange={(e) => setNewRole({ ...newRole, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例：專案經理"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  角色代碼 *
                </label>
                <input
                  type="text"
                  value={newRole.code}
                  onChange={(e) => setNewRole({ ...newRole, code: e.target.value.toLowerCase() })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="例：project_manager"
                />
                <p className="mt-1 text-xs text-gray-500">
                  只能包含小寫英文、數字和底線
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  說明
                </label>
                <textarea
                  value={newRole.description}
                  onChange={(e) => setNewRole({ ...newRole, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="角色職責說明"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewRole({ name: '', code: '', description: '' });
                }}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                disabled={creating}
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {creating ? '建立中...' : '確定建立'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
