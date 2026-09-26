-- P1-C Production core compatibility foundation for DEV.
-- Draft only. Do not apply to Production. Do not copy Production data.

DO $$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.profiles';
  END IF;
  IF to_regclass('public.stores') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.stores';
  END IF;
  IF to_regclass('public.permissions') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.permissions';
  END IF;
  IF to_regclass('public.roles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.roles';
  END IF;
  IF to_regclass('public.role_permissions') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.role_permissions';
  END IF;
  IF to_regclass('public.user_roles') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.user_roles';
  END IF;
  IF to_regclass('public.store_managers') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite table: public.store_managers';
  END IF;
  IF to_regprocedure('public.current_user_has_permission(character varying)') IS NULL THEN
    RAISE EXCEPTION 'Missing prerequisite function: public.current_user_has_permission(varchar)';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.p1c_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.p1c_assignment_is_visible(p_assignment_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_visible boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.current_user_has_permission('task.manage')
     OR public.current_user_has_permission('task.view_archived') THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.assignments a
    WHERE a.id = p_assignment_id
      AND (
        a.assigned_to = v_user_id
        OR a.created_by = v_user_id
        OR EXISTS (
          SELECT 1
          FROM public.assignment_collaborators ac
          WHERE ac.assignment_id = a.id
            AND ac.user_id = v_user_id
        )
      )
  )
  INTO v_visible;

  RETURN COALESCE(v_visible, false);
END;
$$;

INSERT INTO public.permissions (module, feature, code, action, description, is_active)
VALUES
  ('dashboard', 'dashboard', 'dashboard.view', 'view', '查看首頁儀表板', true),
  ('role', 'permission', 'role.permission.view', 'view', '查看角色權限代碼', true),
  ('role', 'permission', 'role.permission.assign', 'assign', '編輯角色可用權限代碼', true),
  ('role', 'role', 'role.role.view', 'view', '查看角色', true),
  ('role', 'role', 'role.role.create', 'create', '新增角色', true),
  ('role', 'role', 'role.role.edit', 'edit', '編輯角色', true),
  ('role', 'role', 'role.role.delete', 'delete', '刪除角色', true),
  ('role', 'user_role', 'role.user_role.view', 'view', '查看使用者角色', true),
  ('role', 'user_role', 'role.user_role.assign', 'assign', '指派使用者角色', true),
  ('role', 'user_role', 'role.user_role.revoke', 'revoke', '移除使用者角色', true),
  ('user', 'user', 'user.user.view', 'view', '查看使用者', true),
  ('user', 'user', 'user.user.create', 'create', '新增使用者', true),
  ('user', 'user', 'user.user.edit', 'edit', '編輯使用者基本資料', true),
  ('user', 'user', 'user.user.delete', 'delete', '刪除使用者', true),
  ('user', 'user', 'user.user.change_role', 'change_role', '變更使用者角色', true),
  ('store', 'store', 'store.manage', 'manage', '管理門市資料', true),
  ('store', 'manager', 'store.manager.assign', 'assign', '指派店長', true),
  ('store', 'supervisor', 'store.supervisor.assign', 'assign', '指派督導', true),
  ('store', 'store', 'store.store.create', 'create', '新增門市', true),
  ('store', 'store', 'store.store.clone', 'clone', '複製門市', true),
  ('store', 'products_master', 'store.products_master.manage', 'manage', '管理商品主檔', true),
  ('store', 'clinic_selfpay', 'store.clinic_selfpay.margin', 'view', '查看自費價差', true),
  ('store', 'clinic_selfpay', 'store.clinic_selfpay.calculator.use', 'use', '使用自費價差計算', true),
  ('store', 'clinic_selfpay', 'store.clinic_selfpay.mapping.manage', 'manage', '管理自費價差對照', true),
  ('store', 'clinic_selfpay', 'store.clinic_selfpay.batch.delete', 'delete', '刪除自費價差批次', true),
  ('task', 'task', 'task.view_own', 'view_own', '查看自己的任務', true),
  ('task', 'task', 'task.manage', 'manage', '管理任務', true),
  ('task', 'task', 'task.view_archived', 'view_archived', '查看封存任務', true),
  ('task', 'template', 'task.template.edit', 'edit', '編輯任務模板', true),
  ('task', 'template', 'task.template.delete', 'delete', '刪除任務模板', true),
  ('employee', 'employee', 'employee.manage', 'manage', '管理員工資料', true),
  ('employee', 'employee', 'employee.employee.create', 'create', '新增員工資料', true),
  ('employee', 'employee', 'employee.employee.edit', 'edit', '編輯員工資料', true),
  ('employee', 'import', 'employee.import', 'import', '匯入員工資料', true),
  ('employee', 'movement', 'employee.movement.manage', 'manage', '管理員工異動', true),
  ('employee', 'promotion', 'employee.promotion.batch', 'batch', '批次升遷', true),
  ('employee', 'promotion', 'employee.promotion.delete', 'delete', '刪除升遷資料', true),
  ('employee', 'store_transfer', 'employee.store_transfer.create', 'create', '建立調店申請', true),
  ('employee', 'store_transfer', 'employee.store_transfer.confirm', 'confirm', '確認調店申請', true),
  ('monthly', 'status', 'monthly.status.view_own', 'view_own', '查看自己門市每月人員狀態', true),
  ('monthly', 'status', 'monthly.status.view_all', 'view_all', '查看全部每月人員狀態', true),
  ('monthly', 'status', 'monthly.status.export', 'export', '匯出每月人員狀態', true),
  ('monthly', 'status', 'monthly.status.confirm', 'confirm', '確認每月人員狀態', true),
  ('monthly', 'status', 'monthly.status.unconfirm', 'unconfirm', '取消確認每月人員狀態', true),
  ('monthly', 'status', 'monthly.status.revert', 'revert', '退回每月人員狀態', true),
  ('monthly', 'status', 'monthly.status.view_stats', 'view_stats', '查看每月狀態統計', true),
  ('monthly', 'status', 'monthly.status.view_performance', 'view_performance', '查看每月績效', true),
  ('monthly', 'status', 'monthly.status.bonus_detail.view', 'bonus_detail_view', '查看獎金明細', true),
  ('monthly', 'allowance', 'monthly.allowance.view_support_hours', 'view_support_hours', '查看支援時數', true),
  ('monthly', 'allowance', 'monthly.allowance.edit_support_hours', 'edit_support_hours', '編輯支援時數', true),
  ('monthly', 'export', 'monthly.export.download', 'download', '下載每月匯出資料', true),
  ('inspection', 'inspection', 'inspection.view_own', 'view_own', '查看自己巡店', true),
  ('inspection', 'inspection', 'inspection.view_store', 'view_store', '查看門市巡店', true),
  ('inspection', 'inspection', 'inspection.view_all', 'view_all', '查看全部巡店', true),
  ('inspection', 'inspection', 'inspection.create', 'create', '建立巡店', true),
  ('inspection', 'inspection', 'inspection.delete', 'delete', '刪除巡店', true),
  ('inspection', 'inspection', 'inspection.export', 'export', '匯出巡店', true),
  ('inspection', 'inspection', 'inspection.compare', 'compare', '比較巡店結果', true),
  ('inspection', 'inspection', 'inspection.manager_tab', 'manager_tab', '查看巡店管理分頁', true),
  ('inspection', 'inspection', 'inspection.view_store_status', 'view_store_status', '查看巡店門市狀態', true),
  ('inspection', 'template', 'inspection.template.manage', 'manage', '管理巡店範本', true),
  ('inspection', 'improvement', 'inspection.improvement.view_all', 'view_all', '查看全部待改善事項', true),
  ('inspection', 'improvement', 'inspection.improvement.view_own_store', 'view_own_store', '查看自己門市待改善事項', true),
  ('inspection', 'improvement', 'inspection.improvement.submit', 'submit', '提交待改善事項', true),
  ('inventory', 'inventory', 'inventory.manage', 'manage', '管理既有庫存模組', true),
  ('inventory', 'inventory', 'inventory.inventory.access', 'access', '進入既有庫存模組', true),
  ('inventory', 'inventory', 'inventory.inventory.view', 'view', '查看既有庫存模組', true),
  ('inventory', 'result_analysis', 'inventory.result_analysis.view_own', 'view_own', '查看自己範圍盤點結果分析', true),
  ('inventory', 'result_analysis', 'inventory.result_analysis.import', 'import', '匯入盤點結果', true),
  ('inventory', 'result_analysis', 'inventory.result_analysis.delete', 'delete', '刪除盤點結果', true),
  ('activity', 'activity', 'activity.manage', 'manage', '管理活動', true),
  ('activity', 'management', 'activity.management.access', 'access', '進入活動管理', true),
  ('activity', 'campaign', 'activity.campaign.view', 'view', '查看活動', true),
  ('activity', 'campaign', 'activity.campaign.view_all', 'view_all', '查看全部活動', true),
  ('activity', 'campaign', 'activity.campaign.edit', 'edit', '編輯活動', true),
  ('activity', 'store_detail', 'activity.store_detail.edit', 'edit', '編輯門市活動明細', true),
  ('activity', 'equipment_trip', 'activity.equipment_trip.edit', 'edit', '編輯設備行程', true),
  ('activity', 'checklist', 'activity.checklist.edit', 'edit', '編輯活動檢核', true),
  ('activity', 'support_request', 'activity.support_request.edit', 'edit', '編輯支援需求', true),
  ('activity', 'support_assign', 'activity.support_assign.edit', 'edit', '編輯支援指派', true),
  ('activity', 'marketing', 'activity.marketing.publish', 'publish', '行銷發布活動', true),
  ('activity', 'merchandise', 'activity.merchandise.publish', 'publish', '商品發布活動', true),
  ('activity', 'staff_overview', 'activity.staff_overview.view', 'view', '查看人員總覽', true),
  ('cross_dept', 'stockout', 'cross_dept.stockout.view_all', 'view_all', '查看全部缺貨回報', true),
  ('cross_dept', 'stockout', 'cross_dept.stockout.submit', 'submit', '提交缺貨回報', true),
  ('cross_dept', 'stockout', 'cross_dept.stockout.respond', 'respond', '回覆缺貨回報', true),
  ('cross_dept', 'maintenance', 'cross_dept.maintenance.view_all', 'view_all', '查看全部維修回報', true),
  ('cross_dept', 'maintenance', 'cross_dept.maintenance.submit', 'submit', '提交維修回報', true),
  ('cross_dept', 'maintenance', 'cross_dept.maintenance.update', 'update', '更新維修進度', true),
  ('cross_dept', 'maintenance', 'cross_dept.maintenance.category.edit', 'category_edit', '編輯維修分類', true),
  ('performance', 'performance', 'performance.view', 'view', '查看績效', true),
  ('performance', 'performance', 'performance.edit', 'edit', '編輯績效', true),
  ('performance', 'bonus', 'performance.bonus.view', 'view', '查看績效獎金', true),
  ('performance', 'bonus', 'performance.bonus.import', 'import', '匯入績效獎金', true),
  ('pharmacist', 'management', 'pharmacist.management.view', 'view', '查看藥師管理', true),
  ('pharmacist', 'management', 'pharmacist.management.edit', 'edit', '編輯藥師管理', true),
  ('pharmacist', 'management_master', 'pharmacist.management.master.view', 'view', '查看藥師主檔', true),
  ('pharmacist', 'management_master', 'pharmacist.management.master.edit', 'edit', '編輯藥師主檔', true),
  ('relationship_member', 'relationship_member', 'relationship_member.view', 'view', '查看關係會員', true),
  ('relationship_member', 'relationship_member', 'relationship_member.edit', 'edit', '編輯關係會員', true),
  ('relationship_member', 'relationship_member', 'relationship_member.delete', 'delete', '刪除關係會員', true),
  ('relationship_member', 'relationship_member', 'relationship_member.approve', 'approve', '審核關係會員', true),
  ('general_affairs', 'service_center', 'general_affairs.service_center.force_close', 'force_close', '強制結案總務服務', true)
ON CONFLICT (code) DO UPDATE SET
  module = EXCLUDED.module,
  feature = EXCLUDED.feature,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_active = true;

INSERT INTO public.roles (name, code, description, is_system, is_active)
VALUES
  ('系統管理員', 'admin', 'Production-compatible system administrator role', true, true),
  ('主管', 'manager', 'Production-compatible manager role', true, true),
  ('一般成員', 'member', 'Production-compatible member role', true, true),
  ('DEV Full Admin', 'dev_full_admin', 'DEV-only full permission role', true, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_system = EXCLUDED.is_system,
  is_active = true;

INSERT INTO public.role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.code IN ('admin', 'dev_full_admin')
  AND p.is_active = true
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;

CREATE TABLE IF NOT EXISTS public.permission_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  permission_code varchar(100) NOT NULL,
  action varchar(50) NOT NULL,
  result boolean,
  ip_address inet,
  user_agent text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  employee_code varchar(20),
  position varchar(50),
  employment_type varchar(20) NOT NULL,
  is_pharmacist boolean DEFAULT false,
  is_active boolean DEFAULT true,
  start_date date,
  created_at timestamptz DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz DEFAULT timezone('utc'::text, now()),
  employee_name varchar(100),
  current_position text,
  last_promotion_date date,
  employment_status varchar(20) DEFAULT 'active',
  last_movement_date date,
  last_movement_type varchar(20),
  birthday date,
  CONSTRAINT store_employees_employment_type_check CHECK (employment_type IN ('full_time', 'part_time'))
);

CREATE TABLE IF NOT EXISTS public.employee_movement_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code varchar(20) NOT NULL,
  employee_name text NOT NULL,
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  movement_date date NOT NULL,
  new_value text,
  old_value text,
  notes text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz DEFAULT timezone('utc'::text, now()),
  movement_type varchar(20) NOT NULL,
  onboarding_is_pharmacist boolean,
  CONSTRAINT valid_movement_type CHECK (movement_type IN ('onboarding', 'promotion', 'leave_without_pay', 'return_to_work', 'pass_probation', 'resignation', 'store_transfer'))
);

