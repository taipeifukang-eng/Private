/**
 * M1-x1：月結「狀態 × 動作」統一規則表（純函式，無伺服器相依）。
 *
 * API（app/api/workspace/monthly/**）、Vue 畫面（Monthly.vue）、測試都引用這一份，不得各自重寫判斷。
 * 後續工作項（W01b、W02…）沿用。績效業績匯入與閾值不受月結狀態限制（W03-q3，照舊版），不在此表。
 *
 * 狀態來源：
 * - 單筆人員：monthly_staff_status.status（draft / submitted / confirmed）
 * - 整間門市：由全部人員列推導（deriveMonthState，與舊版 loadStaffStatus 一致），沒有人員列時退回門市摘要狀態
 *
 * 與舊版不同之處（已在 tests/parity/allowlist.json 登記）：
 * - 刪除：舊版只要門市未確認即可刪除；新版只有草稿可刪（W01a-q1）。
 * - 新增／編輯：舊版已送審仍可編輯；新版已送審整月鎖定（既有行為，維持）。
 */

import { isNewbieCandidate, monthIndex, monthsSinceHire, suggestedNewbieAction } from '../monthly-staff/newbie';

export type MonthlyStatus = 'draft' | 'submitted' | 'confirmed';
export type MonthlyAction =
  | 'add'
  | 'edit'
  | 'delete'
  | 'submit'
  | 'confirm'
  | 'revert'
  | 'unconfirm'
  | 'export';

export const MONTHLY_STATUSES: readonly MonthlyStatus[] = ['draft', 'submitted', 'confirmed'];
export const MONTHLY_ACTIONS: readonly MonthlyAction[] = ['add', 'edit', 'delete', 'submit', 'confirm', 'revert', 'unconfirm', 'export'];

/** 動作需要的 RBAC 權限碼（API 與畫面共用）。delete 與 add／edit 另需「被指派該門市」（管理員除外）。 */
export const MONTHLY_ACTION_PERMISSION: Record<Exclude<MonthlyAction, 'export'>, string> = {
  add: 'monthly.status.add_employee',
  edit: 'monthly.status.edit',
  delete: 'monthly.status.edit',
  submit: 'monthly.status.submit',
  confirm: 'monthly.status.confirm',
  revert: 'monthly.status.revert',
  unconfirm: 'monthly.status.unconfirm',
};

/** 需要「被指派該門市」才可執行的動作（舊版：管理員或該門市店長）。 */
export const MONTHLY_ACTIONS_NEED_ASSIGNMENT: readonly MonthlyAction[] = ['add', 'edit', 'delete', 'submit'];

/**
 * 狀態 × 動作矩陣。
 * export：已確認可匯出；已送審可匯出為 Vue 既有行為（舊版只有已確認），屬 W02 的待裁示項，維持現況。
 */
export const MONTHLY_STATUS_RULES: Record<MonthlyStatus, Record<MonthlyAction, boolean>> = {
  draft: { add: true, edit: true, delete: true, submit: true, confirm: false, revert: false, unconfirm: false, export: false },
  submitted: { add: false, edit: false, delete: false, submit: false, confirm: true, revert: true, unconfirm: false, export: true },
  confirmed: { add: false, edit: false, delete: false, submit: false, confirm: false, revert: false, unconfirm: true, export: true },
};

export function isMonthlyStatus(value: unknown): value is MonthlyStatus {
  return typeof value === 'string' && (MONTHLY_STATUSES as readonly string[]).includes(value);
}

/** 此狀態下是否允許該動作；未知狀態一律不允許。 */
export function canDoMonthlyAction(status: unknown, action: MonthlyAction): boolean {
  return isMonthlyStatus(status) && MONTHLY_STATUS_RULES[status][action] === true;
}

/** 動作被拒時的說明（API 409 與畫面提示共用）。 */
export function monthlyActionBlockedMessage(status: unknown, action: MonthlyAction): string {
  if (canDoMonthlyAction(status, action)) return '';
  if (action === 'delete')
    return status === 'confirmed' || status === 'submitted'
      ? '已送審或已確認的人員不可刪除，請先退回草稿後再刪除'
      : '此人員目前不可刪除，請重新查詢';
  if (action === 'add' || action === 'edit') return '此月份已送審或確認，請先退回草稿';
  if (action === 'submit') return '只有草稿可以送出審核';
  if (action === 'confirm') return '只有已送審的月份可以確認';
  if (action === 'revert') return '只有已送審的月份可以退回草稿';
  if (action === 'unconfirm') return '只有已確認的月份可以取消確認';
  return '此狀態不可匯出';
}

