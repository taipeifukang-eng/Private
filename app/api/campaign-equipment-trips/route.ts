import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasPermission } from '@/lib/permissions/check';

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

  // 查詢所有車次
  const { data, error } = await supabase
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

  // 權限過濾：有編輯權限者看全部，否則只看與自己負責門市相關的車次
  const canEdit = await hasPermission(user.id, 'activity.equipment_trip.edit');
  
  if (canEdit) {
    // 管理者/活動組：顯示所有車次
    return NextResponse.json({ success: true, data: data ?? [] });
  }

  // 店長/督導：查詢負責的門市
  const { data: managedStores } = await supabase
    .from('store_managers')
    .select('store:stores!store_managers_store_id_fkey(store_name)')
    .eq('user_id', user.id);

  if (!managedStores || managedStores.length === 0) {
    // 無負責門市，回傳空陣列
    return NextResponse.json({ success: true, data: [] });
  }

  // 提取門市名稱清單
  const managedStoreNames = new Set<string>();
  managedStores.forEach(m => {
    const storeName = (m as any).store?.store_name;
    if (storeName) managedStoreNames.add(storeName);
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
