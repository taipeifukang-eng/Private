import { createClient } from '@/lib/supabase/server';

export const EQUIPMENT_TEMPLATE_VIEW_PERMISSION = 'general_affairs.equipment_template.view';
export const EQUIPMENT_TEMPLATE_MANAGE_PERMISSION = 'general_affairs.equipment_template.manage';
export const EQUIPMENT_VIEW_PERMISSION = 'general_affairs.equipment.view';
export const EQUIPMENT_MANAGE_PERMISSION = 'general_affairs.equipment.manage';

async function currentUserHasPermission(permissionCode: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('current_user_has_permission', {
    p_permission_code: permissionCode,
  });

  if (error) {
    console.error('總務設備權限檢查錯誤:', error);
    return false;
  }

  return data === true;
}

export async function canReadEquipmentTemplates() {
  return (
    await currentUserHasPermission(EQUIPMENT_TEMPLATE_VIEW_PERMISSION) ||
    await currentUserHasPermission(EQUIPMENT_TEMPLATE_MANAGE_PERMISSION)
  );
}

export async function canManageEquipmentTemplates() {
  return currentUserHasPermission(EQUIPMENT_TEMPLATE_MANAGE_PERMISSION);
}

export async function canReadEquipment() {
  return (
    await currentUserHasPermission(EQUIPMENT_VIEW_PERMISSION) ||
    await currentUserHasPermission(EQUIPMENT_MANAGE_PERMISSION)
  );
}

export async function canManageEquipment() {
  return currentUserHasPermission(EQUIPMENT_MANAGE_PERMISSION);
}

export async function isStoreManagerForStore(userId: string, storeId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('store_managers')
    .select('id')
    .eq('user_id', userId)
    .eq('store_id', storeId)
    .limit(1);

  if (error) {
    console.error('總務設備門市範圍檢查錯誤:', error);
    return false;
  }

  return (data || []).length > 0;
}
