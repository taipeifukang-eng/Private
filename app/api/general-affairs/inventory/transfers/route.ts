import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import {
  canManageInventoryTransfers,
  canReadInventoryTransfers,
  canReadTransferParts,
} from '@/lib/general-affairs/inventory/transfers/access';
import { validateInventoryTransferCreatePayload } from '@/lib/general-affairs/inventory/transfers/validation';

export const dynamic = 'force-dynamic';

function messageOf(error: unknown, fallback = '調撥與收貨操作失敗') {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return String(error || fallback);
}

function jsonError(error: unknown, status = 500) {
  const message = messageOf(error);
  const isValidation = message.includes('請') || message.includes('不可') || message.includes('錯誤') || message.includes('必須');
  return NextResponse.json({ success: false, error: message }, { status: status === 500 && isValidation ? 400 : status });
}

function pagination(searchParams: URLSearchParams) {
  const page = Math.max(1, Number(searchParams.get('page') || 1) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get('pageSize') || 20) || 20));
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canReadInventoryTransfers()) return jsonError('沒有調撥與收貨查看權限', 403);

    const { searchParams } = new URL(request.url);
    const { page, pageSize, from, to } = pagination(searchParams);
    const status = searchParams.get('status')?.trim();
    const search = searchParams.get('search')?.trim();

    let query = supabase
      .from('ga_inventory_transfers')
      .select(`
        id,
        transfer_no,
        source_location_id,
        destination_location_id,
        status,
        reason,
        notes,
        shipping_method,
        source_confirmed_at,
        shipped_at,
        received_at,
        canceled_at,
        cancel_reason,
        created_at,
        updated_at,
        source_location:ga_inventory_locations!ga_inventory_transfers_source_location_id_fkey(id, code, name, location_type, store_id, store:stores(id, store_code, store_name, short_name)),
        destination_location:ga_inventory_locations!ga_inventory_transfers_destination_location_id_fkey(id, code, name, location_type, store_id, store:stores(id, store_code, store_name, short_name)),
        items:ga_inventory_transfer_items(
          id,
          part_id,
          quantity_input,
          input_unit_type,
          notes,
          source_transaction_id,
          receipt_transaction_id,
          part:ga_parts(id, name, part_code, base_unit, purchase_unit, purchase_to_base_rate)
        )
      `, { count: 'exact' })
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);
    if (search) query = query.or(`transfer_no.ilike.%${search}%,reason.ilike.%${search}%,notes.ilike.%${search}%`);

    const { data, error, count } = await query.range(from, to);
    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: data || [],
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
    if (!await canManageInventoryTransfers()) return jsonError('沒有調撥與收貨管理權限', 403);
    if (!await canReadTransferParts()) return jsonError('缺少 general_affairs.part.view，因此無法建立調撥單', 403);

    const payload = validateInventoryTransferCreatePayload(await request.json());

    if (payload.serviceRequestId) {
      const adminSupabase = createAdminClient();
      const { data: fulfillment, error: fulfillmentError } = await adminSupabase.from('ga_part_fulfillments')
        .select('id, requested_quantity').eq('request_id', payload.serviceRequestId).is('deleted_at', null).maybeSingle();
      if (fulfillmentError) throw fulfillmentError;
      if (fulfillment) {
        const { data: activeDocuments, error: activeDocumentsError } = await adminSupabase.from('ga_part_fulfillment_documents')
          .select('quantity').eq('fulfillment_id', fulfillment.id).neq('status', 'CANCELED');
        if (activeDocumentsError) throw activeDocumentsError;
        const committedQuantity = (activeDocuments || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const requestedQuantity = Number(fulfillment.requested_quantity || 0);
        const remainingQuantity = Math.max(0, requestedQuantity - committedQuantity);
        const transferQuantity = payload.items.reduce((sum, item) => sum + item.quantity, 0);
        if (requestedQuantity > 0 && transferQuantity > remainingQuantity) throw new Error(`調撥數量不可超過剩餘需求量 ${remainingQuantity}`);
      }
    }

    const { data: transfer, error: transferError } = await supabase
      .from('ga_inventory_transfers')
      .insert({
        source_location_id: payload.sourceLocationId,
        destination_location_id: payload.destinationLocationId,
        reason: payload.reason,
        notes: payload.notes,
        shipping_method: payload.shippingMethod,
        created_by: user.id,
        updated_by: user.id,
      })
      .select('*')
      .single();
    if (transferError) throw transferError;

    const { error: itemsError } = await supabase
      .from('ga_inventory_transfer_items')
      .insert(payload.items.map((item) => ({
        transfer_id: transfer.id,
        part_id: item.partId,
        quantity_input: item.quantity,
        input_unit_type: item.inputUnitType,
        notes: item.notes,
        created_by: user.id,
        updated_by: user.id,
      })));
    if (itemsError) throw itemsError;

    if (payload.serviceRequestId) {
      try {
        const adminSupabase = createAdminClient();
        const { data: source } = await adminSupabase.from('ga_service_requests')
          .select('desired_quantity, desired_unit').eq('id', payload.serviceRequestId).maybeSingle();
        const { data: fulfillment, error: fulfillmentError } = await adminSupabase.from('ga_part_fulfillments').upsert({
          request_id: payload.serviceRequestId,
          status: 'TRANSFER',
          requested_quantity: source?.desired_quantity || null,
          unit: source?.desired_unit || null,
          current_step: '已建立調撥單，等待來源確認',
          created_by: user.id,
          updated_by: user.id,
          deleted_at: null,
        }, { onConflict: 'request_id' }).select('id').single();
        if (fulfillmentError) throw fulfillmentError;
        const quantity = payload.items.reduce((sum, item) => sum + item.quantity, 0);
        const { error: documentError } = await adminSupabase.from('ga_part_fulfillment_documents').upsert({
          fulfillment_id: fulfillment.id,
          document_type: 'TRANSFER',
          document_id: transfer.id,
          document_no: transfer.transfer_no,
          quantity,
          status: transfer.status,
          created_by: user.id,
        }, { onConflict: 'fulfillment_id,document_type,document_id' });
        if (documentError) throw documentError;
      } catch (linkError) {
        console.warn('調撥單尚未連結料件處理中心:', messageOf(linkError));
      }
    }

    return NextResponse.json({ success: true, data: transfer }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
