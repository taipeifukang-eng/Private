import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  getCampaignAccessDeniedMessage,
  authorizeCampaignStoreWrite,
  canAccessStore,
  CAMPAIGN_PERM,
  getCampaignAudienceAccess,
  hasAnyPermission,
  hasCampaignScopeBypass,
  getCampaignStoreScope,
  hasCampaignPublishedAccess,
} from '@/lib/campaign-access';

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

    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json({ success: false, error: '找不到活動' }, { status: 404 });
    }

    const access = await getCampaignAudienceAccess(supabase, user.id, campaign);
    // store_detail.edit（行銷／營運編輯權）維持看全部；support_assign.edit 為店長層級，仍受門市範圍限制
    const canBypassScope = await hasCampaignScopeBypass(user.id, [CAMPAIGN_PERM.storeDetailEdit]);
    // 輔助權限不單獨放行：須通過發布閘門，草稿活動只有 view_all、activity.manage 或 store_detail.edit 可讀
    if (!hasCampaignPublishedAccess(access) && !canBypassScope) {
      return NextResponse.json(
        { success: false, error: getCampaignAccessDeniedMessage(access) },
        { status: 403 }
      );
    }

    const scope = getCampaignStoreScope(access, canBypassScope);
    const shouldLimitToManagedStores = !scope.all;
    const scopedStoreIds = scope.all ? [] : scope.storeIds;
    if (storeId && !canAccessStore(scope, storeId)) {
      return NextResponse.json({ success: true, data: [] });
    }

    // 查詢頭數設定
    let hcQuery = supabase
      .from('campaign_store_headcount')
      .select('campaign_id, store_id, extra_support_count, supervisor_count, notes, updated_at')
      .eq('campaign_id', campaignId);
    if (storeId) hcQuery = hcQuery.eq('store_id', storeId);
    else if (shouldLimitToManagedStores) {
      if (scopedStoreIds.length === 0) return NextResponse.json({ success: true, data: [] });
      hcQuery = hcQuery.in('store_id', scopedStoreIds);
    }

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
    else if (shouldLimitToManagedStores) ownQuery = ownQuery.in('store_id', scopedStoreIds);

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

    const auth = await authorizeCampaignStoreWrite(
      supabase,
      user.id,
      campaign_id,
      [store_id],
      // store_detail.edit 持有者可寫全部門市（與 GET 的 bypass、RLS write policy 一致，不受任命限制）
      [CAMPAIGN_PERM.storeDetailEdit],
      [],
      // RLS 寫入 policy 只認 activity.manage / store_detail.edit，其餘 API 先回 403（避免 RLS 500）
      [CAMPAIGN_PERM.storeDetailEdit]
    );
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
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
