import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canManagePartFulfillments, canReadPartFulfillments } from '@/lib/general-affairs/part-fulfillments/access';
import { canPostInventoryTransactions } from '@/lib/general-affairs/inventory/transactions/access';
import { canManageInventoryTransfers } from '@/lib/general-affairs/inventory/transfers/access';
import { canManagePurchaseReviews } from '@/lib/general-affairs/purchase-reviews/access';

export const dynamic = 'force-dynamic';

function failure(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : String(error || '料件處理中心載入失敗');
  const missing = message.includes('schema cache') || message.includes('Could not find the table');
  return NextResponse.json({
    success: false,
    error: missing ? '料件處理資料表尚未建置，請先套用 general_affairs_part_fulfillments migration' : message,
  }, { status: missing ? 503 : status });
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return failure('未登入', 401);
    if (!await canReadPartFulfillments()) return failure('沒有料件處理查看權限', 403);

    const [canManage, canStockIssue, canTransfer, canPurchase] = await Promise.all([
      canManagePartFulfillments(),
      canPostInventoryTransactions(),
      canManageInventoryTransfers(),
      canManagePurchaseReviews(),
    ]);
    const status = new URL(request.url).searchParams.get('status')?.trim();
    const requestId = new URL(request.url).searchParams.get('requestId')?.trim();
    let query = supabase.from('ga_part_fulfillments').select(`
      id, fulfillment_no, request_id, status, requested_quantity, fulfilled_quantity,
      unit, current_step, notes, created_at, updated_at,
      request:ga_service_requests(id, request_no, title, description, main_status, store_id, part_id, desired_quantity, desired_unit,
        store:stores(id, store_code, store_name, short_name),
        part:ga_parts(id, part_code, name, base_unit)),
      documents:ga_part_fulfillment_documents(id, document_type, document_id, document_no, quantity, status, created_at),
      events:ga_part_fulfillment_events(id, event_type, title, description, metadata, created_at)
    `).is('deleted_at', null).order('updated_at', { ascending: false });
    if (status) query = query.eq('status', status);
    if (requestId) query = query.eq('request_id', requestId);
    const { data, error } = await query.limit(200);
    if (error) throw error;
    return NextResponse.json({
      success: true,
      data: data || [],
      capabilities: {
        manage: canManage,
        stockIssue: canManage && canStockIssue,
        transfer: canManage && canTransfer,
        purchase: canManage && canPurchase,
        purchaseReceipt: canManage && canPurchase && canStockIssue,
      },
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return failure('未登入', 401);
    if (!await canManagePartFulfillments()) return failure('沒有料件處理管理權限', 403);
    const body = await request.json();
    const requestId = String(body?.requestId || '').trim();
    if (!requestId) return failure('缺少需求單', 400);

    const { data: source, error: sourceError } = await supabase.from('ga_service_requests')
      .select('id, resource_type, desired_quantity, desired_unit').eq('id', requestId).single();
    if (sourceError) throw sourceError;
    if (source.resource_type !== 'PART') return failure('只有料件需求可建立料件處理單', 400);

    const { data: existing } = await supabase.from('ga_part_fulfillments')
      .select('*').eq('request_id', requestId).is('deleted_at', null).maybeSingle();
    if (existing) return NextResponse.json({ success: true, data: existing, existing: true });

    const { data, error } = await supabase.from('ga_part_fulfillments').insert({
      request_id: requestId,
      requested_quantity: source.desired_quantity,
      unit: source.desired_unit,
      current_step: '等待確認取得方式',
      created_by: user.id,
      updated_by: user.id,
    }).select('*').single();
    if (error) throw error;
    return NextResponse.json({ success: true, data }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
