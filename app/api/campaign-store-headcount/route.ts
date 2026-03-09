import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/campaign-store-headcount
 * 查詢活動門市的人員預估頭數
 * Query: campaign_id (required), store_id (optional)
 *
 * POST /api/campaign-store-headcount
 * 儲存門市的額外支援人數預估
 * Body: { campaign_id, store_id, extra_support_count, notes? }
 */

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { searchParams } = request.nextUrl;
    const campaignId = searchParams.get('campaign_id');
    const storeId = searchParams.get('store_id');

    if (!campaignId) {
      return NextResponse.json({ success: false, error: '缺少 campaign_id' }, { status: 400 });
    }

    // 查詢頭數設定
    let hcQuery = supabase
      .from('campaign_store_headcount')
      .select('campaign_id, store_id, extra_support_count, supervisor_count, notes, updated_at')
      .eq('campaign_id', campaignId);
    if (storeId) hcQuery = hcQuery.eq('store_id', storeId);

    const { data: hcData, error: hcError } = await hcQuery;
    if (hcError) {
      if (hcError.code === '42P01') {
        // 資料表還不存在，回傳空結果
        return NextResponse.json({ success: true, data: [] });
      }
      return NextResponse.json({ success: false, error: hcError.message }, { status: 500 });
    }

    // 查詢每間門市已確認的本店人員數量
    let ownQuery = supabase
      .from('campaign_store_own_staff')
      .select('store_id')
      .eq('campaign_id', campaignId);
    if (storeId) ownQuery = ownQuery.eq('store_id', storeId);

    const { data: ownData, error: ownError } = await ownQuery;
    if (ownError && ownError.code !== '42P01') {
      return NextResponse.json({ success: false, error: ownError.message }, { status: 500 });
    }

    // 計算每間門市的 own_staff_count
    const ownCount: Record<string, number> = {};
    for (const row of ownData || []) {
      ownCount[row.store_id] = (ownCount[row.store_id] || 0) + 1;
    }

    // 合併
    const result = (hcData || []).map(row => ({
      store_id: row.store_id,
      extra_support_count: row.extra_support_count ?? 0,
      supervisor_count: row.supervisor_count ?? 0,
      notes: row.notes || '',
      own_staff_count: ownCount[row.store_id] || 0,
      total: (ownCount[row.store_id] || 0) + (row.extra_support_count ?? 0) + (row.supervisor_count ?? 0),
      updated_at: row.updated_at,
    }));

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const body = await request.json();
    const { campaign_id, store_id, extra_support_count, supervisor_count, notes } = body;

    if (!campaign_id || !store_id) {
      return NextResponse.json({ success: false, error: '缺少必要參數' }, { status: 400 });
    }

    const { error } = await supabase
      .from('campaign_store_headcount')
      .upsert({
        campaign_id,
        store_id,
        extra_support_count: extra_support_count ?? 0,
        supervisor_count: supervisor_count ?? 0,
        notes: notes || null,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      }, { onConflict: 'campaign_id,store_id' });

    if (error) {
      if (error.code === '42P01') {
        return NextResponse.json({ success: false, error: '資料表尚未建立，請先執行 SQL migration' }, { status: 503 });
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // 回傳更新後的 own_staff_count
    const { data: ownData } = await supabase
      .from('campaign_store_own_staff')
      .select('id')
      .eq('campaign_id', campaign_id)
      .eq('store_id', store_id);

    const own_staff_count = ownData?.length ?? 0;

    return NextResponse.json({
      success: true,
      data: {
        store_id,
        extra_support_count: extra_support_count ?? 0,
        supervisor_count: supervisor_count ?? 0,
        own_staff_count,
        total: own_staff_count + (extra_support_count ?? 0) + (supervisor_count ?? 0),
      },
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
