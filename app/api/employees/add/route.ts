import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // 檢查權限
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '');
    const isBusinessAssistant = profile?.department?.startsWith('營業') && profile?.role === 'member' && !needsAssignment;
    const isBusinessSupervisor = profile?.department?.startsWith('營業') && profile?.role === 'manager' && !needsAssignment;

    if (!profile || (profile.role !== 'admin' && !isBusinessAssistant && !isBusinessSupervisor)) {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    const body = await request.json();
    const { employee_code, employee_name, current_position, start_date } = body;

    if (!employee_code || !employee_name) {
      return NextResponse.json({ success: false, error: '缺少必填欄位' }, { status: 400 });
    }

    // 檢查員編是否已存在
    const { data: existing } = await supabase
      .from('store_employees')
      .select('employee_code')
      .eq('employee_code', employee_code.toUpperCase())
      .single();

    if (existing) {
      return NextResponse.json({ success: false, error: '此員編已存在' }, { status: 400 });
    }

    // 新增員工（不指定門市，store_id 為 null）
    const { data, error } = await supabase
      .from('store_employees')
      .insert({
        employee_code: employee_code.toUpperCase(),
        employee_name: employee_name.trim(),
        position: current_position || null,
        current_position: current_position || null,
        start_date: start_date || null,
        is_active: true,
        store_id: null // 全域員工，不綁定門市
      })
      .select()
      .single();

    if (error) {
      console.error('Error adding employee:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      employee: data,
      message: '新增員工成功'
    });

  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: error.message || '處理失敗' },
      { status: 500 }
    );
  }
}
