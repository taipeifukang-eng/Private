// 總務（M7/M8）權限與導覽旗標：純函式，Next 端（session、navigation、API）與單元測試共用。
// 語意（approvals：以正式區 has_permission 為準）：
//   - 導覽與頁面可見（capabilities）：用 has()，含應用層管理員後備（舊版 Navbar 的 isAdminLike），所以舊式管理員帳號「看得到入口」。
//   - API 真正放行：用資料庫語意（permissions 集合，不含管理員後備），因為資料庫 RLS／函式本來就沒有管理員繞過；
//     沒掛管理員角色的舊式管理員會維持「導覽看得到、實際被擋」，並收到白話 403 說明（而不是一份空清單）。
import {
  GA_MAINTENANCE_MODULE_CODES,
  GA_WORK_ORDER_MODULE_CODES,
} from "../../general-affairs/maintenance-permissions";

export const GA = {
  serviceAccess: "general_affairs.service_center.access",
  equipmentCategoryView: "general_affairs.equipment_category.view",
  equipmentCategoryManage: "general_affairs.equipment_category.manage",
  facilityCategoryView: "general_affairs.facility_category.view",
  facilityCategoryManage: "general_affairs.facility_category.manage",
  partCategoryView: "general_affairs.part_category.view",
  partCategoryManage: "general_affairs.part_category.manage",
  partView: "general_affairs.part.view",
  partManage: "general_affairs.part.manage",
  equipmentTemplateView: "general_affairs.equipment_template.view",
  equipmentTemplateManage: "general_affairs.equipment_template.manage",
  equipmentView: "general_affairs.equipment.view",
  equipmentManage: "general_affairs.equipment.manage",
  facilityView: "general_affairs.facility.view",
  facilityManage: "general_affairs.facility.manage",
  utilityBillView: "general_affairs.utility_bill.view",
  utilityBillManage: "general_affairs.utility_bill.manage",
} as const;

export type CategoryType = "equipment" | "facility" | "part";

export const CATEGORY_PERMISSIONS: Record<CategoryType, { view: string; manage: string }> = {
  equipment: { view: GA.equipmentCategoryView, manage: GA.equipmentCategoryManage },
  facility: { view: GA.facilityCategoryView, manage: GA.facilityCategoryManage },
  part: { view: GA.partCategoryView, manage: GA.partCategoryManage },
};

/** 服務中心首頁入口（與舊 Navbar 的 GA 首頁項目相同的條件，再加上店長與維修／工單／廠商類權限）。 */
export const GA_CENTER_CODES: readonly string[] = [
  GA.serviceAccess,
  "general_affairs.inventory_balance.view",
  "general_affairs.inventory_transaction.view",
  "general_affairs.inventory_transaction.manage",
  "general_affairs.inventory_transfer.view",
  "general_affairs.inventory_transfer.manage",
  GA.equipmentView,
  GA.equipmentManage,
  GA.facilityView,
  GA.facilityManage,
  GA.partView,
  GA.partManage,
  "general_affairs.vendor.view",
  "general_affairs.vendor.manage",
  GA.utilityBillView,
  GA.utilityBillManage,
  ...GA_MAINTENANCE_MODULE_CODES,
  ...GA_WORK_ORDER_MODULE_CODES,
  "general_affairs.service_category.view",
  "general_affairs.service_category.manage",
  "general_affairs.service_region.view",
  "general_affairs.service_region.manage",
  "general_affairs.cooperation_record.view",
];

export type HasFn = (...codes: string[]) => boolean;

export type GaFlags = {
  gaCenter: boolean;
  gaEquipmentCategories: boolean;
  gaFacilityCategories: boolean;
  gaPartCategories: boolean;
  gaParts: boolean;
  gaPartCreate: boolean;
  gaPartCompat: boolean;
  gaEquipmentTemplates: boolean;
  gaFacilityTemplates: boolean;
};

export function isStoreManagerRole(roleCodes: { has(code: string): boolean }) {
  return roleCodes.has("store_manager") || roleCodes.has("store_manager_role");
}

/** 導覽／頁面可見旗標（has 含管理員後備）。 */
export function gaFlags(has: HasFn, storeManager: boolean): GaFlags {
  return {
    gaCenter: storeManager || has(...GA_CENTER_CODES),
    gaEquipmentCategories: has(GA.equipmentCategoryView, GA.equipmentCategoryManage),
    gaFacilityCategories: has(GA.facilityCategoryView, GA.facilityCategoryManage),
    gaPartCategories: has(GA.partCategoryView, GA.partCategoryManage),
    // 舊 Navbar 的料件列表：料件權限，或店長（canAccessGeneralAffairsParts）。
    gaParts: storeManager || has(GA.partView, GA.partManage),
    gaPartCreate: has(GA.partManage),
    gaPartCompat: has(GA.partManage),
    gaEquipmentTemplates: has(GA.equipmentTemplateView, GA.equipmentTemplateManage),
    // 設施架型的 API 只認設施查看／管理權限（店長不在內），入口條件對齊 API，避免進去才被擋。
    gaFacilityTemplates: has(GA.facilityView, GA.facilityManage),
  };
}

/** 資料庫語意判斷：permissions 集合（沒有管理員後備）。 */
export function dbCan(permissions: { has(code: string): boolean }, ...codes: string[]) {
  return codes.some((c) => permissions.has(c));
}

export function categoryPermissions(type: CategoryType, permissions: { has(code: string): boolean }) {
  const p = CATEGORY_PERMISSIONS[type];
  const manage = permissions.has(p.manage);
  // 舊版 canReadCategory：服務中心入口、查看或管理權限皆可讀（選擇器需要）。
  const read = manage || permissions.has(p.view) || permissions.has(GA.serviceAccess);
  return { read, manage };
}

export function isCategoryType(value: unknown): value is CategoryType {
  return value === "equipment" || value === "facility" || value === "part";
}
