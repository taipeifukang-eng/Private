// SubStep: A child step under a main step
export interface SubStep {
  id: string;
  label: string;
  description?: string;
  required: boolean;
}

// WorkflowStep: The structure stored in JSONB for dynamic steps
export interface WorkflowStep {
  id: string;
  label: string;
  description?: string;
  required: boolean;
  subSteps?: SubStep[];  // Optional sub-steps under this step
}

// DepartmentSection: A group of steps assigned to a specific department
export interface DepartmentSection {
  id: string;
  department: string;
  assigned_users: string[];
  steps: WorkflowStep[];
}

// Template: Stores the flow design
export interface Template {
  id: string;
  title: string;
  description: string | null;
  created_by: string | null;
  steps_schema: WorkflowStep[];  // Legacy: flat steps (for backward compatibility)
  sections?: DepartmentSection[]; // New: department-based sections
  created_at: string;
}

// Assignment: An instance of a template assigned to a user
export interface Assignment {
  id: string;
  template_id: string | null;
  assigned_to: string | null;
  status: 'pending' | 'in_progress' | 'completed';
  department: string | null; // Department of the task creator
  completed_at: string | null; // When the task was completed
  archived: boolean; // Whether the task is archived
  archived_at: string | null; // When the task was archived
  archived_by: string | null; // Who archived the task
  created_at: string;
}

// AssignmentCollaborator: Junction table for multi-user assignments
export interface AssignmentCollaborator {
  id: string;
  assignment_id: string;
  user_id: string;
  section_id?: string | null; // Which section this user is assigned to
  created_at: string;
}

// Log: The audit trail for each check action
export interface Log {
  id: string;
  assignment_id: string | null;
  user_id: string | null;
  step_id: number;
  action: string;
  created_at: string;
}

// Profile: Extended user information
export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: 'admin' | 'manager' | 'member';
  department: string | null; // User's department
  job_title: string | null; // User's job title/position
  employee_code: string | null; // Employee code (e.g., FK0171)
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

// =====================================================
// 門市與人員狀態管理相關類型
// =====================================================

// 門市資料
export interface Store {
  id: string;
  store_code: string;
  store_name: string;
  short_name: string | null;  // 簡稱
  hr_store_code: string | null;  // 人資系統門市代碼
  manager_name: string | null;  // 負責人姓名
  address: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// 門市管理者類型
export type StoreManagerRole = 'store_manager' | 'supervisor' | 'area_manager';

// 門市管理關聯
export interface StoreManager {
  id: string;
  store_id: string;
  user_id: string;
  role_type: StoreManagerRole;
  is_primary: boolean;
  created_at: string;
  // 關聯資料
  store?: Store;
  user?: Profile;
}

// 員工類型
export type EmploymentType = 'full_time' | 'part_time';

// 員工門市歸屬
export interface StoreEmployee {
  id: string;
  store_id: string;
  user_id: string;
  employee_code: string | null;
  position: string | null;
  employment_type: EmploymentType;
  is_pharmacist: boolean;
  is_active: boolean;
  start_date: string | null;
  created_at: string;
  updated_at: string;
  // 關聯資料
  store?: Store;
  user?: Profile;
}

// 每月狀態類型
export type MonthlyStatusType = 
  | 'full_month'        // 整月在職
  | 'new_hire'          // 到職
  | 'resigned'          // 離職
  | 'leave_of_absence'  // 留停
  | 'transferred_in'    // 調入
  | 'transferred_out'   // 調出
  | 'promoted'          // 升職
  | 'support_rotation'; // 支援卡班

// 審核狀態
export type StaffStatusReviewStatus = 'draft' | 'submitted' | 'confirmed';

// 新人階級（也用於行政階級）
export type NewbieLevel = '未過階新人' | '一階新人' | '二階新人' | '未過階行政' | '過階行政';

// 未上滿整月原因
export type PartialMonthReason = '復職' | '調入店' | '調出店' | '離職' | '留職停薪' | '店長-雙' | '代理店長-雙';

// 額外任務
export type ExtraTask = '長照外務' | '診所業務';

// 每月人員狀態
export interface MonthlyStaffStatus {
  id: string;
  year_month: string;
  store_id: string;
  user_id: string | null;
  
  // 人員基本資訊快照
  employee_code: string | null;
  employee_name: string | null;
  position: string | null;
  employment_type: EmploymentType;
  is_pharmacist: boolean;
  start_date: string | null; // 到職日期
  
  // 本月狀態
  monthly_status: MonthlyStatusType;
  
  // 天數/時數
  work_days: number | null;
  total_days_in_month: number;
  work_hours: number | null;
  
  // 新人階級
  newbie_level: NewbieLevel | null;
  
  // 未上滿整月（區塊3）
  partial_month_reason: PartialMonthReason | null;
  partial_month_days: number | null;
  partial_month_notes: string | null;
  
  // 督導卡班資訊（記錄來支援的督導）
  supervisor_shift_hours: number | null;
  supervisor_employee_code: string | null;
  supervisor_name: string | null;
  supervisor_position: string | null;
  