export type MonthStateInput = { status?: string | null };

/**
 * 整間門市本月狀態（與舊版 loadStaffStatus 一致）：
 * 全部已確認 → confirmed；全部已送審或已確認 → submitted；其餘 → draft。
 * 沒有任何人員列時回傳 null（畫面顯示「尚未初始化」，並可退回門市摘要狀態）。
 */
export function deriveMonthState(rows: readonly MonthStateInput[]): MonthlyStatus | null {
  if (!rows.length) return null;
  if (rows.every((r) => r.status === 'confirmed')) return 'confirmed';
  if (rows.every((r) => r.status === 'submitted' || r.status === 'confirmed')) return 'submitted';
  return 'draft';
}

/**
 * 門市層級動作（送審、確認、退回、取消確認、新增、編輯、刪除）是否有任何一列可執行：
 * 以「各列狀態」套用規則表。沒有任何人員列時一律不可（初始化另計）。
 */
export function rowsAllow(rows: readonly MonthStateInput[], action: MonthlyAction): boolean {
  return rows.some((r) => canDoMonthlyAction(r.status, action));
}

/**
 * 整間門市層級動作（確認、退回、取消確認）：每一列都必須可執行才放行。
 * 混合狀態（例如部分草稿、部分已送審）一律不可，避免把草稿列直接升為已確認。沒有任何人員列時不可。
 */
export function rowsAllowAll(rows: readonly MonthStateInput[], action: MonthlyAction): boolean {
  return rows.length > 0 && rows.every((r) => canDoMonthlyAction(r.status, action));
}

/** 整間門市層級動作：確認、退回、取消確認要求整間門市狀態一致。 */
export const STORE_WIDE_ACTIONS: readonly MonthlyAction[] = ['confirm', 'revert', 'unconfirm'];

/** 門市摘要 store_status（in_progress / submitted / confirmed / pending 等）對應月結狀態。 */
export function summaryStatusToMonthly(summaryStatus: unknown): MonthlyStatus | null {
  if (summaryStatus === 'confirmed') return 'confirmed';
  if (summaryStatus === 'submitted') return 'submitted';
  if (summaryStatus === 'in_progress' || summaryStatus === 'draft') return 'draft';
  return null;
}

/** 畫面用的門市狀態：沒有人員列就看摘要，仍無則為 null。 */
export function resolveMonthState(rows: readonly MonthStateInput[], summaryStatus?: unknown): MonthlyStatus | null {
  return deriveMonthState(rows) ?? summaryStatusToMonthly(summaryStatus);
}

// ---------------------------------------------------------------------------
// 總覽：門市狀態標籤與統計卡片（舊版 getStatusLabel / 統計卡片）
// ---------------------------------------------------------------------------

export type StoreSummaryStatus = 'confirmed' | 'submitted' | 'in_progress' | 'pending';

export function normalizeSummaryStatus(value: unknown): StoreSummaryStatus {
  return value === 'confirmed' || value === 'submitted' || value === 'in_progress' ? value : 'pending';
}

export const STORE_SUMMARY_LABELS: Record<StoreSummaryStatus, string> = {
  confirmed: '已確認',
  submitted: '已提交',
  in_progress: '填寫中',
  pending: '待填寫',
};

export type StoreLike = { id: string; is_active?: boolean | null };
export type SummaryLike = { store_id: string; store_status?: string | null };

export interface MonthlyStats {
  total: number;
  confirmed: number;
  submitted: number;
  pending: number;
}

/**
 * 統計卡片（舊版）：總門市數＝可管理的「有效」門市；已確認／已提交＝摘要狀態；待填寫＝其餘。
 * 已停止門市不計入。
 */
