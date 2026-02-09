import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

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

    // 檢查是否為督導或店長
    const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '');
    
    if (!needsAssignment) {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
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

    // 獲取所有排程（督導和店長可以看到所有門市的活動）
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
      isSupervisor,
      isStoreManager
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
