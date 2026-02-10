# 角色權限管理系統 (RBAC) 設計文件

## 📐 一、系統架構概覽

### 1.1 核心概念
```
使用者 (User) → 角色 (Role) → 權限 (Permission) → 功能 (Feature)
     ↓              ↓               ↓                  ↓
  員工編號        角色名稱      allow/deny        具體操作
```

### 1.2 設計原則
- ✅ **最小權限原則**: 預設拒絕,明確授權
- ✅ **角色繼承**: 支援未來擴展(本期不實作)
- ✅ **權限粒度**: 模組 → 功能 → 操作
- ✅ **向下相容**: 保留現有 role 欄位作為預設角色
- ✅ **靈活性**: 支援一人多角色

---

## 🗄️ 二、資料庫表結構設計

### 2.1 Roles 表 - 角色定義
```sql
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,              -- 角色名稱 (例: 營業部主管、資深督導)
  code VARCHAR(50) NOT NULL UNIQUE,               -- 角色代碼 (例: business_supervisor)
  description TEXT,                               -- 角色描述
  is_system BOOLEAN DEFAULT false,                -- 是否為系統預設角色
  is_active BOOLEAN DEFAULT true,                 -- 是否啟用
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- 索引
CREATE INDEX idx_roles_code ON roles(code);
CREATE INDEX idx_roles_is_active ON roles(is_active);

-- 說明
COMMENT ON TABLE roles IS '角色定義表';
COMMENT ON COLUMN roles.is_system IS '系統預設角色不可刪除,例如: admin, manager, member';
```

**預設角色資料**:
```sql
INSERT INTO roles (name, code, description, is_system) VALUES
  ('系統管理員', 'admin', '擁有所有系統權限', true),
  ('主管', 'manager', '可管理任務流程和審核報表', true),
  ('一般成員', 'member', '執行被指派的任務', true),
  ('營業部主管', 'business_supervisor', '營業部門主管,可管理門市和員工', false),
  ('營業部助理', 'business_assistant', '營業部門助理,可查看和編輯部分資料', false),
  ('督導', 'supervisor_role', '門市督導,管理多個門市', false),
  ('店長', 'store_manager_role', '單一門市管理者', false);
```

---

### 2.2 Permissions 表 - 權限定義
```sql
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module VARCHAR(50) NOT NULL,                    -- 模組名稱
  feature VARCHAR(100) NOT NULL,                  -- 功能名稱
  code VARCHAR(100) NOT NULL UNIQUE,              -- 權限代碼 (module.feature.action)
  action VARCHAR(50) NOT NULL,                    -- 操作類型 (view/create/edit/delete/export/import)
  description TEXT,                               -- 權限描述
  is_active BOOLEAN DEFAULT true,                 -- 是否啟用
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_permissions_module ON permissions(module);
CREATE INDEX idx_permissions_code ON permissions(code);
CREATE UNIQUE INDEX idx_permissions_module_feature_action ON permissions(module, feature, action);

-- 說明
COMMENT ON TABLE permissions IS '權限定義表';
COMMENT ON COLUMN permissions.code IS '格式: module.feature.action, 例如: task.template.create';
```

**權限代碼命名規範**:
```
格式: {module}.{feature}.{action}

Module (模組):
- task: 任務管理
- store: 門市管理
- employee: 員工管理
- monthly: 每月狀態
- activity: 活動管理
- user: 使用者管理
- supervisor: 督導管理

Action (操作):
- view: 查看
- view_all: 查看所有
- view_own: 查看自己的
- create: 建立
- edit: 編輯
- delete: 刪除
- export: 匯出
- import: 匯入
- assign: 指派
- confirm: 確認/審核
- archive: 封存
```

---

