import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canViewSupervisorManagementLog } from '@/lib/supervisor-management-log/access';

export const dynamic = 'force-dynamic';

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error || '督導管理分類操作失敗');
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canViewSupervisorManagementLog(user.id)) return jsonError('沒有督導管理日誌查看權限', 403);

    const { data, error } = await supabase
      .from('supervisor_management_categories')
      .select('id, code, name, description, sort_order, is_active')
      .is('deleted_at', null)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) throw error;
    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return jsonError(error);
  }
}
