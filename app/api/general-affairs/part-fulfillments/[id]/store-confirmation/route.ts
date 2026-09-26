import { NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { canManagePartFulfillments } from '@/lib/general-affairs/part-fulfillments/access';

export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    if (!await canManagePartFulfillments()) return NextResponse.json({ success: false, error: '沒有料件處理管理權限' }, { status: 403 });
    const adminSupabase = createAdminClient();
    const { data: fulfillment, error: findError } = await adminSupabase.from('ga_part_fulfillments')
      .select('id, request_id, requested_quantity, fulfilled_quantity').eq('id', params.id).is('deleted_at', null).single();
    if (findError) throw findError;
    if (Number(fulfillment.fulfilled_quantity || 0) <= 0) return NextResponse.json({ success: false, error: '尚未有料件可送門市確認' }, { status: 409 });
    if (Number(fulfillment.requested_quantity || 0) > Number(fulfillment.fulfilled_quantity || 0)) {
      return NextResponse.json({ success: false, error: `尚未完成需求數量，目前已處理 ${Number(fulfillment.fulfilled_quantity || 0)} / ${Number(fulfillment.requested_quantity || 0)}` }, { status: 409 });
    }

    const { data: updated, error: updateError } = await adminSupabase.from('ga_part_fulfillments').update({ status: 'WAITING_STORE_CONFIRMATION', current_step: '已交付料件，等待門市確認', updated_by: user.id }).eq('id', fulfillment.id).select('*').single();
    if (updateError) throw updateError;
    const { error: requestError } = await adminSupabase.from('ga_service_requests').update({ main_status: 'WAITING_STORE_CONFIRMATION', public_progress: '總務已交付料件，請門市確認收貨或使用結果。' }).eq('id', fulfillment.request_id).is('deleted_at', null);
    if (requestError) throw requestError;
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '送門市確認失敗' }, { status: 500 });
  }
}
