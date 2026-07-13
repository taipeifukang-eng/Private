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

function currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function isNonZeroBonusRecord(row: Record<string, any>) {
  return BONUS_VALUE_FIELDS.some((field) => (Number(row[field]) || 0) !== 0);
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
      .lte('year_month', asOfYearMonth);

    if (resolvedStoreIds.length > 0) q = q.in('store_id', resolvedStoreIds);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const personMonthKeys = new Set<string>();
    let singleItemTotal = 0;
    let groupCompositeTotal = 0;

    (data || []).forEach((row: any) => {
      if (!isNonZeroBonusRecord(row)) return;

      personMonthKeys.add(`${row.store_id}|${row.year_month}|${row.employee_code}`);
      singleItemTotal += Number(row.single_item_bonus) || 0;
      groupCompositeTotal +=
        (Number(row.group_bonus) || 0) +
        (Number(row.quarterly_makeup_bonus) || 0) +
        (Number(row.hr_subsidy_bonus) || 0);
    });

    const personMonthCount = personMonthKeys.size;

    return NextResponse.json({
      success: true,
      as_of_year_month: asOfYearMonth,
      person_month_count: personMonthCount,
      single_item_total: singleItemTotal,
      group_composite_total: groupCompositeTotal,
      average_single_item_bonus: personMonthCount > 0 ? singleItemTotal / personMonthCount : 0,
      average_group_bonus: personMonthCount > 0 ? groupCompositeTotal / personMonthCount : 0,
      formula: {
        denominator: 'distinct store_id + year_month + employee_code with any non-zero bonus',
        single_item: 'single_item_bonus',
        group: 'group_bonus + quarterly_makeup_bonus + hr_subsidy_bonus',
      },
    });
  } catch (e: any) {
    console.error('[GET /api/performance-bonus/averages]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
