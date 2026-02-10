// ============================================
// 搜尋使用者 API
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: '未登入' }, { status: 401 });
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

    // 格式化結果
    const users = filteredEmployees.map((emp: any) => ({
      id: emp.user_id,
      email: emp.email || '',
      name: emp.employee_name || '',
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
