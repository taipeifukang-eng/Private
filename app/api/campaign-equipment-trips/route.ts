import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';
import {
  getCampaignAccessDeniedMessage,
  getCampaignAudienceAccess,
  getCampaignStoreScope,
  hasCampaignScopeBypass,
  hasCampaignPublishedAccess,
} from '@/lib/campaign-access';

// GET /api/campaign-equipment-trips?campaign_id=xxx
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const campaign_id = searchParams.get('campaign_id');

  if (!campaign_id) {
    return NextResponse.json({ success: false, error: 'campaign_id is required' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaign_id)
    .single();

  if (campaignError || !campaign) {
    return NextResponse.json({ success: false, error: '找不到活動' }, { status: 404 });
  }

  const access = await getCampaignAudienceAccess(supabase, user.id, campaign);
  const canEdit = await hasPermission(user.id, 'activity.equipment_trip.edit');
  if (!hasCampaignPublishedAccess(access) && !canEdit) {
    return NextResponse.json(
      { success: false, error: getCampaignAccessDeniedMessage(access) },
      { status: 403 }
    );
  }

  // 查詢所有車次：已通過上方權限與發布閘門，改用 service-role 讀取（RLS 只放行督導／盤點組／編輯權），
  // 店長的門市範圍由下方依門市名稱過濾，避免店長用自己的 JWT 直接讀到別店車次。
  const { data, error } = await createAdminClient()
    .from('campaign_equipment_trips')
    .select('*')
    .eq('campaign_id', campaign_id)
    .order('trip_date', { ascending: true })
    .order('set_number', { ascending: true });

  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json({ success: true, data: [] });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // 權限過濾：有編輯權限者、view_all、督導、盤點組看全部；店長只看與被任命門市相關的車次
  const scope = getCampaignStoreScope(access, canEdit || (await hasCampaignScopeBypass(user.id, [])));
  if (scope.all) {
    return NextResponse.json({ success: true, data: data ?? [] });
  }

  // 店長：查詢被任命門市（車次以門市名稱記錄 from/to_location）
  if (scope.storeIds.length === 0) {
    return NextResponse.json({ success: true, data: [] });
  }
  const { data: managedStores } = await supabase
    .from('stores')
    .select('store_name')
    .in('id', scope.storeIds);

  // 提取門市名稱清單
  const managedStoreNames = new Set<string>();
  (managedStores ?? []).forEach((s: any) => {
    if (s.store_name) managedStoreNames.add(s.store_name);
  });

  // 過濾車次：from_location 或 to_location 有任一在用戶負責的門市內
  const filteredTrips = (data ?? []).filter(trip => 
    managedStoreNames.has(trip.from_location) || managedStoreNames.has(trip.to_location)
  );

  return NextResponse.json({ success: true, data: filteredTrips });
}

// POST /api/campaign-equipment-trips  → 新增
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

  // RBAC 權限檢查：需要 activity.equipment_trip.edit
  const canEdit = await hasPermission(user.id, 'activity.equipment_trip.edit');
  if (!canEdit) {
    return NextResponse.json({ success: false, error: '權限不足：需要 activity.equipment_trip.edit 權限' }, { status: 403 });
  }

  const body = await request.json();
  const { campaign_id, set_number, trip_date, from_location, to_location, notes } = body;

  if (!campaign_id || !set_number || !trip_date || !from_location || !to_location) {
    return NextResponse.json({ success: false, error: '缺少必要欄位' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('campaign_equipment_trips')
    .insert({
      campaign_id,
      set_number,
      trip_date,
      from_location,
      to_location,
      notes: notes || null,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json({ success: false, error: '資料表尚未建立，請先執行 migration_campaign_equipment_trips.sql' }, { status: 500 });
    }
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}

// PUT /api/campaign-equipment-trips  → 更新
export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

  // RBAC 權限檢查
  const canEdit = await hasPermission(user.id, 'activity.equipment_trip.edit');
  if (!canEdit) {
    return NextResponse.json({ success: false, error: '權限不足：需要 activity.equipment_trip.edit 權限' }, { status: 403 });
  }

  const body = await request.json();
  const { id, set_number, trip_date, from_location, to_location, notes } = body;

  if (!id) return NextResponse.json({ success: false, error: '缺少 id' }, { status: 400 });

  const { data, error } = await supabase
    .from('campaign_equipment_trips')
    .update({ set_number, trip_date, from_location, to_location, notes: notes || null })
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, data });
}

// DELETE /api/campaign-equipment-trips?id=xxx
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

  // RBAC 權限檢查
  const canEdit = await hasPermission(user.id, 'activity.equipment_trip.edit');
  if (!canEdit) {
    return NextResponse.json({ success: false, error: '權限不足：需要 activity.equipment_trip.edit 權限' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ success: false, error: '缺少 id' }, { status: 400 });

  const { error } = await supabase
    .from('campaign_equipment_trips')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
