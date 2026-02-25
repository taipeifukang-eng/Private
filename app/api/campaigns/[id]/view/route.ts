import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions/check';

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

    // 獲取用戶資料
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    // admin 可以看所有資料
    if (profile?.role === 'admin') {
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

    // 檢查是否為督導、店長、營業部管理層或盤點組/行銷部人員
    const isJobTitleAllowed = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '');
    const isBusinessManager = profile?.department?.startsWith('營業') && ['經理', '主管'].includes(profile?.job_title || '');
    const isInventoryTeam = profile?.department === '營業部-盤點組';
    
    // 檢查是否為行銷部且有活動管理權限
    const isMarketingDept = profile?.department === '行銷部';
    const hasActivityAccess = await hasPermission(user.id, 'activity.management.access');
    const isMarketingWithAccess = isMarketingDept && hasActivityAccess;
    
    // 檢查是否為營業部助理
    const isBusinessAssistant = profile?.department === '營業部' && profile?.job_title === '助理';
    
    const needsAssignment = isJobTitleAllowed || isBusinessManager || isInventoryTeam || isMarketingWithAccess || isBusinessAssistant;
    
    if (!needsAssignment) {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    // 盤點組或行銷部人員檢查是否已發布給盤點組
    if ((isInventoryTeam || isMarketingWithAccess || isBusinessAssistant) && !isJobTitleAllowed && !isBusinessManager) {
      if (!campaign.published_to_inventory_team) {
        return NextResponse.json({ success: false, error: '此活動尚未發布給盤點組/行銷部/營業部助理' }, { status: 403 });
      }

      const { data: schedules, error: schedulesError } = await supabase
        .from('campaign_schedules')
        .select('*')
        .eq('campaign_id', campaignId);

      if (schedulesError) {
        return NextResponse.json({ success: false, error: schedulesError.message }, { status: 500 });
      }

      return NextResponse.json({ 
        success: true, 
        campaign, 
        schedules: schedules || [],
        isInventoryTeam: true
      });
    }

    // 營業部經理/主管視為督導權限
    if (isBusinessManager && !isJobTitleAllowed) {
      // 檢查活動是否已發布給督導
      if (!campaign.published_to_supervisors) {
        return NextResponse.json({ success: false, error: '此活動尚未發布給督導' }, { status: 403 });
      }

      // 獲取所有排程
      const { data: schedules, error: schedulesError } = await supabase
        .from('campaign_schedules')
        .select('*')
        .eq('campaign_id', campaignId);

      if (schedulesError) {
        return NextResponse.json({ success: false, error: schedulesError.message }, { status: 500 });
      }

      return NextResponse.json({ 
        success: true, 
        campaign, 
        schedules: schedules || [],
        isSupervisor: true,
        isStoreManager: false
      });
    }

    // 獲取用戶管理的門市
    const { data: managedStores } = await supabase
      .from('store_managers')
      .select('store_id, role_type')
      .eq('user_id', user.id);

    const isSupervisor = ['督導', '督導(代理店長)'].includes(profile?.job_title || '') || 
                        managedStores?.some(m => m.role_type === 'supervisor');
    const isStoreManager = ['店長', '代理店長'].includes(profile?.job_title || '') ||
                          managedStores?.some(m => m.role_type === 'store_manager');

    // 檢查活動是否已發布給該角色
    if (isSupervisor && !campaign.published_to_supervisors && !campaign.published_to_store_managers) {
      return NextResponse.json({ success: false, error: '此活動尚未發布' }, { status: 403 });
    }
    if (isStoreManager && !isSupervisor && !campaign.published_to_store_managers) {
      return NextResponse.json({ success: false, error: '此活動尚未發布給店長' }, { status: 403 });
    }

    // 督導可以看到所有門市的排程；店長只能看到自己管理門市的排程
    let schedulesQuery = supabase
      .from('campaign_schedules')
      .select('*')
      .eq('campaign_id', campaignId);

    if (isStoreManager && !isSupervisor) {
      // 純店長：只篩選自己管理的門市
      const myStoreIds = (managedStores || [])
        .filter(m => m.role_type === 'store_manager')
        .map(m => m.store_id);
      if (myStoreIds.length > 0) {
        schedulesQuery = schedulesQuery.in('store_id', myStoreIds);
      } else {
        // 沒有管理門市，返回空排程
        return NextResponse.json({ 
          success: true, 
          campaign, 
          schedules: [],
          isSupervisor,
          isStoreManager
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
      isSupervisor,
      isStoreManager
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
