import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { canReadInventoryBalances } from '@/lib/general-affairs/inventory/transactions/access';
import { canManagePurchaseReviews, canReadPurchaseReviews } from '@/lib/general-affairs/purchase-reviews/access';
import { validatePurchaseReviewPayload } from '@/lib/general-affairs/purchase-reviews/validation';
import type { PurchaseReviewDecision, PurchaseReviewPayload } from '@/lib/general-affairs/purchase-reviews/types';

export const dynamic = 'force-dynamic';

const PURCHASE_REVIEW_ALLOWED_STATUSES = new Set(['ACCEPTED', 'IN_PROGRESS']);

const DECISION_LABELS: Record<PurchaseReviewDecision, string> = {
  REJECT: '駁回',
  STOCK_ISSUE: '改由庫存出庫',
  TRANSFER: '改由調撥',
  PURCHASE: '進入採購',
  SUBSTITUTE: '改用替代品',
};

function messageOf(error: unknown, fallback = '採購評估操作失敗') {
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
    ? '採購評估資料表尚未建置到目前環境，請先套用 general_affairs_purchase_reviews migration'
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

async function fetchRequest(supabase: any, id: string) {
  const { data, error } = await supabase
    .from('ga_service_requests')
    .select('id, request_no, title, store_id, request_type, main_status, intake_route, desired_quantity, desired_unit, desired_spec')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function buildRequestUpdate(payload: PurchaseReviewPayload) {
  const label = DECISION_LABELS[payload.decision];
  const publicNote = payload.publicNote || payload.decisionNote;

  if (payload.decision === 'REJECT') {
    return {
      main_status: 'REJECTED',
      rejection_reason: 'NOT_ELIGIBLE',
      rejection_note: publicNote,
      public_progress: `總務採購評估結果：${label}。${publicNote}`,
    };
  }

  if (payload.decision === 'STOCK_ISSUE') {
    return {
      main_status: 'ACCEPTED',
      intake_route: 'STOCK_ISSUE',
      public_progress: `總務採購評估結果：${label}。後續改由庫存出庫處理。${publicNote ? ` ${publicNote}` : ''}`,
    };
  }

  if (payload.decision === 'TRANSFER') {
    return {
      main_status: 'ACCEPTED',
      intake_route: 'TRANSFER',
      public_progress: `總務採購評估結果：${label}。後續改由調撥處理。${publicNote ? ` ${publicNote}` : ''}`,
    };
  }

  if (payload.decision === 'SUBSTITUTE') {
    return {
      main_status: 'IN_PROGRESS',
      public_progress: `總務採購評估結果：${label}。${payload.substituteDescription}${publicNote ? ` ${publicNote}` : ''}`,
    };
  }

  return {
    main_status: 'IN_PROGRESS',
    public_progress: `總務採購評估結果：${label}。${publicNote || '已進入採購處理。'}`,
  };
}

export async function GET(_: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canReadPurchaseReviews()) return jsonError('沒有採購評估查看權限', 403);

    const current = await fetchRequest(supabase, params.id);
    if (!current) return jsonError('找不到需求單', 404);

    const [{ data: review, error: reviewError }, { data: vendors, error: vendorsError }] = await Promise.all([
      supabase
        .from('ga_purchase_reviews')
        .select(`
          *,
          vendor:ga_vendors(id, name, alias, status, phone, contact_name),
          receiving_location:ga_inventory_locations(id, code, name, location_type, store_id, store:stores(id, store_code, store_name, short_name)),
          quotes:ga_purchase_review_quotes(*, vendor:ga_vendors(id, name, alias, status))
        `)
        .eq('request_id', current.id)
        .is('deleted_at', null)
        .maybeSingle(),
      supabase
        .from('ga_vendors')
        .select('id, name, alias, status, phone, contact_name')
        .eq('status', 'active')
        .order('name'),
    ]);

    if (reviewError) throw reviewError;
    if (vendorsError) throw vendorsError;

    let inventoryLocations: any[] = [];
    if (await canReadInventoryBalances()) {
      const { data: locations, error: locationsError } = await supabase
        .from('ga_inventory_locations')
        .select('id, code, name, location_type, store_id, store:stores(id, store_code, store_name, short_name)')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('location_type')
        .order('name');
      if (locationsError) throw locationsError;
      inventoryLocations = locations || [];
    }

    return NextResponse.json({
      success: true,
      data: {
        review,
        vendors: vendors || [],
        inventoryLocations,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonError('未登入', 401);
    if (!await canManagePurchaseReviews()) return jsonError('沒有採購評估管理權限', 403);

    const current = await fetchRequest(supabase, params.id);
    if (!current) return jsonError('找不到需求單', 404);
    if (current.intake_route !== 'PURCHASE_REVIEW') {
      return jsonError('此需求單尚未分流為添購 / 採購評估', 409);
    }
    if (!PURCHASE_REVIEW_ALLOWED_STATUSES.has(current.main_status)) {
      return jsonError('此需求單狀態目前不可執行採購評估', 409);
    }

    const payload = validatePurchaseReviewPayload(await request.json());
    const actorName = await getUserDisplayName(supabase, user.id);
    const adminSupabase = createAdminClient();

    let purchaseNo: string | null = null;
    if (payload.decision === 'PURCHASE') {
      const { data: generatedPurchaseNo, error: purchaseNoError } = await adminSupabase.rpc('ga_next_purchase_order_no');
      if (!purchaseNoError) purchaseNo = generatedPurchaseNo || null;
    }

    const reviewRow = {
      request_id: current.id,
      decision: payload.decision,
      vendor_id: payload.vendorId,
      vendor_name: payload.vendorName,
      approved_quantity: payload.approvedQuantity,
      approved_unit: payload.approvedUnit,
      estimated_amount: payload.estimatedAmount,
      quoted_amount: payload.quotedAmount,
      negotiated_amount: payload.negotiatedAmount,
      final_amount: payload.finalAmount,
      expected_delivery_date: payload.expectedDeliveryDate,
      delivery_method: payload.deliveryMethod,
      receiving_location_id: payload.receivingLocationId,
      substitute_description: payload.substituteDescription,
      decision_note: payload.decisionNote,
      public_note: payload.publicNote,
      updated_by: user.id,
      deleted_at: null,
      ...(purchaseNo ? { purchase_no: purchaseNo } : {}),
    };

    const { data: existingReview, error: existingError } = await adminSupabase
      .from('ga_purchase_reviews')
      .select('id, purchase_no')
      .eq('request_id', current.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (existingError) throw existingError;

    if (payload.decision === 'PURCHASE') {
      const { data: fulfillment, error: fulfillmentError } = await adminSupabase.from('ga_part_fulfillments')
        .select('id, requested_quantity').eq('request_id', current.id).is('deleted_at', null).maybeSingle();
      if (fulfillmentError) throw fulfillmentError;
      if (fulfillment) {
        const { data: activeDocuments, error: activeDocumentsError } = await adminSupabase.from('ga_part_fulfillment_documents')
          .select('document_id, quantity').eq('fulfillment_id', fulfillment.id).neq('status', 'CANCELED');
        if (activeDocumentsError) throw activeDocumentsError;
        const committedByOtherDocuments = (activeDocuments || [])
          .filter((item) => !existingReview?.id || item.document_id !== existingReview.id)
          .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const remainingQuantity = Math.max(0, Number(fulfillment.requested_quantity || 0) - committedByOtherDocuments);
        if (Number(payload.approvedQuantity || 0) > remainingQuantity) return jsonError(`採購數量不可超過剩餘需求量 ${remainingQuantity}`, 409);
      }
    }

    const savedReviewRow = existingReview?.purchase_no
      ? { ...reviewRow, purchase_no: existingReview.purchase_no }
      : reviewRow;
    const reviewQuery = existingReview?.id
      ? adminSupabase.from('ga_purchase_reviews').update(savedReviewRow).eq('id', existingReview.id)
      : adminSupabase.from('ga_purchase_reviews').insert({ ...savedReviewRow, created_by: user.id });

    const { data: review, error: reviewError } = await reviewQuery.select('*').single();
    if (reviewError) throw reviewError;

    if (payload.decision === 'PURCHASE' && (payload.vendorId || payload.vendorName || payload.quotedAmount || payload.negotiatedAmount || payload.finalAmount || payload.quoteNotes)) {
      const { error: quoteDeleteError } = await adminSupabase
        .from('ga_purchase_review_quotes')
        .update({ deleted_at: new Date().toISOString(), updated_by: user.id })
        .eq('purchase_review_id', review.id)
        .is('deleted_at', null);
      if (quoteDeleteError) throw quoteDeleteError;

      const { error: quoteError } = await adminSupabase
        .from('ga_purchase_review_quotes')
        .insert({
          purchase_review_id: review.id,
          vendor_id: payload.vendorId,
          vendor_name: payload.vendorName,
          quote_amount: payload.quotedAmount,
          negotiated_amount: payload.negotiatedAmount,
          lead_time_days: payload.quoteLeadTimeDays,
          is_selected: true,
          notes: payload.quoteNotes,
          created_by: user.id,
          updated_by: user.id,
        });
      if (quoteError) throw quoteError;
    }

    const requestUpdate = buildRequestUpdate(payload);
    const { data: updatedRequest, error: requestUpdateError } = await adminSupabase
      .from('ga_service_requests')
      .update(requestUpdate)
      .eq('id', current.id)
      .is('deleted_at', null)
      .select('id, request_no, main_status, intake_route, public_progress, updated_at')
      .single();
    if (requestUpdateError) throw requestUpdateError;

    const decisionLabel = DECISION_LABELS[payload.decision];
    const { error: eventError } = await adminSupabase
      .from('ga_service_request_events')
      .insert({
        request_id: current.id,
        event_type: 'PURCHASE_REVIEW_DECIDED',
        old_status: current.main_status,
        new_status: updatedRequest.main_status,
        visibility: 'PUBLIC',
        title: '添購 / 採購評估',
        description: `評估結果：${decisionLabel}。${payload.publicNote || payload.decisionNote}`,
        metadata: {
          action: 'purchase_review',
          review_id: review.id,
          decision: payload.decision,
          vendor_id: payload.vendorId,
          vendor_name: payload.vendorName,
          approved_quantity: payload.approvedQuantity,
          approved_unit: payload.approvedUnit,
          final_amount: payload.finalAmount,
          receiving_location_id: payload.receivingLocationId,
        },
        created_by: user.id,
        created_by_name: actorName,
      });

    if (eventError) throw eventError;

    if (payload.decision === 'PURCHASE') {
      try {
        const { data: fulfillment, error: fulfillmentError } = await adminSupabase.from('ga_part_fulfillments').upsert({
          request_id: current.id,
          status: 'WAITING_ARRIVAL',
          requested_quantity: current.desired_quantity,
          unit: current.desired_unit,
          current_step: '已建立採購單，等待到貨',
          created_by: user.id,
          updated_by: user.id,
          deleted_at: null,
        }, { onConflict: 'request_id' }).select('id').single();
        if (fulfillmentError) throw fulfillmentError;
        if (review.purchase_no) {
          const { error: documentError } = await adminSupabase.from('ga_part_fulfillment_documents').upsert({
            fulfillment_id: fulfillment.id,
            document_type: 'PURCHASE',
            document_id: review.id,
            document_no: review.purchase_no,
            quantity: payload.approvedQuantity,
            status: 'WAITING_ARRIVAL',
            created_by: user.id,
          }, { onConflict: 'fulfillment_id,document_type,document_id' });
          if (documentError) throw documentError;
        }
      } catch (linkError) {
        console.warn('採購單尚未連結料件處理中心:', messageOf(linkError));
      }
    }

    return NextResponse.json({ success: true, data: { review, request: updatedRequest } }, { status: 201 });
  } catch (error) {
    return jsonError(error, 400);
  }
}
