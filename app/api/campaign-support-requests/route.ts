import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  authorizeCampaignStoreWrite,
  CAMPAIGN_PERM,
  getCampaignAccessDeniedMessage,
  getCampaignAudienceAccess,
  hasAnyPermission,
  hasCampaignScopeBypass,
  getCampaignStoreScope,
  hasCampaignPublishedAccess,
} from '@/lib/campaign-access';

export const dynamic = 'force-dynamic';

/**
 * GET /api/campaign-support-requests
 * 取得支援需求
 * Query params: campaign_id (required), requesting_store_id (optional), supporting_store_id (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { searchParams } = request.nextUrl;
    const campaignId = searchParams.get('campaign_id');
    const requestingStoreId = searchParams.get('requesting_store_id');
    const supportingStoreId = searchParams.get('supporting_store_id');

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
    // support_request.edit / support_assign.edit 實務上是店長持有的層級，不是看全部的 bypass，僅通過閘門
    const canBypassScope = await hasCampaignScopeBypass(user.id, []);
    // 輔助權限（support_*.edit / staff_overview.view）不再單獨放行：仍須通過發布閘門（view_own/view_all），
    // 草稿活動只有 view_all 或 activity.manage 可讀
    if (!hasCampaignPublishedAccess(access) && !canBypassScope) {
      return NextResponse.json(
        { success: false, error: getCampaignAccessDeniedMessage(access) },
        { status: 403 }
      );
    }
    // 店長只能看「請求門市」或「支援門市」是自己被任命門市的資料
    const scope = getCampaignStoreScope(access, canBypassScope);

    let query = supabase
      .from('campaign_support_requests')
      .select(`
        *,
        requesting_store:stores!campaign_support_requests_requesting_store_id_fkey(id, store_code, store_name),
        supporting_store:stores!campaign_support_requests_supporting_store_id_fkey(id, store_code, store_name)
      `)
      .eq('campaign_id', campaignId)
      .order('created_at');

    if (!scope.all) {
      if (scope.storeIds.length === 0) return NextResponse.json({ success: true, data: [] });
      const idList = scope.storeIds.join(',');
      query = query.or(`requesting_store_id.in.(${idList}),supporting_store_id.in.(${idList})`);
    }
    if (requestingStoreId) {
      query = query.eq('requesting_store_id', requestingStoreId);
    }
    if (supportingStoreId) {
      query = query.eq('supporting_store_id', supportingStoreId);
    }

    const { data, error } = await query;
    if (error) {
      if (error.code === '42P01') return NextResponse.json({ success: true, data: [] });
      console.error('Error fetching support requests:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/campaign-support-requests
 * 新增或更新支援需求（upsert）
 * Body: { campaign_id, requesting_store_id, supporting_store_id, requested_count, notes }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const body = await request.json();
    const { campaign_id, requesting_store_id, supporting_store_id, requested_count, notes } = body;

    if (!campaign_id || !requesting_store_id || !supporting_store_id) {
      return NextResponse.json({ success: false, error: '缺少必要參數' }, { status: 400 });
    }

    if (requesting_store_id === supporting_store_id) {
      return NextResponse.json({ success: false, error: '請求門市和支援門市不能相同' }, { status: 400 });
    }

    // 只能替自己被任命的門市（請求門市）建立支援需求；持 support_assign.edit 者可寫全部
    const auth = await authorizeCampaignStoreWrite(
      supabase,
      user.id,
      campaign_id,
      [requesting_store_id],
      [],
      [],
      // RLS 寫入 policy 只認 activity.manage / support_request.edit；未任命者讀不到資料，不另開例外
      [CAMPAIGN_PERM.supportRequestEdit]
    );
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    const { data, error } = await supabase
      .from('campaign_support_requests')
      .upsert({
        campaign_id,
        requesting_store_id,
        supporting_store_id,
        requested_count: requested_count || 1,
        notes: notes || null,
        updated_at: new Date().toISOString(),
        created_by: user.id,
      }, { onConflict: 'campaign_id,requesting_store_id,supporting_store_id' })
      .select(`
        *,
        requesting_store:stores!campaign_support_requests_requesting_store_id_fkey(id, store_code, store_name),
        supporting_store:stores!campaign_support_requests_supporting_store_id_fkey(id, store_code, store_name)
      `)
      .single();

    if (error) {
      console.error('Error upserting support request:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/campaign-support-requests
 * 刪除支援需求
 * Body: { id }
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: '缺少 id' }, { status: 400 });
    }

    const { data: existing } = await supabase
      .from('campaign_support_requests')
      .select('campaign_id, requesting_store_id')
      .eq('id', id)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ success: false, error: '找不到支援需求' }, { status: 404 });
    }
    const auth = await authorizeCampaignStoreWrite(
      supabase,
      user.id,
      existing.campaign_id,
      [existing.requesting_store_id],
      [],
      [],
      // RLS 寫入 policy 只認 activity.manage / support_request.edit；未任命者讀不到資料，不另開例外
      [CAMPAIGN_PERM.supportRequestEdit]
    );
    if (!auth.ok) {
      return NextResponse.json({ success: false, error: auth.error }, { status: auth.status });
    }

    // 先刪除相關的支援人員
    await supabase
      .from('campaign_support_staff')
      .delete()
      .eq('support_request_id', id);

    const { error } = await supabase
      .from('campaign_support_requests')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting support request:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
