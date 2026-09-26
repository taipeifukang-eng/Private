import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  canManageSupervisorManagementLog,
  canViewSupervisorManagementLog,
  canWriteSupervisorManagementDailyPlan,
} from '@/lib/supervisor-management-log/access';
import {
  validateDailyPlanPayload,
  validateDeletionReason,
  validateUuid,
} from '@/lib/supervisor-management-log/validation';

export const dynamic = 'force-dynamic';

function errorMessage(error: unknown, fallback = '今日管理規劃操作失敗') {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return String(error || fallback);
}

function jsonError(error: unknown, status = 500) {
  const anyError = error as { code?: string };
  const isNotFound = anyError?.code === 'PGRST116';
  const message = errorMessage(error);
  const resolvedStatus = isNotFound ? 404 : (anyError?.code === '23505' ? 409 : status);
  return NextResponse.json(
    { success: false, error: isNotFound ? '找不到今日管理規劃' : message },
    { status: resolvedStatus },
  );
}

const DETAIL_SELECT = `
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
`;

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canViewSupervisorManagementLog(user.id)) return jsonError('沒有督導管理日誌查看權限', 403);

    const id = validateUuid(params.id, '今日管理規劃 id');
    const { data, error } = await supabase
      .from('supervisor_management_daily_plans')
      .select(DETAIL_SELECT)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canWriteSupervisorManagementDailyPlan(user.id)) return jsonError('沒有編輯今日管理規劃權限', 403);

    const id = validateUuid(params.id, '今日管理規劃 id');
    const payload = validateDailyPlanPayload(await request.json(), { partial: true });

    const { error } = await supabase
      .from('supervisor_management_daily_plans')
      .update(payload)
      .eq('id', id)
      .is('deleted_at', null);

    if (error) throw error;
    return NextResponse.json({ success: true, data: null });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManageSupervisorManagementLog(user.id)) return jsonError('沒有刪除今日管理規劃權限', 403);

    const id = validateUuid(params.id, '今日管理規劃 id');
    const body = await request.json().catch(() => ({}));
    const reason = validateDeletionReason(body);

    const { data, error } = await supabase.rpc('supervisor_management_soft_delete_daily_plan', {
      p_plan_id: id,
      p_reason: reason,
    });

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return jsonError(error);
  }
}
