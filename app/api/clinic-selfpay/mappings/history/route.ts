import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getAuthorizedStores, getCurrentUserId } from '../../_lib';

export async function GET(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    if (!userId) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const storeId = (request.nextUrl.searchParams.get('store_id') || '').trim();
    const healthInsuranceCode = (request.nextUrl.searchParams.get('health_insurance_code') || '').trim();

    if (!storeId || !healthInsuranceCode) {
      return NextResponse.json({ success: false, error: '缺少 store_id 或 health_insurance_code' }, { status: 400 });
    }

    const stores = await getAuthorizedStores(userId);
    if (!stores.some((s) => s.id === storeId)) {
      return NextResponse.json({ success: false, error: '無此門市查看權限' }, { status: 403 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('clinic_selfpay_price_entries')
      .select('year_month, health_insurance_code, product_code, product_name, member_price, cost_price, source_file_name, updated_at')
      .eq('store_id', storeId)
      .ilike('health_insurance_code', healthInsuranceCode)
      .order('year_month', { ascending: false });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
