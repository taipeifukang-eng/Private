/**
 * M5 W20（活動檢視獨立入口與活動計畫頁）的純規則。
 * 伺服器（app/api/workspace/activity-view、monthly/tools）與 Vue 畫面共用，不碰資料庫與網路，可直接單元測試。
 * 規格：docs/vue-workspace/parity-plan/m5-spec.md（Q2、Q6、Q7、Q8、不需決策項目）。
 * 舊版對照：app/activity-management/page.tsx、app/activity-view/[id]/page.tsx。
 */
import { campaignPhase, taipeiToday, type CampaignPhase } from "./campaign-rules";

type DateRange = { start_date: string; end_date: string };

/** 舊版狀態標籤用字（活動檢視頁）：即將開始／進行中／已結束。判斷改依台灣日期（含開始日、結束日當天都算進行中）。 */
export const VIEW_PHASE_LABEL: Record<CampaignPhase, string> = {
  upcoming: "即將開始",
  ongoing: "進行中",
  ended: "已結束",
};
export function viewStatusLabel(c: DateRange, today: string = taipeiToday()): string {
  return VIEW_PHASE_LABEL[campaignPhase(c, today)];
}

/** 舊版年度按鈕：從所有活動的開始與結束年份擷取，由小到大。 */
export function availableYears(campaigns: DateRange[]): string[] {
  const years = new Set<string>();
  for (const c of campaigns) {
    if (c.start_date) years.add(c.start_date.substring(0, 4));
    if (c.end_date) years.add(c.end_date.substring(0, 4));
  }
  return Array.from(years).sort();
}

/** 舊版年度篩選：活動期間涵蓋到該年度的都算；'all' 表示全部。 */
export function campaignInYear(c: DateRange, year: string): boolean {
  if (year === "all") return true;
  const s = c.start_date?.substring(0, 4);
  const e = c.end_date?.substring(0, 4);
  return s === year || e === year || !!(s && e && s <= year && e >= year);
}

/** 預設年度：今年（台灣日曆）。 */
export const defaultViewYear = (today: string = taipeiToday()) => today.substring(0, 4);

export type PublishState = {
  published_to_supervisors?: boolean | null;
  published_to_store_managers?: boolean | null;
  published_to_inventory_team?: boolean | null;
};

/** 發布對象標籤文字（與舊版一致；盤點組標籤含行銷部與營業部助理）。 */
export const PUBLISH_TAG_LABEL = {
  supervisors: "督導",
  storeManagers: "店長",
  inventoryTeam: "盤點組/行銷部/營業部助理",
} as const;
export function publishTags(c: PublishState): string[] {
  const tags: string[] = [];
  if (c.published_to_supervisors) tags.push(PUBLISH_TAG_LABEL.supervisors);
  if (c.published_to_store_managers) tags.push(PUBLISH_TAG_LABEL.storeManagers);
  if (c.published_to_inventory_team) tags.push(PUBLISH_TAG_LABEL.inventoryTeam);
  return tags;
}
/** 有「查看全部」權限者會看到未發布草稿，列表加「未發布」標籤避免誤以為已發給門市。 */
export const isUnpublished = (c: PublishState) => publishTags(c).length === 0;

/** 舊版標題後綴：督導／店長／督導與店長。 */
export function viewerTitle(isSupervisor: boolean, isStoreManager: boolean): string {
  if (isSupervisor && isStoreManager) return "督導與店長";
  if (isSupervisor) return "督導";
  if (isStoreManager) return "店長";
  return "";
}

export function emptyYearText(year: string): string {
  return year === "all" ? "目前沒有已發布的活動" : `${year} 年沒有已發布的活動`;
}

// ---- Q7：「活動人力查看」「前置 Check List」「支援請求」按鈕照舊版 ----

export type ManagedStore = { id: string; store_code: string; store_name: string };

export type ActivityViewer = {
  /** 管理的門市：管理員（角色代碼 admin）為全部啟用門市，其他人為 store_managers 任命的門市（任何任命類型）。 */
  managedStores: ManagedStore[];
  canAssignSupport: boolean;
  canViewStaffOverview: boolean;
  /** 三個按鈕是否顯示（舊版條件原樣：需有管轄門市；Check List 只要有管轄門市，其他兩顆另需專屬權限）。 */
  showSupport: boolean;
  showStaffOverview: boolean;
  showChecklist: boolean;
};

