import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canViewSupervisorManagementLog } from '@/lib/supervisor-management-log/access';

export const dynamic = 'force-dynamic';

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error || '督導管理選項載入失敗');
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canViewSupervisorManagementLog(user.id)) return jsonError('沒有督導管理日誌查看權限', 403);

    const [categoriesResult, storesResult, employeesResult] = await Promise.all([
      supabase
        .from('supervisor_management_categories')
        .select('id, code, name, description')
        .is('deleted_at', null)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      supabase
        .from('stores')
        .select('id, store_code, store_name, short_name')
        .eq('is_active', true)
        .order('store_code', { ascending: true })
        .limit(200),
      supabase
        .from('store_employees')
        .select('id, store_id, employee_code, employee_name, current_position, position, employment_status, is_active')
        .eq('is_active', true)
        .limit(300),
    ]);

    for (const result of [categoriesResult, storesResult, employeesResult]) {
      if (result.error) throw result.error;
    }

    return NextResponse.json({
      success: true,
      data: {
        categories: categoriesResult.data || [],
        stores: storesResult.data || [],
        employees: employeesResult.data || [],
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
