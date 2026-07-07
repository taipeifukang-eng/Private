import { getCurrentUser } from '@/app/auth/actions';
import { getAssignments } from '@/app/actions';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { ClipboardList, ArrowRight, Activity, Cake, ArrowRightLeft, FileText, BellRing, UserPlus } from 'lucide-react';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

type MonthlyPharmacistRow = {
  employee_code: string;
  employee_name: string;
  store_name: string | null;
  store_id: string;
  year_month?: string;
  position?: string | null;
  is_pharmacist?: boolean | null;
};

type MovementRow = {
  employee_code: string;
  movement_type: string;
  movement_date: string;
  store_id?: string | null;
  employee_name?: string | null;
};

type ManagedStoreOnboardingRow = {
  employee_code: string;
  employee_name: string;
  movement_date: string;
  store_id: string | null;
  store_name: string | null;
  store_code: string | null;
  onboarding_is_pharmacist?: boolean | null;
};

type AnnualFeeRow = {
  employee_code: string;
  association_city: string | null;
  fee_year: number | null;
  fee_period_end: string | null;
  created_at: string;
};

type PersonalMonthlyBonusSummary = {
  year_month: string;
  group_bonus: number;
  hr_subsidy_bonus: number;
  single_item_bonus: number;
  inventory_diff_penalty: number;
  talent_bonus: number;
  transport_fee: number;
  inventory_bonus: number;
  rx_incentive_bonus: number;
  quarterly_makeup_bonus: number;
  meal_allowance: number;
  spring_festival_bonus: number;
  pharmacist_guarantee: number;
  owner_rx_makeup: number;
  sales_competition_bonus: number;
  owner_signing_bonus: number;
  long_term_care_bonus: number;
  manager_supervisor_quarterly_bonus: number;
  opening_abnormal_responsibility_amount: number;
  bonus_difference_adjustment: number;
  other_bonus: number;
  other_bonus_note: string | null;
  total: number;
};

const PERSONAL_BONUS_FIELDS: Array<{ key: Exclude<keyof PersonalMonthlyBonusSummary, 'year_month' | 'total' | 'other_bonus_note'>; label: string }> = [
  { key: 'group_bonus', label: '月團體獎金' },
  { key: 'hr_subsidy_bonus', label: '人時補助獎金' },
  { key: 'single_item_bonus', label: '上月單品獎金' },
  { key: 'inventory_diff_penalty', label: '盤差獎罰' },
  { key: 'talent_bonus', label: '育才獎金' },
  { key: 'transport_fee', label: '交通費用' },
  { key: 'inventory_bonus', label: '庫存獎金' },
  { key: 'rx_incentive_bonus', label: '處方箋獎勵' },
  { key: 'quarterly_makeup_bonus', label: '季度補差額' },
  { key: 'meal_allowance', label: '誤餐費' },
  { key: 'spring_festival_bonus', label: '春節出勤獎金' },
  { key: 'pharmacist_guarantee', label: '藥師底薪保障補貼' },
  { key: 'owner_rx_makeup', label: '店東處方箋補差額' },
  { key: 'sales_competition_bonus', label: '銷售競賽獎金' },
  { key: 'owner_signing_bonus', label: '店東簽約獎金' },
  { key: 'long_term_care_bonus', label: '長照獎金' },
  { key: 'manager_supervisor_quarterly_bonus', label: '經理.督導季獎金' },
  { key: 'opening_abnormal_responsibility_amount', label: '開店異常責任金額' },
  { key: 'bonus_difference_adjustment', label: '獎金差額調整' },
  { key: 'other_bonus', label: '其他獎金' },
];

function parseDateTs(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const t = new Date(`${dateStr}T00:00:00`).getTime();
  return Number.isNaN(t) ? null : t;
}

function getReminderStartTsForKeelung(latestPeriodEnd: string | null): number | null {
  const endTs = parseDateTs(latestPeriodEnd);
  if (!endTs) return null;
  const d = new Date(endTs);
  d.setDate(1);
  d.setMonth(d.getMonth() + 4);
  return d.getTime();
}

function getLicenseReminderStartTs(licenseRenewalDate: string | null): number | null {
  const renewalTs = parseDateTs(licenseRenewalDate);
  if (!renewalTs) return null;
  const d = new Date(renewalTs);
  // 新規則：只看年份不看月份，於「到期年前兩年的 1/1」起提醒
  const start = new Date(d.getFullYear() - 2, 0, 1);
  return start.getTime();
}

function parseYearMonthStartTs(yearMonth: string | null | undefined): number | null {
  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) return null;
  const t = new Date(`${yearMonth}-01T00:00:00`).getTime();
  return Number.isNaN(t) ? null : t;
}

function formatAmount(value: number): string {
  return Number(value || 0).toLocaleString('zh-TW');
}