CREATE TABLE IF NOT EXISTS public.store_relocation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  relocation_date date NOT NULL DEFAULT CURRENT_DATE,
  old_store_code text,
  new_store_code text,
  old_store_name text,
  new_store_name text,
  old_short_name text,
  new_short_name text,
  old_hr_store_code text,
  new_hr_store_code text,
  old_manager_name text,
  new_manager_name text,
  note text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_transfer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code varchar(20) NOT NULL,
  employee_name varchar(100) NOT NULL,
  from_store_id uuid NOT NULL REFERENCES public.stores(id),
  to_store_id uuid NOT NULL REFERENCES public.stores(id),
  status varchar(20) DEFAULT 'pending',
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  effective_date date,
  movement_history_id uuid REFERENCES public.employee_movement_history(id) ON DELETE SET NULL,
  CONSTRAINT store_transfer_requests_status_check CHECK (status IN ('pending', 'confirmed', 'rejected'))
);

CREATE TABLE IF NOT EXISTS public.templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  created_by uuid REFERENCES auth.users(id),
  steps_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  sections jsonb DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS public.assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid REFERENCES public.templates(id),
  assigned_to uuid REFERENCES auth.users(id),
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now(),
  department text,
  archived boolean DEFAULT false,
  archived_at timestamptz,
  archived_by uuid REFERENCES auth.users(id),
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  planned_start_date date,
  planned_end_date date
);

