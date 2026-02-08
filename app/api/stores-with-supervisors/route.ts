import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// GET: 取得所有門市及其督導關聯
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    // 獲取所有門市
    const { data: stores, error: storesError } = await supabase
      .from('stores')
      .select('id, store_code, store_name, short_name')
      .eq('is_active', true)
      .order('store_code');

    if (storesError) {
      return NextResponse.json({ success: false, error: storesError.message }, { status: 500 });
    }

    // 獲取門市管理者關聯（督導）
    const { data: storeManagers, error: managersError } = await supabase
      .from('store_managers')
      .select('store_id, user_id');

    if (managersError) {
      return NextResponse.json({ success: false, error: managersError.message }, { status: 500 });
    }

    // 將督導資訊加入門市資料
    const storesWithSupervisors = (stores || []).map(store => {
      const manager = storeManagers?.find(m => m.store_id === store.id);
      return {
        ...store,
        supervisor_id: manager?.user_id || null
      };
    });

    return NextResponse.json({ success: true, stores: storesWithSupervisors });
  } catch (error) {
    console.error('Error fetching stores with supervisors:', error);
    return NextResponse.json({ success: false, error: '伺服器錯誤' }, { status: 500 });
  }
}
