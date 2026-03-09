import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/campaign-store-own-staff
 * 取得某活動某門市的本店確認人員
 * Query params: campaign_id (required), store_id (optional)
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

    let query = supabase
      .from('campaign_store_own_staff')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('sort_order')
      .order('created_at');

    if (storeId) {
      query = query.eq('store_id', storeId);
    }

    const { data, error } = await query;
    if (error) {
      if (error.code === '42P01') return NextResponse.json({ success: true, data: [] });
      console.error('Error fetching own staff:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/campaign-store-own-staff
 * 新增本店人員（或批量替換）
 * Body: { campaign_id, store_id, employee_code, employee_name, position, is_manually_added, sort_order }
 * 或 { campaign_id, store_id, staff: [...], replace: true } 批量替換
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const body = await request.json();
    const { campaign_id, store_id, staff, replace } = body;

    if (!campaign_id || !store_id) {
      return NextResponse.json({ success: false, error: '缺少必要參數' }, { status: 400 });
    }

    if (replace && Array.isArray(staff)) {
      // 批量替換：先刪除舊的，再插入新的
      await supabase
        .from('campaign_store_own_staff')
        .delete()
        .eq('campaign_id', campaign_id)
        .eq('store_id', store_id);

      if (staff.length === 0) {
        return NextResponse.json({ success: true, data: [] });
      }

      const insertData = staff.map((s: any, index: number) => ({
        campaign_id,
        store_id,
        employee_code: s.employee_code,
        employee_name: s.employee_name,
        position: s.position || null,
        is_manually_added: s.is_manually_added || false,
        sort_order: index,
        created_by: user.id,
      }));

      const { data, error } = await supabase
        .from('campaign_store_own_staff')
        .insert(insertData)
        .select();

      if (error) {
        console.error('Error replacing own staff:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, data: data || [] });
    }

    // 單筆 upsert
    const { employee_code, employee_name, position, is_manually_added, sort_order } = body;
    if (!employee_code || !employee_name) {
      return NextResponse.json({ success: false, error: '缺少員工資料' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('campaign_store_own_staff')
      .upsert({
        campaign_id,
        store_id,
        employee_code,
        employee_name,
        position: position || null,
        is_manually_added: is_manually_added || false,
        sort_order: sort_order || 0,
        updated_at: new Date().toISOString(),
        created_by: user.id,
      }, { onConflict: 'campaign_id,store_id,employee_code' })
      .select()
      .single();

    if (error) {
      console.error('Error upserting own staff:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/campaign-store-own-staff
 * 刪除本店人員
 * Body: { id } 或 { campaign_id, store_id, employee_code }
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const body = await request.json();
    const { id, campaign_id, store_id, employee_code } = body;

    let query = supabase.from('campaign_store_own_staff').delete();

    if (id) {
      query = query.eq('id', id);
    } else if (campaign_id && store_id && employee_code) {
      query = query
        .eq('campaign_id', campaign_id)
        .eq('store_id', store_id)
        .eq('employee_code', employee_code);
    } else {
      return NextResponse.json({ success: false, error: '缺少刪除條件' }, { status: 400 });
    }

    const { error } = await query;
    if (error) {
      console.error('Error deleting own staff:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
