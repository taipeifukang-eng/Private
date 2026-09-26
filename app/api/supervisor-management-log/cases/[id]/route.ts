import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  canManageSupervisorManagementLog,
  canUpdateSupervisorManagementLog,
  canViewSupervisorManagementLog,
} from '@/lib/supervisor-management-log/access';
import {
  validateCasePayload,
  validateDeletionReason,
  validateUuid,
} from '@/lib/supervisor-management-log/validation';

export const dynamic = 'force-dynamic';

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
  const isNotFound = anyError?.code === 'PGRST116';
  const resolvedStatus = isNotFound ? 404 : (anyError?.code === '23505' ? 409 : status);
  return NextResponse.json({ success: false, error: isNotFound ? '找不到督導管理案件' : message }, { status: resolvedStatus });
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canViewSupervisorManagementLog(user.id)) return jsonError('沒有督導管理日誌查看權限', 403);

    const id = validateUuid(params.id, '案件 id');
    const { data, error } = await supabase
      .from('supervisor_management_cases')
      .select(`
        *,
        category:supervisor_management_categories(id, code, name),
        store:stores(id, store_code, store_name, short_name),
        employee:store_employees(id, employee_code, employee_name, current_position, position),
        owner:profiles!supervisor_management_cases_owner_user_id_fkey(id, full_name, email),
        assigned_user:profiles!supervisor_management_cases_assigned_user_id_fkey(id, full_name, email),
        records:supervisor_management_records(
          id,
          record_type,
          record_date,
          target_name_snapshot,
          observation,
          judgment,
          action_summary,
          action_options,
          requires_follow_up,
          follow_up_date,
          expected_result,
          follow_up_method,
          ai_generated,
          created_at,
          updated_at
        ),
        followups:supervisor_management_followups(
          id,
          source_record_id,
          follow_up_date,
          result_status,
          result_notes,
          next_follow_up_date,
          created_at,
          updated_at
        ),
        events:supervisor_management_case_events(
          id,
          record_id,
          followup_id,
          event_type,
          event_at,
          title,
          body,
          actor_user_id
        )
      `)
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
    if (!await canUpdateSupervisorManagementLog(user.id)) return jsonError('沒有編輯督導管理日誌權限', 403);

    const id = validateUuid(params.id, '案件 id');
    const body = await request.json();
    const payload = validateCasePayload(body, { partial: true });

    const { error } = await supabase
      .from('supervisor_management_cases')
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
    if (!await canManageSupervisorManagementLog(user.id)) return jsonError('沒有刪除督導管理案件權限', 403);

    const id = validateUuid(params.id, '案件 id');
    const body = await request.json().catch(() => ({}));
    const reason = validateDeletionReason(body);

    const { data, error } = await supabase.rpc('supervisor_management_soft_delete_case', {
      p_case_id: id,
      p_reason: reason,
    });

    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return jsonError(error);
  }
}
