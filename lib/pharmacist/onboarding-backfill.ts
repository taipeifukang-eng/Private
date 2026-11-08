/**
 * 每月藥師快照：補上「入職未同步」而漏掉的在職藥師。
 *
 * 補的條件（全部成立）：
 *   1. 員工主檔在職（is_active）且屬於範圍內門市
 *   2. 是藥師：主檔 is_pharmacist=true，或「該月底前最近一筆入職異動」勾是藥師
 *   3. 該月已入職：該月底前有入職異動；完全沒有入職異動時用主檔 start_date
 *   4. 不在該月快照名單（任何門市）
 * 補在其主檔所屬門市，notes 註明 BACKFILL_NOTE。已關帳月份由呼叫端排除，絕不改動。
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

export interface BackfillOnboarding {
  employee_code: string;
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
  onboardings: BackfillOnboarding[];
  /** 該月快照已有的員編（大寫，任何門市）。 */
  existingCodes: Set<string>;
  scopeStoreIds?: string[];
}): BackfillRow[] {
  const monthEnd = monthEndOf(opts.targetYearMonth);
  const scope = opts.scopeStoreIds ? new Set(opts.scopeStoreIds) : null;

  const byCode = new Map<string, BackfillOnboarding[]>();
  for (const o of opts.onboardings || []) {
    const code = String(o.employee_code || '').toUpperCase();
    if (!code) continue;
    const list = byCode.get(code) || [];
    list.push(o);
    byCode.set(code, list);
  }

  const rows: BackfillRow[] = [];
  const seen = new Set<string>();
  for (const e of opts.employees || []) {
    const code = String(e.employee_code || '').toUpperCase();
    if (!code || seen.has(code) || opts.existingCodes.has(code)) continue;
    if (e.is_active === false || !e.store_id) continue;
    if (scope && !scope.has(String(e.store_id))) continue;

    const all = byCode.get(code) || [];
    const effective = all
      .filter(o => day(o.movement_date) && day(o.movement_date) <= monthEnd)
      .sort((a, b) =>
        day(a.movement_date).localeCompare(day(b.movement_date)) ||
        String(a.created_at || '').localeCompare(String(b.created_at || '')));
    const latest = effective[effective.length - 1];

    let entered: boolean;
    if (latest) entered = true;
    else if (all.length > 0) entered = false; // 入職日在該月之後
    else entered = !!day(e.start_date) && day(e.start_date) <= monthEnd;
    if (!entered) continue;

    const isPharmacist = e.is_pharmacist === true || latest?.onboarding_is_pharmacist === true;
    if (!isPharmacist) continue;

    seen.add(code);
    rows.push({
      year_month: opts.targetYearMonth,
      store_id: String(e.store_id),
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

  // 1) 範圍內在職且主檔是藥師的員工 + 範圍內入職勾藥師的異動 -> 候選員編
  const [masters, flagged] = await Promise.all([
    readAll((a, b) => client.from('store_employees')
      .select(EMPLOYEE_COLUMNS)
      .in('store_id', storeIds).eq('is_active', true).eq('is_pharmacist', true)
      .order('employee_code').range(a, b)),
    readAll((a, b) => client.from('employee_movement_history')
      .select('id, employee_code')
      .eq('movement_type', 'onboarding').eq('onboarding_is_pharmacist', true)
      .in('store_id', storeIds).lte('movement_date', monthEnd)
      .order('id').range(a, b)),
  ]);

  const employees = new Map<string, BackfillEmployee>();
  for (const m of masters) employees.set(String(m.employee_code).toUpperCase(), m);
  const flaggedCodes = Array.from(new Set<string>(
    flagged.map((r: any) => String(r.employee_code || '').toUpperCase()).filter(Boolean),
  ));
  const extraCodes = flaggedCodes.filter(c => !employees.has(c));
  for (const part of chunk(extraCodes)) {
    const { data, error } = await client.from('store_employees')
      .select(EMPLOYEE_COLUMNS)
      .in('employee_code', part).in('store_id', storeIds).eq('is_active', true);
    if (error) throw error;
    for (const m of data || []) employees.set(String(m.employee_code).toUpperCase(), m);
  }
  const candidates = Array.from(employees.keys());
  if (!candidates.length) return [];

  // 2) 候選人的入職異動、該月快照已有的員編（分批）
  const onboardings: BackfillOnboarding[] = [];
  const existingCodes = new Set<string>();
  const tasks: Promise<void>[] = [];
  for (const part of chunk(candidates)) {
    tasks.push((async () => {
      const { data, error } = await client.from('employee_movement_history')
        .select('employee_code, movement_date, created_at, onboarding_is_pharmacist')
        .eq('movement_type', 'onboarding').in('employee_code', part);
      if (error) throw error;
      onboardings.push(...(data || []));
    })());
    tasks.push((async () => {
      const { data, error } = await client.from('pharmacist_monthly_snapshot')
        .select('employee_code').eq('year_month', targetYearMonth).in('employee_code', part);
      if (error) throw error;
      for (const r of data || []) existingCodes.add(String(r.employee_code || '').toUpperCase());
    })());
  }
  await Promise.all(tasks);

  return computeMissingOnboardingPharmacists({
    targetYearMonth,
    employees: Array.from(employees.values()),
    onboardings,
    existingCodes,
    scopeStoreIds: storeIds,
  });
}
