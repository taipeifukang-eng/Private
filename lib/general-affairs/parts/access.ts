import { createClient } from '@/lib/supabase/server';

export const PART_VIEW_PERMISSION = 'general_affairs.part.view';
export const PART_MANAGE_PERMISSION = 'general_affairs.part.manage';

async function currentUserHasPermission(permissionCode: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('current_user_has_permission', {
    p_permission_code: permissionCode,
  });

  if (error) {
    console.error('總務料件權限檢查錯誤:', error);
    return false;
  }

  return data === true;
}

export async function canReadParts() {
  return (
    await currentUserHasPermission(PART_VIEW_PERMISSION) ||
    await currentUserHasPermission(PART_MANAGE_PERMISSION)
  );
}

export async function canManageParts() {
  return currentUserHasPermission(PART_MANAGE_PERMISSION);
}

export async function canAccessPartCatalog() {
  if (await canReadParts()) return true;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('current_user_is_store_manager');
  if (error) {
    console.error('總務料件門市管理者權限檢查錯誤:', error);
    return false;
  }

  return data === true;
}
