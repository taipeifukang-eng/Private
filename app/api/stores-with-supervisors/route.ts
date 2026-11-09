import { createClient, createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { assignSupervisorsToStores } from '@/lib/stores/supervisor-assignment';

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

    // 使用 admin client 繞過 RLS，確保所有用戶（包含盤點組）都能看到完整的督導-門市對應關係
    const adminSupabase = createAdminClient();

    // 獲取所有門市管理者關聯（從經理/督導管理設定）
    const { data: storeManagers, error: managersError } = await adminSupabase
      .from('store_managers')
      .select('store_id, user_id, role_type, user:profiles!store_managers_user_id_fkey(full_name, employee_code, job_title)');

    if (managersError) {
      return NextResponse.json({ success: false, error: managersError.message }, { status: 500 });
    }

    // 督導認定邏輯已抽到 lib/stores/supervisor-assignment.ts（內容不變，與每月人數統計共用）
    const storesWithSupervisors = assignSupervisorsToStores(stores || [], (storeManagers || []) as any, console.log);

    return NextResponse.json({ success: true, data: storesWithSupervisors });
  } catch (error) {
    console.error('Error fetching stores with supervisors:', error);
    return NextResponse.json({ success: false, error: '伺服器錯誤' }, { status: 500 });
  }
}
