'use client';

// ============================================
// 角色編輯 Client Component
// ============================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronsDown, ChevronsUp, ListChecks, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { Role, Permission, MODULE_NAMES, FEATURE_NAMES, ACTION_NAMES } from '@/types/rbac';

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
  department: string;
  job_title: string;
  profile_role: 'admin' | 'manager' | 'member';
  is_active: boolean;
  assigned_at: string;
  expires_at: string | null;
}

function getBasicViewPermissionIds(featurePermissions: PermissionWithGrant[]) {
  const actions = new Set(featurePermissions.map(permission => permission.action));
  const preferredAction = actions.has('view_own_store')
    ? 'view_own_store'
    : actions.has('view_own')
      ? 'view_own'
      : actions.has('view')
        ? 'view'
        : actions.has('view_all')
          ? 'view_all'
          : null;

  return new Set(featurePermissions
    .filter(permission => permission.action === 'access' || permission.action === preferredAction)
    .map(permission => permission.id));
}

const HIGH_IMPACT_PERMISSION_ACTIONS = new Set([
  'delete',
  'force_close',
  'revert',
  'unconfirm',
]);

const VIEW_PERMISSION_ACTIONS = new Set([
  'access',
  'view',
  'view_own',
  'view_own_store',
  'view_all',
  'view_inactive',
]);

function isHighImpactPermission(permission: PermissionWithGrant) {
  return HIGH_IMPACT_PERMISSION_ACTIONS.has(permission.action);
}

function getDailyPermissionIds(featurePermissions: PermissionWithGrant[]) {
  const basicViewIds = getBasicViewPermissionIds(featurePermissions);
  return new Set(featurePermissions
    .filter(permission => (
      basicViewIds.has(permission.id)
      || (!VIEW_PERMISSION_ACTIONS.has(permission.action) && !isHighImpactPermission(permission))
    ))
    .map(permission => permission.id));
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
  canViewPermissions: boolean;
  canAssignPermissions: boolean;
  canViewUsers: boolean;
  canAssignUsers: boolean;
  canRevokeUsers: boolean;
}