### 2.3 Role_Permissions 表 - 角色權限對應
```sql
CREATE TABLE role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  is_allowed BOOLEAN NOT NULL DEFAULT true,       -- true=允許, false=禁止
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  
  UNIQUE(role_id, permission_id)
);

-- 索引
CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission ON role_permissions(permission_id);
CREATE INDEX idx_role_permissions_allowed ON role_permissions(role_id, is_allowed);

-- 說明
COMMENT ON TABLE role_permissions IS '角色權限對應表';
COMMENT ON COLUMN role_permissions.is_allowed IS '允許=true, 禁止=false (支援明確拒絕權限)';
```

---

### 2.4 User_Roles 表 - 使用者角色對應
```sql
CREATE TABLE user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  employee_code VARCHAR(20),                      -- 員工編號 (可空,供未來擴展)
  is_active BOOLEAN DEFAULT true,                 -- 是否啟用
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  assigned_by UUID REFERENCES auth.users(id),
  expires_at TIMESTAMP WITH TIME ZONE,            -- 過期時間 (可空,永久有效)
  
  UNIQUE(user_id, role_id)
);

-- 索引
CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);
CREATE INDEX idx_user_roles_employee ON user_roles(employee_code);
CREATE INDEX idx_user_roles_active ON user_roles(user_id, is_active);

-- 說明
COMMENT ON TABLE user_roles IS '使用者角色對應表';
COMMENT ON COLUMN user_roles.employee_code IS '員工編號,可透過此欄位批次指派角色';
COMMENT ON COLUMN user_roles.expires_at IS '角色過期時間,NULL表示永久有效';
```

---

### 2.5 Permission_Logs 表 - 權限操作日誌 (選用)
```sql
CREATE TABLE permission_logs (
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
CREATE INDEX idx_permission_logs_user ON permission_logs(user_id);
CREATE INDEX idx_permission_logs_created ON permission_logs(created_at);
CREATE INDEX idx_permission_logs_permission ON permission_logs(permission_code);

-- 說明
COMMENT ON TABLE permission_logs IS '權限操作日誌表 (用於審計和追蹤)';
```

---

## 📋 三、完整權限點定義

### 3.1 任務管理模組 (task)

```sql
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
  ('task', 'archived', 'task.archived.restore', 'edit', '還原已封存任務');
```

---

### 3.2 門市管理模組 (store)

```sql
INSERT INTO permissions (module, feature, code, action, description) VALUES
  -- 門市管理
  ('store', 'store', 'store.store.view', 'view', '查看門市列表'),
  ('store', 'store', 'store.store.view_inactive', 'view', '查看已停用門市'),
  ('store', 'store', 'store.store.create', 'create', '建立門市'),
  ('store', 'store', 'store.store.edit', 'edit', '編輯門市資料'),
  ('store', 'store', 'store.store.delete', 'delete', '刪除/停用門市'),
  
  -- 店長指派
  ('store', 'manager', 'store.manager.view', 'view', '查看店長指派'),
  ('store', 'manager', 'store.manager.assign', 'assign', '指派店長'),
  ('store', 'manager', 'store.manager.remove', 'delete', '移除店長指派');
```

---

### 3.3 員工管理模組 (employee)

```sql
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
  ('employee', 'store_employee', 'employee.store_employee.remove', 'delete', '移除門市員工');
```

---

### 3.4 每月狀態模組 (monthly)

