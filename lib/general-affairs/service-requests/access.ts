import { createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

export const GA_REQUEST_CREATE_PERMISSION = 'general_affairs.request.create';
export const GA_REQUEST_VIEW_OWN_STORE_PERMISSION = 'general_affairs.request.view_own_store';
export const GA_REQUEST_VIEW_ALL_PERMISSION = 'general_affairs.request.view_all';
export const GA_REQUEST_MANAGE_PERMISSION = 'general_affairs.request.manage';
export const GA_REQUEST_COMMENT_OWN_STORE_PERMISSION = 'general_affairs.request.comment_own_store';
export const GA_REQUEST_CONFIRM_OWN_STORE_PERMISSION = 'general_affairs.request.confirm_own_store';
export const GA_REQUEST_CREATE_ANY_STORE_PERMISSIONS = [
  GA_REQUEST_MANAGE_PERMISSION,
  'store.manage',
  'employee.manage',
] as const;

async function currentUserHasPermission(permissionCode: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('current_user_has_permission', {
    p_permission_code: permissionCode,
  });

  if (error) {
    console.error('總務需求單權限檢查錯誤:', error);
    return false;
  }

  return data === true;
}

export async function canCreateServiceRequest() {
  return currentUserHasPermission(GA_REQUEST_CREATE_PERMISSION);
}

export async function canReadAllServiceRequests() {
  return (
    await currentUserHasPermission(GA_REQUEST_VIEW_ALL_PERMISSION) ||
    await currentUserHasPermission(GA_REQUEST_MANAGE_PERMISSION)
  );
}

export async function canReadOwnStoreServiceRequests() {
  return currentUserHasPermission(GA_REQUEST_VIEW_OWN_STORE_PERMISSION);
}

export async function canManageServiceRequests() {
  return currentUserHasPermission(GA_REQUEST_MANAGE_PERMISSION);
}

export async function canCommentOwnStoreServiceRequests() {
  return currentUserHasPermission(GA_REQUEST_COMMENT_OWN_STORE_PERMISSION);
}

export async function canConfirmOwnStoreServiceRequests() {
  return currentUserHasPermission(GA_REQUEST_CONFIRM_OWN_STORE_PERMISSION);
}

export async function canCreateServiceRequestForAnyStore(userId: string) {
  return hasAnyPermission(userId, GA_REQUEST_CREATE_ANY_STORE_PERMISSIONS);
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
    console.error('總務需求單門市範圍檢查錯誤:', error);
    return false;
  }

  return (data || []).length > 0;
}
