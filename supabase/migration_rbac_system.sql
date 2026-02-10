-- ============================================
-- RBAC 系統資料庫遷移腳本
-- 建立日期: 2026-02-10
-- 說明: 建立角色權限管理系統的核心表結構
-- ============================================

-- ============================================
-- 1. 建立 Roles 表 - 角色定義
-- ============================================
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,              -- 角色名稱
  code VARCHAR(50) NOT NULL UNIQUE,               -- 角色代碼
  description TEXT,                               -- 角色描述
  is_system BOOLEAN DEFAULT false,                -- 是否為系統預設角色
  is_active BOOLEAN DEFAULT true,                 -- 是否啟用
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_roles_code ON roles(code);
CREATE INDEX IF NOT EXISTS idx_roles_is_active ON roles(is_active);

-- 說明
COMMENT ON TABLE roles IS '角色定義表 - 儲存系統中所有角色';
COMMENT ON COLUMN roles.name IS '角色名稱 (中文顯示名稱)';
COMMENT ON COLUMN roles.code IS '角色代碼 (英文識別碼,用於程式判斷)';
COMMENT ON COLUMN roles.is_system IS '系統預設角色不可刪除 (admin, manager, member)';
COMMENT ON COLUMN roles.is_active IS '是否啟用此角色';

-- ============================================
-- 2. 建立 Permissions 表 - 權限定義
-- ============================================
CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module VARCHAR(50) NOT NULL,                    -- 模組名稱
  feature VARCHAR(100) NOT NULL,                  -- 功能名稱
  code VARCHAR(100) NOT NULL UNIQUE,              -- 權限代碼
  action VARCHAR(50) NOT NULL,                    -- 操作類型
  description TEXT,                               -- 權限描述
  is_active BOOLEAN DEFAULT true,                 -- 是否啟用
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_permissions_module ON permissions(module);
CREATE INDEX IF NOT EXISTS idx_permissions_code ON permissions(code);
CREATE UNIQUE INDEX IF NOT EXISTS idx_permissions_module_feature_action 
  ON permissions(module, feature, action);

-- 說明
COMMENT ON TABLE permissions IS '權限定義表 - 儲存系統中所有權限點';
COMMENT ON COLUMN permissions.module IS '模組名稱 (task/store/employee/monthly/activity/user/supervisor)';
COMMENT ON COLUMN permissions.feature IS '功能名稱 (template/dashboard/store等)';
COMMENT ON COLUMN permissions.code IS '權限代碼 (格式: module.feature.action)';
COMMENT ON COLUMN permissions.action IS '操作類型 (view/create/edit/delete/export/import/assign等)';

