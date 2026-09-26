import { createClient } from '@/lib/supabase/server';

export const INVENTORY_BALANCE_VIEW_PERMISSION = 'general_affairs.inventory_balance.view';
export const INVENTORY_TRANSACTION_VIEW_PERMISSION = 'general_affairs.inventory_transaction.view';
export const INVENTORY_TRANSACTION_MANAGE_PERMISSION = 'general_affairs.inventory_transaction.manage';
export const PART_VIEW_PERMISSION = 'general_affairs.part.view';
export const PART_MANAGE_PERMISSION = 'general_affairs.part.manage';

async function currentUserHasPermission(permissionCode: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('current_user_has_permission', {
    p_permission_code: permissionCode,
  });

  if (error) {
    console.error('總務庫存交易權限檢查錯誤:', error);
    return false;
  }

  return data === true;
}

export async function canReadInventoryBalances() {
  return (
    await currentUserHasPermission(INVENTORY_BALANCE_VIEW_PERMISSION) ||
    await currentUserHasPermission(INVENTORY_TRANSACTION_MANAGE_PERMISSION)
  );
}

export async function canReadInventoryTransactions() {
  return (
    await currentUserHasPermission(INVENTORY_TRANSACTION_VIEW_PERMISSION) ||
    await currentUserHasPermission(INVENTORY_TRANSACTION_MANAGE_PERMISSION)
  );
}

export async function canPostInventoryTransactions() {
  return currentUserHasPermission(INVENTORY_TRANSACTION_MANAGE_PERMISSION);
}

export async function canReadInventoryTransactionParts() {
  return (
    await currentUserHasPermission(PART_VIEW_PERMISSION) ||
    await currentUserHasPermission(PART_MANAGE_PERMISSION)
  );
}

export async function isCurrentUserStoreManager() {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('store_managers')
    .select('store_id', { count: 'exact', head: true });

  if (error) {
    console.error('總務庫存門市管理者權限檢查錯誤:', error);
    return false;
  }

  return (count || 0) > 0;
}

export async function canAccessInventoryBalances() {
  if (await canReadInventoryBalances()) return true;
  return isCurrentUserStoreManager();
}

export async function canAccessInventoryTransactions() {
  if (await canReadInventoryTransactions()) return true;
  return isCurrentUserStoreManager();
}