export function computeStoreStats(stores: readonly StoreLike[], summaries: readonly SummaryLike[]): MonthlyStats {
  const active = stores.filter((s) => s.is_active !== false);
  const ids = new Set(active.map((s) => s.id));
  const scoped = summaries.filter((s) => ids.has(s.store_id));
  const confirmed = scoped.filter((s) => s.store_status === 'confirmed').length;
  const submitted = scoped.filter((s) => s.store_status === 'submitted').length;
  return { total: active.length, confirmed, submitted, pending: active.length - confirmed - submitted };
}

/**
 * 確認後自動跳下一間（舊版 loadStoreSummaries moveToNext）：
 * 在「有效門市」清單中，從目前門市的下一間開始（不繞回頭）找第一間尚未確認者；找不到回傳 null（停留原處）。
 * 目前門市不在有效清單（例如已停止門市）時不跳。
 */
export function nextUnconfirmedStore(
  activeStores: readonly { id: string }[],
  currentId: string,
  summaries: readonly SummaryLike[],
): string | null {
  const index = activeStores.findIndex((s) => s.id === currentId);
  if (index < 0) return null;
  for (const store of activeStores.slice(index + 1)) {
    const summary = summaries.find((s) => s.store_id === store.id);
    if (summary?.store_status !== 'confirmed') return store.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 送審前檢查（W01a-q2）：同一個視窗列出所有問題；判斷規則照舊版
// ---------------------------------------------------------------------------

export interface PreSubmitStaff {
  id: string;
  employee_code?: string | null;
  employee_name?: string | null;
  employment_type?: string | null;
  work_hours?: number | string | null;
  start_date?: string | null;
  position?: string | null;
  monthly_status?: string | null;
  newbie_level?: string | null;
  status?: string | null;
}

export interface PartTimeMissingHours {
  id: string;
  employee_code: string;
  employee_name: string;
}

export interface NewbieNeedsCheck {
  id: string;
  employee_code: string;
  employee_name: string;
  start_date: string;
  current_level: string;
  suggested_action: string;
}

export interface PreSubmitReport {
  partTimeMissingHours: PartTimeMissingHours[];
  newbiesNeedCheck: NewbieNeedsCheck[];
  hasIssues: boolean;
}

/** 舊版 handleSubmit：兼職且工作時數為空白、非數字或 ≤ 0。 */
export function partTimeMissingHours(rows: readonly PreSubmitStaff[]): PartTimeMissingHours[] {
  return rows
    .filter((r) => {
      if (r.employment_type !== 'part_time') return false;
      const hours = Number(r.work_hours);
      return !Number.isFinite(hours) || hours <= 0;
    })
    .map((r) => ({ id: r.id, employee_code: r.employee_code || '', employee_name: r.employee_name || '' }));
}

/**
 * 舊版 checkNewbieStatus（app/store/actions.ts）：只看草稿列；
 * 有到職日且（職位為新人或本月狀態為本月新進）者，依到職月份差判斷（判斷抽到 lib/monthly-staff/newbie.ts，W01b 共用）。
 */
export function newbiesNeedCheck(rows: readonly PreSubmitStaff[], yearMonth: string): NewbieNeedsCheck[] {
  const result: NewbieNeedsCheck[] = [];
  if (monthIndex(yearMonth) === null) return result;
  for (const staff of rows) {
    if (staff.status !== 'draft') continue;
    if (!staff.start_date || !isNewbieCandidate(staff.position, staff.monthly_status)) continue;
    const monthsDiff = monthsSinceHire(staff.start_date, yearMonth);
    if (monthsDiff === null) continue;
    const suggested = suggestedNewbieAction(monthsDiff, staff.position, staff.newbie_level);
    if (suggested)
      result.push({
        id: staff.id,
        employee_code: staff.employee_code || '',
        employee_name: staff.employee_name || '',
        start_date: staff.start_date,
        current_level: staff.newbie_level || '未設定',
        suggested_action: suggested,
      });
  }
  return result;
}

/** 送審前檢查：兼職缺時數（只看草稿列，因為只有草稿會被送出）與新人階段，同一份報告。 */
export function preSubmitReport(rows: readonly PreSubmitStaff[], yearMonth: string): PreSubmitReport {
  const drafts = rows.filter((r) => r.status === 'draft');
  const partTime = partTimeMissingHours(drafts);
  const newbies = newbiesNeedCheck(rows, yearMonth);
  return { partTimeMissingHours: partTime, newbiesNeedCheck: newbies, hasIssues: partTime.length + newbies.length > 0 };
}

// ---------------------------------------------------------------------------
// 列表顯示：細節標籤（舊版特殊標記欄）與業績明細展開條件
// ---------------------------------------------------------------------------

export interface TagStaff {
  is_manually_added?: boolean | null;
  is_dual_position?: boolean | null;
  has_manager_bonus?: boolean | null;
  is_supervisor_rotation?: boolean | null;
  is_acting_manager?: boolean | null;
  special_role?: string | null;
  extra_tasks?: string[] | null;
  extra_task_external_hours?: number | null;
}

export interface StaffTag {
  key: string;
  label: string;
}

/** 舊版「特殊標記」欄：雙職務、店長加成、督導卡班、代理店長、特殊職務、外務（含外務時數）。 */
export function staffTags(staff: TagStaff): StaffTag[] {
  const tags: StaffTag[] = [];
  if (staff.is_dual_position) tags.push({ key: 'dual', label: '雙職務' });
  if (staff.has_manager_bonus) tags.push({ key: 'manager-bonus', label: '店長加成' });
  if (staff.is_supervisor_rotation) tags.push({ key: 'supervisor-rotation', label: '督導卡班' });
  if (staff.is_acting_manager) tags.push({ key: 'acting', label: '代理店長' });
  if (staff.special_role) tags.push({ key: 'special', label: staff.special_role });
  const tasks = staff.extra_tasks || [];
  if (tasks.length) {
    const external = (tasks.includes('長照外務') || tasks.includes('診所業務')) && (staff.extra_task_external_hours || 0) > 0;
    tags.push({ key: 'extra', label: `${tasks.join(', ')}${external ? `(${staff.extra_task_external_hours}h)` : ''}` });
  }
  return tags;
}

export interface WorkloadStaff {
  employment_type?: string | null;
  work_days?: number | null;
  work_hours?: number | null;
  total_days_in_month?: number | null;
  supervisor_shift_hours?: number | null;
  extra_task_planned_hours?: number | null;
}

/** 舊版「天數/時數」欄：督導卡班時數優先，其次外務預計時數，正職為 天數/當月天數，兼職為時數。 */
export function workloadText(staff: WorkloadStaff): string {
  if (staff.supervisor_shift_hours && staff.supervisor_shift_hours > 0) return `${staff.supervisor_shift_hours} 小時`;
  if (staff.extra_task_planned_hours && staff.extra_task_planned_hours > 0) return `${staff.extra_task_planned_hours} 小時`;
  if (staff.employment_type === 'full_time') return `${staff.work_days || 0}/${staff.total_days_in_month} 天`;
  return `${staff.work_hours || 0} 小時`;
}

/** 職位旁的新人／行政階段文字：有階段顯示短稱，沒有顯示「未標註」（舊版）。 */
export function levelSuffix(position: string | null | undefined, level: string | null | undefined): { text: string; missing: boolean } | null {
  if (position !== '新人' && position !== '行政') return null;
  if (!level) return { text: '未標註', missing: true };
  return { text: level.replace('新人', '').replace('行政', ''), missing: false };
}

/** 舊版：有交易次數才顯示展開業績明細的按鈕。 */
export function canExpandPerformance(staff: { transaction_count?: number | null }, canViewPerformance: boolean): boolean {
  return canViewPerformance && !!staff.transaction_count && staff.transaction_count > 0;
}

/** 異動歷程類型標籤與顏色類別（舊版 getMovementTypeLabel / Color）。 */
export function movementTypeLabel(type: string, newValue?: string | null): string {
  if (type === 'promotion' && newValue === '代理店長') return '代理（舊紀錄）';
  const map: Record<string, string> = {
    onboarding: '入職',
    promotion: '升職',
    acting_manager: '代理',
    store_transfer: '調店',
    leave_without_pay: '留職停薪',
    return_to_work: '復職',
    pass_probation: '過試用期',
    resignation: '離職',
  };
  return map[type] || type;
}
