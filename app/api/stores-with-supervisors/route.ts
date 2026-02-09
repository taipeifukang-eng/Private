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

    const totalStores = stores?.length || 0;

    // 獲取所有門市管理者關聯（從經理/督導管理設定）
    const { data: storeManagers, error: managersError } = await supabase
      .from('store_managers')
      .select('store_id, user_id, role_type, user:profiles!store_managers_user_id_fkey(full_name, employee_code)');

    if (managersError) {
      return NextResponse.json({ success: false, error: managersError.message }, { status: 500 });
    }

    console.log('=== Store Managers Analysis ===');
    console.log('Total stores:', totalStores);
    console.log('Total assignments:', storeManagers?.length || 0);
    
    // 統計每個督導管理的門市數量
    const supervisorStoreCount = new Map<string, { count: number; name: string; code: string | null }>();
    storeManagers?.forEach(m => {
      const user = Array.isArray(m.user) ? m.user[0] : m.user;
      const count = supervisorStoreCount.get(m.user_id)?.count || 0;
      supervisorStoreCount.set(m.user_id, {
        count: count + 1,
        name: user?.full_name || '未知',
        code: user?.employee_code || null
      });
    });

    console.log('Unique managers/supervisors:', supervisorStoreCount.size);
    
    // 排除管理所有或接近所有門市的經理（如徐孝銘）
    // 以及只管理1-2家門市的店長
    // 真正的督導應該管理 3 家以上但少於 90% 的門市
    const maxThreshold = totalStores * 0.9;
    const minThreshold = 3; // 督導至少管理3家門市
    const actualSupervisors = new Set<string>();
    
    supervisorStoreCount.forEach((info, userId) => {
      console.log(`  ${info.name} (${info.code || 'N/A'}): ${info.count} stores`);
      if (info.count >= minThreshold && info.count < maxThreshold) {
        actualSupervisors.add(userId);
        console.log(`    ✓ 認定為督導`);
      } else if (info.count >= maxThreshold) {
        console.log(`    ⚠️ 排除（區域經理，管理 ${info.count}/${totalStores} 門市）`);
      } else {
        console.log(`    ⚠️ 排除（門市店長，僅管理 ${info.count} 家門市）`);
      }
    });

    console.log('Actual supervisors (區域督導):', actualSupervisors.size);

    // 將督導資訊加入門市資料（只保留真正的督導，排除區域經理）
    const storesWithSupervisors = (stores || []).map(store => {
      const manager = storeManagers?.find(m => 
        m.store_id === store.id && actualSupervisors.has(m.user_id)
      );
      const user = manager && Array.isArray(manager.user) ? manager.user[0] : manager?.user;
      return {
        ...store,
        supervisor_id: manager?.user_id || null,
        supervisor_code: user?.employee_code || null,
        supervisor_name: user?.full_name || null
      };
    });

    return NextResponse.json({ success: true, data: storesWithSupervisors });
  } catch (error) {
    console.error('Error fetching stores with supervisors:', error);
    return NextResponse.json({ success: false, error: '伺服器錯誤' }, { status: 500 });
  }
}
