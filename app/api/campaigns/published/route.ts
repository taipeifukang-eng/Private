import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions/check';
import { getCampaignAudienceAccess } from '@/lib/campaign-access';

// GET: 取得已發布的活動（根據用戶權限）
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    // 使用 RBAC 權限檢查
    const canViewAll = await hasPermission(user.id, 'activity.campaign.view_all');
    const canView = await hasPermission(user.id, 'activity.campaign.view');

    if (!canView && !canViewAll) {
      return NextResponse.json(
        { success: false, error: '權限不足：需要 activity.campaign.view 權限' },
        { status: 403 }
      );
    }

    // 管理員或有 view_all 權限可以看所有活動
    if (canViewAll) {
      const { data: campaigns, error } = await supabase
        .from('campaigns')
        .select('*')
        .order('start_date', { ascending: true });

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, data: campaigns, role: 'admin' });
    }

    const { data: allCampaigns, error } = await supabase
      .from('campaigns')
      .select('*')
      .order('start_date', { ascending: true });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const campaignsWithAccess = await Promise.all(
      (allCampaigns || []).map(async (campaign) => ({
        campaign,
        access: await getCampaignAudienceAccess(supabase, user.id, campaign),
      }))
    );
    const visibleRows = campaignsWithAccess.filter(({ access }) =>
      access.canViewAsSupervisor || access.canViewAsStoreManager || access.canViewAsDepartment
    );
    const firstAccess = campaignsWithAccess[0]?.access;

    return NextResponse.json({ 
      success: true, 
      data: visibleRows.map(({ campaign }) => campaign),
      role: visibleRows[0]?.access.role || firstAccess?.role || 'member',
      isSupervisor: firstAccess?.isSupervisor || false,
      isStoreManager: firstAccess?.isStoreManager || false,
      isInventoryTeam: firstAccess?.isDepartmentAudience || false
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
