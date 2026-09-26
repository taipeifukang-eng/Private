import { createClient } from '@/lib/supabase/server';

export const PART_FULFILLMENT_VIEW_PERMISSION = 'general_affairs.part_fulfillment.view';
export const PART_FULFILLMENT_MANAGE_PERMISSION = 'general_affairs.part_fulfillment.manage';

async function currentUserHasPermission(permissionCode: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('current_user_has_permission', {
    p_permission_code: permissionCode,
  });

  if (error) {
    console.error('料件處理中心權限檢查錯誤:', error);
    return false;
  }
  return data === true;
}

export async function canReadPartFulfillments() {
  return (
    await currentUserHasPermission(PART_FULFILLMENT_VIEW_PERMISSION) ||
    await currentUserHasPermission(PART_FULFILLMENT_MANAGE_PERMISSION)
  );
}

export async function canManagePartFulfillments() {
  return currentUserHasPermission(PART_FULFILLMENT_MANAGE_PERMISSION);
}
