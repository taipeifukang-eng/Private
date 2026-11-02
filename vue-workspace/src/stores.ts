import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api, taiwanMonth, type Store } from "./api";
export type Session = {
  integrated: boolean;
  navigation: { label: string; items: NavItem[] }[];
  user: { id: string; name: string };
  stores: Store[];
  permissions: string[];
  capabilities: {
    employeePurchases: boolean;
    pharmacists: boolean;
    relationships: boolean;
    roles: boolean;
    users: boolean;
    transfers: boolean;
    movementDraft: boolean;
    movementHistory: boolean;
    employees: boolean;
    employeeCreate: boolean;
    employeeBirthdays: boolean;
    employeeImport: boolean;
    departments: boolean;
    organization: boolean;
    storeMap: boolean;
    storeManagement: boolean;
    storeManagers: boolean;
    supervisors: boolean;
    tasks: boolean;
    taskArchive: boolean;
    taskManagement: boolean;
    monthly: boolean;
    performance: boolean;
    inventory: boolean;
    importInventory: boolean;
    deleteInventory: boolean;
    inspections: boolean;
    inspectionSettings: boolean;
    improvements: boolean;
    compareInspections: boolean;
    createInspections: boolean;
    managerInspections: boolean;
    campaigns: boolean;
    editCampaigns: boolean;
  };
  environment: string;
};
export type NavItem = {
  label: string;
  href: string;
  kind?:
    | "transfers"
    | "movement-management"
    | "movement-draft"
    | "movement-history"
    | "employees"
    | "employee-history"
    | "employee-create"
    | "employee-birthdays"
    | "employee-import"
    | "departments"
    | "organization"
    | "stores"
    | "supervisors"
    | "store-managers"
    | "task-management"
    | "task-archive"
    | "my-tasks"
    | "inspection-settings"
    | "improvements"
    | "inspection-compare"
    | "inspections"
    | "campaigns"
    | "monthly"
    | "performance"
    | "inventory"
    | "employee-purchases"
    | "pharmacists"
    | "relationships"
    | "roles"
    | "users";
};
export const useSession = defineStore("session", () => {
  const data = ref<Session | null>(null);
  const defaultStore = ref("");
  const expired = ref(false);
  async function refresh() {
    const result = await api<Session>("session");
    data.value = result;
    expired.value = false;
    if (
      defaultStore.value &&
      !result.stores.some((s) => s.id === defaultStore.value)
    )
      defaultStore.value = "";
  }
  return { data, defaultStore, expired, refresh };
});
export type WorkTab = {
  id: string;
  kind:
    | "transfers"
    | "movement-management"
    | "movement-draft"
    | "movement-history"
    | "employees"
    | "employee-history"
    | "employee-create"
    | "employee-birthdays"
    | "employee-import"
    | "departments"
    | "department-detail"
    | "department-work-editor"
    | "organization"
    | "organization-editor"
    | "store-map"
    | "store-promotions"
    | "store-personnel"
    | "store-personnel-history"
    | "store-employees"
    | "stores"
    | "store-editor"
    | "store-relocation"
    | "store-history-editor"
    | "supervisors"
    | "supervisor-edit"
    | "store-managers"
    | "store-manager-edit"
    | "task-copy"
    | "task-assign"
    | "task-template-editor"
    | "task-management"
    | "task-management-detail"
    | "task-archive"
    | "task-archive-detail"
    | "my-tasks"
    | "task-runner"
    | "inspection-print"
    | "inspection-settings"
    | "inspection-setting-edit"
    | "improvements"
    | "improvement-detail"
    | "inspection-compare"
    | "inspection-editor"
    | "inspection-detail"
    | "campaign-schedule"
    | "inspections"
    | "campaigns"
    | "campaign-edit"
    | "monthly"
    | "monthly-edit"
    | "performance"
    | "performance-edit"
    | "performance-thresholds"
    | "performance-prescription"
    | "performance-bonus"
    | "inventory"
    | "employee-purchases"
    | "pharmacists"
    | "relationships"
    | "roles"
    | "users";
  payload?: any;
  title: string;
  store: string;
  month: string;
  recordId?: string;
  submitOnly?: boolean;
  dirty: boolean;
  busy: boolean;
  save?: () => Promise<boolean>;
  discard?: () => Promise<void>;
};
export const useWorkspace = defineStore("workspace", () => {
  const tabs = ref<WorkTab[]>([]);
  const active = ref("");
  const deletedInspectionIds = ref<string[]>([]);
  const campaignRevision = ref(0);
  const organizationRevision = ref(0);
  const departmentRevision = ref(0);
  const lastSavedTab = ref("");
  const dirty = computed(() => tabs.value.filter((t) => t.dirty));
  function open(kind: WorkTab["kind"], store = "", recordId?: string) {
    const tab: WorkTab = {
      id: crypto.randomUUID(),
      kind,
      title:
        (
          {
            "transfers": "調店申請",
            "movement-management": "人員異動管理",
            "movement-draft": "批次異動驗證",
            "movement-history": "人員異動紀錄",
            "employees": "員工管理",
            "employee-history": "員工異動歷程",
            "employee-create": "新增員工",
            "employee-birthdays": "員工生日匯入",
            "employee-import": "批次匯入員工",
            "departments": "部門管理",
            "department-detail": "部門工作頁",
            "department-work-editor": "工作職掌",
            "organization": "公司組織",
            "organization-editor": "組織單位",
            "stores": "門市管理",
            "store-map": "門市整合地圖",
            "store-promotions": "批次升遷",
            "store-personnel": "門市員工主檔",
            "store-personnel-history": "員工歷程",
            "store-employees": "門市員工",
            "store-editor": "門市資料",
            "store-relocation": "門市搬遷沿革",
            "store-history-editor": "補建歷史沿革",
            "supervisors": "經理／督導管理",
            "supervisor-edit": "管理門市指派",
            "store-managers": "店長指派",
            "store-manager-edit": "編輯店長指派",
            "task-copy": "複製範本",
            "task-assign": "派發任務",
            "task-template-editor": "任務範本",
            "task-management": "任務管理",
            "task-management-detail": "任務管理明細",
            "task-archive": "已封存任務",
            "task-archive-detail": "封存任務紀錄",
            "my-tasks": "我的任務",
            "task-runner": "任務內容",
            "inspection-print": "巡店列印預覽",
            "inspection-settings": "巡店範本設定",
            "inspection-setting-edit": "編輯巡店設定",
            improvements: "待改善追蹤",
            "improvement-detail": "改善回報",
            "inspection-compare": "巡店比較",
            "inspection-editor": "新增巡店",
            "inspection-detail": "巡店紀錄明細",
            "campaign-schedule": "活動門市排程",
            monthly: "每月人員狀態",
            "monthly-edit": "人員明細",
            "employee-purchases": "員工購物管理",
            pharmacists: "藥師管理",
            relationships: "關係會員",
            roles: "角色權限管理",
            users: "使用者管理",
            performance: "業績管理",
            "performance-thresholds": "獎金閾值",
            "performance-prescription": "處方箋報表",
            "performance-bonus": "每月獎金",
            "performance-edit": "編輯業績",
            inventory: "盤點管理",
          } as Record<string, string>
        )[kind] ||
        (kind === "inspections"
          ? "巡店列表"
          : kind === "campaigns"
            ? "活動管理"
            : recordId
              ? "編輯活動"
              : "新增活動"),
      store,
      month: taiwanMonth(),
      recordId,
      dirty: false,
      busy: false,
    };
    tabs.value.push(tab);
    active.value = tab.id;
    return tab;
  }
  function remove(ids: string[]) {
    const oldIndex = tabs.value.findIndex((t) => t.id === active.value);
    tabs.value = tabs.value.filter((t) => !ids.includes(t.id));
    if (ids.includes(active.value))
      active.value =
        tabs.value[Math.max(0, Math.min(oldIndex, tabs.value.length - 1))]
          ?.id || "";
  }
  function clear() {
    tabs.value = [];
    deletedInspectionIds.value = [];
    active.value = "";
  }
  return {
    tabs,
    active,
    dirty,
    deletedInspectionIds,
    campaignRevision,
    organizationRevision,
    departmentRevision,
    lastSavedTab,
    open,
    remove,
    clear,
  };
});
