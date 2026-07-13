import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

const BONUS_VALUE_FIELDS = [
  'group_bonus',
  'hr_subsidy_bonus',
  'single_item_bonus',
  'inventory_diff_penalty',
  'talent_bonus',
  'transport_fee',
  'inventory_bonus',
  'rx_incentive_bonus',
  'quarterly_makeup_bonus',
  'meal_allowance',
  'spring_festival_bonus',
  'pharmacist_guarantee',
  'owner_rx_makeup',
  'sales_competition_bonus',
  'owner_signing_bonus',
  'long_term_care_bonus',
  'manager_supervisor_quarterly_bonus',
  'opening_abnormal_responsibility_amount',
  'bonus_difference_adjustment',
  'other_bonus',
] as const;

const FULL_TIME_SPECIALIST_OR_ABOVE_POSITIONS = new Set([
  '總經理',
  '副總經理',
  '經理',
  '區經理',
  '督導',
  '店長',
  '儲備店長',
  '代理店長',
  '副店長',
  '主任',
  '組長',
  '專員',
  '督導(代理店長)',
  '區經理(代理店長)',
  '督導(店長)',
  '區經理(店長)',
]);

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function isNonZeroBonusRecord(row: Record<string, any>) {
  return BONUS_VALUE_FIELDS.some((field) => (Number(row[field]) || 0) !== 0);
}

function normalizePosition(position: unknown) {
  return String(position || '')
    .trim()
    .replace(/-雙$/, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')');
}

function isFullTimeSpecialistOrAbove(row: Record<string, any>) {
  if (row.employment_type !== 'full_time') return false;
  const position = normalizePosition(row.position);
  return FULL_TIME_SPECIALIST_OR_ABOVE_POSITIONS.has(position);
}

async function fetchAllPages<T>(
  createQuery: (from: number, to: number) => any
): Promise<{ data: T[]; error: any }> {
  const pageSize = 1000;
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await createQuery(from, to);
    if (error) return { data: rows, error };

    rows.push(...((data || []) as T[]));
    if (!data || data.length < pageSize) break;
  }

  return { data: rows, error: null };
}

function getGroupCompositeBonus(row: Record<string, any>) {
  return (
    (Number(row.group_bonus) || 0) +
    (Number(row.quarterly_makeup_bonus) || 0) +
    (Number(row.hr_subsidy_bonus) || 0)
  );
}

function summarizePersonMonthAverage(data: any[], eligiblePersonMonthKeys: Set<string>) {
  const personMonthKeys = new Set<string>();
  let singleItemTotal = 0;
  let groupCompositeTotal = 0;

  data.forEach((row: any) => {
    if (!isNonZeroBonusRecord(row)) return;

    const personMonthKey = `${row.store_id}|${row.year_month}|${row.employee_code}`;
    if (!eligiblePersonMonthKeys.has(personMonthKey)) return;

    personMonthKeys.add(personMonthKey);
    singleItemTotal += Number(row.single_item_bonus) || 0;
    groupCompositeTotal += getGroupCompositeBonus(row);
  });

  const denominator = personMonthKeys.size;
  return {
    person_month_count: denominator,
    employee_count: 0,
    imported_month_count: 0,
    single_item_total: singleItemTotal,
    group_composite_total: groupCompositeTotal,
    average_single_item_bonus: denominator > 0 ? singleItemTotal / denominator : 0,
    average_group_bonus: denominator > 0 ? groupCompositeTotal / denominator : 0,
  };
}

