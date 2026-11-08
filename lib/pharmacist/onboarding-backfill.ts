/**
 * 每月藥師快照：補上「入職未同步」而漏掉的在職藥師。
 *
 * 補的條件（全部成立）：
 *   1. 員工主檔在職（is_active）
 *   2. 當時是藥師：該月底前「最近一筆入職異動」勾是藥師。
 *      不看主檔現在的 is_pharmacist（主檔是「現在」的身分，看不出該月當時是不是藥師，
 *      也會把刻意改成非藥師的人重新補回來）。
 *   3. 該月已入職：該月底前有入職異動
 *   4. 從未出現在「該月（含）以前」任何月份的快照名單（與正式區補正 SQL A/B「從未出現在任何快照」一致；
 *      只看該月以前，是因為補到更早的月份時，後面月份的列不該讓前面的月份被略過）
 * 該月所屬門市：與 reconcilePharmacistTransfers 同一規則，取「最近一筆入職或調店」異動的門市：
 *   入職異動 movement_date <= 月底；調店異動 movement_date <= 該月 1 日（調店當月維持原店，次月才生效）。
 *   沒有可用門市時才退回主檔 store_id。
 * 該月所屬門市必須在呼叫端範圍內。notes 註明 BACKFILL_NOTE。已關帳月份由呼叫端排除，絕不改動。
 *
 * 純函式 computeMissingOnboardingPharmacists 可單元測試；
 * findMissingOnboardingPharmacists 負責批次查詢（固定幾次查詢，不是每人一查）。
 */

export const BACKFILL_NOTE = 'backfilled: onboarding not synced';

export interface BackfillEmployee {
  employee_code: string;
  employee_name?: string | null;
  store_id?: string | null;
  is_active?: boolean | null;
  is_pharmacist?: boolean | null;
  start_date?: string | null;
  position?: string | null;
  current_position?: string | null;
}

/** 入職或調店異動（調店的 store_id 是新門市）。movement_type 省略視為入職。 */
export interface BackfillOnboarding {
  employee_code: string;
  movement_type?: string | null;
  store_id?: string | null;
  movement_date?: string | null;
  created_at?: string | null;
  onboarding_is_pharmacist?: boolean | null;
}

export interface BackfillRow {
  year_month: string;
  store_id: string;
  employee_code: string;
  employee_name: string;
  position: string | null;
  is_active: true;
  source: 'movement';
  notes: string;
}

