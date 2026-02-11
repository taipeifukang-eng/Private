# Navbar RBAC 遷移指南

## 問題描述

目前 `components/Navbar.tsx` 使用**舊的權限系統**，依賴 `profiles` 表的欄位：
- `role` (admin/manager/member)
- `department` (營業一部、營業二部等)
- `job_title` (督導、店長、代理店長等)

這導致以下問題：
1. **權限檢查不一致**：部分功能使用 RBAC，部分使用舊系統
2. **維護困難**：需要同時更新 profiles 和 RBAC 兩套資料
3. **用戶困惑**：有 RBAC 角色但看不到選單（例如店長角色）

## 目標

將 Navbar 完全遷移到 RBAC 系統，所有選單項目的顯示都基於 `user_roles` 和 `role_permissions`。

## 當前權限邏輯

### 舊系統的判斷邏輯
```typescript
// 判斷是否為需要指派的職位（督導、店長、代理店長等）
const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(user?.profile?.job_title || '');

// 判斷是否為營業部助理（部門=營業X部，角色=member）
const isBusinessAssistant = user?.profile?.department?.startsWith('營業') && user?.profile?.role === 'member' && !needsAssignment;

// 判斷是否為營業部主管（部門=營業X部，角色=manager）
const isBusinessSupervisor = user?.profile?.department?.startsWith('營業') && user?.profile?.role === 'manager' && !needsAssignment;
```

### 選單項目與權限對應

| 選單項目 | 當前權限檢查 | 建議的 RBAC 權限碼 |
|---------|------------|------------------|
| **派發任務** | | |
| 我的任務 | admin/manager/member | `task.view_own` |
| 儀表板 | admin/manager/營業部助理 | `dashboard.view` |
| 任務管理 | admin/manager/營業部助理 | `task.manage` |
| 已封存任務 | admin/manager/營業部助理 | `task.view_archived` |
| **門市管理** | | |
| 店長指派 | admin/營業部主管 | `store.manager.assign` |
| 經理/督導管理 | admin/營業部主管 | `store.supervisor.assign` |
| 門市管理 | admin/營業部助理/主管 | `store.manage` |
| 員工管理 | admin/營業部助理/主管 | `employee.manage` |
| 人員異動管理 | admin/營業部助理/主管 | `employee.movement.manage` |
| 批次匯入員工 | admin/營業部主管 | `employee.import` |
| 活動管理 | admin/營業部主管 | `activity.manage` |
| 盤點管理 | admin/營業部助理/主管/店長 | `inventory.manage` |
| **每月人員狀態** | | |
| 每月人員狀態 | admin/manager/member | `monthly.status.view_own` |
| 資料匯出 | admin/營業部主管 | `monthly.status.export` |

## 實施步驟

### 步驟 1：新增缺少的權限碼

執行 SQL 新增權限：

```sql
-- 新增導航欄需要的權限碼
INSERT INTO permissions (code, description, category, module) VALUES
  ('task.view_own', '查看自己的任務', 'read', '任務管理'),
  ('task.manage', '管理任務模板', 'write', '任務管理'),
  ('task.view_archived', '查看已封存任務', 'read', '任務管理'),
  ('dashboard.view', '查看儀表板', 'read', '系統'),
  ('store.supervisor.assign', '指派督導/區經理', 'write', '門市管理'),
  ('employee.movement.manage', '管理人員異動', 'write', '人事管理'),
  ('employee.import', '批次匯入員工', 'write', '人事管理'),
  ('activity.manage', '管理活動', 'write', '活動管理'),
  ('monthly.status.export', '匯出每月人員狀態', 'read', '每月人員狀態')
ON CONFLICT (code) DO NOTHING;

-- 為現有角色分配新權限
-- admin 角色獲得所有權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  r.id as role_id,
  p.id as permission_id,
  true as is_allowed
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin_role'
  AND p.code IN (
    'task.view_own', 'task.manage', 'task.view_archived', 'dashboard.view',
    'store.supervisor.assign', 'employee.movement.manage', 'employee.import',
    'activity.manage', 'monthly.status.export'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;

-- store_manager_role 獲得店長相關權限
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT 
  r.id as role_id,
  p.id as permission_id,
  true as is_allowed
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'store_manager_role'
  AND p.code IN (
    'task.view_own',
    'inventory.manage',
    'monthly.status.view_own'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;
```

