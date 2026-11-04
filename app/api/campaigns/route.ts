import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import {
  CAMPAIGN_PERM,
  evaluateCampaignAudience,
  hasAnyPermission,
  hasCampaignPublishedAccess,
  hasCampaignViewPermission,
  loadCampaignViewer,
} from '@/lib/campaign-access';

// GET: 取得所有活動檔期
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    // 可看全部活動（含未發布草稿）的人：view_all、activity.manage、各項編輯權（規格第 6 點：編輯者看全部可編輯的資料），
    // 以及行銷／商品部發布權（要替尚未發布的活動準備發布內容，campaign-department-publish API 同樣放行）。
    // support_request.edit / support_assign.edit / staff_overview.view 只是權限閘門，不在此列，
    // 仍須通過發布閘門（活動已發布給其身分）。
    const { viewAll, viewOwn } = await hasCampaignViewPermission(user.id);
    const canSeeAll =
      viewAll ||
      (await hasAnyPermission(user.id, [
        CAMPAIGN_PERM.manage,
        CAMPAIGN_PERM.campaignEdit,
        // 管理端排程頁入口也開放給下列編輯權（Navbar canAccessActivitySchedule），不可因補洞而壞掉
        CAMPAIGN_PERM.storeDetailEdit,
        CAMPAIGN_PERM.equipmentTripEdit,
        CAMPAIGN_PERM.checklistEdit,
        CAMPAIGN_PERM.marketingPublish,
        CAMPAIGN_PERM.merchandisePublish,
      ]));
    // 排程頁也會讓持 support_*.edit 的店長載入活動：通過權限閘門（含輔助權限），但只回傳已發布的活動
    const hasAuxGate =
      !canSeeAll &&
      !viewOwn &&
      (await hasAnyPermission(user.id, [CAMPAIGN_PERM.supportRequestEdit, CAMPAIGN_PERM.supportAssignEdit]));
    if (!canSeeAll && !viewOwn && !hasAuxGate) {
      return NextResponse.json(
        { success: false, error: '權限不足：需要 activity.campaign.view_own、view_all 或活動管理權限' },
        { status: 403 }
      );
    }

    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select('*')
      .order('start_date', { ascending: false });

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    if (canSeeAll) {
      return NextResponse.json({ success: true, campaigns });
    }

    // 發布閘門：其餘使用者只拿到已發布給其身分的活動（RLS 同樣擋，這裡是第二層）
    const viewer = await loadCampaignViewer(supabase, user.id);
    const published = (campaigns || []).filter((c: any) =>
      hasCampaignPublishedAccess(evaluateCampaignAudience(viewer, c))
    );
    return NextResponse.json({ success: true, campaigns: published });
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    return NextResponse.json({ success: false, error: '伺服器錯誤' }, { status: 500 });
  }
}

// POST: 建立新活動檔期
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    // 檢查權限
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || !['admin', 'manager'].includes(profile.role)) {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { name, start_date, end_date, campaign_type } = body;

    if (!name || !start_date || !end_date) {
      return NextResponse.json({ success: false, error: '缺少必要欄位' }, { status: 400 });
    }

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .insert([{
        name,
        start_date,
        end_date,
        campaign_type: campaign_type || 'promotion',
        created_by: user.id,
        is_active: true
      }])
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, campaign });
  } catch (error) {
    console.error('Error creating campaign:', error);
    return NextResponse.json({ success: false, error: '伺服器錯誤' }, { status: 500 });
  }
}

// PUT: 更新活動檔期
export async function PUT(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    // 檢查權限
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || !['admin', 'manager'].includes(profile.role)) {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { id, name, start_date, end_date, is_active, campaign_type } = body;

    if (!id) {
      return NextResponse.json({ success: false, error: '缺少活動 ID' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {
      name,
      start_date,
      end_date,
      is_active,
      updated_at: new Date().toISOString()
    };
    if (campaign_type) updateData.campaign_type = campaign_type;

    const { data: campaign, error } = await supabase
      .from('campaigns')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, campaign });
  } catch (error) {
    console.error('Error updating campaign:', error);
    return NextResponse.json({ success: false, error: '伺服器錯誤' }, { status: 500 });
  }
}

// DELETE: 刪除活動檔期
export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    // 檢查權限
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || !['admin', 'manager'].includes(profile.role)) {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: '缺少活動 ID' }, { status: 400 });
    }

    const { error } = await supabase
      .from('campaigns')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    return NextResponse.json({ success: false, error: '伺服器錯誤' }, { status: 500 });
  }
}
