/**
 * M5（W19 活動排程、P05 活動列表／特殊日期／活動設定）的純規則。
 * 伺服器（app/api/workspace/campaigns、monthly/tools）與 Vue 畫面共用，不碰資料庫與網路，可直接單元測試。
 * 規格：docs/vue-workspace/parity-plan/m5-spec.md（Q1-Q5、不需決策項目）。
 */

export type CampaignType = "promotion" | "inventory";
export type CampaignPhase = "upcoming" | "ongoing" | "ended";

export type CampaignLike = {
  start_date: string;
  end_date: string;
  is_active?: boolean | null;
  campaign_type?: string | null;
};

/** 台灣日期 yyyy-mm-dd（活動日期都是台灣日曆日）。 */
export function taipeiToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Q2：列表狀態依日期顯示（含開始日、結束日當天都算進行中）。 */
export function campaignPhase(c: Pick<CampaignLike, "start_date" | "end_date">, today: string): CampaignPhase {
  if (today < c.start_date) return "upcoming";
  if (today > c.end_date) return "ended";
  return "ongoing";
}
export const CAMPAIGN_PHASE_LABEL: Record<CampaignPhase, string> = {
  upcoming: "未開始",
  ongoing: "進行中",
  ended: "已結束",
};

/** 促銷類統一顯示「促銷（母親節／周年慶等）」，純文字。 */
export function campaignTypeLabel(type: string | null | undefined): string {
  return type === "inventory" ? "盤點活動" : "促銷（母親節／周年慶等）";
}

/** 停用旗標：null 視為啟用（舊版建立的活動一律 is_active=true）。 */
export const campaignIsActive = (c: Pick<CampaignLike, "is_active">) => c.is_active !== false;

/**
 * Q2：停用的活動對督導／店長／活動檢視／門市端一律隱藏；
 * 活動列表（管理頁）只對有「活動編輯或發布」權限者仍顯示並標「停用」。
 */
export const CAMPAIGN_INACTIVE_VISIBLE_CODES = [
  "activity.campaign.edit",
  "activity.manage",
  "activity.store_detail.edit",
  "activity.equipment_trip.edit",
  "activity.checklist.edit",
  "activity.marketing.publish",
  "activity.merchandise.publish",
] as const;
export const campaignVisibleInList = (c: Pick<CampaignLike, "is_active">, canSeeInactive: boolean) =>
  campaignIsActive(c) || canSeeInactive;
export const campaignVisibleInView = (c: Pick<CampaignLike, "is_active">) => campaignIsActive(c);

/** 「活動規劃／排程」入口：持有活動編輯或發布權限者（含車次、Check List、行銷、商品）；純檢視者改走活動檢視。 */
export function canEnterSchedule(p: {
  permissions?: Record<string, boolean> | null;
  marketing?: boolean;
  merchandise?: boolean;
}): boolean {
  const x = p.permissions || {};
  return !!(x.schedules || x.details || x.trips || x.checklist || p.marketing || p.merchandise);
}

/** 盤點類活動只有排程、門市細節、預覽表三個分頁；促銷類七個分頁。 */
export const CAMPAIGN_SECTIONS: [string, string][] = [
  ["schedule", "活動排程"],
  ["stores", "門市細節／人力"],
  ["preview", "規劃預覽"],
  ["trips", "設備車次"],
  ["checklist", "工作清單"],
  ["marketing", "行銷部"],
  ["merchandise", "商品部"],
];
export const INVENTORY_SECTION_KEYS = ["schedule", "stores", "preview"];
export function campaignSections(type: string | null | undefined): [string, string][] {
  return type === "inventory" ? CAMPAIGN_SECTIONS.filter(([k]) => INVENTORY_SECTION_KEYS.includes(k)) : CAMPAIGN_SECTIONS;
}

// ---------------------------------------------------------------------------
// Q3 刪除確認
// ---------------------------------------------------------------------------
export const CAMPAIGN_DELETE_TABLES: { key: string; label: string; table: string }[] = [
  { key: "schedules", label: "門市排程", table: "campaign_schedules" },
  { key: "details", label: "門市細節", table: "campaign_store_details" },
  { key: "ownStaff", label: "本店活動人員", table: "campaign_store_own_staff" },
  { key: "requests", label: "支援需求", table: "campaign_support_requests" },
  { key: "supportStaff", label: "支援人員指派", table: "campaign_support_staff" },
  { key: "headcount", label: "人力預估", table: "campaign_store_headcount" },
  { key: "trips", label: "設備車次", table: "campaign_equipment_trips" },
  { key: "checklist", label: "Check List 項目", table: "campaign_checklist_items" },
  { key: "completions", label: "Check List 店長勾選紀錄", table: "campaign_checklist_completions" },
  { key: "departments", label: "行銷與商品內容", table: "campaign_department_publish" },
];
/** 輸入的名稱必須與活動名稱完全相同（只忽略前後空白）。 */
export const deleteNameMatches = (input: string, name: string) => !!name && input.trim() === name.trim();
export const deleteTotal = (counts: { count: number }[]) => counts.reduce((sum, c) => sum + (c.count || 0), 0);