-- ============================================
-- 3. 建立 Role_Permissions 表 - 角色權限對應
-- ============================================
CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  is_allowed BOOLEAN NOT NULL DEFAULT true,       -- 允許或禁止
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  
  UNIQUE(role_id, permission_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_allowed ON role_permissions(role_id, is_allowed);

-- 說明
COMMENT ON TABLE role_permissions IS '角色權限對應表 - 定義每個角色擁有哪些權限';
COMMENT ON COLUMN role_permissions.is_allowed IS 'true=允許, false=禁止 (支援明確拒絕權限)';

-- ============================================
-- 4. 建立 User_Roles 表 - 使用者角色對應
-- ============================================
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  employee_code VARCHAR(20),                      -- 員工編號
  is_active BOOLEAN DEFAULT true,                 -- 是否啟用
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  assigned_by UUID REFERENCES auth.users(id),
  expires_at TIMESTAMP WITH TIME ZONE,            -- 過期時間
  
  UNIQUE(user_id, role_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_employee ON user_roles(employee_code);
CREATE INDEX IF NOT EXISTS idx_user_roles_active ON user_roles(user_id, is_active);

-- 說明
COMMENT ON TABLE user_roles IS '使用者角色對應表 - 定義哪些使用者擁有哪些角色';
COMMENT ON COLUMN user_roles.employee_code IS '員工編號 (可透過此欄位批次指派角色)';
COMMENT ON COLUMN user_roles.expires_at IS '角色過期時間,NULL表示永久有效';

-- ============================================
-- 5. 建立 Permission_Logs 表 - 權限操作日誌
-- ============================================
CREATE TABLE IF NOT EXISTS permission_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  permission_code VARCHAR(100) NOT NULL,
  action VARCHAR(50) NOT NULL,                    -- 'check', 'grant', 'revoke'
  result BOOLEAN,                                 -- true=允許, false=拒絕
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_permission_logs_user ON permission_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_permission_logs_created ON permission_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_permission_logs_permission ON permission_logs(permission_code);

-- 說明
COMMENT ON TABLE permission_logs IS '權限操作日誌表 - 用於審計和追蹤權限檢查記錄';

-- ============================================
-- 6. 插入預設角色
-- ============================================
INSERT INTO roles (name, code, description, is_system) VALUES
  ('系統管理員', 'admin', '擁有所有系統權限,可管理使用者、角色和所有功能', true),
  ('主管', 'manager', '可管理任務流程和審核報表', true),
  ('一般成員', 'member', '執行被指派的任務,查看自己相關的資料', true),
  ('營業部主管', 'business_supervisor', '營業部門主管,可管理門市、員工和活動', false),
  ('營業部助理', 'business_assistant', '營業部門助理,可查看和編輯部分門市及員工資料', false),
  ('督導角色', 'supervisor_role', '門市督導,管理多個門市的每月狀態和活動', false),
  ('店長角色', 'store_manager_role', '單一門市管理者,負責門市日常運營', false)
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- 7. 插入完整權限點
-- ============================================

-- 7.1 任務管理模組 (task)
INSERT INTO permissions (module, feature, code, action, description) VALUES
  -- 我的任務
  ('task', 'my_tasks', 'task.my_tasks.view', 'view', '查看我的任務'),
  ('task', 'my_tasks', 'task.my_tasks.submit', 'edit', '提交任務進度'),
  
  -- 儀表板
  ('task', 'dashboard', 'task.dashboard.view', 'view', '查看任務儀表板'),
  ('task', 'dashboard', 'task.dashboard.view_all', 'view_all', '查看所有任務統計'),
  
  -- 任務管理
  ('task', 'template', 'task.template.view', 'view', '查看任務範本'),
  ('task', 'template', 'task.template.create', 'create', '建立任務範本'),
  ('task', 'template', 'task.template.edit', 'edit', '編輯任務範本'),
  ('task', 'template', 'task.template.delete', 'delete', '刪除任務範本'),
  
  -- 任務指派
  ('task', 'assignment', 'task.assignment.create', 'create', '建立任務指派'),
  ('task', 'assignment', 'task.assignment.view_all', 'view_all', '查看所有任務指派'),
  ('task', 'assignment', 'task.assignment.view_own', 'view_own', '查看自己的任務指派'),
  ('task', 'assignment', 'task.assignment.edit', 'edit', '編輯任務指派'),
  
  -- 已封存任務
  ('task', 'archived', 'task.archived.view', 'view', '查看已封存任務'),
  ('task', 'archived', 'task.archived.restore', 'edit', '還原已封存任務')
ON CONFLICT (code) DO NOTHING;

-- 7.2 門市管理模組 (store)
INSERT INTO permissions (module, feature, code, action, description) VALUES
  -- 門市管理
  ('store', 'store', 'store.store.view', 'view', '查看門市列表'),
  ('store', 'store', 'store.store.view_inactive', 'view_inactive', '查看已停用門市'),
  ('store', 'store', 'store.store.create', 'create', '建立門市'),
  ('store', 'store', 'store.store.edit', 'edit', '編輯門市資料'),
  ('store', 'store', 'store.store.delete', 'delete', '刪除/停用門市'),
  
  -- 店長指派
  ('store', 'manager', 'store.manager.view', 'view', '查看店長指派'),
  ('store', 'manager', 'store.manager.assign', 'assign', '指派店長'),
  ('store', 'manager', 'store.manager.remove', 'delete', '移除店長指派')
ON CONFLICT (code) DO NOTHING;

-- 7.3 員工管理模組 (employee)
INSERT INTO permissions (module, feature, code, action, description) VALUES
  -- 員工管理
  ('employee', 'employee', 'employee.employee.view', 'view', '查看員工列表'),
  ('employee', 'employee', 'employee.employee.create', 'create', '新增員工'),
  ('employee', 'employee', 'employee.employee.edit', 'edit', '編輯員工資料'),
  ('employee', 'employee', 'employee.employee.delete', 'delete', '刪除員工'),
  ('employee', 'employee', 'employee.employee.import', 'import', '批次匯入員工'),
  
  -- 人員異動
  ('employee', 'promotion', 'employee.promotion.view', 'view', '查看人員異動記錄'),
  ('employee', 'promotion', 'employee.promotion.create', 'create', '新增人員異動'),
  ('employee', 'promotion', 'employee.promotion.edit', 'edit', '編輯人員異動'),
  ('employee', 'promotion', 'employee.promotion.batch', 'import', '批次處理人員異動'),
  
  -- 門市員工
  ('employee', 'store_employee', 'employee.store_employee.view', 'view', '查看門市員工'),
  ('employee', 'store_employee', 'employee.store_employee.add', 'create', '新增門市員工'),
  ('employee', 'store_employee', 'employee.store_employee.remove', 'delete', '移除門市員工')
ON CONFLICT (code) DO NOTHING;

-- 7.4 每月狀態模組 (monthly)
INSERT INTO permissions (module, feature, code, action, description) VALUES
  -- 每月人員狀態
  ('monthly', 'status', 'monthly.status.view_all', 'view_all', '查看所有門市狀態'),
  ('monthly', 'status', 'monthly.status.view_own', 'view_own', '查看管理門市狀態'),
  ('monthly', 'status', 'monthly.status.edit', 'edit', '編輯門市狀態'),
  ('monthly', 'status', 'monthly.status.submit', 'submit', '提交門市狀態'),
  ('monthly', 'status', 'monthly.status.confirm', 'confirm', '確認/覆核門市狀態'),
  
  -- 資料匯入
  ('monthly', 'import_performance', 'monthly.import.performance', 'import', '匯入績效資料'),
  ('monthly', 'import_stats', 'monthly.import.store_stats', 'import', '匯入門市統計'),
  
  -- 資料匯出
  ('monthly', 'export_stores', 'monthly.export.stores', 'export', '匯出門市資料'),
  ('monthly', 'export_support', 'monthly.export.support_hours', 'export', '匯出支援時數'),
  ('monthly', 'export_meal', 'monthly.export.meal_allowance', 'export', '匯出餐費補助'),
  ('monthly', 'export_download', 'monthly.export.download', 'export', '下載完整報表'),
  
  -- 補助項目編輯
  ('monthly', 'edit_support_hours', 'monthly.allowance.edit_support_hours', 'edit', '編輯支援時數'),
  ('monthly', 'edit_meal', 'monthly.allowance.edit_meal', 'edit', '編輯餐費補助'),
  ('monthly', 'edit_transport', 'monthly.allowance.edit_transport', 'edit', '編輯交通費'),
  ('monthly', 'edit_talent', 'monthly.allowance.edit_talent', 'edit', '編輯培育金'),
  ('monthly', 'edit_support_bonus', 'monthly.allowance.edit_support_bonus', 'edit', '編輯支援獎金')
ON CONFLICT (code) DO NOTHING;

-- 7.5 活動管理模組 (activity)
INSERT INTO permissions (module, feature, code, action, description) VALUES
  -- 活動管理
  ('activity', 'campaign', 'activity.campaign.view', 'view', '查看活動列表'),
  ('activity', 'campaign', 'activity.campaign.view_all', 'view_all', '查看所有活動'),
  ('activity', 'campaign', 'activity.campaign.view_own', 'view_own', '查看管理門市的活動'),
  ('activity', 'campaign', 'activity.campaign.create', 'create', '建立活動'),
  ('activity', 'campaign', 'activity.campaign.edit', 'edit', '編輯活動'),
  ('activity', 'campaign', 'activity.campaign.delete', 'delete', '刪除活動'),
  
  -- 活動排程
  ('activity', 'schedule', 'activity.schedule.view', 'view', '查看活動排程'),
  ('activity', 'schedule', 'activity.schedule.edit', 'edit', '編輯活動排程'),
  ('activity', 'schedule', 'activity.schedule.create', 'create', '建立活動排程')
ON CONFLICT (code) DO NOTHING;

-- 7.6 使用者管理模組 (user)
INSERT INTO permissions (module, feature, code, action, description) VALUES
  -- 使用者管理
  ('user', 'user', 'user.user.view', 'view', '查看使用者列表'),
  ('user', 'user', 'user.user.create', 'create', '新增使用者'),
  ('user', 'user', 'user.user.edit', 'edit', '編輯使用者資料'),
  ('user', 'user', 'user.user.delete', 'delete', '刪除使用者'),
  ('user', 'change_role', 'user.user.change_role', 'assign', '變更使用者角色')
ON CONFLICT (code) DO NOTHING;

-- 7.7 督導管理模組 (supervisor)
INSERT INTO permissions (module, feature, code, action, description) VALUES
  -- 督導管理
  ('supervisor', 'supervisor', 'supervisor.supervisor.view', 'view', '查看督導列表'),
  ('supervisor', 'supervisor', 'supervisor.supervisor.assign', 'assign', '指派督導門市'),
  ('supervisor', 'supervisor', 'supervisor.supervisor.remove', 'delete', '移除督導指派')
ON CONFLICT (code) DO NOTHING;

-- 7.8 角色權限管理模組 (role)
INSERT INTO permissions (module, feature, code, action, description) VALUES
  -- 角色管理
  ('role', 'role', 'role.role.view', 'view', '查看角色列表'),
  ('role', 'role', 'role.role.create', 'create', '建立角色'),
  ('role', 'role', 'role.role.edit', 'edit', '編輯角色'),
  ('role', 'role', 'role.role.delete', 'delete', '刪除角色'),
  
  -- 權限管理
  ('role', 'permission', 'role.permission.view', 'view', '查看權限列表'),
  ('role', 'permission', 'role.permission.assign', 'assign', '分配權限給角色'),
  
  -- 使用者角色指派
  ('role', 'user_role', 'role.user_role.view', 'view', '查看使用者角色'),
  ('role', 'user_role', 'role.user_role.assign', 'assign', '指派角色給使用者'),
  ('role', 'user_role', 'role.user_role.revoke', 'delete', '移除使用者角色')
ON CONFLICT (code) DO NOTHING;

-- ============================================
-- 8. 建立預設角色權限對應
-- ============================================

-- 8.1 系統管理員 (admin) - 所有權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'admin'),
  id,
  true
FROM permissions
WHERE is_active = true
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 8.2 主管 (manager) - 任務管理權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'manager'),
  id,
  true
