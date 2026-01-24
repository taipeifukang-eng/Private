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

// 每月人員狀態
export interface MonthlyStaffStatus {
  id: string;
  year_month: string;
  store_id: string;
  user_id: string;
  
  // 人員基本資訊快照
  employee_code: string | null;
  employee_name: string | null;
  position: string | null;
  employment_type: EmploymentType;
  is_pharmacist: boolean;
  
  // 本月狀態
  monthly_status: MonthlyStatusType;
  
  // 天數/時數
  work_days: number | null;
  total_days_in_month: number;
  work_hours: number | null;
  
  // 特殊標記
  is_dual_position: boolean;
  has_manager_bonus: boolean;
  is_supervisor_rotation: boolean;
  
  // 自動計算
  calculated_block: number | null;
  
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

// 門市狀態摘要
export type StoreStatusType = 'pending' | 'in_progress' | 'submitted' | 'confirmed';

export interface MonthlyStoreSummary {
  id: string;
  year_month: string;
  store_id: string;
  
  total_employees: number;
  confirmed_count: number;
  
  store_status: StoreStatusType;
  
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

// 職位選項
export const POSITION_OPTIONS = [
  '店長',
  '代理店長',
  '店長-雙',
  '代理店長-雙',
  '督導',
  '督導(代理店長)',
  '督導(代理店長)-雙',
  '正職',
  '兼職藥師',
  '兼職一般'
];
