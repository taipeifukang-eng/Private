import { NextRequest, NextResponse } from 'next/server';
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

/**
 * GET /api/performance-bonus
 * 查詢每月獎金匯入紀錄
 * Query: year_month (必填), store_id[], supervisor_id (可選)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: '未登入' }, { status: 401 });

    // RBAC: 檢視權限（admin 保底放行）
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      const canView = await hasPermission(user.id, 'performance.bonus.view');
      if (!canView) {
        return NextResponse.json({ error: '無檢視權限' }, { status: 403 });
      }
    }

    const { searchParams } = new URL(request.url);
    const yearMonth   = searchParams.get('year_month') || '';
    const storeIds    = searchParams.getAll('store_id');   // 可多個
    const supervisorId = searchParams.get('supervisor_id') || '';

    console.log('[GET /api/performance-bonus] Query:', { yearMonth, storeIds, supervisorId, userId: user.id });

    const admin = createAdminClient();

    // 以 supervisor_id 推導其管理的門市
    let resolvedStoreIds = storeIds;
    if (supervisorId && storeIds.length === 0) {
      const { data: managed } = await admin
        .from('store_managers')
        .select('store_id')
        .eq('user_id', supervisorId);
      resolvedStoreIds = (managed || []).map(m => m.store_id);
    }

    let q = admin
      .from('monthly_bonus_records')
      .select(`
        *,
        store:stores!monthly_bonus_records_store_id_fkey(store_code, store_name)
      `)
      .order('year_month', { ascending: false })
      .order('store_id')
      .order('employee_code');

    if (yearMonth) q = q.eq('year_month', yearMonth);
    if (resolvedStoreIds.length > 0) q = q.in('store_id', resolvedStoreIds);

    const { data, error } = await q;
    console.log('[GET /api/performance-bonus] Result:', { count: data?.length || 0, error: error?.message });
    
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, records: data || [] });
  } catch (e: any) {
    console.error('[GET /api/performance-bonus]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
