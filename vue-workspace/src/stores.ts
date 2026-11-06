import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api, taiwanMonth, type Store } from "./api";
import type { WorkTabKind, WorkspaceNavKind } from "../../lib/workspace/page-kinds";
import { pageTitle } from "./workspace-page-meta";
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
  };
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
