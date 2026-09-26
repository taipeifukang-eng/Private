import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import {
  canCommentOwnStoreServiceRequests,
  canManageServiceRequests,
  isStoreManagerForStore,
} from '@/lib/general-affairs/service-requests/access';

export const dynamic = 'force-dynamic';

function errorMessage(error: unknown, fallback = '需求單留言操作失敗') {
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

async function getUserDisplayName(supabase: any, userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();

  return data?.full_name || null;
}

async function fetchCommentContext(adminSupabase: any, requestId: string, commentId: string) {
  const { data: comment, error: commentError } = await adminSupabase
    .from('ga_service_request_comments')
    .select('id, request_id, visibility, body, created_by, created_by_name, deleted_at')
    .eq('id', commentId)
    .eq('request_id', requestId)
    .maybeSingle();
  if (commentError) throw commentError;
  if (!comment || comment.deleted_at) return null;

  const { data: serviceRequest, error: requestError } = await adminSupabase
    .from('ga_service_requests')
    .select('id, store_id, main_status, created_by')
    .eq('id', requestId)
    .is('deleted_at', null)
    .maybeSingle();
  if (requestError) throw requestError;
  if (!serviceRequest) return null;

  const { data: sourceEvents, error: sourceEventError } = await adminSupabase
    .from('ga_service_request_events')
    .select('metadata')
    .eq('request_id', requestId)
    .eq('event_type', 'PUBLIC_COMMENT_ADDED');
  if (sourceEventError) throw sourceEventError;

  const sourceEvent = (sourceEvents || []).find((event: { metadata?: Record<string, unknown> | null }) => (
    event.metadata
    && typeof event.metadata === 'object'
    && event.metadata.comment_id === commentId
  ));
  const sourceContext = sourceEvent?.metadata?.source_context
    || (comment.created_by === serviceRequest.created_by ? 'STORE_TRACKING' : 'UNKNOWN');

  return { comment, serviceRequest, sourceContext };
}

async function canMutateComment(userId: string, comment: any, serviceRequest: any, sourceContext: string) {
  const canManage = await canManageServiceRequests();
  const canStoreComment = await canCommentOwnStoreServiceRequests();
  const isOwnStore = await isStoreManagerForStore(userId, serviceRequest.store_id);
  const canMutateStoreComment = Boolean(
    canStoreComment
    && isOwnStore
    && comment.created_by === userId
    && comment.visibility === 'PUBLIC',
  );
  if (sourceContext === 'STORE_TRACKING') return canMutateStoreComment;
  return canManage || canMutateStoreComment;
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string; commentId: string } }) {
  try {
    const supabase = await createClient();
    const adminSupabase = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);

    const body = await request.json();
    const nextBody = cleanText(body.body, 2000);
    if (!nextBody) return jsonError('請填寫留言內容', 400);

    const context = await fetchCommentContext(adminSupabase, params.id, params.commentId);
    if (!context) return jsonError('找不到留言', 404);
    if (!await canMutateComment(user.id, context.comment, context.serviceRequest, context.sourceContext)) {
      return jsonError('沒有編輯此留言的權限', 403);
    }

    const actorName = await getUserDisplayName(supabase, user.id);
    const { data: updated, error: updateError } = await adminSupabase
      .from('ga_service_request_comments')
      .update({
        body: nextBody,
        edited_at: new Date().toISOString(),
      })
      .eq('id', params.commentId)
      .is('deleted_at', null)
      .select('id, visibility, body, created_by_name, edited_at, created_at, updated_at')
      .single();
    if (updateError) throw updateError;

    const { error: eventError } = await adminSupabase
      .from('ga_service_request_events')
      .insert({
        request_id: params.id,
        event_type: context.comment.visibility === 'INTERNAL' ? 'INTERNAL_COMMENT_EDITED' : 'PUBLIC_COMMENT_EDITED',
        old_status: context.serviceRequest.main_status,
        new_status: context.serviceRequest.main_status,
        visibility: context.comment.visibility,
        title: context.comment.visibility === 'INTERNAL' ? '總務編輯內部備註' : '留言已編輯',
        description: nextBody,
        metadata: {
          comment_id: params.commentId,
          previous_body: context.comment.body,
        },
        created_by: user.id,
        created_by_name: actorName,
      });
    if (eventError) throw eventError;

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return jsonError(error, error instanceof Error ? 400 : 500);
  }
}

export async function DELETE(_: NextRequest, { params }: { params: { id: string; commentId: string } }) {
  try {
    const supabase = await createClient();
    const adminSupabase = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);

    const context = await fetchCommentContext(adminSupabase, params.id, params.commentId);
    if (!context) return jsonError('找不到留言', 404);
    if (!await canMutateComment(user.id, context.comment, context.serviceRequest, context.sourceContext)) {
      return jsonError('沒有刪除此留言的權限', 403);
    }

    const actorName = await getUserDisplayName(supabase, user.id);
    const deletedAt = new Date().toISOString();
    const { error: deleteError } = await adminSupabase
      .from('ga_service_request_comments')
      .update({
        deleted_at: deletedAt,
      })
      .eq('id', params.commentId)
      .is('deleted_at', null);
    if (deleteError) throw deleteError;

    const { error: eventError } = await adminSupabase
      .from('ga_service_request_events')
      .insert({
        request_id: params.id,
        event_type: context.comment.visibility === 'INTERNAL' ? 'INTERNAL_COMMENT_DELETED' : 'PUBLIC_COMMENT_DELETED',
        old_status: context.serviceRequest.main_status,
        new_status: context.serviceRequest.main_status,
        visibility: context.comment.visibility,
        title: context.comment.visibility === 'INTERNAL' ? '總務刪除內部備註' : '留言已刪除',
        description: context.comment.body,
        metadata: {
          comment_id: params.commentId,
          deleted_at: deletedAt,
        },
        created_by: user.id,
        created_by_name: actorName,
      });
    if (eventError) throw eventError;

    return NextResponse.json({ success: true });
  } catch (error) {
    return jsonError(error, error instanceof Error ? 400 : 500);
  }
}
