import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    // 檢查是否為管理員
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    const { userId, storeIds } = await request.json();

    if (!userId || !Array.isArray(storeIds)) {
      return NextResponse.json({ success: false, error: '參數錯誤' }, { status: 400 });
    }

    // 先查詢現有的分配
    const { data: existingAssignments } = await supabase
      .from('store_managers')
      .select('id, store_id')
      .eq('user_id', userId);

    const existingStoreIds = new Set(existingAssignments?.map(a => a.store_id) || []);
    const newStoreIds = new Set(storeIds);

    // 找出需要刪除的
    const toDelete = existingAssignments?.filter(a => !newStoreIds.has(a.store_id)) || [];
    
    // 找出需要新增的
    const toInsert = storeIds.filter(id => !existingStoreIds.has(id));

    // 執行刪除
    if (toDelete.length > 0) {
      const deleteIds = toDelete.map(a => a.id);
      const { error: deleteError } = await supabase
        .from('store_managers')
        .delete()
        .in('id', deleteIds);

      if (deleteError) {
        console.error('Delete error:', deleteError);
        return NextResponse.json({ 
          success: false, 
          error: `刪除舊資料失敗: ${deleteError.message}` 
        }, { status: 500 });
      }
    }

    // 執行新增
    if (toInsert.length > 0) {
      const assignments = toInsert.map(storeId => ({
        user_id: userId,
        store_id: storeId,
        role_type: 'supervisor', // 預設為督導
        is_primary: false
      }));

      const { error: insertError } = await supabase
        .from('store_managers')
        .insert(assignments);

      if (insertError) {
        console.error('Insert error:', insertError);
        return NextResponse.json({ 
          success: false, 
          error: `新增資料失敗: ${insertError.message}` 
        }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('API error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
