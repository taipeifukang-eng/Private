// ============================================
// RBAC 系統 TypeScript 類型定義
// ============================================

export interface Role {
  id: string;
  name: string;
  code: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface Permission {
  id: string;
  module: string;
  feature: string;
  code: string;
  action: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface RolePermission {
  id: string;
  role_id: string;
  permission_id: string;
  is_allowed: boolean;
  created_at: string;
  created_by: string | null;
}

export interface UserRole {
  id: string;
  user_id: string;
  role_id: string;
  employee_code: string | null;
  is_active: boolean;
  assigned_at: string;
  assigned_by: string | null;
  expires_at: string | null;
}

export interface PermissionLog {
  id: string;
  user_id: string;
  permission_code: string;
  action: 'check' | 'grant' | 'revoke';
  result: boolean | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

// UI 專用類型
export interface RoleWithPermissions extends Role {
  permissions: Permission[];
  permission_count?: number;
  user_count?: number;
}

export interface PermissionGroup {
  module: string;
  moduleName: string;
  permissions: Permission[];
}

export interface UserWithRoles {
  id: string;
  email: string;
  employee_code?: string;
  roles: Role[];
}

// 權限檢查結果
export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

// 模組名稱對照
export const MODULE_NAMES: Record<string, string> = {
  task: '任務管理',
  store: '門市管理',
  employee: '員工管理',
  monthly: '每月狀態',
  activity: '活動管理',
  user: '使用者管理',
  supervisor: '督導管理',
  role: '角色權限'
};

// 操作類型對照
export const ACTION_NAMES: Record<string, string> = {
  view: '查看',
  view_all: '查看全部',
  view_own: '查看自己',
  view_inactive: '查看已停用',
  create: '建立',
  edit: '編輯',
  delete: '刪除',
  import: '匯入',
  export: '匯出',
  assign: '指派',
  confirm: '確認',
  submit: '提交',
  restore: '還原'
};
