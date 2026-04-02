import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getAuthorizedStores, getClinicSelfpayAccess, getCurrentUserId } from '../_lib';

export async function GET(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const access = await getClinicSelfpayAccess(userId);
    if (!access.canUseCalculator) {
      return NextResponse.json({ success: false, error: '無毛利計算查閱權限' }, { status: 403 });
    }

    const stores = await getAuthorizedStores(userId);
    if (!stores.length) {
      return NextResponse.json({ success: true, data: [] });
    }

    const url = new URL(request.url);
    const yearMonth = (url.searchParams.get('year_month') || '').trim();
    const storeId = (url.searchParams.get('store_id') || '').trim();

    const admin = createAdminClient();
    let query = admin
      .from('clinic_selfpay_claim_batches')
      .select('id, store_id, year_month, clinic_code, clinic_name, period_start, period_end, item_count, total_qty, total_billing_amount, total_gross_profit_amount, imported_at')
      .in('store_id', stores.map((s) => s.id))
      .order('imported_at', { ascending: false })
      .limit(100);

    if (yearMonth) query = query.eq('year_month', yearMonth);
    if (storeId) query = query.eq('store_id', storeId);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const storeMap = new Map(stores.map((s) => [s.id, s]));
    const mapped = (data || []).map((row: any) => ({
      ...row,
      store_code: storeMap.get(row.store_id)?.store_code || '',
      store_name: storeMap.get(row.store_id)?.store_name || '',
    }));

    return NextResponse.json({ success: true, data: mapped });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
