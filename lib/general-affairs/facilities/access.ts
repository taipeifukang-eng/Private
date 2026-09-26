import { createClient } from '@/lib/supabase/server';

export const FACILITY_VIEW_PERMISSION = 'general_affairs.facility.view';
export const FACILITY_MANAGE_PERMISSION = 'general_affairs.facility.manage';

async function currentUserHasPermission(permissionCode: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('current_user_has_permission', {
    p_permission_code: permissionCode,
  });

  if (error) {
    console.error('總務設施權限檢查錯誤:', error);
    return false;
  }

  return data === true;
}

export async function canReadFacilities() {
  return (
    await currentUserHasPermission(FACILITY_VIEW_PERMISSION) ||
    await currentUserHasPermission(FACILITY_MANAGE_PERMISSION)
  );
}

export async function canManageFacilities() {
  return currentUserHasPermission(FACILITY_MANAGE_PERMISSION);
}
