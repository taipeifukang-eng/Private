import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { requirePermission, hasPermission } from '@/lib/permissions/check';

// GET: 取得已發布的活動（根據用戶權限）
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    // 使用 RBAC 權限檢查
    const canViewAll = await hasPermission(user.id, 'activity.campaign.view_all');
    const canView = await hasPermission(user.id, 'activity.campaign.view');

    if (!canView && !canViewAll) {
      return NextResponse.json(
        { success: false, error: '權限不足：需要 activity.campaign.view 權限' },
        { status: 403 }
      );
    }

    // 管理員或有 view_all 權限可以看所有活動
    if (canViewAll) {
    // 管理員或有 view_all 權限可以看所有活動
    if (canViewAll) {
      const { data: campaigns, error } = await supabase
        .from('campaigns')
        .select('*')
        .order('start_date', { ascending: false });

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, data: campaigns, role: 'admin' });
    }

    // 一般用戶查看已發布的活動
    // 根據用戶的門市指派查看對應的活動
    const { data: storeAssignments } = await supabase
      .from('store_managers')
      .select('store_id')
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (!storeAssignments || storeAssignments.length === 0) {
      return NextResponse.json({ success: true, data: [], role: 'member' });
    }

    // 查詢發布給該使用者門市的活動
    const storeIds = storeAssignments.map(a => a.store_id);
    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('published_to_supervisors', true)
      .order('start_date', { ascending: false });

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ 
        success: true, 
        data: campaigns,
        role: 'business_manager',
        isSupervisor: true,  // 視為督導權限
        isStoreManager: false
      });
    }

    // 獲取用戶管理的門市
    const { data: managedStores } = await supabase
      .from('store_managers')
      .select('store_id, role_type')
      .eq('user_id', user.id);

    const isSupervisor = ['督導', '督導(代理店長)'].includes(profile.job_title || '') || 
                        managedStores?.some(m => m.role_type === 'supervisor');
    const isStoreManager = ['店長', '代理店長'].includes(profile.job_title || '') ||
                          managedStores?.some(m => m.role_type === 'store_manager');

    // 建立查詢條件
    let query = supabase
      .from('campaigns')
      .select('*')
      .order('start_date', { ascending: false });

    // 督導只能看發布給督導的活動
    if (isSupervisor && !isStoreManager) {
      query = query.eq('published_to_supervisors', true);
    } 
    // 店長只能看發布給店長的活動
    else if (isStoreManager && !isSupervisor) {
      query = query.eq('published_to_store_managers', true);
    }
    // 如果兩者都是，可以看兩種
    else if (isSupervisor && isStoreManager) {
      query = query.or('published_to_supervisors.eq.true,published_to_store_managers.eq.true');
    }

    const { data: campaigns, error } = await query;

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      data: campaigns,
      role: isSupervisor ? 'supervisor' : 'store_manager',
      isSupervisor,
      isStoreManager
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
