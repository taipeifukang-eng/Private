import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { canManagePartFulfillments } from '@/lib/general-affairs/part-fulfillments/access';
import {
  canPostInventoryTransactions,
  canReadInventoryTransactionParts,
} from '@/lib/general-affairs/inventory/transactions/access';
import { extractInventoryError } from '@/lib/general-affairs/inventory/transactions/api';
import { validateInventoryTransactionPostPayload } from '@/lib/general-affairs/inventory/transactions/validation';

export const dynamic = 'force-dynamic';

const STOCK_ISSUE_ALLOWED_STATUSES = new Set(['ACCEPTED', 'IN_PROGRESS']);

function errorMessage(error: unknown, fallback = '需求單庫存出庫失敗') {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return String(error || fallback);
}

function jsonError(error: unknown, status = 500) {
  return NextResponse.json({ success: false, error: errorMessage(error) }, { status });
}

async function getUserDisplayName(supabase: any, userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();

  return data?.full_name || null;
}

async function fetchServiceRequest(supabase: any, id: string) {
  const { data, error } = await supabase
    .from('ga_service_requests')
    .select('id, request_no, title, store_id, main_status, intake_route, desired_quantity, desired_unit, part_id, public_progress')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManagePartFulfillments()) return jsonError('沒有料件處理管理權限', 403);
    if (!await canPostInventoryTransactions()) return jsonError('沒有庫存交易管理權限', 403);
    if (!await canReadInventoryTransactionParts()) return jsonError('缺少料件查看權限，無法建立需求單出庫', 403);

    const current = await fetchServiceRequest(supabase, params.id);
    if (!current) return jsonError('找不到需求單', 404);
    if (current.intake_route !== 'STOCK_ISSUE') {
      return jsonError('此需求單尚未分流為庫存出庫，請先受理並選擇庫存出庫', 409);
    }
    if (!STOCK_ISSUE_ALLOWED_STATUSES.has(current.main_status)) {
      return jsonError('此需求單狀態目前不可執行庫存出庫', 409);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError('JSON 格式錯誤', 400);
    }

    const input = (body || {}) as Record<string, unknown>;
    const payload = validateInventoryTransactionPostPayload({
      ...input,
      transactionType: 'ISSUE',
      referenceType: 'GA_SERVICE_REQUEST',
      referenceId: current.id,
      reason: String(input.reason || '').trim()
        ? `需求單出庫 ${current.request_no}｜${String(input.reason).trim()}`
        : `需求單出庫 ${current.request_no}`,
      metadata: {
        ...(typeof input.metadata === 'object' && input.metadata && !Array.isArray(input.metadata) ? input.metadata : {}),
        source: 'ga_service_request_stock_issue',
        service_request_id: current.id,
        service_request_no: current.request_no,
        service_request_title: current.title,
        requested_store_id: current.store_id,
        requested_quantity: current.desired_quantity,
        requested_unit: current.desired_unit,
      },
    });

    const adminSupabase = createAdminClient();
    const { data: linkedFulfillment } = await adminSupabase.from('ga_part_fulfillments')
      .select('id, requested_quantity').eq('request_id', current.id).is('deleted_at', null).maybeSingle();
    if (linkedFulfillment) {
      const { data: activeDocuments, error: activeDocumentsError } = await adminSupabase.from('ga_part_fulfillment_documents')
        .select('quantity').eq('fulfillment_id', linkedFulfillment.id).neq('status', 'CANCELED');
      if (activeDocumentsError) throw activeDocumentsError;
      const committedQuantity = (activeDocuments || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      const remainingQuantity = Math.max(0, Number(linkedFulfillment.requested_quantity || 0) - committedQuantity);
      if (payload.quantity > remainingQuantity) return jsonError(`出庫數量不可超過剩餘需求量 ${remainingQuantity}`, 409);
    }

    const { data, error } = await supabase.rpc('ga_post_inventory_transaction', {
      p_transaction_type: 'ISSUE',
      p_location_id: payload.locationId,
      p_part_id: payload.partId,
      p_quantity: payload.quantity,
      p_input_unit_type: payload.inputUnitType,
      p_reason: payload.reason,
      p_notes: payload.notes ?? null,
      p_reference_type: 'GA_SERVICE_REQUEST',
      p_reference_id: current.id,
      p_idempotency_key: payload.idempotencyKey,
      p_occurred_at: payload.occurredAt ?? null,
      p_metadata: payload.metadata ?? {},
    });

    if (error) {
      const parsed = extractInventoryError(error);
      return jsonError(parsed.message, parsed.status);
    }

    const transaction = Array.isArray(data) ? data[0] : data;
    const actorName = await getUserDisplayName(supabase, user.id);
    const progressText = '總務已完成需求單庫存出庫，後續等待配送、領用或門市確認結果。';

    const { data: updated, error: updateError } = await adminSupabase
      .from('ga_service_requests')
      .update({
        main_status: 'IN_PROGRESS',
        public_progress: progressText,
      })
      .eq('id', current.id)
      .is('deleted_at', null)
      .select('id, request_no, main_status, intake_route, public_progress, updated_at')
      .single();

    if (updateError) throw updateError;

    const { error: eventError } = await supabase
      .from('ga_service_request_events')
      .insert({
        request_id: current.id,
        event_type: 'STOCK_ISSUED',
        old_status: current.main_status,
        new_status: 'IN_PROGRESS',
        visibility: 'PUBLIC',
        title: '需求單庫存出庫',
        description: progressText,
        metadata: {
          action: 'stock_issue',
          transaction_id: transaction?.transaction_id || transaction?.id || null,
          transaction_no: transaction?.transaction_no || null,
          location_id: payload.locationId,
          part_id: payload.partId,
          quantity: payload.quantity,
          input_unit_type: payload.inputUnitType,
          reason: payload.reason,
        },
        created_by: user.id,
        created_by_name: actorName,
      });

    if (eventError) throw eventError;

    try {
      const { data: fulfillment, error: fulfillmentError } = await adminSupabase
        .from('ga_part_fulfillments')
        .upsert({
          request_id: current.id,
          status: 'STOCK_ISSUE',
          requested_quantity: current.desired_quantity,
          fulfilled_quantity: payload.quantity,
          unit: current.desired_unit,
          current_step: '已建立出庫單',
          created_by: user.id,
          updated_by: user.id,
          deleted_at: null,
        }, { onConflict: 'request_id' })
        .select('id')
        .single();
      if (fulfillmentError) throw fulfillmentError;
      const transactionId = transaction?.transaction_id || transaction?.id;
      if (transactionId && transaction?.transaction_no) {
        const { error: documentError } = await adminSupabase.from('ga_part_fulfillment_documents').upsert({
          fulfillment_id: fulfillment.id,
          document_type: 'STOCK_ISSUE',
          document_id: transactionId,
          document_no: transaction.transaction_no,
          quantity: payload.quantity,
          status: 'POSTED',
          created_by: user.id,
        }, { onConflict: 'fulfillment_id,document_type,document_id' });
        if (documentError) throw documentError;
      }
      const { data: issuedDocuments, error: issuedError } = await adminSupabase.from('ga_part_fulfillment_documents')
        .select('quantity').eq('fulfillment_id', fulfillment.id).eq('document_type', 'STOCK_ISSUE');
      if (issuedError) throw issuedError;
      const issuedQuantity = (issuedDocuments || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      const requestedQuantity = Number(current.desired_quantity || 0);
      await adminSupabase.from('ga_part_fulfillments').update({
        fulfilled_quantity: issuedQuantity,
        status: 'STOCK_ISSUE',
        current_step: requestedQuantity > issuedQuantity
          ? `已出庫 ${issuedQuantity} / ${requestedQuantity} ${current.desired_unit || ''}，可繼續處理剩餘數量`
          : '已完成出庫，等待交付門市',
        updated_by: user.id,
      }).eq('id', fulfillment.id);
    } catch (linkError) {
      console.warn('出庫單尚未連結料件處理中心:', errorMessage(linkError));
    }

    return NextResponse.json({ success: true, data: { request: updated, transaction } }, { status: 201 });
  } catch (error) {
    return jsonError(error, 400);
  }
}
