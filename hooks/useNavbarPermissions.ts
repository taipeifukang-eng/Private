'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ORGANIZATION_NAV_PERMISSION_CODES } from '@/lib/admin/organization-management';
import {
  ROLE_MANAGEMENT_MUTATION_PERMISSION_CODES,
  ROLE_MANAGEMENT_NAV_PERMISSION_CODES,
  USER_MANAGEMENT_MUTATION_PERMISSION_CODES,
  USER_MANAGEMENT_NAV_PERMISSION_CODES,
  hasAnyCode,
} from '@/lib/permissions/rbac-management';
import {
  GA_MAINTENANCE_MODULE_CODES,
  GA_WORK_ORDER_MODULE_CODES,
} from '@/lib/general-affairs/maintenance-permissions';

/**
 * 導航欄權限介面
 * 包含所有導航選單項目的權限檢查
 */
export interface NavbarPermissions {
  // 系統管理
  canViewUsers: boolean;
  canManageUsers: boolean;
  canViewRoles: boolean;
  canManageRoles: boolean;

  // 任務管理
  canViewOwnTasks: boolean;
  canViewDashboard: boolean;
  canManageTasks: boolean;
  canViewArchivedTasks: boolean;
  
  // 門市管理
  canViewAnnualCalendar: boolean;
  canViewOrganization: boolean;
  canViewDepartments: boolean;
  canManageDepartments: boolean;
  canAssignStoreManager: boolean;
  canAssignSupervisor: boolean;
  canManageStores: boolean;
  canManageEmployees: boolean;
  canManageMovements: boolean;
  canImportEmployees: boolean;
  canManageActivities: boolean;
  // 活動排程頁入口：有 activity.campaign.edit 或 activity.store_detail.edit 任一
  canAccessActivitySchedule: boolean;
  canManageInventory: boolean;
  canManagePerformance: boolean;
  canViewPharmacistManagement: boolean;
  canEditPharmacistManagement: boolean;
  canUseClinicSelfpayMargin: boolean;
  canViewRelationshipMembers: boolean;
  canManageEmployeePurchases: boolean;
  
  // 每月人員狀態
  canViewMonthlyStatus: boolean;
  canExportMonthlyStatus: boolean;
  
  // 督導巡店
  canViewInspections: boolean;
  canCreateInspection: boolean;
  canManageInspectionTemplates: boolean;
  canViewImprovements: boolean;
  // 督導管理日誌
  canAccessSupervisorManagementLog: boolean;
  // 跨部門管理
  canAccessCrossDeptMerchandise: boolean;  // 商品部頁面入口
  canManageProductsMaster: boolean;        // 商品主檔管理
  
  // 總務組管理
  canAccessMaintenance: boolean;           // 總務組維修回報頁面入口
  canAccessGeneralAffairsService: boolean; // 新版總務服務中心入口
  canAccessGeneralAffairsMaintenance: boolean; // 總務服務中心維修回報入口
  canAccessGeneralAffairsWorkOrders: boolean; // 總務服務中心工單中心入口
  canAccessGeneralAffairsInventory: boolean; // 總務服務中心庫存管理入口
  canAccessGeneralAffairsEquipment: boolean; // 總務設備管理入口
  canAccessGeneralAffairsFacilities: boolean; // 總務設施管理入口
  canAccessGeneralAffairsParts: boolean; // 總務料件中心入口
  canAccessGeneralAffairsVendors: boolean; // 總務廠商管理入口
  canAccessGeneralAffairsUtilities: boolean; // 總務費用紀錄入口
}

