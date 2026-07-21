import { createClient } from '@/lib/supabase/server';
import type { CategoryConfig, GeneralAffairsCategoryType } from './types';

export const CATEGORY_CONFIGS: Record<GeneralAffairsCategoryType, CategoryConfig> = {
  equipment: {
    type: 'equipment',
    table: 'ga_equipment_categories',
    viewPermission: 'general_affairs.equipment_category.view',
    managePermission: 'general_affairs.equipment_category.manage',
  },
  facility: {
    type: 'facility',
    table: 'ga_facility_categories',
    viewPermission: 'general_affairs.facility_category.view',
    managePermission: 'general_affairs.facility_category.manage',
  },
  part: {
    type: 'part',
    table: 'ga_part_categories',
    viewPermission: 'general_affairs.part_category.view',
    managePermission: 'general_affairs.part_category.manage',
  },
};

export function getCategoryConfig(type: string | null | undefined) {
  if (type === 'equipment' || type === 'facility' || type === 'part') {
    return CATEGORY_CONFIGS[type];
  }
  return null;
}

async function currentUserHasPermission(permissionCode: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('current_user_has_permission', {
    p_permission_code: permissionCode,
  });

  if (error) {
    console.error('總務分類權限檢查錯誤:', error);
    return false;
  }

  return data === true;
}

export async function canReadCategory(_userId: string, config: CategoryConfig) {
  for (const permissionCode of [
    'general_affairs.service_center.access',
    config.viewPermission,
    config.managePermission,
  ]) {
    if (await currentUserHasPermission(permissionCode)) return true;
  }

  return false;
}

export async function canManageCategory(_userId: string, config: CategoryConfig) {
  return currentUserHasPermission(config.managePermission);
}
