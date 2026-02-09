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

    // 獲取門市管理者關聯（只取督導 role_type = 'supervisor'）
    const { data: storeManagers, error: managersError } = await supabase
      .from('store_managers')
      .select('store_id, user_id')
      .eq('role_type', 'supervisor');

    if (managersError) {
      return NextResponse.json({ success: false, error: managersError.message }, { status: 500 });
    }

    console.log('=== Store Managers (Supervisors) ===');
    console.log('Total supervisors:', storeManagers?.length || 0);
    
    // 統計每個督導管理的門市數量
    const supervisorStoreCount = new Map<string, number>();
    storeManagers?.forEach(m => {
      const count = supervisorStoreCount.get(m.user_id) || 0;
      supervisorStoreCount.set(m.user_id, count + 1);
    });
    console.log('Unique supervisors:', supervisorStoreCount.size);
    supervisorStoreCount.forEach((count, supervisorId) => {
      console.log(`  Supervisor ${supervisorId}: ${count} stores`);
    });

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
