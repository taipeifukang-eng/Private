import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';
import PharmacistSupervisorCards from './PharmacistSupervisorCards';
import PharmacistMasterList from './PharmacistMasterList';

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

  const [{ data: currentRowsRaw }, { data: previousRowsRaw }] = await Promise.all([
    supabase
      .from('monthly_staff_status')
      .select('id, store_id, employee_code, employee_name, position, is_supervisor_rotation, stores(store_code, store_name)')
      .eq('year_month', selectedYearMonth)
      .in('store_id', storeIds)
      .eq('is_pharmacist', true),
    supabase
      .from('monthly_staff_status')
      .select('store_id, employee_code, employee_name, position, is_supervisor_rotation, stores(store_code, store_name)')
      .eq('year_month', previousYearMonth)
      .in('store_id', storeIds)
      .eq('is_pharmacist', true),
  ]);

  // 排除「督導卡班」造成的藥師假象
  const currentRowsBase = (currentRowsRaw || []).filter((row: any) => !row.is_supervisor_rotation);
  const previousRows = (previousRowsRaw || []).filter((row: any) => !row.is_supervisor_rotation);

  // 補抓「該月份已登記人事異動=離職」的藥師，避免月報尚未寫入而漏掉
  const monthStart = `${selectedYearMonth}-01`;
  const monthEndDate = new Date(Number(selectedYearMonth.slice(0, 4)), Number(selectedYearMonth.slice(5, 7)), 0);
  const monthEnd = `${selectedYearMonth}-${String(monthEndDate.getDate()).padStart(2, '0')}`;

  const { data: resignationMovements } = await adminSupabase
    .from('employee_movement_history')
    .select('employee_code, employee_name, store_id, movement_date, movement_type')
    .eq('movement_type', 'resignation')
    .in('store_id', storeIds)
    .gte('movement_date', monthStart)
    .lte('movement_date', monthEnd);

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

  const supplementedResignedRows = (resignationMovements || []).flatMap((m: any) => {
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

  const currentRows = [...currentRowsBase, ...supplementedResignedRows];

  // 建立「當月離職員工」快查 map（employee_code → movement record），用於補標 monthly_staff_status 中已存在但已離職的藥師
  const resignationByEmpCode = new Map<string, any>();
  (resignationMovements || []).forEach((m: any) => {
    const code = String(m.employee_code || '').toUpperCase();
    if (code) resignationByEmpCode.set(code, m);
  });

  let managerAssignments: any[] = [];
  let managerProfiles: any[] = [];
  let managerAssignmentsSource = 'admin';
  let managerAssignmentsErrorMessage = '';
  let managerProfilesErrorMessage = '';

  const { data: adminManagerAssignments, error: adminManagerAssignmentsError } = await adminSupabase
    .from('store_managers')
    .select('store_id, user_id, role_type, is_primary, created_at')
    .in('store_id', storeIds);

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
      changeType = '新增任職';
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
  // 主檔不受「督導區總覽月份」影響，固定以全資料庫藥師為來源
  const [{ data: masterEmployeesRaw }, { data: monthlyPharmacistsRaw }] = await Promise.all([
    adminSupabase
      .from('store_employees')
      .select('employee_code, store_id, is_pharmacist, current_position, position, start_date, is_active')
      .eq('is_pharmacist', true),
    adminSupabase
      .from('monthly_staff_status')
      .select('employee_code, employee_name, position, start_date, store_id, year_month')
      .eq('is_pharmacist', true)
      .order('year_month', { ascending: false }),
  ]);

  const masterEmployees = (masterEmployeesRaw || []) as Array<{
    employee_code: string;
    store_id: string;
    is_pharmacist: boolean;
    current_position: string | null;
    position: string | null;
    start_date: string | null;
    is_active: boolean;
  }>;

  const monthlyPharmacists = (monthlyPharmacistsRaw || []) as Array<{
    employee_code: string;
    employee_name: string | null;
    position: string | null;
    start_date: string | null;
    store_id: string;
    year_month: string;
  }>;

  // 以員編唯一化，避免同一藥師在多門市或歷史資料造成重複
  const masterEmployeeByCode = new Map<string, {
    employee_code: string;
    store_id: string;
    is_pharmacist: boolean;
    current_position: string | null;
    position: string | null;
    start_date: string | null;
    is_active: boolean;
  }>();

  masterEmployees.forEach((e) => {
    const code = String(e.employee_code || '').toUpperCase();
    if (!code) return;

    const normalized = {
      ...e,
      employee_code: code,
    };

    const existing = masterEmployeeByCode.get(code);
    if (!existing) {
      masterEmployeeByCode.set(code, normalized);
      return;
    }

    // 優先保留在職資料；同狀態下，優先保留 start_date 較新的資料
    if (existing.is_active !== normalized.is_active) {
      if (normalized.is_active) masterEmployeeByCode.set(code, normalized);
      return;
    }

    const existingDate = existing.start_date ? Date.parse(existing.start_date) : 0;
    const nextDate = normalized.start_date ? Date.parse(normalized.start_date) : 0;
    if (nextDate > existingDate) {
      masterEmployeeByCode.set(code, normalized);
    }
  });

  // monthly_staff_status 的藥師也納入主檔來源，避免僅出現在月狀態而未建 store_employees 時漏資料
  // 同員編只採用最新月份資料
  const monthlyByCode = new Map<string, {
    employee_code: string;
    employee_name: string | null;
    position: string | null;
    start_date: string | null;
    store_id: string;
    year_month: string;
  }>();

  monthlyPharmacists.forEach((m) => {
    const code = String(m.employee_code || '').toUpperCase();
    if (!code) return;

    const existingMonthly = monthlyByCode.get(code);
    if (!existingMonthly || String(m.year_month || '') > String(existingMonthly.year_month || '')) {
      monthlyByCode.set(code, m);
    }
  });

  Array.from(monthlyByCode.values()).forEach((m) => {
    const code = String(m.employee_code || '').toUpperCase();
    if (!code) return;

    const existing = masterEmployeeByCode.get(code);
    if (!existing) {
      masterEmployeeByCode.set(code, {
        employee_code: code,
        store_id: String(m.store_id || ''),
        is_pharmacist: true,
        current_position: m.position || null,
        position: m.position || null,
        start_date: m.start_date || null,
        is_active: true,
      });
      return;
    }

    // 已存在時，用 monthly 資料補齊缺值
    if (!existing.current_position && m.position) {
      existing.current_position = m.position;
      existing.position = m.position;
    }
    if (!existing.start_date && m.start_date) {
      existing.start_date = m.start_date;
    }
    existing.is_pharmacist = true;
    masterEmployeeByCode.set(code, existing);
  });

  // 補入「已離職」藥師：若在異動紀錄有離職，但已不在 store_employees / 當月月報，仍要出現在主檔的已離職清單
  const { data: resignationMovementsAll } = await adminSupabase
    .from('employee_movement_history')
    .select('employee_code, employee_name, store_id, movement_date, movement_type')
    .eq('movement_type', 'resignation')
    .order('movement_date', { ascending: false });

  const resignationCodesAll = Array.from(
    new Set((resignationMovementsAll || []).map((r: any) => String(r.employee_code || '').toUpperCase()).filter(Boolean))
  );

  const { data: resignationMonthlyRaw } = resignationCodesAll.length > 0
    ? await adminSupabase
        .from('monthly_staff_status')
        .select('employee_code, employee_name, position, start_date, is_pharmacist, store_id, year_month')
        .in('employee_code', resignationCodesAll)
        .order('year_month', { ascending: false })
    : { data: [] as any[] };

  const resignationRowsByCode = new Map<string, any[]>();
  (resignationMonthlyRaw || []).forEach((r: any) => {
    const code = String(r.employee_code || '').toUpperCase();
    if (!code) return;
    const list = resignationRowsByCode.get(code) || [];
    list.push(r);
    resignationRowsByCode.set(code, list);
  });

  resignationCodesAll.forEach((code) => {
    const rows = resignationRowsByCode.get(code) || [];
    const hasPharmacistHistory = rows.some((r: any) => r.is_pharmacist === true);
    if (!hasPharmacistHistory) return;

    if (masterEmployeeByCode.has(code)) return;

    const latestRow = rows[0];
    const earliestStart = rows
      .map((r: any) => r.start_date)
      .filter((d: any) => !!d)
      .sort()[0] || null;

    masterEmployeeByCode.set(code, {
      employee_code: code,
      store_id: String(latestRow?.store_id || ''),
      is_pharmacist: true,
      current_position: latestRow?.position || '離職',
      position: latestRow?.position || '離職',
      start_date: earliestStart,
      is_active: false,
    });
  });

  const masterEmployeesUnique = Array.from(masterEmployeeByCode.values());

  // 抓取姓名（profiles）
  const masterEmpCodes = Array.from(new Set(masterEmployeesUnique.map((e) => e.employee_code).filter(Boolean)));
  const { data: masterProfilesRaw } = masterEmpCodes.length > 0
    ? await adminSupabase
        .from('profiles')
        .select('employee_code, full_name')
        .in('employee_code', masterEmpCodes)
    : { data: [] as any[] };

  const masterNameByCode = new Map<string, string>();
  (masterProfilesRaw || []).forEach((p: any) => {
    if (p.employee_code) masterNameByCode.set(p.employee_code.toUpperCase(), p.full_name || '');
  });

  // 先用當月月狀態補姓名（最貼近使用者剛新增的資料）
  monthlyPharmacists.forEach((m) => {
    const code = String(m.employee_code || '').toUpperCase();
    if (code && m.employee_name && !masterNameByCode.has(code)) {
      masterNameByCode.set(code, m.employee_name);
    }
  });

    // 從 monthly_staff_status 補充姓名（profiles 只有有帳號的人，大多數藥師沒有帳號）
    const { data: nameSupplementRaw } = masterEmpCodes.length > 0
      ? await adminSupabase
          .from('monthly_staff_status')
          .select('employee_code, employee_name')
          .in('employee_code', masterEmpCodes)
          .not('employee_name', 'is', null)
          .order('year_month', { ascending: false })
          .limit(masterEmpCodes.length * 5)
      : { data: [] as any[] };

    (nameSupplementRaw || []).forEach((r: any) => {
      const code = (r.employee_code || '').toUpperCase();
      if (code && r.employee_name && !masterNameByCode.has(code)) {
        masterNameByCode.set(code, r.employee_name);
      }
    });

    // 也從 employee_movement_history 補充（離職者可能不在 monthly_staff_status 最新月份）
    const { data: nameFromMovementRaw } = masterEmpCodes.length > 0
      ? await adminSupabase
          .from('employee_movement_history')
          .select('employee_code, employee_name')
          .in('employee_code', masterEmpCodes)
          .not('employee_name', 'is', null)
          .order('movement_date', { ascending: false })
          .limit(masterEmpCodes.length * 3)
      : { data: [] as any[] };

    (nameFromMovementRaw || []).forEach((r: any) => {
      const code = (r.employee_code || '').toUpperCase();
      if (code && r.employee_name && !masterNameByCode.has(code)) {
        masterNameByCode.set(code, r.employee_name);
      }
    });

    // 以異動紀錄決定主檔在職/離職狀態與離職日期
    // 規則：最新離職日 >= 最新復職/入職日 => 視為已離職，並顯示該離職日
    const { data: latestMovementsRaw } = masterEmpCodes.length > 0
      ? await adminSupabase
          .from('employee_movement_history')
          .select('employee_code, movement_type, movement_date')
          .in('employee_code', masterEmpCodes)
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

    // 從 monthly_staff_status 補齊到職日（store_employees 可能為空）
    const { data: startDateSupplementRaw } = masterEmpCodes.length > 0
      ? await adminSupabase
          .from('monthly_staff_status')
          .select('employee_code, start_date, year_month')
          .in('employee_code', masterEmpCodes)
          .not('start_date', 'is', null)
          .order('year_month', { ascending: false })
          .limit(masterEmpCodes.length * 12)
      : { data: [] as any[] };

    const startDateByCode = new Map<string, string>();
    (startDateSupplementRaw || []).forEach((r: any) => {
      const code = (r.employee_code || '').toUpperCase();
      if (code && r.start_date && !startDateByCode.has(code)) {
        startDateByCode.set(code, r.start_date);
      }
    });

    // 抓取 pharmacist_profiles 主檔
  const { data: pharmProfilesRaw } = masterEmpCodes.length > 0
    ? await adminSupabase
        .from('pharmacist_profiles')
        .select('employee_code, school, education_level, is_responsible_pharmacist, license_renewal_date')
        .in('employee_code', masterEmpCodes)
    : { data: [] as any[] };

  const pharmProfileByCode = new Map<string, any>();
  (pharmProfilesRaw || []).forEach((p: any) => {
    if (p.employee_code) pharmProfileByCode.set(p.employee_code.toUpperCase(), p);
  });

  // 建立門市 map for store_code / store_name lookup
  const masterRows = masterEmployeesUnique
    .map((e) => {
      const code = (e.employee_code || '').toUpperCase();
      const pharmProfile = pharmProfileByCode.get(code) || {};

      const resignationDate = latestResignationByCode.get(code) || null;
      const reactivationDate = latestReactivationByCode.get(code) || null;
      const isResignedByMovement = Boolean(
        resignationDate && (!reactivationDate || resignationDate >= reactivationDate)
      );

      return {
        employee_code: code,
        employee_name: masterNameByCode.get(code) || '',
        current_position: e.current_position || e.position || '-',
        start_date: e.start_date || startDateByCode.get(code) || null,
        resignation_date: isResignedByMovement ? resignationDate : null,
        is_active: isResignedByMovement ? false : e.is_active,
        school: pharmProfile.school || '',
        education_level: pharmProfile.education_level || '',
        is_responsible_pharmacist: pharmProfile.is_responsible_pharmacist ?? false,
        license_renewal_date: pharmProfile.license_renewal_date || null,
      };
    })
    .sort((a, b) => a.employee_code.localeCompare(b.employee_code));

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
          />
        ) : (<>

        <form className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm" method="GET">
          <input type="hidden" name="tab" value="overview" />
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">月份</label>
              <input
                type="month"
                name="year_month"
                defaultValue={selectedYearMonth}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">督導區</label>
              <select
                name="zone"
                defaultValue={selectedZone}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              >
                <option value="all">全部督導區</option>
                {zoneOptions.map((zone) => (
                  <option key={zone} value={zone}>{zone}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                查詢
              </button>
              <Link
                href="/admin/pharmacist-management"
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                重設
              </Link>
            </div>
          </div>
        </form>

        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
            <div className="text-sm text-blue-700">當月藥師總數</div>
            <div className="mt-1 text-2xl font-bold text-blue-900">{summary.total}</div>
          </div>
          <div className="rounded-xl border border-green-100 bg-green-50 p-4">
            <div className="text-sm text-green-700">新增任職</div>
            <div className="mt-1 text-2xl font-bold text-green-900">{summary.newJoin}</div>
          </div>
          <div className="rounded-xl border border-amber-100 bg-amber-50 p-4">
            <div className="text-sm text-amber-700">門市/職級異動</div>
            <div className="mt-1 text-2xl font-bold text-amber-900">{summary.changed}</div>
          </div>
        </div>

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

        <PharmacistSupervisorCards cards={filteredSupervisorCards} />

        <p className="mt-3 text-xs text-gray-500">
          點選門市可查看藥師明細。明細中的變化備註會顯示上月職級或上月門市，無變化則留白。
        </p>
        </>)}
      </div>
    </div>
  );
}
