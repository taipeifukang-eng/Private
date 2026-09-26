import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import {
  canCommentOwnStoreServiceRequests,
  canManageServiceRequests,
  isStoreManagerForStore,
} from '@/lib/general-affairs/service-requests/access';

export const dynamic = 'force-dynamic';

function errorMessage(error: unknown, fallback = '需求單留言失敗') {
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

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const adminSupabase = createAdminClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);

    const body = await request.json();
    const commentBody = cleanText(body.body, 2000);
    const visibility = cleanText(body.visibility, 20).toUpperCase() === 'INTERNAL' ? 'INTERNAL' : 'PUBLIC';
    const requestedSourceContext = cleanText(body.source_context, 30).toUpperCase();
    const sourceContext = requestedSourceContext === 'STORE_TRACKING' ? 'STORE_TRACKING' : 'GA_WORKBENCH';
    if (!commentBody) return jsonError('請填寫留言內容', 400);

    const { data: serviceRequest, error: requestError } = await adminSupabase
      .from('ga_service_requests')
      .select('id, store_id, main_status')
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (requestError) throw requestError;
    if (!serviceRequest) return jsonError('找不到需求單', 404);

    const canManage = await canManageServiceRequests();
    const isOwnStore = await isStoreManagerForStore(user.id, serviceRequest.store_id);
    const canStoreComment = await canCommentOwnStoreServiceRequests();
    const allowed = canManage || (visibility === 'PUBLIC' && canStoreComment && isOwnStore);
    if (!allowed) return jsonError('沒有留言此需求單的權限', 403);
    if (!canManage && visibility === 'INTERNAL') return jsonError('門市留言只能設為公開', 403);

    const actorName = await getUserDisplayName(supabase, user.id);
    const { data: inserted, error: insertError } = await adminSupabase
      .from('ga_service_request_comments')
      .insert({
        request_id: params.id,
        visibility,
        body: commentBody,
        created_by: user.id,
        created_by_name: actorName,
      })
      .select('id, visibility, body, created_by_name, created_at, updated_at')
      .single();

    if (insertError) throw insertError;

    const { error: eventError } = await adminSupabase
      .from('ga_service_request_events')
      .insert({
        request_id: params.id,
        event_type: visibility === 'INTERNAL' ? 'INTERNAL_COMMENT_ADDED' : 'PUBLIC_COMMENT_ADDED',
        old_status: serviceRequest.main_status,
        new_status: serviceRequest.main_status,
        visibility,
        title: visibility === 'INTERNAL' ? '總務新增內部備註' : '新增公開留言',
        description: commentBody,
        metadata: {
          comment_id: inserted.id,
          source_context: sourceContext,
        },
        created_by: user.id,
        created_by_name: actorName,
      });

    if (eventError) throw eventError;

    return NextResponse.json({ success: true, data: inserted }, { status: 201 });
  } catch (error) {
    return jsonError(error, error instanceof Error ? 400 : 500);
  }
}
