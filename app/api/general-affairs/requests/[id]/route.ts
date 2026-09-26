import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import {
  canManageServiceRequests,
  canCommentOwnStoreServiceRequests,
  canReadAllServiceRequests,
  canReadOwnStoreServiceRequests,
  isStoreManagerForStore,
} from '@/lib/general-affairs/service-requests/access';
import { validateServiceRequestActionPayload } from '@/lib/general-affairs/service-requests/validation';

export const dynamic = 'force-dynamic';

const STORAGE_BUCKET = 'general-affairs-attachments';

const ROUTE_LABELS: Record<string, string> = {
  REPAIR_DISPATCH: '維修派工',
  PURCHASE_REVIEW: '添購/採購評估',
  STOCK_ISSUE: '庫存出庫',
  TRANSFER: '調撥處理',
  ASSET_TASK: '資產異動/門市配合',
};

const ROLE_LABELS: Record<string, string> = {
  GENERAL_AFFAIRS: '總務',
  WORKS: '工務',
};

const REJECTION_LABELS: Record<string, string> = {
  OUT_OF_SCOPE: '不屬於總務/工務處理範圍',
  INSUFFICIENT_DATA_RECREATE: '資料不足，請重新提出',
  DUPLICATE_REQUEST: '重複申請',
  NOT_ELIGIBLE: '不符合採購/維修條件',
  ALTERNATIVE_AVAILABLE: '已有替代處理方式',
  OTHER: '其他',
};

const SUPPLEMENT_LABELS: Record<string, string> = {
  PHOTO_UNCLEAR: '照片不清楚',
  MISSING_PHOTO: '缺少必要照片',
  DESCRIPTION_INSUFFICIENT: '問題描述不足',
  RESOURCE_SELECTION_WRONG: '設備/設施選擇錯誤',
  QUANTITY_OR_SPEC_INSUFFICIENT: '數量/規格說明不足',
  OTHER: '其他',
};

