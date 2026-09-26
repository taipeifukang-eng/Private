import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { canManagePartFulfillments } from '@/lib/general-affairs/part-fulfillments/access';

const TYPES = ['少收', '未收', '破損', '收錯', '取消'] as const;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: '未登入' }, { status: 401 });
    if (!await canManagePartFulfillments()) return NextResponse.json({ success: false, error: '沒有料件處理管理權限' }, { status: 403 });
    const body = await request.json();
    const type = String(body?.type || '').trim() as typeof TYPES[number];
    const note = String(body?.note || '').trim();
    if (!TYPES.includes(type)) return NextResponse.json({ success: false, error: '請選擇異常類型' }, { status: 400 });
    if (!note) return NextResponse.json({ success: false, error: '請說明實際狀況' }, { status: 400 });

    const adminSupabase = createAdminClient();
    const { data: fulfillment, error: findError } = await adminSupabase.from('ga_part_fulfillments').select('id, request_id, status').eq('id', params.id).is('deleted_at', null).single();
    if (findError) throw findError;
    const { data: updated, error: updateError } = await adminSupabase.from('ga_part_fulfillments').update({ status: 'EXCEPTION', current_step: `異常：${type}`, notes: note, updated_by: user.id }).eq('id', fulfillment.id).select('*').single();
    if (updateError) throw updateError;
    const { error: eventError } = await adminSupabase.from('ga_part_fulfillment_events').insert({ fulfillment_id: fulfillment.id, event_type: 'EXCEPTION_REPORTED', title: type, description: note, metadata: { previous_status: fulfillment.status }, created_by: user.id });
    if (eventError) throw eventError;
    await adminSupabase.from('ga_service_requests').update({ main_status: 'IN_PROGRESS', public_progress: `料件處理發生異常（${type}），總務正在處理。` }).eq('id', fulfillment.request_id).is('deleted_at', null);
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '異常登錄失敗' }, { status: 500 });
  }
}