export function monthEndOf(yearMonth: string): string {
  const y = Number(yearMonth.slice(0, 4));
  const m = Number(yearMonth.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${yearMonth}-${String(last).padStart(2, '0')}`;
}

const day = (v?: string | null) => (v ? String(v).slice(0, 10) : '');

export function computeMissingOnboardingPharmacists(opts: {
  targetYearMonth: string;
  employees: BackfillEmployee[];
  /** 候選人的入職與調店異動。 */
  onboardings: BackfillOnboarding[];
  /** 該月（含）以前任一月份快照已出現過的員編（大寫，任何門市）。 */
  existingCodes: Set<string>;
  scopeStoreIds?: string[];
}): BackfillRow[] {
  const monthEnd = monthEndOf(opts.targetYearMonth);
  const monthStart = `${opts.targetYearMonth}-01`;
  const scope = opts.scopeStoreIds ? new Set(opts.scopeStoreIds) : null;

  const byCode = new Map<string, BackfillOnboarding[]>();
  for (const o of opts.onboardings || []) {
    const code = String(o.employee_code || '').toUpperCase();
    if (!code) continue;
    const list = byCode.get(code) || [];
    list.push(o);
    byCode.set(code, list);
  }
  const byTime = (a: BackfillOnboarding, b: BackfillOnboarding) =>
    day(a.movement_date).localeCompare(day(b.movement_date)) ||
    String(a.created_at || '').localeCompare(String(b.created_at || ''));
  const isTransfer = (o: BackfillOnboarding) => o.movement_type === 'store_transfer';

  const rows: BackfillRow[] = [];
  const seen = new Set<string>();
  for (const e of opts.employees || []) {
    const code = String(e.employee_code || '').toUpperCase();
    if (!code || seen.has(code) || opts.existingCodes.has(code)) continue;
    if (e.is_active === false) continue;

    const all = byCode.get(code) || [];
    const onboardings = all
      .filter(o => !isTransfer(o) && day(o.movement_date) && day(o.movement_date) <= monthEnd)
      .sort(byTime);
    const latest = onboardings[onboardings.length - 1];
    // 該月已入職，且當時（最近一筆入職）勾是藥師
    if (!latest || latest.onboarding_is_pharmacist !== true) continue;

    // 該月所屬門市：最近一筆生效的入職或調店
    const placed = all
      .filter(o => day(o.movement_date) && (isTransfer(o) ? day(o.movement_date) <= monthStart : day(o.movement_date) <= monthEnd))
      .sort(byTime);
    const placedStore = [...placed].reverse().find(o => o.store_id)?.store_id;
    const storeId = placedStore || e.store_id;
    if (!storeId) continue;
    if (scope && !scope.has(String(storeId))) continue;

    seen.add(code);
    rows.push({
      year_month: opts.targetYearMonth,
      store_id: String(storeId),
      employee_code: code,
      employee_name: String(e.employee_name || ''),
      position: e.current_position || e.position || null,
      is_active: true,
      source: 'movement',
      notes: BACKFILL_NOTE,
    });
  }
  return rows;
}

const CHUNK = 200;
function chunk<T>(arr: T[], n: number = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function readAll(build: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await build(offset, offset + 999);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

const EMPLOYEE_COLUMNS = 'employee_code, employee_name, store_id, is_active, is_pharmacist, start_date, position, current_position';

/** 批次查出該月應補卻缺的藥師列（固定查詢次數，與人數無關）。 */
export async function findMissingOnboardingPharmacists(
  client: any,
  targetYearMonth: string,
  storeIds: string[],
): Promise<BackfillRow[]> {
  if (!storeIds.length) return [];
  const monthEnd = monthEndOf(targetYearMonth);

  // 1) 該月底前入職且勾是藥師的異動 -> 候選員編。
  //    不限門市：藥師可能已調到範圍外或範圍內的其他店，該月歸屬哪間由下面的規則決定。
  const flagged = await readAll((a, b) => client.from('employee_movement_history')
    .select('id, employee_code')
    .eq('movement_type', 'onboarding').eq('onboarding_is_pharmacist', true)
    .lte('movement_date', monthEnd)
    .order('id').range(a, b));
  const flaggedCodes = Array.from(new Set<string>(
    flagged.map((r: any) => String(r.employee_code || '').toUpperCase()).filter(Boolean),
  ));
  if (!flaggedCodes.length) return [];

  // 2) 候選人的主檔、入職與調店異動、該月（含）以前快照已出現的員編（分批）
  const employees: BackfillEmployee[] = [];
  const onboardings: BackfillOnboarding[] = [];
  const existingCodes = new Set<string>();
  const tasks: Promise<void>[] = [];
  for (const part of chunk(flaggedCodes)) {
    tasks.push((async () => {
      const { data, error } = await client.from('store_employees')
        .select(EMPLOYEE_COLUMNS).in('employee_code', part).eq('is_active', true);
      if (error) throw error;
      employees.push(...(data || []));
    })());
    tasks.push((async () => {
      const rows = await readAll((a, b) => client.from('employee_movement_history')
        .select('id, employee_code, movement_type, store_id, movement_date, created_at, onboarding_is_pharmacist')
        .in('movement_type', ['onboarding', 'store_transfer']).in('employee_code', part)
        .order('id').range(a, b));
      onboardings.push(...rows);
    })());
    tasks.push((async () => {
      const rows = await readAll((a, b) => client.from('pharmacist_monthly_snapshot')
        .select('id, employee_code').lte('year_month', targetYearMonth).in('employee_code', part)
        .order('id').range(a, b));
      for (const r of rows) existingCodes.add(String(r.employee_code || '').toUpperCase());
    })());
  }
  await Promise.all(tasks);

  return computeMissingOnboardingPharmacists({
    targetYearMonth,
    employees,
    onboardings,
    existingCodes,
    scopeStoreIds: storeIds,
  });
}