FROM permissions
WHERE code IN (
  'task.my_tasks.view',
  'task.my_tasks.submit',
  'task.dashboard.view',
  'task.dashboard.view_all',
  'task.template.view',
  'task.template.create',
  'task.template.edit',
  'task.template.delete',
  'task.assignment.create',
  'task.assignment.view_all',
  'task.assignment.edit',
  'task.archived.view',
  'task.archived.restore',
  'monthly.status.view_all'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 8.3 一般成員 (member) - 基礎權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'member'),
  id,
  true
FROM permissions
WHERE code IN (
  'task.my_tasks.view',
  'task.my_tasks.submit',
  'task.assignment.view_own',
  'monthly.status.view_own'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 8.4 營業部主管 (business_supervisor)
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'business_supervisor'),
  id,
  true
FROM permissions
WHERE code IN (
  'store.store.view',
  'store.store.view_inactive',
  'store.store.create',
  'store.store.edit',
  'store.store.delete',
  'store.manager.view',
  'store.manager.assign',
  'store.manager.remove',
  'employee.employee.view',
  'employee.employee.create',
  'employee.employee.edit',
  'employee.employee.delete',
  'employee.employee.import',
  'employee.promotion.view',
  'employee.promotion.create',
  'employee.promotion.edit',
  'employee.promotion.batch',
  'employee.store_employee.view',
  'employee.store_employee.add',
  'employee.store_employee.remove',
  'monthly.status.view_all',
  'monthly.export.stores',
  'monthly.export.support_hours',
  'monthly.export.download',
  'activity.campaign.view_all',
  'activity.campaign.create',
  'activity.campaign.edit',
  'activity.schedule.view',
  'activity.schedule.edit',
  'activity.schedule.create'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 8.5 營業部助理 (business_assistant)
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'business_assistant'),
  id,
  true
