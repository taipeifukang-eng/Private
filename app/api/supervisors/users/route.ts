import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    // 檢查是否為管理員
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

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
