import { hasAnyPermission, hasPermission } from '@/lib/permissions/check';
import {
  EXECUTION_PROGRESS_STAGES,
  type MaintenanceEventVisibility,
  type MaintenanceProgressStage,
  type MaintenanceTicketAction,
  type MaintenanceTicketStatus,
  normalizeMaintenanceStatus,
  normalizeProgressStage,
} from '@/lib/maintenance/status';

type SupabaseClientLike = any;

type TransitionInput = {
  requestId: string;
  userId: string;
  action: MaintenanceTicketAction;
  notes: string;
  progressDate?: string;
  progressStage?: MaintenanceProgressStage | null;
  visibility?: MaintenanceEventVisibility;
  categoryId?: string | null;
  assigneeId?: string | null;
  assigneeName?: string | null;
  handlingMethod?: string | null;
  vendorId?: string | null;
  forceCloseReason?: string | null;
};

type MaintenanceRequestRow = {
  id: string;
  store_id: string;
  reported_by: string;
  status: string;
  progress_stage?: string | null;
  category_id?: string | null;
  accepted_at?: string | null;
  accepted_by?: string | null;
};

export async function getProfileName(supabase: SupabaseClientLike, userId: string, fallback = 'Unknown') {
  const { data } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();

  return data?.full_name || fallback;
}

async function getManagedStoreIds(supabase: SupabaseClientLike, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('store_managers')
    .select('store_id')
    .eq('user_id', userId);

  if (error) throw error;
  return Array.from(new Set((data || []).map((row: any) => row.store_id).filter(Boolean)));
}

export async function canManageMaintenanceTickets(userId: string) {
  return hasAnyPermission(userId, [
    'cross_dept.maintenance.update',
    'cross_dept.maintenance.view_all',
  ]);
}

export async function canForceCloseMaintenanceTickets(userId: string) {
  return hasPermission(userId, 'general_affairs.service_center.force_close');
}

async function canStoreActOnTicket(supabase: SupabaseClientLike, userId: string, ticket: MaintenanceRequestRow) {
  if (ticket.reported_by === userId) return true;

  const canSubmit = await hasAnyPermission(userId, ['cross_dept.maintenance.submit']);
  if (!canSubmit) return false;

  const managedStoreIds = await getManagedStoreIds(supabase, userId);
  return managedStoreIds.includes(ticket.store_id);
}

async function requireTransitionPermission(
  supabase: SupabaseClientLike,
  userId: string,
  action: MaintenanceTicketAction,
  ticket: MaintenanceRequestRow
) {
  if (action === 'STORE_CONFIRM_COMPLETE' || action === 'REPORT_UNRESOLVED') {
    const allowed = await canStoreActOnTicket(supabase, userId, ticket);
    if (!allowed) throw new Error('沒有門市確認此工單的權限');
    return;
  }

  if (action === 'FORCE_CLOSE') {
    const allowed = await canForceCloseMaintenanceTickets(userId);
    if (!allowed) throw new Error('沒有強制結案權限');
    return;
  }

  const allowed = await canManageMaintenanceTickets(userId);
  if (!allowed) throw new Error('沒有更新工單狀態的權限');
}

function shouldAutoAccept(action: MaintenanceTicketAction) {
  return action === 'ACCEPT' || action === 'SAVE_PROGRESS' || action === 'REQUEST_COMPLETION';
}

function resolveNextState(
  ticket: MaintenanceRequestRow,
  input: TransitionInput
): { status: MaintenanceTicketStatus; progressStage: MaintenanceProgressStage | null; completionMethod?: string | null } {
  const currentStatus = normalizeMaintenanceStatus(ticket.status) || 'UNACCEPTED';
  const currentStage = normalizeProgressStage(ticket.progress_stage) || null;
  const requestedStage = input.progressStage ?? currentStage;

  if (input.action === 'STORE_CONFIRM_COMPLETE') {
    return { status: 'COMPLETED', progressStage: requestedStage || 'WAITING_STORE_CONFIRMATION', completionMethod: 'STORE_CONFIRMED' };
  }

  if (input.action === 'REPORT_UNRESOLVED') {
    return { status: 'PROCESSING', progressStage: 'REOPENED' };
  }

  if (input.action === 'FORCE_CLOSE') {
    return { status: 'COMPLETED', progressStage: requestedStage || currentStage || 'OTHER', completionMethod: 'ADMIN_FORCE_CLOSED' };
  }

  if (input.action === 'REQUEST_COMPLETION') {
    return { status: 'PROCESSING', progressStage: 'WAITING_STORE_CONFIRMATION' };
  }

  if (input.action === 'ACCEPT') {
    return { status: currentStatus === 'UNACCEPTED' ? 'ACCEPTED' : currentStatus, progressStage: requestedStage || 'INITIAL_REVIEW' };
  }

  if (requestedStage && EXECUTION_PROGRESS_STAGES.has(requestedStage)) {
    return { status: 'PROCESSING', progressStage: requestedStage };
  }

  if (currentStatus === 'UNACCEPTED' && shouldAutoAccept(input.action)) {
    return { status: 'ACCEPTED', progressStage: requestedStage || 'INITIAL_REVIEW' };
  }

  return { status: currentStatus, progressStage: requestedStage };
}