FROM permissions
WHERE code IN (
  'task.my_tasks.view',
  'task.dashboard.view',
  'task.template.view',
  'task.archived.view',
  'store.store.view',
  'store.store.view_inactive',
  'employee.employee.view',
  'employee.employee.create',
  'employee.employee.edit',
  'employee.employee.delete',
  'employee.promotion.view',
  'employee.promotion.create',
  'employee.promotion.edit',
  'employee.promotion.batch',
  'employee.store_employee.view',
  'employee.store_employee.add',
  'employee.store_employee.remove',
  'monthly.status.view_all',
  'monthly.import.performance',
  'monthly.import.store_stats'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 8.6 督導角色 (supervisor_role)
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'supervisor_role'),
  id,
  true
FROM permissions
WHERE code IN (
  'monthly.status.view_own',
  'monthly.status.edit',
  'monthly.status.submit',
  'monthly.status.confirm',
  'monthly.allowance.edit_support_hours',
  'monthly.allowance.edit_meal',
  'monthly.allowance.edit_transport',
  'monthly.allowance.edit_talent',
  'monthly.allowance.edit_support_bonus',
  'activity.campaign.view_own',
  'activity.schedule.view',
  'activity.schedule.edit'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 8.7 店長角色 (store_manager_role)
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'store_manager_role'),
  id,
  true