export default function RoleEditClient({
  roleId,
  canEdit,
  canViewPermissions,
  canAssignPermissions,
  canViewUsers,
  canAssignUsers,
  canRevokeUsers
}: Props) {
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
  const [permissionSearch, setPermissionSearch] = useState('');
  const [permissionView, setPermissionView] = useState<'all' | 'granted' | 'changed' | 'advanced'>('all');
  const [showTechnicalPermissionCodes, setShowTechnicalPermissionCodes] = useState(false);
  const [expandedPermissionModules, setExpandedPermissionModules] = useState<Set<string>>(new Set());
  const [expandedPermissionFeatures, setExpandedPermissionFeatures] = useState<Set<string>>(new Set());
  const [savedPermissionIds, setSavedPermissionIds] = useState<string[]>([]);
  const [permissionConflict, setPermissionConflict] = useState<string | null>(null);
  const [showPermissionChanges, setShowPermissionChanges] = useState(false);
  const allowUnsavedNavigationRef = useRef(false);

  const permissionChangeSummary = useMemo(() => {
    const savedIds = new Set(savedPermissionIds);
    const enabledPermissions = permissions.filter(permission => permission.granted && !savedIds.has(permission.id));
    const disabledPermissions = permissions.filter(permission => !permission.granted && savedIds.has(permission.id));
    return {
      enabled: enabledPermissions.length,
      disabled: disabledPermissions.length,
      enabledPermissions,
      disabledPermissions,
      hasChanges: enabledPermissions.length > 0 || disabledPermissions.length > 0,
    };
  }, [permissions, savedPermissionIds]);

  useEffect(() => {
    fetchRoleData();
  }, [roleId]);

  useEffect(() => {
    if (!canViewPermissions && canViewUsers) {
      setActiveTab('users');
    }
  }, [canViewPermissions, canViewUsers]);

  useEffect(() => {
    if (!permissionChangeSummary.hasChanges) return;

    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      if (allowUnsavedNavigationRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [permissionChangeSummary.hasChanges]);

  useEffect(() => {
    if (!permissionChangeSummary.hasChanges) return;

    const confirmLinkNavigation = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.href === window.location.href) return;
      if (!window.confirm('權限變更尚未儲存，確定要離開嗎？')) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      allowUnsavedNavigationRef.current = true;
    };

    document.addEventListener('click', confirmLinkNavigation, true);
    return () => document.removeEventListener('click', confirmLinkNavigation, true);
  }, [permissionChangeSummary.hasChanges]);

  useEffect(() => {
    if (permissions.length > 0) {
      groupPermissions();
    }
  }, [permissions]);

  async function fetchRoleData() {
    try {
      // 取得角色資料
      const roleResponse = await fetch(`/api/roles/${roleId}`, { cache: 'no-store' });
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

      if (canViewPermissions) {
        // 取得權限資料
        const permResponse = await fetch(`/api/roles/${roleId}/permissions`, { cache: 'no-store' });
        const permData = await permResponse.json();

        if (permResponse.ok) {
          const loadedPermissions: PermissionWithGrant[] = permData.permissions || [];
          setPermissions(loadedPermissions);
          setSavedPermissionIds(loadedPermissions.filter(permission => permission.granted).map(permission => permission.id));
          setPermissionConflict(null);
          setShowPermissionChanges(false);
        }
      }
    } catch (err) {
      setError('網路錯誤，請稍後再試');
    } finally {
      setLoading(false);
    }
  }

  function groupPermissions() {
    // 中文 module 值 → 英文 module 值 的映射
    // （navbar migration 遺留問題：部分權限的 module 欄位是中文）
    const MODULE_NORMALIZE: Record<string, string> = {
      '任務管理': 'task',
      '門市管理': 'store',
      '人事管理': 'employee',
      '活動管理': 'activity',
      '盤點管理': 'inventory',
      '每月狀態': 'monthly',
      '每月人員狀態': 'monthly',
      monthly_status: 'monthly',
      '系統': 'user',
      '督導巡店': 'inspection',
      '業績管理': 'performance',
      '組織管理': 'organization',
    };

    const groups = new Map<string, PermissionWithGrant[]>();

    permissions.forEach(perm => {
      // 統一為英文 module key
      const normalizedModule = MODULE_NORMALIZE[perm.module] || perm.module;
      if (!groups.has(normalizedModule)) {
        groups.set(normalizedModule, []);
      }
      groups.get(normalizedModule)!.push(perm);
    });

    const result: PermissionGroup[] = Array.from(groups.entries())
      .map(([module, perms]) => ({
        module,
        permissions: perms.sort((a, b) => {
          if (a.feature !== b.feature) {
            return (FEATURE_NAMES[a.feature] || a.feature).localeCompare(
              FEATURE_NAMES[b.feature] || b.feature,
              'zh-TW'
            );
          }
          return a.action.localeCompare(b.action);
        })
      }))
      .sort((a, b) => (MODULE_NAMES[a.module] || a.module).localeCompare(
        MODULE_NAMES[b.module] || b.module,
        'zh-TW'
      ));

    setGroupedPermissions(result);
  }

  function togglePermission(permissionId: string) {
    const target = permissions.find(permission => permission.id === permissionId);
    if (target && !target.granted && isHighImpactPermission(target)) {
      const actionName = ACTION_NAMES[target.action] || target.action;
      if (!window.confirm(`「${actionName}」屬於進階權限，可能影響既有資料或流程，確定要開啟嗎？`)) return;
    }
    setPermissions(prev =>
      prev.map(p =>
        p.id === permissionId ? { ...p, granted: !p.granted } : p
      )
    );
  }

  function setFeaturePermissionMode(
    featurePermissions: PermissionWithGrant[],
    mode: 'view' | 'daily' | 'clear'
  ) {
    const featureIds = new Set(featurePermissions.map(permission => permission.id));
    const basicViewIds = getBasicViewPermissionIds(featurePermissions);
    const dailyPermissionIds = getDailyPermissionIds(featurePermissions);
    setPermissions(current => current.map(permission => {
      if (!featureIds.has(permission.id)) return permission;
      if (mode === 'clear') return { ...permission, granted: false };
      if (mode === 'daily') return { ...permission, granted: dailyPermissionIds.has(permission.id) };
      return { ...permission, granted: basicViewIds.has(permission.id) };
    }));
  }

  function togglePermissionModule(module: string) {
    setExpandedPermissionModules(current => {
      const next = new Set(current);
      if (next.has(module)) next.delete(module);
      else next.add(module);
      return next;
    });
  }

  function togglePermissionFeature(module: string, feature: string) {
    const key = `${module}:${feature}`;
    setExpandedPermissionFeatures(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function expandAllVisiblePermissionGroups() {
    setExpandedPermissionModules(new Set(visiblePermissionGroups.map(group => group.module)));
  }

  function collapseAllPermissionGroups() {
    setExpandedPermissionModules(new Set());
    setExpandedPermissionFeatures(new Set());
  }

  async function handleSavePermissions() {
    if (!canAssignPermissions) {
      alert('您沒有權限分配角色權限');
      return;
    }

    setSaving(true);
    setPermissionConflict(null);
    try {
      const grantedPermissionIds = permissions
        .filter(p => p.granted)
        .map(p => p.id);

      const response = await fetch(`/api/roles/${roleId}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permissionIds: grantedPermissionIds,
          expectedPermissionIds: savedPermissionIds,
        })
      });

      const data = await response.json();

      if (response.ok) {
        alert('權限已儲存');
        await fetchRoleData();
      } else {
        if (response.status === 409) {
          setPermissionConflict(data.error || '權限已被其他管理者更新');
          return;
        }
        alert(data.error || '儲存失敗');
      }
    } catch (err) {
      alert('網路錯誤');
    } finally {
      setSaving(false);
    }
  }

  function discardPermissionChanges() {
    const savedIds = new Set(savedPermissionIds);
    setPermissions(current => current.map(permission => ({
      ...permission,
      granted: savedIds.has(permission.id),
    })));
    setShowPermissionChanges(false);
  }

  async function reloadPermissionsAfterConflict() {
    if (!window.confirm('重新載入會放棄目前尚未儲存的勾選，確定要繼續嗎？')) return;
    await fetchRoleData();
  }

  function switchRoleTab(nextTab: 'permissions' | 'users') {
    if (nextTab === activeTab) return;
    if (hasUnsavedPermissionChanges && !window.confirm('權限變更尚未儲存，確定要切換分頁嗎？')) return;
    if (hasUnsavedPermissionChanges) discardPermissionChanges();
    setActiveTab(nextTab);
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
    if (activeTab === 'users' && canViewUsers) {
      fetchUsers();
    }
  }, [activeTab, canViewUsers]);

  async function fetchUsers() {
    setLoadingUsers(true);
    try {
      const response = await fetch(`/api/roles/${roleId}/users`, { cache: 'no-store' });
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
  const hasUnsavedPermissionChanges = permissionChangeSummary.hasChanges;
  const normalizedPermissionSearch = permissionSearch.trim().toLowerCase();
  const savedPermissionIdSet = new Set(savedPermissionIds);
  const visiblePermissionGroups = groupedPermissions
    .map(group => ({
      ...group,
      permissions: group.permissions.filter(permission => {
            if (permissionView === 'granted' && !permission.granted) return false;
            if (permissionView === 'changed' && permission.granted === savedPermissionIdSet.has(permission.id)) return false;
            if (permissionView === 'advanced' && !isHighImpactPermission(permission)) return false;
            if (!normalizedPermissionSearch) return true;
            const moduleName = MODULE_NAMES[group.module] || group.module;
            const featureName = FEATURE_NAMES[permission.feature] || permission.feature;
            return [
              moduleName,
              featureName,
              permission.code,
              permission.description || '',
              ACTION_NAMES[permission.action] || permission.action,
            ].some(value => value.toLowerCase().includes(normalizedPermissionSearch));
          }),
    }))
    .filter(group => group.permissions.length > 0);
  const getProfileRoleLabel = (role: UserWithRole['profile_role']) => {
    if (role === 'admin') return '管理員';
    if (role === 'manager') return '主管';
    return '成員';
  };

  return (
    <div>
      {/* 頁首 */}
      <div className="mb-8">
        <Link href="/admin/roles" className="text-blue-600 hover:underline mb-4 inline-block">
          ← 返回角色列表
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">編輯角色</h1>
        {(!canEdit || !canAssignPermissions) && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            <p className="font-medium">目前帳號缺少部分角色管理權限</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {!canEdit && (
                <code className="rounded bg-white px-2 py-1 text-xs text-amber-900">
                  role.role.edit
                </code>
              )}
              {!canViewPermissions && (
                <code className="rounded bg-white px-2 py-1 text-xs text-amber-900">
                  role.permission.view
                </code>
              )}
              {!canAssignPermissions && (
                <code className="rounded bg-white px-2 py-1 text-xs text-amber-900">
                  role.permission.assign
                </code>
              )}
              {!canViewUsers && (
                <code className="rounded bg-white px-2 py-1 text-xs text-amber-900">
                  role.user_role.view
                </code>
              )}
            </div>
          </div>
        )}
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
              onClick={() => switchRoleTab('permissions')}
              disabled={!canViewPermissions}
              className={`px-6 py-3 font-medium ${
                activeTab === 'permissions'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : canViewPermissions
                    ? 'text-gray-500 hover:text-gray-700'
                    : 'cursor-not-allowed text-gray-300'
              }`}
            >
              權限設定
            </button>
            <button
              onClick={() => switchRoleTab('users')}
              disabled={!canViewUsers}
              className={`px-6 py-3 font-medium ${
                activeTab === 'users'
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : canViewUsers
                    ? 'text-gray-500 hover:text-gray-700'
                    : 'cursor-not-allowed text-gray-300'
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
        {!canViewPermissions ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            目前帳號缺少 <code className="rounded bg-white px-2 py-1">role.permission.view</code>，無法查看角色權限清單。
          </div>
        ) : (
        <>
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-xl font-semibold">權限設定</h2>
            <p className="text-sm text-gray-500 mt-1">
              已授予 {grantedCount} / {permissions.length} 個權限
              {hasUnsavedPermissionChanges && <span className="ml-2 font-medium text-amber-600">尚未儲存</span>}
            </p>
          </div>
        </div>

        {permissionConflict && (
          <div className="mb-5 flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600" />
              <div>
                <p className="text-sm font-semibold text-amber-900">權限已被其他管理者更新</p>
                <p className="mt-0.5 text-sm text-amber-800">{permissionConflict}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={reloadPermissionsAfterConflict}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-amber-400 bg-white px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100"
            >
              <RefreshCw size={16} />
              重新載入最新權限
            </button>
          </div>
        )}

        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <input
            type="search"
            value={permissionSearch}
            onChange={event => setPermissionSearch(event.target.value)}
            placeholder="搜尋功能或權限"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 lg:max-w-sm"
          />
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex max-w-full flex-wrap rounded-md border border-gray-300 bg-gray-50 p-1" role="group" aria-label="權限顯示範圍">
              <button
                type="button"
                onClick={() => setPermissionView('all')}
                className={`rounded px-3 py-1.5 text-sm font-medium ${permissionView === 'all' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              >
                全部權限
              </button>
              <button
                type="button"
                onClick={() => setPermissionView('granted')}
                className={`rounded px-3 py-1.5 text-sm font-medium ${permissionView === 'granted' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              >
                只看已開啟 ({grantedCount})
              </button>
              <button
                type="button"
                onClick={() => setPermissionView('changed')}
                className={`rounded px-3 py-1.5 text-sm font-medium ${permissionView === 'changed' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              >
                本次變更 ({permissionChangeSummary.enabled + permissionChangeSummary.disabled})
              </button>
              <button
                type="button"
                onClick={() => setPermissionView('advanced')}
                className={`rounded px-3 py-1.5 text-sm font-medium ${permissionView === 'advanced' ? 'bg-white text-red-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              >
                進階權限
              </button>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={showTechnicalPermissionCodes}
                onChange={event => setShowTechnicalPermissionCodes(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              顯示技術代碼
            </label>
            <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={expandAllVisiblePermissionGroups}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                title="展開目前顯示的權限分類"
              >
                <ChevronsDown size={16} />
                展開分類
              </button>
              <button
                type="button"
                onClick={collapseAllPermissionGroups}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                title="收合全部權限分類"
              >
                <ChevronsUp size={16} />
                全部收合
              </button>
            </div>
          {permissionSearch && (
            <span className="text-sm text-gray-500">
              找到 {visiblePermissionGroups.reduce((count, group) => count + group.permissions.length, 0)} 個權限
            </span>
          )}
          </div>
        </div>

        {/* 權限矩陣 */}
        <div className="space-y-6">
          {visiblePermissionGroups.map(group => {
            const completeGroup = groupedPermissions.find(item => item.module === group.module) || group;
            const moduleGranted = completeGroup.permissions.filter(p => p.granted).length;
            const moduleTotal = completeGroup.permissions.length;
            const isExpanded = Boolean(normalizedPermissionSearch) || expandedPermissionModules.has(group.module);
            const featureGroups = Array.from(
              group.permissions.reduce((groups, permission) => {
                const featurePermissions = groups.get(permission.feature) || [];
                featurePermissions.push(permission);
                groups.set(permission.feature, featurePermissions);
                return groups;
              }, new Map<string, PermissionWithGrant[]>())
            );

            return (
              <div key={group.module} className="border rounded-lg overflow-hidden">
                {/* 模組標題 */}
                <div className="bg-gray-50 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => togglePermissionModule(group.module)}
                    aria-expanded={isExpanded}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <ChevronDown
                      size={18}
                      className={`shrink-0 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    />
                    <h3 className="font-semibold text-gray-900">
                      {MODULE_NAMES[group.module] || group.module}
                    </h3>
                    <span className="text-sm text-gray-500">
                      已開啟 {moduleGranted}/{moduleTotal}
                    </span>
                    <span className="hidden text-xs text-gray-400 sm:inline">
                      {isExpanded ? '收合' : '展開'}
                    </span>
                  </button>
                </div>

                {/* 權限列表 */}
                {isExpanded && <div className="divide-y divide-gray-200 border-t border-gray-200">
                  {featureGroups.map(([feature, featurePermissions]) => {
                    const completeFeaturePermissions = completeGroup.permissions.filter(permission => permission.feature === feature);
                    const featureGranted = completeFeaturePermissions.filter(permission => permission.granted).length;
                    const basicViewPermissionIds = getBasicViewPermissionIds(completeFeaturePermissions);
                    const featureViewPermissions = completeFeaturePermissions.filter(permission => basicViewPermissionIds.has(permission.id));
                    const dailyPermissionIds = getDailyPermissionIds(completeFeaturePermissions);
                    const isViewOnly = featureViewPermissions.length > 0
                      && completeFeaturePermissions.every(permission => permission.granted === basicViewPermissionIds.has(permission.id));
                    const hasDailyPermissions = dailyPermissionIds.size > basicViewPermissionIds.size;
                    const isDailyUse = hasDailyPermissions
                      && completeFeaturePermissions.every(permission => permission.granted === dailyPermissionIds.has(permission.id));
                    const grantedAdvancedCount = completeFeaturePermissions.filter(permission => permission.granted && isHighImpactPermission(permission)).length;
                    const featureStatus = featureGranted === 0
                      ? '未開啟'
                      : isViewOnly
                        ? '基本查看'
                        : isDailyUse
                          ? '日常處理'
                          : `自訂 ${featureGranted}/${completeFeaturePermissions.length}`;
                    const featureKey = `${group.module}:${feature}`;
                    const isFeatureExpanded = Boolean(normalizedPermissionSearch) || expandedPermissionFeatures.has(featureKey);
                    return (
                    <section key={feature}>
                      <div className="flex flex-col gap-2 bg-white px-4 py-2.5 md:flex-row md:items-center md:justify-between">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">
                            {FEATURE_NAMES[feature] || feature}
                          </span>
                          <span className={`text-xs font-medium ${featureGranted === 0 ? 'text-gray-400' : 'text-blue-700'}`}>
                            {featureStatus}
                          </span>
                          {grantedAdvancedCount > 0 && (
                            <span className="text-xs font-medium text-red-600">
                              含 {grantedAdvancedCount} 項進階權限
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:ml-3 md:shrink-0">
                          {canAssignPermissions && (
                          <div className="inline-flex w-fit max-w-full flex-wrap rounded-md border border-gray-200 bg-gray-50 p-0.5" role="group" aria-label={`${FEATURE_NAMES[feature] || feature} 授權模式`}>
                            {featureViewPermissions.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setFeaturePermissionMode(completeFeaturePermissions, 'view')}
                                className={`rounded px-2 py-1 text-xs font-medium ${isViewOnly ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                              >
                                基本查看
                              </button>
                            )}
                            {hasDailyPermissions && (
                              <button
                                type="button"
                                onClick={() => setFeaturePermissionMode(completeFeaturePermissions, 'daily')}
                                className={`rounded px-2 py-1 text-xs font-medium ${isDailyUse ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                              >
                                日常處理
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setFeaturePermissionMode(completeFeaturePermissions, 'clear')}
                              className={`rounded px-2 py-1 text-xs font-medium ${featureGranted === 0 ? 'bg-white text-gray-700 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                            >
                              清除
                            </button>
                          </div>
                          )}
                          <button
                            type="button"
                            onClick={() => togglePermissionFeature(group.module, feature)}
                            aria-expanded={isFeatureExpanded}
                            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-medium ${isFeatureExpanded ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}
                            title={`${isFeatureExpanded ? '收合' : '展開'}${FEATURE_NAMES[feature] || feature}的個別權限`}
                          >
                            <SlidersHorizontal size={14} />
                            個別設定
                          </button>
                        </div>
                      </div>
                      {isFeatureExpanded && <div className="divide-y divide-gray-100 border-t border-gray-100 bg-gray-50/40">
                  {featurePermissions.map(perm => (
                    <label
                      key={perm.id}
                      className={`flex items-start px-4 py-3 pl-7 hover:bg-blue-50/40 cursor-pointer ${
                        !canAssignPermissions ? 'cursor-not-allowed opacity-60' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={perm.granted}
                        onChange={() => togglePermission(perm.id)}
                        disabled={!canAssignPermissions}
                        className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                      />
                      <div className="ml-3 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-sm font-medium text-gray-800">
                            [{ACTION_NAMES[perm.action] || perm.action}]
                          </span>
                          {isHighImpactPermission(perm) && (
                            <span className="text-xs font-medium text-red-600">進階權限</span>
                          )}
                          {showTechnicalPermissionCodes && (
                            <code className="break-all text-xs text-gray-400">
                              {perm.code}
                            </code>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mt-1">
                          {perm.description}
                        </p>
                      </div>
                    </label>
                  ))}
                      </div>}
                    </section>
                    );
                  })}
                </div>}
              </div>
            );
          })}
          {visiblePermissionGroups.length === 0 && (
            <div className="rounded-md border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500">
              找不到符合的權限
            </div>
          )}
        </div>
        {canAssignPermissions && hasUnsavedPermissionChanges && (
          <div className="sticky bottom-4 z-20 mt-6 max-h-[60vh] overflow-y-auto rounded-md border border-amber-200 bg-white px-4 py-3 shadow-lg">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">權限變更尚未儲存</p>
              <p className="text-xs text-gray-500">
                {permissionChangeSummary.enabled > 0 && `開啟 ${permissionChangeSummary.enabled} 項`}
                {permissionChangeSummary.enabled > 0 && permissionChangeSummary.disabled > 0 && '、'}
                {permissionChangeSummary.disabled > 0 && `關閉 ${permissionChangeSummary.disabled} 項`}
                ，儲存後才會套用到這個角色。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowPermissionChanges(current => !current)}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:flex-none"
              >
                <ListChecks size={16} />
                {showPermissionChanges ? '收合明細' : '查看變更'}
              </button>
              <button
                type="button"
                onClick={discardPermissionChanges}
                disabled={saving}
                className="flex-1 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 sm:flex-none"
              >
                放棄變更
              </button>
              <button
                type="button"
                onClick={handleSavePermissions}
                disabled={saving}
                className="flex-1 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 sm:flex-none"
              >
                {saving ? '儲存中...' : '儲存權限'}
              </button>
            </div>
            </div>
            {showPermissionChanges && (
              <div className="mt-3 grid gap-4 border-t border-gray-200 pt-3 md:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-semibold text-emerald-700">將開啟（{permissionChangeSummary.enabled}）</p>
                  {permissionChangeSummary.enabledPermissions.length === 0 ? (
                    <p className="text-xs text-gray-400">無</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {permissionChangeSummary.enabledPermissions.map(permission => (
                        <li key={permission.id} className="text-xs text-gray-700">
                          <span className="font-medium">{FEATURE_NAMES[permission.feature] || permission.feature}</span>
                          <span className="text-gray-500"> · {ACTION_NAMES[permission.action] || permission.action}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold text-red-700">將關閉（{permissionChangeSummary.disabled}）</p>
                  {permissionChangeSummary.disabledPermissions.length === 0 ? (
                    <p className="text-xs text-gray-400">無</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {permissionChangeSummary.disabledPermissions.map(permission => (
                        <li key={permission.id} className="text-xs text-gray-700">
                          <span className="font-medium">{FEATURE_NAMES[permission.feature] || permission.feature}</span>
                          <span className="text-gray-500"> · {ACTION_NAMES[permission.action] || permission.action}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        </>
        )}
      </div>
      )}

      {/* 使用者管理分頁 */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">使用者管理</h2>
            {canAssignUsers && (
              <button
                onClick={() => setShowAddUserModal(true)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                + 新增使用者
              </button>
            )}
          </div>

          {!canViewUsers ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              目前帳號缺少 <code className="rounded bg-white px-2 py-1">role.user_role.view</code>，無法查看此角色的使用者。
            </div>
          ) : loadingUsers ? (
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
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">部門</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">職稱</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">帳號身分</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">角色狀態</th>
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
                      <td className="px-4 py-3 text-sm">{user.department || '-'}</td>
                      <td className="px-4 py-3 text-sm">{user.job_title || '-'}</td>
                      <td className="px-4 py-3 text-sm">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          user.profile_role === 'admin'
                            ? 'bg-purple-100 text-purple-800'
                            : user.profile_role === 'manager'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-800'
                        }`}>
                          {getProfileRoleLabel(user.profile_role)}
                        </span>
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
                        {canRevokeUsers ? (
                          <button
                            onClick={() => handleRemoveUser(user.id, user.name || user.email)}
                            className="text-red-600 hover:text-red-700"
                          >
                            移除
                          </button>
                        ) : (
                          <span className="text-gray-400">無操作權限</span>
                        )}
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
      {showAddUserModal && canAssignUsers && (
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