export default async function HomePage() {
  const { user } = await getCurrentUser();

  // If not logged in, show landing page
  if (!user) {
    const supabase = createClient();
    const { count: storeCount } = await supabase
      .from('stores')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);

    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
        <div className="text-center px-4">
          {/* Logo */}
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-gradient-to-br from-slate-700 to-slate-800 rounded-2xl flex items-center justify-center border border-amber-500/30 shadow-2xl">
              <ClipboardList className="w-10 h-10 text-amber-400" />
            </div>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black text-white mb-3 tracking-wide">
            FK連鎖藥局菁英業務管理系統
          </h1>

          <div className="flex items-center justify-center gap-2 mb-8">
            <Activity className="w-4 h-4 text-amber-400 animate-pulse" />
            <p className="text-base sm:text-lg text-slate-400">
              {storeCount
                ? `正在同步 ${storeCount} 間門市的營運脈動...`
                : '正在同步門市營運脈動...'}
            </p>
          </div>

          <div className="flex flex-wrap gap-4 justify-center">
            <Link
              href="/login"
              className="px-8 py-3 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-900 rounded-xl hover:from-amber-400 hover:to-amber-500 transition-all font-bold shadow-lg tracking-wider"
            >
              登入
            </Link>
            <Link
              href="/register"
              className="px-8 py-3 bg-transparent text-white border-2 border-slate-500 rounded-xl hover:border-amber-500 hover:text-amber-400 transition-all font-semibold"
            >
              註冊帳號
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Get assignments for My Tasks section
  const assignmentsResult = await getAssignments();
  const allAssignments = assignmentsResult.success ? assignmentsResult.data : [];
  const myAssignments = allAssignments.filter(
    (assignment) => assignment.assigned_to === user.id
  );

  // ── 本月壽星 ──────────────────────────────────────────────
  const adminSupabase = createAdminClient();
  const currentMonth = new Date().getMonth() + 1; // 1-12
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentRocYear = currentYear - 1911;
  const currentYearMonth = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
  const currentMonthEnd = new Date(currentYear, currentMonth, 0);
  const currentMonthEndTs = currentMonthEnd.getTime();
  const jobTitle = user.profile?.job_title || '';
  const role = user.profile?.role || '';
  const employeeCode = String(user.profile?.employee_code || '').toUpperCase();
  const isSupervisor = jobTitle.includes('督導');
  const isStoreManager = ['店長', '代理店長'].includes(jobTitle) && !isSupervisor;
  const isManagerOrAdmin = role === 'admin' || (role === 'manager' && !isSupervisor && !isStoreManager);
  const isBusinessAdminSupervisor = jobTitle.includes('營業部行政主管') || jobTitle.includes('營業部行政助理主管');
  const isReminderManager = role === 'manager' && !isSupervisor && !isStoreManager;
  const canViewMonthlyStatusAll = await hasPermission(user.id, 'monthly.status.view_all');
  const canViewAnnualFeeReminder =
    isManagerOrAdmin ||
    isBusinessAdminSupervisor ||
    isSupervisor ||
    isStoreManager;
  const canViewLicenseRenewalReminder =
    isManagerOrAdmin ||
    isSupervisor ||
    isBusinessAdminSupervisor;
  const canViewOwnBonusOnHome = await hasPermission(user.id, 'home.bonus_detail.view_own');
  let managedStoreOnboardings: ManagedStoreOnboardingRow[] = [];
  let ownMonthlyBonusSummaries: PersonalMonthlyBonusSummary[] = [];

  if (canViewOwnBonusOnHome && employeeCode) {
    const { data: bonusRows } = await adminSupabase
      .from('monthly_bonus_records')
      .select(`
        year_month,
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
        other_bonus,
        other_bonus_note
      `)
      .eq('employee_code', employeeCode)
      .order('year_month', { ascending: false })
      .limit(120);

    const monthMap = new Map<string, PersonalMonthlyBonusSummary>();
    (bonusRows || []).forEach((row: any) => {
      const ym = String(row.year_month || '');
      if (!ym) return;

      const current = monthMap.get(ym) || {
        year_month: ym,
        group_bonus: 0,
        hr_subsidy_bonus: 0,
        single_item_bonus: 0,
        inventory_diff_penalty: 0,
        talent_bonus: 0,
        transport_fee: 0,
        inventory_bonus: 0,
        rx_incentive_bonus: 0,
        quarterly_makeup_bonus: 0,
        meal_allowance: 0,
        spring_festival_bonus: 0,
        pharmacist_guarantee: 0,
        owner_rx_makeup: 0,
        sales_competition_bonus: 0,
        owner_signing_bonus: 0,
        long_term_care_bonus: 0,
        manager_supervisor_quarterly_bonus: 0,
        opening_abnormal_responsibility_amount: 0,
        bonus_difference_adjustment: 0,
        other_bonus: 0,
        other_bonus_note: null,
        total: 0,
      };

      PERSONAL_BONUS_FIELDS.forEach((field) => {
        current[field.key] += Number(row[field.key]) || 0;
      });

      const otherBonusNote = Number(row.other_bonus) !== 0 ? String(row.other_bonus_note || '').trim() : '';
      if (otherBonusNote) {
        const notes = current.other_bonus_note
          ? current.other_bonus_note.split('；').map((note) => note.trim()).filter(Boolean)
          : [];
        if (!notes.includes(otherBonusNote)) {
          current.other_bonus_note = [...notes, otherBonusNote].join('；');
        }
      }

      current.total = PERSONAL_BONUS_FIELDS.reduce((sum, field) => sum + (current[field.key] || 0), 0);
      monthMap.set(ym, current);
    });

    ownMonthlyBonusSummaries = Array.from(monthMap.values())
      .sort((a, b) => b.year_month.localeCompare(a.year_month))
      .filter((row) => PERSONAL_BONUS_FIELDS.some((field) => Number(row[field.key] || 0) !== 0))
      .slice(0, 12);
  }

  const { data: managedStoreRows } = await adminSupabase
    .from('store_managers')
    .select('store_id, stores(store_code, store_name)')
    .eq('user_id', user.id);

  const managedStoreIds = Array.from(
    new Set((managedStoreRows || []).map((row: any) => String(row.store_id || '')).filter(Boolean))
  );

  if (managedStoreIds.length > 0) {
    const { data: onboardingRows } = await adminSupabase
      .from('employee_movement_history')
      .select('employee_code, employee_name, movement_date, store_id, onboarding_is_pharmacist, stores(store_code, store_name)')
      .eq('movement_type', 'onboarding')
      .in('store_id', managedStoreIds)
      .gte('movement_date', `${currentYearMonth}-01`)
      .lte('movement_date', `${currentYearMonth}-${String(currentMonthEnd.getDate()).padStart(2, '0')}`)
      .order('movement_date', { ascending: true });

    const onboardingMap = new Map<string, ManagedStoreOnboardingRow>();
    (onboardingRows || []).forEach((row: any) => {
      const employeeCode = String(row.employee_code || '').toUpperCase();
      const employeeName = String(row.employee_name || '').trim();
      const storeId = row.store_id ? String(row.store_id) : null;
      const key = `${employeeCode}::${storeId || '-'}`;
      if (!employeeCode || !employeeName || onboardingMap.has(key)) return;

      onboardingMap.set(key, {
        employee_code: employeeCode,
        employee_name: employeeName,
        movement_date: String(row.movement_date || ''),
        store_id: storeId,
        store_code: row.stores?.store_code ? String(row.stores.store_code) : null,
        store_name: row.stores?.store_name ? String(row.stores.store_name) : null,
        onboarding_is_pharmacist: row.onboarding_is_pharmacist ?? null,
      });
    });

    managedStoreOnboardings = Array.from(onboardingMap.values()).sort((a, b) => {
      if (a.movement_date !== b.movement_date) {
        return a.movement_date.localeCompare(b.movement_date);
      }
      const storeCodeA = a.store_code || '';
      const storeCodeB = b.store_code || '';
      if (storeCodeA !== storeCodeB) {
        return storeCodeA.localeCompare(storeCodeB, 'zh-TW');
      }
      return a.employee_code.localeCompare(b.employee_code);
    });
  }

  let birthdayEmployees: { employee_code: string; employee_name: string; birthday: string }[] = [];

  if (isManagerOrAdmin) {
    // 經理/系統管理員 → 全部壽星
    const { data } = await adminSupabase
      .from('store_employees')
      .select('employee_code, employee_name, birthday')
      .eq('is_active', true)
      .not('birthday', 'is', null);
    
    birthdayEmployees = (data || []).filter(emp => {
      if (!emp.birthday) return false;
      const month = parseInt(emp.birthday.split('-')[1], 10);
      return month === currentMonth;
    });

  } else if (isSupervisor || isStoreManager) {
    // 督導/店長 → 先取得管轄門市 ID 清單
    const { data: managedStores } = await adminSupabase
      .from('store_managers')
      .select('store_id')
      .eq('user_id', user.id);

    const storeIds = (managedStores || []).map(s => s.store_id);

    if (storeIds.length > 0) {
      const { data } = await adminSupabase
        .from('store_employees')
        .select('employee_code, employee_name, birthday')
        .eq('is_active', true)
        .in('store_id', storeIds)
        .not('birthday', 'is', null);

      birthdayEmployees = (data || []).filter(emp => {
        if (!emp.birthday) return false;
        const month = parseInt(emp.birthday.split('-')[1], 10);
        return month === currentMonth;
      });
    }
  }

  // ── 常年會費未繳提醒 ───────────────────────────────────────
  // 規則：
  // 1) 一般縣市：每年 4 月起，若當年度無繳費記錄則提醒
  // 2) 基隆市：依上一期 fee_period_end 後第 4 個月開始提醒
  // 3) 若該員工於當月月底前已離職，則不提醒
  let annualFeeReminders: Array<{
    employee_code: string;
    employee_name: string;
    store_name: string | null;
    association_city: string;
    reason: string;
  }> = [];
  let licenseRenewalReminders: Array<{
    employee_code: string;
    employee_name: string;
    store_name: string | null;
    license_renewal_date: string;
    supervisor_zone: string;
    reason: string;
  }> = [];
  // 管理員/經理/營業部行政主管看分督導區；督導看平列
  const licenseReminderGroupByZone = isManagerOrAdmin || isBusinessAdminSupervisor;
  const annualFeeDebug = {
    currentYearMonth,
    currentMonth,
    role,
    jobTitle,
    canViewAnnualFeeReminder,
    isSupervisor,
    isStoreManager,
    isBusinessAdminSupervisor,
    isReminderManager,
    reminderStoreScope: 'all' as 'all' | 'scoped',
    reminderStoreCount: 0,
    storeEmpRawCount: 0,
    monthlyRawCount: 0,
    storeEmpActiveCount: 0,
    monthlySupplementCount: 0,
    afterStoreFilterCount: 0,
    masterPharmacistCount: 0,
    activePharmacistCount: 0,
    assignedStoreCount: 0,
    monthlyCurrentCount: 0,
    fallbackYearMonth: '' as string | null,
    monthlyFallbackCount: 0,
    monthlyFinalCount: 0,
    candidateCodesCount: 0,

    annualFeeRecordCount: 0,
    eligibleAfterResignFilterCount: 0,
    skippedByCurrentYearRecordCount: 0,
    skippedByMonthGateCount: 0,
    remindersCount: 0,
  };

  if (canViewAnnualFeeReminder || canViewLicenseRenewalReminder) {
    let reminderStoreIds: string[] | null = null;

    if (!isManagerOrAdmin && !isBusinessAdminSupervisor) {
      const { data: managedStores } = await adminSupabase
        .from('store_managers')
        .select('store_id')
        .eq('user_id', user.id);
      reminderStoreIds = (managedStores || []).map((s) => s.store_id);
      annualFeeDebug.reminderStoreScope = 'scoped';
      annualFeeDebug.reminderStoreCount = reminderStoreIds.length;
    }

    // 1) 藥師母體以 pharmacist_monthly_snapshot 為主（不依賴 monthly_staff_status）
    const { data: currentMonthSnapshotRaw } = await adminSupabase
      .from('pharmacist_monthly_snapshot')
      .select('employee_code, employee_name, store_id, year_month, is_active, stores(store_name)')
      .eq('year_month', currentYearMonth);

    let monthlyRaw: any[] = currentMonthSnapshotRaw || [];
    let fallbackYearMonth: string | null = null;

    if (monthlyRaw.length === 0) {
      const { data: latestMonthRow } = await adminSupabase
        .from('pharmacist_monthly_snapshot')
        .select('year_month')
        .lte('year_month', currentYearMonth)
        .order('year_month', { ascending: false })
        .limit(1)
        .maybeSingle();

      fallbackYearMonth = latestMonthRow?.year_month || null;

      if (fallbackYearMonth) {
        const { data: fallbackRows } = await adminSupabase
          .from('pharmacist_monthly_snapshot')
          .select('employee_code, employee_name, store_id, year_month, is_active, stores(store_name)')
          .eq('year_month', fallbackYearMonth);
        monthlyRaw = fallbackRows || [];
      }
    }

    annualFeeDebug.storeEmpRawCount = 0;
    annualFeeDebug.monthlyRawCount = monthlyRaw.length;
    annualFeeDebug.storeEmpActiveCount = 0;
    annualFeeDebug.monthlySupplementCount = 0;

    // 快照：每人只保留最新一期
    const monthlyPharmacistByCode = new Map<string, {
      employee_name: string;
      store_id: string;
      store_name: string | null;
      year_month: string;
      is_active: boolean;
    }>();
    (monthlyRaw || []).forEach((r: any) => {
      const code = String(r.employee_code || '').toUpperCase();
      if (!code || monthlyPharmacistByCode.has(code)) return;
      monthlyPharmacistByCode.set(code, {
        employee_name: String(r.employee_name || ''),
        store_id: String(r.store_id || ''),
        store_name: (r.stores?.store_name ? String(r.stores.store_name) : null),
        year_month: String(r.year_month || ''),
        is_active: r.is_active !== false,
      });
    });

    // 在職藥師清單先以快照判斷
    const activeCodes = Array.from(monthlyPharmacistByCode.entries())
      .filter(([, r]) => r.is_active)
      .map(([code]) => code);

    // 與藥師主檔一致：以異動紀錄覆蓋在職判斷（離職 >= 復職/到職）
    const { data: latestMovementsRaw } = activeCodes.length > 0
      ? await adminSupabase
          .from('employee_movement_history')
          .select('employee_code, movement_type, movement_date')
          .in('employee_code', activeCodes)
          .in('movement_type', ['resignation', 'onboarding', 'return_to_work'])
          .order('movement_date', { ascending: false })
      : { data: [] as any[] };

    const latestResignationByCode = new Map<string, string>();
    const latestReactivationByCode = new Map<string, string>();
    (latestMovementsRaw || []).forEach((m: any) => {
      const code = String(m.employee_code || '').toUpperCase();
      const type = String(m.movement_type || '');
      const date = String(m.movement_date || '');
      if (!code || !date) return;

      if (type === 'resignation' && !latestResignationByCode.has(code)) {
        latestResignationByCode.set(code, date);
      }
      if ((type === 'onboarding' || type === 'return_to_work') && !latestReactivationByCode.has(code)) {
        latestReactivationByCode.set(code, date);
      }
    });

    const finalActiveCodes = activeCodes.filter((code) => {
      const resignationDate = latestResignationByCode.get(code) || null;
      const reactivationDate = latestReactivationByCode.get(code) || null;
      return !(resignationDate && (!reactivationDate || resignationDate >= reactivationDate));
    });

    annualFeeDebug.masterPharmacistCount = monthlyPharmacistByCode.size;
    annualFeeDebug.activePharmacistCount = finalActiveCodes.length;

    // 2) 門市歸屬：使用快照最近一期所在門市（可視範圍判斷依據）
    const assignedStoreByCode = new Map<string, { store_id: string | null; store_name: string | null; employee_name: string }>();
    finalActiveCodes.forEach((code) => {
      const monthly = monthlyPharmacistByCode.get(code);

      assignedStoreByCode.set(code, {
        store_id: monthly?.store_id || null,
        store_name: monthly?.store_name || null,
        employee_name: monthly?.employee_name || '',
      });
    });
    annualFeeDebug.assignedStoreCount = assignedStoreByCode.size;

    const filteredCodes = finalActiveCodes.filter((code) => {
      if (!reminderStoreIds) return true;
      const assigned = assignedStoreByCode.get(code);
      return Boolean(assigned?.store_id && reminderStoreIds.includes(assigned.store_id));
    });
    annualFeeDebug.afterStoreFilterCount = filteredCodes.length;

    annualFeeDebug.monthlyCurrentCount = monthlyPharmacistByCode.size;
    annualFeeDebug.fallbackYearMonth = fallbackYearMonth;
    annualFeeDebug.monthlyFallbackCount = fallbackYearMonth ? monthlyRaw.length : 0;

    // 補查缺少 store_name 的門市名稱
    const missingStoreNameIds = Array.from(new Set(
      filteredCodes
        .map((code) => assignedStoreByCode.get(code))
        .filter((a) => a?.store_id && !a.store_name)
        .map((a) => String(a!.store_id))
    ));

    const { data: missingStoresRaw } = missingStoreNameIds.length > 0
      ? await adminSupabase
          .from('stores')
          .select('id, store_name')
          .in('id', missingStoreNameIds)
      : { data: [] as any[] };

    const missingStoreNameById = new Map<string, string>();
    (missingStoresRaw || []).forEach((s: any) => {
      if (s.id) missingStoreNameById.set(String(s.id), String(s.store_name || ''));
    });

    const candidateByCode = new Map<string, MonthlyPharmacistRow>();
    filteredCodes.forEach((code) => {
      const assigned = assignedStoreByCode.get(code);
      candidateByCode.set(code, {
        employee_code: code,
        employee_name: assigned?.employee_name || '',
        store_id: assigned?.store_id || '',
        store_name: assigned?.store_name || (assigned?.store_id ? missingStoreNameById.get(assigned.store_id) || null : null),
      });
    });

    const candidateCodes = Array.from(candidateByCode.keys());
    annualFeeDebug.monthlyFinalCount = candidateByCode.size;
    annualFeeDebug.candidateCodesCount = candidateCodes.length;

    if (candidateCodes.length > 0) {
      if (canViewAnnualFeeReminder) {
        const { data: annualFeeRaw } = await adminSupabase
            .from('pharmacist_annual_fees')
            .select('employee_code, association_city, fee_year, fee_period_end, created_at')
            .in('employee_code', candidateCodes)
            .order('created_at', { ascending: false });

        const annualFees = (annualFeeRaw || []) as AnnualFeeRow[];
        annualFeeDebug.annualFeeRecordCount = annualFees.length;

        const annualFeesByCode = new Map<string, AnnualFeeRow[]>();
        annualFees.forEach((row) => {
          const code = String(row.employee_code || '').toUpperCase();
          if (!code) return;
          if (!annualFeesByCode.has(code)) annualFeesByCode.set(code, []);
          annualFeesByCode.get(code)!.push(row);
        });

        annualFeeDebug.eligibleAfterResignFilterCount = candidateCodes.length;

        annualFeeReminders = candidateCodes
          .map((code) => {
            const emp = candidateByCode.get(code)!;
            const records = annualFeesByCode.get(code) || [];
            const latestRecord = records[0] || null;
            const city = latestRecord?.association_city || '未設定';

            if (city === '基隆市') {
              const latestEnd = records.find((r) => r.fee_period_end)?.fee_period_end || null;
              const reminderStartTs = getReminderStartTsForKeelung(latestEnd);
              const shouldRemind = reminderStartTs ? now.getTime() >= reminderStartTs : currentMonth >= 4;
              if (!shouldRemind) return null;

              const reason = latestEnd
                ? `基隆規則：上一期結束後第4個月起提醒（上一期至 ${latestEnd.slice(0, 10)}）`
                : '基隆規則：尚無上一期結束日，暫以 4 月起提醒';

              return {
                employee_code: code,
                employee_name: emp.employee_name,
                store_name: emp.store_name,
                association_city: city,
                reason,
              };
            }

            const hasCurrentYearRecord = records.some((r) => r.fee_year === currentYear || r.fee_year === currentRocYear);
            if (hasCurrentYearRecord) {
              annualFeeDebug.skippedByCurrentYearRecordCount += 1;
              return null;
            }
            if (currentMonth < 4) {
              annualFeeDebug.skippedByMonthGateCount += 1;
              return null;
            }

            return {
              employee_code: code,
              employee_name: emp.employee_name,
              store_name: emp.store_name,
              association_city: city,
              reason: `${currentRocYear} 年（民國）尚無常年會費申請記錄`,
            };
          })
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
          .sort((a, b) => a.employee_code.localeCompare(b.employee_code));

        annualFeeDebug.remindersCount = annualFeeReminders.length;
      }

      if (canViewLicenseRenewalReminder) {
        // 需要分組時，先建立 storeId → 督導區名稱 map
        const zoneByStoreId = new Map<string, string>();
        if (licenseReminderGroupByZone) {
          const { data: supervisorAssignments } = await adminSupabase
            .from('store_managers')
            .select('store_id, user_id, is_primary, role_type, created_at')
            .eq('role_type', 'supervisor');

          const supervisorUserIds = Array.from(
            new Set((supervisorAssignments || []).map((r: any) => String(r.user_id || '')).filter(Boolean))
          );
          const { data: supervisorProfilesRaw } = supervisorUserIds.length > 0
            ? await adminSupabase
                .from('profiles')
                .select('id, full_name, employee_code, job_title')
                .in('id', supervisorUserIds)
            : { data: [] as any[] };

          const profileByUserId = new Map<string, any>();
          (supervisorProfilesRaw || []).forEach((p: any) => {
            if (p.id) profileByUserId.set(String(p.id), p);
          });

          const storeToSupervisors = new Map<string, any[]>();
          (supervisorAssignments || []).forEach((row: any) => {
            const profile = profileByUserId.get(String(row.user_id || ''));
            if (!profile?.job_title?.includes('督導')) return;
            const sid = String(row.store_id || '');
            if (!sid) return;
            const list = storeToSupervisors.get(sid) || [];
            list.push(row);
            storeToSupervisors.set(sid, list);
          });

          storeToSupervisors.forEach((list, storeId) => {
            const primaryCandidates = list.filter((r: any) => r.is_primary === true);
            const candidates = primaryCandidates.length > 0 ? primaryCandidates : list;
            const picked = [...candidates].sort((a: any, b: any) => {
              const aTime = Date.parse(a.created_at || '1970-01-01T00:00:00Z');
              const bTime = Date.parse(b.created_at || '1970-01-01T00:00:00Z');
              if (aTime !== bTime) return aTime - bTime;
              const aCode = profileByUserId.get(String(a.user_id || ''))?.employee_code || '';
              const bCode = profileByUserId.get(String(b.user_id || ''))?.employee_code || '';
              return aCode.localeCompare(bCode);
            })[0];
            const userInfo = profileByUserId.get(String(picked?.user_id || ''));
            const zoneLabel = userInfo?.full_name
              ? `${userInfo.full_name}${userInfo.employee_code ? ` (${userInfo.employee_code})` : ''}`
              : '未指派督導區';
            zoneByStoreId.set(storeId, zoneLabel);
          });
        }

        const { data: licenseProfilesRaw } = await adminSupabase
          .from('pharmacist_profiles')
          .select('employee_code, license_renewal_date')
          .in('employee_code', candidateCodes)
          .not('license_renewal_date', 'is', null);

        licenseRenewalReminders = (licenseProfilesRaw || [])
          .map((p: any) => {
            const code = String(p.employee_code || '').toUpperCase();
            if (!code) return null;

            const reminderStartTs = getLicenseReminderStartTs(p.license_renewal_date || null);
            if (!reminderStartTs || now.getTime() < reminderStartTs) return null;

            const emp = candidateByCode.get(code);
            if (!emp) return null;

            const renewalDate = String(p.license_renewal_date || '').slice(0, 10);
            if (!renewalDate) return null;

            return {
              employee_code: code,
              employee_name: emp.employee_name,
              store_name: emp.store_name,
              license_renewal_date: renewalDate,
              supervisor_zone: zoneByStoreId.get(String(emp.store_id || '')) || '未指派督導區',
              reason: `執照更新日 ${renewalDate.replace(/-/g, '/')}，已進入到期前 2 年提醒區間`,
            };
          })
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
          .sort((a, b) => {
            if (licenseReminderGroupByZone) {
              if (a.supervisor_zone !== b.supervisor_zone)
                return a.supervisor_zone.localeCompare(b.supervisor_zone, 'zh-TW');
            }
            if (a.license_renewal_date !== b.license_renewal_date) {
              return a.license_renewal_date.localeCompare(b.license_renewal_date);
            }
            return a.employee_code.localeCompare(b.employee_code);
          });
      }
    }
  }
  // ─────────────────────────────────────────────────────────

  // ── 調店登記確認快捷（有確認權限者） ────────────────────
  const canCreateTransfer = role === 'admin' || await hasPermission(user.id, 'employee.store_transfer.create');
  const canConfirmTransfer = role === 'admin' || await hasPermission(user.id, 'employee.store_transfer.confirm');
  let pendingTransferCount = 0;
  if (canConfirmTransfer) {
    // 與 /api/store-transfer-requests 一致：
    // 1) admin 或具建立權限者看全部 pending
    // 2) 僅有確認權限（督導角色）只看自己管轄門市相關申請
    if (role !== 'admin' && canConfirmTransfer && !canCreateTransfer) {
      const { data: managed } = await adminSupabase
        .from('store_managers')
        .select('store_id')
        .eq('user_id', user.id);

      const managedStoreIds = Array.from(
        new Set((managed || []).map((m: any) => String(m.store_id || '')).filter(Boolean))
      );

      if (managedStoreIds.length === 0) {
        pendingTransferCount = 0;
      } else {
        const storeFilter = managedStoreIds.join(',');
        const { count } = await adminSupabase
          .from('store_transfer_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .or(`from_store_id.in.(${storeFilter}),to_store_id.in.(${storeFilter})`);
        pendingTransferCount = count ?? 0;
      }
    } else {
      const { count } = await adminSupabase
        .from('store_transfer_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      pendingTransferCount = count ?? 0;
    }
  }
  // ─────────────────────────────────────────────────────────

  // 去重（同員編可能多筆） + 依月/日排序
  const uniqueBirthdays = Object.values(
    birthdayEmployees.reduce((acc, emp) => {
      if (!acc[emp.employee_code]) acc[emp.employee_code] = emp;
      return acc;
    }, {} as Record<string, typeof birthdayEmployees[0]>)
  ).sort((a, b) => {
    const [, am, ad] = a.birthday.split('-').map(Number);
    const [, bm, bd] = b.birthday.split('-').map(Number);
    return am !== bm ? am - bm : ad - bd;
  });
  // ─────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 px-3 py-4 sm:px-4 sm:py-6 lg:p-8">
      <div className="w-full max-w-7xl mx-auto">
        {/* Welcome Header */}
        <div className="mb-4 sm:mb-6 lg:mb-8">
          <h1 className="text-xl sm:text-2xl lg:text-4xl font-bold text-gray-900 mb-2 break-words leading-tight">
            歡迎回來, {user.profile?.full_name || user.email}
          </h1>
          <p className="text-xs sm:text-sm lg:text-base text-gray-600 break-words leading-relaxed">
            {user.profile?.role === 'admin' && '您是系統管理員，擁有完整的系統控制權限'}
            {user.profile?.role === 'manager' && '您是專案經理，可以管理流程和指派任務'}
            {user.profile?.role === 'member' && '查看並執行指派給您的任務'}
          </p>
        </div>

        {/* 調店登記確認 快捷入口（督導 / 管理員） */}
        {canConfirmTransfer && pendingTransferCount > 0 && (
          <div className="mb-4 sm:mb-5">
            <Link
              href="/admin/promotion-management?tab=transfer_requests"
              className="group flex items-center justify-between p-4 sm:p-5 bg-gradient-to-r from-orange-500 to-amber-500 rounded-2xl shadow-lg hover:from-orange-600 hover:to-amber-600 active:scale-[0.98] transition-all duration-150"
            >
              <div className="flex items-center gap-3 sm:gap-4">
                {/* Icon */}
                <div className="w-12 h-12 sm:w-14 sm:h-14 bg-white/25 rounded-xl flex items-center justify-center flex-shrink-0">
                  <ArrowRightLeft className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
                </div>
                {/* Text */}
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-base sm:text-lg font-bold text-white tracking-wide">調店登記確認</span>
                    <span className="bg-white text-orange-600 text-xs font-extrabold px-2 py-0.5 rounded-full shadow-sm animate-pulse">
                      {pendingTransferCount} 待確認
                    </span>
                  </div>
                  <p className="text-orange-100 text-xs sm:text-sm mt-0.5">
                    {`有 ${pendingTransferCount} 筆調店申請待審核`}
                  </p>
                </div>
              </div>
              {/* Arrow */}
              <ArrowRight className="w-5 h-5 sm:w-6 sm:h-6 text-white/80 flex-shrink-0 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        )}

        <div className="mb-4 sm:mb-5">
          <Link
            href="/monthly-release"
            className="group flex items-center justify-between rounded-2xl border border-amber-200 bg-white p-4 shadow-sm transition-all duration-150 hover:border-amber-300 hover:bg-amber-50/60 hover:shadow-md active:scale-[0.98] sm:p-5"
          >
            <div className="flex items-center gap-3 sm:gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-700 sm:h-14 sm:w-14">
                <FileText className="h-6 w-6 sm:h-7 sm:w-7" />
              </div>
              <div>
                <div className="text-base font-bold tracking-wide text-gray-900 sm:text-lg">每月版更內容</div>
                <p className="mt-0.5 text-xs text-gray-600 sm:text-sm">查看本月系統調整內容與實際使用影響</p>
              </div>
            </div>
            <ArrowRight className="h-5 w-5 flex-shrink-0 text-amber-600 transition-transform group-hover:translate-x-1 sm:h-6 sm:w-6" />
          </Link>
        </div>

        {canViewOwnBonusOnHome && (
          <div className="mb-4 sm:mb-5">
            <div className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold tracking-wide text-gray-900 sm:text-lg">我的每月獎金明細</h2>
                    <p className="text-xs text-gray-500">員編：{employeeCode}</p>
                  </div>
                </div>
                <Link
                  href="/monthly-status"
                  className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 hover:bg-violet-100"
                >
                  前往月狀態
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>

              {ownMonthlyBonusSummaries.length === 0 ? (
                <p className="rounded-xl border border-dashed border-violet-200 bg-violet-50/50 px-3 py-4 text-center text-sm text-gray-500">
                  目前查無你的每月獎金資料
                </p>
              ) : (
                <div className="space-y-2">
                  {ownMonthlyBonusSummaries.map((row) => (
                    <details key={row.year_month} className="overflow-hidden rounded-xl border border-violet-100 bg-violet-50/40">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5">
                        <span className="text-sm font-semibold text-violet-800">{row.year_month.replace('-', '/')}</span>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-violet-700 shadow-sm">
                          合計 {formatAmount(row.total)}
                        </span>
                      </summary>
                      <div className="grid grid-cols-1 gap-x-4 gap-y-1 border-t border-violet-100 bg-white px-3 py-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
                        {PERSONAL_BONUS_FIELDS.filter((field) => Number(row[field.key] || 0) !== 0).map((field) => (
                          <div key={`${row.year_month}-${field.key}`} className="flex items-center justify-between gap-2 rounded-md bg-gray-50 px-2 py-1.5">
                            <span className="text-gray-600">{field.label}</span>
                            <span className="text-right font-semibold text-gray-900">
                              {formatAmount(row[field.key] as number)}
                              {field.key === 'other_bonus' && row.other_bonus_note ? (
                                <span className="mt-0.5 block max-w-[180px] text-[11px] font-normal leading-snug text-gray-500">
                                  {row.other_bonus_note}
                                </span>
                              ) : null}
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {managedStoreOnboardings.length > 0 && (
          <div className="mb-4 sm:mb-5">
            <div className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-start gap-3 sm:gap-4">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 sm:h-14 sm:w-14">
                  <UserPlus className="h-6 w-6 sm:h-7 sm:w-7" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-bold tracking-wide text-gray-900 sm:text-lg">本月新人入職公告</h2>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      {managedStoreOnboardings.length} 人
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-600 sm:text-sm">
                    以下為你目前管理門市於 {currentYearMonth.replace('-', '/')} 已登記的人員入職紀錄。
                  </p>

                  <div className="mt-4 overflow-hidden rounded-xl border border-emerald-100">
                    <div className="grid grid-cols-4 gap-2 bg-emerald-50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-emerald-700">
                      <span>到職日</span>
                      <span>門市</span>
                      <span>姓名</span>
                      <span>身分</span>
                    </div>
                    <div className="divide-y divide-emerald-100 bg-white">
                      {managedStoreOnboardings.map((row) => (
                        <div
                          key={`${row.employee_code}-${row.store_id || 'unknown'}-${row.movement_date}`}
                          className="grid grid-cols-4 gap-2 px-3 py-2 text-xs transition-colors hover:bg-emerald-50/50 sm:text-sm"
                        >
                          <span className="font-medium text-emerald-700">{row.movement_date.replace(/-/g, '/')}</span>
                          <span className="truncate text-gray-600">{row.store_code ? `${row.store_code} - ${row.store_name || '-'}` : (row.store_name || '-')}</span>
                          <span className="truncate text-gray-900">
                            {row.employee_name}
                            <span className="ml-2 font-mono text-gray-400">{row.employee_code}</span>
                          </span>
                          <span className="text-gray-600">{row.onboarding_is_pharmacist ? '藥師' : '一般人員'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Cards Row */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-6 items-start">

          {/* My Tasks Section */}
          <div className="bg-white rounded-lg shadow-lg p-3 sm:p-4 lg:p-6 w-full">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h2 className="text-base sm:text-xl lg:text-2xl font-bold text-gray-900">我的任務</h2>
              <Link
                href="/my-tasks"
                className="text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 text-xs sm:text-sm whitespace-nowrap"
              >
                查看全部
                <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4" />
              </Link>
            </div>

            {myAssignments.length === 0 ? (
              <p className="text-gray-500 text-center py-6 sm:py-8 text-xs sm:text-sm">目前沒有指派的任務</p>
            ) : (
              <div className="space-y-2 sm:space-y-3">
                {myAssignments.slice(0, 3).map((assignment) => (
                  <Link
                    key={assignment.id}
                    href={`/assignment/${assignment.id}`}
                    className="block p-2 sm:p-3 lg:p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 mb-1 text-xs sm:text-sm lg:text-base break-words leading-tight">
                          {assignment.template?.title || '未知專案'}
                        </h3>
                        <p className="text-[10px] sm:text-xs lg:text-sm text-gray-500 break-words">
                          狀態: {assignment.status === 'pending' && '待處理'}
                          {assignment.status === 'in_progress' && '進行中'}
                          {assignment.status === 'completed' && '已完成'}
                        </p>
                      </div>
                      <ArrowRight className="text-gray-400 flex-shrink-0 w-4 h-4 sm:w-5 sm:h-5" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* 本月壽星 Section */}
          {(isManagerOrAdmin || isSupervisor || isStoreManager) && (
            <div className="bg-white rounded-lg shadow-lg p-3 sm:p-4 lg:p-6 w-full">
              <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <Cake className="w-5 h-5 text-pink-500 flex-shrink-0" />
                <h2 className="text-base sm:text-xl lg:text-2xl font-bold text-gray-900">
                  本月壽星
                  <span className="ml-2 text-sm font-normal text-gray-400">({currentMonth}月)</span>
                </h2>
              </div>

              {uniqueBirthdays.length === 0 ? (
                <p className="text-gray-500 text-center py-6 sm:py-8 text-xs sm:text-sm">本月沒有壽星</p>
              ) : (
                <div className="overflow-hidden">
                  {/* Header */}
                  <div className="grid grid-cols-3 gap-2 px-3 py-2 bg-gray-50 rounded-t-lg border border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    <span>員編</span>
                    <span>姓名</span>
                    <span>日期</span>
                  </div>
                  {/* Rows */}
                  <div className="border border-t-0 border-gray-200 rounded-b-lg divide-y divide-gray-100 max-h-72 overflow-y-auto">
                    {uniqueBirthdays.map((emp) => {
                      const [, mm, dd] = emp.birthday.split('-');
                      return (
                        <div
                          key={emp.employee_code}
                          className="grid grid-cols-3 gap-2 px-3 py-2 text-xs sm:text-sm hover:bg-pink-50 transition-colors"
                        >
                          <span className="text-gray-600 font-mono">{emp.employee_code}</span>
                          <span className="text-gray-900 font-medium truncate">{emp.employee_name}</span>
                          <span className="text-pink-600 font-semibold">{parseInt(mm, 10)}/{parseInt(dd, 10)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-right text-xs text-gray-400 mt-2">共 {uniqueBirthdays.length} 人</p>
                </div>
              )}
            </div>
          )}

          {/* 常年會費未繳提醒 Card */}
          {canViewAnnualFeeReminder && annualFeeReminders.length > 0 && (
            <div className="bg-white rounded-lg shadow-lg p-3 sm:p-4 lg:p-6 w-full border border-amber-200">
              <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <BellRing className="w-5 h-5 text-amber-500 flex-shrink-0" />
                <h2 className="text-base sm:text-xl lg:text-2xl font-bold text-gray-900">
                  常年會費未繳提醒
                  <span className="ml-2 text-sm font-normal text-gray-400">({annualFeeReminders.length} 人)</span>
                </h2>
              </div>

              <div className="overflow-hidden">
                <div className="grid grid-cols-4 gap-2 px-3 py-2 bg-amber-50 rounded-t-lg border border-amber-200 text-xs font-semibold text-amber-700 uppercase tracking-wider">
                  <span>員編</span>
                  <span>姓名</span>
                  <span>公會</span>
                  <span>門市</span>
                </div>
                <div className="border border-t-0 border-amber-200 rounded-b-lg divide-y divide-amber-100 max-h-72 overflow-y-auto">
                  {annualFeeReminders.map((emp) => (
                    <div
                      key={emp.employee_code}
                      className="px-3 py-2 hover:bg-amber-50/60 transition-colors"
                    >
                      <div className="grid grid-cols-4 gap-2 text-xs sm:text-sm">
                        <span className="text-gray-600 font-mono">{emp.employee_code}</span>
                        <span className="text-gray-900 font-medium truncate">{emp.employee_name}</span>
                        <span className="text-amber-700 font-medium">{emp.association_city}</span>
                        <span className="text-gray-500 truncate">{emp.store_name || '-'}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-amber-700">{emp.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 執照更新日提醒 Card */}
          {canViewLicenseRenewalReminder && licenseRenewalReminders.length > 0 && (
            <div className="bg-white rounded-lg shadow-lg p-3 sm:p-4 lg:p-6 w-full border border-sky-200">
              <details className="group" open={false}>
                <summary className="flex items-center justify-between gap-2 mb-3 sm:mb-4 cursor-pointer list-none">
                  <div className="flex items-center gap-2">
                    <BellRing className="w-5 h-5 text-sky-500 flex-shrink-0" />
                    <h2 className="text-base sm:text-xl lg:text-2xl font-bold text-gray-900">
                      執照更新日提醒
                      <span className="ml-2 text-sm font-normal text-gray-400">({licenseRenewalReminders.length} 人)</span>
                    </h2>
                  </div>
                  <span className="text-sky-600 text-sm font-medium transition-transform group-open:rotate-180">▼</span>
                </summary>

                {licenseReminderGroupByZone ? (
                  // 分督導區顯示（管理員/經理/營業部行政主管）
                  <div className="space-y-4">
                    {(() => {
                      const zoneMap = new Map<string, typeof licenseRenewalReminders>();
                      licenseRenewalReminders.forEach((emp) => {
                        const zone = emp.supervisor_zone;
                        const list = zoneMap.get(zone) || [];
                        list.push(emp);
                        zoneMap.set(zone, list);
                      });
                      return Array.from(zoneMap.entries()).map(([zone, emps]) => (
                        <div key={zone} className="overflow-hidden">
                          <div className="px-3 py-2 bg-sky-100 text-xs font-semibold text-sky-800 rounded-t-lg border border-sky-200">
                            {zone} <span className="font-normal text-sky-600">（{emps.length} 人）</span>
                          </div>
                          <div className="grid grid-cols-4 gap-2 px-3 py-2 bg-sky-50 border-x border-sky-200 text-xs font-semibold text-sky-700 uppercase tracking-wider">
                            <span>員編</span>
                            <span>姓名</span>
                            <span>到期日</span>
                            <span>門市</span>
                          </div>
                          <div className="border border-t-0 border-sky-200 rounded-b-lg divide-y divide-sky-100 max-h-60 overflow-y-auto">
                            {emps.map((emp) => (
                              <div key={emp.employee_code} className="px-3 py-2 hover:bg-sky-50/60 transition-colors">
                                <div className="grid grid-cols-4 gap-2 text-xs sm:text-sm">
                                  <span className="text-gray-600 font-mono">{emp.employee_code}</span>
                                  <span className="text-gray-900 font-medium truncate">{emp.employee_name}</span>
                                  <span className="text-sky-700 font-medium">{emp.license_renewal_date.replace(/-/g, '/')}</span>
                                  <span className="text-gray-500 truncate">{emp.store_name || '-'}</span>
                                </div>
                                <p className="mt-1 text-[11px] text-sky-700">{emp.reason}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                ) : (
                  // 督導：平列顯示
                  <div className="overflow-hidden">
                    <div className="grid grid-cols-4 gap-2 px-3 py-2 bg-sky-50 rounded-t-lg border border-sky-200 text-xs font-semibold text-sky-700 uppercase tracking-wider">
                      <span>員編</span>
                      <span>姓名</span>
                      <span>到期日</span>
                      <span>門市</span>
                    </div>
                    <div className="border border-t-0 border-sky-200 rounded-b-lg divide-y divide-sky-100 max-h-72 overflow-y-auto">
                      {licenseRenewalReminders.map((emp) => (
                        <div key={emp.employee_code} className="px-3 py-2 hover:bg-sky-50/60 transition-colors">
                          <div className="grid grid-cols-4 gap-2 text-xs sm:text-sm">
                            <span className="text-gray-600 font-mono">{emp.employee_code}</span>
                            <span className="text-gray-900 font-medium truncate">{emp.employee_name}</span>
                            <span className="text-sky-700 font-medium">{emp.license_renewal_date.replace(/-/g, '/')}</span>
                            <span className="text-gray-500 truncate">{emp.store_name || '-'}</span>
                          </div>
                          <p className="mt-1 text-[11px] text-sky-700">{emp.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </details>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
