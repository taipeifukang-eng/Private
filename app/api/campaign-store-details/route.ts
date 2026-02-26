import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/permissions/check';

export const dynamic = 'force-dynamic';

// =====================================================
// GET: 查詢某活動的所有門市細節 / 單一門市細節
// Query params: campaign_id (required), store_id (optional)
// =====================================================
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const searchParams = request.nextUrl.searchParams;
    const campaignId = searchParams.get('campaign_id');
    const storeId    = searchParams.get('store_id');

    if (!campaignId) {
      return NextResponse.json({ success: false, error: '缺少 campaign_id' }, { status: 400 });
    }

    let query = supabase
      .from('campaign_store_details')
      .select('*')
      .eq('campaign_id', campaignId);

    if (storeId) {
      query = query.eq('store_id', storeId);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Error fetching campaign store details:', error);
      // 表不存在時回傳空陣列，避免前端發生空白
      if (error.code === '42P01') {
        return NextResponse.json({ success: true, data: [] });
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// =====================================================
// POST: 新增或覆蓋門市細節（upsert）
// Body: { campaign_id, store_id, ...fields }
// =====================================================
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    // RBAC 權限檢查：需要 activity.store_detail.edit
    // 若 RBAC 權限尚未設定，admin/manager 角色作為備援
    const canEdit = await hasPermission(user.id, 'activity.store_detail.edit');
    if (!canEdit) {
      // 備援：檢查 profiles.role 是否為 admin 或 manager
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      if (!profile || !['admin', 'manager'].includes(profile.role)) {
        return NextResponse.json({ success: false, error: '權限不足：需要 activity.store_detail.edit 權限' }, { status: 403 });
      }
    }

    const body = await request.json();
    const { campaign_id, store_id, ...fields } = body;

    if (!campaign_id || !store_id) {
      return NextResponse.json({ success: false, error: '缺少 campaign_id 或 store_id' }, { status: 400 });
    }

    const allowedFields = [
      'outdoor_vendor', 'red_bean_cake', 'circulation', 'quantum', 'bone_density',
      'supervisor', 'manager', 'tasting', 'activity_team',
      'sales1', 'sales2', 'sales3', 'sales4', 'sales5', 'sales6',
      'indoor_pt1', 'indoor_pt2', 'notes',
      // 盤點活動欄位
      'has_external_inventory_company', 'planned_inventory_time', 'inventory_staff',
    ];

    const filteredFields: Record<string, any> = {};
    allowedFields.forEach(f => {
      if (!(f in fields)) return;
      const val = fields[f];
      // 有實際內容 → 儲存原値
      if (val !== null && val !== undefined && val !== '') {
        filteredFields[f] = val;
      }
      // 空字串/null → 僅對已知存在的基本欄位寫入 null（新增盤點欄位略過，避免 DB 欄位不存在就報錯）
      else {
        const baseFields = [
          'outdoor_vendor', 'red_bean_cake', 'circulation', 'quantum', 'bone_density',
          'supervisor', 'manager', 'tasting', 'activity_team',
          'sales1', 'sales2', 'sales3', 'sales4', 'sales5', 'sales6',
          'indoor_pt1', 'indoor_pt2', 'notes',
        ];
        if (baseFields.includes(f)) {
          filteredFields[f] = null;
        }
        // inventory 欄位為空時不納入（對沒距執行新增欄位的舊 DB 相容）
      }
    });

    const { data, error } = await supabase
      .from('campaign_store_details')
      .upsert(
        {
          campaign_id,
          store_id,
          ...filteredFields,
          updated_by: user.id,
        },
        { onConflict: 'campaign_id,store_id' }
      )
      .select()
      .single();

    if (error) {
      console.error('Error upserting campaign store details:', error);
      // 資料表或欄位不存在
      if (error.code === '42P01') {
        return NextResponse.json({ success: false, error: '資料表尚未建立，請先執行 Supabase SQL migration_campaign_store_details.sql' }, { status: 500 });
      }
      if (error.code === '42703') {
        return NextResponse.json({ success: false, error: '資料庫欄位不存在，請執行 Supabase migration_add_campaign_type.sql 新增欄位' }, { status: 500 });
      }
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
