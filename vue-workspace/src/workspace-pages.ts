// Vue 工作台頁面註冊表（T03）：kind -> 元件。標題與權限在 workspace-page-meta.ts。
// 以 Record<WorkTabKind, ...> 強制每個 kind 都要登錄元件；漏登錄時 vue-tsc 會失敗。
import type { Component } from "vue";
import type { WorkTabKind } from "../../lib/workspace/page-kinds";
import CampaignEdit from "./pages/CampaignEdit.vue";
import CampaignSchedule from "./pages/CampaignSchedule.vue";
import ActivityViewDetail from "./pages/ActivityViewDetail.vue";
import ActivityViewList from "./pages/ActivityViewList.vue";
import Campaigns from "./pages/Campaigns.vue";
import DepartmentDetail from "./pages/DepartmentDetail.vue";
import DepartmentWorkEditor from "./pages/DepartmentWorkEditor.vue";
import Departments from "./pages/Departments.vue";
import EmployeeBirthdays from "./pages/EmployeeBirthdays.vue";
import EmployeeCreate from "./pages/EmployeeCreate.vue";
import EmployeeImport from "./pages/EmployeeImport.vue";
import EmployeePurchases from "./pages/EmployeePurchases.vue";
import Employees from "./pages/Employees.vue";
import ImprovementDetail from "./pages/ImprovementDetail.vue";
import Improvements from "./pages/Improvements.vue";
import InspectionCompare from "./pages/InspectionCompare.vue";
import InspectionDetail from "./pages/InspectionDetail.vue";
import InspectionEditor from "./pages/InspectionEditor.vue";
import InspectionPrint from "./pages/InspectionPrint.vue";
import InspectionSettingEdit from "./pages/InspectionSettingEdit.vue";
import InspectionSettings from "./pages/InspectionSettings.vue";
import Inspections from "./pages/Inspections.vue";
import Inventory from "./pages/Inventory.vue";
import Monthly from "./pages/Monthly.vue";
import MonthlyEdit from "./pages/MonthlyEdit.vue";
import MonthlyExport from "./pages/MonthlyExport.vue";
import MonthlyRelease from "./pages/MonthlyRelease.vue";
import MovementDraft from "./pages/MovementDraft.vue";
import MovementHistory from "./pages/MovementHistory.vue";
import MovementManagement from "./pages/MovementManagement.vue";
import MyTasks from "./pages/MyTasks.vue";
import Dashboard from "./pages/Dashboard.vue";
import Organization from "./pages/Organization.vue";
import OrganizationCalendar from "./pages/OrganizationCalendar.vue";
import OrganizationEditor from "./pages/OrganizationEditor.vue";
import Performance from "./pages/Performance.vue";
import PerformanceBonus from "./pages/PerformanceBonus.vue";
import PerformancePrescription from "./pages/PerformancePrescription.vue";
import PerformanceThresholds from "./pages/PerformanceThresholds.vue";
import Pharmacists from "./pages/Pharmacists.vue";
import Relationships from "./pages/Relationships.vue";
import RoleManagement from "./pages/Roles.vue";
import StoreEditor from "./pages/StoreEditor.vue";
import StoreEmployees from "./pages/StoreEmployees.vue";
import StoreManagerEdit from "./pages/StoreManagerEdit.vue";
import StoreManagers from "./pages/StoreManagers.vue";
import StoreMap from "./pages/StoreMap.vue";
import StorePersonnel from "./pages/StorePersonnel.vue";
import StorePromotions from "./pages/StorePromotions.vue";
import StoreRelocation from "./pages/StoreRelocation.vue";
import Stores from "./pages/Stores.vue";
import SupervisorEdit from "./pages/SupervisorEdit.vue";
import Supervisors from "./pages/Supervisors.vue";
import TaskArchive from "./pages/TaskArchive.vue";
import TaskArchiveDetail from "./pages/TaskArchiveDetail.vue";
import TaskDispatch from "./pages/TaskDispatch.vue";
import TaskManagement from "./pages/TaskManagement.vue";
import TaskManagementDetail from "./pages/TaskManagementDetail.vue";
import TaskRunner from "./pages/TaskRunner.vue";
import TaskTemplateEditor from "./pages/TaskTemplateEditor.vue";
import Transfers from "./pages/Transfers.vue";
import GaCenter from "./pages/ga/GaCenter.vue";
import AssetCategories from "./pages/ga/AssetCategories.vue";
import AssetTemplates from "./pages/ga/AssetTemplates.vue";
import PartCompatibilities from "./pages/ga/PartCompatibilities.vue";
import PartCreate from "./pages/ga/PartCreate.vue";
import Parts from "./pages/ga/Parts.vue";
import Equipment from "./pages/ga/Equipment.vue";
import EquipmentCreate from "./pages/ga/EquipmentCreate.vue";
import Facilities from "./pages/ga/Facilities.vue";
import FacilityCreate from "./pages/ga/FacilityCreate.vue";
import AssetWarranties from "./pages/ga/AssetWarranties.vue";
import AssetMaintenanceHistory from "./pages/ga/AssetMaintenanceHistory.vue";
import OnboardingTasks from "./pages/ga/OnboardingTasks.vue";
import OnboardingReview from "./pages/ga/OnboardingReview.vue";
import AssetLabels from "./pages/ga/AssetLabels.vue";
import AssetScan from "./pages/ga/AssetScan.vue";
import AssetTransfers from "./pages/ga/AssetTransfers.vue";
import OnboardingProgress from "./pages/ga/OnboardingProgress.vue";
import AssetImport from "./pages/ga/AssetImport.vue";
import InventoryLocations from "./pages/ga/InventoryLocations.vue";
import GaInventory from "./pages/ga/GaInventory.vue";
import UserManagement from "./pages/Users.vue";
import PublicDemo from "./pages/PublicDemo.vue";
import Login from "./pages/Login.vue";
import Register from "./pages/Register.vue";
import ForgotPassword from "./pages/ForgotPassword.vue";
import ResetPassword from "./pages/ResetPassword.vue";
import {
  WORKSPACE_PAGE_META,
  isPageAllowed,
  pageTitle,
  pageUsesDefaultStore,
  type PageMeta,
} from "./workspace-page-meta";
export { WORKSPACE_PAGE_META, isPageAllowed, pageTitle, pageUsesDefaultStore };
export type { PageMeta };

