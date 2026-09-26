import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import {
  canCreateServiceRequestForAnyStore,
  canCreateServiceRequest,
  canReadAllServiceRequests,
  canReadOwnStoreServiceRequests,
  isStoreManagerForStore,
} from '@/lib/general-affairs/service-requests/access';
import { validateServiceRequestPayload } from '@/lib/general-affairs/service-requests/validation';

export const dynamic = 'force-dynamic';

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

function getPagination(searchParams: URLSearchParams) {
  const page = Math.max(1, Number(searchParams.get('page') || 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') || 20) || 20));
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  return { page, pageSize, from, to };
}

async function getUserDisplayName(supabase: any, userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();

  return data?.full_name || null;
}

async function enrichReplyState(rows: any[]) {
  if (!rows.length) return rows;

  const adminSupabase = createAdminClient();
  const requestIds = rows.map((row) => row.id).filter(Boolean);
  const storeIds = Array.from(new Set(rows.map((row) => row.store_id).filter(Boolean)));
  const storeUsersByStoreId = new Map<string, Set<string>>();

  if (storeIds.length) {
    const { data: storeManagers, error: storeManagerError } = await adminSupabase
      .from('store_managers')
      .select('store_id, user_id')
      .in('store_id', storeIds);
    if (storeManagerError) throw storeManagerError;

    (storeManagers || []).forEach((row) => {
      const users = storeUsersByStoreId.get(row.store_id) || new Set<string>();
      users.add(row.user_id);
      storeUsersByStoreId.set(row.store_id, users);
    });
  }

  const { data: comments, error: commentsError } = await adminSupabase
    .from('ga_service_request_comments')
    .select('id, request_id, visibility, created_by, created_at')
    .in('request_id', requestIds)
    .eq('visibility', 'PUBLIC')
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (commentsError) throw commentsError;

  const { data: publicEvents, error: eventsError } = await adminSupabase
    .from('ga_service_request_events')
    .select('request_id, event_type, visibility, metadata, created_by, created_by_name, created_at')
    .in('request_id', requestIds)
    .neq('event_type', 'REQUEST_CREATED')
    .order('created_at', { ascending: true });
  if (eventsError) throw eventsError;

  const byRequestId = new Map(rows.map((row) => [row.id, row]));
  const latestStoreCommentAt = new Map<string, string>();
  const latestGaResponseAt = new Map<string, string>();
  const latestStoreReadAt = new Map<string, string>();
  const latestStoreReadByName = new Map<string, string>();
  const commentSourceById = new Map<string, string>();
  const readCommentIds = new Set<string>();
  const storeCommentIdsByRequest = new Map<string, Set<string>>();

  (publicEvents || []).forEach((event) => {
    if (event.event_type === 'STORE_COMMENT_READ') {
      const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
      const commentId = typeof metadata.comment_id === 'string' ? metadata.comment_id : '';
      if (commentId) readCommentIds.add(commentId);
    }
    if (event.event_type !== 'PUBLIC_COMMENT_ADDED') return;
    const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
    const commentId = typeof metadata.comment_id === 'string' ? metadata.comment_id : '';
    const sourceContext = typeof metadata.source_context === 'string' ? metadata.source_context : '';
    if (commentId && sourceContext) commentSourceById.set(commentId, sourceContext);
  });

  (comments || []).forEach((comment) => {
    const row = byRequestId.get(comment.request_id);
    if (!row) return;

    const sourceContext = commentSourceById.get(comment.id);
    const storeUsers = storeUsersByStoreId.get(row.store_id);
    const isStoreComment = sourceContext === 'STORE_TRACKING'
      || (sourceContext !== 'GA_WORKBENCH' && storeUsers?.has(comment.created_by));
    if (isStoreComment) {
      const ids = storeCommentIdsByRequest.get(comment.request_id) || new Set<string>();
      ids.add(comment.id);
      storeCommentIdsByRequest.set(comment.request_id, ids);
    }
    const targetMap = isStoreComment ? latestStoreCommentAt : latestGaResponseAt;
    const current = targetMap.get(comment.request_id);
    if (!current || comment.created_at > current) targetMap.set(comment.request_id, comment.created_at);
  });

  (publicEvents || []).forEach((event) => {
    if (event.event_type === 'STORE_COMMENT_READ') {
      const current = latestStoreReadAt.get(event.request_id);
      if (!current || event.created_at > current) {
        latestStoreReadAt.set(event.request_id, event.created_at);
        latestStoreReadByName.set(event.request_id, event.created_by_name || '');
      }
      return;
    }
    if (['PUBLIC_COMMENT_ADDED', 'PUBLIC_COMMENT_EDITED', 'PUBLIC_COMMENT_DELETED'].includes(event.event_type)) return;
    if (event.visibility !== 'PUBLIC') return;
    const row = byRequestId.get(event.request_id);
    if (!row) return;

    const storeUsers = storeUsersByStoreId.get(row.store_id);
    if (storeUsers?.has(event.created_by)) return;

    const current = latestGaResponseAt.get(event.request_id);
    if (!current || event.created_at > current) latestGaResponseAt.set(event.request_id, event.created_at);
  });

  return rows.map((row) => {
    const lastStoreCommentAt = latestStoreCommentAt.get(row.id) || null;
    const lastGaResponseAt = latestGaResponseAt.get(row.id) || null;
    const lastStoreReadAt = latestStoreReadAt.get(row.id) || null;
    const storeCommentIds = storeCommentIdsByRequest.get(row.id) || new Set<string>();
    const unreadStoreCommentCount = Array.from(storeCommentIds).filter((id) => !readCommentIds.has(id)).length;
    return {
      ...row,
      last_store_comment_at: lastStoreCommentAt,
      last_ga_response_at: lastGaResponseAt,
      last_store_read_at: lastStoreReadAt,
      last_store_read_by_name: latestStoreReadByName.get(row.id) || null,
      unread_store_comment_count: unreadStoreCommentCount,
      store_reply_pending: unreadStoreCommentCount > 0,
    };
  });
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);

    const canViewAll = await canReadAllServiceRequests();
    const canViewOwn = await canReadOwnStoreServiceRequests();
    if (!canViewAll && !canViewOwn) return jsonError('沒有總務需求單查看權限', 403);

    const { searchParams } = new URL(request.url);
    const { page, pageSize, from, to } = getPagination(searchParams);

    let query = supabase
      .from('ga_service_requests')
      .select(`
        id,
        request_no,
        store_id,
        request_type,
        title,
        description,
        resource_type,
        equipment_id,
        facility_id,
        part_id,
        desired_quantity,
        desired_unit,
        desired_spec,
        impact_description,
        main_status,
        intake_route,
        assignee_role,
        assignee_name,
        maintenance_request_id,
        public_progress,
        rejection_reason,
        rejection_note,
        supplement_type,
        supplement_note,
        created_at,
        updated_at,
        store:stores(id, store_code, store_name, short_name),
        equipment:ga_equipment(id, name, asset_code, area, location_detail),
        facility:ga_facilities(id, name, facility_code, area, location_detail),
        part:ga_parts(id, name, part_code)
      `, { count: 'exact' })
      .is('deleted_at', null);

    const status = searchParams.get('status')?.trim();
    if (status) query = query.eq('main_status', status);

    const type = searchParams.get('type')?.trim();
    if (type) query = query.eq('request_type', type);

    const storeId = searchParams.get('storeId')?.trim();
    if (storeId) {
      if (!canViewAll && !await isStoreManagerForStore(user.id, storeId)) {
        return jsonError('沒有此門市的查看權限', 403);
      }
      query = query.eq('store_id', storeId);
    }

    const search = searchParams.get('search')?.trim();
    if (search) {
      query = query.or(`request_no.ilike.%${search}%,title.ilike.%${search}%,description.ilike.%${search}%`);
    }

    const sort = searchParams.get('sort') === 'updated_at' ? 'updated_at' : 'created_at';
    const sortOrder = searchParams.get('sortOrder') === 'asc' ? true : false;
    const { data, error, count } = await query
      .order(sort, { ascending: sortOrder })
      .range(from, to);

    if (error) throw error;

    const enrichedData = await enrichReplyState(data || []);

    return NextResponse.json({
      success: true,
      data: enrichedData,
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
    if (!await canCreateServiceRequest()) return jsonError('沒有建立總務需求單權限', 403);

    const body = await request.json();
    const normalized = validateServiceRequestPayload(body);
    const canCreateAnyStore = await canCreateServiceRequestForAnyStore(user.id);
    if (!canCreateAnyStore && !await isStoreManagerForStore(user.id, normalized.store_id)) {
      return jsonError('只能替自己管理的門市建立需求單', 403);
    }

    const createdByName = await getUserDisplayName(supabase, user.id);
    const payload = {
      ...normalized,
      created_by: user.id,
      created_by_name: createdByName,
    };

    const writeSupabase = canCreateAnyStore ? createAdminClient() : supabase;
    const { data, error } = await writeSupabase
      .from('ga_service_requests')
      .insert(payload)
      .select('id, request_no, main_status, public_progress, created_at')
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    return jsonError(error, error instanceof Error ? 400 : 500);
  }
}