const DEFAULT_NAVBAR_PERMISSIONS: NavbarPermissions = {
  canViewUsers: false,
  canManageUsers: false,
  canViewRoles: false,
  canManageRoles: false,
  canViewOwnTasks: false,
  canViewDashboard: false,
  canManageTasks: false,
  canViewArchivedTasks: false,
  canViewAnnualCalendar: true,
  canViewOrganization: false,
  canViewDepartments: false,
  canManageDepartments: false,
  canAssignStoreManager: false,
  canAssignSupervisor: false,
  canManageStores: false,
  canManageEmployees: false,
  canManageMovements: false,
  canImportEmployees: false,
  canManageActivities: false,
  canAccessActivitySchedule: false,
  canManageInventory: false,
  canManagePerformance: false,
  canViewPharmacistManagement: false,
  canEditPharmacistManagement: false,
  canUseClinicSelfpayMargin: false,
  canViewRelationshipMembers: false,
  canManageEmployeePurchases: false,
  canViewMonthlyStatus: false,
  canExportMonthlyStatus: false,
  canViewInspections: false,
  canCreateInspection: false,
  canManageInspectionTemplates: false,
  canViewImprovements: false,
  canAccessSupervisorManagementLog: false,
  canAccessCrossDeptMerchandise: false,
  canManageProductsMaster: false,
  canAccessMaintenance: false,
  canAccessGeneralAffairsService: false,
  canAccessGeneralAffairsMaintenance: false,
  canAccessGeneralAffairsWorkOrders: false,
  canAccessGeneralAffairsInventory: false,
  canAccessGeneralAffairsEquipment: false,
  canAccessGeneralAffairsFacilities: false,
  canAccessGeneralAffairsParts: false,
  canAccessGeneralAffairsVendors: false,
  canAccessGeneralAffairsUtilities: false,
};

