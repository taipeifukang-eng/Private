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
import { gaFlags, GA, GA_CENTER_CODES, isStoreManagerRole, type GaFlags } from "./access";

export type { GaNavGroup, GaNavItem } from "./nav-types";

/** 舊網址 -> 新版頁面 kind 與所需 capability（已移植的頁面才有）。 */
export const GA_PAGE_BY_HREF: Record<string, { kind: WorkTabKind; flag: keyof GaFlags; payload?: Record<string, string> }> = {
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
  "/general-affairs/equipment/labels": { kind: "ga-equipment-labels", flag: "gaEquipmentLabels" },
  "/general-affairs/equipment/maintenance-history": { kind: "ga-equipment-history", flag: "gaEquipmentHistory" },
  "/general-affairs/facilities": { kind: "ga-facilities", flag: "gaFacilities" },
  "/general-affairs/facilities/new": { kind: "ga-facility-create", flag: "gaFacilityCreate" },
  "/general-affairs/facilities/warranties": { kind: "ga-facility-warranties", flag: "gaFacilityWarranties" },
  "/general-affairs/facilities/maintenance-history": { kind: "ga-facility-history", flag: "gaFacilityHistory" },
  "/general-affairs/inventory/locations": { kind: "ga-inventory-locations", flag: "gaInventoryLocations" },
  // 庫存總覽與庫存流水是同一頁（ga-inventory），舊網址 ?view=transactions 以完整 href 對應到 payload.view。
  "/general-affairs/inventory": { kind: "ga-inventory", flag: "gaInventory", payload: { view: "balances" } },
  "/general-affairs/inventory?view=transactions": { kind: "ga-inventory", flag: "gaInventory", payload: { view: "transactions" } },
  "/general-affairs/inventory/transfers": { kind: "ga-inventory-transfers", flag: "gaInventoryTransfers" },
  "/general-affairs/reports/new": { kind: "ga-report-create", flag: "gaReportCreate" },
  "/general-affairs/reports/mine": { kind: "ga-my-reports", flag: "gaMyReports" },
  "/general-affairs/requests": { kind: "ga-requests", flag: "gaRequests" },
  "/general-affairs/part-fulfillments": { kind: "ga-part-fulfillments", flag: "gaPartFulfillments" },
  // 第 4 批 G25：採購單清單與待簽核清單（?view=approvals 以完整 href 對應到獨立頁面）。
  "/general-affairs/purchase-orders": { kind: "ga-purchase-orders", flag: "gaPurchaseOrders" },
  "/general-affairs/purchase-orders?view=approvals": { kind: "ga-purchase-approvals", flag: "gaPurchaseApprovals" },
  // 第 5 批 G18：工單中心。
  "/general-affairs/work-orders": { kind: "ga-work-orders", flag: "gaWorkOrders" },
  // 第 6 批 G20／G21：廠商資料、服務分類、服務區域（合作紀錄與採購分析本批後段才移植，維持舊版連結）。
  "/general-affairs/vendors": { kind: "ga-vendors", flag: "gaVendors" },
  "/general-affairs/vendors/categories": { kind: "ga-vendor-categories", flag: "gaVendorCategories" },
  "/general-affairs/vendors/regions": { kind: "ga-vendor-regions", flag: "gaVendorRegions" },
  // 第 6 批 G22：合作紀錄（廠商績效）與採購分析。
  "/general-affairs/vendors/stats": { kind: "ga-vendor-stats", flag: "gaVendorStats" },
  "/general-affairs/vendors/purchases": { kind: "ga-purchase-analysis", flag: "gaPurchaseAnalysis" },
  // 第 6 批 G23：水電網費帳單與費用報表。
  "/general-affairs/utility-bills": { kind: "ga-utility-bills", flag: "gaUtilityBills" },
  "/general-affairs/utility-bills/report": { kind: "ga-utility-bills-report", flag: "gaUtilityBills" },
  // 第 4.5 批：進貨發票（舊版沒有這頁，網址是新版自訂）。
  "/general-affairs/purchase-invoices": { kind: "ga-purchase-invoices", flag: "gaPurchaseInvoices" },
  "/general-affairs/payment-requests": { kind: "ga-payment-requests", flag: "gaPaymentRequests" },
};