```sql
INSERT INTO permissions (module, feature, code, action, description) VALUES
  -- 每月人員狀態
  ('monthly', 'status', 'monthly.status.view_all', 'view_all', '查看所有門市狀態'),
  ('monthly', 'status', 'monthly.status.view_own', 'view_own', '查看管理門市狀態'),
  ('monthly', 'status', 'monthly.status.edit', 'edit', '編輯門市狀態'),
  ('monthly', 'status', 'monthly.status.submit', 'edit', '提交門市狀態'),
  ('monthly', 'status', 'monthly.status.confirm', 'confirm', '確認/覆核門市狀態'),
  
  -- 資料匯入
  ('monthly', 'import', 'monthly.import.performance', 'import', '匯入績效資料'),
  ('monthly', 'import', 'monthly.import.store_stats', 'import', '匯入門市統計'),
  
  -- 資料匯出
  ('monthly', 'export', 'monthly.export.stores', 'export', '匯出門市資料'),
  ('monthly', 'export', 'monthly.export.support_hours', 'export', '匯出支援時數'),
  ('monthly', 'export', 'monthly.export.meal_allowance', 'export', '匯出餐費補助'),
  ('monthly', 'export', 'monthly.export.download', 'export', '下載完整報表'),
  
  -- 補助項目編輯
  ('monthly', 'allowance', 'monthly.allowance.edit_support_hours', 'edit', '編輯支援時數'),
  ('monthly', 'allowance', 'monthly.allowance.edit_meal', 'edit', '編輯餐費補助'),
  ('monthly', 'allowance', 'monthly.allowance.edit_transport', 'edit', '編輯交通費'),
  ('monthly', 'allowance', 'monthly.allowance.edit_talent', 'edit', '編輯培育金'),
  ('monthly', 'allowance', 'monthly.allowance.edit_support_bonus', 'edit', '編輯支援獎金');
```

---

### 3.5 活動管理模組 (activity)

```sql
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
  ('activity', 'schedule', 'activity.schedule.create', 'create', '建立活動排程');
```

---

### 3.6 使用者管理模組 (user)

```sql
INSERT INTO permissions (module, feature, code, action, description) VALUES
  -- 使用者管理
  ('user', 'user', 'user.user.view', 'view', '查看使用者列表'),
  ('user', 'user', 'user.user.create', 'create', '新增使用者'),
  ('user', 'user', 'user.user.edit', 'edit', '編輯使用者資料'),
  ('user', 'user', 'user.user.delete', 'delete', '刪除使用者'),
  ('user', 'user', 'user.user.change_role', 'edit', '變更使用者角色');
```

---

### 3.7 督導管理模組 (supervisor)

```sql
INSERT INTO permissions (module, feature, code, action, description) VALUES
  -- 督導管理
  ('supervisor', 'supervisor', 'supervisor.supervisor.view', 'view', '查看督導列表'),
  ('supervisor', 'supervisor', 'supervisor.supervisor.assign', 'assign', '指派督導門市'),
  ('supervisor', 'supervisor', 'supervisor.supervisor.remove', 'delete', '移除督導指派');
```

---

### 3.8 角色權限管理模組 (role) - 新增

```sql
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
  ('role', 'user_role', 'role.user_role.revoke', 'delete', '移除使用者角色');
```

---

## 🎯 四、預設角色權限對應

### 4.1 系統管理員 (admin) - 所有權限
```sql
-- Admin 擁有所有權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'admin'),
  id,
  true
FROM permissions
WHERE is_active = true;
```

### 4.2 主管 (manager) - 任務管理權限
```sql
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'manager'),
  id,
  true
FROM permissions
WHERE code IN (
  -- 任務管理
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
  
  -- 每月狀態 (僅查看)
  'monthly.status.view_all'
);
```

### 4.3 一般成員 (member) - 基礎權限
```sql
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
);
```

### 4.4 營業部主管 (business_supervisor)
```sql
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'business_supervisor'),
  id,
  true
FROM permissions
WHERE code IN (
  -- 門市管理
  'store.store.view',
  'store.store.view_inactive',
  'store.store.create',
  'store.store.edit',
  'store.store.delete',
  'store.manager.view',
  'store.manager.assign',
  'store.manager.remove',
  
  -- 員工管理
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
  
  -- 每月狀態
  'monthly.status.view_all',
  'monthly.export.stores',
  'monthly.export.support_hours',
  'monthly.export.download',
  
  -- 活動管理
  'activity.campaign.view_all',
  'activity.campaign.create',
  'activity.campaign.edit',
  'activity.schedule.view',
  'activity.schedule.edit',
  'activity.schedule.create'
);
```

