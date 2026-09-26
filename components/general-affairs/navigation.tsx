import {
  BarChart3,
  Boxes,
  Briefcase,
  Building2,
  ClipboardList,
  Home,
  Layers3,
  MapPin,
  Package,
  Printer,
  ReceiptText,
  ShieldCheck,
  Settings,
  Tags,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import {
  getGeneralAffairsFeatureAvailability,
  isGeneralAffairsFeatureAvailable,
  type GeneralAffairsFeatureKey,
} from './features';
import type { NavbarPermissions } from '@/hooks/useNavbarPermissions';
import {
  GA_MAINTENANCE_REQUEST_CREATE_CODES,
  GA_MAINTENANCE_MODULE_CODES,
  GA_WORK_ORDER_MODULE_CODES,
} from '@/lib/general-affairs/maintenance-permissions';

export type GeneralAffairsPermissionFlag =
  | 'canAccessGeneralAffairsService'
  | 'canAccessGeneralAffairsMaintenance'
  | 'canAccessGeneralAffairsWorkOrders'
  | 'canAccessGeneralAffairsInventory'
  | 'canAccessGeneralAffairsEquipment'
  | 'canAccessGeneralAffairsFacilities'
  | 'canAccessGeneralAffairsParts'
  | 'canAccessGeneralAffairsVendors'
  | 'canAccessGeneralAffairsUtilities';

export type GeneralAffairsNavBadge = {
  type: 'count' | 'status';
  sourceKey: string;
};

export type GeneralAffairsNavItem = {
  id: string;
  label: string;
  href?: string;
  icon: LucideIcon;
  requiredAnyPermissions?: string[];
  requiredAllPermissions?: string[];
  requiredAnyPermissionFlags?: GeneralAffairsPermissionFlag[];
  featureKey?: GeneralAffairsFeatureKey;
  children?: GeneralAffairsNavItem[];
  activeMatch?: 'exact' | 'prefix';
  activePaths?: string[];
  badge?: GeneralAffairsNavBadge;
};

export type GeneralAffairsNavGroup = {
  id: string;
  label?: string;
  items: GeneralAffairsNavItem[];
};

export type GeneralAffairsNavFilterContext = {
  permissionCodes?: Iterable<string>;
  permissionFlags?: Partial<Pick<NavbarPermissions, GeneralAffairsPermissionFlag>>;
  isAdminLike?: boolean;
};

const SERVICE_ACCESS = 'general_affairs.service_center.access';
const SERVICE_REQUEST_CREATE_ACCESS = [
  'general_affairs.request.create',
  ...GA_MAINTENANCE_REQUEST_CREATE_CODES,
];
const SERVICE_REQUEST_VIEW_ACCESS = [
  'general_affairs.request.view_own_store',
  'general_affairs.request.view_all',
  'general_affairs.request.manage',
  ...GA_MAINTENANCE_MODULE_CODES,
];
const VENDOR_ACCESS_PERMISSIONS = [
  'general_affairs.vendor.view',
  'general_affairs.vendor.manage',
  'general_affairs.service_category.view',
  'general_affairs.service_category.manage',
  'general_affairs.service_region.view',
  'general_affairs.service_region.manage',
  'general_affairs.cooperation_record.view',
];

export const GENERAL_AFFAIRS_NAV_GROUPS: GeneralAffairsNavGroup[] = [
  {
    id: 'workspace',
    label: '工作台',
    items: [
      {
        id: 'service-home',
        label: '服務首頁',
        href: '/general-affairs',
        icon: Home,
        featureKey: 'service_home',
        requiredAnyPermissions: [SERVICE_ACCESS],
        requiredAnyPermissionFlags: ['canAccessGeneralAffairsService'],
        activeMatch: 'exact',
      },
    ],
  },
  {
    id: 'requests',
    label: '門市追蹤',
    items: [
      {
        id: 'new-maintenance-report',
        label: '新增需求',
        href: '/general-affairs/reports/new',
        icon: Wrench,
        featureKey: 'maintenance_reports',
        requiredAnyPermissions: SERVICE_REQUEST_CREATE_ACCESS,
        requiredAnyPermissionFlags: ['canAccessGeneralAffairsMaintenance'],
        activeMatch: 'prefix',
      },
      {
        id: 'maintenance',
        label: '我的追蹤',
        href: '/general-affairs/reports/mine',
        icon: ClipboardList,
        featureKey: 'maintenance_reports',
        requiredAnyPermissions: SERVICE_REQUEST_VIEW_ACCESS,
        requiredAnyPermissionFlags: ['canAccessGeneralAffairsMaintenance'],
        activeMatch: 'prefix',
      },
    ],
  },
  {
    id: 'operations',
    label: '作業管理',
    items: [
      {
        id: 'work-orders',
        label: '工單中心',
        href: '/general-affairs/work-orders',
        icon: ClipboardList,
        featureKey: 'work_orders',
        requiredAnyPermissions: GA_WORK_ORDER_MODULE_CODES,
        requiredAnyPermissionFlags: ['canAccessGeneralAffairsWorkOrders'],
      },
      {
        id: 'service-requests-intake',
        label: '總務需求工作台',
        href: '/general-affairs/requests',
        icon: ClipboardList,
        featureKey: 'service_requests',
        requiredAnyPermissions: ['general_affairs.request.view_all', 'general_affairs.request.manage'],
        activeMatch: 'prefix',
      },
      {
        id: 'part-request-review',
        label: '料件處理中心',
        href: '/general-affairs/part-fulfillments',
        icon: ClipboardList,
        featureKey: 'part_request_review',
        requiredAnyPermissions: ['general_affairs.part_fulfillment.view', 'general_affairs.part_fulfillment.manage'],
        activeMatch: 'prefix',
      },
      {
        id: 'transfer-receiving',
        label: '調撥與收貨',
        href: '/general-affairs/inventory/transfers',
        icon: Package,
        featureKey: 'inventory_transfer_receiving',
        requiredAnyPermissions: ['general_affairs.inventory_transfer.view', 'general_affairs.inventory_transfer.manage', 'general_affairs.inventory_transaction.manage'],
        requiredAnyPermissionFlags: ['canAccessGeneralAffairsInventory'],
        activeMatch: 'prefix',
      },
      {
        id: 'inventory-count',
        label: '盤點作業',
        icon: ClipboardList,
        featureKey: 'inventory_count',
        requiredAnyPermissions: ['general_affairs.inventory_balance.view'],
      },
    ],
  },
  {
    id: 'assets-inventory',
    label: '資產與庫存',
    items: [
      {
        id: 'equipment',
        label: '設備管理',
        icon: Wrench,
        featureKey: 'equipment',
        requiredAnyPermissions: ['general_affairs.equipment.view', 'general_affairs.equipment.manage'],
        requiredAnyPermissionFlags: ['canAccessGeneralAffairsEquipment'],
        children: [
          {
            id: 'equipment-list',
            label: '設備清冊',
            href: '/general-affairs/equipment',
            icon: Wrench,
            featureKey: 'equipment',
            requiredAnyPermissions: ['general_affairs.equipment.view', 'general_affairs.equipment.manage'],
            requiredAnyPermissionFlags: ['canAccessGeneralAffairsEquipment'],
            activeMatch: 'prefix',
          },
          {
            id: 'equipment-templates',
            label: '公司設備型號',
            href: '/general-affairs/equipment/templates',
            icon: Layers3,
            featureKey: 'equipment',
            requiredAnyPermissions: ['general_affairs.equipment_template.view', 'general_affairs.equipment_template.manage'],
            activeMatch: 'exact',
          },
          {
            id: 'equipment-categories',
            label: '設備分類',
            href: '/general-affairs/equipment/categories',
            icon: Tags,
            featureKey: 'equipment_categories',
            requiredAnyPermissions: ['general_affairs.equipment_category.view', 'general_affairs.equipment_category.manage'],
            activeMatch: 'prefix',
          },
          {
            id: 'equipment-new',
            label: '新增設備',
            href: '/general-affairs/equipment/new',
            icon: Package,
            featureKey: 'equipment_new',
            requiredAnyPermissions: ['general_affairs.equipment.manage'],
            requiredAnyPermissionFlags: ['canAccessGeneralAffairsEquipment'],
            activeMatch: 'exact',
          },
          {
            id: 'equipment-labels',
            label: 'QR 標籤列印',
            href: '/general-affairs/equipment/labels',
            icon: Printer,
            featureKey: 'equipment',
            requiredAnyPermissions: ['general_affairs.equipment.view', 'general_affairs.equipment.manage'],
            requiredAnyPermissionFlags: ['canAccessGeneralAffairsEquipment'],
            activeMatch: 'exact',
          },
          {
            id: 'equipment-warranties',
            label: '保固管理',
            href: '/general-affairs/equipment/warranties',
            icon: ShieldCheck,
            featureKey: 'equipment_warranties',
            requiredAnyPermissions: ['general_affairs.equipment.view', 'general_affairs.equipment.manage'],
            requiredAnyPermissionFlags: ['canAccessGeneralAffairsEquipment'],
            activeMatch: 'prefix',
          },
          {
            id: 'equipment-maintenance-history',
            label: '維修紀錄',
            href: '/general-affairs/equipment/maintenance-history',
            icon: Wrench,
            featureKey: 'equipment_maintenance_history',
            requiredAnyPermissions: ['general_affairs.equipment.view', 'general_affairs.equipment.manage'],
            requiredAnyPermissionFlags: ['canAccessGeneralAffairsEquipment'],
            activeMatch: 'prefix',
          },
        ],
      },
      {
        id: 'facilities',
        label: '設施管理',
        icon: Building2,
        featureKey: 'facilities',
        requiredAnyPermissions: ['general_affairs.facility.view', 'general_affairs.facility.manage'],
        requiredAnyPermissionFlags: ['canAccessGeneralAffairsFacilities'],
        children: [
          {
            id: 'facility-list',
            label: '設施清冊',
            href: '/general-affairs/facilities',
            icon: Building2,
            featureKey: 'facilities',
            requiredAnyPermissions: ['general_affairs.facility.view', 'general_affairs.facility.manage'],
            requiredAnyPermissionFlags: ['canAccessGeneralAffairsFacilities'],
            activeMatch: 'prefix',
          },
          {
            id: 'facility-templates',
            label: '公司設施架型',
            href: '/general-affairs/facilities/templates',
            icon: Layers3,
            featureKey: 'facility_templates',
            requiredAnyPermissions: ['general_affairs.facility.view', 'general_affairs.facility.manage'],
            requiredAnyPermissionFlags: ['canAccessGeneralAffairsFacilities'],
            activeMatch: 'exact',
          },
          {
            id: 'facility-categories',
            label: '設施分類',
            href: '/general-affairs/facilities/categories',
            icon: Tags,
            featureKey: 'facility_categories',
            requiredAnyPermissions: ['general_affairs.facility_category.view', 'general_affairs.facility_category.manage'],
            activeMatch: 'prefix',
          },
          {
            id: 'facility-new',
            label: '新增設施',
            href: '/general-affairs/facilities/new',
            icon: Package,
            featureKey: 'facility_new',
            requiredAnyPermissions: ['general_affairs.facility.manage'],
            requiredAnyPermissionFlags: ['canAccessGeneralAffairsFacilities'],
            activeMatch: 'prefix',
          },
          {
            id: 'facility-maintenance-history',
            label: '維修紀錄',
            href: '/general-affairs/facilities/maintenance-history',
            icon: Wrench,
            featureKey: 'facility_maintenance_history',
            requiredAnyPermissions: ['general_affairs.facility.view', 'general_affairs.facility.manage'],
            requiredAnyPermissionFlags: ['canAccessGeneralAffairsFacilities'],
            activeMatch: 'prefix',
          },
        ],
      },
      {
        id: 'parts',
        label: '料件管理',
        icon: Boxes,
        featureKey: 'parts',
        requiredAnyPermissions: ['general_affairs.part.view', 'general_affairs.part.manage', 'general_affairs.part_category.view', 'general_affairs.part_category.manage'],
        requiredAnyPermissionFlags: ['canAccessGeneralAffairsParts'],
        children: [
          {
            id: 'parts-list',
            label: '料件列表',
            href: '/general-affairs/parts',
            icon: Boxes,
            featureKey: 'parts',
            requiredAnyPermissions: ['general_affairs.part.view', 'general_affairs.part.manage'],
            requiredAnyPermissionFlags: ['canAccessGeneralAffairsParts'],
            activeMatch: 'prefix',
          },
          {
            id: 'part-categories',
            label: '料件分類',
            href: '/general-affairs/parts/categories',
            icon: Tags,
            featureKey: 'part_categories',
            requiredAnyPermissions: ['general_affairs.part_category.view', 'general_affairs.part_category.manage'],
            activeMatch: 'prefix',
          },
          {
            id: 'part-new',
            label: '新增料件',
            href: '/general-affairs/parts/new',
            icon: Package,
            featureKey: 'part_new',
            requiredAnyPermissions: ['general_affairs.part.manage'],
            activeMatch: 'prefix',
          },
          {
            id: 'part-compatibilities',
            label: '適用料件設定',
            href: '/general-affairs/parts/compatibilities',
            icon: Settings,
            featureKey: 'part_compatibilities',
            requiredAnyPermissions: ['general_affairs.part.manage'],
            activeMatch: 'prefix',
          },
          {
            id: 'part-usage-history',
            label: '使用紀錄',
            icon: ClipboardList,
            featureKey: 'part_usage_history',
            requiredAnyPermissions: ['general_affairs.inventory_transaction.view', 'general_affairs.inventory_transaction.manage'],
          },
        ],
      },
      {
        id: 'inventory-management',
        label: '庫存管理',
        icon: Package,
        featureKey: 'inventory_overview',
        requiredAnyPermissions: ['general_affairs.inventory_balance.view', 'general_affairs.inventory_transaction.view', 'general_affairs.inventory_transaction.manage', 'general_affairs.inventory_location.view', 'general_affairs.inventory_location.manage'],
        requiredAnyPermissionFlags: ['canAccessGeneralAffairsInventory'],
        children: [
          {
            id: 'inventory-overview',
            label: '庫存總覽',
            href: '/general-affairs/inventory',
            icon: Package,
            featureKey: 'inventory_overview',
            requiredAnyPermissions: ['general_affairs.inventory_balance.view', 'general_affairs.inventory_transaction.view', 'general_affairs.inventory_transaction.manage'],
            requiredAnyPermissionFlags: ['canAccessGeneralAffairsInventory'],
            activeMatch: 'prefix',
          },
          {
            id: 'inventory-locations',
            label: '庫存位置',
            href: '/general-affairs/inventory/locations',
            icon: MapPin,
            featureKey: 'inventory_locations',
            requiredAnyPermissions: ['general_affairs.inventory_location.view', 'general_affairs.inventory_location.manage'],
            requiredAnyPermissionFlags: ['canAccessGeneralAffairsInventory'],
            activeMatch: 'prefix',
          },
          {
            id: 'inventory-ledger',
            label: '庫存流水',
            href: '/general-affairs/inventory?view=transactions',
            icon: ClipboardList,
            featureKey: 'inventory_transactions',
            requiredAnyPermissions: ['general_affairs.inventory_transaction.view', 'general_affairs.inventory_transaction.manage'],
            requiredAnyPermissionFlags: ['canAccessGeneralAffairsInventory'],
          },
          {
            id: 'inventory-transfers',
            label: '調撥與收貨',
            href: '/general-affairs/inventory/transfers',
            icon: Package,
            featureKey: 'inventory_transfer_receiving',
            requiredAnyPermissions: ['general_affairs.inventory_transfer.view', 'general_affairs.inventory_transfer.manage', 'general_affairs.inventory_transaction.manage'],
            requiredAnyPermissionFlags: ['canAccessGeneralAffairsInventory'],
            activeMatch: 'prefix',
          },
          {
            id: 'inventory-count-under-inventory',
            label: '盤點',
            icon: ClipboardList,
            featureKey: 'inventory_count',
            requiredAnyPermissions: ['general_affairs.inventory_balance.view'],
          },
        ],
      },
    ],
  },
  {
    id: 'expenses',
    label: '費用管理',
    items: [
      {
        id: 'utility-bills',
        label: '水電電話網路費',
        href: '/general-affairs/utility-bills',
        icon: ReceiptText,
        featureKey: 'utility_bills',
        requiredAnyPermissions: ['general_affairs.utility_bill.view', 'general_affairs.utility_bill.manage'],
        requiredAnyPermissionFlags: ['canAccessGeneralAffairsUtilities'],
        activeMatch: 'prefix',
      },
    ],
  },
  {
    id: 'vendors',
    label: '合作廠商',
    items: [
      {
        id: 'vendors-list',
        label: '廠商資料',
        href: '/general-affairs/vendors',
        icon: Briefcase,
        featureKey: 'vendors',
        requiredAnyPermissions: ['general_affairs.vendor.view', 'general_affairs.vendor.manage'],
        requiredAnyPermissionFlags: ['canAccessGeneralAffairsVendors'],
        activeMatch: 'prefix',
      },
      {
        id: 'vendor-categories',
        label: '服務分類',
        href: '/general-affairs/vendors/categories',
        icon: Tags,
        featureKey: 'vendor_categories',
        requiredAnyPermissions: ['general_affairs.service_category.view', 'general_affairs.service_category.manage'],
        requiredAnyPermissionFlags: ['canAccessGeneralAffairsVendors'],
        activeMatch: 'prefix',
      },
      {
        id: 'vendor-purchases',
        label: '採購分析',
        href: '/general-affairs/vendors/purchases',
        icon: BarChart3,
        featureKey: 'vendor_purchase_analysis',
        requiredAnyPermissions: [
          'general_affairs.purchase_review.view',
          'general_affairs.purchase_review.manage',
          'general_affairs.request.view_all',
          'general_affairs.request.manage',
        ],
        requiredAnyPermissionFlags: ['canAccessGeneralAffairsVendors'],
        activeMatch: 'prefix',
      },
      {
        id: 'vendor-regions',
        label: '服務區域',
        href: '/general-affairs/vendors/regions',
        icon: MapPin,
        featureKey: 'vendor_regions',
        requiredAnyPermissions: ['general_affairs.service_region.view', 'general_affairs.service_region.manage'],
        requiredAnyPermissionFlags: ['canAccessGeneralAffairsVendors'],
        activeMatch: 'prefix',
      },
      {
        id: 'vendor-stats',
        label: '合作紀錄',
        href: '/general-affairs/vendors/stats',
        icon: ClipboardList,
        featureKey: 'vendor_stats',
        requiredAnyPermissions: VENDOR_ACCESS_PERMISSIONS,
        requiredAnyPermissionFlags: ['canAccessGeneralAffairsVendors'],
        activeMatch: 'prefix',
      },
    ],
  },
];
export function flattenGeneralAffairsNavItems(groups: GeneralAffairsNavGroup[] = GENERAL_AFFAIRS_NAV_GROUPS) {
  const items: GeneralAffairsNavItem[] = [];
  const visit = (item: GeneralAffairsNavItem) => {
    items.push(item);
    item.children?.forEach(visit);
  };
  groups.forEach((group) => group.items.forEach(visit));
  return items;
}

export function getActiveGeneralAffairsNavItemId(
  pathname: string,
  currentPath: string,
  groups: GeneralAffairsNavGroup[] = GENERAL_AFFAIRS_NAV_GROUPS,
) {
  const itemsWithHref = flattenGeneralAffairsNavItems(groups).filter((item) => Boolean(item.href));

  const exactMatch = itemsWithHref
    .filter((item) => {
      if (!item.href) return false;
      if (item.activePaths?.some((activePath) => pathname === activePath)) return true;
      if (item.href.includes('?')) return currentPath === item.href;
      return pathname === item.href || Boolean(item.activePaths?.some((activePath) => pathname === activePath));
    })
    .sort((a, b) => (b.href?.length || 0) - (a.href?.length || 0))[0];

  if (exactMatch) return exactMatch.id;

  const prefixMatch = itemsWithHref
    .filter((item) => {
      if (!item.href || item.activeMatch !== 'prefix') return false;
      const activePaths = [
        ...(!item.href.includes('?') ? [item.href] : []),
        ...(item.activePaths || []),
      ];
      return activePaths.some((activePath) => pathname.startsWith(`${activePath}/`));
    })
    .sort((a, b) => (b.href?.length || 0) - (a.href?.length || 0))[0];

  return prefixMatch?.id || null;
}

function hasRequiredPermission(item: GeneralAffairsNavItem, context: GeneralAffairsNavFilterContext) {
  if (context.isAdminLike) return true;

  const permissionCodes = new Set(context.permissionCodes || []);
  const flags = context.permissionFlags || {};

  const hasAnyCode = !item.requiredAnyPermissions?.length ||
    item.requiredAnyPermissions.some((code) => permissionCodes.has(code));
  const hasAllCodes = !item.requiredAllPermissions?.length ||
    item.requiredAllPermissions.every((code) => permissionCodes.has(code));
  const hasAnyFlag = !item.requiredAnyPermissionFlags?.length ||
    item.requiredAnyPermissionFlags.some((flag) => flags[flag] === true);

  if (!item.requiredAnyPermissions?.length && !item.requiredAllPermissions?.length && !item.requiredAnyPermissionFlags?.length) {
    return true;
  }

  return hasAllCodes && (hasAnyCode || hasAnyFlag);
}

function filterNavItem(item: GeneralAffairsNavItem, context: GeneralAffairsNavFilterContext): GeneralAffairsNavItem | null {
  const availability = getGeneralAffairsFeatureAvailability(item.featureKey);
  const isAvailable = isGeneralAffairsFeatureAvailable(item.featureKey);

  const children = item.children
    ?.map((child) => filterNavItem(child, context))
    .filter(Boolean) as GeneralAffairsNavItem[] | undefined;

  const visibleBySelf = hasRequiredPermission(item, context) && (Boolean(item.href) || Boolean(availability && !isAvailable));
  const visibleByChildren = Boolean(children?.length);

  if (!visibleBySelf && !visibleByChildren) return null;

  return {
    ...item,
    children,
  };
}

export function getVisibleGeneralAffairsNavGroups(
  context: GeneralAffairsNavFilterContext,
  groups: GeneralAffairsNavGroup[] = GENERAL_AFFAIRS_NAV_GROUPS,
) {
  return groups
    .map((group) => ({
      ...group,
      items: group.items
        .map((item) => filterNavItem(item, context))
        .filter(Boolean) as GeneralAffairsNavItem[],
    }))
    .filter((group) => group.items.length > 0);
}

export function getVisibleGeneralAffairsNavbarItems(permissionFlags: Partial<Pick<NavbarPermissions, GeneralAffairsPermissionFlag>>) {
  return flattenGeneralAffairsNavItems(getVisibleGeneralAffairsNavGroups({ permissionFlags }))
    .filter((item) => Boolean(item.href));
}

export function getGeneralAffairsItemAvailability(item: GeneralAffairsNavItem) {
  return getGeneralAffairsFeatureAvailability(item.featureKey);
}
