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
  gaEquipment: boolean;
  gaEquipmentCreate: boolean;
  gaFacilities: boolean;
  gaFacilityCreate: boolean;
  gaEquipmentWarranties: boolean;
  gaFacilityWarranties: boolean;
  gaEquipmentHistory: boolean;
  gaFacilityHistory: boolean;
  gaOnboardingTasks: boolean;
  gaOnboardingReview: boolean;
  gaEquipmentLabels: boolean;
  gaFacilityLabels: boolean;
  gaTransfers: boolean;
  gaOnboardingProgress: boolean;
  gaAssetImport: boolean;
  gaInventoryLocations: boolean;
  gaInventory: boolean;
  gaInventoryTransfers: boolean;
};

export function isStoreManagerRole(roleCodes: { has(code: string): boolean }) {
  return roleCodes.has("store_manager") || roleCodes.has("store_manager_role");
}

/** 導覽／頁面可見旗標（has 含管理員後備）。 */
/** storeMember：名單內任何身分（store_managers）；只影響第 2 批的設備清冊與貼標待辦入口，第 1 批旗標維持只認角色代碼。 */
/** rosterMember：門市名單（store_managers）任何身分，G11 庫存位置唯讀入口用（C12：店長、督導、區經理）。 */
export function gaFlags(has: HasFn, storeManager: boolean, storeMember = false, rosterMember = false): GaFlags {
  return {
    // 門市名單身分（督導、區經理，不限店長）也進得了中心：只看得到自己門市的庫存總覽與調撥（唯讀），側欄只列旗標為 true 的項目（2026-11-11 驗收決定 A）。
    gaCenter: storeManager || rosterMember || has(...GA_CENTER_CODES),
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
    // 第 2 批：設備清冊（店長只看自己門市的基本欄位）、新增設備、建檔貼標待辦（店長與總務）與複核（管理權限）。
    gaEquipment: storeManager || storeMember || has(GA.equipmentView, GA.equipmentManage),
    gaEquipmentCreate: has(GA.equipmentManage),
    // 第 2 批 G08／G09：設施清冊與新增設施、設備／設施保固頁、維修紀錄（店長只看自己門市，範圍由資料庫函式判斷）。
    gaFacilities: storeManager || storeMember || has(GA.facilityView, GA.facilityManage),
    gaFacilityCreate: has(GA.facilityManage),
    gaEquipmentWarranties: has(GA.equipmentView, GA.equipmentManage),
    gaFacilityWarranties: has(GA.facilityView, GA.facilityManage),
    gaEquipmentHistory: storeManager || storeMember || has(GA.equipmentView, GA.equipmentManage),
    gaFacilityHistory: storeManager || storeMember || has(GA.facilityView, GA.facilityManage),
    gaOnboardingTasks: storeManager || storeMember || has(GA.equipmentView, GA.equipmentManage, GA.facilityView, GA.facilityManage),
    gaOnboardingReview: has(GA.equipmentManage, GA.facilityManage),
    // G10 QR 標籤列印：設備／設施查看或管理（店長不能列印）。
    gaEquipmentLabels: has(GA.equipmentView, GA.equipmentManage),
    gaFacilityLabels: has(GA.facilityView, GA.facilityManage),
    // Q28 轉移單：總務（設備或設施管理）發起與取消；店長確認交出／收到。純查看權限者不給入口（API 的讀取範圍另由資料庫列級權限限制）。
    gaTransfers: storeManager || storeMember || has(GA.equipmentManage, GA.facilityManage),
    // Q29 上線貼標進度（總務看全部門市、店長只看自己門市）與 Excel 匯入（設備或設施管理）。
    gaOnboardingProgress: storeManager || storeMember || has(GA.equipmentView, GA.equipmentManage, GA.facilityView, GA.facilityManage),
    gaAssetImport: has(GA.equipmentManage, GA.facilityManage),
    // 第 3 批 G11 庫存位置與料件設定：位置查看／管理權限，或門市名單任何身分（唯讀，內部欄位由伺服端遮蔽）。
    gaInventoryLocations: rosterMember || has("general_affairs.inventory_location.view", "general_affairs.inventory_location.manage"),
    // 第 3 批 G12 庫存餘額、流水、過帳、持有狀態：餘額／流水查看或交易管理，或門市名單任何身分（唯讀）。
    gaInventory: rosterMember || has("general_affairs.inventory_balance.view", "general_affairs.inventory_transaction.view", "general_affairs.inventory_transaction.manage"),
    // 第 3 批 G13 庫存調撥單：調撥／流水查看或管理、餘額查看（舊版 API 讀取條件），或門市名單任何身分（唯讀；可見範圍由資料庫列級權限決定）。
    gaInventoryTransfers: rosterMember || has("general_affairs.inventory_transfer.view", "general_affairs.inventory_transfer.manage", "general_affairs.inventory_transaction.view", "general_affairs.inventory_transaction.manage", "general_affairs.inventory_balance.view"),
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
