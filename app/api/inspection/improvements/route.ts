import { NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const VIEW_ALL_PERMISSION = 'inspection.improvement.view_all';
const LEGACY_INSPECTION_VIEW_ALL_PERMISSION = 'inspection.view_all';
const ADMIN_CAPABILITY_PERMISSIONS = [
  'role.permission.assign',
  'role.role.view',
  'user.user.view',
  'user.user.manage',
] as const;
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
const PROFILE_SCOPED_ROLES = new Set(['supervisor', 'manager', 'area_manager']);
const IMPROVEMENT_LIST_SELECT = `
  id, inspection_id, store_id,
  section_name, item_name, deduction_amount,
  selected_items,
  status, deadline, days_taken, bonus_score,
  improved_at, created_at
`;
const LIST_LIMIT = 200;

class ImprovementQueryError extends Error {
  stage: string;

  constructor(stage: string, message: string) {
    super(message);
    this.stage = stage;
  }
}

function throwQueryError(stage: string, error: any, fallback: string): never {
  const message = error?.message || fallback;
  console.error(`${stage}:`, error);
  throw new ImprovementQueryError(stage, message);
}

async function runQuery<T>(stage: string, query: PromiseLike<{ data: T; error: any }>, fallback: string) {
  const result = await query;
  if (result.error) {
    throwQueryError(stage, result.error, fallback);
  }
  return result.data;
}

async function getImprovementAccess(adminClient: any, userId: string) {
  const profile = await runQuery(
    'access.profile',
    adminClient
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle(),
    '查詢使用者身份失敗'
  ) as any;

  const profileRole = String(profile?.role || '');
  if (profileRole === 'admin') {
    return { canViewAll: true, canViewOwnScope: true };
  }
  const profileAllowsScopedAccess = PROFILE_SCOPED_ROLES.has(profileRole);

  const userRoles = await runQuery(
    'access.user_roles',
    adminClient
      .from('user_roles')
      .select('role_id, expires_at')
      .eq('user_id', userId)
      .eq('is_active', true),
    '查詢使用者角色失敗'
  ) as any[];

  const now = Date.now();
  const activeRoleIds = Array.from(new Set(
    (userRoles || [])
      .filter((row: any) => {
        const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
        return expiresAt === null || expiresAt > now;
      })
      .map((row: any) => row.role_id)
      .filter(Boolean)
  ));

  if (activeRoleIds.length === 0) {
    return { canViewAll: false, canViewOwnScope: profileAllowsScopedAccess };
  }

  const roles = await runQuery(
    'access.roles',
    adminClient
      .from('roles')
      .select('id, code, is_active')
      .in('id', activeRoleIds),
    '查詢角色資料失敗'
  ) as any[];

  const enabledRoleIds = new Set<string>();
  let isAdminLike = false;
  (roles || []).forEach((role: any) => {
    if (role?.is_active === false) return;
    enabledRoleIds.add(role.id);
    if (ADMIN_ROLE_CODES.has(role.code)) {
      isAdminLike = true;
    }
  });

  if (isAdminLike) {
    return { canViewAll: true, canViewOwnScope: true };
  }

  const scopedPermissionCodes = [
    VIEW_ALL_PERMISSION,
    LEGACY_INSPECTION_VIEW_ALL_PERMISSION,
    ...ADMIN_CAPABILITY_PERMISSIONS,
    ...SCOPED_PERMISSIONS,
  ];
  const permissions = await runQuery(
    'access.permissions',
    adminClient
      .from('permissions')
      .select('id, code, is_active')
      .in('code', scopedPermissionCodes),
    '查詢待改善權限定義失敗'
  ) as any[];

  const permissionById = new Map(
    (permissions || [])
      .filter((permission: any) => permission?.is_active !== false)
      .map((permission: any) => [permission.id, permission.code])
  );
  const permissionIds = Array.from(permissionById.keys());
  const allowedRoleIds = Array.from(enabledRoleIds);

  if (permissionIds.length === 0 || allowedRoleIds.length === 0) {
    return { canViewAll: false, canViewOwnScope: profileAllowsScopedAccess };
  }

  const rolePermissions = await runQuery(
    'access.role_permissions',
    adminClient
      .from('role_permissions')
      .select('permission_id')
      .in('role_id', allowedRoleIds)
      .in('permission_id', permissionIds)
      .eq('is_allowed', true),
    '查詢角色待改善權限失敗'
  ) as any[];

  const permissionCodes = new Set(
    (rolePermissions || [])
      .map((rolePermission: any) => permissionById.get(rolePermission.permission_id))
      .filter(Boolean)
  );
  const hasAdminCapability = ADMIN_CAPABILITY_PERMISSIONS.some((code) => permissionCodes.has(code));
  const hasLegacyGlobalInspectionAccess =
    permissionCodes.has(LEGACY_INSPECTION_VIEW_ALL_PERMISSION) && hasAdminCapability;

  return {
    canViewAll: permissionCodes.has(VIEW_ALL_PERMISSION) || hasLegacyGlobalInspectionAccess,
    canViewOwnScope: profileAllowsScopedAccess || SCOPED_PERMISSIONS.some((code) => permissionCodes.has(code)),
  };
}

function sortImprovements(items: any[]) {
  return items.sort((a, b) => {
    const deadlineCompare = String(a.deadline || '').localeCompare(String(b.deadline || ''));
    if (deadlineCompare !== 0) return deadlineCompare;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
}

async function fetchImprovementsByStatus(adminClient: any, baseIdQuery: (status: string) => any, stagePrefix: string) {
  const statuses = ['pending', 'overdue', 'improved'];
  const results = await Promise.all(statuses.map(async (status) => {
    const idRows = await runQuery(
      `${stagePrefix}.${status}.ids`,
      baseIdQuery(status)
        .limit(LIST_LIMIT),
      `查詢${status}待改善事項失敗`
    ) as any[];
    const ids = (idRows || []).map((item: any) => item.id).filter(Boolean);

    if (ids.length === 0) {
      return [];
    }

    return runQuery(
      `${stagePrefix}.${status}.rows`,
      adminClient
        .from('inspection_improvements')
        .select(IMPROVEMENT_LIST_SELECT)
        .in('id', ids),
      `載入${status}待改善事項資料失敗`
    ) as Promise<any[]>;
  }));

  const merged = new Map<string, any>();
  results.flat().forEach((item: any) => {
    if (item?.id) {
      merged.set(item.id, item);
    }
  });
  return sortImprovements(Array.from(merged.values()));
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

    let visibleImprovements: any[] = [];
    let managedStoreCount = 0;
    let ownInspectionCount = 0;

    if (canViewAll) {
      visibleImprovements = await fetchImprovementsByStatus(
        adminClient,
        (status) => adminClient
          .from('inspection_improvements')
          .select('id')
          .eq('status', status),
        'improvements.all'
      );
    } else {
      const [storeManagerRows, ownInspectionRows] = await Promise.all([
        runQuery(
          'scope.store_managers',
          adminClient
            .from('store_managers')
            .select('store_id')
            .eq('user_id', user.id),
          '查詢使用者管理門市失敗'
        ),
        runQuery(
          'scope.inspection_masters',
          adminClient
            .from('inspection_masters')
            .select('id')
            .eq('inspector_id', user.id),
          '查詢使用者巡店紀錄失敗'
        ),
      ]) as [any[], any[]];

      const storeIds = new Set(
        (storeManagerRows || []).map((row: any) => row.store_id).filter(Boolean)
      );
      const inspectionIds = new Set(
        (ownInspectionRows || []).map((row: any) => row.id).filter(Boolean)
      );
      managedStoreCount = storeIds.size;
      ownInspectionCount = inspectionIds.size;

      const scopedQueries = [
        storeIds.size > 0
          ? fetchImprovementsByStatus(
              adminClient,
              (status) => adminClient
                .from('inspection_improvements')
                .select('id')
                .in('store_id', Array.from(storeIds))
                .eq('status', status),
              'improvements.store_scope'
            )
          : Promise.resolve([] as any[]),
        inspectionIds.size > 0
          ? fetchImprovementsByStatus(
              adminClient,
              (status) => adminClient
                .from('inspection_improvements')
                .select('id')
                .in('inspection_id', Array.from(inspectionIds))
                .eq('status', status),
              'improvements.inspection_scope'
            )
          : Promise.resolve([] as any[]),
      ];

      const [storeScopedRows, inspectionScopedRows] = await Promise.all(scopedQueries);

      const merged = new Map<string, any>();
      [...storeScopedRows, ...inspectionScopedRows].forEach((item) => {
        if (item?.id) {
          merged.set(item.id, item);
        }
      });
      visibleImprovements = sortImprovements(Array.from(merged.values()));
    }

    // 分開補關聯資料，避免 stores / inspection_masters inner join 被關聯表 RLS 連帶過濾成空資料。
    const storeIds = Array.from(new Set(visibleImprovements.map((item: any) => item.store_id).filter(Boolean)));
    const inspectionIds = Array.from(new Set(visibleImprovements.map((item: any) => item.inspection_id).filter(Boolean)));

    const [storesResult, inspectionsResult] = await Promise.all([
      storeIds.length > 0
        ? runQuery(
            'hydrate.stores',
            adminClient.from('stores').select('id, store_name, store_code').in('id', storeIds),
            '查詢待改善門市資料失敗'
          )
        : Promise.resolve([] as any[]),
      inspectionIds.length > 0
        ? runQuery(
            'hydrate.inspection_masters',
            adminClient
              .from('inspection_masters')
              .select('id, inspection_date, inspector_id')
              .in('id', inspectionIds),
            '查詢待改善巡店主檔失敗'
          )
        : Promise.resolve([] as any[]),
    ]);

    const storeMap = new Map(
      (storesResult || []).map((store: any) => [store.id, store])
    );
    const inspectionMap = new Map(
      (inspectionsResult || []).map((inspection: any) => [inspection.id, inspection])
    );
    const inspectorIds = Array.from(new Set(
      (inspectionsResult || []).map((inspection: any) => inspection.inspector_id).filter(Boolean)
    ));

    let inspectorNameMap = new Map<string, string>();
    if (inspectorIds.length > 0) {
      const inspectorProfiles = await runQuery(
        'hydrate.profiles',
        adminClient
          .from('profiles')
          .select('id, full_name')
          .in('id', inspectorIds),
        '查詢督導名稱失敗'
      ) as any[];
      inspectorNameMap = new Map(
        (inspectorProfiles || []).map((profile: any) => [profile.id, profile.full_name || '未知'])
      );
    }

    const today = new Date().toISOString().split('T')[0];
    const overdueItems = visibleImprovements.filter(
      (item: any) => item.status === 'pending' && item.deadline < today
    );

    // 列表頁只負責呈現，避免 GET 請求更新資料時觸發正式區 statement timeout。
    overdueItems.forEach((item: any) => {
      item.status = 'overdue';
    });

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
        totalCount: visibleImprovements.length,
        visibleCount: improvements.length,
        canViewAll,
        canViewOwnScope,
        managedStoreCount,
        ownInspectionCount,
      },
    });
  } catch (error: any) {
    console.error('載入待改善事項失敗:', error);
    const stage = error instanceof ImprovementQueryError ? error.stage : 'unknown';
    return NextResponse.json(
      { error: `${stage}: ${error.message || '載入待改善事項失敗'}` },
      { status: 500 }
    );
  }
}
