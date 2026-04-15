import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

const BONUS_FIELDS = [
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
] as const;

const POSITION_PRIORITY = [
  '經理',
  '督導',
  '店長',
  '儲備店長',
  '代理店長',
  '副店長',
  '主任',
  '組長',
  '專員',
  '新人',
  '兼職專員',
  '兼職藥師專員',
  '兼職藥師',
  '兼職助理',
] as const;

function getPositionRank(position: string | null | undefined): number {
  if (!position) return 999;
  const idx = POSITION_PRIORITY.findIndex(p => p === position);
  return idx >= 0 ? idx : 999;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      const canView = await hasPermission(user.id, 'monthly.status.bonus_detail.view');
      if (!canView) {
        return NextResponse.json({ success: false, error: '無查看權限' }, { status: 403 });
      }
    }

    const { searchParams } = new URL(request.url);
    const yearMonth = searchParams.get('year_month') || '';
    const storeId = searchParams.get('store_id') || '';

    if (!yearMonth || !storeId) {
      return NextResponse.json({ success: false, error: '缺少年月或門市參數' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: staffList, error: staffError } = await admin
      .from('monthly_staff_status')
      .select('employee_code, employee_name, position')
      .eq('year_month', yearMonth)
      .eq('store_id', storeId);

    if (staffError) {
      return NextResponse.json({ success: false, error: staffError.message }, { status: 500 });
    }

    const employeeCodes = Array.from(new Set((staffList || []).map((s: any) => s.employee_code).filter(Boolean)));

    if (employeeCodes.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    const { data: bonusRows, error: bonusError } = await admin
      .from('monthly_bonus_records')
      .select(`
        store_id,
        year_month,
        employee_code,
        employee_name,
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
        store:stores!monthly_bonus_records_store_id_fkey(store_code, store_name)
      `)
      .eq('year_month', yearMonth)
      .in('employee_code', employeeCodes)
      .order('employee_code')
      .order('store_id');

    if (bonusError) {
      return NextResponse.json({ success: false, error: bonusError.message }, { status: 500 });
    }

    const grouped = new Map<string, any[]>();
    (bonusRows || []).forEach((row: any) => {
      const current = grouped.get(row.employee_code) || [];
      const total = BONUS_FIELDS.reduce((sum, f) => sum + (Number(row[f]) || 0), 0);
      const storeInfo = Array.isArray(row.store) ? row.store[0] : row.store;
      const isOtherStore = row.store_id !== storeId;

      // 他店來源若整列獎金皆為空值/0，則不顯示
      if (isOtherStore && total === 0) {
        return;
      }

      current.push({
        source_store_id: row.store_id,
        source_store_code: storeInfo?.store_code || '',
        source_store_name: storeInfo?.store_name || '',
        is_other_store: isOtherStore,
        total,
        group_bonus: Number(row.group_bonus) || 0,
        hr_subsidy_bonus: Number(row.hr_subsidy_bonus) || 0,
        single_item_bonus: Number(row.single_item_bonus) || 0,
        inventory_diff_penalty: Number(row.inventory_diff_penalty) || 0,
        talent_bonus: Number(row.talent_bonus) || 0,
        transport_fee: Number(row.transport_fee) || 0,
        inventory_bonus: Number(row.inventory_bonus) || 0,
        rx_incentive_bonus: Number(row.rx_incentive_bonus) || 0,
        quarterly_makeup_bonus: Number(row.quarterly_makeup_bonus) || 0,
        meal_allowance: Number(row.meal_allowance) || 0,
        spring_festival_bonus: Number(row.spring_festival_bonus) || 0,
        pharmacist_guarantee: Number(row.pharmacist_guarantee) || 0,
        owner_rx_makeup: Number(row.owner_rx_makeup) || 0,
        sales_competition_bonus: Number(row.sales_competition_bonus) || 0,
        owner_signing_bonus: Number(row.owner_signing_bonus) || 0,
        long_term_care_bonus: Number(row.long_term_care_bonus) || 0,
      });

      grouped.set(row.employee_code, current);
    });

    const data = (staffList || []).map((staff: any) => {
      const entries = grouped.get(staff.employee_code) || [];
      return {
        employee_code: staff.employee_code,
        employee_name: staff.employee_name,
        position: staff.position || '',
        entries,
        total: entries.reduce((sum: number, e: any) => sum + (e.total || 0), 0),
      };
    })
    .sort((a: any, b: any) => {
      const rankA = getPositionRank(a.position);
      const rankB = getPositionRank(b.position);
      if (rankA !== rankB) return rankA - rankB;
      return String(a.employee_code || '').localeCompare(String(b.employee_code || ''), 'zh-Hant', { numeric: true, sensitivity: 'base' });
    });

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
