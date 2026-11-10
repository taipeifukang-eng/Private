// 總務頁面共用小工具：進頁權限檢查、開啟頁籤、搜尋防抖。
import { computed, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { useSession, useWorkspace, type WorkTab } from "../stores";
import { isPageAllowed } from "../workspace-page-meta";

/** 進頁前先擋：沒有權限時頁面不載入任何資料（App.vue 會顯示無權限說明）。 */
export function useGaGuard(tab: WorkTab) {
  const session = useSession();
  return computed(() => isPageAllowed(tab.kind, session.data?.capabilities, session.expired));
}

/** 開啟或切換到總務頁籤：同一種頁面已開著就切過去，不重複開。 */
export function openGaPage(kind: WorkTab["kind"], recordId?: string, payload?: unknown) {
  const work = useWorkspace();
  const existing = work.tabs.find((t) => t.kind === kind && (t.recordId || "") === (recordId || ""));
  if (existing) {
    if (payload !== undefined) existing.payload = payload;
    work.active = existing.id;
    return existing;
  }
  const tab = work.open(kind, "", recordId);
  if (payload !== undefined) tab.payload = payload;
  return tab;
}

export function legacyUrl(href: string, integrated: boolean | undefined) {
  return integrated ? href : "http://localhost:3002" + href;
}

/** 頁籤從背景切回前景時重新載入（頁籤用 v-show 保留，資料會過時；貼標待辦、複核、進度這類多人接力的頁面需要）。 */
export function useRefreshOnActivate(tab: WorkTab, load: () => unknown) {
  const work = useWorkspace();
  watch(() => work.active, (id, old) => {
    if (id === tab.id && old !== tab.id) void load();
  });
}

/** 搜尋輸入防抖：回傳實際用來查詢的值。 */
export function useDebounced<T>(source: Ref<T>, ms = 300) {
  const out = ref(source.value) as Ref<T>;
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(source, (v) => {
    clearTimeout(timer);
    timer = setTimeout(() => (out.value = v), ms);
  });
  onBeforeUnmount(() => clearTimeout(timer));
  return out;
}

/** 防止舊回應蓋掉新回應：每次查詢取一個序號，回來時序號不是最新就丟掉。 */
export function useLatest() {
  let seq = 0;
  return {
    next: () => ++seq,
    isLatest: (n: number) => n === seq,
  };
}

export const GA_TYPE_LABEL = { equipment: "設備", facility: "設施", part: "料件" } as const;
