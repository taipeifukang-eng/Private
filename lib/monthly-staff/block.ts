/**
 * W01b-q1：預計獎金區塊（純函式，無伺服器相依）。
 *
 * 規則來源是資料庫函式 calculate_bonus_block（目前最新版：supabase/migration_fix_block4_acting_manager.sql，9 個參數）。
 * 前端預覽必須與儲存後 DB 觸發器算出的 calculated_block 一致，不再沿用舊版編輯頁自己寫的 calculateBlock。
 * 單元測試 tests/unit/W01b/block-vs-db.test.ts 以同一組輸入在 DEV 呼叫 RPC 逐筆比對。
 *
 * 注意：DB 看到的是「儲存後的欄位」，例如雙職務督導(代理店長)與兼職不存 work_days（為 NULL），
 * 所以預覽要先經過 savedWorkDays 轉成與 API 儲存時相同的值。
 */

export interface BlockInput {
  employment_type: string;
  monthly_status: string;
  is_pharmacist: boolean;
  position: string;
  is_dual_position: boolean;
  is_supervisor_rotation: boolean;
  /** 儲存後的 work_days（可為 null）。 */
  work_days: number | null;
  extra_tasks: readonly string[] | null;
  is_acting_manager: boolean;
}

const EXTERNAL_TASKS = ['長照外務', '診所業務'];

/** 與 DB calculate_bonus_block 逐條對應（含 SQL 的 NULL 語意：work_days 為 null 時 work_days = 0 不成立）。 */
export function calculateBonusBlock(i: BlockInput): number {
  const position = i.position || '';
  // 區塊 2：督導卡班（最優先）
  if (i.is_supervisor_rotation) return 2;
  // 區塊 5：兼職藥師與兼職專員
  if (i.employment_type === 'part_time' && (i.is_pharmacist || position.includes('兼職專員'))) return 5;
  // 區塊 6：兼職一般人
  if (i.employment_type === 'part_time') return 6;
  // 區塊 4：督導 + 雙職務 + （職位含代理店長 或 勾選擔任代理店長）
  if (position.includes('督導') && i.is_dual_position && (position.includes('代理店長') || i.is_acting_manager)) return 4;
  // 區塊 4：長照外務或診所業務
  if (i.extra_tasks && i.extra_tasks.some((t) => EXTERNAL_TASKS.includes(t))) return 4;
  // 區塊 3：店長-雙、代理店長-雙（不含督導）
  if (i.is_dual_position && position.includes('店長') && !position.includes('督導')) return 3;
  // 區塊 3：非整月正職，或上班天數為 0 的正職
  if (i.employment_type === 'full_time' && (i.monthly_status !== 'full_month' || i.work_days === 0)) return 3;
  // 區塊 1：正職整月
  if (i.employment_type === 'full_time' && i.monthly_status === 'full_month') return 1;
  return 0;
}

/** 呼叫 DB RPC 用的參數（測試比對用）。 */
export function blockRpcArgs(i: BlockInput) {
  return {
    p_employment_type: i.employment_type,
    p_monthly_status: i.monthly_status,
    p_is_pharmacist: i.is_pharmacist,
    p_position: i.position,
    p_is_dual_position: i.is_dual_position,
    p_is_supervisor_rotation: i.is_supervisor_rotation,
    p_work_days: i.work_days,
    p_extra_tasks: i.extra_tasks && i.extra_tasks.length ? [...i.extra_tasks] : null,
    p_is_acting_manager: i.is_acting_manager,
  };
}

/** 編輯表單（未儲存）的欄位。 */
export interface BlockForm {
  employment_type: string;
  monthly_status: string;
  is_pharmacist: boolean;
  position: string;
  is_dual_position: boolean;
  is_supervisor_rotation: boolean;
  is_acting_manager: boolean;
  work_days: number | string | null;
  extra_tasks: readonly string[] | null;
}

/** 督導(代理店長)-雙：職位同時含督導與代理店長且勾選雙職務（舊版 isSupervisorActingManagerDual）。 */
export function isSupervisorActingManagerDual(position: string | null | undefined, isDual: boolean): boolean {
  const p = position || '';
  return p.includes('督導') && p.includes('代理店長') && !!isDual;
}

/** 與 API save 相同：正職且不是督導(代理店長)-雙才存 work_days，其餘存 NULL。 */
export function savedWorkDays(form: Pick<BlockForm, 'position' | 'employment_type' | 'is_dual_position' | 'work_days'>): number | null {
  if (isSupervisorActingManagerDual(form.position, form.is_dual_position) || form.employment_type !== 'full_time') return null;
  // 與舊版一致：空白（或非數字）送出前轉 0（見 MonthlyEdit 的 blankToZero），所以預覽也當 0。
  const n = Number(form.work_days);
  return form.work_days === null || form.work_days === '' || form.work_days === undefined || !Number.isFinite(n) ? 0 : n;
}

/** 前端預覽：以「儲存後 DB 會看到的值」計算區塊。 */
export function previewBonusBlock(form: BlockForm): number {
  return calculateBonusBlock({
    employment_type: form.employment_type,
    monthly_status: form.monthly_status,
    is_pharmacist: !!form.is_pharmacist,
    position: form.position,
    is_dual_position: !!form.is_dual_position,
    is_supervisor_rotation: !!form.is_supervisor_rotation,
    work_days: savedWorkDays(form),
    extra_tasks: form.extra_tasks && form.extra_tasks.length ? form.extra_tasks : null,
    is_acting_manager: !!form.is_acting_manager,
  });
}

export const BLOCK_DESCRIPTIONS: Record<number, string> = {
  0: '未分類',
  1: '區塊1：正職整月',
  2: '區塊2：督導卡班',
  3: '區塊3：非整月正職',
  4: '區塊4：特殊時數',
  5: '區塊5：兼職藥師',
  6: '區塊6：兼職一般人',
};
