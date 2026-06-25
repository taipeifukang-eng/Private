import { hasPermission } from '@/lib/permissions/check';

type SupabaseClientLike = {
  from: (table: string) => any;
};

type CampaignPublishState = {
  published_to_supervisors?: boolean | null;
  published_to_store_managers?: boolean | null;
  published_to_inventory_team?: boolean | null;
};

export type CampaignAudienceAccess = {
  canViewAll: boolean;
  canViewAsSupervisor: boolean;
  canViewAsStoreManager: boolean;
  canViewAsDepartment: boolean;
  isSupervisor: boolean;
  isStoreManager: boolean;
  isDepartmentAudience: boolean;
  managedStoreIds: string[];
  role: 'admin' | 'supervisor' | 'store_manager' | 'inventory_team' | 'member';
};

export async function getCampaignAudienceAccess(
  supabase: SupabaseClientLike,
  userId: string,
  campaign: CampaignPublishState
): Promise<CampaignAudienceAccess> {
  const canViewAll = await hasPermission(userId, 'activity.campaign.view_all');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, department, job_title')
    .eq('id', userId)
    .maybeSingle();

  const { data: managedStores } = await supabase
    .from('store_managers')
    .select('store_id, role_type')
    .eq('user_id', userId);

  const jobTitle = profile?.job_title || '';
  const department = profile?.department || '';
  const isSupervisor =
    jobTitle.includes('督導') ||
    (managedStores || []).some((m: any) => m.role_type === 'supervisor');
  const isStoreManager =
    ['店長', '代理店長', '督導(代理店長)'].includes(jobTitle) ||
    (managedStores || []).some((m: any) => m.role_type === 'store_manager');
  const isBusinessManager = department.startsWith('營業') && ['經理', '主管'].includes(jobTitle);
  const isInventoryTeam = department === '營業部-盤點組';
  const isMarketingWithAccess =
    department === '行銷部' && await hasPermission(userId, 'activity.management.access');
  const isBusinessAssistant = department === '營業部' && jobTitle === '助理';
  const isDepartmentAudience = isInventoryTeam || isMarketingWithAccess || isBusinessAssistant;

  const canViewAsSupervisor =
    (isSupervisor || isBusinessManager) && campaign.published_to_supervisors === true;
  const canViewAsStoreManager =
    isStoreManager && campaign.published_to_store_managers === true;
  const canViewAsDepartment =
    isDepartmentAudience && campaign.published_to_inventory_team === true;

  const managedStoreIds = (managedStores || [])
    .filter((m: any) => m.role_type === 'store_manager')
    .map((m: any) => m.store_id)
    .filter(Boolean);

  return {
    canViewAll,
    canViewAsSupervisor,
    canViewAsStoreManager,
    canViewAsDepartment,
    isSupervisor: isSupervisor || isBusinessManager,
    isStoreManager,
    isDepartmentAudience,
    managedStoreIds,
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

export function getCampaignAccessDeniedMessage(access: CampaignAudienceAccess): string {
  const unpublishedTargets: string[] = [];
  if (access.isSupervisor && !access.canViewAsSupervisor) unpublishedTargets.push('督導');
  if (access.isStoreManager && !access.canViewAsStoreManager) unpublishedTargets.push('店長');
  if (access.isDepartmentAudience && !access.canViewAsDepartment) {
    unpublishedTargets.push('盤點組/行銷部/營業部助理');
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
