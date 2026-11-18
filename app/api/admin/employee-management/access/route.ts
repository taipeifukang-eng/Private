import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canAccessEmployeeManagement } from '@/lib/monthly-staff/employee-management-access';

export const dynamic = 'force-dynamic';

// GET /api/admin/employee-management/access
// 唯讀。回傳目前登入者能不能進員工管理（admin 或擁有 employee.manage），給用戶端頁面（門市詳情的員工管理）使用。
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const allowed = await canAccessEmployeeManagement(user.id, profile);
    if (!allowed) return NextResponse.json({ success: false, allowed: false, error: '沒有權限' }, { status: 403 });
    return NextResponse.json({ success: true, allowed: true });
  } catch (error) {
    console.error('員工管理權限 API 錯誤:', error);
    return NextResponse.json({ success: false, error: '權限檢查失敗' }, { status: 500 });
  }
}
