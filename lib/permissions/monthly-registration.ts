import { createAdminClient } from '@/lib/supabase/server';
import { hasPermission } from './check';

export class MonthlyRegistrationError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// Use RBAC rather than legacy profile titles; restrict every privileged write
// to the user's assigned store (or explicit all-store access) and unlocked month.
export async function authorizeMonthlyRegistration(
  userId: string,
  storeId: string,
  month: string,
  permission: 'monthly.allowance.edit_support_bonus' | 'monthly.status.add_employee' = 'monthly.allowance.edit_support_bonus',
) {
  if (!(await hasPermission(userId, permission))) {
    throw new MonthlyRegistrationError('沒有此項登記權限', 403);
  }
  if (!storeId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new MonthlyRegistrationError('門市或月份不正確', 400);
  }
  const db = createAdminClient();
  if (!(await hasPermission(userId, 'monthly.status.view_all'))) {
    const { data, error } = await db.from('store_managers').select('id')
      .eq('user_id', userId).eq('store_id', storeId).limit(1).maybeSingle();
    if (error) throw error;
    if (!data) throw new MonthlyRegistrationError('您未被指派管理此門市', 403);
  }
  const { data: summary, error } = await db.from('monthly_store_summary').select('store_status')
    .eq('store_id', storeId).eq('year_month', month).maybeSingle();
  if (error) throw error;
  if (summary?.store_status === 'confirmed') {
    throw new MonthlyRegistrationError('此月份已確認，無法修改登記資料', 409);
  }
  return db;
}
