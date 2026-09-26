import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import {
  canCommentOwnStoreServiceRequests,
  canConfirmOwnStoreServiceRequests,
  canManageServiceRequests,
  isStoreManagerForStore,
} from '@/lib/general-affairs/service-requests/access';

export const dynamic = 'force-dynamic';

type StoreAction = 'submit_supplement' | 'confirm_complete' | 'report_problem';

const STORE_ACTIONS = new Set<StoreAction>(['submit_supplement', 'confirm_complete', 'report_problem']);

function errorMessage(error: unknown, fallback = '門市回覆需求單失敗') {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return String(error || fallback);
}

function jsonError(error: unknown, status = 500) {
  const message = errorMessage(error);
  const resolvedStatus = message.includes('schema cache') || message.includes('Could not find the table')
    ? 503
    : status;
  const safeMessage = resolvedStatus === 503
    ? '總務需求單資料表尚未建置到目前環境，請先套用 general_affairs_service_requests_foundation migration'
    : message;
  return NextResponse.json({ success: false, error: safeMessage }, { status: resolvedStatus });
}

function cleanText(value: unknown, maxLength: number) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.slice(0, maxLength);
}

function validatePayload(body: Record<string, unknown>) {
  const action = cleanText(body.action, 40) as StoreAction;
  if (!STORE_ACTIONS.has(action)) throw new Error('門市回覆動作錯誤');

  const note = cleanText(body.note, 2000);
  if (action === 'submit_supplement' && !note) throw new Error('補充資料必須填寫回覆說明');
  if (action === 'report_problem' && !note) throw new Error('回報有問題必須填寫問題原因');

  return { action, note: note || null };
}

async function getUserDisplayName(supabase: any, userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();

  return data?.full_name || null;
}

function buildStoreAction(action: StoreAction, note: string | null) {
  if (action === 'submit_supplement') {
    return {
      requiredStatus: 'WAITING_STORE_SUPPLEMENT',
      update: {
        main_status: 'WAITING_GA_REVIEW',
        public_progress: '門市已補充資料，等待總務複核。',
      },
      eventType: 'STORE_SUPPLEMENT_SUBMITTED',
      eventTitle: '門市補充資料',
      eventStatus: 'WAITING_GA_REVIEW',
      commentBody: note || '門市已補充資料。',
      maintenanceAction: null,
    };
  }

  if (action === 'confirm_complete') {
    return {
      requiredStatus: 'WAITING_STORE_CONFIRMATION',
      update: {
        main_status: 'COMPLETED',
        public_progress: '門市已確認完成。',
        completed_at: new Date().toISOString(),
      },
      eventType: 'STORE_COMPLETION_CONFIRMED',
      eventTitle: '門市確認完成',
      eventStatus: 'COMPLETED',
      commentBody: note || '門市確認完成。',
      maintenanceAction: 'STORE_CONFIRM_COMPLETE',
    };
  }

  return {
    requiredStatus: 'WAITING_STORE_CONFIRMATION',
    update: {
      main_status: 'IN_PROGRESS',
      public_progress: `門市回報完成結果仍有問題，已退回總務處理。${note ? note : ''}`,
    },
    eventType: 'STORE_COMPLETION_REPORTED_PROBLEM',
    eventTitle: '門市回報仍有問題',
    eventStatus: 'IN_PROGRESS',
    commentBody: note || '門市回報仍有問題。',
    maintenanceAction: 'REPORT_UNRESOLVED',
  };
}

async function syncLinkedMaintenanceRequest(
  adminSupabase: any,
  maintenanceRequestId: string | null,
  userId: string,
  actorName: string | null,
  action: ReturnType<typeof buildStoreAction>,
) {
  if (!maintenanceRequestId || !action.maintenanceAction) return;

  const { data: current, error: currentError } = await adminSupabase
    .from('maintenance_requests')
    .select('id, status, progress_stage')
    .eq('id', maintenanceRequestId)
    .maybeSingle();

  if (currentError) throw currentError;
  if (!current) return;

  const nextStatus = action.maintenanceAction === 'STORE_CONFIRM_COMPLETE' ? 'COMPLETED' : 'PROCESSING';
  const nextStage = action.maintenanceAction === 'STORE_CONFIRM_COMPLETE'
    ? current.progress_stage || 'WAITING_STORE_CONFIRMATION'
    : 'REOPENED';

  const now = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    status: nextStatus,
    progress_stage: nextStage,
  };

  if (action.maintenanceAction === 'STORE_CONFIRM_COMPLETE') {
    updatePayload.completed_at = now;
    updatePayload.completed_by = userId;
    updatePayload.completion_method = 'STORE_CONFIRMED';
  } else {
    updatePayload.unresolved_reason = action.commentBody;
  }

  const { error: updateError } = await adminSupabase
    .from('maintenance_requests')
    .update(updatePayload)
    .eq('id', maintenanceRequestId);

  if (updateError) throw updateError;

  const { error: updateLogError } = await adminSupabase
    .from('maintenance_updates')
    .insert({
      request_id: maintenanceRequestId,
      status: nextStatus,
      progress_stage: nextStage,
      visibility: 'PUBLIC',
      notes: action.commentBody,
      updated_by: userId,
      updated_by_name: actorName || 'Unknown',
    });

  if (updateLogError) throw updateLogError;

  const { error: eventError } = await adminSupabase
    .from('maintenance_ticket_events')
    .insert({
      ticket_id: maintenanceRequestId,
      event_type: action.maintenanceAction,
      previous_status: current.status,
      new_status: nextStatus,
      previous_progress_stage: current.progress_stage,
      new_progress_stage: nextStage,
      description: action.commentBody,
      visibility: 'PUBLIC',
      created_by: userId,
      metadata: {
        source: 'ga_service_request_store_action',
      },
    });

  if (eventError) throw eventError;
}