### 4.5 營業部助理 (business_assistant)
```sql
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'business_assistant'),
  id,
  true
FROM permissions
WHERE code IN (
  -- 任務管理
  'task.my_tasks.view',
  'task.dashboard.view',
  'task.template.view',
  'task.archived.view',
  
  -- 門市管理 (僅查看)
  'store.store.view',
  'store.store.view_inactive',
  
  -- 員工管理
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
  
  -- 每月狀態
  'monthly.status.view_all',
  'monthly.import.performance',
  'monthly.import.store_stats'
);
```

### 4.6 督導角色 (supervisor_role)
```sql
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'supervisor_role'),
  id,
  true
FROM permissions
WHERE code IN (
  -- 每月狀態 (管理門市)
  'monthly.status.view_own',
  'monthly.status.edit',
  'monthly.status.submit',
  'monthly.status.confirm',
  'monthly.allowance.edit_support_hours',
  'monthly.allowance.edit_meal',
  'monthly.allowance.edit_transport',
  'monthly.allowance.edit_talent',
  'monthly.allowance.edit_support_bonus',
  
  -- 活動管理
  'activity.campaign.view_own',
  'activity.schedule.view',
  'activity.schedule.edit'
);
```

### 4.7 店長角色 (store_manager_role)
```sql
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  (SELECT id FROM roles WHERE code = 'store_manager_role'),
  id,
  true
FROM permissions
WHERE code IN (
  -- 每月狀態 (單一門市)
  'monthly.status.view_own',
  'monthly.status.edit',
  'monthly.status.submit',
  'monthly.allowance.edit_support_hours',
  'monthly.allowance.edit_meal',
  'monthly.allowance.edit_transport',
  'monthly.allowance.edit_talent',
  'monthly.allowance.edit_support_bonus',
  
  -- 活動管理
  'activity.campaign.view_own',
  'activity.schedule.view'
);
```

---

## 🔧 五、API 設計

### 5.1 權限檢查核心函數

**檔案**: `lib/permissions/check.ts`

```typescript
import { createClient } from '@/lib/supabase/server';

/**
 * 檢查使用者是否有指定權限
 * @param userId - 使用者 ID
 * @param permissionCode - 權限代碼 (例: 'task.template.create')
 * @returns Promise<boolean>
 */
export async function hasPermission(
  userId: string,
  permissionCode: string
): Promise<boolean> {
  const supabase = await createClient();
  
  // 查詢使用者的所有有效角色及其權限
  const { data, error } = await supabase
    .from('user_roles')
    .select(`
      role_id,
      roles!inner (
        id,
        code,
        is_active,
        role_permissions!inner (
          permission_id,
          is_allowed,
          permissions!inner (
            code,
            is_active
          )
        )
      )
    `)
    .eq('user_id', userId)
    .eq('is_active', true)
    .or('expires_at.is.null,expires_at.gt.now()')
    .eq('roles.is_active', true)
    .eq('roles.role_permissions.permissions.code', permissionCode)
    .eq('roles.role_permissions.permissions.is_active', true);

  if (error) {
    console.error('權限檢查錯誤:', error);
    return false;
  }

  if (!data || data.length === 0) {
    return false;
  }

  // 檢查是否有任何角色明確允許此權限
  for (const userRole of data) {
    const role = userRole.roles;
    if (role && Array.isArray(role.role_permissions)) {
      for (const rp of role.role_permissions) {
        if (rp.is_allowed) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * 檢查使用者是否有多個權限中的任意一個 (OR)
 */
export async function hasAnyPermission(
  userId: string,
  permissionCodes: string[]
): Promise<boolean> {
  for (const code of permissionCodes) {
    if (await hasPermission(userId, code)) {
      return true;
    }
  }
  return false;
}

/**
 * 檢查使用者是否有所有指定權限 (AND)
 */
export async function hasAllPermissions(
  userId: string,
  permissionCodes: string[]
): Promise<boolean> {
  for (const code of permissionCodes) {
    if (!(await hasPermission(userId, code))) {
      return false;
    }
  }
  return true;
}

/**
 * 取得使用者的所有權限列表
 */
export async function getUserPermissions(
  userId: string
): Promise<string[]> {
  const supabase = await createClient();
  
  const { data, error } = await supabase
    .from('user_roles')
    .select(`
      roles!inner (
        role_permissions!inner (
          is_allowed,
          permissions!inner (
            code
          )
        )
      )
    `)
    .eq('user_id', userId)
    .eq('is_active', true)
    .or('expires_at.is.null,expires_at.gt.now()');

  if (error || !data) {
    return [];
  }

  const permissions = new Set<string>();
  
  data.forEach(userRole => {
    const role = userRole.roles;
    if (role && Array.isArray(role.role_permissions)) {
      role.role_permissions.forEach(rp => {
        if (rp.is_allowed && rp.permissions) {
          permissions.add(rp.permissions.code);
        }
      });
    }
  });

  return Array.from(permissions);
}

/**
 * 檢查使用者是否為 admin
 * (向下相容,檢查 profiles.role 或新的角色系統)
 */
export async function isAdmin(userId: string): Promise<boolean> {
  const supabase = await createClient();
  
  // 檢查舊系統的 role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  
  if (profile?.role === 'admin') {
    return true;
  }
  
  // 檢查新系統的角色
  const { data: userRoles } = await supabase
    .from('user_roles')
    .select('roles!inner(code)')
    .eq('user_id', userId)
    .eq('is_active', true)
    .or('expires_at.is.null,expires_at.gt.now()');
  
  return userRoles?.some(ur => ur.roles?.code === 'admin') || false;
}
```

