// G01 總務服務中心側欄：直接沿用舊版 components/general-affairs/navigation.tsx 的分組、項目與權限規則
// （getVisibleGeneralAffairsNavGroups），只是把輸出轉成可 JSON 傳給 Vue 的純資料，並把已移植的頁面標上 kind。
// 這樣「照舊版側欄分組與權限顯示」由同一份規則保證，不會漂移。
import {
  getVisibleGeneralAffairsNavGroups,
  type GeneralAffairsNavItem,
  type GeneralAffairsPermissionFlag,
} from "../../../components/general-affairs/navigation";
import { getGeneralAffairsFeatureAvailability } from "../../../components/general-affairs/features";
import type { WorkTabKind } from "../page-kinds";
import type { GaNavGroup, GaNavItem } from "./nav-types";
import {
  GA_MAINTENANCE_MODULE_CODES,
  GA_WORK_ORDER_MODULE_CODES,
} from "../../general-affairs/maintenance-permissions";
import { gaFlags, GA, isStoreManagerRole, type GaFlags } from "./access";

export type { GaNavGroup, GaNavItem } from "./nav-types";

/** 舊網址 -> 新版頁面 kind 與所需 capability（已移植的頁面才有）。 */
export const GA_PAGE_BY_HREF: Record<string, { kind: WorkTabKind; flag: keyof GaFlags }> = {
  "/general-affairs": { kind: "ga-center", flag: "gaCenter" },
  "/general-affairs/equipment/categories": { kind: "ga-equipment-categories", flag: "gaEquipmentCategories" },
  "/general-affairs/facilities/categories": { kind: "ga-facility-categories", flag: "gaFacilityCategories" },
  "/general-affairs/parts/categories": { kind: "ga-part-categories", flag: "gaPartCategories" },
  "/general-affairs/parts": { kind: "ga-parts", flag: "gaParts" },
  "/general-affairs/parts/new": { kind: "ga-part-create", flag: "gaPartCreate" },
  "/general-affairs/parts/compatibilities": { kind: "ga-part-compat", flag: "gaPartCompat" },
  "/general-affairs/equipment/templates": { kind: "ga-equipment-templates", flag: "gaEquipmentTemplates" },
  "/general-affairs/facilities/templates": { kind: "ga-facility-templates", flag: "gaFacilityTemplates" },
  "/general-affairs/equipment": { kind: "ga-equipment", flag: "gaEquipment" },
  "/general-affairs/equipment/new": { kind: "ga-equipment-create", flag: "gaEquipmentCreate" },
  "/general-affairs/equipment/warranties": { kind: "ga-equipment-warranties", flag: "gaEquipmentWarranties" },
  "/general-affairs/equipment/maintenance-history": { kind: "ga-equipment-history", flag: "gaEquipmentHistory" },
  "/general-affairs/facilities": { kind: "ga-facilities", flag: "gaFacilities" },
  "/general-affairs/facilities/new": { kind: "ga-facility-create", flag: "gaFacilityCreate" },
  "/general-affairs/facilities/warranties": { kind: "ga-facility-warranties", flag: "gaFacilityWarranties" },
  "/general-affairs/facilities/maintenance-history": { kind: "ga-facility-history", flag: "gaFacilityHistory" },
};

export type GaNavInput = {
  has: (...codes: string[]) => boolean;
  permissions: { has(code: string): boolean } & Iterable<string>;
  roleCodes: { has(code: string): boolean };
  isAdmin: boolean;
  /** 名單內任何身分（store_managers）；只影響設備清冊與貼標待辦入口。 */
  storeMember?: boolean;
};

