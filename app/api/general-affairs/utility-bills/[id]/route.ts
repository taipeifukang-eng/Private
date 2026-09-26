import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canManageUtilityBills } from '@/lib/general-affairs/utility-bills/access';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!uuid.test(params.id)) throw new Error('紀錄格式錯誤');
    if (!await canManageUtilityBills()) return NextResponse.json({ success: false, error: '沒有費用紀錄管理權限' }, { status: 403 });
    const body = await request.json();
    const paidAt = body.paid_at ? String(body.paid_at).slice(0, 10) : null;
    const supabase = await createClient();
    const { data, error } = await supabase.from('ga_utility_bills').update({ paid_at: paidAt }).eq('id', params.id).is('deleted_at', null).select().single();
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '更新失敗' }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!uuid.test(params.id)) throw new Error('紀錄格式錯誤');
    if (!await canManageUtilityBills()) return NextResponse.json({ success: false, error: '沒有費用紀錄管理權限' }, { status: 403 });
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('ga_utility_bills').update({ deleted_at: new Date().toISOString(), deleted_by: user?.id || null }).eq('id', params.id).is('deleted_at', null);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : '刪除失敗' }, { status: 400 });
  }
}
