import { createClient } from '@/lib/supabase/server';

export const INVENTORY_LOCATION_VIEW_PERMISSION = 'general_affairs.inventory_location.view';
export const INVENTORY_LOCATION_MANAGE_PERMISSION = 'general_affairs.inventory_location.manage';

async function currentUserHasPermission(permissionCode: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('current_user_has_permission', {
    p_permission_code: permissionCode,
  });

  if (error) {
    console.error('總務庫存位置權限檢查錯誤:', error);
    return false;
  }

  return data === true;
}

export async function canReadInventoryLocations() {
  return (
    await currentUserHasPermission(INVENTORY_LOCATION_VIEW_PERMISSION) ||
    await currentUserHasPermission(INVENTORY_LOCATION_MANAGE_PERMISSION)
  );
}

export async function canManageInventoryLocations() {
  return currentUserHasPermission(INVENTORY_LOCATION_MANAGE_PERMISSION);
}

export async function canAccessInventoryLocations() {
  if (await canReadInventoryLocations()) return true;

  const supabase = await createClient();
  const { count, error } = await supabase
    .from('store_managers')
    .select('store_id', { count: 'exact', head: true });

  if (error) {
    console.error('總務庫存位置門市管理者權限檢查錯誤:', error);
    return false;
  }

  return (count || 0) > 0;
}
