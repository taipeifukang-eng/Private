import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import {
  canManageInventoryTransfers,
  canReadTransferParts,
} from '@/lib/general-affairs/inventory/transfers/access';
import { extractInventoryError } from '@/lib/general-affairs/inventory/transactions/api';
import { validateInventoryTransferActionPayload } from '@/lib/general-affairs/inventory/transfers/validation';

export const dynamic = 'force-dynamic';

function messageOf(error: unknown, fallback = '調撥與收貨操作失敗') {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return String(error || fallback);
}

function jsonError(error: unknown, status = 500) {
  const parsed = extractInventoryError(error);
  const raw = messageOf(error);
  const message = parsed.code === 'UNKNOWN_ERROR' ? raw : parsed.message;
  const isValidation = raw.includes('請') || raw.includes('不可') || raw.includes('錯誤') || raw.includes('必須');
  return NextResponse.json(
    { success: false, error: { code: parsed.code, message } },
    { status: parsed.code === 'UNKNOWN_ERROR' && isValidation ? 400 : (parsed.status || status) },
  );
}

function assertActionStatus(current: string, action: string) {
  if (action === 'CONFIRM_SOURCE' && current !== 'REQUESTED') throw new Error('只有待來源確認的調撥單可以確認交出');
  if (action === 'MARK_IN_TRANSIT' && current !== 'SOURCE_CONFIRMED') throw new Error('只有已確認交出的調撥單可以標記運送中');
  if (action === 'RECEIVE' && !['SOURCE_CONFIRMED', 'IN_TRANSIT'].includes(current)) throw new Error('只有已交出或運送中的調撥單可以收貨');
  if (action === 'CANCEL' && ['RECEIVED', 'CANCELED'].includes(current)) throw new Error('已收貨或已取消的調撥單不可取消');
}

