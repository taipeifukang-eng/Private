import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import {
  getCampaignAccessDeniedMessage,
  getCampaignAudienceAccess,
  getCampaignStoreScope,
  hasCampaignPublishedAccess,
} from '@/lib/campaign-access';

// GET: 取得活動的排程資料（根據用戶權限）
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const campaignId = params.id;

    // 獲取活動資料
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json({ success: false, error: '找不到活動' }, { status: 404 });
    }

    const access = await getCampaignAudienceAccess(supabase, user.id, campaign);

    if (access.canViewAll) {
      // 獲取所有排程
      const { data: schedules, error: schedulesError } = await supabase
        .from('campaign_schedules')
        .select('*')
        .eq('campaign_id', campaignId);

      if (schedulesError) {
        return NextResponse.json({ success: false, error: schedulesError.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, campaign, schedules });
    }

    if (!hasCampaignPublishedAccess(access)) {
      return NextResponse.json(
        { success: false, error: getCampaignAccessDeniedMessage(access) },
        { status: 403 }
      );
    }

    // 督導/部門受眾/view_all 看全排程；店長只看自己被任命的門市。
    let schedulesQuery = supabase
      .from('campaign_schedules')
      .select('*')
      .eq('campaign_id', campaignId);

    const scope = getCampaignStoreScope(access);
    if (!scope.all) {
      if (scope.storeIds.length > 0) {
        schedulesQuery = schedulesQuery.in('store_id', scope.storeIds);
      } else {
        // 沒有管理門市，返回空排程
        return NextResponse.json({ 
          success: true, 
          campaign, 
          schedules: [],
          isSupervisor: access.isSupervisor,
          isStoreManager: access.isStoreManager
        });
      }
    }

    const { data: schedules, error: schedulesError } = await schedulesQuery;

    if (schedulesError) {
      return NextResponse.json({ success: false, error: schedulesError.message }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      campaign, 
      schedules: schedules || [],
      isSupervisor: access.isSupervisor,
      isStoreManager: access.isStoreManager,
      isInventoryTeam: access.isDepartmentAudience
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
