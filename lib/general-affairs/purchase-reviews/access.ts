import { createClient } from '@/lib/supabase/server';
import { canManageServiceRequests, canReadAllServiceRequests } from '@/lib/general-affairs/service-requests/access';

export const GA_PURCHASE_REVIEW_VIEW_PERMISSION = 'general_affairs.purchase_review.view';
export const GA_PURCHASE_REVIEW_MANAGE_PERMISSION = 'general_affairs.purchase_review.manage';

async function currentUserHasPermission(permissionCode: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('current_user_has_permission', {
    p_permission_code: permissionCode,
  });

  if (error) {
    console.error('總務採購評估權限檢查錯誤:', error);
    return false;
  }

  return data === true;
}

export async function canReadPurchaseReviews() {
  return (
    await currentUserHasPermission(GA_PURCHASE_REVIEW_VIEW_PERMISSION) ||
    await currentUserHasPermission(GA_PURCHASE_REVIEW_MANAGE_PERMISSION) ||
    await canReadAllServiceRequests() ||
    await canManageServiceRequests()
  );
}

export async function canManagePurchaseReviews() {
  return (
    await currentUserHasPermission(GA_PURCHASE_REVIEW_MANAGE_PERMISSION) ||
    await canManageServiceRequests()
  );
}
