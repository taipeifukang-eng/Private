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
  home: '首頁',
  organization: '組織管理',
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
  '組織管理': '組織管理',
};

// 功能名稱對照（權限代碼仍保留英文，管理介面顯示白話名稱）
export const FEATURE_NAMES: Record<string, string> = {
  activity: '活動', archived: '已封存資料', assignment: '任務派發', base_data: '基礎資料',
  bonus: '獎金', bonus_detail: '獎金明細', campaign: '活動專案', change_role: '變更使用者角色',
  checklist: '檢核表', clinic_selfpay_margin: '診所自費品毛利', dashboard: '工作台',
  department_marketing: '行銷部', department_merchandise: '商品部', edit_meal: '膳食費編輯',
  edit_support_bonus: '單品獎金', edit_support_hours: '支援時數編輯', edit_talent: '人才培育編輯',
  edit_transport: '交通費編輯', employee: '員工資料', employee_batch: '員工批次作業',
  employee_movement: '人員異動', employee_purchase: '員工購物',
  service_center: '總務服務中心',
  request: '總務需求',
  maintenance_request: '維修需求',
  work_order: '工單處理',
  equipment: '設備管理',
  equipment_template: '公司設備型號',
  equipment_category: '設備分類',
  equipment_trip: '設備出勤紀錄', export: '報表匯出', export_download: '匯出檔案下載',
  export_meal: '膳食費匯出', export_stores: '門市資料匯出', export_support: '支援資料匯出',
  facility: '設施管理',
  facility_category: '設施分類',
  import_performance: '業績匯入', import_stats: '匯入統計', inspection: '巡店紀錄',
  inspection_all: '全部巡店紀錄', inspection_compare: '巡店比較', inspection_improvement: '待改善追蹤',
  inspection_manager: '巡店管理', inspection_store: '門市巡店資料', inspection_store_status: '門市巡店狀態',
  inspection_template: '巡店範本', inventory: '盤點作業',
  part: '料件管理',
  part_category: '料件分類',
  part_fulfillment: '料件處理',
  inventory_balance: '庫存餘額',
  inventory_location: '庫存位置',
  inventory_transaction: '庫存交易',
  inventory_transfer: '庫存調撥',
  maintenance: '維修管理', management: '管理功能', manager: '主管管理',
  module1: '功能模組一', module2: '功能模組二', module3: '功能模組三',
  monthly_status: '每月人員狀態', monthly_status_stats: '每月人員統計', my_tasks: '我的任務',
  vendor: '合作廠商',
  service_category: '服務分類',
  service_region: '服務區域',
  cooperation_record: '合作紀錄',
  purchase_review: '採購評估',
  utility_bill: '水電與網路費',
  performance: '業績管理', permission: '權限管理', pharmacist_management: '藥師管理',
  pharmacist_master: '藥師主檔', products_master: '商品主檔', promotion: '升遷管理',
  relationship_member: '關係人員', result_analysis: '盤點結果分析', role: '角色管理',
  schedule: '排程管理', staff_overview: '人員概況', status: '狀態管理', stockout: '缺貨管理',
  store: '門市管理', store_detail: '門市詳細資料', store_employee: '門市員工', store_supervisor: '門市督導',
  store_transfer: '人員調店', supervisor: '督導管理', support_assign: '支援派發', task_archived: '已封存任務',
  task_own: '個人任務', task_template: '任務範本', template: '範本管理', user: '使用者管理',
  user_role: '使用者角色',
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
  approve: '審核', category_edit: '編輯分類', clone: '複製', close: '結案',
  comment_all: '回覆全部', comment_own_store: '回覆自己門市', complete: '完成',
  confirm_own_store: '確認自己門市', force_close: '強制結案', generate: '產生資料',
  generate_m2: '產生第二階段資料', generate_m3: '產生第三階段資料', respond: '回覆', revert: '撤銷',
  unconfirm: '取消確認', update: '更新', upload: '上傳', upload_base: '上傳基礎資料',
  upload_external: '上傳外部資料', upload_external_m2: '上傳第二階段外部資料',
  upload_fks0701: '上傳 FKS0701', upload_fks0701_m2: '上傳第二階段 FKS0701',
  upload_pre: '上傳盤點前資料', upload_recount: '上傳複盤資料', upload_uninventoried: '上傳未盤點資料',
  upload_photo: '上傳照片', use: '使用', view_own_store: '查看自己門市',
};