/** 舊 hooks/useNavbarPermissions.ts 的 canAccessGeneralAffairs* 旗標（同一套條件）。 */
export function legacyNavFlags(input: GaNavInput): Record<GeneralAffairsPermissionFlag, boolean> {
  const { permissions: p, isAdmin } = input;
  const sm = isStoreManagerRole(input.roleCodes);
  const any = (...codes: string[]) => codes.some((c) => p.has(c));
  return {
    canAccessGeneralAffairsService: input.has(GA.serviceAccess),
    canAccessGeneralAffairsMaintenance: isAdmin || any(...GA_MAINTENANCE_MODULE_CODES),
    canAccessGeneralAffairsWorkOrders: isAdmin || any(...GA_WORK_ORDER_MODULE_CODES),
    canAccessGeneralAffairsInventory:
      isAdmin || sm || any(
        "general_affairs.inventory_balance.view", "general_affairs.inventory_transaction.view", "general_affairs.inventory_transaction.manage",
        "general_affairs.inventory_transfer.view", "general_affairs.inventory_transfer.manage",
      ),
    canAccessGeneralAffairsEquipment: isAdmin || sm || !!input.storeMember || any(GA.equipmentView, GA.equipmentManage),
    canAccessGeneralAffairsFacilities: isAdmin || sm || any(GA.facilityView, GA.facilityManage),
    canAccessGeneralAffairsParts: isAdmin || sm || any(GA.partView, GA.partManage),
    canAccessGeneralAffairsVendors:
      isAdmin || any(
        "general_affairs.vendor.view", "general_affairs.vendor.manage", "general_affairs.service_category.view", "general_affairs.service_category.manage",
        "general_affairs.service_region.view", "general_affairs.service_region.manage", "general_affairs.cooperation_record.view",
      ),
    canAccessGeneralAffairsUtilities: isAdmin || any(GA.utilityBillView, GA.utilityBillManage),
  };
}

function toItem(item: GeneralAffairsNavItem, flags: GaFlags): GaNavItem | null {
  const page = item.href ? GA_PAGE_BY_HREF[item.href] : undefined;
  // 已移植的頁面：capability 為 false 就不列（避免點進去才被擋；例如只有店長身分的人不顯示設施架型）。
  if (page && !flags[page.flag]) {
    return item.children?.length ? { id: item.id, label: item.label, children: [] } : null;
  }
  const children = item.children?.map((c) => toItem(c, flags)).filter((c): c is GaNavItem => !!c);
  const feature = getGeneralAffairsFeatureAvailability(item.featureKey);
  const out: GaNavItem = { id: item.id, label: item.label };
  if (item.href) {
    out.href = item.href;
    if (page) out.kind = page.kind;
  } else if (feature && feature.status !== "available") {
    out.disabled = feature.message || "規劃中，尚未開放";
  }
  if (children?.length) out.children = children;
  if (!out.href && !out.children?.length && !out.disabled) return null;
  return out;
}

export function gaNavigation(input: GaNavInput): GaNavGroup[] {
  const groups = getVisibleGeneralAffairsNavGroups({
    permissionCodes: input.permissions,
    permissionFlags: legacyNavFlags(input),
    isAdminLike: input.isAdmin,
  });
  const flags = gaFlags(input.has, isStoreManagerRole(input.roleCodes), !!input.storeMember);
  const out = groups
    .map((g) => ({
      id: g.id,
      label: g.label,
      items: g.items.map((i) => toItem(i, flags)).filter((i): i is GaNavItem => !!i && (!!i.href || !!i.disabled || !!i.children?.length)),
    }))
    .filter((g) => g.items.length);
  // 第 2 批新頁面沒有舊網址（不改舊版側欄元件）：貼標待辦與複核追加在「資產與庫存」群組最後。
  const extra: GaNavItem[] = [];
  if (flags.gaOnboardingTasks) extra.push({ id: "onboarding-tasks", label: "貼標待辦", kind: "ga-onboarding-tasks" });
  if (flags.gaOnboardingReview) extra.push({ id: "onboarding-review", label: "貼標複核", kind: "ga-onboarding-review" });
  if (extra.length) {
    const target = out.find((g) => g.id === "assets-inventory");
    if (target) target.items.push(...extra);
    else out.push({ id: "assets-inventory", label: "資產與庫存", items: extra });
  }
  return out;
}
