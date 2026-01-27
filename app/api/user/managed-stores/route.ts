import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    // 獲取使用者管理的門市
    const { data: storeManagers, error: managersError } = await supabase
      .from('store_managers')
      .select('store_id, stores(id, store_code, store_name)')
      .eq('user_id', user.id);

    if (managersError) {
      console.error('Error loading managed stores:', managersError);
      return NextResponse.json({ success: false, error: managersError.message }, { status: 500 });
    }

    // 整理門市資料
    const stores = (storeManagers || [])
      .map(sm => sm.stores)
      .filter(Boolean)
      .map((store: any) => ({
        id: store.id,
        store_code: store.store_code,
        store_name: store.store_name
      }));

    return NextResponse.json({ success: true, stores });
  } catch (error: any) {
    console.error('API error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
