// 頁面註冊表的「純資料」部分（標題、所需權限、預設門市）。
// 不 import 任何 .vue，讓 Vitest 能直接測試；元件對照放在 workspace-pages.ts。
// 以 Record<WorkTabKind, ...> 強制每個 kind 都要有登錄，漏登錄會在 vue-tsc 失敗。
import type { WorkTabKind } from "../../lib/workspace/page-kinds";
import type { Session } from "./stores";

export type CapabilityKey = keyof Session["capabilities"];
export type Capabilities = Partial<Record<CapabilityKey, boolean>>;

export type PageMeta = {
  /** 頁籤預設標題。 */
  title: string;
  /** 具備其中任一 capability 即可使用（OR）。 */
  permission: readonly CapabilityKey[];
  /** 新開此頁時是否帶入「新頁預設門市」。 */
  usesDefaultStore?: true;
};

const meta = (
  title: string,
  permission: readonly CapabilityKey[],
  usesDefaultStore?: true,
): PageMeta => (usesDefaultStore ? { title, permission, usesDefaultStore } : { title, permission });

export const WORKSPACE_PAGE_META: Record<WorkTabKind, PageMeta> = {
  transfers: meta("調店申請", ["transfers"]),
  "movement-management": meta("人員異動管理", ["movementDraft", "movementHistory", "transfers"]),
  "movement-draft": meta("批次異動驗證", ["movementDraft"]),
  "movement-history": meta("人員異動紀錄", ["movementHistory"]),
  employees: meta("員工管理", ["employees"]),
  "employee-history": meta("員工異動歷程", ["employees"]),
  "employee-create": meta("新增員工", ["employeeCreate"]),
  "employee-birthdays": meta("員工生日匯入", ["employeeBirthdays"]),
  "employee-import": meta("批次匯入員工", ["employeeImport"]),
  departments: meta("部門管理", ["departments"]),
  "department-detail": meta("部門工作頁", ["departments"]),
  "department-work-editor": meta("工作職掌", ["departments"]),
  organization: meta("公司組織", ["organization"]),
  "organization-editor": meta("組織單位", ["organization"]),
  "store-map": meta("門市整合地圖", ["storeMap"]),
  "store-promotions": meta("批次升遷", ["storeManagement"]),
  "store-personnel": meta("門市員工主檔", ["storeManagement"]),
  "store-personnel-history": meta("員工歷程", ["storeManagement"]),
  "store-employees": meta("門市員工", ["storeManagement"]),
  stores: meta("門市管理", ["storeManagement"]),
  "store-editor": meta("門市資料", ["storeManagement"]),
  "store-relocation": meta("門市搬遷沿革", ["storeManagement"]),
  "store-history-editor": meta("補建歷史沿革", ["storeManagement"]),
  supervisors: meta("經理／督導管理", ["supervisors"]),
  "supervisor-edit": meta("管理門市指派", ["supervisors"]),
  "store-managers": meta("店長指派", ["storeManagers"]),
  "store-manager-edit": meta("編輯店長指派", ["storeManagers"]),
  "task-copy": meta("複製範本", ["taskManagement"]),
  "task-assign": meta("派發任務", ["taskManagement"]),
  "task-template-editor": meta("任務範本", ["taskManagement"]),
  "task-management": meta("任務管理", ["taskManagement"]),
  "task-management-detail": meta("任務管理明細", ["taskManagement"]),
  "task-archive": meta("已封存任務", ["taskArchive"]),
  "task-archive-detail": meta("封存任務紀錄", ["taskArchive"]),
  "my-tasks": meta("我的任務", ["tasks"]),
  "task-runner": meta("任務內容", ["tasks"]),
  "inspection-print": meta("巡店列印預覽", ["inspections"]),
  "inspection-settings": meta("巡店範本設定", ["inspectionSettings"]),
  "inspection-setting-edit": meta("編輯巡店設定", ["inspectionSettings"]),
  improvements: meta("待改善追蹤", ["improvements"], true),
  "improvement-detail": meta("改善回報", ["improvements"]),
  "inspection-compare": meta("巡店比較", ["compareInspections"], true),
  "inspection-editor": meta("新增巡店", ["createInspections", "inspections"]),
  "inspection-detail": meta("巡店紀錄明細", ["inspections"]),
  "campaign-schedule": meta("活動門市排程", ["campaigns"]),
  inspections: meta("巡店列表", ["inspections"], true),
  campaigns: meta("活動管理", ["campaigns"]),
  // 新增活動；帶 recordId 開啟時標題改為「編輯活動」，見 pageTitle()。
  "campaign-edit": meta("新增活動", ["campaigns"]),
  monthly: meta("每月人員狀態", ["monthly"], true),
  "monthly-edit": meta("人員明細", ["monthly"]),
  "monthly-export": meta("資料匯出", ["monthlyExport"]),
  // W04：登入即可看（session 對所有已登入者回傳 monthlyRelease: true）。
  "monthly-release": meta("每月版更內容", ["monthlyRelease"]),
  performance: meta("業績管理", ["performance"], true),
  "performance-edit": meta("編輯業績", ["performance"]),
  "performance-thresholds": meta("獎金閾值", ["performance"]),
  "performance-prescription": meta("處方箋報表", ["performance"]),
  "performance-bonus": meta("每月獎金", ["performance"]),
  inventory: meta("盤點管理", ["inventory"], true),
  "employee-purchases": meta("員工購物管理", ["employeePurchases"]),
  pharmacists: meta("藥師管理", ["pharmacists"]),
  relationships: meta("關係會員", ["relationships"]),
  roles: meta("角色權限管理", ["roles"]),
  users: meta("使用者管理", ["users"]),
};

export function pageTitle(kind: WorkTabKind, recordId?: string): string {
  if (kind === "campaign-edit" && recordId) return "編輯活動";
  return WORKSPACE_PAGE_META[kind].title;
}

export function pageUsesDefaultStore(kind: WorkTabKind): boolean {
  return WORKSPACE_PAGE_META[kind].usesDefaultStore === true;
}

/** 與重構前 App.vue allowed() 完全相同的語意：工作階段過期或尚未登入一律不可用。 */
export function isPageAllowed(
  kind: WorkTabKind,
  capabilities: Capabilities | undefined | null,
  expired = false,
): boolean {
  if (expired || !capabilities) return false;
  return WORKSPACE_PAGE_META[kind].permission.some((key) => !!capabilities[key]);
}
