import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// GET: 取得已發布的活動（根據用戶角色）
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    // 獲取用戶資料和角色
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ success: false, error: '找不到用戶資料' }, { status: 404 });
    }

    // admin 可以看所有活動
    if (profile.role === 'admin') {
      const { data: campaigns, error } = await supabase
        .from('campaigns')
        .select('*')
        .order('start_date', { ascending: false });

      if (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, data: campaigns, role: 'admin' });
    }

    // 判斷是否為督導或店長
    const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile.job_title || '');
    
    if (!needsAssignment) {
      // 不是督導或店長，無權查看
      return NextResponse.json({ success: true, data: [], role: profile.role });
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