---

### 5.2 Middleware 權限檢查

**檔案**: `lib/permissions/middleware.ts`

```typescript
import { NextResponse } from 'next/server';
import { hasPermission, hasAnyPermission } from './check';

/**
 * API 路由權限檢查中間件
 */
export async function requirePermission(
  userId: string | undefined,
  permissionCode: string
): Promise<NextResponse | null> {
  if (!userId) {
    return NextResponse.json(
      { success: false, error: '未登入' },
      { status: 401 }
    );
  }

  const allowed = await hasPermission(userId, permissionCode);
  
  if (!allowed) {
    return NextResponse.json(
      { success: false, error: '權限不足' },
      { status: 403 }
    );
  }

  return null; // 通過檢查
}

/**
 * API 路由多權限檢查 (任一)
 */
export async function requireAnyPermission(
  userId: string | undefined,
  permissionCodes: string[]
): Promise<NextResponse | null> {
  if (!userId) {
    return NextResponse.json(
      { success: false, error: '未登入' },
      { status: 401 }
    );
  }

  const allowed = await hasAnyPermission(userId, permissionCodes);
  
  if (!allowed) {
    return NextResponse.json(
      { success: false, error: '權限不足' },
      { status: 403 }
    );
  }

  return null;
}
```

---

### 5.3 React Hooks

**檔案**: `lib/permissions/hooks.ts`

```typescript
'use client';

import { useState, useEffect } from 'react';

/**
 * 使用權限檢查 Hook
 * @param permissionCode - 權限代碼
 * @returns { hasPermission: boolean, loading: boolean }
 */
export function usePermission(permissionCode: string) {
  const [hasPermission, setHasPermission] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkPermission();
  }, [permissionCode]);

  async function checkPermission() {
    setLoading(true);
    try {
      const response = await fetch('/api/permissions/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission: permissionCode }),
      });
      
      const data = await response.json();
      setHasPermission(data.hasPermission || false);
    } catch (error) {
      console.error('權限檢查失敗:', error);
      setHasPermission(false);
    } finally {
      setLoading(false);
    }
  }

  return { hasPermission, loading };
}

/**
 * 使用多權限檢查 Hook
 */
export function usePermissions(permissionCodes: string[]) {
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkPermissions();
  }, [JSON.stringify(permissionCodes)]);

  async function checkPermissions() {
    setLoading(true);
    try {
      const response = await fetch('/api/permissions/check-multiple', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: permissionCodes }),
      });
      
      const data = await response.json();
      setPermissions(data.permissions || {});
    } catch (error) {
      console.error('權限檢查失敗:', error);
      setPermissions({});
    } finally {
      setLoading(false);
    }
  }

  return { permissions, loading };
}
```

