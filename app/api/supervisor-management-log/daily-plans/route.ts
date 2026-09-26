import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  canCreateSupervisorManagementLog,
  canViewSupervisorManagementLog,
} from '@/lib/supervisor-management-log/access';
import { validateDailyPlanPayload } from '@/lib/supervisor-management-log/validation';

export const dynamic = 'force-dynamic';

const SORT_COLUMNS = new Set(['plan_date', 'updated_at', 'status', 'title', 'target_type']);

function errorMessage(error: unknown, fallback = '今日管理規劃操作失敗') {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return String(error || fallback);
}

function jsonError(error: unknown, status = 500) {
  const anyError = error as { code?: string };
  const message = errorMessage(error);
  const resolvedStatus = anyError?.code === '23505' ? 409 : status;
  return NextResponse.json({ success: false, error: message }, { status: resolvedStatus });
}

function getPagination(searchParams: URLSearchParams) {
  const page = Math.max(1, Number(searchParams.get('page') || 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') || 20) || 20));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  return { page, pageSize, from, to };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canViewSupervisorManagementLog(user.id)) return jsonError('沒有督導管理日誌查看權限', 403);

    const { searchParams } = new URL(request.url);
    const { page, pageSize, from, to } = getPagination(searchParams);
    const sortBy = SORT_COLUMNS.has(searchParams.get('sortBy') || '') ? searchParams.get('sortBy')! : 'plan_date';
    const ascending = searchParams.get('sortOrder') === 'asc';

    let query = supabase
      .from('supervisor_management_daily_plans')
      .select(`
        id,
        plan_date,
        owner_user_id,
        target_type,
        store_id,
        employee_id,
        target_name_snapshot,
        category_id,
        title,
        status,
        started_at,
        completed_at,
        linked_case_id,
        linked_record_id,
        notes,
        metadata,
        created_at,
        updated_at,
        category:supervisor_management_categories(id, code, name),
        store:stores(id, store_code, store_name, short_name),
        employee:store_employees(id, employee_code, employee_name, current_position, position),
        owner:profiles!supervisor_management_daily_plans_owner_user_id_fkey(id, full_name, email),
        linked_case:supervisor_management_cases(id, case_no, title, status, priority, next_follow_up_at),
        linked_record:supervisor_management_records(id, record_type, record_date, observation, action_summary)
      `, { count: 'exact' })
      .is('deleted_at', null);

    const planDate = searchParams.get('date')?.trim();
    if (planDate) query = query.eq('plan_date', planDate);

    const status = searchParams.get('status')?.trim();
    if (status) query = query.eq('status', status.toUpperCase());

    const targetType = searchParams.get('targetType')?.trim();
    if (targetType) query = query.eq('target_type', targetType.toUpperCase());

    const storeId = searchParams.get('storeId')?.trim();
    if (storeId) query = query.eq('store_id', storeId);

    const employeeId = searchParams.get('employeeId')?.trim();
    if (employeeId) query = query.eq('employee_id', employeeId);

    const keyword = searchParams.get('search')?.trim();
    if (keyword) {
      query = query.or(`title.ilike.%${keyword}%,target_name_snapshot.ilike.%${keyword}%,notes.ilike.%${keyword}%`);
    }

    const { data, error, count } = await query
      .order(sortBy, { ascending })
      .order('updated_at', { ascending: false })
      .range(from, to);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: data || [],
      meta: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.max(1, Math.ceil((count || 0) / pageSize)),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canCreateSupervisorManagementLog(user.id)) return jsonError('沒有建立今日管理規劃權限', 403);

    const payload = {
      ...validateDailyPlanPayload(await request.json()),
      owner_user_id: user.id,
    };

    const { error } = await supabase
      .from('supervisor_management_daily_plans')
      .insert(payload);

    if (error) throw error;
    return NextResponse.json({ success: true, data: null }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