// ---------------------------------------------------------------------------
// Q4 改期：期間外的排程
// ---------------------------------------------------------------------------
export function schedulesOutsideRange<T extends { activity_date: string }>(rows: T[], start: string, end: string): T[] {
  return rows.filter((r) => r.activity_date.slice(0, 10) < start || r.activity_date.slice(0, 10) > end);
}

// ---------------------------------------------------------------------------
// Q5 誤操作提醒
// ---------------------------------------------------------------------------
export const WEEKDAY_NAMES = ["", "一", "二", "三", "四", "五", "六", "日"];
/** 1=週一 … 7=週日。 */
export function isoWeekday(date: string): number {
  return new Date(date.slice(0, 10) + "T00:00:00Z").getUTCDay() || 7;
}
export const weekdayLabel = (date: string) => "週" + WEEKDAY_NAMES[isoWeekday(date)];

export type EventLike = { event_date: string; description?: string | null; event_type?: string | null; is_blocked?: boolean | null };
export type SettingLike = { store_id: string; allowed_days?: number[] | null; forbidden_days?: number[] | null };

/** Q5b：手動把門市排到禁止日或門市限制的星期時的警告（仍允許）。 */
export function manualScheduleWarnings(input: { date: string; storeId: string; events: EventLike[]; settings: SettingLike[] }): string[] {
  const out: string[] = [];
  const date = input.date.slice(0, 10);
  const blocked = input.events.find((e) => e.event_date.slice(0, 10) === date && e.is_blocked);
  if (blocked) out.push(`${date} 是禁止排程日（${blocked.description || "特殊日期"}）`);
  const rule = input.settings.find((s) => s.store_id === input.storeId);
  const day = isoWeekday(date);
  if (rule?.forbidden_days?.includes(day)) out.push(`此門市設定不排在週${WEEKDAY_NAMES[day]}`);
  else if (rule?.allowed_days?.length && !rule.allowed_days.includes(day))
    out.push(`此門市只能排在週${rule.allowed_days.slice().sort().map((d) => WEEKDAY_NAMES[d]).join("、")}，${date} 是週${WEEKDAY_NAMES[day]}`);
  return out;
}

export const EVENT_TYPE_LABEL: Record<string, string> = { holiday: "國定假日", company_event: "公司活動", other: "其他" };
export const describeEvent = (e: EventLike) =>
  `${e.event_date.slice(0, 10)}（${weekdayLabel(e.event_date)}）${EVENT_TYPE_LABEL[e.event_type || ""] || "其他"}・${e.description || "無說明"}・${e.is_blocked ? "禁止自動排程" : "允許排程"}`;

/** Q5a：同一天已有特殊日期時，回傳會被覆蓋的原內容（內容完全相同則不需提醒）。 */
export function eventOverwrite(existing: EventLike[], draft: EventLike): EventLike | null {
  const old = existing.find((e) => e.event_date.slice(0, 10) === draft.event_date.slice(0, 10));
  if (!old) return null;
  const same =
    (old.description || "") === (draft.description || "") &&
    (old.event_type || "") === (draft.event_type || "") &&
    !!old.is_blocked === !!draft.is_blocked;
  return same ? null : old;
}

/** Q5c：已發布給哪些對象（有任何一個就要提示「儲存後立即生效」）。 */
export function publishedAudiences(c: {
  published_to_supervisors?: boolean | null;
  published_to_store_managers?: boolean | null;
  published_to_inventory_team?: boolean | null;
}): string[] {
  const out: string[] = [];
  if (c.published_to_supervisors) out.push("督導");
  if (c.published_to_store_managers) out.push("店長");
  if (c.published_to_inventory_team) out.push("盤點組人員");
  return out;
}

// ---------------------------------------------------------------------------
// 月曆、督導區顏色、特殊日期分組（舊版 schedule/[id]/page.tsx 補回）
// ---------------------------------------------------------------------------
/** 月曆週一為首：該月第一天前面要補幾個空格。 */
export const mondayFirstBlanks = (firstDate: string) => ((new Date(firstDate.slice(0, 10) + "T00:00:00Z").getUTCDay() + 6) % 7);
export const MONDAY_FIRST_HEADERS = ["一", "二", "三", "四", "五", "六", "日"];