---

### 5.4 權限檢查 API Routes

**檔案**: `app/api/permissions/check/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ hasPermission: false }, { status: 401 });
    }

    const body = await request.json();
    const { permission } = body;

    if (!permission) {
      return NextResponse.json(
        { error: '缺少權限代碼' },
        { status: 400 }
      );
    }

    const result = await hasPermission(user.id, permission);
    
    return NextResponse.json({ hasPermission: result });
  } catch (error) {
    console.error('權限檢查錯誤:', error);
    return NextResponse.json(
      { error: '權限檢查失敗' },
      { status: 500 }
    );
  }
}
```

**檔案**: `app/api/permissions/check-multiple/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ permissions: {} }, { status: 401 });
    }

    const body = await request.json();
    const { permissions } = body;

    if (!Array.isArray(permissions)) {
      return NextResponse.json(
        { error: '權限代碼必須是陣列' },
        { status: 400 }
      );
    }

    const results: Record<string, boolean> = {};
    
    for (const permission of permissions) {
      results[permission] = await hasPermission(user.id, permission);
    }
    
    return NextResponse.json({ permissions: results });
  } catch (error) {
    console.error('權限檢查錯誤:', error);
    return NextResponse.json(
      { error: '權限檢查失敗' },
      { status: 500 }
    );
  }
}
```

---

## 🎨 六、UI 設計規劃

### 6.1 角色管理頁面
**路徑**: `/app/admin/roles/page.tsx`

**功能**:
- 角色列表展示 (表格)
- 新增角色按鈕
- 編輯角色按鈕
- 刪除角色按鈕 (系統角色不可刪除)
- 啟用/停用角色

**欄位**:
| 欄位 | 說明 |
|-----|------|
| 角色名稱 | 例: 營業部主管 |
| 角色代碼 | 例: business_supervisor |
| 角色描述 | 簡短說明 |
| 系統角色 | 是/否 (標記為系統角色不可刪除) |
| 狀態 | 啟用/停用 |
| 建立時間 | 時間戳記 |
| 操作 | 編輯/刪除按鈕 |

---

### 6.2 角色編輯頁面 (權限矩陣)
**路徑**: `/app/admin/roles/[id]/page.tsx`