FROM permissions
WHERE code IN (
  'monthly.status.view_own',
  'monthly.status.edit',
  'monthly.status.submit',
  'monthly.allowance.edit_support_hours',
  'monthly.allowance.edit_meal',
  'monthly.allowance.edit_transport',
  'monthly.allowance.edit_talent',
  'monthly.allowance.edit_support_bonus',
  'activity.campaign.view_own',
  'activity.schedule.view'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================
-- 9. 建立 RLS Policies
-- ============================================

-- 9.1 Roles 表
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

-- 所有登入使用者可查看角色
DROP POLICY IF EXISTS "Anyone can view roles" ON roles;
CREATE POLICY "Anyone can view roles" ON roles FOR SELECT 
  USING (auth.uid() IS NOT NULL);

-- 只有 admin 可以管理角色
DROP POLICY IF EXISTS "Only admins can manage roles" ON roles;
CREATE POLICY "Only admins can manage roles" ON roles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- 9.2 Permissions 表
ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;

-- 所有登入使用者可查看權限
DROP POLICY IF EXISTS "Anyone can view permissions" ON permissions;
CREATE POLICY "Anyone can view permissions" ON permissions FOR SELECT 
  USING (auth.uid() IS NOT NULL);

-- 只有 admin 可以管理權限
DROP POLICY IF EXISTS "Only admins can manage permissions" ON permissions;
CREATE POLICY "Only admins can manage permissions" ON permissions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- 9.3 Role_Permissions 表
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- 所有登入使用者可查看角色權限
DROP POLICY IF EXISTS "Anyone can view role_permissions" ON role_permissions;
CREATE POLICY "Anyone can view role_permissions" ON role_permissions FOR SELECT 
  USING (auth.uid() IS NOT NULL);

-- 只有 admin 可以管理角色權限
DROP POLICY IF EXISTS "Only admins can manage role_permissions" ON role_permissions;
CREATE POLICY "Only admins can manage role_permissions" ON role_permissions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- 9.4 User_Roles 表
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

-- 使用者可查看自己的角色
DROP POLICY IF EXISTS "Users can view their own roles" ON user_roles;
CREATE POLICY "Users can view their own roles" ON user_roles FOR SELECT 
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- 只有 admin 可以管理使用者角色
DROP POLICY IF EXISTS "Only admins can manage user_roles" ON user_roles;
CREATE POLICY "Only admins can manage user_roles" ON user_roles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- 9.5 Permission_Logs 表
ALTER TABLE permission_logs ENABLE ROW LEVEL SECURITY;

-- 只有 admin 可以查看日誌
DROP POLICY IF EXISTS "Only admins can view logs" ON permission_logs;
CREATE POLICY "Only admins can view logs" ON permission_logs FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- 系統可以寫入日誌
DROP POLICY IF EXISTS "System can insert logs" ON permission_logs;
CREATE POLICY "System can insert logs" ON permission_logs FOR INSERT 
  WITH CHECK (true);

-- ============================================
-- 10. 建立輔助函數
-- ============================================

-- 檢查使用者是否有指定權限
CREATE OR REPLACE FUNCTION has_permission(
  p_user_id UUID,
  p_permission_code VARCHAR
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_has_permission BOOLEAN := false;
BEGIN
  SELECT EXISTS(
    SELECT 1
    FROM user_roles ur
    INNER JOIN role_permissions rp ON ur.role_id = rp.role_id
    INNER JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = p_user_id
      AND ur.is_active = true
      AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
      AND rp.is_allowed = true
      AND p.code = p_permission_code
      AND p.is_active = true
  ) INTO v_has_permission;
  
  RETURN v_has_permission;
END;
$$;

-- 取得使用者所有權限
CREATE OR REPLACE FUNCTION get_user_permissions(p_user_id UUID)
RETURNS TABLE(permission_code VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT p.code
  FROM user_roles ur
  INNER JOIN role_permissions rp ON ur.role_id = rp.role_id
  INNER JOIN permissions p ON rp.permission_id = p.id
  WHERE ur.user_id = p_user_id
    AND ur.is_active = true
    AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
    AND rp.is_allowed = true
    AND p.is_active = true;
END;
$$;

-- ============================================
-- 完成
-- ============================================
-- 遷移腳本執行完成
-- 請驗證以下項目:
-- 1. 所有表已建立
-- 2. 索引已建立
-- 3. 預設角色已插入 (7個)
-- 4. 權限點已插入 (60+個)
-- 5. 預設角色權限對應已建立
-- 6. RLS policies 已啟用
-- 7. 輔助函數已建立
-- ============================================
