import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/campaign-support-staff
 * 取得支援人員指派
 * Query params: campaign_id (required), support_request_id (optional), supporting_store_id (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { searchParams } = request.nextUrl;
    const campaignId = searchParams.get('campaign_id');
    const supportRequestId = searchParams.get('support_request_id');
    const supportingStoreId = searchParams.get('supporting_store_id');

    if (!campaignId) {
      return NextResponse.json({ success: false, error: '缺少 campaign_id' }, { status: 400 });
    }

    let query = supabase
      .from('campaign_support_staff')
      .select(`
        *,
        requesting_store:stores!campaign_support_staff_requesting_store_id_fkey(id, store_code, store_name),
        supporting_store:stores!campaign_support_staff_supporting_store_id_fkey(id, store_code, store_name)
      `)
      .eq('campaign_id', campaignId)
      .order('sort_order')
      .order('created_at');

    if (supportRequestId) {
      query = query.eq('support_request_id', supportRequestId);
    }
    if (supportingStoreId) {
      query = query.eq('supporting_store_id', supportingStoreId);
    }

    const { data, error } = await query;
    if (error) {
      if (error.code === '42P01') return NextResponse.json({ success: true, data: [] });
      console.error('Error fetching support staff:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/campaign-support-staff
 * 新增或批量替換支援人員
 * Body: { support_request_id, campaign_id, supporting_store_id, requesting_store_id, staff: [...] }
 * 或 { support_request_id, ..., employee_code, employee_name, position } 單筆
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const body = await request.json();
    const { support_request_id, campaign_id, supporting_store_id, requesting_store_id, staff, replace } = body;

    if (!support_request_id || !campaign_id || !supporting_store_id || !requesting_store_id) {
      return NextResponse.json({ success: false, error: '缺少必要參數' }, { status: 400 });
    }

    if (replace && Array.isArray(staff)) {
      // 批量替換
      await supabase
        .from('campaign_support_staff')
        .delete()
        .eq('support_request_id', support_request_id);

      if (staff.length === 0) {
        return NextResponse.json({ success: true, data: [] });
      }

      const insertData = staff.map((s: any, index: number) => ({
        support_request_id,
        campaign_id,
        supporting_store_id,
        requesting_store_id,
        employee_code: s.employee_code,
        employee_name: s.employee_name,
        position: s.position || null,
        sort_order: index,
        created_by: user.id,
      }));

      const { data, error } = await supabase
        .from('campaign_support_staff')
        .insert(insertData)
        .select();

      if (error) {
        console.error('Error replacing support staff:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, data: data || [] });
    }

    // 單筆新增
    const { employee_code, employee_name, position, sort_order } = body;
    if (!employee_code || !employee_name) {
      return NextResponse.json({ success: false, error: '缺少員工資料' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('campaign_support_staff')
      .insert({
        support_request_id,
        campaign_id,
        supporting_store_id,
        requesting_store_id,
        employee_code,
        employee_name,
        position: position || null,
        sort_order: sort_order || 0,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      console.error('Error inserting support staff:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/campaign-support-staff
 * 刪除支援人員
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

    const { error } = await supabase
      .from('campaign_support_staff')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting support staff:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