CREATE TABLE IF NOT EXISTS public.assignment_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid REFERENCES public.assignments(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  section_id text,
  CONSTRAINT assignment_collaborators_assignment_id_user_id_key UNIQUE (assignment_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid REFERENCES public.assignments(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id),
  action text,
  created_at timestamptz DEFAULT now(),
  step_id text,
  note text
);

CREATE INDEX IF NOT EXISTS idx_permission_logs_created ON public.permission_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_permission_logs_permission ON public.permission_logs(permission_code);
CREATE INDEX IF NOT EXISTS idx_permission_logs_user ON public.permission_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_store_employees_employee_name ON public.store_employees(employee_name);
CREATE INDEX IF NOT EXISTS idx_store_employees_store_id ON public.store_employees(store_id);
CREATE INDEX IF NOT EXISTS idx_store_employees_user_id ON public.store_employees(user_id);
CREATE INDEX IF NOT EXISTS idx_movement_date ON public.employee_movement_history(movement_date);
CREATE INDEX IF NOT EXISTS idx_movement_employee_code ON public.employee_movement_history(employee_code);
CREATE INDEX IF NOT EXISTS idx_movement_employee_date ON public.employee_movement_history(employee_code, movement_date);
CREATE INDEX IF NOT EXISTS idx_movement_store_id ON public.employee_movement_history(store_id);
CREATE INDEX IF NOT EXISTS idx_movement_type ON public.employee_movement_history(movement_type);
CREATE INDEX IF NOT EXISTS idx_store_relocation_history_relocation_date ON public.store_relocation_history(relocation_date DESC);
CREATE INDEX IF NOT EXISTS idx_store_relocation_history_store_id ON public.store_relocation_history(store_id);
CREATE INDEX IF NOT EXISTS idx_store_transfer_requests_created_at ON public.store_transfer_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_transfer_requests_employee_code ON public.store_transfer_requests(employee_code);
CREATE INDEX IF NOT EXISTS idx_store_transfer_requests_status ON public.store_transfer_requests(status);
CREATE INDEX IF NOT EXISTS idx_assignment_collaborators_assignment ON public.assignment_collaborators(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_collaborators_section ON public.assignment_collaborators(section_id);
CREATE INDEX IF NOT EXISTS idx_assignment_collaborators_user ON public.assignment_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_assignments_archived ON public.assignments(archived);
CREATE INDEX IF NOT EXISTS idx_assignments_archived_at ON public.assignments(archived_at);

DROP TRIGGER IF EXISTS trg_store_employees_updated_at ON public.store_employees;
CREATE TRIGGER trg_store_employees_updated_at
BEFORE UPDATE ON public.store_employees
FOR EACH ROW EXECUTE FUNCTION public.p1c_touch_updated_at();

DROP TRIGGER IF EXISTS trg_employee_movement_history_updated_at ON public.employee_movement_history;
CREATE TRIGGER trg_employee_movement_history_updated_at
BEFORE UPDATE ON public.employee_movement_history
FOR EACH ROW EXECUTE FUNCTION public.p1c_touch_updated_at();

ALTER TABLE public.permission_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_movement_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_relocation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p1c_permission_logs_select_admin ON public.permission_logs;
CREATE POLICY p1c_permission_logs_select_admin ON public.permission_logs
FOR SELECT TO authenticated
USING (public.current_user_has_permission('role.permission.view'));

DROP POLICY IF EXISTS p1c_permission_logs_insert_system ON public.permission_logs;
CREATE POLICY p1c_permission_logs_insert_system ON public.permission_logs
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS p1c_store_employees_select_scope ON public.store_employees;
CREATE POLICY p1c_store_employees_select_scope ON public.store_employees
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR public.current_user_has_permission('employee.manage')
  OR public.current_user_has_permission('store.manage')
  OR EXISTS (
    SELECT 1 FROM public.store_managers sm
    WHERE sm.store_id = store_employees.store_id
      AND sm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS p1c_store_employees_insert_manage ON public.store_employees;
CREATE POLICY p1c_store_employees_insert_manage ON public.store_employees
FOR INSERT TO authenticated
WITH CHECK (
  public.current_user_has_permission('employee.manage')
  OR public.current_user_has_permission('store.manage')
);

DROP POLICY IF EXISTS p1c_store_employees_update_manage ON public.store_employees;
CREATE POLICY p1c_store_employees_update_manage ON public.store_employees
FOR UPDATE TO authenticated
USING (
  public.current_user_has_permission('employee.manage')
  OR public.current_user_has_permission('store.manage')
)
WITH CHECK (
  public.current_user_has_permission('employee.manage')
  OR public.current_user_has_permission('store.manage')
);

DROP POLICY IF EXISTS p1c_store_employees_delete_manage ON public.store_employees;
CREATE POLICY p1c_store_employees_delete_manage ON public.store_employees
FOR DELETE TO authenticated
USING (
  public.current_user_has_permission('employee.manage')
  OR public.current_user_has_permission('store.manage')
);

DROP POLICY IF EXISTS p1c_employee_movement_select_scope ON public.employee_movement_history;
CREATE POLICY p1c_employee_movement_select_scope ON public.employee_movement_history
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('employee.movement.manage')
  OR public.current_user_has_permission('employee.manage')
  OR public.current_user_has_permission('store.manage')
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.employee_code = employee_movement_history.employee_code
  )
  OR EXISTS (
    SELECT 1 FROM public.store_managers sm
    WHERE sm.store_id = employee_movement_history.store_id
      AND sm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS p1c_employee_movement_manage ON public.employee_movement_history;
CREATE POLICY p1c_employee_movement_manage ON public.employee_movement_history
TO authenticated
USING (
  public.current_user_has_permission('employee.movement.manage')
  OR public.current_user_has_permission('employee.manage')
)
WITH CHECK (
  public.current_user_has_permission('employee.movement.manage')
  OR public.current_user_has_permission('employee.manage')
);

DROP POLICY IF EXISTS p1c_store_relocation_select_manage ON public.store_relocation_history;
CREATE POLICY p1c_store_relocation_select_manage ON public.store_relocation_history
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('store.manage')
  OR EXISTS (
    SELECT 1 FROM public.store_managers sm
    WHERE sm.store_id = store_relocation_history.store_id
      AND sm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS p1c_store_relocation_manage ON public.store_relocation_history;
CREATE POLICY p1c_store_relocation_manage ON public.store_relocation_history
TO authenticated
USING (public.current_user_has_permission('store.manage'))
WITH CHECK (public.current_user_has_permission('store.manage'));

DROP POLICY IF EXISTS p1c_store_transfer_select_scope ON public.store_transfer_requests;
CREATE POLICY p1c_store_transfer_select_scope ON public.store_transfer_requests
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('employee.store_transfer.create')
  OR public.current_user_has_permission('employee.store_transfer.confirm')
  OR public.current_user_has_permission('employee.manage')
  OR created_by = auth.uid()
  OR confirmed_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.store_managers sm
    WHERE sm.user_id = auth.uid()
      AND sm.store_id IN (store_transfer_requests.from_store_id, store_transfer_requests.to_store_id)
  )
);

DROP POLICY IF EXISTS p1c_store_transfer_insert_create ON public.store_transfer_requests;
CREATE POLICY p1c_store_transfer_insert_create ON public.store_transfer_requests
FOR INSERT TO authenticated
WITH CHECK (
  public.current_user_has_permission('employee.store_transfer.create')
  AND (created_by IS NULL OR created_by = auth.uid())
);

DROP POLICY IF EXISTS p1c_store_transfer_update_confirm ON public.store_transfer_requests;
CREATE POLICY p1c_store_transfer_update_confirm ON public.store_transfer_requests
FOR UPDATE TO authenticated
USING (
  public.current_user_has_permission('employee.store_transfer.confirm')
  OR public.current_user_has_permission('employee.manage')
)
WITH CHECK (
  public.current_user_has_permission('employee.store_transfer.confirm')
  OR public.current_user_has_permission('employee.manage')
);

DROP POLICY IF EXISTS p1c_templates_select_task_users ON public.templates;
CREATE POLICY p1c_templates_select_task_users ON public.templates
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('task.view_own')
  OR public.current_user_has_permission('task.manage')
  OR public.current_user_has_permission('task.template.edit')
);

DROP POLICY IF EXISTS p1c_templates_manage ON public.templates;
CREATE POLICY p1c_templates_manage ON public.templates
TO authenticated
USING (
  public.current_user_has_permission('task.manage')
  OR public.current_user_has_permission('task.template.edit')
)
WITH CHECK (
  public.current_user_has_permission('task.manage')
  OR public.current_user_has_permission('task.template.edit')
);

DROP POLICY IF EXISTS p1c_assignments_select_scope ON public.assignments;
CREATE POLICY p1c_assignments_select_scope ON public.assignments
FOR SELECT TO authenticated
USING (public.p1c_assignment_is_visible(id));

DROP POLICY IF EXISTS p1c_assignments_manage ON public.assignments;
CREATE POLICY p1c_assignments_manage ON public.assignments
TO authenticated
USING (public.current_user_has_permission('task.manage'))
WITH CHECK (public.current_user_has_permission('task.manage'));

DROP POLICY IF EXISTS p1c_assignment_collaborators_select_scope ON public.assignment_collaborators;
CREATE POLICY p1c_assignment_collaborators_select_scope ON public.assignment_collaborators
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('task.manage')
  OR user_id = auth.uid()
  OR public.p1c_assignment_is_visible(assignment_id)
);

