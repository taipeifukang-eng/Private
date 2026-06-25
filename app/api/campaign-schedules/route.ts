import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import {
  getCampaignAccessDeniedMessage,
  getCampaignAudienceAccess,
  hasCampaignPublishedAccess,
} from '@/lib/campaign-access';

// GET: 取得指定活動的排程
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const campaign_id = searchParams.get('campaign_id');

    if (!campaign_id) {
      return NextResponse.json({ success: false, error: '缺少活動 ID' }, { status: 400 });
    }

    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaign_id)
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json({ success: false, error: '找不到活動' }, { status: 404 });
    }

    const access = await getCampaignAudienceAccess(supabase, user.id, campaign);
    if (!hasCampaignPublishedAccess(access)) {
      return NextResponse.json(
        { success: false, error: getCampaignAccessDeniedMessage(access) },
        { status: 403 }
      );
    }

    let query = supabase
      .from('campaign_schedules')
      .select(`
        *,
        store:stores(id, store_code, store_name, short_name)
      `)
      .eq('campaign_id', campaign_id)
      .order('activity_date');

    if (!access.canViewAll && !access.canViewAsSupervisor && !access.canViewAsDepartment && access.canViewAsStoreManager) {
      if (access.managedStoreIds.length === 0) {
        return NextResponse.json({ success: true, schedules: [] });
      }
      query = query.in('store_id', access.managedStoreIds);
    }

    const { data: schedules, error } = await query;

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, schedules });
  } catch (error) {
    console.error('Error fetching schedules:', error);
    return NextResponse.json({ success: false, error: '伺服器錯誤' }, { status: 500 });
  }
}

// POST: 建立或更新排程
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
    const { campaign_id, store_id, activity_date } = body;

    if (!campaign_id || !store_id || !activity_date) {
      return NextResponse.json({ success: false, error: '缺少必要欄位' }, { status: 400 });
    }

    // 使用 upsert 機制：如果該門市已有排程，則更新日期；否則建立新記錄
    const { data: schedule, error } = await supabase
      .from('campaign_schedules')
      .upsert({
        campaign_id,
        store_id,
        activity_date,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'campaign_id,store_id'
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, schedule });
  } catch (error) {
    console.error('Error creating schedule:', error);
    return NextResponse.json({ success: false, error: '伺服器錯誤' }, { status: 500 });
  }
}

// PUT: 批次更新排程
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
    const { campaign_id, schedules } = body;

    if (!campaign_id || !schedules || !Array.isArray(schedules)) {
      return NextResponse.json({ success: false, error: '資料格式錯誤' }, { status: 400 });
    }

    // 先刪除該活動所有排程
    await supabase
      .from('campaign_schedules')
      .delete()
      .eq('campaign_id', campaign_id);

    // 批次插入新排程
    const insertData = schedules.map(s => ({
      campaign_id,
      store_id: s.store_id,
      activity_date: s.activity_date
    }));

    const { data: newSchedules, error } = await supabase
      .from('campaign_schedules')
      .insert(insertData)
      .select();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, schedules: newSchedules });
  } catch (error) {
    console.error('Error batch updating schedules:', error);
    return NextResponse.json({ success: false, error: '伺服器錯誤' }, { status: 500 });
  }
}

// DELETE: 刪除單一排程
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
      return NextResponse.json({ success: false, error: '缺少排程 ID' }, { status: 400 });
    }

    const { error } = await supabase
      .from('campaign_schedules')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting schedule:', error);
    return NextResponse.json({ success: false, error: '伺服器錯誤' }, { status: 500 });
  }
}