export type GaNavInput = {
  has: (...codes: string[]) => boolean;
  permissions: { has(code: string): boolean } & Iterable<string>;
  roleCodes: { has(code: string): boolean };
  isAdmin: boolean;
  /** 名單內任何身分（store_managers）；只影響設備清冊與貼標待辦入口。 */
  storeMember?: boolean;
  /** 門市名單任何身分（G11 庫存位置唯讀入口）。 */
  rosterMember?: boolean;
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
    if (page) {
      out.kind = page.kind;
      if (page.payload) out.payload = page.payload;
    }
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
  const flags = gaFlags(input.has, isStoreManagerRole(input.roleCodes), !!input.storeMember, !!input.rosterMember, (...codes) => codes.some((c) => (input.permissions as any)?.has?.(c)));
  // 只憑門市名單身分（督導、區經理）進中心的人（2026-11-11 驗收決定 A）：沒有店長角色、沒有任何總務權限，也不是管理員。
  // 舊側欄的項目只要沒設旗標就會對任何進得了中心的人顯示（需求工作台、料件處理中心、盤點等），這些對他們都是點了被擋的壞入口，
  // 所以只留已移植且旗標為 true 的新版頁面（庫存總覽、調撥、庫存位置、自己門市的清冊等），不留舊網址外連與停用說明。
  const rosterOnly = !!input.rosterMember && !isStoreManagerRole(input.roleCodes) && !input.isAdmin && !input.has(...GA_CENTER_CODES);
  const keepPorted = (i: GaNavItem): GaNavItem | null => {
    const children = i.children?.map(keepPorted).filter((c): c is GaNavItem => !!c);
    if (i.kind) return children?.length ? { ...i, children } : { ...i, children: undefined };
    return children?.length ? { id: i.id, label: i.label, children } : null;
  };
  const out = groups
    .map((g) => {
      let items = g.items.map((i) => toItem(i, flags)).filter((i): i is GaNavItem => !!i && (!!i.href || !!i.disabled || !!i.children?.length));
      if (rosterOnly) items = items.map(keepPorted).filter((i): i is GaNavItem => !!i).map((i) => { if (!i.children) delete i.children; return i; });
      return { id: g.id, label: g.label, items };
    })
    .filter((g) => g.items.length);
  // 第 6 批 G23：舊側欄「水電電話網路費」是帶子項（費用報表）的項目，側欄外殼對有子項的項目只當展開鈕；帳單列表本身要有自己的入口，所以拆成「帳單列表」與「費用報表」兩個子項。
  for (const g of out) {
    for (const item of g.items) {
      if (item.id === "utility-bills" && item.kind && item.children?.length) {
        item.children = [{ id: "utility-bills-list", label: "帳單列表", href: item.href, kind: item.kind }, ...item.children];
        delete item.kind;
        delete item.href;
        delete item.payload;
      }
    }
  }
  // 設施保固管理：舊版有頁面（/general-affairs/facilities/warranties）但側欄沒有入口；新版補在「設施管理」最後一項，方便找到。
  if (flags.gaFacilityWarranties) {
    for (const g of out) {
      const fac = g.items.find((i) => i.id === "facilities");
      if (fac?.children) fac.children.push({ id: "facility-warranties", label: "保固管理", kind: "ga-facility-warranties" });
    }
  }
  // 設施 QR 標籤列印（解讀 (b)）：舊版沒有，新頁補在「設施管理」最後一項。
  if (flags.gaFacilityLabels) {
    for (const g of out) {
      const fac = g.items.find((i) => i.id === "facilities");
      if (fac?.children) fac.children.push({ id: "facility-labels", label: "QR 標籤列印", kind: "ga-facility-labels" });
    }
  }
  // 第 2 批新頁面沒有舊網址（不改舊版側欄元件）：貼標待辦與複核追加在「資產與庫存」群組最後。
  const extra: GaNavItem[] = [];
  // 店長身分：舊版側欄沒有「設施管理」群組（群組要設施權限），但舊版設施頁本身對店長開放（canAccessGeneralAffairsFacilities 含店長）；
  // 新版店長要在手機看設施清冊與維修紀錄，所以舊側欄沒有列出時補在這裡。
  const present = new Set<string>();
  const collect = (items: GaNavItem[]) => items.forEach((i) => { if (i.kind) present.add(i.kind); if (i.children) collect(i.children); });
  out.forEach((g) => collect(g.items));
  if (flags.gaFacilities && !present.has("ga-facilities")) extra.push({ id: "facility-list-new", label: "設施清冊", kind: "ga-facilities" });
  if (flags.gaFacilityHistory && !present.has("ga-facility-history")) extra.push({ id: "facility-history-new", label: "設施維修紀錄", kind: "ga-facility-history" });
  // G11 庫存位置：舊側欄要位置查看／管理權限才列，但店長、督導、區經理（門市名單身分）也能唯讀看自己門市（C12），所以舊側欄沒列時補在這裡。
  if (flags.gaInventoryLocations && !present.has("ga-inventory-locations")) extra.push({ id: "inventory-locations-new", label: "庫存位置", kind: "ga-inventory-locations" });
  // G12 庫存總覽：舊側欄要餘額／流水／記帳權限才列；只憑門市名單身分的人舊側欄不列，補在「資產與庫存」最上層（唯讀）。
  if (flags.gaInventory && !present.has("ga-inventory")) extra.push({ id: "inventory-overview-new", label: "庫存總覽", kind: "ga-inventory", payload: { view: "balances" } });
  // G13 調撥與收貨：舊側欄要調撥／記帳權限才列；只憑門市名單身分（店長、督導、區經理）的人舊側欄不列，補在這裡（唯讀）。
  if (flags.gaInventoryTransfers && !present.has("ga-inventory-transfers")) extra.push({ id: "inventory-transfers-new", label: "調撥與收貨", kind: "ga-inventory-transfers" });
  if (flags.gaTransfers) extra.push({ id: "asset-transfers", label: "轉移單", kind: "ga-transfers" });
  // 第 4 批 G14 至 G17：舊側欄要求維修模組權限旗標才列「新增需求／我的追蹤」；只持需求單權限的人舊側欄不列，補在原本的群組（沒有該群組就建立）。
  const ensure = (id: string, label: string, item: GaNavItem) => {
    let g = out.find((x) => x.id === id);
    if (!g) { g = { id, label, items: [] }; out.push(g); }
    g.items.push(item);
  };
  if (flags.gaReportCreate && !present.has("ga-report-create")) ensure("requests", "門市追蹤", { id: "report-create-new", label: "新增需求", kind: "ga-report-create" });
  if (flags.gaMyReports && !present.has("ga-my-reports")) ensure("requests", "門市追蹤", { id: "my-reports-new", label: "我的追蹤", kind: "ga-my-reports" });
  if (flags.gaRequests && !present.has("ga-requests")) ensure("operations", "作業管理", { id: "requests-new", label: "總務需求工作台", kind: "ga-requests" });
  if (flags.gaPartFulfillments && !present.has("ga-part-fulfillments")) ensure("operations", "作業管理", { id: "part-fulfillments-new", label: "料件處理中心", kind: "ga-part-fulfillments" });
  // 第 4 批 G25：舊版沒有採購單頁；補在「作業管理」。待簽核清單只給持採購核准權限者。
  // 第 5 批 G18：舊側欄要工單模組權限旗標才列「工單中心」；只持維修回報或跨部門維修權限的人舊側欄不列，補在「作業管理」。
  if (flags.gaWorkOrders && !present.has("ga-work-orders")) ensure("operations", "作業管理", { id: "work-orders-new", label: "工單中心", kind: "ga-work-orders" });
  if (flags.gaPurchaseOrders && !present.has("ga-purchase-orders")) ensure("operations", "作業管理", { id: "purchase-orders-new", label: "採購單", href: "/general-affairs/purchase-orders", kind: "ga-purchase-orders" });
  if (flags.gaPurchaseApprovals && !present.has("ga-purchase-approvals")) ensure("operations", "作業管理", { id: "purchase-approvals-new", label: "待簽核採購單", href: "/general-affairs/purchase-orders?view=approvals", kind: "ga-purchase-approvals" });
  // 第 4.5 批：進貨發票（舊版沒有發票、請款、付款功能）；補在「作業管理」，入口用資料庫語意（請款檢視或管理）。
  if (flags.gaPurchaseInvoices && !present.has("ga-purchase-invoices")) ensure("operations", "作業管理", { id: "purchase-invoices-new", label: "進貨發票", href: "/general-affairs/purchase-invoices", kind: "ga-purchase-invoices" });
  if (flags.gaPaymentRequests && !present.has("ga-payment-requests")) ensure("operations", "作業管理", { id: "payment-requests-new", label: "請款單", href: "/general-affairs/payment-requests", kind: "ga-payment-requests" });
  if (flags.gaOnboardingTasks) extra.push({ id: "onboarding-tasks", label: "貼標待辦", kind: "ga-onboarding-tasks" });
  if (flags.gaOnboardingReview) extra.push({ id: "onboarding-review", label: "貼標複核", kind: "ga-onboarding-review" });
  if (flags.gaOnboardingProgress) extra.push({ id: "onboarding-progress", label: "上線貼標進度", kind: "ga-onboarding-progress" });
  if (flags.gaAssetImport) extra.push({ id: "asset-import", label: "Excel 匯入", kind: "ga-asset-import" });
  if (extra.length) {
    const target = out.find((g) => g.id === "assets-inventory");
    if (target) target.items.push(...extra);
    else out.push({ id: "assets-inventory", label: "資產與庫存", items: extra });
  }
  return out;
}
