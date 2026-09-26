import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  canCreateSupervisorManagementLog,
  canViewSupervisorManagementLog,
} from '@/lib/supervisor-management-log/access';
import { validateCasePayload } from '@/lib/supervisor-management-log/validation';

export const dynamic = 'force-dynamic';

const SORT_COLUMNS = new Set(['opened_at', 'updated_at', 'next_follow_up_at', 'priority', 'status', 'title']);

function errorMessage(error: unknown, fallback = '督導管理案件操作失敗') {
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
    const sortBy = SORT_COLUMNS.has(searchParams.get('sortBy') || '') ? searchParams.get('sortBy')! : 'updated_at';
    const ascending = searchParams.get('sortOrder') === 'asc';

    let query = supabase
      .from('supervisor_management_cases')
      .select(`
        id,
        case_no,
        title,
        category_id,
        owner_user_id,
        assigned_user_id,
        target_type,
        store_id,
        employee_id,
        target_name_snapshot,
        status,
        priority,
        opened_at,
        next_follow_up_at,
        resolved_at,
        closed_at,
        summary,
        created_at,
        updated_at,
        category:supervisor_management_categories(id, code, name),
        store:stores(id, store_code, store_name, short_name),
        employee:store_employees(id, employee_code, employee_name, current_position, position),
        owner:profiles!supervisor_management_cases_owner_user_id_fkey(id, full_name, email),
        assigned_user:profiles!supervisor_management_cases_assigned_user_id_fkey(id, full_name, email)
      `, { count: 'exact' })
      .is('deleted_at', null);

    const status = searchParams.get('status')?.trim();
    if (status) query = query.eq('status', status.toUpperCase());

    const targetType = searchParams.get('targetType')?.trim();
    if (targetType) query = query.eq('target_type', targetType.toUpperCase());

    const storeId = searchParams.get('storeId')?.trim();
    if (storeId) query = query.eq('store_id', storeId);

    const keyword = searchParams.get('search')?.trim();
    if (keyword) {
      query = query.or(`title.ilike.%${keyword}%,target_name_snapshot.ilike.%${keyword}%,summary.ilike.%${keyword}%,case_no.ilike.%${keyword}%`);
    }

    const { data, error, count } = await query
      .order(sortBy, { ascending })
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
    if (!await canCreateSupervisorManagementLog(user.id)) return jsonError('沒有建立督導管理日誌權限', 403);

    const body = await request.json();
    const payload = {
      ...validateCasePayload(body),
      owner_user_id: user.id,
    };

    const { error } = await supabase
      .from('supervisor_management_cases')
      .insert(payload);

    if (error) throw error;
    return NextResponse.json({ success: true, data: null }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
