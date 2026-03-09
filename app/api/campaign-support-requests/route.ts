import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

    let query = supabase
      .from('campaign_support_requests')
      .select(`
        *,
        requesting_store:stores!campaign_support_requests_requesting_store_id_fkey(id, store_code, store_name),
        supporting_store:stores!campaign_support_requests_supporting_store_id_fkey(id, store_code, store_name)
      `)
      .eq('campaign_id', campaignId)
      .order('created_at');

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