async function insertTicketEvent(
  supabase: SupabaseClientLike,
  ticket: MaintenanceRequestRow,
  input: TransitionInput,
  nextStatus: MaintenanceTicketStatus,
  nextStage: MaintenanceProgressStage | null
) {
  const currentStatus = normalizeMaintenanceStatus(ticket.status);
  const currentStage = normalizeProgressStage(ticket.progress_stage);

  const { error } = await supabase
    .from('maintenance_ticket_events')
    .insert({
      ticket_id: ticket.id,
      event_type: input.action,
      previous_status: currentStatus,
      new_status: nextStatus,
      previous_progress_stage: currentStage,
      new_progress_stage: nextStage,
      description: input.notes,
      visibility: input.visibility || 'PUBLIC',
      created_by: input.userId,
      metadata: {
        progress_date: input.progressDate || null,
        category_id: input.categoryId ?? null,
        assignee_id: input.assigneeId ?? null,
        handling_method: input.handlingMethod ?? null,
        vendor_id: input.vendorId ?? null,
      },
    });

  if (error) throw error;
}

export async function transitionMaintenanceTicket(supabase: SupabaseClientLike, input: TransitionInput) {
  const requestId = String(input.requestId || '').trim();
  if (!requestId) throw new Error('缺少工單 id');
  if (!input.notes?.trim()) throw new Error('請填寫處理說明');

  const { data: ticket, error: ticketError } = await supabase
    .from('maintenance_requests')
    .select('id, store_id, reported_by, status, progress_stage, category_id, accepted_at, accepted_by')
    .eq('id', requestId)
    .single();

  if (ticketError) throw ticketError;
  if (!ticket) throw new Error('維修工單不存在');

  await requireTransitionPermission(supabase, input.userId, input.action, ticket);

  if (input.action === 'FORCE_CLOSE' && !input.forceCloseReason?.trim()) {
    throw new Error('強制結案必須填寫原因');
  }
  if (input.action === 'REPORT_UNRESOLVED' && !input.notes.trim()) {
    throw new Error('仍有問題必須填寫未解決原因');
  }

  const { status: nextStatus, progressStage: nextStage, completionMethod } = resolveNextState(ticket, input);
  const currentStatus = normalizeMaintenanceStatus(ticket.status) || 'UNACCEPTED';
  const normalizedCategoryId =
    typeof input.categoryId === 'string' && input.categoryId.trim()
      ? input.categoryId.trim()
      : input.categoryId === null
        ? null
        : ticket.category_id ?? null;

  const updaterName = await getProfileName(supabase, input.userId);
  const requestUpdate: Record<string, any> = {
    status: nextStatus,
    progress_stage: nextStage,
  };

  if (Object.prototype.hasOwnProperty.call(input, 'categoryId')) {
    requestUpdate.category_id = normalizedCategoryId;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'assigneeId')) {
    requestUpdate.assignee_id = input.assigneeId || null;
    requestUpdate.assignee_name = input.assigneeName || updaterName;
  } else if (Object.prototype.hasOwnProperty.call(input, 'assigneeName')) {
    requestUpdate.assignee_name = input.assigneeName || null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'handlingMethod')) {
    requestUpdate.handling_method = input.handlingMethod || null;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'vendorId')) {
    requestUpdate.vendor_id = input.vendorId || null;
  }
  if (currentStatus === 'UNACCEPTED' && (nextStatus === 'ACCEPTED' || nextStatus === 'PROCESSING')) {
    requestUpdate.accepted_at = ticket.accepted_at || new Date().toISOString();
    requestUpdate.accepted_by = ticket.accepted_by || input.userId;
  }
  if (input.action === 'REQUEST_COMPLETION') {
    requestUpdate.completion_requested_at = new Date().toISOString();
    requestUpdate.completion_requested_by = input.userId;
  }
  if (input.action === 'REPORT_UNRESOLVED') {
    requestUpdate.unresolved_reason = input.notes.trim();
  }
  if (nextStatus === 'COMPLETED') {
    requestUpdate.completed_at = new Date().toISOString();
    requestUpdate.completed_by = input.userId;
    requestUpdate.completion_method = completionMethod;
  }

  const { data: updateRecord, error: updateInsertError } = await supabase
    .from('maintenance_updates')
    .insert({
      request_id: requestId,
      status: nextStatus,
      progress_stage: nextStage,
      visibility: input.visibility || 'PUBLIC',
      notes: input.action === 'FORCE_CLOSE'
        ? `${input.notes.trim()}\n強制結案原因：${input.forceCloseReason?.trim()}`
        : input.notes.trim(),
      progress_date: input.progressDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' }),
      category_id: normalizedCategoryId,
      updated_by: input.userId,
      updated_by_name: updaterName,
    })
    .select()
    .single();

  if (updateInsertError) throw updateInsertError;

  const { error: requestUpdateError } = await supabase
    .from('maintenance_requests')
    .update(requestUpdate)
    .eq('id', requestId);

  if (requestUpdateError) throw requestUpdateError;

  await insertTicketEvent(supabase, ticket, input, nextStatus, nextStage);

  return updateRecord;
}

export function inferMaintenanceActionFromPayload(body: any): MaintenanceTicketAction {
  const action = String(body?.action || '').trim();
  if (
    action === 'ACCEPT' ||
    action === 'SAVE_PROGRESS' ||
    action === 'REQUEST_COMPLETION' ||
    action === 'STORE_CONFIRM_COMPLETE' ||
    action === 'REPORT_UNRESOLVED' ||
    action === 'FORCE_CLOSE'
  ) {
    return action;
  }

  const status = normalizeMaintenanceStatus(body?.status);
  if (status === 'COMPLETED') return 'REQUEST_COMPLETION';
  if (status === 'PROCESSING') return 'SAVE_PROGRESS';
  return 'SAVE_PROGRESS';
}
