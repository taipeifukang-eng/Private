// 新版工作台頁面種類（kind）對應舊版路由的「唯一來源」（M9 F01S：C2「回舊版」連結、N2 逐頁備援開關）。
// 此檔只 import 型別（page-kinds.ts 也是無相依檔），Next 端、Vue 工作台與 Vitest 都直接引用。
//
// 規則：
//  1. 每個 WorkTabKind 都必須出現在 LEGACY_ROUTE_MAP；沒有舊版對應就填 null，並在 NO_LEGACY_REASON 寫原因（單元測試強制）。
//  2. 值是「舊版 Next 路由」（以 / 開頭、不含網域）。需要 id 或一次性代碼的舊版明細頁（/inspection/[id]、/assignment/[id]、
//     /general-affairs/assets/scan/[token]…）一律回到它的清單／入口頁：新版的 recordId 不等於舊版 id，硬湊會連到錯的頁面。
//  3. 單元測試會逐一確認每個非 null 路由在 app/ 底下真的有 page.tsx（含動態路由以外的靜態路由）。
//  4. 只有「導覽 kind 且有舊版路由，且不在 FALLBACK_LOCKED_KINDS」的頁面可以用 N2 備援開關切回舊版（FALLBACK_SWITCHABLE_KINDS）；明細頁由其清單頁帶出，不單獨切換。
import { WORKSPACE_NAV_KINDS, type WorkTabKind, type WorkspaceNavKind } from "./page-kinds";

const GA = "/general-affairs";

export const LEGACY_ROUTE_MAP: Record<WorkTabKind, string | null> = {
  // 人員異動、員工、門市
  transfers: "/admin/promotion-management",
  "movement-management": "/admin/promotion-management",
  "movement-draft": "/admin/promotion-management",
  "movement-history": "/admin/promotion-management",
  employees: "/admin/employee-management",
  "employee-history": "/admin/employee-management",
  "employee-create": "/admin/employee-management",
  "employee-birthdays": "/admin/employee-management",
  "employee-import": "/admin/import-employees",
  departments: "/admin/departments",
  "department-detail": "/admin/departments",
  "department-work-editor": "/admin/departments",
  organization: "/admin/organization",
  "organization-editor": "/admin/organization",
  calendar: "/organization/calendar",
  stores: "/admin/stores",
  "store-map": "/admin/stores/map",
  "store-promotions": "/admin/stores",
  "store-personnel": "/admin/stores",
  "store-personnel-history": "/admin/stores",
  "store-employees": "/admin/stores",
  "store-editor": "/admin/stores",
  "store-relocation": "/admin/stores",
  "store-history-editor": "/admin/stores",
  supervisors: "/admin/supervisors",
  "supervisor-edit": "/admin/supervisors",
  "store-managers": "/admin/store-managers",
  "store-manager-edit": "/admin/store-managers",
  // 任務
  "task-management": "/admin/templates",
  "task-copy": "/admin/templates",
  "task-assign": "/admin/templates",
  "task-template-editor": "/admin/templates",
  "task-management-detail": "/admin/templates",
  "task-archive": "/admin/archived",
  "task-archive-detail": "/admin/archived",
  "my-tasks": "/my-tasks",
  "task-runner": "/my-tasks",
  dashboard: "/dashboard",
  // 督導巡店
  inspections: "/inspection",
  "inspection-editor": "/inspection/new",
  "inspection-detail": "/inspection",
  "inspection-print": "/inspection",
  "inspection-compare": "/inspection/compare",
  "inspection-settings": "/admin/inspection-templates",
  "inspection-setting-edit": "/admin/inspection-templates",
  improvements: "/inspection/improvements",
  "improvement-detail": "/inspection/improvements",
  "supervisor-log": "/supervisor-management-log",
  // 活動
  campaigns: "/admin/activity-management",
  "campaign-edit": "/admin/activity-management",
  "campaign-schedule": "/admin/activity-management",
  "activity-view": "/activity-management",
  "activity-view-detail": "/activity-management",
  // 每月人員狀態、業績、盤點、各類管理
  monthly: "/monthly-status",
  "monthly-edit": "/monthly-status",
  "monthly-export": "/admin/export-monthly-status",
  "monthly-release": "/monthly-release",
  performance: "/admin/performance",
  "performance-edit": "/admin/performance",
  "performance-thresholds": "/admin/performance",
  "performance-prescription": "/admin/performance",
  "performance-bonus": "/admin/performance",
  inventory: "/inventory",
  "employee-purchases": "/admin/employee-purchases",
  pharmacists: "/admin/pharmacist-management",
  relationships: "/store/relationship-members",
  "products-master": "/cross-dept/products-master",
  merchandise: "/cross-dept/merchandise",
  "clinic-selfpay": "/store/clinic-selfpay-margin",
  "cross-dept-maintenance": "/cross-dept/maintenance",
  roles: "/admin/roles",
  users: "/admin/users",
  // 總務服務中心（路由與 lib/workspace/general-affairs/nav.ts 的舊網址對照一致）
  "ga-center": GA,
  "ga-equipment-categories": `${GA}/equipment/categories`,
  "ga-facility-categories": `${GA}/facilities/categories`,
  "ga-part-categories": `${GA}/parts/categories`,
  "ga-parts": `${GA}/parts`,
  "ga-part-create": `${GA}/parts/new`,
  "ga-part-compat": `${GA}/parts/compatibilities`,
  "ga-equipment-templates": `${GA}/equipment/templates`,
  "ga-facility-templates": `${GA}/facilities/templates`,
  "ga-equipment": `${GA}/equipment`,
  "ga-equipment-create": `${GA}/equipment/new`,
  "ga-facilities": `${GA}/facilities`,
  "ga-facility-create": `${GA}/facilities/new`,
  "ga-equipment-warranties": `${GA}/equipment/warranties`,
  "ga-facility-warranties": `${GA}/facilities/warranties`,
  "ga-equipment-history": `${GA}/equipment/maintenance-history`,
  "ga-facility-history": `${GA}/facilities/maintenance-history`,
  "ga-equipment-labels": `${GA}/equipment/labels`,
  "ga-inventory-locations": `${GA}/inventory/locations`,
  "ga-inventory": `${GA}/inventory`,
  "ga-inventory-transfers": `${GA}/inventory/transfers`,
  "ga-report-create": `${GA}/reports/new`,
  "ga-my-reports": `${GA}/reports/mine`,
  "ga-requests": `${GA}/requests`,
  "ga-part-fulfillments": `${GA}/part-fulfillments`,
  "ga-work-orders": `${GA}/work-orders`,
  "ga-vendors": `${GA}/vendors`,
  "ga-vendor-categories": `${GA}/vendors/categories`,
  "ga-vendor-regions": `${GA}/vendors/regions`,
  "ga-vendor-stats": `${GA}/vendors/stats`,
  "ga-purchase-analysis": `${GA}/vendors/purchases`,
  "ga-utility-bills": `${GA}/utility-bills`,
  "ga-utility-bills-report": `${GA}/utility-bills/report`,
  // ---- 舊版沒有對應頁面（新功能或新版專屬）：不顯示「回舊版」，也不能切回舊版 ----
  "ga-facility-labels": null,
  "ga-asset-scan": null,
  "ga-transfers": null,
  "ga-onboarding-tasks": null,
  "ga-onboarding-review": null,
  "ga-onboarding-progress": null,
  "ga-asset-import": null,
  "ga-purchase-orders": null,
  "ga-purchase-order-edit": null,
  "ga-purchase-approvals": null,
  "ga-purchase-invoices": null,
  "ga-purchase-invoice-edit": null,
  "ga-payment-requests": null,
  "ga-payment-request-edit": null,
  "ga-payment-request-print": null,
  "page-fallbacks": null,
};