  // 特殊身分
  extra_tasks: ExtraTask[] | null;
  
  // 交通費用
  monthly_transport_expense: number | null;
  transport_expense_notes: string | null;
  
  // 舊有特殊標記
  is_dual_position: boolean;
  has_manager_bonus: boolean;
  is_supervisor_rotation: boolean;
  
  // 是否為手動新增
  is_manually_added: boolean;
  
  // 自動計算
  calculated_block: number | null;
  
  // 業績數據
  transaction_count: number | null;
  sales_amount: number | null;
  gross_profit: number | null;
  gross_profit_rate: number | null;
  
  // 審核
  status: StaffStatusReviewStatus;
  submitted_at: string | null;
  submitted_by: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  
  notes: string | null;
  created_at: string;
  updated_at: string;
  
  // 關聯資料
  store?: Store;
  user?: Profile;
}

// 督導卡班記錄（一個門市可能有多位督導來卡班）
export interface MonthlySupervisorShift {
  id: string;
  year_month: string;
  store_id: string;
  
  supervisor_employee_code: string | null;
  supervisor_name: string;
  supervisor_position: string | null;
  
  shift_hours: number;
  shift_days: number | null;
  notes: string | null;
  
  created_at: string;
  updated_at: string;
}

// 門市狀態摘要
export type StoreStatusType = 'pending' | 'in_progress' | 'submitted' | 'confirmed';

export interface MonthlyStoreSummary {
  id: string;
  year_month: string;
  store_id: string;
  
  total_employees: number;
  confirmed_count: number;
  
  store_status: StoreStatusType;
  
  // 應有人員
  total_staff_count: number | null;
  admin_staff_count: number | null;
  newbie_count: number | null;
  
  // 該月營業狀態
  business_days: number | null;
  total_gross_profit: number | null;
  total_customer_count: number | null;
  prescription_addon_only_count: number | null;
  regular_prescription_count: number | null;
  chronic_prescription_count: number | null;
  
  // 門市支援時數
  support_to_other_stores_hours: number | null;  // 本店人員去其他分店支援的總時數
  support_from_other_stores_hours: number | null; // 其他分店來本店支援的總時數
  
  submitted_at: string | null;
  submitted_by: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  
  created_at: string;
  updated_at: string;
  
  // 關聯資料
  store?: Store;
}

// 獎金區塊說明
export const BONUS_BLOCK_DESCRIPTIONS: Record<number, string> = {
  0: '未分類',
  1: '區塊1：正職整月',
  2: '區塊2：督導卡班',
  3: '區塊3：非整月正職',
  4: '區塊4：特殊時數',
  5: '區塊5：兼職藥師',
  6: '區塊6：兼職一般人'
};

// 每月狀態選項
export const MONTHLY_STATUS_OPTIONS: { value: MonthlyStatusType; label: string }[] = [
  { value: 'full_month', label: '整月在職' },
  { value: 'new_hire', label: '到職（本月新進）' },
  { value: 'resigned', label: '離職' },
  { value: 'leave_of_absence', label: '留停' },
  { value: 'transferred_in', label: '調入' },
  { value: 'transferred_out', label: '調出' },
  { value: 'promoted', label: '升職' },
  { value: 'support_rotation', label: '支援卡班' }
];

// 新人階級選項
export const NEWBIE_LEVEL_OPTIONS: { value: NewbieLevel; label: string }[] = [
  { value: '未過階新人', label: '未過階新人' },
  { value: '一階新人', label: '一階新人' },
  { value: '二階新人', label: '二階新人' }
];

// 行政階級選項
export const ADMIN_LEVEL_OPTIONS: { value: NewbieLevel; label: string }[] = [
  { value: '未過階行政', label: '未過階' },
  { value: '過階行政', label: '過階' }
];

// 未上滿整月原因選項
export const PARTIAL_MONTH_REASON_OPTIONS: { value: PartialMonthReason; label: string }[] = [
  { value: '復職', label: '復職' },
  { value: '調入店', label: '調入店' },
  { value: '調出店', label: '調出店' },
  { value: '離職', label: '離職' },
  { value: '留職停薪', label: '留職停薪' },
  { value: '店長-雙', label: '店長-雙' },
  { value: '代理店長-雙', label: '代理店長-雙' }
];

// 額外任務選項
export const EXTRA_TASK_OPTIONS: { value: ExtraTask; label: string }[] = [
  { value: '長照外務', label: '長照外務' },
  { value: '診所業務', label: '診所業務' }
];

// 特殊身分選項
export const SPECIAL_ROLE_OPTIONS = [
  '督導(代理店長)',
  '區經理(代理店長)',
  '督導(店長)',
  '區經理(店長)'
];

// 職位選項
export const POSITION_OPTIONS = [
  '督導',
  '店長',
  '代理店長',
  '督導(代理店長)',
  '副店長',
  '主任',
  '組長',
  '專員',
  '新人',
  '行政',
  '兼職專員',
  '兼職藥師',
  '兼職藥師專員',
  '兼職助理'
];
