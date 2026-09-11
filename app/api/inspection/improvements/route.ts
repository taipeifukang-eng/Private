import { NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const VIEW_ALL_PERMISSION = 'inspection.improvement.view_all';
const SCOPED_PERMISSIONS = [
  'inspection.improvement.view_own',
  'inspection.improvement.view_own_store',
  'inspection.improvement.manage',
  'inspection.improvement.submit',
] as const;
const ADMIN_ROLE_CODES = new Set([
  'admin',
  'system_admin',
  'admin_role',
  'full_admin',
  'full_admin_role',
  'dev_full_admin',
  'owner',
  'owner_role',
]);
const IMPROVEMENT_SELECT = `
  id, inspection_id, store_id,
  section_name, item_name, deduction_amount,
  issue_description, issue_photo_urls, selected_items,
  status, deadline, days_taken, bonus_score,
  improved_at, created_at
`;

async function getImprovementAccess(adminClient: any, userId: string) {
  const { data: profile, error: profileError } = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) {
    console.warn('查詢使用者身份失敗:', profileError);
  }

  if (profile?.role === 'admin') {
    return { canViewAll: true, canViewOwnScope: true };
  }

  const { data: roleRows, error: roleError } = await adminClient
    .from('user_roles')
    .select(`
      expires_at,
      role:roles!inner (
        code,
        is_active,
        role_permissions!inner (
          is_allowed,
          permission:permissions!inner (code, is_active)
        )
      )
    `)
    .eq('user_id', userId)
    .eq('is_active', true);

  if (roleError) {
    console.error('查詢待改善權限失敗:', roleError);
    return { canViewAll: false, canViewOwnScope: false };
  }

  const permissionCodes = new Set<string>();
  const now = Date.now();
  let isAdminLike = false;

  (roleRows || []).forEach((userRole: any) => {
    const expiresAt = userRole.expires_at ? new Date(userRole.expires_at).getTime() : null;
    if (expiresAt !== null && expiresAt <= now) return;
    if (userRole.role?.is_active === false) return;

    if (ADMIN_ROLE_CODES.has(userRole.role?.code)) {
      isAdminLike = true;
    }

    (userRole.role?.role_permissions || []).forEach((rolePermission: any) => {
      const code = rolePermission.permission?.code;
      if (
        rolePermission.is_allowed &&
        rolePermission.permission?.is_active !== false &&
        typeof code === 'string' &&
        code.trim()
      ) {
        permissionCodes.add(code.trim());
      }
    });
  });

  return {
    canViewAll: isAdminLike || permissionCodes.has(VIEW_ALL_PERMISSION),
    canViewOwnScope: isAdminLike || SCOPED_PERMISSIONS.some((code) => permissionCodes.has(code)),
  };
}

