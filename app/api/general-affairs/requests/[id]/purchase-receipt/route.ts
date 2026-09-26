import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import {
  canPostInventoryTransactions,
  canReadInventoryTransactionParts,
} from '@/lib/general-affairs/inventory/transactions/access';
import { extractInventoryError } from '@/lib/general-affairs/inventory/transactions/api';
import { validateInventoryTransactionPostPayload } from '@/lib/general-affairs/inventory/transactions/validation';
import { canManagePurchaseReviews } from '@/lib/general-affairs/purchase-reviews/access';

export const dynamic = 'force-dynamic';

function messageOf(error: unknown, fallback = '採購到貨入庫失敗') {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return String(error || fallback);
}

function jsonError(error: unknown, status = 500) {
  const message = messageOf(error);
  const resolvedStatus = message.includes('schema cache') || message.includes('Could not find the table')
    ? 503
    : status;
  const safeMessage = resolvedStatus === 503
    ? '採購評估或庫存交易資料表尚未建置到目前環境，請先套用相關 migration'
    : message;
  return NextResponse.json({ success: false, error: safeMessage }, { status: resolvedStatus });
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
    .select('id, request_no, title, store_id, main_status, intake_route, desired_quantity, desired_unit, part_id')
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
    if (!await canManagePurchaseReviews()) return jsonError('沒有採購評估管理權限', 403);
    if (!await canPostInventoryTransactions()) return jsonError('沒有庫存交易管理權限', 403);
    if (!await canReadInventoryTransactionParts()) return jsonError('缺少料件查看權限，無法建立採購入庫', 403);

    const current = await fetchServiceRequest(supabase, params.id);
    if (!current) return jsonError('找不到需求單', 404);
    if (current.intake_route !== 'PURCHASE_REVIEW') return jsonError('此需求單目前不是採購評估流程', 409);
    if (!['ACCEPTED', 'IN_PROGRESS'].includes(current.main_status)) return jsonError('此需求單狀態目前不可執行採購入庫', 409);

    const { data: review, error: reviewError } = await supabase
      .from('ga_purchase_reviews')
      .select('id, decision, vendor_id, vendor_name, approved_quantity, approved_unit, final_amount, delivery_method, receiving_location_id')
      .eq('request_id', current.id)
      .is('deleted_at', null)
      .maybeSingle();

    if (reviewError) throw reviewError;
    if (!review) return jsonError('此需求單尚未建立採購評估', 409);
    if (review.decision !== 'PURCHASE') return jsonError('只有評估結果為進入採購時，才可建立採購入庫', 409);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError('JSON 格式錯誤', 400);
    }

    const input = (body || {}) as Record<string, unknown>;
    const payload = validateInventoryTransactionPostPayload({
      ...input,
      transactionType: 'RECEIPT',
      referenceType: 'GA_PURCHASE_REVIEW',
      referenceId: review.id,
      reason: String(input.reason || '').trim()
        ? `採購入庫 ${current.request_no}｜${String(input.reason).trim()}`
        : `採購入庫 ${current.request_no}`,
      metadata: {
        ...(typeof input.metadata === 'object' && input.metadata && !Array.isArray(input.metadata) ? input.metadata : {}),
        source: 'ga_service_request_purchase_receipt',
        service_request_id: current.id,
        service_request_no: current.request_no,
        service_request_title: current.title,
        purchase_review_id: review.id,
        vendor_id: review.vendor_id,
        vendor_name: review.vendor_name,
        approved_quantity: review.approved_quantity,
        approved_unit: review.approved_unit,
        final_amount: review.final_amount,
        delivery_method: review.delivery_method,
      },
    });

    const adminSupabase = createAdminClient();
    const { data: linkedDocument, error: linkedDocumentError } = await adminSupabase.from('ga_part_fulfillment_documents')
      .select('id, fulfillment_id').eq('document_type', 'PURCHASE').eq('document_id', review.id).maybeSingle();
    if (linkedDocumentError) throw linkedDocumentError;
    let nextFulfilledQuantity = payload.quantity;
    let fulfillmentComplete = true;
    if (linkedDocument) {
      const { data: linkedFulfillment, error: linkedFulfillmentError } = await adminSupabase.from('ga_part_fulfillments')
        .select('requested_quantity, fulfilled_quantity').eq('id', linkedDocument.fulfillment_id).single();
      if (linkedFulfillmentError) throw linkedFulfillmentError;
      const remainingQuantity = Math.max(0, Number(linkedFulfillment.requested_quantity || 0) - Number(linkedFulfillment.fulfilled_quantity || 0));
      if (payload.quantity > remainingQuantity) return jsonError(`到貨數量不可超過剩餘需求量 ${remainingQuantity}`, 409);
      nextFulfilledQuantity = Number(linkedFulfillment.fulfilled_quantity || 0) + Number(payload.quantity || 0);
      fulfillmentComplete = Number(linkedFulfillment.requested_quantity || 0) > 0
        && nextFulfilledQuantity >= Number(linkedFulfillment.requested_quantity || 0);
    }

    const { data, error } = await supabase.rpc('ga_post_inventory_transaction', {
      p_transaction_type: 'RECEIPT',
      p_location_id: payload.locationId,
      p_part_id: payload.partId,
      p_quantity: payload.quantity,
      p_input_unit_type: payload.inputUnitType,
      p_reason: payload.reason,
      p_notes: payload.notes ?? null,
      p_reference_type: 'GA_PURCHASE_REVIEW',
      p_reference_id: review.id,
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
    const requestStoreConfirmation = input.requestStoreConfirmation === true;
    const shouldRequestStoreConfirmation = requestStoreConfirmation && fulfillmentComplete;
    const progressText = shouldRequestStoreConfirmation
      ? '總務已記錄採購到貨入庫，等待門市確認收貨或使用結果。'
      : fulfillmentComplete
        ? '總務已記錄採購到貨入庫，後續由總務安排交付與結案確認。'
        : '採購已部分到貨入庫，總務將繼續處理剩餘數量。';

    const { data: updated, error: updateError } = await adminSupabase
      .from('ga_service_requests')
      .update({
        main_status: shouldRequestStoreConfirmation ? 'WAITING_STORE_CONFIRMATION' : 'IN_PROGRESS',
        public_progress: progressText,
      })
      .eq('id', current.id)
      .is('deleted_at', null)
      .select('id, request_no, main_status, intake_route, public_progress, updated_at')
      .single();

    if (updateError) throw updateError;

    const { error: eventError } = await adminSupabase
      .from('ga_service_request_events')
      .insert({
        request_id: current.id,
        event_type: 'PURCHASE_RECEIVED',
        old_status: current.main_status,
        new_status: updated.main_status,
        visibility: 'PUBLIC',
        title: '採購到貨入庫',
        description: progressText,
        metadata: {
          action: 'purchase_receipt',
          purchase_review_id: review.id,
          transaction_id: transaction?.id || transaction?.transaction_id || null,
          transaction_no: transaction?.transaction_no || null,
          location_id: payload.locationId,
          part_id: payload.partId,
          quantity: payload.quantity,
          input_unit_type: payload.inputUnitType,
          request_store_confirmation: shouldRequestStoreConfirmation,
        },
        created_by: user.id,
        created_by_name: actorName,
      });

    if (eventError) throw eventError;

    try {
      if (linkedDocument) {
        await adminSupabase.from('ga_part_fulfillment_documents').update({ status: fulfillmentComplete ? 'RECEIVED' : 'PARTIALLY_RECEIVED' }).eq('id', linkedDocument.id);
        await adminSupabase.from('ga_part_fulfillments').update({
          status: shouldRequestStoreConfirmation ? 'WAITING_STORE_CONFIRMATION' : fulfillmentComplete ? 'COMPLETED' : 'WAITING_ARRIVAL',
          current_step: shouldRequestStoreConfirmation ? '採購已全數到貨，等待門市確認' : fulfillmentComplete ? '採購已全數到貨，等待安排交付' : `採購已到貨 ${nextFulfilledQuantity}，繼續等待剩餘數量`,
          fulfilled_quantity: nextFulfilledQuantity,
          updated_by: user.id,
        }).eq('id', linkedDocument.fulfillment_id);
      }
    } catch (linkError) {
      console.warn('採購到貨尚未同步料件處理中心:', messageOf(linkError));
    }

    return NextResponse.json({ success: true, data: { request: updated, transaction } }, { status: 201 });
  } catch (error) {
    return jsonError(error, 400);
  }
}