function summarizeContinuousEmployeeAverage(data: any[], staffRows: any[]) {
  const importedMonths = Array.from(new Set(data.map((row: any) => row.year_month).filter(Boolean))).sort();
  const importedMonthSet = new Set(importedMonths);

  const eligibleMonthsByEmployee = new Map<string, Set<string>>();
  staffRows
    .filter(isFullTimeSpecialistOrAbove)
    .filter((row: any) => importedMonthSet.has(row.year_month))
    .forEach((row: any) => {
      const employeeCode = String(row.employee_code || '').trim();
      if (!employeeCode) return;
      if (!eligibleMonthsByEmployee.has(employeeCode)) {
        eligibleMonthsByEmployee.set(employeeCode, new Set());
      }
      eligibleMonthsByEmployee.get(employeeCode)!.add(row.year_month);
    });

  const continuousEmployeeCodes = new Set(
    Array.from(eligibleMonthsByEmployee.entries())
      .filter(([, months]) => importedMonths.every((month) => months.has(month)))
      .map(([employeeCode]) => employeeCode)
  );

  let singleItemTotal = 0;
  let groupCompositeTotal = 0;

  data.forEach((row: any) => {
    if (!continuousEmployeeCodes.has(String(row.employee_code || '').trim())) return;

    singleItemTotal += Number(row.single_item_bonus) || 0;
    groupCompositeTotal += getGroupCompositeBonus(row);
  });

  const employeeCount = continuousEmployeeCodes.size;
  const importedMonthCount = importedMonths.length;
  const denominator = employeeCount * importedMonthCount;

  return {
    person_month_count: denominator,
    employee_count: employeeCount,
    imported_month_count: importedMonthCount,
    single_item_total: singleItemTotal,
    group_composite_total: groupCompositeTotal,
    average_single_item_bonus: denominator > 0 ? singleItemTotal / denominator : 0,
    average_group_bonus: denominator > 0 ? groupCompositeTotal / denominator : 0,
  };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      const canView = await hasPermission(user.id, 'performance.bonus.view');
      if (!canView) {
        return NextResponse.json({ error: '無檢視權限' }, { status: 403 });
      }
    }

    const { searchParams } = new URL(request.url);
    const asOfYearMonth = searchParams.get('as_of_year_month') || currentYearMonth();
    const startYearMonth = searchParams.get('start_year_month') || `${asOfYearMonth.slice(0, 4)}-01`;
    const averageMode = searchParams.get('average_mode') === 'person_month'
      ? 'person_month'
      : 'continuous_employee';
    const storeIds = searchParams.getAll('store_id');
    const supervisorId = searchParams.get('supervisor_id') || '';

    const admin = createAdminClient();

    let resolvedStoreIds = storeIds;
    if (supervisorId && storeIds.length === 0) {
      const { data: managed, error: managedError } = await admin
        .from('store_managers')
        .select('store_id')
        .eq('user_id', supervisorId);

      if (managedError) {
        return NextResponse.json({ error: managedError.message }, { status: 500 });
      }

      resolvedStoreIds = (managed || []).map((row: any) => row.store_id).filter(Boolean);
    }

    const { data: staffRows, error: staffError } = await fetchAllPages<any>((from, to) => {
      let staffQ = admin
        .from('monthly_staff_status')
        .select('store_id, year_month, employee_code, position, employment_type')
        .gte('year_month', startYearMonth)
        .lte('year_month', asOfYearMonth)
        .range(from, to);

      if (resolvedStoreIds.length > 0) staffQ = staffQ.in('store_id', resolvedStoreIds);
      return staffQ;
    });
    if (staffError) return NextResponse.json({ error: staffError.message }, { status: 500 });

    const eligiblePersonMonthKeys = new Set(
      (staffRows || [])
        .filter(isFullTimeSpecialistOrAbove)
        .map((row: any) => `${row.store_id}|${row.year_month}|${row.employee_code}`)
    );

    const { data, error } = await fetchAllPages<any>((from, to) => {
      let q = admin
        .from('monthly_bonus_records')
        .select(`
          store_id,
          year_month,
          employee_code,
          group_bonus,
          hr_subsidy_bonus,
          single_item_bonus,
          inventory_diff_penalty,
          talent_bonus,
          transport_fee,
          inventory_bonus,
          rx_incentive_bonus,
          quarterly_makeup_bonus,
          meal_allowance,
          spring_festival_bonus,
          pharmacist_guarantee,
          owner_rx_makeup,
          sales_competition_bonus,
          owner_signing_bonus,
          long_term_care_bonus,
          manager_supervisor_quarterly_bonus,
          opening_abnormal_responsibility_amount,
          bonus_difference_adjustment,
          other_bonus
        `)
        .gte('year_month', startYearMonth)
        .lte('year_month', asOfYearMonth)
        .range(from, to);

      if (resolvedStoreIds.length > 0) q = q.in('store_id', resolvedStoreIds);
      return q;
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const summary = averageMode === 'person_month'
      ? summarizePersonMonthAverage(data || [], eligiblePersonMonthKeys)
      : summarizeContinuousEmployeeAverage(data || [], staffRows || []);

    return NextResponse.json({
      success: true,
      average_mode: averageMode,
      start_year_month: startYearMonth,
      as_of_year_month: asOfYearMonth,
      ...summary,
      formula: {
        denominator: averageMode === 'person_month'
          ? 'distinct store_id + year_month + employee_code with any non-zero bonus and monthly_staff_status full_time specialist-or-above'
          : 'employees who are full_time specialist-or-above in every imported month, multiplied by imported month count',
        single_item: 'single_item_bonus',
        group: 'group_bonus + quarterly_makeup_bonus + hr_subsidy_bonus',
      },
    });
  } catch (e: any) {
    console.error('[GET /api/performance-bonus/averages]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
