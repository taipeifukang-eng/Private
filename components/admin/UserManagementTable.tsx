'use client';

import { useState } from 'react';
import { Edit2, Trash2, Shield, User as UserIcon, CheckCircle, Search, Crown } from 'lucide-react';
import { updateUserProfile, deleteUser } from '@/app/auth/actions';
import type { Profile } from '@/types/workflow';

export default function UserManagementTable({ users }: { users: Profile[] }) {
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ full_name: '', role: 'member' as Profile['role'], department: '' });
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  // Filter users
  const filteredUsers = users.filter(user => {
    const matchesSearch = 
      user.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesRole = roleFilter === 'all' || user.role === roleFilter;
    
    return matchesSearch && matchesRole;
  });

  const handleEdit = (user: Profile) => {
    setEditingUser(user.id);
    setEditForm({
      full_name: user.full_name || '',
      role: user.role,
      department: user.department || '',
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
      alert('✅ 刪除成功！');
      window.location.reload();
    } else {
      alert(`❌ 刪除失敗：${result.error}`);
    }
  };

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
                placeholder="搜尋姓名或郵件..."
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
                部門
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                角色
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
                        onClick={() => handleEdit(user)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="編輯"
                      >
                        <Edit2 size={18} />
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
  );
}
