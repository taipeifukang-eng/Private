// G24 總務首頁與導覽徽章：型別、徽章狀態（單一計時器，各頁外殼共用）、點進去開「待我處理」篩選頁的小工具。
// 數字全部來自伺服端 ga_ws_home_badges／ga_ws_home_summary（只回呼叫者有權看的項目）；這裡不自己算、不快取成事實。
import { defineStore } from "pinia";
import { ref } from "vue";
import { api } from "../api";
import { useWorkspace, type WorkTab } from "../stores";
import { BADGE_MENUS, BADGE_MENU_KIND, MENU_PAYLOAD, capBadge, type BadgeMenu, type HomeItemKey } from "../../../lib/workspace/general-affairs/home-rules";
import { openGaPage } from "./ga";

export { capBadge, HOME_ITEMS } from "../../../lib/workspace/general-affairs/home-rules";
export type { HomeItemKey } from "../../../lib/workspace/general-affairs/home-rules";

export type BadgeData = { items: Partial<Record<HomeItemKey, number>>; menu: Partial<Record<BadgeMenu, number>>; total: number; generated_at?: string };
export type HomeTop = { id: string; title: string; sub: string | null; at: string | null };
export type HomeItem = { key: HomeItemKey; label: string; menu: BadgeMenu; count: number; top: HomeTop[] };
export type HomeKpi = { key: string; label: string; value: number; unit: string; amount?: number };
export type HomeInventory = {
  negative_count: number; negative_allowed_count: number; low_red_count: number; low_yellow_count: number;
  negative_top: Array<{ id: string; part_name: string | null; location_name: string; quantity: number }>;
  low_top: Array<{ id: string; part_name: string | null; location_name: string; quantity: number; level: "red" | "yellow"; safety: number | null; reorder: number | null }>;
};
export type HomeSummary = { today: string; generated_at: string; items: HomeItem[]; total: number; waiting_reply: number | null; kpi: HomeKpi[]; inventory: HomeInventory | null };

const POLL_MS = 5 * 60 * 1000;
const MIN_GAP_MS = 1500;

export const useGaBadges = defineStore("ga-badges", () => {
  const data = ref<BadgeData | null>(null);
  const failed = ref(false);
  let inflight: Promise<void> | null = null;
  let last = 0;
  let users = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let soon: ReturnType<typeof setTimeout> | undefined;

  async function refresh(force = false) {
    if (inflight) return inflight;
    if (!force && Date.now() - last < MIN_GAP_MS) return;
    inflight = (async () => {
      try {
        const res = await api<{ data: BadgeData }>("general-affairs/home/badges");
        data.value = res.data;
        failed.value = false;
      } catch {
        // 數字更新失敗不打擾使用者（可能是權限不足或暫時斷線），保留上一次的數字
        failed.value = true;
      } finally {
        last = Date.now();
        inflight = null;
      }
    })();
    return inflight;
  }
  const onChanged = () => {
    clearTimeout(soon);
    // 寫入成功後稍等一下再抓（資料庫已提交），辦完一項數字即時減少
    soon = setTimeout(() => void refresh(true), 400);
  };
  /** 外殼掛上時呼叫：第一個使用者啟動 5 分鐘輕量更新與「寫入後重抓」，最後一個離開時停止。 */
  function retain() {
    users += 1;
    if (users === 1) {
      timer = setInterval(() => void refresh(true), POLL_MS);
      window.addEventListener("ga-data-changed", onChanged);
    }
    void refresh();
  }
  function release() {
    users = Math.max(0, users - 1);
    if (users === 0) {
      clearInterval(timer);
      clearTimeout(soon);
      window.removeEventListener("ga-data-changed", onChanged);
    }
  }
  const menuCount = (menu: BadgeMenu) => Number(data.value?.menu?.[menu]) || 0;
  /** 某個頁面 kind 的徽章數字（一個 kind 只對應一個選單鍵）。 */
  function byKind(kind: string | undefined): number {
    if (!kind) return 0;
    const m = BADGE_MENUS.find((k) => BADGE_MENU_KIND[k] === kind);
    return m ? menuCount(m) : 0;
  }
  return { data, failed, refresh, retain, release, byKind, menuCount };
});

/** 開啟帶「待我處理」篩選的頁面：同一種頁面已開著就先關掉再開（篩選在頁面載入時讀取，確保套用）。 */
export function openGaAttention(kind: WorkTab["kind"], payload?: Record<string, unknown>) {
  const work = useWorkspace();
  const existing = work.tabs.find((t) => t.kind === kind && !t.recordId);
  if (existing && !existing.dirty && !existing.busy) work.remove([existing.id]);
  return openGaPage(kind, undefined, payload ? { ...payload } : undefined);
}

/** 選單徽章點下去：開該選單的待辦清單。 */
export function openMenuAttention(kind: string | undefined) {
  const menu = BADGE_MENUS.find((k) => BADGE_MENU_KIND[k] === kind);
  if (!menu) return;
  openGaAttention(BADGE_MENU_KIND[menu], MENU_PAYLOAD[menu]);
}
