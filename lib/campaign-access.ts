import { hasAnyPermission, hasPermission } from '@/lib/permissions/check';
import type { PermissionSnapshot } from '@/lib/permissions/snapshot';

export { hasAnyPermission };

/**
 * 活動專案查看範圍：統一規則（docs/campaign-view-scope-spec.md）
 *
 * 所有活動相關 API 一律呼叫本檔，不要在各 API 自行判斷身分或範圍。
 *
 * 1. 權限閘門：要讀活動資料，需有 view_own 或 view_all。
 *    第一階段期間舊的 activity.campaign.view 視同 view_own（第二階段移除）。
 * 2. 發布閘門：沒有 view_all 者，只看得到已發布給其身分的活動，且需同時有 view_own。
 * 3. 身分一律以 store_managers 任命為準（不再看 profiles.job_title）：
 *    - 任一 role_type='supervisor' 任命 => 督導
 *    - role_type='store_manager' 任命 => 店長（雙店長看兩間）
 * 4. 範圍：店長只看被任命門市；督導在活動檢視內看全部門市；view_all 看全部。
 * 5. 部門身分不再自動看全部；需 view_all。唯一例外：盤點組（department=營業部-盤點組）
 *    持 view_own 時，視同「部門受眾」可看發布給盤點組的活動，範圍為全部門市。
 * 6. 持對應 edit 權限者，在對應資料上看全部（bypass）。
 */

type SupabaseClientLike = {
  from: (table: string) => any;
};

type CampaignPublishState = {
  published_to_supervisors?: boolean | null;
  published_to_store_managers?: boolean | null;
  published_to_inventory_team?: boolean | null;
};

export const CAMPAIGN_PERM = {
  viewOwn: 'activity.campaign.view_own',
  viewAll: 'activity.campaign.view_all',
  /** 第一階段：舊 view 視同 view_own，第二階段移除 */
  legacyView: 'activity.campaign.view',
  campaignEdit: 'activity.campaign.edit',
  manage: 'activity.manage',
  storeDetailEdit: 'activity.store_detail.edit',
  checklistEdit: 'activity.checklist.edit',
  equipmentTripEdit: 'activity.equipment_trip.edit',
  marketingPublish: 'activity.marketing.publish',
  merchandisePublish: 'activity.merchandise.publish',
  supportRequestEdit: 'activity.support_request.edit',
  supportAssignEdit: 'activity.support_assign.edit',
  staffOverviewView: 'activity.staff_overview.view',
} as const;

/** 盤點組部門名稱（部門受眾，持 view_own 時可看發布給盤點組的活動） */
export const INVENTORY_TEAM_DEPARTMENT = '營業部-盤點組';

export type CampaignAudienceAccess = {
  canViewAll: boolean;
  /** 有 view_own（或第一階段的舊 view） */
  hasViewOwn: boolean;
  canViewAsSupervisor: boolean;
  canViewAsStoreManager: boolean;
  canViewAsDepartment: boolean;
  isSupervisor: boolean;
  isStoreManager: boolean;
  isDepartmentAudience: boolean;
  /** role_type='store_manager' 的被任命門市 */
  managedStoreIds: string[];
  role: 'admin' | 'supervisor' | 'store_manager' | 'inventory_team' | 'member';
};

export type CampaignStoreScope =
  | { all: true }
  | { all: false; storeIds: string[] };

/** 活動查看的權限閘門（view_own / 舊 view / view_all） */
export async function hasCampaignViewPermission(userId: string): Promise<{
  viewAll: boolean;
  viewOwn: boolean;
}> {
  const [viewAll, viewOwn, legacyView] = await Promise.all([
    hasPermission(userId, CAMPAIGN_PERM.viewAll),
    hasPermission(userId, CAMPAIGN_PERM.viewOwn),
    hasPermission(userId, CAMPAIGN_PERM.legacyView),
  ]);
  return { viewAll, viewOwn: viewOwn || legacyView };
}

/**
 * 活動檢視入口（/activity-management）：
 * 有 view_all，或有 view_own（第一階段含舊 view）且（在 store_managers 至少有一筆任命，或部門為盤點組）。
 * 避免全員預設角色（如 member）持 view_own 時，所有員工都看到點進去是空頁的入口。
 */
export async function canEnterCampaignView(
  supabase: SupabaseClientLike,
  userId: string
): Promise<boolean> {
  const { viewAll, viewOwn } = await hasCampaignViewPermission(userId);
  if (viewAll) return true;
  if (!viewOwn) return false;
  const [{ data: appointments }, { data: profile }] = await Promise.all([
    supabase.from('store_managers').select('id').eq('user_id', userId).limit(1),
    supabase.from('profiles').select('department').eq('id', userId).maybeSingle(),
  ]);
  if (appointments && appointments.length > 0) return true;
  // 盤點組（部門受眾）沒有門市任命，但可看發布給盤點組的活動，入口需與資料可見性一致
  return profile?.department === INVENTORY_TEAM_DEPARTMENT;
}

