import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await createClient();
    
    // 獲取所有店長指派（role_type = 'store_manager' 且 is_primary = true）
    const { data, error } = await supabase
      .from('store_managers')
      .select(`
        store_id,
        user_id,
        user:profiles!store_managers_user_id_fkey(full_name, employee_code)
      `)
      .eq('role_type', 'store_manager')
      .eq('is_primary', true);

    if (error) {
      console.error('Error fetching assignments:', error);
      return NextResponse.json({ success: false, error: error.message });
    }

    // 格式化資料
    const assignments = (data || []).map(item => {
      const user = Array.isArray(item.user) ? item.user[0] : item.user;
      return {
        store_id: item.store_id,
        user_id: item.user_id,
        user_name: user?.full_name || '未知',
        employee_code: user?.employee_code || null
      };
    });

    return NextResponse.json({ success: true, assignments });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
