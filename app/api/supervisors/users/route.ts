import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import {
  requireAuthenticatedUser,
  requireStoreScopePermission,
  STORE_SCOPE_MANAGEMENT_PERMISSION_CODES,
} from '@/lib/admin/store-management-access';

export async function GET() {
  try {
    const supabase = await createClient();
    const auth = await requireAuthenticatedUser(supabase);
    if (auth.response) return auth.response;

    const permissionDenied = await requireStoreScopePermission(
      auth.user.id,
      STORE_SCOPE_MANAGEMENT_PERMISSION_CODES,
    );
    if (permissionDenied) return permissionDenied;

    // 獲取所有具有管理職稱的使用者
    const { data: users, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, department, job_title, employee_code')
      .not('job_title', 'is', null)
      .order('full_name');

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // 過濾出包含管理職稱關鍵字的使用者
    const managerKeywords = ['經理', '督導', '協理', '總監', '處長', '部長', '區經', '店長'];
    const filteredUsers = (users || []).filter(user => {
      if (!user.job_title) return false;
      return managerKeywords.some(keyword => user.job_title.includes(keyword));
    });

    return NextResponse.json({ success: true, users: filteredUsers });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
