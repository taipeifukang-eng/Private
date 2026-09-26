import { createClient } from '@/lib/supabase/server';
import {
  INVENTORY_BALANCE_VIEW_PERMISSION,
  INVENTORY_TRANSACTION_MANAGE_PERMISSION,
  INVENTORY_TRANSACTION_VIEW_PERMISSION,
  PART_MANAGE_PERMISSION,
  PART_VIEW_PERMISSION,
} from '@/lib/general-affairs/inventory/transactions/access';

export const INVENTORY_TRANSFER_VIEW_PERMISSION = 'general_affairs.inventory_transfer.view';
export const INVENTORY_TRANSFER_MANAGE_PERMISSION = 'general_affairs.inventory_transfer.manage';

async function currentUserHasPermission(permissionCode: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('current_user_has_permission', {
    p_permission_code: permissionCode,
  });

  if (error) {
    console.error('總務調撥與收貨權限檢查錯誤:', error);
    return false;
  }

  return data === true;
}

export async function canReadInventoryTransfers() {
  return (
    await currentUserHasPermission(INVENTORY_TRANSFER_VIEW_PERMISSION) ||
    await currentUserHasPermission(INVENTORY_TRANSFER_MANAGE_PERMISSION) ||
    await currentUserHasPermission(INVENTORY_TRANSACTION_VIEW_PERMISSION) ||
    await currentUserHasPermission(INVENTORY_TRANSACTION_MANAGE_PERMISSION) ||
    await currentUserHasPermission(INVENTORY_BALANCE_VIEW_PERMISSION)
  );
}

export async function canManageInventoryTransfers() {
  return (
    await currentUserHasPermission(INVENTORY_TRANSFER_MANAGE_PERMISSION) ||
    await currentUserHasPermission(INVENTORY_TRANSACTION_MANAGE_PERMISSION)
  );
}

export async function canReadTransferParts() {
  return (
    await currentUserHasPermission(PART_VIEW_PERMISSION) ||
    await currentUserHasPermission(PART_MANAGE_PERMISSION)
  );
}
