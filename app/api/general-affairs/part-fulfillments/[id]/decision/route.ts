import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { canManagePartFulfillments } from '@/lib/general-affairs/part-fulfillments/access';

const DECISIONS = {
  STOCK_ISSUE: { status: 'STOCK_ISSUE', route: 'STOCK_ISSUE', step: '等待建立出庫單' },
  TRANSFER: { status: 'TRANSFER', route: 'TRANSFER', step: '等待建立調撥單' },
  PURCHASE: { status: 'PURCHASING', route: 'PURCHASE_REVIEW', step: '等待建立採購單' },
} as const;
const LOCKED_STATUSES = new Set(['WAITING_STORE_CONFIRMATION', 'COMPLETED', 'CANCELED']);

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    if (!await canManagePartFulfillments()) return NextResponse.json({ success: false, error: '沒有料件處理管理權限' }, { status: 403 });
    const body = await request.json();
    const decision = String(body?.decision || '').toUpperCase() as keyof typeof DECISIONS;
    const target = DECISIONS[decision];
    if (!target) return NextResponse.json({ success: false, error: '請選擇出庫、調撥或採購' }, { status: 400 });

    const adminSupabase = createAdminClient();
    const { data: fulfillment, error: findError } = await adminSupabase.from('ga_part_fulfillments')
      .select('id, request_id, status').eq('id', params.id).is('deleted_at', null).single();
    if (findError) throw findError;
    if (LOCKED_STATUSES.has(fulfillment.status)) {
      return NextResponse.json({ success: false, error: '此處理單已送門市確認或結案，無法重新選擇處理方式' }, { status: 409 });
    }

    const { data: updated, error: updateError } = await adminSupabase.from('ga_part_fulfillments').update({
      status: target.status,
      current_step: target.step,
      updated_by: user.id,
    }).eq('id', fulfillment.id).select('*').single();
    if (updateError) throw updateError;

    const { error: requestError } = await adminSupabase.from('ga_service_requests').update({
      intake_route: target.route,
      main_status: 'IN_PROGRESS',
      public_progress: decision === 'STOCK_ISSUE' ? '總務正在準備庫存出庫。' : decision === 'TRANSFER' ? '總務正在安排調撥。' : '總務已進入採購處理。',
    }).eq('id', fulfillment.request_id).is('deleted_at', null);
    if (requestError) throw requestError;

    const { error: eventError } = await adminSupabase.from('ga_part_fulfillment_events').insert({
      fulfillment_id: fulfillment.id,
      event_type: fulfillment.status === 'EXCEPTION' ? 'EXCEPTION_RECOVERY_SELECTED' : 'FULFILLMENT_DECISION_SELECTED',
      title: fulfillment.status === 'EXCEPTION' ? `異常改用${decision === 'STOCK_ISSUE' ? '出庫' : decision === 'TRANSFER' ? '調撥' : '採購'}處理` : `選擇${decision === 'STOCK_ISSUE' ? '出庫' : decision === 'TRANSFER' ? '調撥' : '採購'}處理`,
      description: target.step,
      metadata: { previous_status: fulfillment.status, next_status: target.status, decision },
      created_by: user.id,
    });
    if (eventError) throw eventError;

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '處理方式儲存失敗' }, { status: 500 });
  }
}