async function syncPartFulfillment(transferId: string, transferStatus: string, userId: string, quantity = 0) {
  try {
    const adminSupabase = createAdminClient();
    const { data: document, error: documentLookupError } = await adminSupabase
      .from('ga_part_fulfillment_documents')
      .select('id, fulfillment_id')
      .eq('document_type', 'TRANSFER')
      .eq('document_id', transferId)
      .maybeSingle();
    if (documentLookupError) throw documentLookupError;
    if (!document) return;

    await adminSupabase.from('ga_part_fulfillment_documents').update({ status: transferStatus, ...(transferStatus === 'RECEIVED' ? { quantity } : {}) }).eq('id', document.id);
    const { data: fulfillment } = await adminSupabase.from('ga_part_fulfillments').select('requested_quantity').eq('id', document.fulfillment_id).single();
    const { data: receivedDocuments } = await adminSupabase.from('ga_part_fulfillment_documents').select('quantity').eq('fulfillment_id', document.fulfillment_id).eq('document_type', 'TRANSFER').eq('status', 'RECEIVED');
    const receivedQuantity = (receivedDocuments || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const transferComplete = Number(fulfillment?.requested_quantity || 0) > 0 && receivedQuantity >= Number(fulfillment?.requested_quantity || 0);
    const state = transferStatus === 'RECEIVED'
      ? transferComplete
        ? { status: 'WAITING_STORE_CONFIRMATION', current_step: '調撥已全數收貨，等待門市確認', fulfilled_quantity: receivedQuantity }
        : { status: 'TRANSFER', current_step: `已調撥收貨 ${receivedQuantity} / ${Number(fulfillment?.requested_quantity || 0)}，繼續處理剩餘數量`, fulfilled_quantity: receivedQuantity }
      : transferStatus === 'CANCELED'
        ? { status: 'EXCEPTION', current_step: '調撥已取消，請重新決定處理方式' }
        : transferStatus === 'IN_TRANSIT'
          ? { status: 'TRANSFER', current_step: '調撥運送中' }
          : transferStatus === 'SOURCE_CONFIRMED'
            ? { status: 'TRANSFER', current_step: '來源已交出，等待運送' }
            : { status: 'TRANSFER', current_step: '等待來源確認' };
    await adminSupabase.from('ga_part_fulfillments').update({ ...state, updated_by: userId }).eq('id', document.fulfillment_id);
  } catch (syncError) {
    console.warn('調撥進度尚未同步料件處理中心:', messageOf(syncError));
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('UNAUTHENTICATED: 未登入', 401);
    if (!await canManageInventoryTransfers()) return jsonError('PERMISSION_DENIED: 沒有調撥與收貨管理權限', 403);
    if (!await canReadTransferParts()) return jsonError('PART_VIEW_REQUIRED: 缺少 general_affairs.part.view，因此無法處理調撥單', 403);

    const payload = validateInventoryTransferActionPayload(await request.json());

    const { data: transfer, error: transferError } = await supabase
      .from('ga_inventory_transfers')
      .select(`
        id,
        transfer_no,
        source_location_id,
        destination_location_id,
        status,
        reason,
        shipping_method,
        items:ga_inventory_transfer_items(id, part_id, quantity_input, input_unit_type, source_transaction_id, receipt_transaction_id)
      `)
      .eq('id', params.id)
      .is('deleted_at', null)
      .single();
    if (transferError) throw transferError;
    if (!transfer?.items?.length) throw new Error('調撥單沒有料件明細');

    assertActionStatus(transfer.status, payload.action);

    if (payload.action === 'CANCEL') {
      const { data, error } = await supabase
        .from('ga_inventory_transfers')
        .update({
          status: 'CANCELED',
          canceled_at: new Date().toISOString(),
          canceled_by: user.id,
          cancel_reason: payload.cancelReason,
          notes: payload.notes ?? null,
          updated_by: user.id,
        })
        .eq('id', transfer.id)
        .select('*')
        .single();
      if (error) throw error;
      await syncPartFulfillment(transfer.id, 'CANCELED', user.id);
      return NextResponse.json({ success: true, data });
    }

    if (payload.action === 'CONFIRM_SOURCE') {
      for (const item of transfer.items) {
        if (item.source_transaction_id) continue;
        const { data: txRows, error: txError } = await supabase.rpc('ga_post_inventory_transaction', {
          p_transaction_type: 'ISSUE',
          p_location_id: transfer.source_location_id,
          p_part_id: item.part_id,
          p_quantity: item.quantity_input,
          p_input_unit_type: item.input_unit_type,
          p_reason: `調撥交出：${transfer.transfer_no}`,
          p_notes: payload.notes ?? null,
          p_reference_type: 'INVENTORY_TRANSFER',
          p_reference_id: transfer.id,
          p_idempotency_key: `${payload.idempotencyKey}:ISSUE:${item.id}`,
          p_occurred_at: null,
          p_metadata: { transfer_no: transfer.transfer_no, transfer_item_id: item.id, action: payload.action },
        });
        if (txError) throw txError;
        const tx = Array.isArray(txRows) ? txRows[0] : txRows;
        const { error: itemError } = await supabase
          .from('ga_inventory_transfer_items')
          .update({ source_transaction_id: tx.transaction_id, updated_by: user.id })
          .eq('id', item.id);
        if (itemError) throw itemError;
      }

      const { data, error } = await supabase
        .from('ga_inventory_transfers')
        .update({
          status: 'SOURCE_CONFIRMED',
          source_confirmed_at: new Date().toISOString(),
          source_confirmed_by: user.id,
          shipping_method: payload.shippingMethod ?? transfer.shipping_method,
          notes: payload.notes ?? null,
          updated_by: user.id,
        })
        .eq('id', transfer.id)
        .select('*')
        .single();
      if (error) throw error;
      await syncPartFulfillment(transfer.id, 'SOURCE_CONFIRMED', user.id);
      return NextResponse.json({ success: true, data });
    }

    if (payload.action === 'MARK_IN_TRANSIT') {
      const { data, error } = await supabase
        .from('ga_inventory_transfers')
        .update({
          status: 'IN_TRANSIT',
          shipped_at: new Date().toISOString(),
          shipping_method: payload.shippingMethod ?? transfer.shipping_method,
          notes: payload.notes ?? null,
          updated_by: user.id,
        })
        .eq('id', transfer.id)
        .select('*')
        .single();
      if (error) throw error;
      await syncPartFulfillment(transfer.id, 'IN_TRANSIT', user.id);
      return NextResponse.json({ success: true, data });
    }

    for (const item of transfer.items) {
      if (item.receipt_transaction_id) continue;
      if (!item.source_transaction_id) throw new Error('尚未完成來源交出，不可收貨');
      const { data: txRows, error: txError } = await supabase.rpc('ga_post_inventory_transaction', {
        p_transaction_type: 'RECEIPT',
        p_location_id: transfer.destination_location_id,
        p_part_id: item.part_id,
        p_quantity: item.quantity_input,
        p_input_unit_type: item.input_unit_type,
        p_reason: `調撥收貨：${transfer.transfer_no}`,
        p_notes: payload.notes ?? null,
        p_reference_type: 'INVENTORY_TRANSFER',
        p_reference_id: transfer.id,
        p_idempotency_key: `${payload.idempotencyKey}:RECEIPT:${item.id}`,
        p_occurred_at: null,
        p_metadata: { transfer_no: transfer.transfer_no, transfer_item_id: item.id, action: payload.action },
      });
      if (txError) throw txError;
      const tx = Array.isArray(txRows) ? txRows[0] : txRows;
      const { error: itemError } = await supabase
        .from('ga_inventory_transfer_items')
        .update({ receipt_transaction_id: tx.transaction_id, updated_by: user.id })
        .eq('id', item.id);
      if (itemError) throw itemError;
    }

    const { data, error } = await supabase
      .from('ga_inventory_transfers')
      .update({
        status: 'RECEIVED',
        received_at: new Date().toISOString(),
        received_by: user.id,
        notes: payload.notes ?? null,
        updated_by: user.id,
      })
      .eq('id', transfer.id)
      .select('*')
      .single();
    if (error) throw error;

    const receivedQuantity = transfer.items.reduce((sum: number, item: { quantity_input?: number | null }) => sum + Number(item.quantity_input || 0), 0);
    await syncPartFulfillment(transfer.id, 'RECEIVED', user.id, receivedQuantity);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return jsonError(error);
  }
}