### 步驟 2：創建權限檢查 Hook

創建 `hooks/useNavbarPermissions.ts`：

```typescript
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface NavbarPermissions {
  // 任務管理
  canViewOwnTasks: boolean;
  canViewDashboard: boolean;
  canManageTasks: boolean;
  canViewArchivedTasks: boolean;
  
  // 門市管理
  canAssignStoreManager: boolean;
  canAssignSupervisor: boolean;
  canManageStores: boolean;
  canManageEmployees: boolean;
  canManageMovements: boolean;
  canImportEmployees: boolean;
  canManageActivities: boolean;
  canManageInventory: boolean;
  
  // 每月人員狀態
  canViewMonthlyStatus: boolean;
  canExportMonthlyStatus: boolean;
}

export function useNavbarPermissions(userId: string): NavbarPermissions {
  const [permissions, setPermissions] = useState<NavbarPermissions>({
    canViewOwnTasks: false,
    canViewDashboard: false,
    canManageTasks: false,
    canViewArchivedTasks: false,
    canAssignStoreManager: false,
    canAssignSupervisor: false,
    canManageStores: false,
    canManageEmployees: false,
    canManageMovements: false,
    canImportEmployees: false,
    canManageActivities: false,
    canManageInventory: false,
    canViewMonthlyStatus: false,
    canExportMonthlyStatus: false,
  });

  useEffect(() => {
    async function checkPermissions() {
      const supabase = createClient();
      
      // 批次查詢所有權限
      const { data: userPermissions } = await supabase
        .from('user_roles')
        .select(`
          role:roles!inner (
            role_permissions!inner (
              is_allowed,
              permission:permissions!inner (code)
            )
          )
        `)
        .eq('user_id', userId)
        .eq('is_active', true);

      if (!userPermissions) return;

      // 整理權限映射
      const permissionSet = new Set<string>();
      userPermissions.forEach((ur: any) => {
        ur.role?.role_permissions?.forEach((rp: any) => {
          if (rp.is_allowed) {
            permissionSet.add(rp.permission.code);
          }
        });
      });

      // 更新權限狀態
      setPermissions({
        canViewOwnTasks: permissionSet.has('task.view_own'),
        canViewDashboard: permissionSet.has('dashboard.view'),
        canManageTasks: permissionSet.has('task.manage'),
        canViewArchivedTasks: permissionSet.has('task.view_archived'),
        canAssignStoreManager: permissionSet.has('store.manager.assign'),
        canAssignSupervisor: permissionSet.has('store.supervisor.assign'),
        canManageStores: permissionSet.has('store.manage'),
        canManageEmployees: permissionSet.has('employee.manage'),
        canManageMovements: permissionSet.has('employee.movement.manage'),
        canImportEmployees: permissionSet.has('employee.import'),
        canManageActivities: permissionSet.has('activity.manage'),
        canManageInventory: permissionSet.has('inventory.manage'),
        canViewMonthlyStatus: permissionSet.has('monthly.status.view_own') || permissionSet.has('monthly.status.view_all'),
        canExportMonthlyStatus: permissionSet.has('monthly.status.export'),
      });
    }

    checkPermissions();
  }, [userId]);

  return permissions;
}
```

### 步驟 3：修改 Navbar.tsx

更新 `components/Navbar.tsx`：

