import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api, taiwanMonth, type Store } from "./api";
import type { WorkTabKind, WorkspaceNavKind } from "../../lib/workspace/page-kinds";
import { pageTitle } from "./workspace-page-meta";
import type { GaNavGroup } from "../../lib/workspace/general-affairs/nav-types";
export type Session = {
  integrated: boolean;
  navigation: { label: string; items: NavItem[] }[];
  user: { id: string; name: string };
  stores: Store[];
  permissions: string[];
  /** M5 Q15：沒有任何生效角色（且不是管理員）時為 true，畫面改顯示「帳號待管理員開通」。 */
  pendingActivation?: boolean;
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
    /** 年度行事曆：所有登入者（Q17）。 */
    calendar: boolean;
    storeMap: boolean;
    storeManagement: boolean;
    storeManagers: boolean;
    supervisors: boolean;
    tasks: boolean;
    dashboard: boolean;
    taskArchive: boolean;
    taskManagement: boolean;
    monthly: boolean;
    monthlyExport: boolean;
    monthlyRelease: boolean;
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
    /** 活動檢視入口（canEnterCampaignView）。 */
    campaignView: boolean;
    editCampaigns: boolean;
    /** M7/M8 總務：服務中心入口、三種分類、料件、型號與架型、適用料件設定（規則見 lib/workspace/general-affairs/access.ts）。 */
    gaCenter: boolean;
    gaEquipmentCategories: boolean;
    gaFacilityCategories: boolean;
    gaPartCategories: boolean;
    gaParts: boolean;
    gaPartCreate: boolean;
    gaPartCompat: boolean;
    gaEquipmentTemplates: boolean;
    gaFacilityTemplates: boolean;
    /** 第 2 批：設備清冊、新增設備、貼標待辦、貼標複核。 */
    gaEquipment: boolean;
    gaEquipmentCreate: boolean;
    /** G08／G09：設施清冊、新增設施、保固頁、維修紀錄。 */
    gaFacilities: boolean;
    gaFacilityCreate: boolean;
    gaEquipmentWarranties: boolean;
    gaFacilityWarranties: boolean;
    gaEquipmentHistory: boolean;
    gaFacilityHistory: boolean;
    gaOnboardingTasks: boolean;
    gaOnboardingReview: boolean;
    /** G10：QR 標籤列印。 */
    gaEquipmentLabels: boolean;
    gaFacilityLabels: boolean;
    gaTransfers: boolean;
    gaOnboardingProgress: boolean;
    gaAssetImport: boolean;
    /** 第 3 批 G11：庫存位置與料件設定（含門市名單身分的唯讀入口）。 */
    gaInventoryLocations: boolean;
    /** 第 3 批 G12：庫存餘額、流水、過帳、持有狀態（含門市名單身分的唯讀入口）。 */
    gaInventory: boolean;
    /** 第 3 批 G13：庫存調撥單（調撥與收貨，含門市名單身分的唯讀入口）。 */
    gaInventoryTransfers: boolean;
  };
  /** 總務服務中心側欄（照舊版分組與權限顯示）；沒有任何可見項目時為空陣列。 */
  gaNavigation?: GaNavGroup[];
  environment: string;
};
export type NavItem = {
  label: string;
  href: string;
  kind?: WorkspaceNavKind;
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
  kind: WorkTabKind;
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
  const monthlyRevision = ref(0);
  const dirty = computed(() => tabs.value.filter((t) => t.dirty));
  function open(kind: WorkTab["kind"], store = "", recordId?: string) {
    const tab: WorkTab = {
      id: crypto.randomUUID(),
      kind,
      title: pageTitle(kind, recordId),
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
  // 單人編輯儲存成功後：關閉編輯分頁，回到月結總覽該門市分頁並請它重新讀取。
  function returnToMonthly(editTabId: string, store: string, month: string) {
    const target =
      tabs.value.find((t) => t.kind === "monthly" && t.store === store && t.month === month) ||
      tabs.value.find((t) => t.kind === "monthly" && t.store === store) ||
      tabs.value.find((t) => t.kind === "monthly");
    remove([editTabId]);
    const monthly = target || open("monthly", store);
    monthly.store = store;
    monthly.month = month;
    active.value = monthly.id;
    monthlyRevision.value++;
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
    monthlyRevision,
    returnToMonthly,
    open,
    remove,
    clear,
  };
});
