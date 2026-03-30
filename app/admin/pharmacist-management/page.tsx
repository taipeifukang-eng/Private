import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';
import PharmacistManagementTable from './PharmacistManagementTable';

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
  prev_store_name: string;
  prev_position: string;
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
  searchParams?: { year_month?: string; zone?: string; debug?: string };
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

  if (storeIds.length === 0) {
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

  console.log('[DEBUG pharmacist] userId:', user.id);
  console.log('[DEBUG pharmacist] selectedYearMonth:', selectedYearMonth, '| previousYearMonth:', previousYearMonth);
  console.log('[DEBUG pharmacist] storeIds count:', storeIds.length, '| sample:', storeIds.slice(0, 10));

  const adminSupabase = createAdminClient();

  const [{ data: currentRows }, { data: previousRows }] = await Promise.all([
    supabase
      .from('monthly_staff_status')
      .select('id, store_id, employee_code, employee_name, position, stores(store_code, store_name)')
      .eq('year_month', selectedYearMonth)
      .in('store_id', storeIds)
      .eq('is_pharmacist', true),
    supabase
      .from('monthly_staff_status')
      .select('store_id, employee_code, employee_name, position, stores(store_code, store_name)')
      .eq('year_month', previousYearMonth)
      .in('store_id', storeIds)
      .eq('is_pharmacist', true),
  ]);

  let managerAssignments: any[] = [];
  let managerProfiles: any[] = [];
  let managerAssignmentsSource = 'admin';
  let managerAssignmentsErrorMessage = '';
  let managerProfilesErrorMessage = '';

  const { data: adminManagerAssignments, error: adminManagerAssignmentsError } = await adminSupabase
    .from('store_managers')
    .select('store_id, user_id, role_type, is_primary, updated_at, created_at')
    .in('store_id', storeIds);

  if (adminManagerAssignmentsError) {
    managerAssignmentsSource = 'regular-fallback';
    managerAssignmentsErrorMessage = adminManagerAssignmentsError.message;
    const { data: regularManagerAssignments, error: regularManagerAssignmentsError } = await supabase
      .from('store_managers')
      .select('store_id, user_id, role_type, is_primary, updated_at, created_at')
      .in('store_id', storeIds);

    if (regularManagerAssignmentsError) {
      managerAssignmentsErrorMessage = `${managerAssignmentsErrorMessage} | fallback: ${regularManagerAssignmentsError.message}`;
    }
    managerAssignments = regularManagerAssignments || [];
  } else {
    managerAssignments = adminManagerAssignments || [];
  }

  const managerUserIds = Array.from(
    new Set((managerAssignments || []).map((row: any) => row.user_id).filter(Boolean))
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

  const supervisorRows = (managerAssignments || []).filter((row: any) => {
    if (row.role_type === 'supervisor') return true;
    const p = profileByUserId.get(row.user_id);
    return p?.job_title?.includes('督導') ?? false;
  });

  console.log('[DEBUG pharmacist] query result counts => currentRows:', (currentRows || []).length, 'previousRows:', (previousRows || []).length, 'managerAssignments:', (managerAssignments || []).length, 'supervisorRows:', supervisorRows.length);
  console.log('[DEBUG pharmacist] supervisorRows sample:', supervisorRows.slice(0, 10));

  const zoneByStore = new Map<string, string>();
  const groupedManagers = new Map<string, any[]>();
  supervisorRows.forEach((row: any) => {
    const list = groupedManagers.get(row.store_id) || [];
    list.push(row);
    groupedManagers.set(row.store_id, list);
  });

  groupedManagers.forEach((list, storeId) => {
    const picked = [...list].sort((a, b) => {
      const aPrimary = a.is_primary ? 0 : 1;
      const bPrimary = b.is_primary ? 0 : 1;
      if (aPrimary !== bPrimary) return aPrimary - bPrimary;

      const aTime = Date.parse(a.updated_at || a.created_at || '1970-01-01T00:00:00Z');
      const bTime = Date.parse(b.updated_at || b.created_at || '1970-01-01T00:00:00Z');
      if (aTime !== bTime) return bTime - aTime;

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
    if (!prev) {
      changeType = '新增任職';
    } else {
      const storeChanged = prev.store_id !== row.store_id;
      const positionChanged = (prev.position || '') !== (row.position || '');
      if (storeChanged && positionChanged) changeType = '門市/職級異動';
      else if (storeChanged) changeType = '門市異動';
      else if (positionChanged) changeType = '職級異動';
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
    managerAssignmentsSource,
    managerAssignmentsErrorMessage,
    managerProfilesErrorMessage,
    managerAssignmentsCount: managerAssignments.length,
    managerUserIdsCount: managerUserIds.length,
    managerProfilesCount: managerProfiles.length,
    managerRowsCount: supervisorRows.length,
    groupedManagersCount: groupedManagers.size,
    zoneByStoreCount: zoneByStore.size,
    zoneByStoreSample: Array.from(zoneByStore.entries()).slice(0, 20),
    mappedRowsCount: mappedRows.length,
    missingZoneRowsCount: missingZoneRows.length,
    missingZoneStoreIdsSample: missingZoneStoreIds.slice(0, 20),
    managerRowsSample: supervisorRows.slice(0, 10),
  };

  const zoneOptions = Array.from(new Set(mappedRows.map((r) => r.supervisor_zone))).sort((a, b) =>
    a.localeCompare(b, 'zh-Hant')
  );

  const rows =
    selectedZone === 'all'
      ? mappedRows
      : mappedRows.filter((r) => r.supervisor_zone === selectedZone);

  rows.sort((a, b) => {
    if (a.supervisor_zone !== b.supervisor_zone) {
      return a.supervisor_zone.localeCompare(b.supervisor_zone, 'zh-Hant');
    }
    if (a.store_code !== b.store_code) {
      return a.store_code.localeCompare(b.store_code);
    }
    return a.employee_code.localeCompare(b.employee_code);
  });

  const summary = {
    total: rows.length,
    newJoin: rows.filter((r) => r.change_type === '新增任職').length,
    changed: rows.filter((r) => r.change_type !== '無變更' && r.change_type !== '新增任職').length,
  };

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto w-full max-w-7xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">藥師管理</h1>
          <p className="mt-2 text-sm text-gray-600">
            依經理/督導管理設定的督導門市，檢視各督導區藥師任職門市與該月職級變化。
          </p>
        </div>

        <form className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm" method="GET">
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

        <PharmacistManagementTable
          initialRows={rows}
          yearMonth={selectedYearMonth}
          canEdit={canEditModule}
        />

        <p className="mt-3 text-xs text-gray-500">
          比對邏輯：以同員編對照上月資料，判斷新增任職、門市異動、職級異動或無變更。
        </p>
      </div>
    </div>
  );
}