function sortImprovements(items: any[]) {
  return items.sort((a, b) => {
    const deadlineCompare = String(a.deadline || '').localeCompare(String(b.deadline || ''));
    if (deadlineCompare !== 0) return deadlineCompare;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
}

export async function GET() {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const adminClient = createAdminClient();
    const { canViewAll, canViewOwnScope } = await getImprovementAccess(adminClient, user.id);

    if (!canViewAll && !canViewOwnScope) {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    let totalCount = 0;
    let visibleImprovements: any[] = [];
    let managedStoreCount = 0;
    let ownInspectionCount = 0;

    const totalCountPromise = adminClient
      .from('inspection_improvements')
      .select('id', { count: 'exact', head: true });

    if (canViewAll) {
      const { data, error } = await adminClient
        .from('inspection_improvements')
        .select(IMPROVEMENT_SELECT)
        .order('deadline', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) {
        console.error('查詢待改善事項失敗:', error);
        return NextResponse.json(
          { error: error.message || '查詢待改善事項失敗' },
          { status: 500 }
        );
      }

      visibleImprovements = data || [];
    } else {
      const [storeManagerResult, ownInspectionResult] = await Promise.all([
        adminClient
          .from('store_managers')
          .select('store_id')
          .eq('user_id', user.id),
        adminClient
          .from('inspection_masters')
          .select('id')
          .eq('inspector_id', user.id),
      ]);

      if (storeManagerResult.error) {
        console.warn('查詢使用者管理門市失敗:', storeManagerResult.error);
      }
      if (ownInspectionResult.error) {
        console.warn('查詢使用者巡店紀錄失敗:', ownInspectionResult.error);
      }

      const storeIds = new Set(
        (storeManagerResult.data || []).map((row: any) => row.store_id).filter(Boolean)
      );
      const inspectionIds = new Set(
        (ownInspectionResult.data || []).map((row: any) => row.id).filter(Boolean)
      );
      managedStoreCount = storeIds.size;
      ownInspectionCount = inspectionIds.size;

      const scopedQueries = [
        storeIds.size > 0
          ? adminClient
              .from('inspection_improvements')
              .select(IMPROVEMENT_SELECT)
              .in('store_id', Array.from(storeIds))
              .order('deadline', { ascending: true })
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [] as any[], error: null }),
        inspectionIds.size > 0
          ? adminClient
              .from('inspection_improvements')
              .select(IMPROVEMENT_SELECT)
              .in('inspection_id', Array.from(inspectionIds))
              .order('deadline', { ascending: true })
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [] as any[], error: null }),
      ];

      const [storeScopedResult, inspectionScopedResult] = await Promise.all(scopedQueries);

      if (storeScopedResult.error || inspectionScopedResult.error) {
        const scopedError = storeScopedResult.error || inspectionScopedResult.error;
        console.error('查詢可見待改善事項失敗:', scopedError);
        return NextResponse.json(
          { error: scopedError?.message || '查詢可見待改善事項失敗' },
          { status: 500 }
        );
      }

      const merged = new Map<string, any>();
      [...(storeScopedResult.data || []), ...(inspectionScopedResult.data || [])].forEach((item) => {
        if (item?.id) {
          merged.set(item.id, item);
        }
      });
      visibleImprovements = sortImprovements(Array.from(merged.values()));
    }

    const { count, error: totalCountError } = await totalCountPromise;
    if (totalCountError) {
      console.warn('查詢待改善總數失敗:', totalCountError);
    }
    totalCount = count ?? visibleImprovements.length;

    // 分開補關聯資料，避免 stores / inspection_masters inner join 被關聯表 RLS 連帶過濾成空資料。
    const storeIds = Array.from(new Set(visibleImprovements.map((item: any) => item.store_id).filter(Boolean)));
    const inspectionIds = Array.from(new Set(visibleImprovements.map((item: any) => item.inspection_id).filter(Boolean)));

    const [storesResult, inspectionsResult] = await Promise.all([
      storeIds.length > 0
        ? adminClient.from('stores').select('id, store_name, store_code').in('id', storeIds)
        : Promise.resolve({ data: [] as any[], error: null }),
      inspectionIds.length > 0
        ? adminClient
            .from('inspection_masters')
            .select('id, inspection_date, inspector_id')
            .in('id', inspectionIds)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    if (storesResult.error) {
      console.warn('查詢待改善門市資料失敗:', storesResult.error);
    }
    if (inspectionsResult.error) {
      console.warn('查詢待改善巡店主檔失敗:', inspectionsResult.error);
    }

    const storeMap = new Map(
      (storesResult.data || []).map((store: any) => [store.id, store])
    );
    const inspectionMap = new Map(
      (inspectionsResult.data || []).map((inspection: any) => [inspection.id, inspection])
    );
    const inspectorIds = Array.from(new Set(
      (inspectionsResult.data || []).map((inspection: any) => inspection.inspector_id).filter(Boolean)
    ));

    let inspectorNameMap = new Map<string, string>();
    if (inspectorIds.length > 0) {
      const { data: inspectorProfiles, error: inspectorError } = await adminClient
        .from('profiles')
        .select('id, full_name')
        .in('id', inspectorIds);

      if (inspectorError) {
        console.warn('查詢督導名稱失敗:', inspectorError);
      }
      inspectorNameMap = new Map(
        (inspectorProfiles || []).map((profile: any) => [profile.id, profile.full_name || '未知'])
      );
    }

    const today = new Date().toISOString().split('T')[0];
    const overdueItems = visibleImprovements.filter(
      (item: any) => item.status === 'pending' && item.deadline < today
    );

    if (overdueItems.length > 0) {
      await Promise.all(
        overdueItems.map((item: any) =>
          adminClient
            .from('inspection_improvements')
            .update({ status: 'overdue', updated_at: new Date().toISOString() })
            .eq('id', item.id)
        )
      );
      overdueItems.forEach((item: any) => {
        item.status = 'overdue';
      });
    }

    const improvements = visibleImprovements.map((item: any) => {
      const store = storeMap.get(item.store_id) || {};
      const inspection = inspectionMap.get(item.inspection_id) || {};
      const inspectorId = (inspection as any).inspector_id;

      return {
        ...item,
        store_name: (store as any).store_name || '未知門市',
        store_code: (store as any).store_code || '',
        inspection_date: (inspection as any).inspection_date || '',
        inspector_name: (inspectorId && inspectorNameMap.get(inspectorId)) || '未知',
      };
    });

    return NextResponse.json({
      improvements,
      meta: {
        totalCount,
        visibleCount: improvements.length,
        canViewAll,
        canViewOwnScope,
        managedStoreCount,
        ownInspectionCount,
      },
    });
  } catch (error: any) {
    console.error('載入待改善事項失敗:', error);
    return NextResponse.json(
      { error: error.message || '載入待改善事項失敗' },
      { status: 500 }
    );
  }
}
