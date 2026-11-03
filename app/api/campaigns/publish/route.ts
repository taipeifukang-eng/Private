import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { CAMPAIGN_PERM, hasAnyPermission } from '@/lib/campaign-access';

// PATCH: Update campaign publish status
export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    // 發布需 activity.manage 或 activity.campaign.edit
    if (!(await hasAnyPermission(user.id, [CAMPAIGN_PERM.manage, CAMPAIGN_PERM.campaignEdit]))) {
      return NextResponse.json(
        { success: false, error: '權限不足：需要 activity.manage 或 activity.campaign.edit 權限' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { campaignId, publishType, status } = body;

    if (!campaignId || !publishType) {
      return NextResponse.json({ success: false, error: '缺少必要參數' }, { status: 400 });
    }

    // Validate publishType
    if (!['supervisors', 'store_managers', 'inventory_team'].includes(publishType)) {
      return NextResponse.json({ success: false, error: '無效的發布類型' }, { status: 400 });
    }

    const columnMap: Record<string, string> = {
      supervisors: 'published_to_supervisors',
      store_managers: 'published_to_store_managers',
      inventory_team: 'published_to_inventory_team'
    };
    const columnName = columnMap[publishType];

    const updateData: any = {
      [columnName]: status,
      updated_at: new Date().toISOString()
    };

    // If publishing, update published_at timestamp
    if (status) {
      updateData.published_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('campaigns')
      .update(updateData)
      .eq('id', campaignId)
      .select()
      .single();

    if (error) {
      console.error('Error updating campaign publish status:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, campaign: data });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
