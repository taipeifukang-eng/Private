/**
 * W02：每月資料匯出（舊 /admin/export-monthly-status）的共用規則（純函式，無伺服器相依）。
 *
 * API 包裝層（app/api/workspace/monthly-export/[resource]）、Vue 頁面（MonthlyExport.vue）、測試都引用這一份。
 *
 * 權限（M1 W02-q1 / q2）：
 * - 入口與 8 支一般匯出：monthly.export.download（舊版 API 本來就檢查這個碼；舊版導覽誤用 monthly.status.export）。
 * - 單品獎金：完全照舊版，只檢查登入（使用者說明：刻意讓店長、督導、經理能看到本店人員去別店支援的獎金）。
 * - 支援時數：完全照舊版的角色／職稱判斷（canExportSupportHours）。
 * - 育才獎金：舊版 API 沒有任何權限檢查（只登入）。新版依 W02-q1 歸入「8 支一般匯出」，一律要 monthly.export.download（與舊版不同，已列白名單）。
 *
 * 狀態（W02-q3）：含「尚未提交」門市的匯出請求，新版 API 直接回 400 並列出門市；舊版只靠前端擋，全選時仍可送出。支援時數一律全部門市，不受影響。
 */

export type ExportStoreStatus = 'pending' | 'submitted' | 'confirmed';
export type ExportPermission = 'general' | 'login' | 'support-hours';
export type ExportKey =
  | 'download'
  | 'actual-staff-points'
  | 'roster'
  | 'transport'
  | 'single-item-bonus'
  | 'talent-cultivation-bonus'
  | 'meal-allowance'
  | 'spring-festival-bonus'
  | 'support-hours';

export type ExportDefinition = {
  key: ExportKey;
  label: string;
  /** 舊版 /api/export-monthly-status/<path> */
  path: string;
  method: 'GET' | 'POST';
  permission: ExportPermission;
  /** 是否依所選門市彙整（支援時數一律全部門市）。 */
  storeScoped: boolean;
  fileName: (yearMonth: string, storeCount: number) => string;
  sheetName: string;
};

export const EXPORT_DEFINITIONS: readonly ExportDefinition[] = [
  { key: 'download', label: '下載 Excel', path: 'download', method: 'POST', permission: 'general', storeScoped: true, sheetName: '每月人員狀態', fileName: (ym, n) => `每月人員狀態_${ym}_${n}間門市.xlsx` },
  { key: 'actual-staff-points', label: '匯出實際人力點值', path: 'actual-staff-points', method: 'POST', permission: 'general', storeScoped: true, sheetName: '', fileName: (ym) => `實際人力點值_${ym}.xlsx` },
  { key: 'roster', label: '匯出每月門市人員名冊', path: 'roster', method: 'POST', permission: 'general', storeScoped: true, sheetName: '每月門市人員名冊', fileName: (ym) => `每月門市人員名冊_${ym}.xlsx` },
  { key: 'transport', label: '匯出交通費用', path: 'transport', method: 'POST', permission: 'general', storeScoped: true, sheetName: '', fileName: (ym) => `交通費用_${ym}.xlsx` },
  { key: 'single-item-bonus', label: '匯出單品獎金', path: 'single-item-bonus', method: 'POST', permission: 'login', storeScoped: true, sheetName: '單品獎金', fileName: (ym) => `單品獎金_${ym}.xlsx` },
  { key: 'talent-cultivation-bonus', label: '匯出育才獎金', path: 'talent-cultivation-bonus', method: 'POST', permission: 'general', storeScoped: true, sheetName: '', fileName: (ym) => `育才獎金_${ym}.xlsx` },
  { key: 'meal-allowance', label: '匯出誤餐費', path: 'meal-allowance', method: 'POST', permission: 'general', storeScoped: true, sheetName: '', fileName: (ym) => `誤餐費_${ym}.xlsx` },
  { key: 'spring-festival-bonus', label: '匯出春節出勤獎金', path: 'spring-festival-bonus', method: 'POST', permission: 'general', storeScoped: true, sheetName: '', fileName: (ym) => `春節出勤獎金_${ym}.xlsx` },
  { key: 'support-hours', label: '匯出門市支援時數', path: 'support-hours', method: 'GET', permission: 'support-hours', storeScoped: false, sheetName: '門市支援時數', fileName: (ym) => `門市支援時數_${ym}.xlsx` },
];

export const EXPORT_BY_KEY: Record<ExportKey, ExportDefinition> = Object.fromEntries(
  EXPORT_DEFINITIONS.map((d) => [d.key, d]),
) as Record<ExportKey, ExportDefinition>;

/** 前端下載檔名（照舊版 page.tsx 的 a.download 命名）。 */
export function exportFileName(key: ExportKey, yearMonth: string, storeCount = 0): string {
  return EXPORT_BY_KEY[key].fileName(yearMonth, storeCount);
}

export const MONTHLY_EXPORT_GENERAL_PERMISSION = 'monthly.export.download';

