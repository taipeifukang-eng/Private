import { NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { canManageServiceRequests } from '@/lib/general-affairs/service-requests/access';

export const dynamic = 'force-dynamic';

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error || '留言標記已讀失敗');
  return NextResponse.json({ success: false, error: message }, { status });
}

async function getUserDisplayName(supabase: any, userId: string) {
  const { data } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle();
  return data?.full_name || null;
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const adminSupabase = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManageServiceRequests()) return jsonError('沒有總務需求單管理權限', 403);
    const body = await request.json().catch(() => ({}));
    const requestedCommentId = typeof body.comment_id === 'string' ? body.comment_id.trim() : '';
    if (!requestedCommentId) return jsonError('請指定要標記已讀的留言', 400);

    const { data: serviceRequest, error: requestError } = await adminSupabase
      .from('ga_service_requests')
      .select('id, main_status, created_by')
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (requestError) throw requestError;
    if (!serviceRequest) return jsonError('找不到需求單', 404);

    const [{ data: comments, error: commentsError }, { data: sourceEvents, error: eventsError }] = await Promise.all([
      adminSupabase
        .from('ga_service_request_comments')
        .select('id, created_by, created_at')
        .eq('request_id', params.id)
        .eq('visibility', 'PUBLIC')
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      adminSupabase
        .from('ga_service_request_events')
        .select('event_type, metadata')
        .eq('request_id', params.id)
        .in('event_type', ['PUBLIC_COMMENT_ADDED', 'STORE_COMMENT_READ']),
    ]);
    if (commentsError) throw commentsError;
    if (eventsError) throw eventsError;

    const sourceByCommentId = new Map<string, string>();
    const readCommentIds = new Set<string>();
    (sourceEvents || []).forEach((event: { event_type?: string; metadata?: Record<string, unknown> | null }) => {
      const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
      if (event.event_type === 'STORE_COMMENT_READ' && typeof metadata.comment_id === 'string') {
        readCommentIds.add(metadata.comment_id);
      }
      if (typeof metadata.comment_id === 'string' && typeof metadata.source_context === 'string') {
        sourceByCommentId.set(metadata.comment_id, metadata.source_context);
      }
    });
    const requestedComment = (comments || []).find((comment) => comment.id === requestedCommentId);
    const isStoreComment = requestedComment && (
      sourceByCommentId.get(requestedComment.id) === 'STORE_TRACKING'
      || (!sourceByCommentId.has(requestedComment.id) && requestedComment.created_by === serviceRequest.created_by)
    );
    if (!requestedComment || !isStoreComment) return jsonError('找不到指定的門市留言', 404);
    if (readCommentIds.has(requestedComment.id)) {
      return NextResponse.json({ success: true, already_read: true });
    }

    const actorName = await getUserDisplayName(supabase, user.id);
    const { data: inserted, error: insertError } = await adminSupabase
      .from('ga_service_request_events')
      .insert({
        request_id: params.id,
        event_type: 'STORE_COMMENT_READ',
        old_status: serviceRequest.main_status,
        new_status: serviceRequest.main_status,
        visibility: 'PUBLIC',
        title: '已閱讀門市留言',
        description: actorName ? `${actorName} 已閱讀門市留言。` : '總務人員已閱讀門市留言。',
        metadata: {
          comment_id: requestedComment.id,
          read_at: new Date().toISOString(),
        },
        created_by: user.id,
        created_by_name: actorName,
      })
      .select('id, created_by_name, created_at, metadata')
      .single();
    if (insertError) throw insertError;

    return NextResponse.json({ success: true, data: inserted });
  } catch (error) {
    return jsonError(error);
  }
}
