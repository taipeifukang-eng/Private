import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { userId, storeIds } = await request.json();

    if (!userId) {
      return NextResponse.json({ success: false, error: '缺少用戶ID' }, { status: 400 });
    }

    if (!storeIds || !Array.isArray(storeIds) || storeIds.length === 0) {
      return NextResponse.json({ success: false, error: '請至少選擇一個門市' }, { status: 400 });
    }

    // 1. 先移除該用戶的所有店長指派
    const { error: deleteError } = await supabase
      .from('store_managers')
      .delete()
      .eq('user_id', userId)
      .eq('role_type', 'store_manager')
      .eq('is_primary', true);

    if (deleteError) {
      console.error('移除舊指派錯誤:', deleteError);
      return NextResponse.json({ success: false, error: deleteError.message }, { status: 500 });
    }

    // 2. 批量新增新的指派
    const assignments = storeIds.map(storeId => ({
      user_id: userId,
      store_id: storeId,
      role_type: 'store_manager',
      is_primary: true
    }));

    const { error: insertError } = await supabase
      .from('store_managers')
      .insert(assignments);

    if (insertError) {
      console.error('新增指派錯誤:', insertError);
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      message: `成功指派 ${storeIds.length} 間門市` 
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const supabase = await createClient();
    const { userId, storeId } = await request.json();

    if (!userId) {
      return NextResponse.json({ success: false, error: '缺少用戶ID' }, { status: 400 });
    }

    // 建立基本查詢
    let query = supabase
      .from('store_managers')
      .delete()
      .eq('user_id', userId)
      .eq('role_type', 'store_manager')
      .eq('is_primary', true);

    // 如果有指定 storeId，只移除該門市的指派
    if (storeId) {
      query = query.eq('store_id', storeId);
    }

    const { error } = await query;

    if (error) {
      console.error('移除指派錯誤:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      message: storeId ? '已移除指定門市的店長指派' : '已移除所有店長指派' 
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
