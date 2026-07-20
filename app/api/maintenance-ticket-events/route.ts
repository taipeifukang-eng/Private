import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasAnyPermission } from '@/lib/permissions/check';

async function getManagedStoreIds(supabase: any, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('store_managers')
    .select('store_id')
    .eq('user_id', userId);

  if (error) throw error;
  return Array.from(new Set((data || []).map((row: any) => row.store_id).filter(Boolean)));
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });

    const requestId = new URL(request.url).searchParams.get('request_id');
    if (!requestId) {
      return NextResponse.json({ success: false, error: '缺少 request_id' }, { status: 400 });
    }

    const { data: ticket, error: ticketError } = await supabase
      .from('maintenance_requests')
      .select('id, store_id, reported_by')
      .eq('id', requestId)
      .single();
    if (ticketError) throw ticketError;
    if (!ticket) return NextResponse.json({ success: false, error: '工單不存在' }, { status: 404 });

    const canManage = await hasAnyPermission(user.id, [
      'cross_dept.maintenance.view_all',
      'cross_dept.maintenance.update',
    ]);

    let canStoreView = ticket.reported_by === user.id;
    if (!canStoreView) {
      const managedStoreIds = await getManagedStoreIds(supabase, user.id);
      canStoreView = managedStoreIds.includes(ticket.store_id);
    }

    if (!canManage && !canStoreView) {
      return NextResponse.json({ success: false, error: '沒有工單歷程查看權限' }, { status: 403 });
    }

    let query = supabase
      .from('maintenance_ticket_events')
      .select('*')
      .eq('ticket_id', requestId)
      .order('created_at', { ascending: false });

    if (!canManage) {
      query = query.eq('visibility', 'PUBLIC');
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: data ?? [] });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message || '工單歷程查詢失敗' }, { status: 500 });
  }
}
