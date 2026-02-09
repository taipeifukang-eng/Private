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
    
    // 方案一：直接使用 role_type = 'supervisor' 的記錄
    // 方案二：根據管理門市數量推斷（作為備用）
    
    // 先嘗試使用 role_type
    let actualSupervisors = new Set<string>();
    const supervisorsWithRoleType = storeManagers?.filter(m => m.role_type === 'supervisor') || [];
    
    console.log('Supervisors marked with role_type=supervisor:', supervisorsWithRoleType.length);
    
    if (supervisorsWithRoleType.length > 0) {
      // 如果有標記為 supervisor 的記錄，直接使用
      supervisorsWithRoleType.forEach(m => {
        actualSupervisors.add(m.user_id);
        const user = Array.isArray(m.user) ? m.user[0] : m.user;
        console.log(`  ✓ 督導: ${user?.full_name} (${user?.employee_code})`);
      });
    } else {
      // 如果沒有 role_type 標記，使用門市數量推斷
      console.log('No role_type markers found, using store count heuristic...');
      
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
    }

    console.log('Actual supervisors (區域督導):', actualSupervisors.size);

    // 將督導資訊加入門市資料（只保留真正的督導，排除區域經理）
    const storesWithSupervisors = (stores || []).map(store => {
      const manager = storeManagers?.find(m => 
        m.store_id === store.id && actualSupervisors.has(m.user_id)
      );
      
      // 處理 user 可能是陣列或物件的情況
      let user: { full_name: any; employee_code: any; } | null = null;
      if (manager?.user) {
        user = Array.isArray(manager.user) ? manager.user[0] : manager.user;
      }
      
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