/** 沒有舊版對應的頁面與原因（每個 null 都要有一條，單元測試強制）。 */
export const NO_LEGACY_REASON: Partial<Record<WorkTabKind, string>> = {
  "ga-facility-labels": "舊版只有設備 QR 標籤頁，沒有設施標籤頁（新功能）。",
  "ga-asset-scan": "舊版掃描網址含一次性代碼（/general-affairs/assets/scan/[token]），無法由新版頁籤還原；QR 永久網址本來就同時支援新舊版。",
  "ga-transfers": "設備與設施轉移單是新功能，舊版沒有。",
  "ga-onboarding-tasks": "上線貼標待辦是新功能，舊版沒有。",
  "ga-onboarding-review": "上線貼標複核是新功能，舊版沒有。",
  "ga-onboarding-progress": "上線貼標進度是新功能，舊版沒有。",
  "ga-asset-import": "設備設施 Excel 匯入是新功能，舊版沒有。",
  "ga-purchase-orders": "採購單（含到貨、配發）是新功能，舊版沒有。",
  "ga-purchase-order-edit": "採購單編輯是新功能，舊版沒有。",
  "ga-purchase-approvals": "待簽核採購單是新功能，舊版沒有。",
  "ga-purchase-invoices": "進貨發票是新功能，舊版沒有（第 4.5 批）。",
  "ga-purchase-invoice-edit": "發票編輯是新功能，舊版沒有（第 4.5 批）。",
  "ga-payment-requests": "請款單是新功能，舊版沒有付款相關功能（第 4.5 批）。",
  "ga-payment-request-edit": "請款單編輯是新功能，舊版沒有（第 4.5 批）。",
  "ga-payment-request-print": "請款單列印是新功能，舊版沒有（第 4.5 批）。",
  "page-fallbacks": "「頁面回舊版設定」是新版專屬的系統管理工具，舊版沒有。",
};

/** kind 對應的舊版路由；沒有對應回傳 null。 */
export function legacyRouteFor(kind: string): string | null {
  return (LEGACY_ROUTE_MAP as Record<string, string | null>)[kind] ?? null;
}

/** 可以用 N2 備援開關切回舊版的 kind：導覽 kind（選單直接開的頁面）且有舊版對應。 */
/** 即使有舊版對應也不可切回舊版的頁面：roles 是「頁面回舊版設定」的唯一入口，切走後管理員就無法從畫面改回新版（備援機制自我鎖死）。 */
export const FALLBACK_LOCKED_KINDS: readonly WorkspaceNavKind[] = ["roles"];

export const FALLBACK_SWITCHABLE_KINDS: readonly WorkspaceNavKind[] = WORKSPACE_NAV_KINDS.filter(
  (k) => LEGACY_ROUTE_MAP[k] !== null && !FALLBACK_LOCKED_KINDS.includes(k),
);

export function isFallbackSwitchable(kind: string): kind is WorkspaceNavKind {
  return (FALLBACK_SWITCHABLE_KINDS as readonly string[]).includes(kind);
}
