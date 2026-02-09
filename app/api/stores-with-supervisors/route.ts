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
    
    // 先統計每個人管理的門市數量
    const managerStoreCount = new Map<string, { count: number; name: string; code: string | null; hasRoleType: boolean }>();
    storeManagers?.forEach(m => {
      const user = Array.isArray(m.user) ? m.user[0] : m.user;
      const current = managerStoreCount.get(m.user_id);
      managerStoreCount.set(m.user_id, {
        count: (current?.count || 0) + 1,
        name: user?.full_name || '未知',
        code: user?.employee_code || null,
        hasRoleType: current?.hasRoleType || m.role_type === 'supervisor'
      });
    });

    console.log('Unique managers/supervisors:', managerStoreCount.size);
    
    // 識別督導：結合 role_type 和門市數量
    let actualSupervisors = new Set<string>();
    const maxThreshold = totalStores * 0.9; // 90% 以上視為區域經理
    const minThreshold = 3; // 至少管理3家門市
    
    // 方案一：優先使用有 role_type = 'supervisor' 標記的
    const supervisorsWithRoleType = Array.from(managerStoreCount.entries())
      .filter(([_, info]) => info.hasRoleType);
    
    console.log('Managers with role_type=supervisor:', supervisorsWithRoleType.length);
    
    if (supervisorsWithRoleType.length > 0) {
      // 有 role_type 標記，但仍需排除區域經理（管理90%以上門市）
      supervisorsWithRoleType.forEach(([userId, info]) => {
        console.log(`  ${info.name} (${info.code || 'N/A'}): ${info.count} stores [role_type=supervisor]`);
        if (info.count >= maxThreshold) {
          console.log(`    ⚠️ 排除（區域經理，管理 ${info.count}/${totalStores} 門市，雖有 supervisor 標記）`);
        } else if (info.count >= minThreshold) {
          actualSupervisors.add(userId);
          console.log(`    ✓ 認定為督導`);
        } else {
          console.log(`    ⚠️ 排除（僅管理 ${info.count} 家門市）`);
        }
      });
    }
    
    // 方案二：如果沒有找到任何督導，或數量太少，使用門市數量推斷作為補充
    if (actualSupervisors.size === 0) {
      console.log('No valid supervisors found with role_type, using store count heuristic...');
      
      managerStoreCount.forEach((info, userId) => {
        if (!info.hasRoleType) { // 只看沒有 role_type 標記的
          console.log(`  ${info.name} (${info.code || 'N/A'}): ${info.count} stores`);
          if (info.count >= minThreshold && info.count < maxThreshold) {
            actualSupervisors.add(userId);
            console.log(`    ✓ 認定為督導（基於門市數量）`);
          } else if (info.count >= maxThreshold) {
            console.log(`    ⚠️ 排除（區域經理，管理 ${info.count}/${totalStores} 門市）`);
          } else {
            console.log(`    ⚠️ 排除（門市店長，僅管理 ${info.count} 家門市）`);
          }
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
