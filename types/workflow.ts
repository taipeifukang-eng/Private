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
