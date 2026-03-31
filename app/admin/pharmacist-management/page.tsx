import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';
import PharmacistSupervisorCards from './PharmacistSupervisorCards';
import PharmacistMasterList from './PharmacistMasterList';
import OverviewFilterForm from './OverviewFilterForm';
import SummaryCards from './SummaryCards';

export const dynamic = 'force-dynamic';

type PharmacistRow = {
  id: string;
  store_id: string;
  store_code: string;
  store_name: string;
  employee_code: string;
  employee_name: string;
  position: string;
  supervisor_zone: string;
  change_type: string;
  change_note: string;
  prev_store_name: string;
  prev_position: string;
};

type ScopedStore = {
  id: string;
  store_code: string;
  store_name: string;
};

function formatYearMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getPreviousYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return formatYearMonth(d);
}

function formatMovementDateYMD(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

export default async function PharmacistManagementPage({
  searchParams,
}: {
  searchParams?: { year_month?: string; zone?: string; debug?: string; tab?: string };
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const [canViewModule, canEditModule, canViewAllMonthly, canViewOwnMonthly] = await Promise.all([
    hasPermission(user.id, 'pharmacist.management.view'),
    hasPermission(user.id, 'pharmacist.management.edit'),
    hasPermission(user.id, 'monthly.status.view_all'),
    hasPermission(user.id, 'monthly.status.view_own'),
  ]);

  if (!canViewModule) {
    redirect('/dashboard');
  }

  const selectedYearMonth =
    searchParams?.year_month && /^\d{4}-\d{2}$/.test(searchParams.year_month)
      ? searchParams.year_month
      : formatYearMonth(new Date());
  const previousYearMonth = getPreviousYearMonth(selectedYearMonth);
  const selectedZone = (searchParams?.zone || 'all').trim();
  const isDebug = searchParams?.debug === '1';
  const activeTab = (searchParams?.tab === 'master') ? 'master' : 'overview';

  let storeIds: string[] = [];

  if (canEditModule || canViewAllMonthly) {
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('is_active', true);
    storeIds = (stores || []).map((s: any) => s.id);
  } else {
    const { data: managed } = await supabase
      .from('store_managers')
      .select('store_id')
      .eq('user_id', user.id);
    storeIds = Array.from(new Set((managed || []).map((m: any) => m.store_id).filter(Boolean)));
  }

  if (storeIds.length === 0 && activeTab === 'overview') {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-6xl rounded-xl border border-gray-200 bg-white p-6">
          <h1 className="text-2xl font-bold text-gray-900">藥師管理</h1>
          <p className="mt-3 text-gray-600">目前沒有可查看的門市範圍。</p>
          <Link href="/" className="mt-4 inline-block text-blue-600 hover:text-blue-800">返回首頁</Link>
        </div>
      </div>
    );
  }

  const { data: scopedStores } = await supabase
    .from('stores')
    .select('id, store_code, store_name')
    .in('id', storeIds);

  console.log('[DEBUG pharmacist] userId:', user.id);
  console.log('[DEBUG pharmacist] selectedYearMonth:', selectedYearMonth, '| previousYearMonth:', previousYearMonth);
  console.log('[DEBUG pharmacist] storeIds count:', storeIds.length, '| sample:', storeIds.slice(0, 10));

  const adminSupabase = createAdminClient();

  let canUseSnapshot = true;
  const { error: snapshotCheckError } = await adminSupabase
    .from('pharmacist_monthly_snapshot')
    .select('id', { head: true, count: 'exact' })
    .limit(1);
  if (snapshotCheckError) {
    canUseSnapshot = false;
  }

  // 查詢關帳月份
  const lockedMonthSet = new Set<string>();
  let lockedMonths: Array<{ year_month: string; locked_at: string; locked_by: string }> = [];
  try {
    const { data: locksRaw } = await adminSupabase
      .from('pharmacist_snapshot_locks')
      .select('year_month, locked_at, locked_by')
      .order('year_month', { ascending: true });
    (locksRaw || []).forEach((r: any) => {
      if (r.year_month) lockedMonthSet.add(String(r.year_month));
    });
    lockedMonths = (locksRaw || []).map((r: any) => ({
      year_month: String(r.year_month || ''),
      locked_at: String(r.locked_at || ''),
      locked_by: String(r.locked_by || ''),
    }));
  } catch {
    // 表尚未建立時靜默略過
  }
  const isSelectedMonthLocked = lockedMonthSet.has(selectedYearMonth);

  async function ensureSnapshotForMonth(targetYearMonth: string) {
    if (!canUseSnapshot) return;
    // 關帳保護：已關帳的月份不再自動異動
    if (lockedMonthSet.has(targetYearMonth)) return;
    const { data: pharmacistCandidatesRaw } = await adminSupabase
      .from('store_employees')
      .select('employee_code, is_pharmacist, current_position, position')
      .or('is_pharmacist.eq.true,current_position.ilike.%藥師%,position.ilike.%藥師%');

    const pharmacistCodeSet = new Set<string>();
    (pharmacistCandidatesRaw || []).forEach((r: any) => {
      const code = String(r.employee_code || '').toUpperCase();
      if (!code) return;
      pharmacistCodeSet.add(code);
    });

    // 清理本月已存在快照中的真正污染資料：onboarding/return_to_work for employees who don't exist in store_employees
    // (不再依賴 pharmacistCodeSet，改為檢查員工是否真實存在)
    const { data: existingMovementRows } = await adminSupabase
      .from('pharmacist_monthly_snapshot')
      .select('id, employee_code, notes, store_id')
      .eq('year_month', targetYearMonth)
      .eq('source', 'movement')
      .in('store_id', storeIds);

    // Get all valid pharmacist employees for these stores (is_pharmacist=true OR in pharmacistCodeSet)
    const { data: allStoreEmployees } = await adminSupabase
      .from('store_employees')
      .select('employee_code, is_pharmacist')
      .in('store_id', storeIds);

    const validPharmacistCodes = new Set<string>();
    (allStoreEmployees || []).forEach((r: any) => {
      const code = String(r.employee_code || '').toUpperCase();
      if (code && (r.is_pharmacist || pharmacistCodeSet.has(code))) validPharmacistCodes.add(code);
    });

    const invalidMovementIds = (existingMovementRows || [])
      .filter((r: any) => {
        const code = String(r.employee_code || '').toUpperCase();
        const note = String(r.notes || '').toLowerCase();
        const isOnboardingGenerated =
          note.includes('generated from movement')
          && (note.includes('onboarding') || note.includes('return_to_work'));
        // 刪除: 由 onboarding/return_to_work 生成，但員工不是藥師身分
        return isOnboardingGenerated && !validPharmacistCodes.has(code);
      })
      .map((r: any) => String(r.id))
      .filter(Boolean);

    if (invalidMovementIds.length > 0) {
      await adminSupabase
        .from('pharmacist_monthly_snapshot')
        .delete()
        .in('id', invalidMovementIds);
    }

    const { count } = await adminSupabase
      .from('pharmacist_monthly_snapshot')
      .select('id', { count: 'exact', head: true })
      .eq('year_month', targetYearMonth)
      .in('store_id', storeIds);

    // 如果快照已存在，跳過初始生成但仍需處理當月異動
    const skipInitialGeneration = (count || 0) > 0;

    const baseYearMonth = getPreviousYearMonth(targetYearMonth);
    const monthStart = `${targetYearMonth}-01`;
    const monthEndDate = new Date(Number(targetYearMonth.slice(0, 4)), Number(targetYearMonth.slice(5, 7)), 0);
    const monthEnd = `${targetYearMonth}-${String(monthEndDate.getDate()).padStart(2, '0')}`;

    // === 階段 1：初始快照生成（僅在快照不存在時）===
    let nextByCode = new Map<string, {
      year_month: string;
      store_id: string;
      employee_code: string;
      employee_name: string;
      position: string | null;
      is_active: boolean;
      source: 'movement';
      notes: string;
    }>();

    if (!skipInitialGeneration) {
      const { data: baseRows } = await adminSupabase
        .from('pharmacist_monthly_snapshot')
        .select('store_id, employee_code, employee_name, position, is_active')
        .eq('year_month', baseYearMonth)
        .in('store_id', storeIds);

      if (!baseRows || baseRows.length === 0) return;

      (baseRows || []).forEach((r: any) => {
        const code = String(r.employee_code || '').toUpperCase();
        if (!code || !r.store_id) return;
        nextByCode.set(code, {
          year_month: targetYearMonth,
          store_id: String(r.store_id),
          employee_code: code,
          employee_name: String(r.employee_name || ''),
          position: r.position || null,
          is_active: r.is_active === true,
          source: 'movement',
          notes: `generated from ${baseYearMonth}`,
        });
      });

      // 檢查前月異動中是否有本月生效的未反映狀態(如同月離職卻鎖定的情況)
      const prevMonthStart = `${baseYearMonth}-01`;
      const prevMonthEndDate = new Date(Number(baseYearMonth.slice(0, 4)), Number(baseYearMonth.slice(5, 7)), 0);
      const prevMonthEnd = `${baseYearMonth}-${String(prevMonthEndDate.getDate()).padStart(2, '0')}`;

      const { data: prevMonthResignations } = await adminSupabase
        .from('employee_movement_history')
        .select('employee_code')
        .eq('movement_type', 'resignation')
        .gte('movement_date', prevMonthStart)
        .lte('movement_date', prevMonthEnd);

      const prevMonthResignCodeSet = new Set<string>();
      (prevMonthResignations || []).forEach((m: any) => {
        const code = String(m.employee_code || '').toUpperCase();
        if (code) prevMonthResignCodeSet.add(code);
      });

      // 應用前月離職狀態於本月沿用者 (確保 is_active 一定設為 false，即使已是 false)
      Array.from(nextByCode.entries()).forEach(([code, row]) => {
        if (prevMonthResignCodeSet.has(code)) {
          row.is_active = false;
          row.notes = `${row.notes}; marked inactive due to prev-month resignation`.trim();
        }
      });
    } else {
      // 快照已存在時，從 DB 載入現有資料以便應用當月異動
      const { data: existing } = await adminSupabase
        .from('pharmacist_monthly_snapshot')
        .select('store_id, employee_code, employee_name, position, is_active, notes')
        .eq('year_month', targetYearMonth)
        .in('store_id', storeIds);

      (existing || []).forEach((r: any) => {
        const code = String(r.employee_code || '').toUpperCase();
        if (!code || !r.store_id) return;
        nextByCode.set(code, {
          year_month: targetYearMonth,
          store_id: String(r.store_id),
          employee_code: code,
          employee_name: String(r.employee_name || ''),
          position: r.position || null,
          is_active: r.is_active !== false,
          source: 'movement',
          notes: String(r.notes || ''),
        });
      });
    }

    // === 階段 2：應用當月異動（無條件執行，無論快照是否已存在）===
    const { data: monthlyMovements } = await adminSupabase
      .from('employee_movement_history')
      .select('employee_code, employee_name, store_id, movement_type, movement_date, new_value, onboarding_is_pharmacist')
      .in('movement_type', ['resignation', 'onboarding', 'return_to_work', 'store_transfer', 'promotion'])
      .gte('movement_date', monthStart)
      .lte('movement_date', monthEnd)
      .order('movement_date', { ascending: true });

    (monthlyMovements || []).forEach((m: any) => {
      const code = String(m.employee_code || '').toUpperCase();
      if (!code) return;
      const type = String(m.movement_type || '');
      const d = m.movement_date ? new Date(m.movement_date) : null;
      const mmdd = d ? `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}` : '';

      if (type === 'resignation') {
        // resignation 應該應用到任何在快照中的人，不限藥師身分
        const row = nextByCode.get(code);
        if (!row) return;
        row.is_active = false;
        row.notes = `${row.notes}; ${mmdd || ''} resignation`.trim();
        nextByCode.set(code, row);
        return;
      }

      if (type === 'onboarding' || type === 'return_to_work') {
        const storeId = m.store_id ? String(m.store_id) : '';
        if (!storeId) return;
        // onboarding 需 onboarding_is_pharmacist=true；return_to_work 需在藥師主檔
        if (type === 'onboarding' && !m.onboarding_is_pharmacist) return;
        if (type === 'return_to_work' && !pharmacistCodeSet.has(code)) return;
        const row = nextByCode.get(code);
        if (row) {
          row.is_active = true;
          row.employee_name = row.employee_name || String(m.employee_name || '');
          row.notes = `${row.notes}; ${mmdd || ''} ${type}`.trim();
          nextByCode.set(code, row);
        } else {
          nextByCode.set(code, {
            year_month: targetYearMonth,
            store_id: storeId,
            employee_code: code,
            employee_name: String(m.employee_name || ''),
            position: null,
            is_active: true,
            source: 'movement',
            notes: `generated from movement; ${mmdd || ''} ${type}`.trim(),
          });
        }
        return;
      }

      if (type === 'store_transfer') {
        // 規則：非切整月調店，當月維持原店，次月才生效
        const row = nextByCode.get(code);
        if (!row) return;
        row.notes = `${row.notes}; ${mmdd || ''} transfer (effective next month)`.trim();
        nextByCode.set(code, row);
        return;
      }

      if (type === 'promotion') {
        const row = nextByCode.get(code);
        if (!row) return;
        row.notes = `${row.notes}; ${mmdd || ''} promotion (effective next month)`.trim();
        const nextPosition = String(m.new_value || '').trim();
        if (nextPosition) row.position = nextPosition;
        nextByCode.set(code, row);
      }
    });

    const payload = Array.from(nextByCode.values());
    if (payload.length === 0) return;

    // 只有初始生成或有實際異動變更時才 upsert
    if (!skipInitialGeneration || Array.from(monthlyMovements || []).length > 0) {
      await adminSupabase
        .from('pharmacist_monthly_snapshot')
        .upsert(payload, { onConflict: 'year_month,store_id,employee_code' });
    }
  }

  let currentRowsRaw: any[] = [];
  let previousRowsRaw: any[] = [];

  if (canUseSnapshot) {
    // 已關帳月份走唯讀快路徑：不再重算或補寫快照
    if (!isSelectedMonthLocked) {
      // 先確保前一月存在，才能用「前一月 + 異動」生成本月
      await ensureSnapshotForMonth(previousYearMonth);
      await ensureSnapshotForMonth(selectedYearMonth);
    }

    const [currentQ, previousQ] = await Promise.all([
      adminSupabase
        .from('pharmacist_monthly_snapshot')
        .select('id, store_id, employee_code, employee_name, position, is_active, source, notes, stores(store_code, store_name)')
        .eq('year_month', selectedYearMonth)
        .in('store_id', storeIds),
      adminSupabase
        .from('pharmacist_monthly_snapshot')
        .select('store_id, employee_code, employee_name, position, is_active, source, notes, stores(store_code, store_name)')
        .eq('year_month', previousYearMonth)
        .in('store_id', storeIds),
    ]);

    currentRowsRaw = currentQ.data || [];
    previousRowsRaw = previousQ.data || [];
  }

  const currentRowsBase = currentRowsRaw || [];
  const previousRows = previousRowsRaw || [];
  let currentRows = currentRowsBase;

  // 已關帳月份：不做異動補丁、不做離職補抓，完全以快照為準
  const resignationByEmpCode = new Map<string, any>();
  const monthlyMovementByEmpCode = new Map<string, { movement_type: string; movement_date: string }>();
  const onboardingByEmpCode = new Map<string, string>();
  let supplementedResignedRows: any[] = [];

  if (!isSelectedMonthLocked) {
    // 補抓「該月份已登記人事異動=離職」的藥師，避免月報尚未寫入而漏掉
    const monthStart = `${selectedYearMonth}-01`;
    const monthEndDate = new Date(Number(selectedYearMonth.slice(0, 4)), Number(selectedYearMonth.slice(5, 7)), 0);
    const monthEnd = `${selectedYearMonth}-${String(monthEndDate.getDate()).padStart(2, '0')}`;

    const [
      { data: resignationMovements },
      { data: monthlyMovementNotesRaw },
      { data: onboardingMovementsRaw },
    ] = await Promise.all([
      adminSupabase
        .from('employee_movement_history')
        .select('employee_code, employee_name, store_id, movement_date, movement_type')
        .eq('movement_type', 'resignation')
        .in('store_id', storeIds)
        .gte('movement_date', monthStart)
        .lte('movement_date', monthEnd),
      adminSupabase
        .from('employee_movement_history')
        .select('employee_code, movement_type, movement_date')
        .in('store_id', storeIds)
        .in('movement_type', ['store_transfer', 'promotion'])
        .gte('movement_date', monthStart)
        .lte('movement_date', monthEnd)
        .order('movement_date', { ascending: false }),
      adminSupabase
        .from('employee_movement_history')
        .select('employee_code, movement_type, movement_date')
        .in('store_id', storeIds)
        .in('movement_type', ['onboarding', 'return_to_work'])
        .gte('movement_date', monthStart)
        .lte('movement_date', monthEnd)
        .order('movement_date', { ascending: false }),
    ]);

    const resignationCodes = Array.from(
      new Set((resignationMovements || []).map((m: any) => (m.employee_code || '').toUpperCase()).filter(Boolean))
    );

    const { data: resignedStoreEmployees } = resignationCodes.length > 0
      ? await adminSupabase
          .from('store_employees')
          .select('employee_code, store_id, is_pharmacist, current_position, position')
          .in('employee_code', resignationCodes)
          .in('store_id', storeIds)
      : { data: [] as any[] };

    const resignedEmpMap = new Map<string, any>();
    (resignedStoreEmployees || []).forEach((e: any) => {
      const key = `${String(e.store_id)}::${String(e.employee_code || '').toUpperCase()}`;
      resignedEmpMap.set(key, e);
    });

    const currentKeySet = new Set(
      currentRowsBase.map((r: any) => `${String(r.store_id)}::${String(r.employee_code || '').toUpperCase()}`)
    );

    const scopedStoreMap = new Map<string, { store_code: string; store_name: string }>();
    (scopedStores || []).forEach((s: any) => {
      scopedStoreMap.set(String(s.id), { store_code: s.store_code || '', store_name: s.store_name || '' });
    });

    supplementedResignedRows = (resignationMovements || []).flatMap((m: any) => {
      const storeId = String(m.store_id || '');
      const code = String(m.employee_code || '').toUpperCase();
      if (!storeId || !code) return [];

      const key = `${storeId}::${code}`;
      if (currentKeySet.has(key)) return [];

      const emp = resignedEmpMap.get(key);
      const isPharmacist = Boolean(emp?.is_pharmacist);
      if (!isPharmacist) return [];

      const storeInfo = scopedStoreMap.get(storeId) || { store_code: '', store_name: '' };
      return [{
        id: `resign-${storeId}-${code}-${m.movement_date}`,
        store_id: storeId,
        employee_code: code,
        employee_name: m.employee_name || '',
        position: emp?.current_position || emp?.position || '離職',
        is_supervisor_rotation: false,
        movement_type: 'resignation',
        movement_date: m.movement_date,
        stores: {
          store_code: storeInfo.store_code,
          store_name: storeInfo.store_name,
        },
      }];
    });

    const inactiveCodes = currentRowsBase
      .filter((r: any) => r.is_active === false)
      .map((r: any) => String(r.employee_code || '').toUpperCase());

    const allInactiveResignations = inactiveCodes.length > 0
      ? await adminSupabase
          .from('employee_movement_history')
          .select('employee_code, movement_date')
          .eq('movement_type', 'resignation')
          .in('employee_code', inactiveCodes)
          .gte('movement_date', monthStart)
          .lte('movement_date', monthEnd)
          .order('movement_date', { ascending: false })
      : { data: [] as any[] };

    const latestResignationByCode = new Map<string, string>();
    (allInactiveResignations.data || []).forEach((m: any) => {
      const code = String(m.employee_code || '').toUpperCase();
      if (code && !latestResignationByCode.has(code)) {
        latestResignationByCode.set(code, m.movement_date);
      }
    });

    const inactiveSnapshotRows = currentRowsBase
      .filter((r: any) => r.is_active === false)
      .filter((r: any) => {
        const code = String(r.employee_code || '').toUpperCase();
        return latestResignationByCode.has(code);
      })
      .map((r: any) => {
        const code = String(r.employee_code || '').toUpperCase();
        const resignDate = latestResignationByCode.get(code) || '';
        return {
          ...r,
          change_type: '離職',
          movement_type: 'resignation',
          movement_date: resignDate,
        };
      });

    const activeRows = currentRowsBase.filter((r: any) => r.is_active === true);
    const resignedRows = [...inactiveSnapshotRows, ...supplementedResignedRows];
    currentRows = [...activeRows, ...resignedRows];

    (resignationMovements || []).forEach((m: any) => {
      const code = String(m.employee_code || '').toUpperCase();
      if (code) resignationByEmpCode.set(code, m);
    });

    (monthlyMovementNotesRaw || []).forEach((m: any) => {
      const code = String(m.employee_code || '').toUpperCase();
      if (!code || monthlyMovementByEmpCode.has(code)) return;
      monthlyMovementByEmpCode.set(code, {
        movement_type: String(m.movement_type || ''),
        movement_date: String(m.movement_date || ''),
      });
    });

    (onboardingMovementsRaw || []).forEach((m: any) => {
      const code = String(m.employee_code || '').toUpperCase();
      const date = String(m.movement_date || '');
      if (!code || !date || onboardingByEmpCode.has(code)) return;
      onboardingByEmpCode.set(code, date);
    });
  }

  const { data: adminManagerAssignments, error: adminManagerAssignmentsError } = await adminSupabase
    .from('store_managers')
    .select('store_id, user_id, role_type, is_primary, created_at')
    .in('store_id', storeIds);

  let managerAssignments: any[] = [];
  let managerProfiles: any[] = [];
  let managerAssignmentsSource = 'admin';
  let managerAssignmentsErrorMessage = '';
  let managerProfilesErrorMessage = '';

  if (adminManagerAssignmentsError) {
    managerAssignmentsSource = 'regular-fallback';
    managerAssignmentsErrorMessage = adminManagerAssignmentsError.message;
    const { data: regularManagerAssignments, error: regularManagerAssignmentsError } = await supabase
      .from('store_managers')
      .select('store_id, user_id, role_type, is_primary, created_at')
      .in('store_id', storeIds);

    if (regularManagerAssignmentsError) {
      managerAssignmentsErrorMessage = `${managerAssignmentsErrorMessage} | fallback: ${regularManagerAssignmentsError.message}`;
    }
    managerAssignments = regularManagerAssignments || [];
  } else {
    managerAssignments = adminManagerAssignments || [];
  }

  const supervisorRows = (managerAssignments || []).filter((row: any) => row.role_type === 'supervisor');

  const managerUserIds = Array.from(
    new Set(supervisorRows.map((row: any) => row.user_id).filter(Boolean))
  );

  if (managerUserIds.length > 0) {
    const { data: adminProfiles, error: adminProfilesError } = await adminSupabase
      .from('profiles')
      .select('id, full_name, employee_code, job_title')
      .in('id', managerUserIds);

    if (adminProfilesError) {
      managerProfilesErrorMessage = adminProfilesError.message;
      const { data: regularProfiles, error: regularProfilesError } = await supabase
        .from('profiles')
        .select('id, full_name, employee_code, job_title')
        .in('id', managerUserIds);
      if (regularProfilesError) {
        managerProfilesErrorMessage = `${managerProfilesErrorMessage} | fallback: ${regularProfilesError.message}`;
      }
      managerProfiles = regularProfiles || [];
    } else {
      managerProfiles = adminProfiles || [];
    }
  }

  const profileByUserId = new Map<string, any>();
  (managerProfiles || []).forEach((p: any) => {
    profileByUserId.set(p.id, p);
  });

  const directSupervisorRows = supervisorRows.filter((row: any) => {
    const p = profileByUserId.get(row.user_id);
    return p?.job_title?.includes('督導') ?? false;
  });

  const nonDirectSupervisorRoleRows = supervisorRows.filter((row: any) => {
    const p = profileByUserId.get(row.user_id);
    return !(p?.job_title?.includes('督導') ?? false);
  });

  console.log('[DEBUG pharmacist] query result counts => currentRows:', (currentRows || []).length, 'previousRows:', (previousRows || []).length, 'managerAssignments:', (managerAssignments || []).length, 'supervisorRows:', supervisorRows.length);
  console.log('[DEBUG pharmacist] supervisorRows sample:', supervisorRows.slice(0, 10));

  const primarySupervisorRows = directSupervisorRows.filter((row: any) => row.is_primary === true);

  const zoneByStore = new Map<string, string>();
  const groupedManagers = new Map<string, any[]>();
  directSupervisorRows.forEach((row: any) => {
    const list = groupedManagers.get(row.store_id) || [];
    list.push(row);
    groupedManagers.set(row.store_id, list);
  });

  groupedManagers.forEach((list, storeId) => {
    const primaryCandidates = list.filter((r: any) => r.is_primary === true);
    const candidates = primaryCandidates.length > 0 ? primaryCandidates : list;
    const picked = [...candidates].sort((a, b) => {
      const aTime = Date.parse(a.created_at || '1970-01-01T00:00:00Z');
      const bTime = Date.parse(b.created_at || '1970-01-01T00:00:00Z');
      if (aTime !== bTime) return aTime - bTime;

      const aCode = profileByUserId.get(a.user_id)?.employee_code || '';
      const bCode = profileByUserId.get(b.user_id)?.employee_code || '';
      return aCode.localeCompare(bCode);
    })[0];

    const userInfo = profileByUserId.get(picked?.user_id) as any;
    const zoneLabel = userInfo?.full_name
      ? `${userInfo.full_name}${userInfo.employee_code ? ` (${userInfo.employee_code})` : ''}`
      : '未指派督導區';
    zoneByStore.set(storeId, zoneLabel);
  });

  console.log('[DEBUG pharmacist] groupedManagers store count:', groupedManagers.size);
  console.log('[DEBUG pharmacist] zoneByStore count:', zoneByStore.size);
  console.log('[DEBUG pharmacist] zoneByStore sample:', Array.from(zoneByStore.entries()).slice(0, 10));

  const prevByEmployee = new Map<string, any>();
  (previousRows || []).forEach((row: any) => {
    const code = row.employee_code || '';
    if (!code || prevByEmployee.has(code)) return;
    prevByEmployee.set(code, row);
  });

  const mappedRows: PharmacistRow[] = (currentRows || []).map((row: any) => {
    const prev = prevByEmployee.get(row.employee_code || '');
    const storeInfo = row.stores as any;
    const prevStoreInfo = prev?.stores as any;

    let changeType = '無變更';
    let changeNote = '';
    const _empCodeUpper = String(row.employee_code || '').toUpperCase();
    const resignRecord = row.movement_type !== 'resignation' ? resignationByEmpCode.get(_empCodeUpper) : null;
    if (row.movement_type === 'resignation') {
      changeType = '離職';
      const d = row.movement_date ? new Date(row.movement_date) : null;
      const mmdd = d ? `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}` : '';
      changeNote = mmdd ? `${mmdd} 離職` : '離職';
    } else if (resignRecord) {
      // 在 monthly_staff_status 中但當月已有離職紀錄 → 補標離職
      changeType = '離職';
      const d = resignRecord.movement_date ? new Date(resignRecord.movement_date) : null;
      const mmdd = d ? `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}` : '';
      changeNote = mmdd ? `${mmdd} 離職` : '離職';
    } else if (!prev) {
      // 關帳月份若缺少前月快照，不應把全員誤判為新增任職
      if (isSelectedMonthLocked) {
        const noteLower = String((row as any).notes || '').toLowerCase();
        if (row.is_active === false && noteLower.includes('resignation')) {
          changeType = '離職';
          changeNote = '離職';
        } else {
          changeType = '無變更';
          changeNote = '';
        }
      } else {
        changeType = '新增任職';
        const onboardingDate = onboardingByEmpCode.get(_empCodeUpper);
        const ymd = formatMovementDateYMD(onboardingDate);
        changeNote = ymd ? `${ymd}入職` : '入職';
      }
    } else {
      const storeChanged = prev.store_id !== row.store_id;
      const positionChanged = (prev.position || '') !== (row.position || '');
      if (storeChanged && positionChanged) {
        changeType = '門市/職級異動';
        changeNote = `上月門市：${prevStoreInfo?.store_name || '-'}；上月職級：${prev?.position || '-'}`;
      } else if (storeChanged) {
        changeType = '門市異動';
        changeNote = `上月門市：${prevStoreInfo?.store_name || '-'}`;
      } else if (positionChanged) {
        changeType = '職級異動';
        changeNote = `上月職級：${prev?.position || '-'}`;
      }
    }

    if (changeType === '無變更') {
      const movement = monthlyMovementByEmpCode.get(_empCodeUpper);
      if (movement?.movement_type === 'store_transfer') {
        changeType = '門市異動';
        const d = movement.movement_date ? new Date(movement.movement_date) : null;
        const mmdd = d ? `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}` : '';
        changeNote = mmdd ? `${mmdd} 調店（次月生效）` : '調店（次月生效）';
      } else if (movement?.movement_type === 'promotion') {
        changeType = '職級異動';
        const d = movement.movement_date ? new Date(movement.movement_date) : null;
        const mmdd = d ? `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}` : '';
        changeNote = mmdd ? `${mmdd} 升遷（次月生效）` : '升遷（次月生效）';
      }
    }

    return {
      id: row.id,
      store_id: row.store_id,
      store_code: storeInfo?.store_code || '',
      store_name: storeInfo?.store_name || '',
      employee_code: row.employee_code || '',
      employee_name: row.employee_name || '',
      position: row.position || '-',
      supervisor_zone: zoneByStore.get(row.store_id) || '未指派督導區',
      change_type: changeType,
      change_note: changeNote,
      prev_store_name: prevStoreInfo?.store_name || '-',
      prev_position: prev?.position || '-',
    };
  });

  const missingZoneRows = mappedRows.filter((r) => r.supervisor_zone === '未指派督導區');
  const missingZoneStoreIds = Array.from(new Set(missingZoneRows.map((r) => r.store_id)));
  console.log('[DEBUG pharmacist] mappedRows count:', mappedRows.length, '| missingZoneRows:', missingZoneRows.length, '| missingZoneStores:', missingZoneStoreIds.length);
  console.log('[DEBUG pharmacist] missingZone store ids sample:', missingZoneStoreIds.slice(0, 20));

  const debugPayload = {
    userId: user.id,
    selectedYearMonth,
    previousYearMonth,
    selectedZone,
    storeIdsCount: storeIds.length,
    storeIdsSample: storeIds.slice(0, 20),
    currentRowsCount: (currentRows || []).length,
    previousRowsCount: (previousRows || []).length,
    currentRowsExcludedSupervisorRotationCount: (currentRowsRaw || []).length - (currentRowsBase || []).length,
    previousRowsExcludedSupervisorRotationCount: (previousRowsRaw || []).length - (previousRows || []).length,
    supplementedResignedRowsCount: supplementedResignedRows.length,
    managerAssignmentsSource,
    managerAssignmentsErrorMessage,
    managerProfilesErrorMessage,
    managerAssignmentsCount: managerAssignments.length,
    managerUserIdsCount: managerUserIds.length,
    managerProfilesCount: managerProfiles.length,
    managerRowsCount: supervisorRows.length,
    directSupervisorRowsCount: directSupervisorRows.length,
    nonDirectSupervisorRoleRowsCount: nonDirectSupervisorRoleRows.length,
    primarySupervisorRowsCount: primarySupervisorRows.length,
    groupedManagersCount: groupedManagers.size,
    zoneByStoreCount: zoneByStore.size,
    zoneByStoreSample: Array.from(zoneByStore.entries()).slice(0, 20),
    mappedRowsCount: mappedRows.length,
    missingZoneRowsCount: missingZoneRows.length,
    missingZoneStoreIdsSample: missingZoneStoreIds.slice(0, 20),
    managerRowsSample: supervisorRows.slice(0, 10),
    directSupervisorRowsSample: directSupervisorRows.slice(0, 10),
    nonDirectSupervisorRoleRowsSample: nonDirectSupervisorRoleRows.slice(0, 10).map((r: any) => ({
      store_id: r.store_id,
      user_id: r.user_id,
      role_type: r.role_type,
      is_primary: r.is_primary,
      name: profileByUserId.get(r.user_id)?.full_name || null,
      employee_code: profileByUserId.get(r.user_id)?.employee_code || null,
      job_title: profileByUserId.get(r.user_id)?.job_title || null,
    })),
    primarySupervisorRowsSample: primarySupervisorRows.slice(0, 10),
  };

  mappedRows.sort((a, b) => {
    if (a.store_code !== b.store_code) return a.store_code.localeCompare(b.store_code);
    return a.employee_code.localeCompare(b.employee_code);
  });

  const scopedStoreList: ScopedStore[] = ((scopedStores || []) as any[]).map((s: any) => ({
    id: s.id,
    store_code: s.store_code || '',
    store_name: s.store_name || '',
  }));
  const storeById = new Map<string, ScopedStore>();
  scopedStoreList.forEach((s) => storeById.set(s.id, s));

  const pharmacistsByStore = new Map<string, PharmacistRow[]>();
  mappedRows.forEach((row) => {
    const list = pharmacistsByStore.get(row.store_id) || [];
    list.push(row);
    pharmacistsByStore.set(row.store_id, list);
  });
  pharmacistsByStore.forEach((list) => {
    list.sort((a, b) => a.employee_code.localeCompare(b.employee_code));
  });

  const supervisorCardMap = new Map<string, {
    supervisorZone: string;
    stores: Array<{
      storeId: string;
      storeCode: string;
      storeName: string;
      pharmacistCount: number;
      pharmacists: PharmacistRow[];
    }>;
  }>();

  storeIds.forEach((storeId) => {
    const storeMeta = storeById.get(storeId);
    const supervisorZone = zoneByStore.get(storeId) || '未指派督導區';
    if (!supervisorCardMap.has(supervisorZone)) {
      supervisorCardMap.set(supervisorZone, { supervisorZone, stores: [] });
    }
    const pharmacists = pharmacistsByStore.get(storeId) || [];
    supervisorCardMap.get(supervisorZone)!.stores.push({
      storeId,
      storeCode: storeMeta?.store_code || '',
      storeName: storeMeta?.store_name || '',
      pharmacistCount: pharmacists.length,
      pharmacists,
    });
  });

  const allSupervisorCards = Array.from(supervisorCardMap.values())
    .map((card) => ({
      ...card,
      stores: card.stores.sort((a, b) => a.storeCode.localeCompare(b.storeCode)),
    }))
    .sort((a, b) => a.supervisorZone.localeCompare(b.supervisorZone, 'zh-Hant'));

  const zoneOptions = allSupervisorCards.map((c) => c.supervisorZone);

  const filteredSupervisorCards =
    selectedZone === 'all'
      ? allSupervisorCards
      : allSupervisorCards.filter((c) => c.supervisorZone === selectedZone);

  const filteredRows = filteredSupervisorCards.flatMap((c) => c.stores.flatMap((s) => s.pharmacists));

  const summary = {
    total: filteredRows.length,
    newJoin: filteredRows.filter((r) => r.change_type === '新增任職').length,
    changed: filteredRows.filter((r) => r.change_type !== '無變更' && r.change_type !== '新增任職').length,
  };

  // ── Tab2: 藥師主檔資料 ──
  // 主檔現在改為年度快照，資料由 PharmacistMasterList 元件透過 API 載入
  // 這裡只傳遞空陣列和當前年度，讓客戶端元件處理資料載入
  const masterRows: any[] = [];
  const currentYear = new Date().getFullYear();

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto w-full max-w-7xl">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">藥師管理</h1>
        </div>

        {/* Tab 切換 */}
        <div className="mb-5 flex gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-sm w-fit">
          <Link
            href={`/admin/pharmacist-management?tab=overview&year_month=${selectedYearMonth}&zone=${selectedZone}`}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'overview'
                ? 'bg-blue-600 text-white shadow'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            督導區總覽
          </Link>
          <Link
            href="/admin/pharmacist-management?tab=master"
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'master'
                ? 'bg-blue-600 text-white shadow'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            藥師主檔
          </Link>
        </div>

        {activeTab === 'master' ? (
          <PharmacistMasterList
            rows={masterRows}
            canEdit={canEditModule}
            initialYear={currentYear}
          />
        ) : (<>

        <OverviewFilterForm
          selectedYearMonth={selectedYearMonth}
          selectedZone={selectedZone}
          zoneOptions={zoneOptions}
          lockedMonths={lockedMonths}
          canEdit={canEditModule}
        />

        <SummaryCards summary={summary} filteredRows={filteredRows} />

        {!canEditModule && (
          <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
            目前為檢視模式（僅可查看，無法編輯）。
          </div>
        )}

        {isDebug && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <div className="mb-2 text-sm font-semibold text-red-700">Debug 資訊（server-side）</div>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-3 text-xs text-gray-800">
              {JSON.stringify(debugPayload, null, 2)}
            </pre>
          </div>
        )}

        <PharmacistSupervisorCards
          cards={filteredSupervisorCards}
          selectedYearMonth={selectedYearMonth}
          canEdit={canEditModule || canViewAllMonthly}
        />

        <p className="mt-3 text-xs text-gray-500">
          點選門市可查看藥師明細。明細中的變化備註會顯示上月職級或上月門市，無變化則留白。
        </p>
        </>)}
      </div>
    </div>
  );
}