export type WorkspacePage = PageMeta & { component: Component };

const components: Record<WorkTabKind, Component> = {
  transfers: Transfers,
  "movement-management": MovementManagement,
  "movement-draft": MovementDraft,
  "movement-history": MovementHistory,
  employees: Employees,
  "employee-history": Employees,
  "employee-create": EmployeeCreate,
  "employee-birthdays": EmployeeBirthdays,
  "employee-import": EmployeeImport,
  departments: Departments,
  "department-detail": DepartmentDetail,
  "department-work-editor": DepartmentWorkEditor,
  organization: Organization,
  calendar: OrganizationCalendar,
  "organization-editor": OrganizationEditor,
  "store-map": StoreMap,
  "store-promotions": StorePromotions,
  "store-personnel": StorePersonnel,
  "store-personnel-history": StorePersonnel,
  "store-employees": StoreEmployees,
  stores: Stores,
  "store-editor": StoreEditor,
  "store-relocation": StoreRelocation,
  "store-history-editor": StoreRelocation,
  supervisors: Supervisors,
  "supervisor-edit": SupervisorEdit,
  "store-managers": StoreManagers,
  "store-manager-edit": StoreManagerEdit,
  "task-copy": TaskDispatch,
  "task-assign": TaskDispatch,
  "task-template-editor": TaskTemplateEditor,
  "task-management": TaskManagement,
  "task-management-detail": TaskManagementDetail,
  "task-archive": TaskArchive,
  "task-archive-detail": TaskArchiveDetail,
  "my-tasks": MyTasks,
  dashboard: Dashboard,
  "task-runner": TaskRunner,
  "inspection-print": InspectionPrint,
  "inspection-settings": InspectionSettings,
  "inspection-setting-edit": InspectionSettingEdit,
  improvements: Improvements,
  "improvement-detail": ImprovementDetail,
  "inspection-compare": InspectionCompare,
  "inspection-editor": InspectionEditor,
  "inspection-detail": InspectionDetail,
  "campaign-schedule": CampaignSchedule,
  inspections: Inspections,
  campaigns: Campaigns,
  "activity-view": ActivityViewList,
  "activity-view-detail": ActivityViewDetail,
  "campaign-edit": CampaignEdit,
  monthly: Monthly,
  "monthly-edit": MonthlyEdit,
  "monthly-export": MonthlyExport,
  "monthly-release": MonthlyRelease,
  performance: Performance,
  "performance-edit": Performance,
  "performance-thresholds": PerformanceThresholds,
  "performance-prescription": PerformancePrescription,
  "performance-bonus": PerformanceBonus,
  inventory: Inventory,
  "employee-purchases": EmployeePurchases,
  pharmacists: Pharmacists,
  relationships: Relationships,
  roles: RoleManagement,
  "ga-center": GaCenter,
  "ga-equipment-categories": AssetCategories,
  "ga-facility-categories": AssetCategories,
  "ga-part-categories": AssetCategories,
  "ga-parts": Parts,
  "ga-part-create": PartCreate,
  "ga-equipment": Equipment,
  "ga-equipment-create": EquipmentCreate,
  "ga-facilities": Facilities,
  "ga-facility-create": FacilityCreate,
  "ga-equipment-warranties": AssetWarranties,
  "ga-facility-warranties": AssetWarranties,
  "ga-equipment-history": AssetMaintenanceHistory,
  "ga-facility-history": AssetMaintenanceHistory,
  "ga-onboarding-tasks": OnboardingTasks,
  "ga-onboarding-review": OnboardingReview,
  "ga-equipment-labels": AssetLabels,
  "ga-facility-labels": AssetLabels,
  "ga-asset-scan": AssetScan,
  "ga-transfers": AssetTransfers,
  "ga-onboarding-progress": OnboardingProgress,
  "ga-asset-import": AssetImport,
  "ga-inventory-locations": InventoryLocations,
  "ga-inventory": GaInventory,
  "ga-part-compat": PartCompatibilities,
  "ga-equipment-templates": AssetTemplates,
  "ga-facility-templates": AssetTemplates,
  users: UserManagement,
};

