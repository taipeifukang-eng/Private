/**
 * 每月門市職位人數統計：資料讀取（唯讀）。
 * db 必須是已通過權限檢查後的 service client（呼叫端負責檢查；見 app/api/admin/position-headcount/route.ts）。
 * 一次批次抓取，分頁 1000 筆（Supabase 預設上限），不會每間門市各查一次。
 */
import { assignSupervisorsToStores } from '@/lib/stores/supervisor-assignment';
import {
  findUnfinalizedStores,
  storeKept,
  type FranchiseFilter,
  monthsEndingAt,
  type HeadcountRecord,
  type HeadcountStore,
  type StoreSummaryRow,
} from '@/lib/monthly-staff/position-headcount';

export const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface PositionHeadcountPayload {
  yearMonth: string;
  trend: boolean;
  franchise: FranchiseFilter;
  months: string[];
  stores: HeadcountStore[];
  records: HeadcountRecord[];
  unfinalizedStores: HeadcountStore[];
}

async function fetchAllPages<T>(createQuery: (from: number, to: number) => any): Promise<T[]> {
  const pageSize = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await createQuery(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...((data || []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

export async function loadPositionHeadcountData(db: any, yearMonth: string, trend: boolean, franchise: FranchiseFilter = 'all'): Promise<PositionHeadcountPayload> {
  if (!YEAR_MONTH_PATTERN.test(yearMonth)) throw new Error('月份格式錯誤，需為 YYYY-MM');
  const months = trend ? monthsEndingAt(yearMonth, 12) : [yearMonth];

  const [allStores, managers, records, summaries] = await Promise.all([
    fetchAllPages<{ id: string; store_code: string; store_name: string; is_active: boolean | null; is_franchise: boolean | null }>((from, to) =>
      db.from('stores').select('id, store_code, store_name, is_active, is_franchise').order('store_code').order('id').range(from, to),
    ),
    fetchAllPages<any>((from, to) =>
      db
        .from('store_managers')
        .select('store_id, user_id, role_type, user:profiles!store_managers_user_id_fkey(full_name, employee_code, job_title)')
        .order('store_id')
        .order('user_id')
        .range(from, to),
    ),
    fetchAllPages<HeadcountRecord>((from, to) =>
      db
        .from('monthly_staff_status')
        .select('year_month, store_id, employee_code, employee_name, position, newbie_level, monthly_status, is_acting_manager, is_dual_position, is_supervisor_rotation, employment_type')
        .in('year_month', months)
        .order('year_month')
        .order('id')
        .range(from, to),
    ),
    fetchAllPages<StoreSummaryRow>((from, to) =>
      db.from('monthly_store_summary').select('store_id, store_status').eq('year_month', yearMonth).order('store_id').range(from, to),
    ),
  ]);

  // 督導區沿用舊版 stores-with-supervisors 的認定方式（只對啟用中的門市判斷；停用門市歸「未分區」）
  const activeStores = allStores.filter((s) => s.is_active !== false);
  const assigned = assignSupervisorsToStores(activeStores, managers);
  const supMap = new Map(assigned.map((s) => [s.id, s]));
  // 督導員編：用 assignSupervisorsToStores 的 supervisor_id 對應 store_managers 帶出的 profiles.employee_code
  const codeByUser = new Map<string, string>();
  for (const m of managers) {
    const u = Array.isArray(m.user) ? m.user[0] : m.user;
    const code = String(u?.employee_code ?? '').trim();
    if (code) codeByUser.set(m.user_id, code);
  }
  const stores: HeadcountStore[] = allStores.map((s) => ({
    id: s.id,
    store_code: s.store_code,
    store_name: s.store_name,
    is_franchise: s.is_franchise === true,
    supervisor_id: supMap.get(s.id)?.supervisor_id ?? null,
    supervisor_name: supMap.get(s.id)?.supervisor_name ?? null,
    supervisor_employee_code:
      supMap.get(s.id)?.supervisor_code ?? (supMap.get(s.id)?.supervisor_id ? codeByUser.get(supMap.get(s.id)!.supervisor_id as string) ?? null : null),
  }));

  // 加盟店篩選：先用全部門市分類、再依門市篩，所以這裡一律回傳全部紀錄，由 computeMonthHeadcount / computeHeadcountTrend 帶入 franchise 篩選
  const storeById = new Map(stores.map((s) => [s.id, s]));
  // 未定稿是門市本身的狀態：只依門市是否留下決定列不列，避免「只看＋不含」少列門市
  const unfinalizedStores = findUnfinalizedStores(records, stores, summaries, yearMonth).filter((s) => storeKept(storeById.get(s.id), franchise));

  return {
    yearMonth,
    trend,
    franchise,
    months,
    stores,
    records,
    unfinalizedStores,
  };
}
