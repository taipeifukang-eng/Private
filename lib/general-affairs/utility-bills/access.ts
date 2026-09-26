import { createClient } from '@/lib/supabase/server';

async function hasPermission(code: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('current_user_has_permission', { p_permission_code: code });
  if (error) return false;
  return data === true;
}

export async function canViewUtilityBills() {
  return await hasPermission('general_affairs.utility_bill.view') || await hasPermission('general_affairs.utility_bill.manage');
}

export async function canManageUtilityBills() {
  return hasPermission('general_affairs.utility_bill.manage');
}
