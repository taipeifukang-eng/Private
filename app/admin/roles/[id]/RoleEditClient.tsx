'use client';

// ============================================
// 角色編輯 Client Component
// ============================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronsDown, ChevronsUp, ListChecks, RefreshCw, Search, SlidersHorizontal, UserMinus, X, XCircle } from 'lucide-react';
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

function getRoleAssignmentStatus(user: UserWithRole): 'current' | 'inactive' | 'expired' {
  if (!user.is_active) return 'inactive';
  if (user.expires_at && new Date(user.expires_at).getTime() <= Date.now()) return 'expired';
  return 'current';
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

const BROAD_SCOPE_PERMISSION_ACTIONS = new Set(['view_all']);

const VIEW_PERMISSION_ACTIONS = new Set([
  'access',
  'view',
  'view_own',
  'view_own_store',
  'view_all',
  'view_inactive',
]);

const EXCLUSIVE_VIEW_SCOPE_ACTIONS = new Set([
  'view',
  'view_own',
  'view_own_store',
  'view_all',
]);

function isHighImpactPermission(permission: PermissionWithGrant) {
  return HIGH_IMPACT_PERMISSION_ACTIONS.has(permission.action);
}

function isSensitivePermission(permission: PermissionWithGrant) {
  return isHighImpactPermission(permission) || BROAD_SCOPE_PERMISSION_ACTIONS.has(permission.action);
}

function getSensitivePermissionLabel(permission: PermissionWithGrant) {
  return BROAD_SCOPE_PERMISSION_ACTIONS.has(permission.action) ? '範圍較廣' : '進階權限';
}

function getPermissionActionLabel(permission: PermissionWithGrant) {
  if (permission.code === 'monthly.status.view_own') return '查看管理門市';
  return ACTION_NAMES[permission.action] || permission.action;
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

function getBasicViewLabel(featurePermissions: PermissionWithGrant[]) {
  const basicViewIds = getBasicViewPermissionIds(featurePermissions);
  const scopedPermission = featurePermissions.find(permission => (
    basicViewIds.has(permission.id) && permission.action !== 'access'
  ));
  if (!scopedPermission) return '進入功能';
  return getPermissionActionLabel(scopedPermission);
}

function getPermissionSection(permission: PermissionWithGrant) {
  if (isHighImpactPermission(permission)) return 'advanced';
  if (EXCLUSIVE_VIEW_SCOPE_ACTIONS.has(permission.action)) return 'scope';
  if (permission.action === 'access') return 'entry';
  if (permission.action === 'view_inactive') return 'additional';
  return 'daily';
}

const PERMISSION_SECTION_LABELS = {
  entry: '進入功能',
  scope: '資料查看範圍（擇一）',
  additional: '附加查看',
  daily: '日常操作',
  advanced: '進階操作',
} as const;

function trapDialogFocus(event: KeyboardEvent, dialog: HTMLDivElement | null) {
  if (event.key !== 'Tab' || !dialog) return;
  const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
  ));
  if (focusableElements.length === 0) return;
  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function grantPermissionWithFeatureAccess(
  current: PermissionWithGrant[],
  target: PermissionWithGrant
) {
  return current.map(permission => {
    const sameFeature = permission.module === target.module && permission.feature === target.feature;
    if (!sameFeature) return permission;
    if (target.action !== 'access' && permission.action === 'access') {
      return { ...permission, granted: true };
    }
    if (EXCLUSIVE_VIEW_SCOPE_ACTIONS.has(target.action) && EXCLUSIVE_VIEW_SCOPE_ACTIONS.has(permission.action)) {
      return { ...permission, granted: permission.id === target.id };
    }
    return permission.id === target.id ? { ...permission, granted: true } : permission;
  });
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
  const [userListError, setUserListError] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState<'all' | 'current' | 'inactive'>('all');
  const [activeRoleUserCount, setActiveRoleUserCount] = useState<number | null>(null);
  const [roleUserImpactError, setRoleUserImpactError] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [employeeCodesInput, setEmployeeCodesInput] = useState('');
  const [assigningUser, setAssigningUser] = useState(false);
  const [assignUserError, setAssignUserError] = useState<string | null>(null);
  const [userManagementFeedback, setUserManagementFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pendingRemoveUser, setPendingRemoveUser] = useState<{ id: string; name: string } | null>(null);
  const [removingUser, setRemovingUser] = useState(false);
  const [permissionSearch, setPermissionSearch] = useState('');
  const [permissionView, setPermissionView] = useState<'all' | 'granted' | 'changed' | 'advanced'>('all');
  const [showTechnicalPermissionCodes, setShowTechnicalPermissionCodes] = useState(false);
  const [expandedPermissionModules, setExpandedPermissionModules] = useState<Set<string>>(new Set());
  const [expandedPermissionFeatures, setExpandedPermissionFeatures] = useState<Set<string>>(new Set());
  const [savedPermissionIds, setSavedPermissionIds] = useState<string[]>([]);
  const [permissionConflict, setPermissionConflict] = useState<string | null>(null);
  const [permissionListError, setPermissionListError] = useState<string | null>(null);
  const [permissionListLoading, setPermissionListLoading] = useState(false);
  const [permissionSaveFeedback, setPermissionSaveFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [pendingHighImpactPermission, setPendingHighImpactPermission] = useState<PermissionWithGrant | null>(null);
  const [showPermissionChanges, setShowPermissionChanges] = useState(false);
  const allowUnsavedNavigationRef = useRef(false);
  const highImpactConfirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const permissionChangesCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const permissionChangesTriggerButtonRef = useRef<HTMLButtonElement | null>(null);
  const sensitivePermissionTriggerRef = useRef<HTMLElement | null>(null);
  const highImpactDialogRef = useRef<HTMLDivElement | null>(null);
  const permissionChangesDialogRef = useRef<HTMLDivElement | null>(null);
  const removeUserDialogRef = useRef<HTMLDivElement | null>(null);
  const removeUserConfirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const removeUserTriggerRef = useRef<HTMLElement | null>(null);

  const permissionChangeSummary = useMemo(() => {
    const savedIds = new Set(savedPermissionIds);
    const enabledPermissions = permissions.filter(permission => permission.granted && !savedIds.has(permission.id));
    const disabledPermissions = permissions.filter(permission => !permission.granted && savedIds.has(permission.id));
    return {
      enabled: enabledPermissions.length,
      disabled: disabledPermissions.length,
      enabledSensitive: enabledPermissions.filter(isSensitivePermission).length,
      enabledPermissions,
      disabledPermissions,
      hasChanges: enabledPermissions.length > 0 || disabledPermissions.length > 0,
    };
  }, [permissions, savedPermissionIds]);

  const conflictingViewScopes = useMemo(() => {
    const byFeature = new Map<string, PermissionWithGrant[]>();
    permissions.forEach(permission => {
      if (!permission.granted || !EXCLUSIVE_VIEW_SCOPE_ACTIONS.has(permission.action)) return;
      const key = `${permission.module}:${permission.feature}`;
      const current = byFeature.get(key) || [];
      current.push(permission);
      byFeature.set(key, current);
    });
    return Array.from(byFeature.entries())
      .filter(([, scopes]) => scopes.length > 1)
      .map(([key, scopes]) => ({ key, scopes }));
  }, [permissions]);

  const filteredRoleUsers = useMemo(() => {
    const keyword = userSearch.trim().toLowerCase();
    return users.filter(user => {
      const status = getRoleAssignmentStatus(user);
      if (userStatusFilter === 'current' && status !== 'current') return false;
      if (userStatusFilter === 'inactive' && status === 'current') return false;
      if (!keyword) return true;
      return [user.name, user.employee_code, user.email, user.department, user.job_title]
        .some(value => value?.toLowerCase().includes(keyword));
    });
  }, [users, userSearch, userStatusFilter]);

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

  useEffect(() => {
    const auditView = permissionView === 'changed' || permissionView === 'advanced';
    if (!auditView) {
      setExpandedPermissionModules(new Set());
      setExpandedPermissionFeatures(new Set());
      return;
    }

    setExpandedPermissionModules(new Set(groupedPermissions.map(group => group.module)));
    setExpandedPermissionFeatures(new Set(groupedPermissions.flatMap(group => (
      Array.from(new Set(group.permissions.map(permission => permission.feature)))
        .map(feature => `${group.module}:${feature}`)
    ))));
  }, [permissionView, groupedPermissions]);

  useEffect(() => {
    if (!permissionSaveFeedback || permissionSaveFeedback.type !== 'success') return;
    const timeoutId = window.setTimeout(() => setPermissionSaveFeedback(null), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [permissionSaveFeedback]);

  useEffect(() => {
    if (!userManagementFeedback || userManagementFeedback.type !== 'success') return;
    const timeoutId = window.setTimeout(() => setUserManagementFeedback(null), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [userManagementFeedback]);

  useEffect(() => {
    if (!pendingHighImpactPermission) return;
    highImpactConfirmButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSensitivePermissionDialog();
      else trapDialogFocus(event, highImpactDialogRef.current);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [pendingHighImpactPermission]);

  useEffect(() => {
    if (!showPermissionChanges) return;
    permissionChangesCloseButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePermissionChangesDialog();
      else trapDialogFocus(event, permissionChangesDialogRef.current);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [showPermissionChanges]);

  useEffect(() => {
    if (!showPermissionChanges && !pendingHighImpactPermission) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showPermissionChanges, pendingHighImpactPermission]);

  useEffect(() => {
    if (!pendingRemoveUser) return;
    removeUserConfirmButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !removingUser) closeRemoveUserDialog();
      else trapDialogFocus(event, removeUserDialogRef.current);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [pendingRemoveUser, removingUser]);

  useEffect(() => {
    if (!pendingRemoveUser) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [pendingRemoveUser]);

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
        setPermissionListLoading(true);
        const permResponse = await fetch(`/api/roles/${roleId}/permissions`, { cache: 'no-store' });
        const permData = await permResponse.json();

        if (permResponse.ok) {
          const loadedPermissions: PermissionWithGrant[] = permData.permissions || [];
          setPermissions(loadedPermissions);
          setSavedPermissionIds(loadedPermissions.filter(permission => permission.granted).map(permission => permission.id));
          setPermissionConflict(null);
          setShowPermissionChanges(false);
          setPermissionListError(null);
        } else {
          setPermissions([]);
          setSavedPermissionIds([]);
          setPermissionListError(permData.error || '權限清單載入失敗，請重新載入。');
        }
      }
    } catch (err) {
      setError('網路錯誤，請稍後再試');
    } finally {
      setLoading(false);
      setPermissionListLoading(false);
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
    if (!target) return;
    if (EXCLUSIVE_VIEW_SCOPE_ACTIONS.has(target.action) && target.granted) {
      setPermissions(current => grantPermissionWithFeatureAccess(current, target));
      return;
    }
    if (target && !target.granted && isSensitivePermission(target)) {
      sensitivePermissionTriggerRef.current = document.activeElement as HTMLElement | null;
      setPendingHighImpactPermission(target);
      return;
    }
    if (!target.granted) {
      setPermissions(current => grantPermissionWithFeatureAccess(current, target));
      return;
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

  function confirmHighImpactPermission() {
    if (!pendingHighImpactPermission) return;
    const target = pendingHighImpactPermission;
    setPermissions(current => grantPermissionWithFeatureAccess(current, target));
    closeSensitivePermissionDialog();
  }

  function closeSensitivePermissionDialog() {
    setPendingHighImpactPermission(null);
    window.requestAnimationFrame(() => sensitivePermissionTriggerRef.current?.focus());
  }

  function closePermissionChangesDialog() {
    setShowPermissionChanges(false);
    window.requestAnimationFrame(() => permissionChangesTriggerButtonRef.current?.focus());
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
      setPermissionSaveFeedback({ type: 'error', message: '目前帳號沒有分配角色權限的能力。' });
      return;
    }

    setSaving(true);
    setPermissionConflict(null);
    setPermissionSaveFeedback(null);
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
        await fetchRoleData();
        setPermissionSaveFeedback({ type: 'success', message: `「${role?.name || '此角色'}」的權限已儲存。` });
      } else {
        if (response.status === 409) {
          setPermissionConflict(data.error || '權限已被其他管理者更新');
          return;
        }
        setPermissionSaveFeedback({ type: 'error', message: data.error || '權限儲存失敗，請稍後再試。' });
      }
    } catch (err) {
      setPermissionSaveFeedback({ type: 'error', message: '網路連線異常，權限尚未儲存。' });
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

  useEffect(() => {
    if (canViewUsers) void fetchRoleUserImpact();
  }, [canViewUsers, roleId]);

  async function fetchRoleUserImpact() {
    try {
      const response = await fetch(`/api/roles/${roleId}/users?summary=1`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '取得影響人數失敗');
      setActiveRoleUserCount(data.active_user_count || 0);
      setRoleUserImpactError(false);
    } catch (error) {
      console.error('取得角色影響人數失敗:', error);
      setActiveRoleUserCount(null);
      setRoleUserImpactError(true);
    }
  }

  async function fetchUsers() {
    setLoadingUsers(true);
    setUserListError(null);
    try {
      const response = await fetch(`/api/roles/${roleId}/users`, { cache: 'no-store' });
      const data = await response.json();

      if (response.ok) {
        setUsers(data.users || []);
      } else {
        setUsers([]);
        setUserListError(data.error || '取得角色使用者失敗，請重新載入。');
      }
    } catch (err) {
      console.error('網路錯誤:', err);
      setUsers([]);
      setUserListError('網路連線異常，無法取得角色使用者。');
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
      setAssignUserError('請輸入至少一個員工編號。');
      return;
    }

    setAssigningUser(true);
    setAssignUserError(null);
    try {
      const response = await fetch(`/api/roles/${roleId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_codes: codes })
      });

      const data = await response.json();

      if (response.ok) {
        setUserManagementFeedback({ type: 'success', message: data.details || data.message || '角色指派完成。' });
        setShowAddUserModal(false);
        setEmployeeCodesInput('');
        fetchUsers(); // 重新載入使用者列表
        fetchRoleUserImpact();
      } else {
        setAssignUserError(data.error || '角色指派失敗，請檢查員工編號。');
      }
    } catch (err) {
      setAssignUserError('網路連線異常，角色尚未指派。');
    } finally {
      setAssigningUser(false);
    }
  }

  function requestRemoveUser(userId: string, userName: string) {
    removeUserTriggerRef.current = document.activeElement as HTMLElement | null;
    setPendingRemoveUser({ id: userId, name: userName });
  }

  function closeRemoveUserDialog() {
    if (removingUser) return;
    setPendingRemoveUser(null);
    window.requestAnimationFrame(() => removeUserTriggerRef.current?.focus());
  }

  async function confirmRemoveUser() {
    if (!pendingRemoveUser) return;
    setRemovingUser(true);
    setUserManagementFeedback(null);
    try {
      const response = await fetch(`/api/roles/${roleId}/users/${pendingRemoveUser.id}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (response.ok) {
        setUserManagementFeedback({ type: 'success', message: `已移除「${pendingRemoveUser.name}」的「${role?.name || '此角色'}」角色。` });
        setPendingRemoveUser(null);
        fetchUsers(); // 重新載入使用者列表
        fetchRoleUserImpact();
      } else {
        setUserManagementFeedback({ type: 'error', message: data.error || '角色移除失敗，請稍後再試。' });
        setPendingRemoveUser(null);
      }
    } catch (err) {
      setUserManagementFeedback({ type: 'error', message: '網路連線異常，角色尚未移除。' });
      setPendingRemoveUser(null);
    } finally {
      setRemovingUser(false);
    }
  }

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="flex h-64 items-center justify-center gap-3 text-sm text-gray-600">
        <RefreshCw size={20} className="animate-spin text-blue-600" />
        載入角色與權限設定
      </div>
    );
  }

  if (error || !role) {
    return (
      <div>
        <div className="rounded-md border border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <XCircle size={20} className="mt-0.5 shrink-0 text-red-600" />
            <div>
              <p className="font-semibold text-red-900">無法載入角色設定</p>
              <p className="mt-1 text-sm text-red-700">{error || '找不到這個角色。'}</p>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setError(null);
              void fetchRoleData();
            }}
            className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
          >
            <RefreshCw size={16} />
            重新載入
          </button>
          <Link href="/admin/roles" className="inline-flex items-center rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            返回角色列表
          </Link>
        </div>
      </div>
    );
  }

  const grantedCount = permissions.filter(p => p.granted).length;
  const hasUnsavedPermissionChanges = permissionChangeSummary.hasChanges;
  const normalizedPermissionSearch = permissionSearch.trim().toLowerCase();
  const canUseFeaturePresets = permissionView === 'all' && !normalizedPermissionSearch;
  const savedPermissionIdSet = new Set(savedPermissionIds);
  const visiblePermissionGroups = groupedPermissions
    .map(group => ({
      ...group,
      permissions: group.permissions.filter(permission => {
            if (permissionView === 'granted' && !permission.granted) return false;
            if (permissionView === 'changed' && permission.granted === savedPermissionIdSet.has(permission.id)) return false;
            if (permissionView === 'advanced' && !isSensitivePermission(permission)) return false;
            if (!normalizedPermissionSearch) return true;
            const moduleName = MODULE_NAMES[group.module] || group.module;
            const featureName = FEATURE_NAMES[permission.feature] || permission.feature;
            return [
              moduleName,
              featureName,
              permission.code,
              permission.description || '',
              getPermissionActionLabel(permission),
            ].some(value => value.toLowerCase().includes(normalizedPermissionSearch));
          }),
    }))
    .filter(group => group.permissions.length > 0);
  const emptyPermissionMessage = normalizedPermissionSearch
    ? '找不到符合搜尋條件的權限'
    : permissionView === 'changed'
      ? '目前沒有尚未儲存的權限變更'
      : permissionView === 'granted'
        ? '這個角色尚未開啟任何權限'
        : permissionView === 'advanced'
          ? '目前沒有可設定的敏感權限'
          : '目前沒有可設定的權限';
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
              {permissionListError ? '目前無法取得權限清單' : `已授予 ${grantedCount} / ${permissions.length} 個權限`}
              {!permissionListError && hasUnsavedPermissionChanges && <span className="ml-2 font-medium text-amber-600">尚未儲存</span>}
            </p>
            {!permissionListError && (
              <p className="mt-1 text-xs text-gray-500">
                此處只設定「{role.name}」；使用者同時擁有的其他角色仍會疊加。
              </p>
            )}
          </div>
        </div>

        {permissionListError && (
          <div className="mb-5 flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <XCircle size={20} className="mt-0.5 shrink-0 text-red-600" />
              <div>
                <p className="text-sm font-semibold text-red-900">權限清單載入失敗</p>
                <p className="mt-0.5 text-sm text-red-800">{permissionListError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={fetchRoleData}
              disabled={permissionListLoading}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100 disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw size={16} className={permissionListLoading ? 'animate-spin' : ''} />
              {permissionListLoading ? '重新載入中' : '重新載入'}
            </button>
          </div>
        )}

        {!permissionListError && permissionSaveFeedback && (
          <div
            role="status"
            aria-live="polite"
            className={`mb-5 flex items-center gap-2 rounded-md border px-4 py-3 text-sm font-medium ${
              permissionSaveFeedback.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            {permissionSaveFeedback.type === 'success' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
            {permissionSaveFeedback.message}
          </div>
        )}

        {!permissionListError && conflictingViewScopes.length > 0 && (
          <div className="mb-5 flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-semibold text-amber-900">發現重複的資料查看範圍</p>
              <p className="mt-0.5 text-sm text-amber-800">
                有 {conflictingViewScopes.length} 個功能同時開啟多個範圍。請展開個別設定並重新選擇一個範圍後儲存。
              </p>
            </div>
          </div>
        )}

        {!permissionListError && permissionConflict && (
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

        {!permissionListError && <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
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
                aria-pressed={permissionView === 'all'}
                className={`rounded px-3 py-1.5 text-sm font-medium ${permissionView === 'all' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              >
                全部權限
              </button>
              <button
                type="button"
                onClick={() => setPermissionView('granted')}
                aria-pressed={permissionView === 'granted'}
                className={`rounded px-3 py-1.5 text-sm font-medium ${permissionView === 'granted' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              >
                只看已開啟 ({grantedCount})
              </button>
              <button
                type="button"
                onClick={() => setPermissionView('changed')}
                aria-pressed={permissionView === 'changed'}
                className={`rounded px-3 py-1.5 text-sm font-medium ${permissionView === 'changed' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              >
                本次變更 ({permissionChangeSummary.enabled + permissionChangeSummary.disabled})
              </button>
              <button
                type="button"
                onClick={() => setPermissionView('advanced')}
                aria-pressed={permissionView === 'advanced'}
                className={`rounded px-3 py-1.5 text-sm font-medium ${permissionView === 'advanced' ? 'bg-white text-red-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
              >
                敏感權限
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
            {!normalizedPermissionSearch && <div className="inline-flex items-center gap-1">
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
            </div>}
          {permissionSearch && (
            <span className="text-sm text-gray-500">
              找到 {visiblePermissionGroups.reduce((count, group) => count + group.permissions.length, 0)} 個權限
            </span>
          )}
          </div>
        </div>}

        {/* 權限矩陣 */}
        {!permissionListError && <div className="space-y-6">
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
                    disabled={Boolean(normalizedPermissionSearch)}
                    aria-expanded={isExpanded}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
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
                    const basicViewLabel = getBasicViewLabel(completeFeaturePermissions);
                    const featureViewPermissions = completeFeaturePermissions.filter(permission => basicViewPermissionIds.has(permission.id));
                    const hasSensitiveBasicScope = featureViewPermissions.some(isSensitivePermission);
                    const dailyPermissionIds = getDailyPermissionIds(completeFeaturePermissions);
                    const isViewOnly = featureViewPermissions.length > 0
                      && completeFeaturePermissions.every(permission => permission.granted === basicViewPermissionIds.has(permission.id));
                    const hasDailyPermissions = dailyPermissionIds.size > basicViewPermissionIds.size;
                    const isDailyUse = hasDailyPermissions
                      && completeFeaturePermissions.every(permission => permission.granted === dailyPermissionIds.has(permission.id));
                    const grantedSensitiveCount = completeFeaturePermissions.filter(permission => permission.granted && isSensitivePermission(permission)).length;
                    const hasViewScopeConflict = completeFeaturePermissions
                      .filter(permission => permission.granted && EXCLUSIVE_VIEW_SCOPE_ACTIONS.has(permission.action))
                      .length > 1;
                    const hasGrantedDependentPermission = completeFeaturePermissions.some(permission => permission.granted && permission.action !== 'access');
                    const featureStatus = featureGranted === 0
                      ? '未開啟'
                      : hasViewScopeConflict
                        ? '範圍衝突'
                      : isViewOnly
                        ? basicViewLabel
                        : isDailyUse
                          ? `日常處理 · ${basicViewLabel}`
                          : `自訂 ${featureGranted}/${completeFeaturePermissions.length}`;
                    const featureKey = `${group.module}:${feature}`;
                    const isFeatureExpanded = Boolean(normalizedPermissionSearch) || expandedPermissionFeatures.has(featureKey);
                    const detailedPermissionSections = (['entry', 'scope', 'additional', 'daily', 'advanced'] as const)
                      .map(section => ({
                        section,
                        permissions: featurePermissions.filter(permission => getPermissionSection(permission) === section),
                      }))
                      .filter(section => section.permissions.length > 0);
                    return (
                    <section key={feature}>
                      <div className="flex flex-col gap-2 bg-white px-4 py-2.5 md:flex-row md:items-center md:justify-between">
                        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">
                            {FEATURE_NAMES[feature] || feature}
                          </span>
                          <span className={`text-xs font-medium ${featureGranted === 0 ? 'text-gray-400' : hasViewScopeConflict ? 'text-amber-700' : 'text-blue-700'}`}>
                            {featureStatus}
                          </span>
                          {grantedSensitiveCount > 0 && (
                            <span className="text-xs font-medium text-red-600">
                              含 {grantedSensitiveCount} 項敏感權限
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:ml-3 md:shrink-0">
                          {canAssignPermissions && canUseFeaturePresets && (
                          <div className="inline-flex w-fit max-w-full flex-wrap rounded-md border border-gray-200 bg-gray-50 p-0.5" role="group" aria-label={`${FEATURE_NAMES[feature] || feature} 授權模式`}>
                            {featureViewPermissions.length > 0 && !hasSensitiveBasicScope && (
                              <button
                                type="button"
                                onClick={() => setFeaturePermissionMode(completeFeaturePermissions, 'view')}
                                aria-pressed={isViewOnly}
                                className={`rounded px-2 py-1 text-xs font-medium ${isViewOnly ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                              >
                                {basicViewLabel}
                              </button>
                            )}
                            {hasDailyPermissions && !hasSensitiveBasicScope && (
                              <button
                                type="button"
                                onClick={() => setFeaturePermissionMode(completeFeaturePermissions, 'daily')}
                                aria-pressed={isDailyUse}
                                className={`rounded px-2 py-1 text-xs font-medium ${isDailyUse ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                              >
                                日常處理
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => setFeaturePermissionMode(completeFeaturePermissions, 'clear')}
                              aria-pressed={featureGranted === 0}
                              className={`rounded px-2 py-1 text-xs font-medium ${featureGranted === 0 ? 'bg-white text-gray-700 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                            >
                              清除
                            </button>
                          </div>
                          )}
                          {!normalizedPermissionSearch && <button
                            type="button"
                            onClick={() => togglePermissionFeature(group.module, feature)}
                            aria-expanded={isFeatureExpanded}
                            className={`inline-flex h-8 items-center justify-center gap-1.5 rounded-md border px-2.5 text-xs font-medium ${isFeatureExpanded ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}
                            title={`${isFeatureExpanded ? '收合' : '展開'}${FEATURE_NAMES[feature] || feature}的個別權限`}
                          >
                            <SlidersHorizontal size={14} />
                            個別設定
                          </button>}
                        </div>
                      </div>
                      {isFeatureExpanded && <div className="border-t border-gray-100 bg-gray-50/40">
                  {detailedPermissionSections.map(({ section, permissions: sectionPermissions }) => (
                    <div key={section} className="border-b border-gray-100 last:border-b-0">
                      <div className={`px-7 pb-1 pt-3 text-xs font-semibold ${section === 'advanced' ? 'text-red-700' : 'text-gray-500'}`}>
                        {PERMISSION_SECTION_LABELS[section]}
                      </div>
                      <div className="divide-y divide-gray-100">
                      {sectionPermissions.map(perm => {
                        const isAccessLocked = perm.action === 'access' && perm.granted && hasGrantedDependentPermission;
                        return (
                        <label
                          key={perm.id}
                          className={`flex items-start px-7 py-2.5 ${
                            !canAssignPermissions || isAccessLocked
                              ? 'cursor-not-allowed opacity-60'
                              : 'cursor-pointer hover:bg-blue-50/40'
                          }`}
                          title={isAccessLocked ? '請先關閉其他權限，或使用「清除」停用整個功能' : undefined}
                        >
                          <input
                            type={EXCLUSIVE_VIEW_SCOPE_ACTIONS.has(perm.action) ? 'radio' : 'checkbox'}
                            name={EXCLUSIVE_VIEW_SCOPE_ACTIONS.has(perm.action) ? `permission-scope-${perm.module}-${perm.feature}` : undefined}
                            checked={perm.granted}
                            onChange={() => togglePermission(perm.id)}
                            onClick={() => {
                              if (hasViewScopeConflict && perm.granted && EXCLUSIVE_VIEW_SCOPE_ACTIONS.has(perm.action)) {
                                togglePermission(perm.id);
                              }
                            }}
                            disabled={!canAssignPermissions || isAccessLocked}
                            aria-describedby={isAccessLocked ? `access-lock-${perm.id}` : undefined}
                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <div className="ml-3 min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-sm font-medium text-gray-800">
                                {getPermissionActionLabel(perm)}
                              </span>
                              {BROAD_SCOPE_PERMISSION_ACTIONS.has(perm.action) && (
                                <span className="text-xs font-semibold text-amber-700">範圍較廣</span>
                              )}
                              {showTechnicalPermissionCodes && (
                                <code className="break-all text-xs text-gray-400">
                                  {perm.code}
                                </code>
                              )}
                            </div>
                            {perm.description && (
                              <p className="mt-1 text-sm text-gray-600">
                                {perm.description}
                              </p>
                            )}
                            {isAccessLocked && (
                              <p id={`access-lock-${perm.id}`} className="mt-1 text-xs text-gray-500">
                                其他權限使用中，需保留進入功能
                              </p>
                            )}
                          </div>
                        </label>
                        );
                      })}
                      </div>
                    </div>
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
              {emptyPermissionMessage}
            </div>
          )}
        </div>}
        {canAssignPermissions && hasUnsavedPermissionChanges && (
          <div className="sticky bottom-4 z-20 mt-6 rounded-md border border-amber-200 bg-white px-4 py-3 shadow-lg">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">權限變更尚未儲存</p>
              <p className="text-xs text-gray-500">
                {permissionChangeSummary.enabled > 0 && `開啟 ${permissionChangeSummary.enabled} 項`}
                {permissionChangeSummary.enabled > 0 && permissionChangeSummary.disabled > 0 && '、'}
                {permissionChangeSummary.disabled > 0 && `關閉 ${permissionChangeSummary.disabled} 項`}
                ，儲存後才會套用到這個角色。
              </p>
              {canViewUsers && activeRoleUserCount !== null && (
                <p className="mt-1 text-xs font-medium text-gray-700">
                  將影響 {activeRoleUserCount} 位目前使用此角色的人員
                </p>
              )}
              {canViewUsers && roleUserImpactError && (
                <p className="mt-1 text-xs font-medium text-amber-700">目前無法取得影響人數</p>
              )}
              {permissionChangeSummary.enabledSensitive > 0 && (
                <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-red-700">
                  <AlertTriangle size={13} />
                  包含 {permissionChangeSummary.enabledSensitive} 項新開啟的敏感權限
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                ref={permissionChangesTriggerButtonRef}
                type="button"
                onClick={() => setShowPermissionChanges(true)}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:flex-none"
              >
                <ListChecks size={16} />
                查看變更
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
                onClick={() => {
                  setAssignUserError(null);
                  setShowAddUserModal(true);
                }}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
              >
                新增角色使用者
              </button>
            )}
          </div>

          {userManagementFeedback && (
            <div
              role="status"
              aria-live="polite"
              className={`mb-5 flex items-center gap-2 rounded-md border px-4 py-3 text-sm font-medium ${
                userManagementFeedback.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              {userManagementFeedback.type === 'success' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
              {userManagementFeedback.message}
            </div>
          )}

          {canViewUsers && !loadingUsers && !userListError && users.length > 0 && (
            <div className="mb-5 flex flex-col gap-3 border-b border-gray-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
              <label className="relative block w-full lg:max-w-sm">
                <span className="sr-only">搜尋角色使用者</span>
                <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="search"
                  value={userSearch}
                  onChange={event => setUserSearch(event.target.value)}
                  placeholder="搜尋姓名、員編、部門或職稱"
                  className="w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </label>
              <div className="inline-flex w-fit rounded-md border border-gray-300 bg-gray-50 p-1" role="group" aria-label="角色使用狀態">
                {([
                  ['all', '全部'],
                  ['current', '使用中'],
                  ['inactive', '停用或過期'],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setUserStatusFilter(value)}
                    aria-pressed={userStatusFilter === value}
                    className={`rounded px-3 py-1.5 text-sm font-medium ${userStatusFilter === value ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!canViewUsers ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              目前帳號缺少 <code className="rounded bg-white px-2 py-1">role.user_role.view</code>，無法查看此角色的使用者。
            </div>
          ) : userListError ? (
            <div className="flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <XCircle size={20} className="mt-0.5 shrink-0 text-red-600" />
                <div>
                  <p className="text-sm font-semibold text-red-900">角色使用者載入失敗</p>
                  <p className="mt-0.5 text-sm text-red-800">{userListError}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={fetchUsers}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-800 hover:bg-red-100"
              >
                <RefreshCw size={16} />
                重新載入
              </button>
            </div>
          ) : loadingUsers ? (
            <div role="status" aria-live="polite" className="flex justify-center gap-2 py-12 text-sm text-gray-600">
              <RefreshCw size={18} className="animate-spin text-blue-600" />
              載入角色使用者
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>此角色尚未指派任何使用者</p>
            </div>
          ) : filteredRoleUsers.length === 0 ? (
            <div className="border border-dashed border-gray-300 py-10 text-center text-sm text-gray-500">
              找不到符合條件的角色使用者
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
                  {filteredRoleUsers.map(user => {
                    const assignmentStatus = getRoleAssignmentStatus(user);
                    return (
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
                        <span className={`text-xs font-medium ${
                          assignmentStatus === 'current'
                            ? 'text-emerald-700'
                            : assignmentStatus === 'expired'
                              ? 'text-amber-700'
                              : 'text-gray-500'
                        }`}>
                          {assignmentStatus === 'current' ? '使用中' : assignmentStatus === 'expired' ? '已過期' : '已停用'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {new Date(user.assigned_at).toLocaleDateString('zh-TW')}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        {canRevokeUsers ? (
                          <button
                            type="button"
                            onClick={() => requestRemoveUser(user.id, user.name || user.email)}
                            className="rounded px-2 py-1 text-red-600 hover:bg-red-50 hover:text-red-700"
                          >
                            移除
                          </button>
                        ) : (
                          <span className="text-gray-400">無操作權限</span>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showPermissionChanges && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
          onMouseDown={event => {
            if (event.target === event.currentTarget) closePermissionChangesDialog();
          }}
        >
          <div
            ref={permissionChangesDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="permission-changes-title"
            className="flex max-h-[80vh] w-full max-w-3xl flex-col rounded-md bg-white shadow-xl"
          >
            <div className="flex items-center gap-3 border-b border-gray-200 px-5 py-4">
              <ListChecks size={20} className="shrink-0 text-blue-600" />
              <div>
                <h3 id="permission-changes-title" className="font-semibold text-gray-950">本次權限變更</h3>
                <p className="mt-0.5 text-sm text-gray-500">
                  開啟 {permissionChangeSummary.enabled} 項，關閉 {permissionChangeSummary.disabled} 項
                </p>
                {canViewUsers && activeRoleUserCount !== null && (
                  <p className="mt-1 text-xs font-medium text-gray-600">
                    儲存後影響 {activeRoleUserCount} 位目前使用此角色的人員
                  </p>
                )}
              </div>
            </div>
            <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-2 md:divide-x md:divide-gray-200">
              <div className="p-5">
                <p className="mb-3 text-sm font-semibold text-emerald-700">將開啟（{permissionChangeSummary.enabled}）</p>
                {permissionChangeSummary.enabledPermissions.length === 0 ? (
                  <p className="text-sm text-gray-400">沒有新開啟的權限</p>
                ) : (
                  <ul className="space-y-3">
                    {permissionChangeSummary.enabledPermissions.map(permission => (
                      <li key={permission.id} className="text-sm text-gray-700">
                        <p className="font-medium">{FEATURE_NAMES[permission.feature] || permission.feature} · {getPermissionActionLabel(permission)}</p>
                        <p className="mt-0.5 text-xs text-gray-500">{MODULE_NAMES[permission.module] || permission.module}</p>
                        {isSensitivePermission(permission) && <p className="mt-1 text-xs font-semibold text-red-600">{getSensitivePermissionLabel(permission)}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="border-t border-gray-200 p-5 md:border-t-0">
                <p className="mb-3 text-sm font-semibold text-red-700">將關閉（{permissionChangeSummary.disabled}）</p>
                {permissionChangeSummary.disabledPermissions.length === 0 ? (
                  <p className="text-sm text-gray-400">沒有要關閉的權限</p>
                ) : (
                  <ul className="space-y-3">
                    {permissionChangeSummary.disabledPermissions.map(permission => (
                      <li key={permission.id} className="text-sm text-gray-700">
                        <p className="font-medium">{FEATURE_NAMES[permission.feature] || permission.feature} · {getPermissionActionLabel(permission)}</p>
                        <p className="mt-0.5 text-xs text-gray-500">{MODULE_NAMES[permission.module] || permission.module}</p>
                        {isSensitivePermission(permission) && <p className="mt-1 text-xs font-semibold text-red-600">{getSensitivePermissionLabel(permission)}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="flex justify-end border-t border-gray-200 px-5 py-4">
              <button
                ref={permissionChangesCloseButtonRef}
                type="button"
                onClick={closePermissionChangesDialog}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              >
                返回設定
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingHighImpactPermission && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
          onMouseDown={event => {
            if (event.target === event.currentTarget) closeSensitivePermissionDialog();
          }}
        >
          <div
            ref={highImpactDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="high-impact-permission-title"
            className="w-full max-w-md rounded-md bg-white shadow-xl"
          >
            <div className="flex items-start gap-3 border-b border-gray-200 px-5 py-4">
              <AlertTriangle size={22} className={`mt-0.5 shrink-0 ${BROAD_SCOPE_PERMISSION_ACTIONS.has(pendingHighImpactPermission.action) ? 'text-amber-600' : 'text-red-600'}`} />
              <div>
                <h3 id="high-impact-permission-title" className="font-semibold text-gray-950">
                  {BROAD_SCOPE_PERMISSION_ACTIONS.has(pendingHighImpactPermission.action) ? '確認擴大查看範圍' : '確認開啟進階權限'}
                </h3>
                <p className="mt-1 text-sm text-gray-600">
                  {BROAD_SCOPE_PERMISSION_ACTIONS.has(pendingHighImpactPermission.action)
                    ? '開啟後可查看超出本人或所屬門市範圍的資料。'
                    : '這項能力可能變更既有資料或流程結果。'}
                </p>
              </div>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div>
                <p className="text-xs text-gray-500">功能</p>
                <p className="mt-0.5 text-sm font-medium text-gray-900">
                  {FEATURE_NAMES[pendingHighImpactPermission.feature] || pendingHighImpactPermission.feature}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">即將授予</p>
                <p className={`mt-0.5 text-sm font-semibold ${BROAD_SCOPE_PERMISSION_ACTIONS.has(pendingHighImpactPermission.action) ? 'text-amber-700' : 'text-red-700'}`}>
                  {getPermissionActionLabel(pendingHighImpactPermission)}
                </p>
              </div>
              {pendingHighImpactPermission.description && (
                <p className="text-sm leading-6 text-gray-700">
                  {pendingHighImpactPermission.description}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button
                type="button"
                onClick={closeSensitivePermissionDialog}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                ref={highImpactConfirmButtonRef}
                type="button"
                onClick={confirmHighImpactPermission}
                className={`rounded-md px-4 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-offset-2 ${BROAD_SCOPE_PERMISSION_ACTIONS.has(pendingHighImpactPermission.action) ? 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500' : 'bg-red-600 hover:bg-red-700 focus:ring-red-500'}`}
              >
                確認開啟
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRemoveUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4"
          onMouseDown={event => {
            if (event.target === event.currentTarget) closeRemoveUserDialog();
          }}
        >
          <div
            ref={removeUserDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-role-user-title"
            className="w-full max-w-md rounded-md bg-white shadow-xl"
          >
            <div className="flex items-start gap-3 border-b border-gray-200 px-5 py-4">
              <UserMinus size={22} className="mt-0.5 shrink-0 text-red-600" />
              <div>
                <h3 id="remove-role-user-title" className="font-semibold text-gray-950">移除角色使用者</h3>
                <p className="mt-1 text-sm text-gray-600">移除後，此人員將失去這個角色提供的權限。</p>
              </div>
            </div>
            <dl className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2 px-5 py-4 text-sm">
              <dt className="text-gray-500">人員</dt>
              <dd className="font-medium text-gray-900">{pendingRemoveUser.name}</dd>
              <dt className="text-gray-500">角色</dt>
              <dd className="font-medium text-gray-900">{role?.name || '-'}</dd>
            </dl>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button
                type="button"
                onClick={closeRemoveUserDialog}
                disabled={removingUser}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                ref={removeUserConfirmButtonRef}
                type="button"
                onClick={confirmRemoveUser}
                disabled={removingUser}
                className="inline-flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-wait disabled:opacity-60"
              >
                {removingUser && <RefreshCw size={15} className="animate-spin" />}
                {removingUser ? '移除中' : '確認移除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新增使用者 Modal */}
      {showAddUserModal && canAssignUsers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
          <div role="dialog" aria-modal="true" aria-labelledby="assign-role-users-title" className="w-full max-w-lg rounded-md bg-white shadow-xl">
            <div className="flex justify-between items-center px-6 py-4 border-b">
              <h3 id="assign-role-users-title" className="text-lg font-semibold">新增角色使用者</h3>
              <button
                type="button"
                onClick={() => {
                  setShowAddUserModal(false);
                  setEmployeeCodesInput('');
                  setAssignUserError(null);
                }}
                aria-label="關閉新增角色使用者視窗"
                className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              >
                <X size={20} />
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

              {assignUserError && (
                <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  <XCircle size={17} className="mt-0.5 shrink-0" />
                  {assignUserError}
                </div>
              )}

              <p className="text-sm text-gray-600">已擁有此角色的人員會自動略過；未綁定帳號的員工無法指派。</p>
            </div>

            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowAddUserModal(false);
                  setEmployeeCodesInput('');
                  setAssignUserError(null);
                }}
                className="rounded-md px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                取消
              </button>
              <button
                onClick={handleAssignUsers}
                disabled={!employeeCodesInput.trim() || assigningUser}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
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