**佈局**:
```
┌─────────────────────────────────────────────────────┐
│  角色資訊                                              │
│  ┌─────────────┐  ┌─────────────┐                    │
│  │ 角色名稱     │  │ 角色代碼     │                    │
│  └─────────────┘  └─────────────┘                    │
│  ┌───────────────────────────────┐                   │
│  │ 角色描述                       │                   │
│  └───────────────────────────────┘                   │
├─────────────────────────────────────────────────────┤
│  權限設定 (左側: 模組/功能, 右側: 允許/禁止勾選框)       │
│  ┌─────────────────────────────────────────────────┐│
│  │ 📋 任務管理模組                                   ││
│  │   ├─ 我的任務                                    ││
│  │   │   ├─ ☑ 查看我的任務                         ││
│  │   │   └─ ☑ 提交任務進度                         ││
│  │   ├─ 儀表板                                      ││
│  │   │   ├─ ☑ 查看任務儀表板                       ││
│  │   │   └─ ☐ 查看所有任務統計                     ││
│  │   └─ 任務管理                                    ││
│  │       ├─ ☑ 查看任務範本                         ││
│  │       ├─ ☑ 建立任務範本                         ││
│  │       ├─ ☑ 編輯任務範本                         ││
│  │       └─ ☐ 刪除任務範本                         ││
│  │                                                   ││
│  │ 🏪 門市管理模組                                   ││
│  │   ├─ 門市管理                                    ││
│  │   │   ├─ ☑ 查看門市列表                         ││
│  │   │   ├─ ☐ 建立門市                             ││
│  │   │   └─ ...                                    ││
│  │   ...                                            ││
│  └─────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────┤
│  使用者指派 (右側面板)                                 │
│  ┌─────────────────────────────────────────────────┐│
│  │ 🔍 搜尋員工編號或姓名                             ││
│  │ ┌──────────────────────────────┐                ││
│  │ │ [輸入框] [新增使用者按鈕]     │                ││
│  │ └──────────────────────────────┘                ││
│  │                                                   ││
│  │ 已指派使用者列表:                                 ││
│  │ ┌─────────────────────────────┐                 ││
│  │ │ A001 - 王小明  [移除]        │                 ││
│  │ │ A002 - 李小華  [移除]        │                 ││
│  │ │ B003 - 張三豐  [移除]        │                 ││
│  │ └─────────────────────────────┘                 ││
│  └─────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────┤
│  [儲存按鈕]  [取消按鈕]                                │
└─────────────────────────────────────────────────────┘
```

**功能**:
1. **角色資訊編輯**: 角色名稱、代碼、描述
2. **權限矩陣**: 
   - 按模組分組
   - 樹狀展開/收合
   - 勾選框表示 允許/禁止
   - 全選/取消全選功能
3. **使用者指派**:
   - 搜尋使用者 (員工編號/姓名)
   - 新增使用者到角色
   - 移除使用者
   - 顯示已指派使用者列表

---

### 6.3 角色列表頁面組件

**檔案**: `app/admin/roles/page.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Edit, Trash2, Shield } from 'lucide-react';

interface Role {
  id: string;
  name: string;
  code: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
}

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRoles();
  }, []);

  async function loadRoles() {
    // API call to fetch roles
  }

  async function deleteRole(id: string) {
    if (confirm('確定要刪除此角色嗎?')) {
      // API call to delete role
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">角色管理</h1>
            <p className="text-gray-600 mt-1">管理系統角色與權限設定</p>
          </div>
          <Link
            href="/admin/roles/create"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus size={20} />
            新增角色
          </Link>
        </div>

        {/* Roles Table */}
        <div className="bg-white rounded-lg shadow">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">角色名稱</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">角色代碼</th>
                <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">描述</th>
                <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900">類型</th>
                <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900">狀態</th>
                <th className="px-6 py-3 text-center text-sm font-semibold text-gray-900">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {roles.map(role => (
                <tr key={role.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {role.name}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    <code className="px-2 py-1 bg-gray-100 rounded">{role.code}</code>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">
                    {role.description || '-'}
                  </td>
                  <td className="px-6 py-4 text-center">
                    {role.is_system && (
                      <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-purple-800 bg-purple-100 rounded-full">
                        <Shield size={12} />
                        系統角色
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                      role.is_active 
                        ? 'bg-green-100 text-green-800' 
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {role.is_active ? '啟用' : '停用'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <Link
                        href={`/admin/roles/${role.id}`}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                      >
                        <Edit size={16} />
                      </Link>
                      {!role.is_system && (
                        <button
                          onClick={() => deleteRole(role.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
```

---

## 🔄 七、向下相容策略

### 7.1 雙軌制運行
在過渡期間,同時支援舊系統和新系統:

