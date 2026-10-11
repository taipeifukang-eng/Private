import { NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

export async function getPrescriptionReportContext() {
  const sessionClient = await createClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: '未登入' }, { status: 401 }) };

  const canView = await hasAnyPermission(user.id, ['performance.view', 'performance.edit']);
  if (!canView) {
    return { response: NextResponse.json({ error: '沒有查看業績資料的權限' }, { status: 403 }) };
  }

  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    console.error('[Prescription report] profile lookup failed:', profileError);
    return { response: NextResponse.json({ error: '讀取使用者角色失敗' }, { status: 500 }) };
  }
  if (!profile) {
    return { response: NextResponse.json({ error: '找不到登入者的人員資料，請確認帳號與人員主檔的連結' }, { status: 403 }) };
  }

  const { data: storeRows, error: storesError } = await admin
    .from('stores')
    .select('id, store_code, store_name')
    .eq('is_active', true)
    .order('store_code');

  if (storesError) {
    return { response: NextResponse.json({ error: storesError.message }, { status: 500 }) };
  }

  const allStores = storeRows || [];
  let stores = allStores;
  if (!['admin', 'supervisor'].includes(profile.role)) {
    const { data: assignments, error: assignmentsError } = await admin
      .from('store_managers')
      .select('store_id')
      .eq('user_id', user.id);

    if (assignmentsError) {
      console.error('[Prescription report] store assignments lookup failed:', assignmentsError);
      return { response: NextResponse.json({ error: '讀取使用者門市指派失敗' }, { status: 500 }) };
    }

    const assignedIds = new Set((assignments || []).map(row => row.store_id));
    stores = allStores.filter(store => assignedIds.has(store.id));
  }

  return { user, admin, stores };
}
