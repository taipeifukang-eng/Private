// WP5：舊版選單 -> 新版工作台的連結計算（純函式，無 Next／資料庫相依，可單元測試）。
// 規則（任何一條成立就維持舊版連結，也就是不放進 links）：
//  1. 閘門關閉（WORKSPACE_ENABLED 不是 true、設定不符）。
//  2. 開放對象是 admin_only 而使用者不是管理員。
//  3. 該選單項目沒有對應的新版 kind，或 kind 在逐頁「回舊版」備援集合內。
// 注意：LEGACY_ROUTE_MAP 是多對一，不能反查；這裡用「導覽項目自己的 kind」建一張專用的表。
// 備援不是安全邊界，真正的把關在 API（assertWorkspace 與 context 的 audience 檢查）。
import { evaluateGate } from "./site-gate";
import { WORKSPACE_NAV_KINDS, type WorkspaceNavKind } from "./page-kinds";

/** 舊版 Navbar 的選單路徑 -> 新版導覽 kind（與 lib/workspace/navigation.ts 各項目的 kind 一致）。 */
export const LEGACY_HREF_KIND: Readonly<Record<string, WorkspaceNavKind>> = {
  "/my-tasks": "my-tasks",
  "/dashboard": "dashboard",
  "/admin/templates": "task-management",
  "/admin/archived": "task-archive",
  "/organization/calendar": "calendar",
  "/admin/organization": "organization",
  "/admin/departments": "departments",
  "/admin/store-managers": "store-managers",
  "/admin/supervisors": "supervisors",
  "/admin/stores": "stores",
  "/admin/employee-management": "employees",
  "/admin/promotion-management": "movement-management",
  "/admin/import-employees": "employee-import",
  "/admin/activity-management": "campaigns",
  "/activity-management": "activity-view",
  "/inventory": "inventory",
  "/admin/performance": "performance",
  "/admin/pharmacist-management": "pharmacists",
  "/admin/employee-purchases": "employee-purchases",
  "/store/clinic-selfpay-margin": "clinic-selfpay",
  "/store/relationship-members": "relationships",
  "/cross-dept/products-master": "products-master",
  "/monthly-status": "monthly",
  "/admin/export-monthly-status": "monthly-export",
  "/inspection": "inspections",
  "/inspection/improvements": "improvements",
  "/admin/inspection-templates": "inspection-settings",
  "/supervisor-management-log": "supervisor-log",
  "/general-affairs": "ga-center",
  "/cross-dept/merchandise": "merchandise",
  "/cross-dept/maintenance": "cross-dept-maintenance",
  "/admin/users": "users",
  "/admin/roles": "roles",
};

export function kindForLegacyHref(href: string): WorkspaceNavKind | null {
  const kind = LEGACY_HREF_KIND[href];
  return kind && (WORKSPACE_NAV_KINDS as readonly string[]).includes(kind) ? kind : null;
}

export function newHrefForKind(kind: string): string {
  return `/workspace/index.html#/open/${kind}`;
}

export type MenuTargets = { enabled: boolean; links: Record<string, string> };

export function resolveMenuTargets(input: {
  isAdmin: boolean;
  env: Record<string, string | undefined>;
  fallbackKinds?: ReadonlySet<string> | readonly string[];
}): MenuTargets {
  const gate = evaluateGate(input.env);
  if (!gate.open) return { enabled: false, links: {} };
  if (gate.audience === "admin_only" && !input.isAdmin) return { enabled: false, links: {} };
  const fallback = new Set(input.fallbackKinds ?? []);
  const links: Record<string, string> = {};
  for (const href of Object.keys(LEGACY_HREF_KIND)) {
    const kind = kindForLegacyHref(href);
    if (!kind || fallback.has(kind)) continue;
    links[href] = newHrefForKind(kind);
  }
  return { enabled: true, links };
}
