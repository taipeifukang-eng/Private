// ============================================
// 搜尋使用者 API
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';
import {
  ROLE_LIST_PAGE_PERMISSION_CODES,
  USER_MANAGEMENT_NAV_PERMISSION_CODES,
} from '@/lib/permissions/rbac-management';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
    }

    const canSearchUsers = await hasAnyPermission(user.id, [
      ...USER_MANAGEMENT_NAV_PERMISSION_CODES,
      ...ROLE_LIST_PAGE_PERMISSION_CODES,
    ]);

    if (!canSearchUsers) {
      return NextResponse.json(
        { error: '沒有搜尋使用者的權限' },
        { status: 403 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const query = searchParams.get('q') || '';

    if (!query || query.length < 2) {
      return NextResponse.json({ users: [] });
    }

    // 使用 RPC 函數查詢所有員工（繞過 RLS）
    const { data: allEmployees, error: rpcError } = await supabase
      .rpc('get_all_employees_for_rbac');

    if (rpcError) {
      console.error('查詢員工錯誤:', rpcError);
      return NextResponse.json(
        { error: '搜尋使用者失敗' },
        { status: 500 }
      );
    }

    // 在應用層過濾搜尋結果
    const lowerQuery = query.toLowerCase();
    const filteredEmployees = (allEmployees || []).filter((emp: any) => 
      emp.employee_code?.toLowerCase().includes(lowerQuery) ||
      emp.employee_name?.toLowerCase().includes(lowerQuery) ||
      emp.email?.toLowerCase().includes(lowerQuery)
    ).slice(0, 20);

    const filteredUserIds = filteredEmployees
      .map((emp: any) => emp.user_id)
      .filter(Boolean);
    const profileNameById = new Map<string, string>();

    if (filteredUserIds.length > 0) {
      const adminSupabase = createAdminClient();
      const { data: profiles, error: profileError } = await adminSupabase
        .from('profiles')
        .select('id, full_name')
        .in('id', filteredUserIds);

      if (profileError) {
        console.error('查詢使用者姓名錯誤:', profileError);
        return NextResponse.json(
          { error: '搜尋使用者失敗' },
          { status: 500 }
        );
      }

      (profiles || []).forEach((profile: any) => {
        const fullName = String(profile.full_name || '').trim();
        if (profile.id && fullName) {
          profileNameById.set(profile.id, fullName);
        }
      });
    }

    // 格式化結果。使用者管理維護的 profiles.full_name 是姓名第一順位；
    // RPC 回傳的 employee_name 僅作為相容備援。
    const users = filteredEmployees.map((emp: any) => ({
      id: emp.user_id,
      email: emp.email || '',
      name: profileNameById.get(emp.user_id) || emp.employee_name || '',
      employee_code: emp.employee_code || ''
    }));

    return NextResponse.json({ users });
  } catch (error) {
    console.error('搜尋使用者異常:', error);
    return NextResponse.json(
      { error: '搜尋使用者失敗' },
      { status: 500 }
    );
  }
}