DROP POLICY IF EXISTS p1c_assignment_collaborators_manage ON public.assignment_collaborators;
CREATE POLICY p1c_assignment_collaborators_manage ON public.assignment_collaborators
TO authenticated
USING (
  public.current_user_has_permission('task.manage')
  OR public.p1c_assignment_is_visible(assignment_id)
)
WITH CHECK (
  public.current_user_has_permission('task.manage')
  OR public.p1c_assignment_is_visible(assignment_id)
);

DROP POLICY IF EXISTS p1c_logs_select_scope ON public.logs;
CREATE POLICY p1c_logs_select_scope ON public.logs
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('task.manage')
  OR user_id = auth.uid()
  OR public.p1c_assignment_is_visible(assignment_id)
);

DROP POLICY IF EXISTS p1c_logs_insert_self ON public.logs;
CREATE POLICY p1c_logs_insert_self ON public.logs
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid() OR public.current_user_has_permission('task.manage'));

REVOKE ALL ON TABLE public.permission_logs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.store_employees FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.employee_movement_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.store_relocation_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.store_transfer_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.templates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.assignments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.assignment_collaborators FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.logs FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT ON TABLE public.permission_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_employees TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.employee_movement_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_relocation_history TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.store_transfer_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.assignment_collaborators TO authenticated;
GRANT SELECT, INSERT ON TABLE public.logs TO authenticated;

GRANT ALL ON TABLE public.permission_logs TO service_role;
GRANT ALL ON TABLE public.store_employees TO service_role;
GRANT ALL ON TABLE public.employee_movement_history TO service_role;
GRANT ALL ON TABLE public.store_relocation_history TO service_role;
GRANT ALL ON TABLE public.store_transfer_requests TO service_role;
GRANT ALL ON TABLE public.templates TO service_role;
GRANT ALL ON TABLE public.assignments TO service_role;
GRANT ALL ON TABLE public.assignment_collaborators TO service_role;
GRANT ALL ON TABLE public.logs TO service_role;

REVOKE ALL ON FUNCTION public.p1c_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p1c_assignment_is_visible(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p1c_assignment_is_visible(uuid) TO authenticated;
