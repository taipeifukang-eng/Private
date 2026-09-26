import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import {
  canCreateServiceRequest,
  canCreateServiceRequestForAnyStore,
  isStoreManagerForStore,
} from '@/lib/general-affairs/service-requests/access';

export const dynamic = 'force-dynamic';

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error || '標的資料載入失敗');
  return NextResponse.json({ success: false, error: message }, { status });
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canCreateServiceRequest()) return jsonError('沒有建立總務需求單權限', 403);

    const { searchParams } = new URL(request.url);
    const storeId = searchParams.get('storeId')?.trim() || '';
    if (!storeId || !isUuid(storeId)) return jsonError('請選擇門市', 400);

    const canCreateAnyStore = await canCreateServiceRequestForAnyStore(user.id);
    if (!canCreateAnyStore && !await isStoreManagerForStore(user.id, storeId)) {
      return jsonError('只能查詢自己可建立需求的門市標的', 403);
    }

    const adminSupabase = createAdminClient();
    const [equipmentResult, facilityResult] = await Promise.all([
      adminSupabase
        .from('ga_equipment')
        .select('id, name, asset_code, barcode, brand, model, area, location_detail')
        .eq('store_id', storeId)
        .is('deleted_at', null)
        .order('name', { ascending: true })
        .limit(200),
      adminSupabase
        .from('ga_facilities')
        .select('id, name, facility_code, area, location_detail')
        .eq('store_id', storeId)
        .is('deleted_at', null)
        .order('name', { ascending: true })
        .limit(200),
    ]);

    if (equipmentResult.error) throw equipmentResult.error;
    if (facilityResult.error) throw facilityResult.error;

    return NextResponse.json({
      success: true,
      equipment: equipmentResult.data || [],
      facilities: facilityResult.data || [],
    });
  } catch (error) {
    return jsonError(error);
  }
}