/** kind -> 元件、標題、所需權限。App.vue 以此渲染與判斷權限，不再使用三元式。 */
export const WORKSPACE_PAGES: Record<WorkTabKind, WorkspacePage> = Object.fromEntries(
  (Object.keys(components) as WorkTabKind[]).map((kind) => [
    kind,
    { ...WORKSPACE_PAGE_META[kind], component: components[kind] },
  ]),
) as Record<WorkTabKind, WorkspacePage>;

// ---- 公開頁（D14）：不需登入、不佔用工作頁籤，以 hash 路由直接顯示 ----
// Next 端保留原路徑並轉址到 /workspace/#/<path>（見 lib/workspace/public-routes.ts）。
// 新增公開頁：1) 在這裡登錄 2) 在 lib/workspace/public-routes.ts 登錄對應的 Next 原路徑。
export type PublicPage = {
  /** vue-router 路徑，例如 /scan/:token */
  path: string;
  /** vue-router 路由名稱（唯一） */
  name: string;
  title: string;
  component: Component;
};

export const WORKSPACE_PUBLIC_PAGES: readonly PublicPage[] = [
  { path: "/public-demo/:token", name: "public-demo", title: "公開頁示範", component: PublicDemo },
  // M5 W22（D14）：登入、註冊、忘記密碼、重設密碼；Next 原路徑見 lib/workspace/public-routes.ts。
  { path: "/login", name: "login", title: "登入", component: Login },
  { path: "/register", name: "register", title: "註冊", component: Register },
  { path: "/forgot-password", name: "forgot-password", title: "忘記密碼", component: ForgotPassword },
  { path: "/reset-password", name: "reset-password", title: "重設密碼", component: ResetPassword },
];