/**
 * 舊版 app/activity-view/[id]/page.tsx loadData 的規則：
 *  - hasAssign = 角色代碼 admin 或持有 activity.support_assign.edit
 *  - hasOverview = 角色代碼 admin 或持有 activity.staff_overview.view
 *  - 只有 hasAssign 或 hasOverview 才會載入管轄門市（否則管轄門市為空，Check List 按鈕也跟著不出現）
 *  - 支援請求按鈕：hasAssign 且有管轄門市；Check List：有管轄門市；人力查看：hasOverview 且有管轄門市
 */
export function computeActivityViewer(input: {
  isAdminRole: boolean;
  permissions: ReadonlySet<string>;
  appointedStores: ManagedStore[];
  allActiveStores: ManagedStore[];
}): ActivityViewer {
  const canAssignSupport = input.isAdminRole || input.permissions.has("activity.support_assign.edit");
  const canViewStaffOverview = input.isAdminRole || input.permissions.has("activity.staff_overview.view");
  let managedStores: ManagedStore[] = [];
  if (canAssignSupport || canViewStaffOverview) {
    managedStores = dedupeStores(input.isAdminRole ? input.allActiveStores : input.appointedStores);
  }
  const has = managedStores.length > 0;
  return {
    managedStores,
    canAssignSupport,
    canViewStaffOverview,
    showSupport: canAssignSupport && has,
    showStaffOverview: canViewStaffOverview && has,
    showChecklist: has,
  };
}

export function dedupeStores(stores: ManagedStore[]): ManagedStore[] {
  const seen = new Set<string>();
  const out: ManagedStore[] = [];
  for (const s of stores) {
    if (!s?.id || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({ id: s.id, store_code: s.store_code, store_name: s.store_name });
  }
  return out.sort((a, b) => (a.store_code || "").localeCompare(b.store_code || ""));
}

/** 人力查看與 Check List 只列自己管轄、且該活動有排程的門市（舊版 ChecklistOverviewModal 以排程門市過濾；人力查看以管轄門市為準）。 */
export function scheduledManaged(managed: ManagedStore[], scheduledStoreIds: Iterable<string>): ManagedStore[] {
  const set = new Set(scheduledStoreIds);
  return managed.filter((s) => set.has(s.id));
}

// ---- 舊版 PDF：A4 橫式、每月一頁、檔名「活動名稱_活動排程.pdf」 ----
export const ACTIVITY_PDF_FORMAT = "a4" as const;
export const ACTIVITY_PDF_ORIENTATION = "landscape" as const;
export const ACTIVITY_PDF_PAGE = { width: 297, height: 210, margin: 5 } as const;
export function activityPdfFilename(name: string): string {
  return `${String(name).replace(/[\\/:*?"<>|]/g, "_")}_活動排程.pdf`;
}
/** 舊版版面：寬度填滿（扣邊界），內容太高時等比縮小並置中。 */
export function activityPdfPlacement(canvasW: number, canvasH: number) {
  const { width, height, margin } = ACTIVITY_PDF_PAGE;
  const contentWidth = width - margin * 2;
  const contentHeight = (canvasH / canvasW) * contentWidth;
  if (contentHeight > height - margin * 2) {
    const w = ((height - margin * 2) / contentHeight) * contentWidth;
    return { x: margin + (contentWidth - w) / 2, y: margin, w, h: height - margin * 2 };
  }
  return { x: margin, y: margin, w: contentWidth, h: contentHeight };
}
/** 讀取失敗保護：任何一項會影響月曆的資料讀取失敗時停用匯出（避免匯出不完整的 PDF）。 */
export function pdfExportBlocked(errors: Record<string, string> | null | undefined): boolean {
  const e = errors || {};
  return !!(e.events || e.trips || e.stores);
}

// ---- Q8：舊網址轉新版 ----
export const ACTIVITY_VIEW_LEGACY_REDIRECTS = [
  { legacy: "/activity-management", kind: "activity-view" },
  { legacy: "/activity-view/:id", kind: "activity-view-detail" },
] as const;

/**
 * Next 舊路徑轉到 Vue 工作台的「開啟頁面」hash 路由：/workspace/index.html#/open/<kind>[/<id>]。
 * 舊版活動檢視頁的 ?focus=marketing|merchandise（直接開行銷部／商品部視窗）原樣帶過去；其他查詢字串一律丟棄。
 */
export function activityLegacyTarget(pathname: string, search = ""): string | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (clean === "/activity-management") return "/workspace/index.html#/open/activity-view";
  const m = /^\/activity-view\/([A-Za-z0-9_-]{1,128})$/.exec(clean);
  if (!m) return null;
  const focus = new URLSearchParams(search).get("focus");
  const q = focus === "marketing" || focus === "merchandise" ? `?focus=${focus}` : "";
  return `/workspace/index.html#/open/activity-view-detail/${encodeURIComponent(m[1])}${q}`;
}