/**
 * 同 canEnterCampaignView，但權限與部門改用已載入的 PermissionSnapshot 在記憶體判斷
 * （省下 3 次 hasPermission + 1 次 profiles 查詢）。判斷規則必須與 canEnterCampaignView 完全相同。
 */
export async function canEnterCampaignViewWithSnapshot(
  supabase: SupabaseClientLike,
  userId: string,
  snapshot: PermissionSnapshot
): Promise<boolean> {
  const viewAll = snapshot.has(CAMPAIGN_PERM.viewAll);
  if (viewAll) return true;
  const viewOwn = snapshot.has(CAMPAIGN_PERM.viewOwn) || snapshot.has(CAMPAIGN_PERM.legacyView);
  if (!viewOwn) return false;
  const { data: appointments } = await supabase.from('store_managers').select('id').eq('user_id', userId).limit(1);
  if (appointments && appointments.length > 0) return true;
  // 盤點組（部門受眾）沒有門市任命，但可看發布給盤點組的活動，入口需與資料可見性一致
  return snapshot.profile?.department === INVENTORY_TEAM_DEPARTMENT;
}

export type CampaignViewer = {
  canViewAll: boolean;
  hasViewOwn: boolean;
  isSupervisor: boolean;
  isStoreManager: boolean;
  isDepartmentAudience: boolean;
  managedStoreIds: string[];
};

/** 載入使用者的權限與任命（一次查詢，可重複套用到多個活動） */
export async function loadCampaignViewer(
  supabase: SupabaseClientLike,
  userId: string
): Promise<CampaignViewer> {
  const [{ viewAll: canViewAll, viewOwn: hasViewOwn }, profileRes, managedRes] = await Promise.all([
    hasCampaignViewPermission(userId),
    supabase.from('profiles').select('department').eq('id', userId).maybeSingle(),
    supabase.from('store_managers').select('store_id, role_type').eq('user_id', userId),
  ]);

  const department: string = profileRes?.data?.department || '';
  const appointments: { store_id: string | null; role_type: string }[] = managedRes?.data || [];

  return {
    canViewAll,
    hasViewOwn,
    isSupervisor: appointments.some((m) => m.role_type === 'supervisor'),
    isStoreManager: appointments.some((m) => m.role_type === 'store_manager'),
    isDepartmentAudience: department === INVENTORY_TEAM_DEPARTMENT,
    managedStoreIds: appointments
      .filter((m) => m.role_type === 'store_manager')
      .map((m) => m.store_id)
      .filter((id): id is string => Boolean(id)),
  };
}

export function evaluateCampaignAudience(
  viewer: CampaignViewer,
  campaign: CampaignPublishState
): CampaignAudienceAccess {
  const { canViewAll, hasViewOwn, isSupervisor, isStoreManager, isDepartmentAudience } = viewer;

  // 發布閘門：沒有 view_all 者需同時有 view_own，且活動已發布給其身分
  const canViewAsSupervisor =
    hasViewOwn && isSupervisor && campaign.published_to_supervisors === true;
  const canViewAsStoreManager =
    hasViewOwn && isStoreManager && campaign.published_to_store_managers === true;
  const canViewAsDepartment =
    hasViewOwn && isDepartmentAudience && campaign.published_to_inventory_team === true;

  return {
    canViewAll,
    hasViewOwn,
    canViewAsSupervisor,
    canViewAsStoreManager,
    canViewAsDepartment,
    isSupervisor,
    isStoreManager,
    isDepartmentAudience,
    managedStoreIds: viewer.managedStoreIds,
    role: canViewAll
      ? 'admin'
      : canViewAsSupervisor
        ? 'supervisor'
        : canViewAsStoreManager
          ? 'store_manager'
          : canViewAsDepartment
            ? 'inventory_team'
            : 'member',
  };
}

export async function getCampaignAudienceAccess(
  supabase: SupabaseClientLike,
  userId: string,
  campaign: CampaignPublishState
): Promise<CampaignAudienceAccess> {
  return evaluateCampaignAudience(await loadCampaignViewer(supabase, userId), campaign);
}

export function getCampaignAccessDeniedMessage(access: CampaignAudienceAccess): string {
  if (!access.canViewAll && !access.hasViewOwn) {
    return '權限不足：需要 activity.campaign.view_own 或 activity.campaign.view_all 權限';
  }

  const unpublishedTargets: string[] = [];
  if (access.isSupervisor && !access.canViewAsSupervisor) unpublishedTargets.push('督導');
  if (access.isStoreManager && !access.canViewAsStoreManager) unpublishedTargets.push('店長');
  if (access.isDepartmentAudience && !access.canViewAsDepartment) {
    unpublishedTargets.push('盤點組');
  }

  if (unpublishedTargets.length > 0) {
    return `此活動尚未發布給${unpublishedTargets.join('、')}`;
  }

  return '權限不足或此活動尚未發布給您的身分';
}

export function hasCampaignPublishedAccess(access: CampaignAudienceAccess): boolean {
  return access.canViewAll ||
    access.canViewAsSupervisor ||
    access.canViewAsStoreManager ||
    access.canViewAsDepartment;
}