```typescript
'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useNavbarPermissions } from '@/hooks/useNavbarPermissions';
// ... 其他 import

interface NavbarProps {
  user: {
    id: string;  // 新增：需要 user.id 來檢查權限
    email: string;
    profile: {
      full_name: string | null;
      role: 'admin' | 'manager' | 'member';
      department?: string | null;
      job_title?: string | null;
    };
  } | null;
}

export default function Navbar({ user }: NavbarProps) {
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isTaskMenuOpen, setIsTaskMenuOpen] = useState(false);
  const [isStoreMenuOpen, setIsStoreMenuOpen] = useState(false);
  const [isMonthlyStatusMenuOpen, setIsMonthlyStatusMenuOpen] = useState(false);
  
  // 使用 RBAC 權限
  const permissions = useNavbarPermissions(user?.id || '');

  // ... 其他代碼

  // 派發任務相關的子選單項目
  const taskSubItems = [
    { href: '/my-tasks', label: '我的任務', icon: ClipboardList, show: permissions.canViewOwnTasks },
    { href: '/dashboard', label: '儀表板', icon: LayoutDashboard, show: permissions.canViewDashboard },
    { href: '/admin/templates', label: '任務管理', icon: FileText, show: permissions.canManageTasks },
    { href: '/admin/archived', label: '已封存任務', icon: Archive, show: permissions.canViewArchivedTasks },
  ].filter(item => item.show);

  // 門市管理相關的子選單項目
  const storeSubItems = [
    { href: '/admin/store-managers', label: '店長指派', icon: Users, show: permissions.canAssignStoreManager },
    { href: '/admin/supervisors', label: '經理/督導管理', icon: Users, show: permissions.canAssignSupervisor },
    { href: '/admin/stores', label: '門市管理', icon: Store, show: permissions.canManageStores },
    { href: '/admin/employee-management', label: '員工管理', icon: UserCog, show: permissions.canManageEmployees },
    { href: '/admin/promotion-management', label: '人員異動管理', icon: TrendingUp, show: permissions.canManageMovements },
    { href: '/admin/import-employees', label: '批次匯入員工', icon: Upload, show: permissions.canImportEmployees },
    { href: '/admin/activity-management', label: '活動管理', icon: CalendarCheck, show: permissions.canManageActivities },
    { href: '/inventory', label: '盤點管理', icon: Package, show: permissions.canManageInventory },
  ].filter(item => item.show);

  // 每月人員狀態相關的子選單項目
  const monthlyStatusSubItems = [
    { href: '/monthly-status', label: '每月人員狀態', icon: CalendarCheck, show: permissions.canViewMonthlyStatus },
    { href: '/admin/export-monthly-status', label: '資料匯出', icon: Send, show: permissions.canExportMonthlyStatus },
  ].filter(item => item.show);

  // ... 其餘代碼保持不變
}
```

### 步驟 4：更新 layout.tsx 傳遞 user.id

確保 `app/layout.tsx` 傳遞完整的 user 物件：

```typescript
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await getCurrentUser();

  return (
    <html lang="zh-TW">
      <body>
        {user && <Navbar user={{
          id: user.id,  // 確保傳遞 user.id
          email: user.email,
          profile: user.profile,
        }} />}
        {children}
      </body>
    </html>
  );
}
```

## 測試計劃

### 測試案例

1. **Admin 用戶**
   - 應該看到所有選單項目
   
2. **Store Manager 用戶**
   - 應該看到：我的任務、盤點管理、每月人員狀態
   - 不應該看到：店長指派、督導管理、員工管理等

3. **營業部助理**
   - 應該看到：門市管理、員工管理、人員異動管理、盤點管理
   
4. **營業部主管**
   - 應該看到：所有門市管理選單

### 測試步驟

1. 為測試用戶分配 RBAC 角色
2. 清除測試用戶的 profiles.job_title（設為 null）
3. 登入並檢查選單顯示是否正確
4. 確認功能訪問權限與選單一致

## 遷移檢查清單

- [ ] 執行 SQL 新增缺少的權限碼
- [ ] 為現有角色分配新權限
- [ ] 創建 `useNavbarPermissions` Hook
- [ ] 修改 `Navbar.tsx` 使用 RBAC
- [ ] 更新 `layout.tsx` 傳遞 user.id
- [ ] 測試所有角色的選單顯示
- [ ] 確認功能訪問權限正確
- [ ] 移除舊的權限檢查代碼（needsAssignment, isBusinessAssistant, isBusinessSupervisor）
- [ ] 更新文檔

## 注意事項

1. **向後兼容**：在遷移期間，可以保留舊的權限檢查作為備用（OR 邏輯）
2. **權限校驗**：前端選單只控制顯示，後端 API 仍需驗證權限
3. **效能考量**：useNavbarPermissions 應該快取結果，避免每次渲染都查詢
4. **測試覆蓋**：確保所有角色組合都經過測試

## 後續優化

1. 實作權限快取（Redis 或 localStorage）
2. 添加權限變更的即時通知
3. 建立權限管理 UI（讓管理員配置角色權限）
4. 記錄權限變更日誌（審計追蹤）