export function isExportYearMonth(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** 只有已提交、已確認的門市可匯出（舊版前端規則；W02-q3 起由 API 強制）。 */
export function canExportStore(status: unknown): boolean {
  return status === 'submitted' || status === 'confirmed';
}

/**
 * 門市提交狀態：與舊 /api/export-monthly-status/stores 完全相同的推導。
 * 先看門市摘要（monthly_store_summary.status），再看人員列（任一筆已確認 → 已確認；任一筆已提交 → 已提交）。
 */
export function deriveExportStoreStatus(
  summaryStatus: unknown,
  confirmedCount: number,
  submittedCount: number,
): ExportStoreStatus {
  if (summaryStatus === 'confirmed') return 'confirmed';
  if (summaryStatus === 'submitted') return 'submitted';
  if (confirmedCount > 0) return 'confirmed';
  if (submittedCount > 0) return 'submitted';
  return 'pending';
}

export type ExportStoreRow = {
  id: string;
  store_code: string;
  store_name: string;
  total_employees: number;
  submitted_count: number;
  confirmed_count: number;
  store_status: ExportStoreStatus;
  /** 僅守衛用（allStores）才會帶；未帶視為啟用中。 */
  is_active?: boolean;
};

/**
 * W02-q3：找出所選門市中「啟用中且尚未提交」者。已停用門市不處理（舊版 handler 對停用門市照常產檔），交給舊 handler。
 */
export function findUnsubmittedStores(selectedIds: readonly string[], stores: readonly ExportStoreRow[]): ExportStoreRow[] {
  const wanted = new Set(selectedIds.map((v) => String(v).trim().toLowerCase()));
  return stores.filter((s) => s.is_active !== false && wanted.has(s.id) && !canExportStore(s.store_status));
}

/** 所選 id 中完全不存在的門市（含停用者視為存在）；呼叫端回 400。 */
export function findNonExportableIds(selectedIds: readonly string[], stores: readonly ExportStoreRow[]): string[] {
  const known = new Set(stores.map((s) => s.id));
  return selectedIds.filter((id) => !known.has(String(id).trim().toLowerCase()));
}

const STORE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 正規化門市 id（trim、轉小寫），並要求標準 8-4-4-4-12 UUID 格式；任一筆不合格回 null（呼叫端回 400）。
 * Postgres 會把大寫、加大括號、不含連字號的字串都轉成 uuid，所以守衛與送給舊 handler 的 id 都必須用同一份正規化結果。
 */
export function normalizeStoreIds(values: readonly unknown[]): string[] | null {
  const out: string[] = [];
  for (const v of values) {
    if (typeof v !== 'string') return null;
    const id = v.trim().toLowerCase();
    if (!STORE_ID_PATTERN.test(id)) return null;
    out.push(id);
  }
  return out;
}

export function unsubmittedMessage(rows: readonly Pick<ExportStoreRow, 'store_code' | 'store_name'>[]): string {
  return `以下門市尚未提交，無法匯出：${rows.map((r) => `${r.store_code} ${r.store_name}`.trim()).join('、')}`;
}

export type ExportProfile = { role?: string | null; department?: string | null; job_title?: string | null } | null | undefined;

/** 舊 /api/export-monthly-status/support-hours 的角色／職稱判斷（W02-q2：完全照舊版）。 */
export function canExportSupportHours(profile: ExportProfile): boolean {
  if (!profile) return false;
  const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile.job_title || '');
  const isBusinessManager = !!profile.department?.startsWith('營業') && profile.role === 'manager' && !needsAssignment;
  const isAdmin = ['admin', 'supervisor', 'area_manager'].includes(profile.role || '');
  return isAdmin || isBusinessManager;
}

export type ExportAccess = {
  /** 入口與 8 支一般匯出（monthly.export.download）。 */
  general: boolean;
  /** 單品獎金：舊版只檢查登入；入口只開給可進入此頁的人。 */
  singleItem: boolean;
  supportHours: boolean;
};

/**
 * 可見的按鈕。pageEntry：是否有每月人員狀態模組權限（店長、督導等）；單品獎金只對一般匯出權限者或月結模組使用者顯示。
 */
export function exportAccess(input: { hasGeneral: boolean; hasMonthlyModule: boolean; profile: ExportProfile }): ExportAccess {
  const supportHours = canExportSupportHours(input.profile);
  return {
    general: input.hasGeneral,
    // 舊版單品獎金只要登入就能用；新版入口只開給可進入此頁的人（一般匯出、月結模組、支援時數角色）。
    singleItem: input.hasGeneral || input.hasMonthlyModule || supportHours,
    supportHours,
  };
}

/** 是否可開啟資料匯出頁（導覽與頁籤共用）。 */
export function canOpenMonthlyExport(access: ExportAccess): boolean {
  return access.general || access.singleItem || access.supportHours;
}

/** 某支匯出在此權限下是否可用。 */
export function canUseExport(access: ExportAccess, key: ExportKey): boolean {
  const permission = EXPORT_BY_KEY[key].permission;
  if (permission === 'general') return access.general;
  if (permission === 'login') return access.singleItem;
  return access.supportHours;
}
