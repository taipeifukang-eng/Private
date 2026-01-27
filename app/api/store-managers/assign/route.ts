import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { userId, storeId } = await request.json();

    if (!userId) {
      return NextResponse.json({ success: false, error: '缺少用戶ID' }, { status: 400 });
    }

    // 如果 storeId 為 null，表示要移除指派
    if (storeId === null) {
      const { error } = await supabase
        .from('store_managers')
        .delete()
        .eq('user_id', userId)
        .eq('role_type', 'store_manager')
        .eq('is_primary', true);

      if (error) {
        console.error('移除指派錯誤:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, message: '已移除店長指派' });
    }

    // 驗證 storeId
    if (!storeId) {
      return NextResponse.json({ success: false, error: '缺少門市ID' }, { status: 400 });
    }

    // 開始事務：先移除該用戶所有的店長指派，再新增新的指派
    
    // 1. 移除該用戶的所有店長指派
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

    // 2. 移除該門市的所有店長指派（確保一個門市只有一個店長）
    const { error: deleteStoreError } = await supabase
      .from('store_managers')
      .delete()
      .eq('store_id', storeId)
      .eq('role_type', 'store_manager')
      .eq('is_primary', true);

    if (deleteStoreError) {
      console.error('移除門市舊店長錯誤:', deleteStoreError);
      return NextResponse.json({ success: false, error: deleteStoreError.message }, { status: 500 });
    }

    // 3. 新增新的指派
    const { error: insertError } = await supabase
      .from('store_managers')
      .insert({
        user_id: userId,
        store_id: storeId,
        role_type: 'store_manager',
        is_primary: true
      });

    if (insertError) {
      console.error('新增指派錯誤:', insertError);
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: '店長指派成功' });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