function isMissingPartFulfillmentSchema(error: unknown) {
  const message = errorMessage(error, '').toLowerCase();
  return (message.includes('ga_part_fulfillments') || message.includes('ga_part_fulfillment_events'))
    && (message.includes('does not exist')
      || message.includes('schema cache')
      || message.includes('could not find the table'));
}

async function syncPartFulfillment(
  adminSupabase: any,
  requestId: string,
  userId: string,
  payload: { action: StoreAction; note: string | null },
) {
  try {
    const { data: fulfillment, error: fulfillmentError } = await adminSupabase
      .from('ga_part_fulfillments')
      .select('id, status')
      .eq('request_id', requestId)
      .maybeSingle();

    if (fulfillmentError) throw fulfillmentError;
    if (!fulfillment) return;

    const event = payload.action === 'confirm_complete'
      ? {
          eventType: 'STORE_CONFIRMED',
          title: '門市已確認收貨',
          description: payload.note || '門市已確認料件處理完成。',
          update: { status: 'COMPLETED', current_step: '門市已確認收貨，處理完成' },
        }
      : payload.action === 'report_problem'
        ? {
            eventType: 'STORE_REPORTED_PROBLEM',
            title: '門市回報收貨異常',
            description: payload.note || '門市回報料件處理結果仍有問題。',
            update: { status: 'EXCEPTION', current_step: '門市回報異常，等待總務處理' },
          }
        : {
            eventType: 'STORE_SUPPLEMENT_SUBMITTED',
            title: '門市補充資料',
            description: payload.note || '門市已補充資料。',
            update: null,
          };

    if (event.update) {
      const { error: updateError } = await adminSupabase
        .from('ga_part_fulfillments')
        .update({ ...event.update, updated_by: userId })
        .eq('id', fulfillment.id);
      if (updateError) throw updateError;
    }

    const { error: eventError } = await adminSupabase
      .from('ga_part_fulfillment_events')
      .insert({
        fulfillment_id: fulfillment.id,
        event_type: event.eventType,
        title: event.title,
        description: event.description,
        metadata: {
          source: 'ga_service_request_store_action',
          action: payload.action,
          previous_status: fulfillment.status,
        },
        created_by: userId,
      });
    if (eventError) throw eventError;
  } catch (error) {
    if (isMissingPartFulfillmentSchema(error)) {
      console.warn('Part fulfillment schema is not available; store action sync was skipped.');
      return;
    }
    throw error;
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const adminSupabase = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);

    const payload = validatePayload(await request.json());
    const action = buildStoreAction(payload.action, payload.note);

    const { data: current, error: currentError } = await adminSupabase
      .from('ga_service_requests')
      .select('id, store_id, main_status, maintenance_request_id')
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (currentError) throw currentError;
    if (!current) return jsonError('找不到需求單', 404);

    const isOwnStore = await isStoreManagerForStore(user.id, current.store_id);
    const canManage = await canManageServiceRequests();
    const canComment = await canCommentOwnStoreServiceRequests();
    const canConfirm = await canConfirmOwnStoreServiceRequests();
    const allowed = payload.action === 'submit_supplement'
      ? canManage || (canComment && isOwnStore)
      : canManage || (canConfirm && isOwnStore);

    if (!allowed) return jsonError('沒有門市回覆此需求單的權限', 403);
    if (current.main_status !== action.requiredStatus) {
      return jsonError(`目前狀態不可執行此動作，需求單狀態為 ${current.main_status}`, 409);
    }

    const actorName = await getUserDisplayName(supabase, user.id);

    await syncLinkedMaintenanceRequest(
      adminSupabase,
      current.maintenance_request_id || null,
      user.id,
      actorName,
      action,
    );

    const { data: updated, error: updateError } = await adminSupabase
      .from('ga_service_requests')
      .update(action.update)
      .eq('id', params.id)
      .is('deleted_at', null)
      .select('id, request_no, main_status, public_progress, maintenance_request_id, updated_at')
      .single();

    if (updateError) throw updateError;

    const { error: commentError } = await adminSupabase
      .from('ga_service_request_comments')
      .insert({
        request_id: params.id,
        visibility: 'PUBLIC',
        body: action.commentBody,
        created_by: user.id,
        created_by_name: actorName,
      });

    if (commentError) throw commentError;

    const { error: eventError } = await adminSupabase
      .from('ga_service_request_events')
      .insert({
        request_id: params.id,
        event_type: action.eventType,
        old_status: current.main_status,
        new_status: action.eventStatus,
        visibility: 'PUBLIC',
        title: action.eventTitle,
        description: action.commentBody,
        metadata: {
          action: payload.action,
          maintenance_request_id: current.maintenance_request_id || null,
        },
        created_by: user.id,
        created_by_name: actorName,
      });

    if (eventError) throw eventError;

    await syncPartFulfillment(adminSupabase, params.id, user.id, payload);

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return jsonError(error, error instanceof Error ? 400 : 500);
  }
}
