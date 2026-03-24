import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// GET - 取得調店申請列表
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '');
    const isBusinessAssistant = profile?.department?.startsWith('營業') && profile?.role === 'member' && !needsAssignment;
    const isBusinessSupervisor = profile?.department?.startsWith('營業') && profile?.role === 'manager' && !needsAssignment;
    const isSupervisor = ['督導', '督導(代理店長)'].includes(profile?.job_title || '');
    const isAdmin = profile?.role === 'admin';

    if (!isAdmin && !isBusinessAssistant && !isBusinessSupervisor && !isSupervisor) {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    const { data, error } = await supabase
      .from('store_transfer_requests')
      .select(`
        *,
        from_store:from_store_id ( store_name, store_code ),
        to_store:to_store_id ( store_name, store_code )
      `)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) {
      console.error('Error fetching store transfer requests:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // 另外查詢 profiles 取得 creator/confirmer 姓名（created_by 是 auth.users FK，無法直接 embed）
    const userIds = Array.from(new Set([
      ...(data || []).map((r: any) => r.created_by).filter(Boolean),
      ...(data || []).map((r: any) => r.confirmed_by).filter(Boolean),
    ]));

    let profileMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', userIds);
      profiles?.forEach((p: any) => { profileMap[p.id] = p.full_name; });
    }

    const result = (data || []).map((r: any) => ({
      ...r,
      creator: r.created_by ? { full_name: profileMap[r.created_by] || null } : null,
      confirmer: r.confirmed_by ? { full_name: profileMap[r.confirmed_by] || null } : null,
    }));

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

// POST - 建立調店申請（行政主管）
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, department, job_title')
      .eq('id', user.id)
      .single();

    const needsAssignment = ['督導', '店長', '代理店長', '督導(代理店長)'].includes(profile?.job_title || '');
    const isBusinessAssistant = profile?.department?.startsWith('營業') && profile?.role === 'member' && !needsAssignment;
    const isBusinessSupervisor = profile?.department?.startsWith('營業') && profile?.role === 'manager' && !needsAssignment;
    const isAdmin = profile?.role === 'admin';

    if (!isAdmin && !isBusinessAssistant && !isBusinessSupervisor) {
      return NextResponse.json({ success: false, error: '只有行政主管可以建立調店申請' }, { status: 403 });
    }

    const body = await request.json();
    const { employee_code, employee_name, from_store_id, to_store_id, notes } = body;

    if (!employee_code || !employee_name || !from_store_id || !to_store_id) {
      return NextResponse.json({ success: false, error: '缺少必填欄位' }, { status: 400 });
    }

    if (from_store_id === to_store_id) {
      return NextResponse.json({ success: false, error: '原任職門市與新任職門市不能相同' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('store_transfer_requests')
      .insert({
        employee_code: employee_code.toUpperCase(),
        employee_name,
        from_store_id,
        to_store_id,
        notes: notes || null,
        created_by: user.id,
        status: 'pending'
      })
      .select()
      .single();

    if (error) {
      console.error('Error creating store transfer request:', error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
