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

type BonusField = (typeof BONUS_FIELDS)[number];

function getQuarterInfo(yearMonth: string): { year: number; quarter: number; months: string[] } | null {
  const m = yearMonth.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;

  const quarter = Math.ceil(month / 3);
  const startMonth = (quarter - 1) * 3 + 1;
  const months = [0, 1, 2].map(offset => `${year}-${String(startMonth + offset).padStart(2, '0')}`);

  return { year, quarter, months };
}

function createZeroTotals(): Record<BonusField, number> {
  const totals = {} as Record<BonusField, number>;
  BONUS_FIELDS.forEach(field => {
    totals[field] = 0;
  });
  return totals;
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

    const quarterInfo = getQuarterInfo(yearMonth);
    if (!quarterInfo) {
      return NextResponse.json({ success: false, error: '年月格式錯誤，需為 YYYY-MM' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: staffRows, error: staffError } = await admin
      .from('monthly_staff_status')
      .select('employee_code, employee_name')
      .in('year_month', quarterInfo.months)
      .eq('store_id', storeId);

    if (staffError) {
      return NextResponse.json({ success: false, error: staffError.message }, { status: 500 });
    }

    const staffMap = new Map<string, { employee_code: string; employee_name: string }>();
    (staffRows || []).forEach((row: any) => {
      const code = String(row.employee_code || '').trim();
      if (!code) return;
      const name = String(row.employee_name || '').trim();
      if (!staffMap.has(code)) {
        staffMap.set(code, { employee_code: code, employee_name: name });
        return;
      }
      const current = staffMap.get(code)!;
      if (!current.employee_name && name) {
        staffMap.set(code, { employee_code: code, employee_name: name });
      }
    });

    const employeeCodes = Array.from(staffMap.keys());
    const totals = createZeroTotals();

    if (employeeCodes.length === 0) {
      return NextResponse.json({
        success: true,
        quarter_label: `${quarterInfo.year}-Q${quarterInfo.quarter}`,
        months: quarterInfo.months,
        totals,
        employees: [],
        grand_total: 0,
      });
    }

    const employeeTotalsMap = new Map<string, Record<BonusField, number>>();
    employeeCodes.forEach(code => {
      employeeTotalsMap.set(code, createZeroTotals());
    });

    const { data: bonusRows, error: bonusError } = await admin
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
        long_term_care_bonus
      `)
      .in('year_month', quarterInfo.months)
      .in('employee_code', employeeCodes);

    if (bonusError) {
      return NextResponse.json({ success: false, error: bonusError.message }, { status: 500 });
    }

    (bonusRows || []).forEach((row: any) => {
      const employeeCode = String(row.employee_code || '').trim();
      const employeeTotals = employeeTotalsMap.get(employeeCode);
      if (!employeeTotals) return;

      const rowTotal = BONUS_FIELDS.reduce((sum, field) => sum + (Number(row[field]) || 0), 0);
      const isOtherStore = row.store_id !== storeId;

      if (isOtherStore && rowTotal === 0) {
        return;
      }

      BONUS_FIELDS.forEach(field => {
        const value = Number(row[field]) || 0;
        totals[field] += value;
        employeeTotals[field] += value;
      });
    });

    const grandTotal = BONUS_FIELDS.reduce((sum, field) => sum + (totals[field] || 0), 0);

    const employees = employeeCodes
      .map(code => {
        const staff = staffMap.get(code)!;
        const bonusTotals = employeeTotalsMap.get(code) || createZeroTotals();
        const total = BONUS_FIELDS.reduce((sum, field) => sum + (bonusTotals[field] || 0), 0);
        return {
          employee_code: code,
          employee_name: staff.employee_name || '',
          totals: bonusTotals,
          total,
        };
      })
      .sort((a, b) => a.employee_code.localeCompare(b.employee_code, 'zh-Hant', { numeric: true, sensitivity: 'base' }));

    return NextResponse.json({
      success: true,
      quarter_label: `${quarterInfo.year}-Q${quarterInfo.quarter}`,
      months: quarterInfo.months,
      totals,
      employees,
      grand_total: grandTotal,
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
