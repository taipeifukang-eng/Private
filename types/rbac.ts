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
  monthly: '每月人員狀態',
  activity: '活動管理',
  user: '使用者管理',
  supervisor: '督導管理',
  role: '角色權限',
  inventory: '盤點管理',
  inspection: '督導巡店',
  cross_dept: '跨部門管理',
  performance: '業績管理',
  monthly_status: '每月人員狀態',
  general_affairs: '總務服務中心',
  // 相容 navbar migration 遺留的中文 module 值
  '任務管理': '任務管理',
  '門市管理': '門市管理',
  '人事管理': '員工管理',
  '活動管理': '活動管理',
  '盤點管理': '盤點管理',
  '每月狀態': '每月人員狀態',
  '每月人員狀態': '每月人員狀態',
  '業績管理': '業績管理',
  '系統': '系統管理',
  '督導巡店': '督導巡店',
};

// 功能名稱對照（權限代碼仍保留英文，管理介面顯示白話名稱）
export const FEATURE_NAMES: Record<string, string> = {
  service_center: '總務服務中心',
  request: '總務需求',
  maintenance_request: '維修需求',
  work_order: '工單處理',
  equipment: '設備管理',
  equipment_template: '公司設備型號',
  equipment_category: '設備分類',
  facility: '設施管理',
  facility_category: '設施分類',
  part: '料件管理',
  part_category: '料件分類',
  part_fulfillment: '料件處理',
  inventory_balance: '庫存餘額',
  inventory_location: '庫存位置',
  inventory_transaction: '庫存交易',
  inventory_transfer: '庫存調撥',
  vendor: '合作廠商',
  service_category: '服務分類',
  service_region: '服務區域',
  cooperation_record: '合作紀錄',
  purchase_review: '採購評估',
  utility_bill: '水電與網路費',
};

// 操作類型對照
export const ACTION_NAMES: Record<string, string> = {
  view: '查看',
  view_all: '查看全部',
  view_own: '查看自己',
  view_inactive: '查看已停用',
  create: '建立',
  edit: '編輯',
  publish: '發布',
  delete: '刪除',
  import: '匯入',
  export: '匯出',
  assign: '指派',
  confirm: '確認',
  submit: '提交',
  restore: '還原',
  manage: '管理',
  access: '存取',
};