/**
 * 讀取範圍：回傳「全部門市」或「限定門市 id 清單」。
 * @param bypassAll 呼叫者已確認持有對應 edit 權限（維持看全部）
 */
export function getCampaignStoreScope(
  access: CampaignAudienceAccess,
  bypassAll = false
): CampaignStoreScope {
  if (bypassAll || access.canViewAll || access.canViewAsSupervisor || access.canViewAsDepartment) {
    return { all: true };
  }
  if (access.canViewAsStoreManager) {
    return { all: false, storeIds: access.managedStoreIds };
  }
  // 其餘（未通過發布閘門、無 bypass）一律不給範圍，fail closed
  return { all: false, storeIds: [] };
}

export function canAccessStore(scope: CampaignStoreScope, storeId: string | null | undefined): boolean {
  if (scope.all) return true;
  return !!storeId && scope.storeIds.includes(storeId);
}

/** 讀取範圍的 bypass：持 activity.manage 或指定 edit 權限者維持看全部 */
export async function hasCampaignScopeBypass(userId: string, editCodes: string[]): Promise<boolean> {
  return hasAnyPermission(userId, [CAMPAIGN_PERM.manage, ...editCodes]);
}

export type CampaignWriteAuth =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * 寫入檢查（補洞 API 共用）。
 * - 持 activity.manage 或 editCodes 任一者：可寫全部門市。
 * - 持 unappointedCodes 任一者且沒有任何門市任命（總部人員的舊有輔助授權）：可寫。
 * - view_all 本身不放行寫入；但 view_all 視同 view_own 的讀權，依任命身分寫入。
 *   需有 view_own（或 view_all）、活動已發布給其身分，且：
 *   督導（有 supervisor 任命）依活動檢視範圍可寫全部門市；
 *   店長只能寫自己被任命的門市（所有 storeIds 都必須在任命內）。
 */
export async function authorizeCampaignStoreWrite(
  supabase: SupabaseClientLike,
  userId: string,
  campaignId: string | null | undefined,
  storeIds: (string | null | undefined)[],
  editCodes: string[],
  unappointedCodes: string[] = [],
  /**
   * 該資料表 RLS 寫入 policy 實際要求的權限（除 activity.manage 外）。
   * 非 manage 使用者若沒有其中任一個，RLS 一定會擋（回 500），所以 API 先回 403。
   * 空陣列表示 RLS 另有依任命放行的規則（如 completions），不在此檢查。
   */
  rlsWriteCodes: string[] = []
): Promise<CampaignWriteAuth> {
  // activity.manage 為活動總管理權限（RLS 寫入政策亦放行），視同持有所有 edit 權
  if (await hasCampaignScopeBypass(userId, editCodes)) {
    return { ok: true };
  }

  if (
    rlsWriteCodes.length > 0 &&
    !(await hasAnyPermission(userId, [CAMPAIGN_PERM.manage, ...rlsWriteCodes]))
  ) {
    return {
      ok: false,
      status: 403,
      error: `權限不足：需要 ${rlsWriteCodes.join(' 或 ')} 權限`,
    };
  }

  if (unappointedCodes.length > 0 && (await hasAnyPermission(userId, unappointedCodes))) {
    const { data: appointments } = await supabase
      .from('store_managers')
      .select('id')
      .eq('user_id', userId)
      .limit(1);
    if (!appointments || appointments.length === 0) {
      return { ok: true };
    }
  }

  if (!campaignId) {
    return { ok: false, status: 400, error: '缺少 campaign_id' };
  }

  const { data: campaign } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .maybeSingle();
  if (!campaign) {
    return { ok: false, status: 404, error: '找不到活動' };
  }

  // view_all 角色在 migration 正規化後不再持有 view_own，讀權視為等同 view_own：
  // 有任命者依任命身分寫入（店長只寫任命門市、督導寫全部），且活動仍須已發布給該身分。
  // view_all 本身不放行寫入：沒有任何任命就沒有可用的身分，仍回 403。
  const viewer = await loadCampaignViewer(supabase, userId);
  const access = evaluateCampaignAudience(
    { ...viewer, hasViewOwn: viewer.hasViewOwn || viewer.canViewAll },
    campaign
  );
  if (!access.hasViewOwn) {
    return {
      ok: false,
      status: 403,
      error: '權限不足：需要 activity.campaign.view_own 或對應的編輯權限',
    };
  }
  if (!(access.canViewAsSupervisor || access.canViewAsStoreManager || access.canViewAsDepartment)) {
    return { ok: false, status: 403, error: getCampaignAccessDeniedMessage(access) };
  }

  if (access.canViewAsSupervisor || access.canViewAsDepartment) {
    return { ok: true };
  }

  // 店長：只能寫被任命門市（不經 getCampaignStoreScope，避免 canViewAll 擴大範圍）
  const scope: CampaignStoreScope = { all: false, storeIds: access.managedStoreIds };
  const targets = storeIds.filter((id): id is string => Boolean(id));
  if (targets.length === 0 || !targets.every((id) => canAccessStore(scope, id))) {
    return { ok: false, status: 403, error: '權限不足：只能操作自己被任命的門市' };
  }
  return { ok: true };
}
