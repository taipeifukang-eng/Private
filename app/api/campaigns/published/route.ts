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
      const { data: campaigns, error } = await supabase
        .from('campaigns')
        .select('*')
        .order('start_date', { ascending: true });

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, data: campaigns, role: 'admin' });
    }

    // 檢查是否為盤點組或行銷部人員
    const { data: profile } = await supabase
      .from('profiles')
      .select('department, job_title')
      .eq('id', user.id)
      .single();

    const isInventoryTeam = profile?.department === '營業部-盤點組';
    
    // 檢查是否為行銷部且有活動管理權限
    const isMarketingDept = profile?.department === '行銷部';
    const hasActivityAccess = await hasPermission(user.id, 'activity.management.access');
    const isMarketingWithAccess = isMarketingDept && hasActivityAccess;
    
    // 檢查是否為營業部助理
    const isBusinessAssistant = profile?.department === '營業部' && profile?.job_title === '助理';

    // 一般用戶查看已發布的活動
    // 根據用戶的門市指派查看對應的活動
    const { data: managedStores } = await supabase
      .from('store_managers')
      .select('store_id, role_type')
      .eq('user_id', user.id);

    // 根據門市管理類型判斷權限
    const isSupervisor = managedStores?.some(m => m.role_type === 'supervisor') || false;
    const isStoreManagerByTable = managedStores?.some(m => m.role_type === 'store_manager') || false;

    // 備援：從 profiles.job_title 判斷店長身份
    const isStoreManagerByTitle = ['店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '');
    const isStoreManager = isStoreManagerByTable || isStoreManagerByTitle;

    // 如果不是任何角色且不是盤點組/行銷部，返回空
    if (!isSupervisor && !isStoreManager && !isInventoryTeam && !isMarketingWithAccess && !isBusinessAssistant) {
      return NextResponse.json({ success: true, data: [], role: 'member' });
    }

    // 建立查詢條件
    let query = supabase
      .from('campaigns')
      .select('*')
      .order('start_date', { ascending: true });

    // 組裝 OR 條件
    const orConditions: string[] = [];
    if (isSupervisor) orConditions.push('published_to_supervisors.eq.true');
    if (isStoreManager) orConditions.push('published_to_store_managers.eq.true');
    if (isInventoryTeam || isMarketingWithAccess || isBusinessAssistant) orConditions.push('published_to_inventory_team.eq.true');

    if (orConditions.length === 1) {
      // 單一條件用 eq
      const [col, , val] = orConditions[0].split('.');
      query = query.eq(col, true);
    } else {
      query = query.or(orConditions.join(','));
    }

    const { data: campaigns, error } = await query;

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ 
      success: true, 
      data: campaigns,
      role: isSupervisor ? 'supervisor' : isStoreManager ? 'store_manager' : (isInventoryTeam || isMarketingWithAccess || isBusinessAssistant) ? 'inventory_team' : 'member',
      isSupervisor,
      isStoreManager,
      isInventoryTeam: isInventoryTeam || isMarketingWithAccess || isBusinessAssistant
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