```typescript
// lib/permissions/compat.ts

/**
 * 相容性檢查 - 同時檢查舊系統和新系統
 */
export async function checkPermissionCompat(
  userId: string,
  permissionCode: string
): Promise<boolean> {
  // 1. 先檢查新系統
  const hasNewPermission = await hasPermission(userId, permissionCode);
  if (hasNewPermission) {
    return true;
  }

  // 2. 回退到舊系統檢查
  const hasLegacyPermission = await checkLegacyPermission(userId, permissionCode);
  return hasLegacyPermission;
}

/**
 * 舊系統權限檢查
 */
async function checkLegacyPermission(
  userId: string,
  permissionCode: string
): Promise<boolean> {
  const supabase = await createClient();
  
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, department, job_title')
    .eq('id', userId)
    .single();

  if (!profile) return false;

  // 根據舊的權限邏輯判斷
  // 例如: task.template.create
  if (permissionCode === 'task.template.create') {
    return profile.role === 'admin' || profile.role === 'manager';
  }

  // 其他權限判斷...
  
  return false;
}
```

### 7.2 預設角色自動對應
當使用者沒有新角色時,根據 profiles.role 自動對應:

```typescript
export async function getUserEffectiveRoles(userId: string): Promise<string[]> {
  const supabase = await createClient();
  
  // 1. 先查新系統的角色
  const { data: userRoles } = await supabase
    .from('user_roles')
    .select('roles!inner(code)')
    .eq('user_id', userId)
    .eq('is_active', true);
  
  if (userRoles && userRoles.length > 0) {
    return userRoles.map(ur => ur.roles.code);
  }
  
  // 2. 如果沒有新角色,使用舊系統的 role
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  
  if (profile?.role) {
    return [profile.role]; // 返回舊角色
  }
  
  return ['member']; // 預設為 member
}
```

---

## 📊 八、實作優先順序

### Phase 1: 資料庫基礎建設 ✅
- [ ] 建立 4 張核心表
- [ ] 插入預設角色
- [ ] 插入完整權限點
- [ ] 建立預設角色權限對應

### Phase 2: 權限檢查 API ✅
- [ ] 實作核心權限檢查函數
- [ ] 實作 middleware
- [ ] 建立權限檢查 API routes

### Phase 3: UI 介面 ✅
- [ ] 角色列表頁面
- [ ] 角色編輯頁面 (權限矩陣)
- [ ] 使用者角色指派介面

### Phase 4: 角色管理 API ✅
- [ ] 角色 CRUD API
- [ ] 權限指派 API
- [ ] 使用者角色指派 API

### Phase 5: React Hooks ✅
- [ ] usePermission hook
- [ ] usePermissions hook
- [ ] 權限 Context Provider

### Phase 6: 漸進式遷移 ✅
- [ ] 保留舊系統運作
- [ ] 新頁面使用新權限系統
- [ ] 相容性檢查函數

### Phase 7: 測試與驗證 ✅
- [ ] 本地測試所有角色
- [ ] 測試權限矩陣
- [ ] 測試使用者指派
- [ ] 測試向下相容

---

## 🎯 九、測試計畫

### 9.1 單元測試
- [ ] 權限檢查函數測試
- [ ] 角色指派測試
- [ ] 向下相容測試

### 9.2 整合測試
- [ ] API Routes 測試
- [ ] 權限矩陣 UI 測試
- [ ] 使用者角色指派流程測試

### 9.3 用戶驗收測試 (UAT)
- [ ] 建立測試角色
- [ ] 指派測試使用者
- [ ] 驗證各模組權限
- [ ] 驗證資料匯出權限

---

## ✅ 總結

本設計文件定義了完整的 RBAC 系統架構,包含:

1. ✅ **資料庫設計**: 4 張核心表 + RLS policies
2. ✅ **權限定義**: 60+ 個權限點,7 個模組
3. ✅ **API 設計**: 核心檢查函數 + middleware + hooks
4. ✅ **UI 設計**: 角色管理頁面 + 權限矩陣介面
5. ✅ **向下相容**: 雙軌制運行策略
6. ✅ **實作計畫**: 7 個階段,循序漸進

下一步: 開始實作 Phase 1 - 建立資料庫表結構和遷移腳本。
