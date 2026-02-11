'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * 導航欄權限介面
 * 包含所有導航選單項目的權限檢查
 */
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

/**
 * 導航欄權限 Hook
 * 
 * 從 RBAC 系統獲取用戶的導航欄權限
 * 用於控制 Navbar 選單項目的顯示
 * 
 * @param userId - 用戶 ID
 * @returns NavbarPermissions 物件包含所有導航欄權限
 * 
 * @example
 * ```tsx
 * const permissions = useNavbarPermissions(user.id);
 * if (permissions.canManageStores) {
 *   // 顯示門市管理選單
 * }
 * ```
 */
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

  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setIsLoading(false);
      return;
    }

    async function checkPermissions() {
      try {
        const supabase = createClient();
        
        // 批次查詢用戶的所有權限
        // 透過 user_roles -> roles -> role_permissions -> permissions
        const { data: userRoles } = await supabase
          .from('user_roles')
          .select(`
            is_active,
            role:roles!inner (
              code,
              role_permissions!inner (
                is_allowed,
                permission:permissions!inner (code)
              )
            )
          `)
          .eq('user_id', userId)
          .eq('is_active', true);

        if (!userRoles || userRoles.length === 0) {
          setIsLoading(false);
          return;
        }

        // 整理權限集合（Set 確保不重複）
        const permissionSet = new Set<string>();
        
        userRoles.forEach((ur: any) => {
          if (ur.role?.role_permissions) {
            ur.role.role_permissions.forEach((rp: any) => {
              if (rp.is_allowed && rp.permission?.code) {
                permissionSet.add(rp.permission.code);
              }
            });
          }
        });

        // 更新權限狀態
        setPermissions({
          // 任務管理
          canViewOwnTasks: permissionSet.has('task.view_own'),
          canViewDashboard: permissionSet.has('dashboard.view'),
          canManageTasks: permissionSet.has('task.manage'),
          canViewArchivedTasks: permissionSet.has('task.view_archived'),
          
          // 門市管理
          canAssignStoreManager: permissionSet.has('store.manager.assign'),
          canAssignSupervisor: permissionSet.has('store.supervisor.assign'),
          canManageStores: permissionSet.has('store.manage'),
          canManageEmployees: permissionSet.has('employee.manage'),
          canManageMovements: permissionSet.has('employee.movement.manage'),
          canImportEmployees: permissionSet.has('employee.import'),
          canManageActivities: permissionSet.has('activity.manage'),
          canManageInventory: permissionSet.has('inventory.manage'),
          
          // 每月人員狀態
          canViewMonthlyStatus: 
            permissionSet.has('monthly.status.view_own') || 
            permissionSet.has('monthly.status.view_all'),
          canExportMonthlyStatus: permissionSet.has('monthly.status.export'),
        });
      } catch (error) {
        console.error('❌ 載入導航欄權限失敗:', error);
      } finally {
        setIsLoading(false);
      }
    }

    checkPermissions();
  }, [userId]);

  // 在載入期間返回所有權限為 false
  return permissions;
}

/**
 * 檢查用戶是否有任何任務管理權限
 */
export function hasAnyTaskPermission(permissions: NavbarPermissions): boolean {
  return permissions.canViewOwnTasks || 
         permissions.canViewDashboard || 
         permissions.canManageTasks || 
         permissions.canViewArchivedTasks;
}

/**
 * 檢查用戶是否有任何門市管理權限
 */
export function hasAnyStorePermission(permissions: NavbarPermissions): boolean {
  return permissions.canAssignStoreManager ||
         permissions.canAssignSupervisor ||
         permissions.canManageStores ||
         permissions.canManageEmployees ||
         permissions.canManageMovements ||
         permissions.canImportEmployees ||
         permissions.canManageActivities ||
         permissions.canManageInventory;
}

/**
 * 檢查用戶是否有任何每月狀態權限
 */
export function hasAnyMonthlyStatusPermission(permissions: NavbarPermissions): boolean {
  return permissions.canViewMonthlyStatus || permissions.canExportMonthlyStatus;
}