function errorMessage(error: unknown, fallback = '總務需求單操作失敗') {
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

function maskStoragePath(path: string) {
  const parts = path.split('/');
  if (parts.length <= 2) return path;
  return `${parts[0]}/.../${parts[parts.length - 1]}`;
}

async function getUserDisplayName(supabase: any, userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();

  return data?.full_name || null;
}

async function fetchRequest(supabase: any, id: string) {
  const { data, error } = await supabase
    .from('ga_service_requests')
    .select(`
      *,
      store:stores(id, store_code, store_name, short_name),
      equipment:ga_equipment(id, name, asset_code, area, location_detail),
      facility:ga_facilities(id, name, facility_code, area, location_detail),
      part:ga_parts(id, name, part_code)
    `)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function createMaintenanceWorkOrderFromServiceRequest(adminSupabase: any, request: any, userId: string, actorName: string | null) {
  if (request.request_type !== 'REPAIR') {
    throw new Error('只有維修需求可以分流為維修派工');
  }

  if (request.maintenance_request_id) {
    return request.maintenance_request_id;
  }

  const reporterName = request.created_by_name || actorName || 'Unknown';
  const resourceType = request.resource_type === 'EQUIPMENT'
    ? 'equipment'
    : request.resource_type === 'FACILITY'
      ? 'facility'
      : null;

  const descriptionParts = [
    request.description,
    request.impact_description ? `營運影響：${request.impact_description}` : null,
    request.temporary_workaround ? `暫時處理方式：${request.temporary_workaround}` : null,
    request.request_no ? `來源總務需求單：${request.request_no}` : null,
  ].filter(Boolean);

  const { data: workOrder, error: workOrderError } = await adminSupabase
    .from('maintenance_requests')
    .insert({
      store_id: request.store_id,
      title: request.title,
      description: descriptionParts.join('\n\n'),
      reported_by: request.created_by,
      reporter_name: reporterName,
      reported_at: request.created_at || new Date().toISOString(),
      priority: 'normal',
      status: 'ACCEPTED',
      resource_type: resourceType,
      issue_type: request.resource_type || null,
      contact_name: request.contact_name || null,
      contact_phone: request.contact_phone || null,
      progress_stage: 'INITIAL_REVIEW',
      assignee_name: request.assignee_name || actorName,
      accepted_at: new Date().toISOString(),
      accepted_by: userId,
      ga_service_request_id: request.id,
    })
    .select('id')
    .single();

  if (workOrderError) throw workOrderError;

  const { error: eventError } = await adminSupabase
    .from('maintenance_ticket_events')
    .insert({
      ticket_id: workOrder.id,
      event_type: 'ACCEPT',
      previous_status: null,
      new_status: 'ACCEPTED',
      previous_progress_stage: null,
      new_progress_stage: 'INITIAL_REVIEW',
      description: `由總務需求單 ${request.request_no} 受理後建立維修工單。`,
      visibility: 'PUBLIC',
      created_by: userId,
      metadata: {
        ga_service_request_id: request.id,
        ga_service_request_no: request.request_no,
      },
    });

  if (eventError) throw eventError;

  return workOrder.id;
}

async function requestLinkedMaintenanceStoreConfirmation(
  adminSupabase: any,
  maintenanceRequestId: string | null,
  userId: string,
  actorName: string | null,
  progressText: string,
) {
  if (!maintenanceRequestId) return;

  const { data: current, error: currentError } = await adminSupabase
    .from('maintenance_requests')
    .select('id, status, progress_stage')
    .eq('id', maintenanceRequestId)
    .maybeSingle();

  if (currentError) throw currentError;
  if (!current) return;

  const { error: updateError } = await adminSupabase
    .from('maintenance_requests')
    .update({
      status: 'PROCESSING',
      progress_stage: 'WAITING_STORE_CONFIRMATION',
      completion_requested_at: new Date().toISOString(),
      completion_requested_by: userId,
    })
    .eq('id', maintenanceRequestId);

  if (updateError) throw updateError;

  const { error: updateLogError } = await adminSupabase
    .from('maintenance_updates')
    .insert({
      request_id: maintenanceRequestId,
      status: 'PROCESSING',
      progress_stage: 'WAITING_STORE_CONFIRMATION',
      visibility: 'PUBLIC',
      notes: progressText,
      updated_by: userId,
      updated_by_name: actorName || 'Unknown',
    });

  if (updateLogError) throw updateLogError;

  const { error: eventError } = await adminSupabase
    .from('maintenance_ticket_events')
    .insert({
      ticket_id: maintenanceRequestId,
      event_type: 'REQUEST_COMPLETION',
      previous_status: current.status,
      new_status: 'PROCESSING',
      previous_progress_stage: current.progress_stage,
      new_progress_stage: 'WAITING_STORE_CONFIRMATION',
      description: progressText,
      visibility: 'PUBLIC',
      created_by: userId,
      metadata: {
        source: 'ga_service_request_workspace',
      },
    });

  if (eventError) throw eventError;
}

function processingProgressText(request: any) {
  const route = String(request?.intake_route || '');
  if (route === 'REPAIR_DISPATCH') return '維修需求已受理，目前由總務 / 工務處理中。';
  if (route === 'PURCHASE_REVIEW') return '添購需求已受理，目前由總務評估採購處理中。';
  if (route === 'STOCK_ISSUE') return '需求已受理，目前由總務評估庫存出庫處理中。';
  if (route === 'TRANSFER') return '需求已受理，目前由總務評估調撥處理中。';
  if (route === 'ASSET_TASK') return '需求已受理，目前由總務安排資產異動處理中。';
  return '需求已受理，目前由總務處理中。';
}

function buildActionUpdate(payload: ReturnType<typeof validateServiceRequestActionPayload>, current?: any) {
  if (payload.action === 'accept') {
    const assigneeRole = String(payload.assignee_role || '');
    const intakeRoute = String(payload.intake_route || '');
    const roleLabel = ROLE_LABELS[assigneeRole] || assigneeRole;
    const routeLabel = ROUTE_LABELS[intakeRoute] || intakeRoute;
    return {
      update: {
        main_status: 'ACCEPTED',
        intake_route: intakeRoute,
        assignee_role: assigneeRole,
        assignee_user_id: payload.assignee_user_id,
        assignee_name: payload.assignee_name,
        internal_note: payload.internal_note,
        public_progress: `總務已受理，承辦角色：${roleLabel}，後續處理方式：${routeLabel}。`,
      },
      eventTitle: '總務受理需求',
      eventDescription: `承辦角色：${roleLabel}；後續處理方式：${routeLabel}`,
      eventType: 'REQUEST_ACCEPTED',
      eventStatus: 'ACCEPTED',
      eventVisibility: 'PUBLIC',
    };
  }

  if (payload.action === 'reject') {
    const rejectionReason = String(payload.rejection_reason || '');
    const reasonLabel = REJECTION_LABELS[rejectionReason] || rejectionReason;
    return {
      update: {
        main_status: 'REJECTED',
        rejection_reason: rejectionReason,
        rejection_note: payload.rejection_note,
        internal_note: payload.internal_note,
        public_progress: `總務已駁回：${reasonLabel}。${payload.rejection_note}`,
      },
      eventTitle: '總務駁回需求',
      eventDescription: `${reasonLabel}：${payload.rejection_note}`,
      eventType: 'REQUEST_REJECTED',
      eventStatus: 'REJECTED',
      eventVisibility: 'PUBLIC',
    };
  }

  if (payload.action === 'request_supplement') {
    const supplementType = String(payload.supplement_type || '');
    const typeLabel = SUPPLEMENT_LABELS[supplementType] || supplementType;
    return {
      update: {
        main_status: 'WAITING_STORE_SUPPLEMENT',
        supplement_type: supplementType,
        supplement_note: payload.supplement_note,
        internal_note: payload.internal_note,
        public_progress: `總務要求補資料：${typeLabel}。${payload.supplement_note}`,
      },
      eventTitle: '總務要求門市補資料',
      eventDescription: `${typeLabel}：${payload.supplement_note}`,
      eventType: 'SUPPLEMENT_REQUESTED',
      eventStatus: 'WAITING_STORE_SUPPLEMENT',
      eventVisibility: 'PUBLIC',
    };
  }

  if (payload.action === 'update_progress') {
    const progressText = processingProgressText(current);
    return {
      update: {
        main_status: 'IN_PROGRESS',
        internal_note: payload.internal_note,
        public_progress: progressText,
      },
      eventTitle: '總務更新處理紀錄',
      eventDescription: payload.internal_note || progressText,
      eventType: 'REQUEST_PROGRESS_UPDATED',
      eventStatus: 'IN_PROGRESS',
      eventVisibility: payload.internal_note ? 'INTERNAL' : 'PUBLIC',
    };
  }

  if (payload.action === 'request_store_confirmation') {
    const progressText = '總務已標記處理完成，等待門市確認結果。';
    return {
      update: {
        main_status: 'WAITING_STORE_CONFIRMATION',
        internal_note: payload.internal_note,
        public_progress: progressText,
      },
      eventTitle: '總務送門市確認',
      eventDescription: progressText,
      eventType: 'STORE_CONFIRMATION_REQUESTED',
      eventStatus: 'WAITING_STORE_CONFIRMATION',
      eventVisibility: 'PUBLIC',
    };
  }

  const assigneeRole = String(payload.assignee_role || '');
  const roleLabel = ROLE_LABELS[assigneeRole] || assigneeRole;
  return {
    update: {
      assignee_role: assigneeRole,
      assignee_user_id: payload.assignee_user_id,
      assignee_name: payload.assignee_name,
      internal_note: payload.internal_note,
      public_progress: `需求已轉由${roleLabel}評估。`,
    },
    eventTitle: '總務轉派承辦角色',
    eventDescription: `承辦角色：${roleLabel}`,
    eventType: 'REQUEST_ASSIGNED',
    eventStatus: null,
    eventVisibility: 'PUBLIC',
  };
}

export async function GET(httpRequest: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);

    const request = await fetchRequest(supabase, params.id);
    if (!request) return jsonError('找不到需求單', 404);

    const canViewAll = await canReadAllServiceRequests();
    const canViewOwn = await canReadOwnStoreServiceRequests();
    const canManage = await canManageServiceRequests();
    const canStoreComment = await canCommentOwnStoreServiceRequests();
    const isOwnStore = await isStoreManagerForStore(user.id, request.store_id);
    if (!canViewAll && !canManage && (!canViewOwn || !isOwnStore)) {
      return jsonError('沒有此需求單查看權限', 403);
    }

    const { data: events, error: eventsError } = await supabase
      .from('ga_service_request_events')
      .select('id, event_type, old_status, new_status, visibility, title, description, metadata, created_by_name, created_at')
      .eq('request_id', params.id)
      .order('created_at', { ascending: true });
    if (eventsError) throw eventsError;

    const { data: comments, error: commentsError } = await supabase
      .from('ga_service_request_comments')
      .select('id, visibility, body, created_by, created_by_name, edited_at, created_at, updated_at')
      .eq('request_id', params.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    if (commentsError) throw commentsError;

    const commentRows = comments || [];
    const commentIds = commentRows.map((comment) => comment.id).filter(Boolean);
    let commentAttachments: any[] = [];
    if (commentIds.length) {
      const { data: attachmentRows, error: attachmentError } = await supabase
        .from('ga_resource_attachments')
        .select('id, resource_id, purpose, storage_bucket, storage_path, file_name, content_type, size_bytes, uploaded_at')
        .eq('resource_type', 'SERVICE_REQUEST_COMMENT')
        .in('resource_id', commentIds)
        .order('sort_order')
        .order('uploaded_at', { ascending: false });
      if (attachmentError) throw attachmentError;

      const paths = (attachmentRows || []).map((row) => row.storage_path).filter(Boolean);
      const signedMap = new Map<string, string>();
      if (paths.length) {
        const { data: signedData, error: signedError } = await createAdminClient().storage
          .from(STORAGE_BUCKET)
          .createSignedUrls(paths, 60 * 60 * 24);
        if (signedError) throw signedError;

        (signedData || []).forEach((item, index) => {
          const path = paths[index];
          if (path && item?.signedUrl) signedMap.set(path, item.signedUrl);
        });
      }

      commentAttachments = (attachmentRows || []).map((row) => ({
        ...row,
        signed_url: signedMap.get(row.storage_path) || null,
        storage_path_display: maskStoragePath(row.storage_path),
      }));
    }

    const attachmentsByCommentId = new Map<string, any[]>();
    commentAttachments.forEach((attachment) => {
      const list = attachmentsByCommentId.get(attachment.resource_id) || [];
      list.push(attachment);
      attachmentsByCommentId.set(attachment.resource_id, list);
    });

    const requestSurface = httpRequest.nextUrl?.searchParams.get('surface') || null;
    const isGeneralAffairsWorkbench = requestSurface === 'GA_WORKBENCH';
    const commentEventTypes = new Set([
      'PUBLIC_COMMENT_ADDED',
      'PUBLIC_COMMENT_EDITED',
      'PUBLIC_COMMENT_DELETED',
      'INTERNAL_COMMENT_ADDED',
      'INTERNAL_COMMENT_EDITED',
      'INTERNAL_COMMENT_DELETED',
      'STORE_COMMENT_READ',
    ]);
    const commentSourceById = new Map<string, string>();
    const commentReadById = new Map<string, { read_by_name: string | null; read_at: string | null }>();
    (events || []).forEach((event) => {
      const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
      const commentId = typeof metadata.comment_id === 'string' ? metadata.comment_id : '';
      if (event.event_type === 'STORE_COMMENT_READ' && commentId) {
        commentReadById.set(commentId, {
          read_by_name: event.created_by_name || null,
          read_at: event.created_at || null,
        });
        return;
      }
      if (event.event_type !== 'PUBLIC_COMMENT_ADDED') return;
      const sourceContext = typeof metadata.source_context === 'string' ? metadata.source_context : '';
      if (commentId && sourceContext) commentSourceById.set(commentId, sourceContext);
    });
    const timelineEvents = (events || []).filter((event) => !commentEventTypes.has(event.event_type));

    return NextResponse.json({
      success: true,
      data: request,
      events: timelineEvents,
      comments: commentRows.map((comment) => {
        const sourceContext = commentSourceById.get(comment.id)
          || (comment.created_by === request.created_by ? 'STORE_TRACKING' : 'UNKNOWN');
        const canMutateStoreComment = (
          comment.created_by === user.id
          && comment.visibility === 'PUBLIC'
          && canStoreComment
          && isOwnStore
        );
        const canMutate = sourceContext === 'STORE_TRACKING'
          ? !isGeneralAffairsWorkbench && canMutateStoreComment
          : canManage || canMutateStoreComment;
        return {
          ...comment,
          ...(commentReadById.get(comment.id) || { read_by_name: null, read_at: null }),
          source_context: sourceContext,
          can_edit: canMutate,
          can_delete: canMutate,
          attachments: attachmentsByCommentId.get(comment.id) || [],
        };
      }),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManageServiceRequests()) return jsonError('沒有總務需求單管理權限', 403);

    const current = await fetchRequest(supabase, params.id);
    if (!current) return jsonError('找不到需求單', 404);

    const payload = validateServiceRequestActionPayload(await request.json());
    const action: any = buildActionUpdate(payload, current);
    const actorName = await getUserDisplayName(supabase, user.id);
    const adminSupabase = createAdminClient();

    let maintenanceRequestId: string | null = current.maintenance_request_id || null;
    if (payload.action === 'accept' && payload.intake_route === 'REPAIR_DISPATCH') {
      maintenanceRequestId = await createMaintenanceWorkOrderFromServiceRequest(adminSupabase, current, user.id, actorName);
      action.update.maintenance_request_id = maintenanceRequestId;
      action.update.public_progress = `${action.update.public_progress} 已建立維修工單，後續由工單中心追蹤派工與處理進度。`;
    }
    if (payload.action === 'request_store_confirmation') {
      await requestLinkedMaintenanceStoreConfirmation(
        adminSupabase,
        maintenanceRequestId,
        user.id,
        actorName,
        String(action.update.public_progress),
      );
    }

    const { data: updated, error: updateError } = await adminSupabase
      .from('ga_service_requests')
      .update(action.update)
      .eq('id', params.id)
      .is('deleted_at', null)
      .select('id, request_no, main_status, intake_route, assignee_role, assignee_name, maintenance_request_id, public_progress, updated_at')
      .single();

    if (updateError) throw updateError;

    const { error: eventError } = await supabase
      .from('ga_service_request_events')
      .insert({
        request_id: params.id,
        event_type: action.eventType,
        old_status: current.main_status,
        new_status: action.eventStatus || current.main_status,
        visibility: action.eventVisibility,
        title: action.eventTitle,
        description: action.eventDescription,
        metadata: { action: payload.action, maintenance_request_id: maintenanceRequestId },
        created_by: user.id,
        created_by_name: actorName,
      });

    if (eventError) throw eventError;

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return jsonError(error, error instanceof Error ? 400 : 500);
  }
}