const navbarPermissionsCache = new Map<string, {
  value?: NavbarPermissions;
  promise?: Promise<NavbarPermissions>;
}>();

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
  const [permissions, setPermissions] = useState<NavbarPermissions>(DEFAULT_NAVBAR_PERMISSIONS);

  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const cached = navbarPermissionsCache.get(userId);
    if (cached?.value) {
      setPermissions(cached.value);
      setIsLoading(false);
      return;
    }
    if (cached?.promise) {
      cached.promise
        .then((resolved) => {
          if (!cancelled) setPermissions(resolved);
        })
        .catch((error) => {
          console.error('❌ 載入導航欄權限失敗:', error);
          if (!cancelled) setPermissions(DEFAULT_NAVBAR_PERMISSIONS);
        })
        .finally(() => {
          if (!cancelled) setIsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }

    async function checkPermissions(): Promise<NavbarPermissions> {
      try {
        const supabase = createClient();
        
        let profileRole: string | null = null;
        try {
          const profileRes = await fetch('/api/user/profile', { cache: 'no-store' });
          if (profileRes.ok) {
            const profileJson = await profileRes.json();
            profileRole = profileJson.profile?.role || null;
          }
        } catch (profileError) {
          console.error('❌ 載入使用者 Profile 權限相容資訊失敗:', profileError);
        }

        // 批次查詢用戶的所有權限
        // 透過 user_roles -> roles -> role_permissions -> permissions。
        // DEV baseline 不開放 RBAC 表直接 SELECT；若被 RLS 擋住，仍保留 profile admin compatibility。
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

        // 整理權限集合（Set 確保不重複）
        const permissionSet = new Set<string>();
        const roleCodeSet = new Set<string>();
        
        (userRoles || []).forEach((ur: any) => {
          if (ur.role?.code) {
            roleCodeSet.add(ur.role.code);
          }
          if (ur.role?.role_permissions) {
            ur.role.role_permissions.forEach((rp: any) => {
              if (rp.is_allowed && rp.permission?.code) {
                permissionSet.add(rp.permission.code);
              }
            });
          }
        });

        // Navbar 顯示應使用 server-side effective permissions 作為正式來源。
        // 直接查 user_roles 只保留作為相容與 role code 判斷，避免瀏覽器端 RLS
        // 或 join 形狀差異造成已指派權限沒有出現在導覽列。
        try {
          const permissionsRes = await fetch('/api/permissions/user', { cache: 'no-store' });
          if (permissionsRes.ok) {
            const permissionsJson = await permissionsRes.json();
            (permissionsJson.permissions || []).forEach((code: unknown) => {
              if (typeof code === 'string' && code.trim()) {
                permissionSet.add(code.trim());
              }
            });
          }
        } catch (permissionsError) {
          console.error('❌ 載入使用者有效權限失敗:', permissionsError);
        }

        let canAccessGeneralAffairsService = false;
        try {
          const accessRes = await fetch('/api/general-affairs/access', { cache: 'no-store' });
          if (accessRes.ok) {
            const accessJson = await accessRes.json();
            canAccessGeneralAffairsService = Boolean(accessJson.allowed);
          }
        } catch (accessError) {
          console.error('❌ 載入總務服務中心入口權限失敗:', accessError);
        }

        const isAdminLike =
          profileRole === 'admin' ||
          roleCodeSet.has('admin') ||
          roleCodeSet.has('system_admin') ||
          roleCodeSet.has('admin_role') ||
          roleCodeSet.has('full_admin') ||
          roleCodeSet.has('full_admin_role') ||
          roleCodeSet.has('dev_full_admin') ||
          roleCodeSet.has('owner') ||
          roleCodeSet.has('owner_role');

        const isStoreManager =
          roleCodeSet.has('store_manager_role') ||
          roleCodeSet.has('store_manager');

        const canAccessGeneralAffairsInventory =
          isAdminLike ||
          isStoreManager ||
          permissionSet.has('general_affairs.inventory_balance.view') ||
          permissionSet.has('general_affairs.inventory_transaction.view') ||
          permissionSet.has('general_affairs.inventory_transaction.manage') ||
          permissionSet.has('general_affairs.inventory_transfer.view') ||
          permissionSet.has('general_affairs.inventory_transfer.manage');
        const canAccessGeneralAffairsMaintenance =
          isAdminLike ||
          hasAnyCode(permissionSet, GA_MAINTENANCE_MODULE_CODES);
        const canAccessGeneralAffairsWorkOrders =
          isAdminLike ||
          hasAnyCode(permissionSet, GA_WORK_ORDER_MODULE_CODES);
        const canAccessGeneralAffairsEquipment =
          isAdminLike ||
          isStoreManager ||
          permissionSet.has('general_affairs.equipment.view') ||
          permissionSet.has('general_affairs.equipment.manage');
        const canAccessGeneralAffairsFacilities =
          isAdminLike ||
          isStoreManager ||
          permissionSet.has('general_affairs.facility.view') ||
          permissionSet.has('general_affairs.facility.manage');
        const canAccessGeneralAffairsParts =
          isAdminLike ||
          isStoreManager ||
          permissionSet.has('general_affairs.part.view') ||
          permissionSet.has('general_affairs.part.manage');
        const canAccessGeneralAffairsVendors =
          isAdminLike ||
          permissionSet.has('general_affairs.vendor.view') ||
          permissionSet.has('general_affairs.vendor.manage') ||
          permissionSet.has('general_affairs.service_category.view') ||
          permissionSet.has('general_affairs.service_category.manage') ||
          permissionSet.has('general_affairs.service_region.view') ||
          permissionSet.has('general_affairs.service_region.manage') ||
          permissionSet.has('general_affairs.cooperation_record.view');
        const canAccessGeneralAffairsUtilities =
          isAdminLike ||
          permissionSet.has('general_affairs.utility_bill.view') ||
          permissionSet.has('general_affairs.utility_bill.manage');

        const canViewUsers =
          isAdminLike ||
          hasAnyCode(permissionSet, USER_MANAGEMENT_NAV_PERMISSION_CODES);
        const canManageUsers =
          isAdminLike ||
          hasAnyCode(permissionSet, USER_MANAGEMENT_MUTATION_PERMISSION_CODES);
        const canViewRoles =
          isAdminLike ||
          hasAnyCode(permissionSet, ROLE_MANAGEMENT_NAV_PERMISSION_CODES);
        const canManageRoles =
          isAdminLike ||
          hasAnyCode(permissionSet, ROLE_MANAGEMENT_MUTATION_PERMISSION_CODES) ||
          permissionSet.has('role.permission.assign') ||
          permissionSet.has('role.user_role.assign') ||
          permissionSet.has('role.user_role.revoke');

        const hasPermissionCode = (code: string) => isAdminLike || permissionSet.has(code);
        const hasAnyPermissionCode = (codes: readonly string[]) =>
          isAdminLike || codes.some((code) => permissionSet.has(code));

        const nextPermissions: NavbarPermissions = {
          canViewUsers,
          canManageUsers,
          canViewRoles,
          canManageRoles,
          // 任務管理
          canViewOwnTasks: hasPermissionCode('task.view_own'),
          canViewDashboard: hasPermissionCode('dashboard.view'),
          canManageTasks: hasPermissionCode('task.manage'),
          canViewArchivedTasks: hasPermissionCode('task.view_archived'),
          
          // 門市管理
          canViewAnnualCalendar: true,
          canViewOrganization: hasAnyPermissionCode(ORGANIZATION_NAV_PERMISSION_CODES),
          canViewDepartments: hasAnyPermissionCode([
            'organization.department.view',
            'organization.department.create',
            'organization.department.edit',
            'organization.member.view',
            'organization.member.manage',
            'organization.manager.view',
            'organization.manager.manage',
          ]),
          canManageDepartments: hasAnyPermissionCode([
            'organization.department.create',
            'organization.department.edit',
            'organization.member.manage',
            'organization.manager.manage',
          ]),
          canAssignStoreManager: hasPermissionCode('store.manager.assign'),
          canAssignSupervisor: hasPermissionCode('store.supervisor.assign'),
          canManageStores: hasPermissionCode('store.manage'),
          canManageEmployees: hasPermissionCode('employee.manage'),
          canManageMovements: hasPermissionCode('employee.movement.manage'),
          canImportEmployees: hasPermissionCode('employee.import'),
          canManageActivities: hasPermissionCode('activity.manage'),
          canAccessActivitySchedule: hasAnyPermissionCode([
            'activity.campaign.edit',
            'activity.store_detail.edit',
            'activity.equipment_trip.edit',
            'activity.checklist.edit',
          ]),
          canManageInventory: hasAnyPermissionCode([
            'inventory.manage',
            'inventory.inventory.access',
            'inventory.inventory.view',
            'inventory.result_analysis.view_own',
          ]),
          canManagePerformance: hasAnyPermissionCode(['performance.view', 'performance.edit']),
          canViewPharmacistManagement: hasPermissionCode('pharmacist.management.view'),
          canEditPharmacistManagement: hasPermissionCode('pharmacist.management.edit'),
          canUseClinicSelfpayMargin: hasAnyPermissionCode([
            'monthly.status.view_own',
            'monthly.status.view_all',
            'employee.movement.manage',
            'store.manage',
          ]),
          canViewRelationshipMembers: hasAnyPermissionCode([
            'relationship_member.view',
            'relationship_member.edit',
            'relationship_member.delete',
            'relationship_member.approve',
          ]),
          canManageEmployeePurchases: hasAnyPermissionCode([
            'employee_purchase.view',
            'employee_purchase.import',
          ]),
          
          // 每月人員狀態
          canViewMonthlyStatus: hasAnyPermissionCode([
            'monthly.status.view_own',
            'monthly.status.view_all',
          ]),
          canExportMonthlyStatus: hasPermissionCode('monthly.status.export'),
          
          // 督導巡店
          canViewInspections: hasAnyPermissionCode([
            'inspection.view_own',
            'inspection.view_store',
            'inspection.view_all',
          ]),
          canCreateInspection: hasPermissionCode('inspection.create'),
          canManageInspectionTemplates: hasPermissionCode('inspection.template.manage'),
          canViewImprovements: hasAnyPermissionCode([
            'inspection.improvement.view_all',
            'inspection.improvement.view_own',
            'inspection.improvement.view_own_store',
            'inspection.improvement.manage',
            'inspection.improvement.submit',
          ]),

          // 督導管理日誌
            canAccessSupervisorManagementLog: hasAnyPermissionCode([
              'supervisor.management_log.view_own',
              'supervisor.management_log.view_team',
              'supervisor.management_log.create',
              'supervisor.management_log.update_own',
              'supervisor.management_log.follow_up',
              'supervisor.management_log.manage',
            ]),

          // 跨部門管理
          canAccessCrossDeptMerchandise: hasAnyPermissionCode([
            'cross_dept.stockout.view_all',
            'cross_dept.stockout.respond',
            'cross_dept.stockout.submit',
          ]),
          canManageProductsMaster: hasPermissionCode('store.products_master.manage'),
          
          // 總務組管理
          canAccessMaintenance: hasAnyPermissionCode([
            'cross_dept.maintenance.view_all',
            'cross_dept.maintenance.submit',
            'cross_dept.maintenance.update',
          ]),
          canAccessGeneralAffairsService,
          canAccessGeneralAffairsMaintenance,
          canAccessGeneralAffairsWorkOrders,
          canAccessGeneralAffairsInventory,
          canAccessGeneralAffairsEquipment,
          canAccessGeneralAffairsFacilities,
          canAccessGeneralAffairsParts,
          canAccessGeneralAffairsVendors,
          canAccessGeneralAffairsUtilities,
        };
        navbarPermissionsCache.set(userId, { value: nextPermissions });
        return nextPermissions;
      } catch (error) {
        console.error('❌ 載入導航欄權限失敗:', error);
        navbarPermissionsCache.delete(userId);
        return DEFAULT_NAVBAR_PERMISSIONS;
      }
    }

    const promise = checkPermissions();
    navbarPermissionsCache.set(userId, { promise });
    promise
      .then((resolved) => {
        if (!cancelled) setPermissions(resolved);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
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
         permissions.canAccessActivitySchedule ||
         permissions.canManageInventory ||
         permissions.canManagePerformance ||
         permissions.canViewPharmacistManagement ||
         permissions.canUseClinicSelfpayMargin ||
         permissions.canViewRelationshipMembers ||
         permissions.canManageEmployeePurchases;
}

export function hasAnyOrganizationPermission(permissions: NavbarPermissions): boolean {
  return permissions.canViewAnnualCalendar ||
         permissions.canViewOrganization ||
         permissions.canViewDepartments ||
         permissions.canManageDepartments ||
         hasAnyStorePermission(permissions);
}

/**
 * 檢查用戶是否有任何每月狀態權限
 */
export function hasAnyMonthlyStatusPermission(permissions: NavbarPermissions): boolean {
  return permissions.canViewMonthlyStatus || permissions.canExportMonthlyStatus;
}

/**
 * 檢查用戶是否有任何督導巡店權限
 */
export function hasAnyInspectionPermission(permissions: NavbarPermissions): boolean {
  return permissions.canViewInspections ||
         permissions.canCreateInspection ||
         permissions.canManageInspectionTemplates ||
         permissions.canViewImprovements;
}

/**
 * 檢查用戶是否有任何跨部門管理權限
 */
export function hasAnyCrossDeptPermission(permissions: NavbarPermissions): boolean {
  return (
    permissions.canAccessCrossDeptMerchandise ||
    permissions.canAccessMaintenance
  );
}

export function hasAnyGeneralAffairsPermission(permissions: NavbarPermissions): boolean {
  return (
    permissions.canAccessGeneralAffairsService ||
    permissions.canAccessGeneralAffairsInventory ||
    permissions.canAccessGeneralAffairsMaintenance ||
    permissions.canAccessGeneralAffairsWorkOrders ||
    permissions.canAccessGeneralAffairsEquipment ||
    permissions.canAccessGeneralAffairsFacilities ||
    permissions.canAccessGeneralAffairsParts ||
    permissions.canAccessGeneralAffairsVendors ||
    permissions.canAccessGeneralAffairsUtilities
  );
}