export type SupervisorColor = { bg: string; border: string; text: string; name: string };
// 與舊版 AVAILABLE_COLORS 相同的 12 色（舊版用 Tailwind 色名，這裡換成對應色碼）。
export const SUPERVISOR_COLORS: SupervisorColor[] = [
  { bg: "#bfdbfe", border: "#60a5fa", text: "#1e3a8a", name: "藍色" },
  { bg: "#a7f3d0", border: "#34d399", text: "#064e3b", name: "翠綠" },
  { bg: "#e9d5ff", border: "#c084fc", text: "#581c87", name: "紫色" },
  { bg: "#fde68a", border: "#fbbf24", text: "#78350f", name: "琥珀" },
  { bg: "#fbcfe8", border: "#f472b6", text: "#831843", name: "粉紅" },
  { bg: "#a5f3fc", border: "#22d3ee", text: "#164e63", name: "青色" },
  { bg: "#fecdd3", border: "#fb7185", text: "#881337", name: "玫瑰" },
  { bg: "#d9f99d", border: "#a3e635", text: "#365314", name: "萊姆" },
  { bg: "#c7d2fe", border: "#818cf8", text: "#312e81", name: "靛藍" },
  { bg: "#fed7aa", border: "#fb923c", text: "#7c2d12", name: "橙色" },
  { bg: "#99f6e4", border: "#2dd4bf", text: "#134e4a", name: "藍綠" },
  { bg: "#f5d0fe", border: "#e879f9", text: "#701a75", name: "紫紅" },
];
export const DEFAULT_SUPERVISOR_COLOR: SupervisorColor = { bg: "#f3f4f6", border: "#d1d5db", text: "#111827", name: "灰色" };
/** 與舊版相同：督導 ID 排序後依序固定分配顏色（循環使用）。 */
export function buildSupervisorColorMap(stores: { supervisor_id?: string | null }[]): Record<string, SupervisorColor> {
  const ids = Array.from(new Set(stores.map((s) => s.supervisor_id).filter(Boolean) as string[])).sort();
  const map: Record<string, SupervisorColor> = {};
  ids.forEach((id, i) => (map[id] = SUPERVISOR_COLORS[i % SUPERVISOR_COLORS.length]));
  return map;
}
export const supervisorColor = (map: Record<string, SupervisorColor>, id?: string | null) =>
  (id && map[id]) || DEFAULT_SUPERVISOR_COLOR;

/** 特殊日期依月份分組（月份新到舊或舊到新由 asc 決定，預設由舊到新）。 */
export function groupEventsByMonth<T extends { event_date: string }>(events: T[], asc = true): { month: string; rows: T[] }[] {
  const sorted = events.slice().sort((a, b) => (a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : 0));
  if (!asc) sorted.reverse();
  const groups: { month: string; rows: T[] }[] = [];
  for (const e of sorted) {
    const month = e.event_date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.rows.push(e);
    else groups.push({ month, rows: [e] });
  }
  return groups;
}

/** 允許與禁止星期重疊：永遠排不進去，不給存。回傳重疊的星期（1-7）。 */
export const overlappingDays = (allowed: number[], forbidden: number[]) => allowed.filter((d) => forbidden.includes(d));

// ---------------------------------------------------------------------------
// 行銷部圖片：最多 8 張、單張 5MB、拖曳排序
// ---------------------------------------------------------------------------
export const MAX_MARKETING_IMAGES = 8;
export const MAX_MARKETING_IMAGE_BYTES = 5 * 1024 * 1024;
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list.slice();
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
/** 圖片的名稱、路徑、網址是三個對齊的陣列，排序時一起移動。 */
export function reorderMarketingImages<T extends { marketing_image_names: string[]; marketing_image_paths: string[]; marketing_image_urls: string[] }>(
  form: T,
  from: number,
  to: number,
): T {
  return {
    ...form,
    marketing_image_names: moveItem(form.marketing_image_names, from, to),
    marketing_image_paths: moveItem(form.marketing_image_paths, from, to),
    marketing_image_urls: moveItem(form.marketing_image_urls, from, to),
  };
}
export function marketingUploadError(currentCount: number, files: { size: number; type: string }[]): string | null {
  if (!files.length) return null;
  if (files.some((f) => !["image/png", "image/jpeg", "image/webp"].includes(f.type))) return "請選擇 PNG、JPEG 或 WebP 圖片";
  if (files.some((f) => f.size > MAX_MARKETING_IMAGE_BYTES)) return "每張圖片須小於 5MB";
  if (currentCount + files.length > MAX_MARKETING_IMAGES) return `行銷圖片最多 ${MAX_MARKETING_IMAGES} 張，目前已有 ${currentCount} 張`;
  return null;
}

// ---------------------------------------------------------------------------
// Q1：新舊寫入權限（預覽 SQL 與測試用）
// ---------------------------------------------------------------------------
/** 舊版 POST/PUT/DELETE 的第一關：profiles.role 必須是 admin 或 manager（否則回 403 權限不足）。 */
export const legacyCampaignWriteAllowed = (profileRole: string | null | undefined) => profileRole === "admin" || profileRole === "manager";
/**
 * 舊版實際能不能寫：除了上面的 profiles.role，資料庫 RLS（p1h_campaigns_write）還要求 has_permission
 * 'activity.manage' 或 'activity.campaign.edit'，沒有就是 500。兩關都過才寫得進去。
 */
export const legacyCampaignEffectiveWrite = (profileRole: string | null | undefined, hasWritePermission: boolean) =>
  legacyCampaignWriteAllowed(profileRole) && hasWritePermission;
/** 新版：只看角色權限（管理員後備由 server 的 has 處理）。 */
export const nativeCampaignWriteAllowed = (has: (...codes: string[]) => boolean) => has("activity.campaign.edit", "activity.manage");
